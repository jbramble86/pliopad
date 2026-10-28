// Full-width pages: settings (workspace, members, billing, import/export, audit, account), tasks, Ask AI and the graph.
import { h, icon, toast, modal, confirmBox, promptBox, relTime, fmtDate, avatar, mdToHtml, store, fmtBytes } from './ui.js';
import { state, api, wsApi, download, isAdmin, canWrite, noteMeta } from './api.js';
import { go, refreshBoot } from './main.js';

const topbar = (title) => h('div', { class: 'topbar' }, h('button', { class: 'btn icon mobile-only', onclick: () => { document.querySelector('.shell').dataset.pane = 'side'; } }, icon('menu')),
  h('strong', { style: { padding: '0 6px' } }, title));

function page(main, title, ...content) {
  main.replaceChildren(topbar(title), h('div', { class: 'main-scroll' }, h('div', { class: 'page' }, ...content)));
}

// ---------- Settings ----------
const TABS = [['general', 'General'], ['members', 'Members'], ['billing', 'Plan & billing'], ['import', 'Import & export'], ['audit', 'Audit log'], ['account', 'My account']];

export async function settingsPage(main, tab) {
  const base = `#/w/${state.wsId}/settings`;
  const body = h('div', {}, h('div', { class: 'empty' }, 'Loading…'));
  const tabs = h('div', { class: 'tabs' }, TABS.filter(([k]) => isAdmin() || ['account', 'import'].includes(k) || k === 'members')
    .map(([k, l]) => h('a', { href: `${base}/${k}`, class: tab === k ? 'active' : '' }, l)));
  page(main, 'Settings', h('h1', {}, 'Settings'), h('p', { class: 'lead' }, state.boot.workspace.name), tabs, body);
  const fn = { general, members, billing, importExport, audit, account }[{ import: 'importExport' }[tab] || tab] || general;
  try { await fn(body); } catch (e) { body.replaceChildren(h('div', { class: 'panel' }, e.message)); }
}

async function general(body) {
  const ws = await wsApi('GET', '');
  const name = h('input', { class: 'input', value: ws.name, disabled: !isAdmin() });
  const pub = h('input', { type: 'checkbox', checked: ws.settings.allow_public_pages !== false, disabled: !isAdmin() });
  const u = ws.usage;
  const l = ws.limits;
  const meter = (label, v, max, unit = '') => h('div', { class: 'stat' }, h('div', { class: 'v' }, `${v}${unit}`), h('div', { class: 'l' }, `${label} of ${max >= 100000 ? 'unlimited' : max + unit}`),
    h('div', { class: 'meter' }, h('i', { style: { width: Math.min(100, (100 * v) / Math.max(1, max)) + '%' } })));
  body.replaceChildren(
    h('div', { class: 'stats' }, meter('Members', u.members, l.members), meter('Storage', u.storage_mb, l.storage_mb, ' MB'), meter('AI requests this month', u.ai, l.ai_per_month),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, u.notes), h('div', { class: 'l' }, 'Notes and pages'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Workspace'), h('p', { class: 'help' }, `You are ${ws.role === 'owner' ? 'an owner' : 'a' + (ws.role === 'admin' ? 'n admin' : ' ' + ws.role)} of this workspace · ${ws.plan_name} plan`),
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('label', { class: 'row', style: { marginBottom: '14px' } }, pub, 'Allow publishing pages to the web'),
      isAdmin() ? h('button', { class: 'btn primary', onclick: async () => {
        try { await wsApi('PATCH', '', { name: name.value, settings: { allow_public_pages: pub.checked } }); toast('Saved'); await refreshBoot(); } catch (e) { toast(e.message, { error: true }); }
      } }, 'Save changes') : null),
    ws.role === 'owner' ? h('div', { class: 'panel', style: { borderColor: 'var(--danger)' } }, h('h3', {}, 'Delete workspace'),
      h('p', { class: 'help' }, 'Permanently deletes every note, file and member of this workspace. Export first if you might need anything.'),
      h('button', { class: 'btn danger', onclick: async () => {
        const typed = await promptBox('Delete workspace', { label: `Type “${ws.name}” to confirm`, ok: 'Delete forever' });
        if (typed !== ws.name) return typed !== null && toast('The name did not match', { error: true });
        await wsApi('DELETE', '', { confirm: typed });
        state.me = await api('GET', '/me');
        go('#/');
      } }, 'Delete this workspace')) : null);
}

async function members(body) {
  const data = await wsApi('GET', '/members');
  const me = state.me.user.id;
  const roleSel = (m) => h('select', { class: 'input', style: { width: '120px', height: '30px' }, disabled: !isAdmin() || m.id === me,
    onchange: async (e) => { try { await wsApi('PATCH', `/members/${m.id}`, { role: e.target.value }); toast('Role updated'); } catch (x) { toast(x.message, { error: true }); members(body); } } },
  ['owner', 'admin', 'member', 'guest'].map((r) => h('option', { value: r, selected: m.role === r }, r[0].toUpperCase() + r.slice(1))));
  const email = h('input', { class: 'input', placeholder: 'name@company.com, another@company.com' });
  const role = h('select', { class: 'input', style: { width: '140px' } }, h('option', { value: 'member' }, 'Member'), h('option', { value: 'admin' }, 'Admin'), h('option', { value: 'guest' }, 'Guest (read-only)'));
  body.replaceChildren(
    isAdmin() ? h('div', { class: 'panel' }, h('h3', {}, 'Invite people'), h('p', { class: 'help' }, 'They get an email with a link. You can also copy the link from the list below.'),
      h('div', { class: 'row' }, email, role, h('button', { class: 'btn primary', onclick: async () => {
        try {
          const r = await wsApi('POST', '/invites', { email: email.value, role: role.value });
          toast(r.invited.length ? `Invited ${r.invited.length}` : 'Nobody new to invite');
          members(body);
        } catch (e) { toast(e.message, { error: true }); }
      } }, 'Invite'))) : null,
    h('div', { class: 'panel' }, h('h3', {}, `Members (${data.members.length})`),
      h('table', { class: 'grid' }, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Role'), h('th', {}, '2FA'), h('th', {}, 'Last active'), h('th', {})),
        data.members.map((m) => h('tr', {}, h('td', {}, h('div', { class: 'row' }, avatar(m, 28), h('div', {}, h('div', {}, m.name, m.id === me ? ' (you)' : ''), h('div', { class: 'muted', style: { fontSize: '12px' } }, m.email)))),
          h('td', {}, roleSel(m)), h('td', {}, m.mfa ? h('span', { class: 'badge accent' }, 'On') : h('span', { class: 'badge' }, 'Off')),
          h('td', { class: 'muted' }, relTime(Number(m.last_seen))),
          h('td', { style: { textAlign: 'right' } }, (isAdmin() && m.id !== me) || m.id === me ? h('button', { class: 'btn sm danger', onclick: async () => {
            if (!(await confirmBox(m.id === me ? 'Leave workspace?' : 'Remove member?', m.id === me ? 'You will lose access to this workspace.' : `${m.name} will lose access.`, { ok: m.id === me ? 'Leave' : 'Remove', danger: true }))) return;
            try { await wsApi('DELETE', `/members/${m.id}`); if (m.id === me) { state.me = await api('GET', '/me'); go('#/'); } else members(body); } catch (e) { toast(e.message, { error: true }); }
          } }, m.id === me ? 'Leave' : 'Remove') : null))))),
    data.invites.length ? h('div', { class: 'panel' }, h('h3', {}, 'Pending invitations'),
      h('table', { class: 'grid' }, data.invites.map((i) => h('tr', {}, h('td', {}, i.email), h('td', {}, i.role), h('td', { class: 'muted' }, relTime(Number(i.created_at))),
        h('td', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm', onclick: () => { navigator.clipboard?.writeText(i.link); toast('Invite link copied'); } }, 'Copy link'), ' ',
          isAdmin() ? h('button', { class: 'btn sm danger', onclick: async () => { await wsApi('DELETE', `/invites/${i.id}`); members(body); } }, 'Withdraw') : null))))) : null);
}

async function billing(body) {
  const b = await wsApi('GET', '/billing');
  const ws = b.workspace;
  const owner = ws.role === 'owner';
  const feats = (p) => [`${p.members >= 100000 ? 'Unlimited' : 'Up to ' + p.members} members`, `${p.storage_mb >= 1024 ? p.storage_mb / 1024 + ' GB' : p.storage_mb + ' MB'} storage`,
    `${p.ai_per_month.toLocaleString()} AI requests / month`, `${p.history_days}-day version history`, p.guests ? 'Guests (read-only)' : null, p.audit ? 'Audit log & admin controls' : null].filter(Boolean);
  body.replaceChildren(
    location.hash.includes('ok=1') ? h('div', { class: 'panel', style: { borderColor: 'var(--ok)' } }, '🎉 Thanks! Your plan is updated. It can take a few seconds to show here.') : null,
    h('div', { class: 'panel' }, h('h3', {}, `Current plan: ${ws.plan_name}`),
      h('p', { class: 'help' }, ws.plan_renews ? `Renews ${new Date(ws.plan_renews).toLocaleDateString()}` : 'Personal is a flat monthly price. Team plans are billed per member (guests are free).'),
      b.has_customer && owner ? h('button', { class: 'btn', onclick: async () => { try { location.href = (await wsApi('POST', '/billing/portal', {})).url; } catch (e) { toast(e.message, { error: true }); } } }, icon('card'), 'Manage billing & invoices') : null),
    h('div', { class: 'plans' }, Object.entries(b.plans).map(([key, p]) => h('div', { class: 'plan' + (ws.plan === key ? ' current' : '') },
      h('strong', {}, p.name), h('div', { class: 'price' }, p.price === null ? 'Custom' : p.price === 0 ? 'Free' : `$${p.price}`, p.price ? h('span', { class: 'muted', style: { fontSize: '13px', fontWeight: 400 } }, p.per === 'month' ? ' / month' : ' / member / mo') : null),
      p.audience && p.audience !== 'both' ? h('div', { class: 'muted', style: { fontSize: '12px' } }, p.audience === 'personal' ? 'For one person' : 'For teams') : null,
      h('ul', {}, feats(p).map((f) => h('li', {}, f))),
      ws.plan === key ? h('button', { class: 'btn', disabled: true }, 'Current plan')
        : p.price === null ? h('a', { class: 'btn', href: 'mailto:' + (state.me.app.support || '') + '?subject=Enterprise plan' }, 'Contact sales')
          : p.price === 0 ? null
            : h('button', { class: 'btn primary', disabled: !owner || !b.stripe, title: !b.stripe ? 'Online checkout is not set up yet' : !owner ? 'Only owners can change the plan' : '',
              onclick: async () => { try { location.href = (await wsApi('POST', '/billing/checkout', { plan: key })).url; } catch (e) { toast(e.message, { error: true }); } } }, `Upgrade to ${p.name}`)))));
}

async function importExport(body) {
  const status = h('div', { class: 'muted', style: { marginTop: '10px' } });
  const fileInput = h('input', { type: 'file', accept: '.enex,.md,.markdown,.txt,.html,.htm', multiple: true, style: { display: 'none' }, onchange: async () => {
    let total = 0;
    for (const f of fileInput.files) {
      status.textContent = `Importing ${f.name}…`;
      const ext = f.name.split('.').pop().toLowerCase();
      const format = ext === 'enex' ? 'enex' : ext.startsWith('htm') ? 'html' : 'markdown';
      try { total += (await wsApi('POST', '/import', { format, filename: f.name, content: await f.text() })).created; } catch (e) { toast(`${f.name}: ${e.message}`, { error: true }); }
    }
    status.textContent = `Imported ${total} note${total === 1 ? '' : 's'} into a new notebook.`;
    await refreshBoot();
  } });
  body.replaceChildren(
    h('div', { class: 'panel' }, h('h3', {}, 'Import'), h('p', { class: 'help' },
      'Bring your notes with you. Evernote: File → Export notes → .enex. Notion: Export → Markdown & CSV, then pick the .md files. HTML files work too. Tags, checklists, headings and formatting are kept.'),
    canWrite() ? h('button', { class: 'btn primary', onclick: () => fileInput.click() }, icon('upload'), 'Choose files') : h('p', { class: 'muted' }, 'Guests cannot import.'), fileInput, status),
    isAdmin() ? h('div', { class: 'panel' }, h('h3', {}, 'Export'), h('p', { class: 'help' }, 'Download everything in this workspace as JSON (notes, notebooks, tags and databases). Your data is always yours.'),
      h('button', { class: 'btn', onclick: () => download(`/w/${state.wsId}/export`, `${state.boot.workspace.slug}-export.json`) }, icon('download'), 'Export workspace')) : null,
    h('div', { class: 'panel' }, h('h3', {}, 'Web clipper'), h('p', { class: 'help' }, 'Drag this button to your bookmarks bar. On any web page, select some text (or nothing for the whole page) and click it to save the page to Pliopad.'),
      h('a', { class: 'btn', href: clipperBookmarklet(), onclick: (e) => { e.preventDefault(); toast('Drag the button to your bookmarks bar'); } }, '🔖 Clip to Pliopad')),
    h('div', { class: 'panel' }, h('h3', {}, 'Email & automation API'), h('p', { class: 'help' }, 'Create a personal API token in My account to connect Zapier, Make or your own scripts. POST notes to /api/w/' + state.wsId + '/clip or /api/w/' + state.wsId + '/notes/{uuid}.')));
}

function clipperBookmarklet() {
  const code = `(function(){var s=getSelection(),d=document.createElement('div');if(s.rangeCount&&!s.isCollapsed){for(var i=0;i<s.rangeCount;i++)d.appendChild(s.getRangeAt(i).cloneContents())}else{var m=document.querySelector('article,main')||document.body;d.innerHTML=m.innerHTML}
var w=open('${location.origin}/app/clip.html','pliopadclip','width=480,height=560');addEventListener('message',function f(e){if(e.origin!=='${location.origin}'||e.data!=='pliopad-ready')return;removeEventListener('message',f);w.postMessage({url:location.href,title:document.title,html:d.innerHTML.slice(0,400000)},'${location.origin}')})})()`;
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''));
}

async function audit(body) {
  const filter = h('input', { class: 'input', placeholder: 'Filter by action (e.g. note.deleted, login, member)', style: { maxWidth: '360px' } });
  const table = h('div');
  const load = async () => {
    try {
      const rows = await wsApi('GET', `/audit?limit=300&action=${encodeURIComponent(filter.value)}`);
      table.replaceChildren(h('table', { class: 'grid' }, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Who'), h('th', {}, 'Action'), h('th', {}, 'Target'), h('th', {}, 'IP')),
        rows.map((r) => h('tr', {}, h('td', { class: 'muted' }, fmtDate(r.created_at)), h('td', {}, r.user_email || 'system'), h('td', {}, h('code', {}, r.action)),
          h('td', { class: 'ellipsis', style: { maxWidth: '220px' } }, noteMeta(r.target)?.title || r.target || ''), h('td', { class: 'muted' }, r.ip || '')))));
    } catch (e) { table.replaceChildren(h('div', { class: 'panel' }, e.message, e.code === 'limit' ? h('div', { style: { marginTop: '10px' } }, h('a', { class: 'btn primary', href: `#/w/${state.wsId}/settings/billing` }, 'See plans')) : null)); }
  };
  filter.addEventListener('keydown', (e) => e.key === 'Enter' && load());
  body.replaceChildren(h('div', { class: 'row', style: { marginBottom: '12px' } }, filter, h('button', { class: 'btn', onclick: load }, 'Filter'), h('span', { class: 'grow' }),
    h('button', { class: 'btn', onclick: () => download(`/w/${state.wsId}/audit?format=csv&limit=5000`, 'audit-log.csv') }, icon('download'), 'CSV')), table);
  load();
}

async function account(body) {
  const u = state.me.user;
  const name = h('input', { class: 'input', value: u.name });
  const pw = h('input', { class: 'input', type: 'password', placeholder: 'Current password', autocomplete: 'current-password' });
  const npw = h('input', { class: 'input', type: 'password', placeholder: 'New password (10+ characters)', autocomplete: 'new-password' });
  const sessions = h('div');
  const loadSessions = async () => {
    const rows = await api('GET', '/me/sessions');
    sessions.replaceChildren(h('table', { class: 'grid' }, rows.map((s) => h('tr', {}, h('td', {}, s.label || 'Session', s.current ? h('span', { class: 'badge accent', style: { marginLeft: '6px' } }, 'This device') : null,
      s.kind === 'api' ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, 'API token') : null),
    h('td', { class: 'muted' }, 'Last used ' + relTime(s.last_used)),
    h('td', { style: { textAlign: 'right' } }, s.current ? null : h('button', { class: 'btn sm danger', onclick: async () => { await api('DELETE', `/me/sessions/${s.id}`); loadSessions(); } }, 'Revoke'))))));
  };
  body.replaceChildren(
    h('div', { class: 'panel' }, h('h3', {}, 'Profile'), h('p', { class: 'help' }, u.email), h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('button', { class: 'btn primary', onclick: async () => { state.me = await api('PATCH', '/me', { name: name.value }); toast('Saved'); } }, 'Save')),
    h('div', { class: 'panel' }, h('h3', {}, 'Password'), h('p', { class: 'help' }, 'Changing it signs out your other devices.'),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, pw, npw, h('button', { class: 'btn', onclick: async () => {
        try { await api('PATCH', '/me', { password: pw.value, new_password: npw.value }); pw.value = npw.value = ''; toast('Password changed'); loadSessions(); } catch (e) { toast(e.message, { error: true }); }
      } }, 'Change password'))),
    h('div', { class: 'panel' }, h('h3', {}, 'Two-factor authentication'),
      h('p', { class: 'help' }, u.mfa ? 'On. You need a code from your authenticator app to sign in.' : 'Protect your account with a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator).'),
      u.mfa ? h('button', { class: 'btn danger', onclick: async () => {
        const code = await promptBox('Turn off two-factor', { label: 'Enter a current code to confirm', ok: 'Turn off' });
        if (!code) return;
        try { await api('POST', '/me/mfa/disable', { code }); state.me = await api('GET', '/me'); toast('Two-factor is off'); account(body); } catch (e) { toast(e.message, { error: true }); }
      } }, 'Turn off') : h('button', { class: 'btn primary', onclick: () => setupMfa(body) }, icon('shield'), 'Set up two-factor')),
    h('div', { class: 'panel' }, h('h3', {}, 'Sessions & API tokens'), h('p', { class: 'help' }, 'Devices signed in to your account, and tokens for integrations.'), sessions,
      h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: async () => {
        const label = await promptBox('New API token', { label: 'What is it for?', placeholder: 'Zapier', ok: 'Create' });
        if (!label) return;
        const r = await api('POST', '/me/tokens', { label });
        modal('Your API token', h('div', {}, h('p', {}, 'Copy it now. It will not be shown again.'), h('input', { class: 'input', readOnly: true, value: r.token, onfocus: (e) => e.target.select() }),
          h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Send it as: Authorization: Bearer <token>')));
        loadSessions();
      } }, icon('plus'), 'Create API token')));
  loadSessions();
}

async function setupMfa(body) {
  const s = await api('POST', '/me/mfa/setup', {});
  const code = h('input', { class: 'input', placeholder: '123456', inputmode: 'numeric', autocomplete: 'one-time-code' });
  modal('Set up two-factor', h('div', {},
    h('p', {}, '1. In your authenticator app, add an account using this setup key (or open the link on your phone):'),
    h('div', { class: 'row' }, h('code', { style: { fontSize: '15px', letterSpacing: '1px', wordBreak: 'break-all' } }, s.secret.match(/.{1,4}/g).join(' ')),
      h('button', { class: 'btn sm', onclick: () => { navigator.clipboard?.writeText(s.secret); toast('Copied'); } }, 'Copy')),
    h('p', {}, h('a', { href: s.uri }, 'Open in authenticator app')),
    h('p', {}, '2. Enter the 6-digit code it shows:'), code), {
    actions: [{ label: 'Cancel' }, { label: 'Turn on', primary: true, run: async () => {
      try { await api('POST', '/me/mfa/enable', { secret: s.secret, code: code.value }); state.me = await api('GET', '/me'); toast('Two-factor is on'); account(body); } catch (e) { toast(e.message, { error: true }); return false; }
    } }],
  });
}

// ---------- Tasks ----------
export async function tasksPage(main) {
  const list = h('div', {}, h('div', { class: 'empty' }, 'Loading…'));
  page(main, 'Tasks', h('h1', {}, 'Tasks'), h('p', { class: 'lead' }, 'Every open to-do from every note, in one list. Add "@2026-11-03" to a to-do to give it a due date.'), list);
  const tasks = await wsApi('GET', '/tasks');
  if (!tasks.length) return list.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, '🎉'), 'No open to-dos. Nice work.'));
  const today = new Date().toISOString().slice(0, 10);
  const groups = { Overdue: [], Today: [], Upcoming: [], 'No date': [] };
  for (const t of tasks) groups[!t.due ? 'No date' : t.due < today ? 'Overdue' : t.due === today ? 'Today' : 'Upcoming'].push(t);
  list.replaceChildren(...Object.entries(groups).filter(([, v]) => v.length).map(([g, items]) => h('div', { class: 'panel' }, h('h3', {}, g, ' ', h('span', { class: 'muted' }, items.length)),
    items.map((t) => h('div', { class: 'task' }, h('input', { type: 'checkbox', disabled: !canWrite(), onchange: async (e) => {
      try { await wsApi('POST', '/tasks/toggle', { note_id: t.note_id, block_id: t.block_id }); e.target.closest('.task').style.opacity = '.4'; } catch (x) { toast(x.message, { error: true }); }
    } }), h('div', { class: 'grow' }, h('div', {}, t.text.replace(/\*\*|`/g, '')), h('a', { class: 'src', href: `#/w/${state.wsId}/n/${t.note_id}` }, `${t.icon || '📄'} ${t.note_title || 'Untitled'}`)),
    t.due ? h('span', { class: 'badge' + (t.due < today ? ' accent' : '') }, t.due) : null)))));
}

// ---------- Ask AI ----------
export function askPage(main) {
  const q = h('textarea', { class: 'input', rows: 2, placeholder: 'Ask anything about your notes, e.g. "What did we decide about pricing?"' });
  const out = h('div');
  const ask = async () => {
    const question = q.value.trim();
    if (!question) return;
    out.replaceChildren(h('div', { class: 'panel' }, '✨ Reading your notes…'));
    try {
      const r = await wsApi('POST', '/ai/ask', { question });
      const html = mdToHtml(r.answer).replace(/\[(\d+)\]/g, (m, n) => { const s = r.sources.find((x) => x.n === Number(n)); return s ? `<a href="#/w/${state.wsId}/n/${s.id}">[${n}]</a>` : m; });
      out.replaceChildren(h('div', { class: 'panel answer', html }),
        r.sources.length ? h('div', { class: 'panel' }, h('h3', {}, 'Sources'), r.sources.map((s) => h('a', { class: 'nav-item', href: `#/w/${state.wsId}/n/${s.id}` }, h('span', { class: 'ico' }, `[${s.n}]`), s.title))) : null);
    } catch (e) { out.replaceChildren(h('div', { class: 'panel' }, e.message)); }
  };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
  page(main, 'Ask AI', h('h1', {}, '✨ Ask your notes'), h('p', { class: 'lead' }, 'Answers come only from your workspace, with links to the notes they used.'),
    h('div', { class: 'row', style: { alignItems: 'flex-start' } }, q, h('button', { class: 'btn primary', style: { height: '54px' }, onclick: ask }, 'Ask')), h('div', { style: { marginTop: '16px' } }, out));
  const pre = store.get('askq');
  if (pre) { store.del('askq'); q.value = pre; ask(); } else q.focus();
}

// ---------- Graph ----------
export async function graphPage(main) {
  const canvas = h('canvas');
  const wrap = h('div', { class: 'graph-wrap' }, canvas, h('div', { class: 'muted', style: { position: 'absolute', left: '16px', bottom: '12px', fontSize: '12px' } }, 'Linked pages pull together. Drag to pan, scroll to zoom, click a dot to open it.'));
  main.replaceChildren(topbar('Graph'), wrap);
  const { nodes, edges } = await wsApi('GET', '/graph');
  const N = nodes.map((n, i) => ({ ...n, x: Math.cos(i) * 200 + Math.random() * 40, y: Math.sin(i) * 200 + Math.random() * 40, vx: 0, vy: 0, deg: 0 }));
  const idx = new Map(N.map((n, i) => [n.id, i]));
  const E = edges.map(([a, b, kind]) => [idx.get(a), idx.get(b), kind]).filter(([a, b]) => a !== undefined && b !== undefined);
  for (const [a, b] of E) { N[a].deg++; N[b].deg++; }
  const ctx = canvas.getContext('2d');
  let view = { x: 0, y: 0, k: 1 };
  let hover = null;
  const css = getComputedStyle(document.documentElement);
  const color = (v) => css.getPropertyValue(v).trim();
  const resize = () => { canvas.width = wrap.clientWidth * devicePixelRatio; canvas.height = wrap.clientHeight * devicePixelRatio; redraw(); };
  // The layout settles over ~400 frames; after that the canvas only redraws when something changes (hover, pan, zoom,
  // resize). Repainting non-stop made the mouse pointer flicker or vanish on some Windows setups.
  let ticks = 0;
  let frame = 0;
  const draw = () => {
    frame = 0;
    if (!canvas.isConnected) { removeEventListener("resize", resize); removeEventListener("mouseup", endDrag); return; }
    if (ticks < 400) {
      ticks++;
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const a = N[i], b = N[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const f = 900 / d2;
        dx *= f / Math.sqrt(d2); dy *= f / Math.sqrt(d2);
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
      for (const [a, b] of E) { const A = N[a], B = N[b]; const dx = B.x - A.x, dy = B.y - A.y; A.vx += dx * 0.01; A.vy += dy * 0.01; B.vx -= dx * 0.01; B.vy -= dy * 0.01; }
      for (const n of N) { n.vx -= n.x * 0.002; n.vy -= n.y * 0.002; n.x += n.vx *= 0.82; n.y += n.vy *= 0.82; }
      redraw(); // keep animating until the layout settles
    }
    const W = canvas.width, H = canvas.height, r = devicePixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(r * view.k, 0, 0, r * view.k, W / 2 + view.x * r, H / 2 + view.y * r);
    ctx.lineWidth = 1 / view.k;
    for (const [a, b, kind] of E) { ctx.strokeStyle = kind === "link" ? color("--accent") + "88" : color("--line-2"); ctx.beginPath(); ctx.moveTo(N[a].x, N[a].y); ctx.lineTo(N[b].x, N[b].y); ctx.stroke(); }
    ctx.font = `${12 / view.k}px ${color("--font")}`;
    for (const n of N) {
      const rad = 4 + Math.min(10, n.deg * 1.5);
      ctx.fillStyle = n === hover ? color("--accent") : n.deg ? color("--fg-2") : color("--faint");
      ctx.beginPath(); ctx.arc(n.x, n.y, rad, 0, Math.PI * 2); ctx.fill();
      if (view.k > 0.6 || n === hover || n.deg > 2) { ctx.fillStyle = color("--muted"); ctx.fillText(`${n.icon || ""} ${n.title}`.trim(), n.x + rad + 3, n.y + 4); }
    }
  };
  const redraw = () => { if (!frame) frame = requestAnimationFrame(draw); };
  resize();
  addEventListener("resize", resize);
  const toWorld = (e) => { const b = canvas.getBoundingClientRect(); return { x: (e.clientX - b.left - b.width / 2 - view.x) / view.k, y: (e.clientY - b.top - b.height / 2 - view.y) / view.k }; };
  let drag = null;
  const setCursor = (c) => { if (canvas.style.cursor !== c) canvas.style.cursor = c; };
  const endDrag = () => {
    if (drag && !drag.moved && hover) go(`#/w/${state.wsId}/n/${hover.id}`);
    drag = null;
    setCursor(hover ? "pointer" : "default");
  };
  canvas.onmousedown = (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; };
  canvas.onmousemove = (e) => {
    if (drag) {
      view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y;
      drag.moved ||= Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4;
      if (drag.moved) setCursor("grabbing");
      return redraw();
    }
    const p = toWorld(e);
    const next = N.find((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < 100) || null;
    if (next !== hover) { hover = next; redraw(); }
    setCursor(hover ? "pointer" : "default");
  };
  canvas.onmouseleave = () => { if (!drag && hover) { hover = null; redraw(); } };
  // Releasing the button outside the graph still ends the drag.
  addEventListener("mouseup", endDrag);
  canvas.onwheel = (e) => { e.preventDefault(); view.k = Math.max(0.2, Math.min(4, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); redraw(); };
}
