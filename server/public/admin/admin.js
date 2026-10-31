// Platform admin console: overview, tenants, users, support, audit log, plans, settings and system health. Super admins only.
import { h, icon, toast, confirmBox, promptBox, relTime, fmtDate, debounce, store } from '/app/js/ui.js';
import { state, api, download } from '/app/js/api.js';

const root = document.getElementById('admin');
const theme = store.get('theme', 'system');
if (theme !== 'system') document.documentElement.dataset.theme = theme;

const NAV = [
  ['overview', 'Overview', 'home'], ['tenants', 'Workspaces', 'book'], ['users', 'Users', 'users'], ['support', 'Support', 'chat'], ['help', 'Help articles', 'page'], ['audit', 'Audit log', 'history'],
  [null, 'Configuration'], ['plans', 'Plans & billing', 'card'], ['settings', 'Settings', 'gear'], ['system', 'System health', 'shield'], ['maintenance', 'Maintenance', 'gear'],
];
let shell = null;
/** Support requests waiting for an answer, shown beside Support in the menu. */
let openTickets = 0;

const num = (n) => Number(n || 0).toLocaleString();
const mb = (bytes) => (bytes > 1073741824 ? (bytes / 1073741824).toFixed(1) + ' GB' : (bytes / 1048576).toFixed(1) + ' MB');
const statusEl = (s) => h('span', { class: 'status ' + (s === 'active' ? 'ok' : s === 'suspended' || s === 'disabled' ? 'bad' : '') }, s);
const planBadge = (p) => h('span', { class: 'badge' + (p !== 'free' ? ' accent' : '') }, p);

async function boot() {
  if (!state.token) { location.href = '/app/#/login'; return; }
  try { state.me = await api('GET', '/me'); } catch { location.href = '/app/#/login'; return; }
  if (!state.me.user.is_super) {
    root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', {}, 'Admins only'),
      h('p', { class: 'sub' }, 'This console is for platform administrators.'), h('a', { class: 'btn primary', href: '/app/' }, 'Back to Pliopad'))));
    return;
  }
  addEventListener('hashchange', route);
  try { openTickets = (await api('GET', '/admin/tickets?status=open')).counts.open || 0; } catch { /* shown when Support opens */ }
  route();
}

function layout(active) {
  if (!shell) {
    const nav = h('nav', { class: 'anav' });
    const head = h('header', { class: 'ahead' });
    const body = h('div', { class: 'abody' });
    const el = h('div', { class: 'admin' }, nav, h('main', { class: 'amain' }, head, body));
    root.replaceChildren(el);
    shell = { el, nav, head, body };
  }
  shell.nav.replaceChildren(
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), h('div', {}, state.me.app.name, h('small', {}, 'Admin console'))),
    ...NAV.map(([k, label, ico]) => (k ? h('a', { href: '#/' + k, class: k === active ? 'active' : '', onclick: () => shell.el.classList.remove('nav-open') }, icon(ico), label,
      k === 'support' && openTickets ? h('span', { class: 'nav-count' }, openTickets) : null) : h('div', { class: 'sec' }, label))),
    h('div', { class: 'foot' }, h('a', { href: '/app/' }, icon('back'), 'Back to the app'), h('div', { style: { padding: '8px 10px 0' } }, state.me.user.email, ' · v', state.me.app.version)));
  return shell;
}

function header(title, ...actions) {
  shell.head.replaceChildren(h('button', { class: 'btn icon mobile-only', onclick: () => shell.el.classList.toggle('nav-open') }, icon('menu')), h('h1', {}, title), ...actions);
}

async function route() {
  const [page = 'overview', arg] = location.hash.replace(/^#\/?/, '').split('/');
  layout(page);
  shell.body.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  document.querySelector('.sheet')?.remove();
  try {
    await ({ overview, tenants, users, support, help: helpArticles, audit, plans, settings, system, maintenance }[page] || overview)(arg);
  } catch (e) {
    shell.body.replaceChildren(h('div', { class: 'card' }, e.message));
  }
}

// ---------- Charts (single series: one hue, thin marks, recessive grid, hover tooltip) ----------

/** Draws at the container's real pixel width (and again on resize), so text and marks are never stretched. */
function chart(points, kind) {
  const wrap = h('div', { class: 'chart' });
  let lastW = 0;
  new ResizeObserver(() => {
    const w = Math.round(wrap.clientWidth);
    if (w && w !== lastW) { lastW = w; wrap.replaceChildren(...drawChart(points, kind, w)); }
  }).observe(wrap);
  return wrap;
}

function drawChart(points, kind, W) {
  const H = 180, P = { l: 28, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...points.map((p) => p.n));
  const nice = Math.ceil(max / 4) * 4 || 4;
  const x = (i) => P.l + (i + 0.5) * ((W - P.l - P.r) / points.length);
  const y = (v) => H - P.b - (v / nice) * (H - P.t - P.b);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const grid = el('g', { class: 'grid' });
  const axis = el('g', { class: 'axis' });
  for (let k = 0; k <= 4; k++) {
    const v = (nice / 4) * k;
    grid.append(el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v) }));
    const t = el('text', { x: P.l - 6, y: y(v) + 3, 'text-anchor': 'end' }); t.textContent = v; axis.append(t);
  }
  const last = points.length - 1;
  points.forEach((p, i) => { if ((i % 7 === 0 && last - i >= 4) || i === last) { const t = el('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }); t.textContent = p.day; axis.append(t); } });
  svg.append(grid, axis);
  const bw = Math.max(2, (W - P.l - P.r) / points.length - 2); // 2px gap between bars
  if (kind === 'bar') {
    points.forEach((p, i) => {
      const top = y(p.n), base = y(0), r = Math.min(4, bw / 2, base - top);
      // Rounded data end, square at the baseline.
      const d = p.n ? `M${x(i) - bw / 2},${base} V${top + r} Q${x(i) - bw / 2},${top} ${x(i) - bw / 2 + r},${top} H${x(i) + bw / 2 - r} Q${x(i) + bw / 2},${top} ${x(i) + bw / 2},${top + r} V${base} Z` : '';
      if (d) svg.append(el('path', { d, class: 'bar', 'data-i': i }));
    });
  } else {
    const pts = points.map((p, i) => `${x(i)},${y(p.n)}`).join(' ');
    svg.append(el('polygon', { class: 'area', points: `${x(0)},${y(0)} ${pts} ${x(points.length - 1)},${y(0)}` }), el('polyline', { class: 'line', points: pts }));
  }
  const cross = el('line', { class: 'cross', y1: P.t, y2: H - P.b, x1: -10, x2: -10 });
  const dot = el('circle', { class: 'dot', r: 4, cx: -10, cy: -10, visibility: 'hidden' });
  svg.append(cross);
  if (kind !== 'bar') svg.append(dot);
  const tip = h('div', { class: 'tip hidden' });
  // Hover: snap to the nearest day across the full plot height (a bigger target than the mark).
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.floor(((sx - P.l) / (W - P.l - P.r)) * points.length)));
    const p = points[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.n)); dot.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.bar').forEach((b) => b.classList.toggle('hl', Number(b.dataset.i) === i));
    tip.textContent = `${p.day}: ${p.n}`;
    tip.style.left = (x(i) / W) * r.width + 'px';
    tip.style.top = (y(p.n) / H) * r.height + 'px';
    tip.classList.remove('hidden');
  });
  svg.addEventListener('mouseleave', () => { tip.classList.add('hidden'); cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); dot.setAttribute('visibility', 'hidden'); svg.querySelectorAll('.bar.hl').forEach((b) => b.classList.remove('hl')); });
  return [svg, tip];
}

// ---------- Overview ----------

async function overview() {
  header('Overview', h('button', { class: 'btn', onclick: route }, 'Refresh'));
  const s = await api('GET', '/admin/stats');
  const kpi = (l, v, sub) => h('div', { class: 'kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v), sub ? h('div', { class: 's' }, sub) : null);
  const total = s.by_plan.reduce((a, p) => a + p.n, 0) || 1;
  const sum = (arr) => arr.reduce((a, p) => a + p.n, 0);
  shell.body.replaceChildren(
    h('div', { class: 'kpis' },
      kpi('Monthly recurring revenue', '$' + num(s.mrr), 'Estimated from paid seats'),
      kpi('Users', num(s.users), `+${num(s.users_7d)} in the last 7 days`),
      kpi('Monthly active', num(s.mau), `${num(s.dau)} active today`),
      kpi('Workspaces', num(s.workspaces), s.suspended ? `${s.suspended} suspended` : 'none suspended'),
      kpi('Notes', num(s.notes), `+${num(s.notes_7d)} this week`),
      kpi('Storage', s.storage_mb >= 1024 ? (s.storage_mb / 1024).toFixed(1) + ' GB' : s.storage_mb + ' MB'),
      kpi('AI requests', num(s.ai_month), 'This month'),
      kpi('Two-factor adoption', s.mfa_pct + '%', 'Of all users')),
    h('div', { class: 'cards' },
      h('div', { class: 'card' }, h('h3', {}, 'New sign-ups'), h('div', { class: 'sub' }, `Last 30 days · ${sum(s.signups)} total`), chart(s.signups, 'bar')),
      h('div', { class: 'card' }, h('h3', {}, 'Active users'), h('div', { class: 'sub' }, 'Distinct people active per day · last 30 days'), chart(s.active, 'line'))),
    h('div', { class: 'cards' },
      h('div', { class: 'card' }, h('h3', {}, 'Workspaces by plan'), h('div', { class: 'sub' }, 'Active workspaces'),
        h('div', { class: 'barlist' }, s.by_plan.sort((a, b) => b.n - a.n).map((p) => h('div', { class: 'row' }, h('span', { class: 'lab' }, p.plan),
          h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: (100 * p.n) / total + '%' } })), h('span', { class: 'num' }, p.n))))),
      h('div', { class: 'card' }, h('h3', {}, 'Recent activity'), h('div', { class: 'sub' }, 'Across all workspaces'),
        h('div', { class: 'feed' }, s.recent.map((r) => h('div', { class: 'ev' }, h('code', { style: { fontSize: '12px' } }, r.action),
          h('span', { class: 'grow ellipsis muted' }, r.email || 'system'), h('span', { class: 'muted' }, relTime(r.created_at))))),
        h('a', { href: '#/audit', style: { fontSize: '13px' } }, 'Open audit log →'))));
}

// ---------- Paged tables ----------

function pagedTable({ columns, load, onRow, filters = [], empty = 'Nothing found.' }) {
  const state2 = { page: 1, q: '', ...Object.fromEntries(filters.map((f) => [f.key, ''])) };
  const tbody = h('tbody');
  const pager = h('div', { class: 'pager' });
  const search = h('input', { class: 'input', placeholder: 'Search…', oninput: debounce((e) => { state2.q = e.target.value; state2.page = 1; draw(); }, 250) });
  const selects = filters.map((f) => h('select', { class: 'input', onchange: (e) => { state2[f.key] = e.target.value; state2.page = 1; draw(); } },
    f.options.map(([v, l]) => h('option', { value: v }, l))));
  const draw = async () => {
    const r = await load(state2);
    tbody.replaceChildren(...(r.rows.length ? r.rows.map((row) => h('tr', { onclick: () => onRow(row) }, columns.map((c) => h('td', { class: c.num ? 'num' : '' }, c.cell(row)))))
      : [h('tr', {}, h('td', { colspan: columns.length, class: 'muted', style: { textAlign: 'center', padding: '28px' } }, empty))]));
    const pages = Math.max(1, Math.ceil(r.total / r.per));
    pager.replaceChildren(h('span', {}, `${num(r.total)} total · page ${r.page} of ${pages}`), h('div', { class: 'row' },
      h('button', { class: 'btn sm', disabled: r.page <= 1, onclick: () => { state2.page--; draw(); } }, 'Previous'),
      h('button', { class: 'btn sm', disabled: r.page >= pages, onclick: () => { state2.page++; draw(); } }, 'Next')));
  };
  draw();
  return { el: h('div', {}, h('div', { class: 'toolbar' }, search, ...selects), h('div', { class: 'tbl' }, h('div', { style: { overflowX: 'auto' } },
    h('table', {}, h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))), tbody)), pager)), refresh: draw };
}

function sheet(title, body, actions = []) {
  document.querySelector('.sheet')?.remove();
  const s = h('aside', { class: 'sheet' }, h('div', { class: 'sheet-head' }, h('h2', {}, title), ...actions, h('button', { class: 'btn icon', onclick: () => s.remove() }, icon('x'))),
    h('div', { class: 'sheet-body' }, body));
  document.body.append(s);
  return s;
}

// ---------- Support: requests from the Help center in every app ----------

const TICKET_STATUS = { open: ['Waiting on us', 'warn'], on_hold: ['On hold', ''], answered: ['Waiting on customer', 'ok'], closed: ['Closed', ''] };
const PRIORITY = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
const prioBadge = (p) => h('span', { class: 'tk-prio ' + p }, PRIORITY[p] || p);
const selectOf = (options, value, onchange) => h('select', { class: 'input sm', onchange: (e) => onchange(e.target.value) },
  options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l)));

async function support(id) {
  header('Support', h('button', { class: 'btn', onclick: () => macrosSheet() }, 'Saved replies'));
  const { attachPicker, messageFiles } = await import('/app/js/support-ui.js');
  const staff = await api('GET', '/admin/support/staff');
  const f = { view: store.get('tkView', 'open'), assignee: store.get('tkAssignee', ''), priority: '', q: '' };
  let selected = new Set();
  const list = h('div', { class: 'tk-list' });
  const pane = h('div', { class: 'tk-pane' }, h('div', { class: 'empty' }, 'Pick a request to read and answer it.'));
  const tabs = h('div', { class: 'tk-tabs' });
  const bulk = h('div', { class: 'tk-bulk', hidden: true });
  const load = async () => {
    const qs = new URLSearchParams({ status: f.view === 'active' ? 'active' : f.view === 'all' ? '' : f.view, assignee: f.assignee, priority: f.priority, q: f.q });
    const r = await api('GET', '/admin/tickets?' + qs);
    openTickets = r.counts.open || 0;
    layout('support');
    tabs.replaceChildren(...[['open', 'Waiting on us'], ['on_hold', 'On hold'], ['answered', 'Waiting on customer'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) =>
      h('button', { class: 'tk-tab' + (f.view === k ? ' on' : ''), onclick: () => { f.view = k; store.set('tkView', k); selected.clear(); load(); } }, l,
        k !== 'all' && r.counts[k] ? h('span', { class: 'tk-n' }, r.counts[k]) : null)));
    selected = new Set([...selected].filter((x) => r.rows.some((t) => t.id === x)));
    drawBulk();
    list.replaceChildren(...(r.rows.length ? r.rows.map((t) => {
      const box = h('input', { type: 'checkbox', checked: selected.has(t.id), onclick: (e) => e.stopPropagation(),
        onchange: (e) => { if (e.target.checked) selected.add(t.id); else selected.delete(t.id); drawBulk(); } });
      return h('div', { class: 'tk-row' + (String(t.id) === String(id) ? ' active' : '') + (t.unread ? ' unread' : ''), onclick: () => { location.hash = '#/support/' + t.id; } },
        box,
        h('div', { class: 'grow', style: { minWidth: 0 } },
          h('div', { class: 'row' }, t.unread ? h('span', { class: 'tk-dot', title: 'New message from the customer' }) : null,
            h('b', { class: 'grow ellipsis' }, t.subject), h('span', { class: 'muted', style: { fontSize: '12px' } }, relTime(t.updated_at))),
          h('div', { class: 'muted ellipsis', style: { fontSize: '12.5px' } }, `#${t.id} · ${t.user_name} · ${t.platform || 'Web'}${t.app_version ? ' ' + t.app_version : ''}`),
          h('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } }, prioBadge(t.priority), h('span', { class: 'status ' + TICKET_STATUS[t.status][1] }, TICKET_STATUS[t.status][0]),
            h('span', { class: 'grow' }), h('span', { class: 'muted', style: { fontSize: '12px' } }, t.assignee_name || 'Unassigned'),
            t.rating ? h('span', { title: 'Customer rating' }, t.rating === 'good' ? '👍' : '👎') : null)));
    }) : [h('div', { class: 'empty' }, f.view === 'open' ? 'Nothing waiting. Nice.' : 'No requests here.')]));
  };
  const drawBulk = () => {
    bulk.hidden = !selected.size;
    const go = async (changes) => { try { await api('POST', '/admin/tickets/bulk', { ids: [...selected], ...changes }); selected.clear(); toast('Updated'); load(); } catch (e) { toast(e.message, { error: true }); } };
    bulk.replaceChildren(h('b', {}, `${selected.size} selected`), h('span', { class: 'grow' }),
      h('button', { class: 'btn sm', onclick: () => go({ assignee_id: state.me.user.id }) }, 'Assign to me'),
      h('button', { class: 'btn sm', onclick: () => go({ status: 'on_hold' }) }, 'Hold'),
      h('button', { class: 'btn sm', onclick: () => go({ status: 'closed' }) }, 'Close'));
  };
  const open = async (tid) => {
    const t = await api('GET', '/admin/tickets/' + tid);
    const update = async (changes) => { try { await api('PATCH', '/admin/tickets/' + tid, changes); await open(tid); load(); } catch (e) { toast(e.message, { error: true }); } };
    // Composer: a reply to the customer, or an internal note only staff can see.
    let mode = 'reply';
    const box = h('textarea', { class: 'input', rows: 5 });
    const files = attachPicker();
    const macros = await api('GET', '/admin/support/macros');
    const insert = selectOf([['', macros.length ? 'Insert a saved reply…' : 'No saved replies yet'], ...macros.map((m) => [m.id, m.title])], '', (v) => {
      const m = macros.find((x) => x.id === v);
      if (m) box.value = (box.value ? box.value.replace(/\s*$/, '\n\n') : '') + m.body.replaceAll('{name}', t.user.name.split(' ')[0]);
      insert.value = '';
      box.focus();
    });
    const send = async (status) => {
      if (!box.value.trim()) return toast('Write something first.', { error: true });
      if (files.busy()) return toast('Wait for the attachments to finish uploading.', { error: true });
      try {
        await api('POST', `/admin/tickets/${tid}/reply`, { body: box.value.trim(), status, note: mode === 'note', files: files.ids() });
        toast(mode === 'note' ? 'Note added' : 'Reply sent'); await open(tid); load();
      } catch (e) { toast(e.message, { error: true }); }
    };
    const actions = h('div', { class: 'row', style: { gap: '8px', marginTop: '8px', flexWrap: 'wrap' } });
    const modeTabs = h('div', { class: 'tk-mode' });
    const drawComposer = () => {
      box.placeholder = mode === 'note' ? 'Internal note: only platform admins see this.' : `Reply to ${t.user.name}… Use {name} in saved replies for their first name.`;
      composer.classList.toggle('note', mode === 'note');
      modeTabs.replaceChildren(...[['reply', 'Reply to customer'], ['note', 'Internal note']].map(([k, l]) => h('button', { class: 'tk-tab' + (mode === k ? ' on' : ''), onclick: () => { mode = k; drawComposer(); } }, l)));
      actions.replaceChildren(...(mode === 'note' ? [h('button', { class: 'btn primary', onclick: () => send() }, 'Add note'), files.button]
        : [h('button', { class: 'btn primary', onclick: () => send('answered') }, 'Send reply'), h('button', { class: 'btn', onclick: () => send('closed') }, 'Send and close'),
          h('button', { class: 'btn', onclick: () => send('on_hold') }, 'Send and hold'), files.button]), h('span', { class: 'grow' }), insert);
    };
    const composer = h('div', { class: 'tk-reply' }, modeTabs, box, files.chips, files.input, actions);
    drawComposer();
    pane.replaceChildren(
      h('div', { class: 'tk-head' }, h('div', { class: 'grow' }, h('h2', {}, t.subject),
        h('div', { class: 'muted' }, `#${t.id} · ${t.category || 'question'} · opened ${fmtDate(t.created_at)} · ${t.platform || 'Web'}${t.app_version ? ' ' + t.app_version : ''}`))),
      h('div', { class: 'tk-controls' },
        h('label', {}, 'Status', selectOf(Object.entries(TICKET_STATUS).map(([k, [l]]) => [k, l]), t.status, (v) => update({ status: v }))),
        h('label', {}, 'Priority', selectOf(Object.entries(PRIORITY).map(([k, l]) => [k, l]), t.priority, (v) => update({ priority: v }))),
        h('label', {}, 'Assignee', selectOf([['', 'Unassigned'], ...staff.map((u) => [u.id, u.id === state.me.user.id ? u.name + ' (me)' : u.name])], t.assignee_id,
          (v) => update({ assignee_id: v ? Number(v) : null })))),
      h('div', { class: 'tk-user card' }, h('b', {}, t.user.name), ' · ', h('a', { href: 'mailto:' + t.user.email }, t.user.email),
        h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' } },
          `Joined ${fmtDate(t.user.created_at)}${t.user.last_seen ? ' · last seen ' + relTime(t.user.last_seen) : ''} · ${t.workspaces.map((w) => `${w.name} (${w.plan}, ${w.role})`).join(', ') || 'no workspaces'}`),
        t.history.length ? h('div', { style: { fontSize: '12.5px', marginTop: '6px' } }, 'Earlier requests: ',
          ...t.history.flatMap((x, i) => [i ? ', ' : '', h('a', { href: '#/support/' + x.id }, `#${x.id} ${x.subject}`)])) : null,
        h('div', { style: { marginTop: '6px' } }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); userSheet(t.user.id); } }, 'Open user')),
        t.rating ? h('div', { style: { marginTop: '6px' } }, `Rated ${t.rating === 'good' ? '👍 good' : '👎 bad'}${t.rating_comment ? ': “' + t.rating_comment + '”' : ''}`) : null),
      h('div', { class: 'tk-thread' }, t.messages.map((m) => m.kind === 'event'
        ? h('div', { class: 'tk-event' }, `${m.body}${m.author ? ' · ' + m.author : ''} · ${fmtDate(m.created_at)}`)
        : h('div', { class: 'tk-msg' + (m.staff ? ' staff' : '') + (m.kind === 'note' ? ' note' : '') },
          h('div', { class: 'tk-meta' }, h('b', {}, m.kind === 'note' ? `${m.author || 'Support'} · internal note` : m.staff ? `${m.author || 'Support'} (support)` : m.author || t.user.name), ' · ', fmtDate(m.created_at)),
          h('div', { class: 'tk-body' }, m.body), messageFiles(m.files)))),
      composer);
  };
  shell.body.replaceChildren(h('div', { class: 'tk' }, h('div', { class: 'tk-side' },
    h('input', { class: 'input', placeholder: 'Search #id, subject, name, email or message…', oninput: debounce((e) => { f.q = e.target.value; load(); }, 250) }),
    tabs,
    h('div', { class: 'row', style: { gap: '6px' } },
      selectOf([['', 'Anyone'], ['me', 'Assigned to me'], ['none', 'Unassigned']], f.assignee, (v) => { f.assignee = v; store.set('tkAssignee', v); load(); }),
      selectOf([['', 'Any priority'], ...Object.entries(PRIORITY)], f.priority, (v) => { f.priority = v; load(); })),
    bulk, list), pane));
  // Open the request first, so the list shows it as read.
  if (id) await open(id);
  await load();
}

// ---------- Help articles: what every app's Help center shows ----------

async function helpArticles(openId) {
  const { articleBody } = await import('/app/js/support-ui.js');
  let data = await api('GET', '/admin/help');
  let current = null; // the article in the editor (null: none; {id: null}: new)
  let dirty = false;
  const side = h('div', { class: 'hc-side' });
  const pane = h('div', { class: 'hc-pane' });
  header('Help articles',
    h('a', { class: 'btn', href: '/app/#/help', target: '_blank' }, 'View the Help center'),
    h('button', { class: 'btn', onclick: () => editCategory(null) }, 'New category'),
    h('button', { class: 'btn primary', onclick: () => guard() && open({ id: null, title: '', body: '', category: data.categories[0]?.id, published: true }) }, 'New article'));
  const reload = async () => { data = await api('GET', '/admin/help'); drawSide(); };
  const guard = () => !dirty || confirm('Discard your unsaved changes?');
  const move = async (list, i, d, key) => {
    [list[i], list[i + d]] = [list[i + d], list[i]];
    await api('POST', '/admin/help/order', { [key]: list.map((x) => x.id) });
    await reload();
  };
  const drawSide = () => side.replaceChildren(...data.categories.map((c, ci) => {
    const arts = data.articles.filter((a) => a.category === c.id);
    return h('div', { class: 'hc-cat' },
      h('div', { class: 'hc-cat-head' }, h('span', { class: 'hc-ico' }, c.icon || '📄'), h('b', { class: 'grow ellipsis' }, c.name),
        h('button', { class: 'btn icon sm', title: 'Move up', disabled: ci === 0, onclick: () => move(data.categories, ci, -1, 'categories') }, '↑'),
        h('button', { class: 'btn icon sm', title: 'Move down', disabled: ci === data.categories.length - 1, onclick: () => move(data.categories, ci, 1, 'categories') }, '↓'),
        h('button', { class: 'btn icon sm', title: 'Rename or change icon', onclick: () => editCategory(c) }, icon('gear'))),
      ...arts.map((a, ai) => h('div', { class: 'hc-row' + (current?.id === a.id ? ' active' : ''), onclick: () => guard() && open(a) },
        h('span', { class: 'grow ellipsis' }, a.title), a.published ? null : h('span', { class: 'badge' }, 'Draft'),
        h('button', { class: 'btn icon sm', title: 'Move up', disabled: ai === 0, onclick: (e) => { e.stopPropagation(); move(arts, ai, -1, 'articles'); } }, '↑'),
        h('button', { class: 'btn icon sm', title: 'Move down', disabled: ai === arts.length - 1, onclick: (e) => { e.stopPropagation(); move(arts, ai, 1, 'articles'); } }, '↓'))),
      arts.length ? null : h('div', { class: 'muted', style: { fontSize: '12.5px', padding: '4px 8px' } }, 'No articles yet.'));
  }));

  const open = (a) => {
    current = { ...a };
    dirty = false;
    drawSide();
    const title = h('input', { class: 'input hc-title', value: a.title, placeholder: 'Article title' });
    const cat = h('select', { class: 'input sm' }, data.categories.map((c) => h('option', { value: c.id, selected: c.id === a.category }, `${c.icon} ${c.name}`)));
    const pub = h('input', { type: 'checkbox', checked: a.published });
    const body = h('textarea', { class: 'input hc-body', rows: 18, placeholder: 'Write the article…' }, a.body);
    const preview = h('div', { class: 'help-article hc-preview' });
    const status = h('span', { class: 'muted', style: { fontSize: '12.5px' } }, a.updated_at ? 'Last edited ' + relTime(a.updated_at) : 'Not saved yet');
    const save = h('button', { class: 'btn primary', disabled: !!a.id }, a.id ? 'Save' : 'Create article');
    const drawPreview = () => preview.replaceChildren(h('h1', { class: 'help-title' }, title.value || 'Untitled'), ...articleBody(body.value || ''));
    const changed = () => { dirty = true; save.disabled = false; status.textContent = 'Unsaved changes'; drawPreview(); };
    [title, body].forEach((el) => el.addEventListener('input', changed));
    [cat, pub].forEach((el) => el.addEventListener('change', changed));
    save.onclick = async () => {
      const out = { title: title.value.trim(), body: body.value, category: cat.value, published: pub.checked };
      try {
        const saved = current.id ? await api('PATCH', '/admin/help/articles/' + encodeURIComponent(current.id), out) : await api('POST', '/admin/help/articles', out);
        toast(current.id ? 'Saved. Every app shows the change now.' : 'Article created');
        dirty = false;
        await reload();
        open(saved);
        history.replaceState(null, '', '#/help/' + saved.id);
      } catch (e) { toast(e.message, { error: true }); }
    };
    const del = a.id ? h('button', { class: 'btn danger', onclick: async () => {
      if (!(await confirmBox('Delete this article?', `“${a.title}” disappears from the Help center in every app.`, { ok: 'Delete', danger: true }))) return;
      await api('DELETE', '/admin/help/articles/' + encodeURIComponent(a.id));
      current = null; dirty = false;
      await reload();
      pane.replaceChildren(h('div', { class: 'empty' }, 'Article deleted.'));
    } }, 'Delete') : null;
    pane.replaceChildren(
      title,
      h('div', { class: 'row', style: { gap: '14px', margin: '10px 0', flexWrap: 'wrap' } },
        h('label', { class: 'row', style: { gap: '6px' } }, h('span', { class: 'muted' }, 'Category'), cat),
        h('label', { class: 'row', style: { gap: '6px' } }, pub, 'Published', h('span', { class: 'muted' }, '(drafts are only visible here)')),
        a.id ? h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'Link: /app/#/help/a/' + a.id) : null),
      h('div', { class: 'hc-edit' },
        h('div', {}, body, h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } },
          'Leave a blank line between paragraphs. Start lines with “- ” for bullets or “1. ” for numbered steps.')),
        h('div', {}, h('div', { class: 'hc-label' }, 'Preview'), preview)),
      h('div', { class: 'row', style: { gap: '8px', marginTop: '12px' } }, save, del, h('span', { class: 'grow' }), status));
    drawPreview();
    setTimeout(() => (a.id ? body : title).focus(), 30);
  };

  const editCategory = (c) => {
    const name = h('input', { class: 'input', value: c?.name || '', placeholder: 'e.g. Integrations' });
    const ico = h('input', { class: 'input', value: c?.icon || '', placeholder: 'An emoji, e.g. 🔌', style: { width: '120px' } });
    const body = h('div', {},
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('label', { class: 'field' }, h('span', {}, 'Icon'), ico),
      h('div', { class: 'row', style: { gap: '8px', marginTop: '12px' } },
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            if (c) await api('PATCH', '/admin/help/categories/' + c.id, { name: name.value, icon: ico.value });
            else await api('POST', '/admin/help/categories', { name: name.value, icon: ico.value });
            sheetEl.remove(); await reload();
          } catch (e) { toast(e.message, { error: true }); }
        } }, c ? 'Save' : 'Create category'),
        c ? h('button', { class: 'btn danger', onclick: async () => {
          try { await api('DELETE', '/admin/help/categories/' + c.id); sheetEl.remove(); await reload(); } catch (e) { toast(e.message, { error: true }); }
        } }, 'Delete category') : null));
    const sheetEl = sheet(c ? 'Edit category' : 'New category', body);
    setTimeout(() => name.focus(), 30);
  };

  drawSide();
  shell.body.replaceChildren(h('div', { class: 'hc' }, side, pane));
  const first = data.articles.find((a) => a.id === openId);
  if (first) open(first);
  else pane.replaceChildren(h('div', { class: 'empty' }, 'Pick an article to edit it, or create a new one. Changes show in every app as soon as you save.'));
}

/** Saved replies: reusable answers for common questions. {name} becomes the customer's first name. */
async function macrosSheet() {
  let macros = await api('GET', '/admin/support/macros');
  const body = h('div', {});
  const draw = () => body.replaceChildren(
    h('p', { class: 'sub' }, 'Reusable answers you can insert into a reply. {name} becomes the customer’s first name.'),
    ...macros.map((m, i) => h('div', { class: 'card', style: { marginBottom: '10px' } },
      h('input', { class: 'input', value: m.title, placeholder: 'Title', oninput: (e) => { m.title = e.target.value; } }),
      h('textarea', { class: 'input', rows: 4, style: { marginTop: '6px' }, placeholder: 'Reply text', oninput: (e) => { m.body = e.target.value; } }, m.body),
      h('button', { class: 'btn sm danger', style: { marginTop: '6px' }, onclick: () => { macros.splice(i, 1); draw(); } }, 'Delete'))),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', { class: 'btn', onclick: () => { macros.push({ title: '', body: '' }); draw(); } }, 'Add a saved reply'),
      h('button', { class: 'btn primary', onclick: async () => {
        try { macros = await api('PUT', '/admin/support/macros', { macros }); toast('Saved replies updated'); draw(); } catch (e) { toast(e.message, { error: true }); }
      } }, 'Save')));
  draw();
  sheet('Saved replies', body);
}

// ---------- Workspaces (tenants) ----------

async function tenants() {
  header('Workspaces');
  const t = pagedTable({
    columns: [
      { label: 'Workspace', cell: (w) => h('div', {}, h('strong', {}, w.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, w.slug)) },
      { label: 'Owner', cell: (w) => w.owner || '—' },
      { label: 'Plan', cell: (w) => planBadge(w.plan) },
      { label: 'Status', cell: (w) => statusEl(w.status) },
      { label: 'Members', num: true, cell: (w) => num(w.members) },
      { label: 'Notes', num: true, cell: (w) => num(w.notes) },
      { label: 'Storage', num: true, cell: (w) => mb(w.storage_bytes) },
      { label: 'Created', cell: (w) => new Date(w.created_at).toLocaleDateString() },
    ],
    filters: [{ key: 'plan', options: [['', 'All plans'], ['free', 'Free'], ['personal', 'Personal'], ['pro', 'Team'], ['business', 'Business'], ['enterprise', 'Enterprise']] },
      { key: 'status', options: [['', 'Any status'], ['active', 'Active'], ['suspended', 'Suspended']] }],
    load: (s) => api('GET', `/admin/workspaces?page=${s.page}&q=${encodeURIComponent(s.q)}&plan=${s.plan}&status=${s.status}`),
    onRow: (w) => tenantSheet(w.id, () => t.refresh()),
  });
  shell.body.replaceChildren(t.el);
}

async function tenantSheet(id, refresh) {
  const w = await api('GET', `/admin/workspaces/${id}`);
  const plan = h('select', { class: 'input' }, Object.entries(state.me.plans).map(([k, p]) => h('option', { value: k, selected: k === w.plan }, p.name)));
  const lim = (k, label) => h('label', { class: 'field' }, h('span', {}, label), h('input', { class: 'input', type: 'number', name: k, placeholder: `Plan default: ${state.me.plans[w.plan]?.[k] ?? ''}`, value: w.settings?.limits?.[k] ?? '' }));
  const limits = h('div', { class: 'form-grid' }, lim('members', 'Members'), lim('storage_mb', 'Storage (MB)'), lim('ai_per_month', 'AI requests / month'), lim('history_days', 'History (days)'));
  const patch = async (body, msg) => { try { await api('PATCH', `/admin/workspaces/${id}`, body); toast(msg); refresh(); tenantSheet(id, refresh); } catch (e) { toast(e.message, { error: true }); } };
  const suspended = w.status === 'suspended';
  sheet(w.name, h('div', {},
    h('dl', { class: 'kv' }, h('dt', {}, 'Status'), h('dd', {}, statusEl(w.status)), h('dt', {}, 'Plan'), h('dd', {}, planBadge(w.plan)),
      h('dt', {}, 'Created'), h('dd', {}, fmtDate(w.created_at)), h('dt', {}, 'Members'), h('dd', {}, `${w.usage.members} of ${w.limits.members}`),
      h('dt', {}, 'Storage'), h('dd', {}, `${w.usage.storage_mb} MB of ${w.limits.storage_mb} MB`), h('dt', {}, 'AI this month'), h('dd', {}, `${w.usage.ai} of ${w.limits.ai_per_month}`),
      h('dt', {}, 'Notes'), h('dd', {}, num(w.usage.notes)), h('dt', {}, 'Stripe customer'), h('dd', {}, w.stripe_customer || '—')),
    h('h4', {}, 'Plan'), h('div', { class: 'row' }, plan, h('button', { class: 'btn', onclick: () => patch({ plan: plan.value }, 'Plan changed') }, 'Change plan')),
    h('p', { class: 'muted', style: { fontSize: '12px' } }, 'Changing the plan here does not touch Stripe. Use it for comps, trials and enterprise contracts.'),
    h('h4', {}, 'Custom limits'), limits, h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => patch({ limits: Object.fromEntries([...limits.querySelectorAll('input')].map((i) => [i.name, i.value === '' ? null : Number(i.value)])) }, 'Limits saved') }, 'Save limits'),
      h('button', { class: 'btn', onclick: () => patch({ reset_ai: true }, 'AI allowance reset') }, 'Reset AI allowance')),
    h('h4', {}, `Members (${w.members.length})`),
    h('div', { class: 'tbl' }, h('table', {}, h('tbody', {}, w.members.map((m) => h('tr', { onclick: () => userSheet(m.id) }, h('td', {}, m.name, h('div', { class: 'muted', style: { fontSize: '12px' } }, m.email)), h('td', {}, m.role), h('td', { class: 'muted' }, relTime(m.last_seen))))))),
    h('h4', {}, 'Recent activity'),
    h('div', { class: 'feed' }, w.audit.slice(0, 20).map((a) => h('div', { class: 'ev' }, h('code', { style: { fontSize: '12px' } }, a.action), h('span', { class: 'grow ellipsis muted' }, a.user_email || ''), h('span', { class: 'muted' }, relTime(a.created_at))))),
    h('h4', {}, 'Danger zone'),
    h('div', { class: 'row' },
      h('button', { class: 'btn' + (suspended ? '' : ' danger'), onclick: async () => {
        if (!suspended && !(await confirmBox('Suspend workspace?', 'Members lose access until it is reactivated. Data is kept.', { ok: 'Suspend', danger: true }))) return;
        patch({ status: suspended ? 'active' : 'suspended' }, suspended ? 'Reactivated' : 'Suspended');
      } }, suspended ? 'Reactivate' : 'Suspend'),
      h('button', { class: 'btn danger', onclick: async () => {
        const typed = await promptBox('Delete workspace', { label: `Type “${w.name}” to permanently delete it and all of its data`, ok: 'Delete forever' });
        if (typed === null) return;
        try { await api('DELETE', `/admin/workspaces/${id}`, { confirm: typed }); toast('Workspace deleted'); document.querySelector('.sheet')?.remove(); refresh(); } catch (e) { toast(e.message, { error: true }); }
      } }, 'Delete'))));
}

// ---------- Users ----------

async function users() {
  header('Users');
  const t = pagedTable({
    columns: [
      { label: 'User', cell: (u) => h('div', {}, h('strong', {}, u.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, u.email)) },
      { label: 'Status', cell: (u) => statusEl(u.status) },
      { label: 'Role', cell: (u) => (u.is_super ? h('span', { class: 'badge accent' }, 'Platform admin') : 'User') },
      { label: '2FA', cell: (u) => (u.mfa ? 'On' : h('span', { class: 'muted' }, 'Off')) },
      { label: 'Workspaces', num: true, cell: (u) => u.workspaces },
      { label: 'Last active', cell: (u) => relTime(u.last_seen) || '—' },
      { label: 'Joined', cell: (u) => new Date(u.created_at).toLocaleDateString() },
    ],
    filters: [{ key: 'status', options: [['', 'Any status'], ['active', 'Active'], ['disabled', 'Disabled']] }],
    load: (s) => api('GET', `/admin/users?page=${s.page}&q=${encodeURIComponent(s.q)}&status=${s.status}`),
    onRow: (u) => userSheet(u.id, () => t.refresh()),
  });
  shell.body.replaceChildren(t.el);
}

async function userSheet(id, refresh = () => {}) {
  const u = await api('GET', `/admin/users/${id}`);
  const me = u.id === state.me.user.id;
  const patch = async (body, msg) => { try { await api('PATCH', `/admin/users/${id}`, body); toast(msg); refresh(); userSheet(id, refresh); } catch (e) { toast(e.message, { error: true }); } };
  sheet(u.name, h('div', {},
    h('dl', { class: 'kv' }, h('dt', {}, 'Email'), h('dd', {}, u.email), h('dt', {}, 'Status'), h('dd', {}, statusEl(u.status)),
      h('dt', {}, 'Two-factor'), h('dd', {}, u.mfa ? 'On' : 'Off'), h('dt', {}, 'Platform admin'), h('dd', {}, u.is_super ? 'Yes' : 'No'),
      h('dt', {}, 'Joined'), h('dd', {}, fmtDate(u.created_at)), h('dt', {}, 'Last active'), h('dd', {}, fmtDate(u.last_seen) || '—')),
    h('h4', {}, 'Workspaces'),
    h('div', { class: 'tbl' }, h('table', {}, h('tbody', {}, u.workspaces.map((w) => h('tr', { onclick: () => tenantSheet(w.id, () => {}) }, h('td', {}, w.name), h('td', {}, w.role), h('td', {}, planBadge(w.plan))))))),
    h('h4', {}, `Sessions (${u.sessions.length})`),
    h('div', { class: 'feed' }, u.sessions.map((s) => h('div', { class: 'ev' }, h('span', { class: 'grow' }, s.label || s.kind, s.impersonator_id ? ' (support)' : ''), h('span', { class: 'muted' }, relTime(s.last_used))))),
    h('h4', {}, 'Actions'),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      h('button', { class: 'btn', disabled: me, onclick: async () => {
        const reason = await promptBox(`Sign in as ${u.name}`, { label: 'Reason (recorded in the audit log)', placeholder: 'Support ticket #1234', ok: 'Start support session' });
        if (!reason) return;
        const r = await api('POST', `/admin/users/${id}/impersonate`, { reason });
        open(`/app/#/impersonate/${r.token}`, '_blank', 'noopener');
      } }, icon('users'), 'Sign in as user'),
      h('button', { class: 'btn', onclick: async () => { await api('POST', `/admin/users/${id}/revoke`, {}); toast('Signed out everywhere'); userSheet(id, refresh); } }, 'Sign out everywhere'),
      u.mfa ? h('button', { class: 'btn', onclick: () => patch({ reset_mfa: true }, 'Two-factor reset') }, 'Reset two-factor') : null,
      h('button', { class: 'btn', disabled: me, onclick: () => patch({ is_super: !u.is_super }, u.is_super ? 'Admin access removed' : 'Now a platform admin') }, u.is_super ? 'Remove platform admin' : 'Make platform admin'),
      h('button', { class: 'btn' + (u.status === 'active' ? ' danger' : ''), disabled: me, onclick: () => patch({ status: u.status === 'active' ? 'disabled' : 'active' }, u.status === 'active' ? 'Account disabled' : 'Account enabled') },
        u.status === 'active' ? 'Disable account' : 'Enable account'),
      h('button', { class: 'btn danger', disabled: me, onclick: async () => {
        if (!(await confirmBox('Delete user?', `${u.email} will be deleted. Workspaces where they are the only member are deleted too.`, { ok: 'Delete', danger: true }))) return;
        try { await api('DELETE', `/admin/users/${id}`); toast('User deleted'); document.querySelector('.sheet')?.remove(); refresh(); } catch (e) { toast(e.message, { error: true }); }
      } }, 'Delete user')),
    h('h4', {}, 'Recent activity'),
    h('div', { class: 'feed' }, u.audit.slice(0, 25).map((a) => h('div', { class: 'ev' }, h('code', { style: { fontSize: '12px' } }, a.action), h('span', { class: 'grow ellipsis muted' }, a.target || ''), h('span', { class: 'muted' }, relTime(a.created_at)))))));
}

// ---------- Audit ----------

async function audit() {
  header('Audit log', h('button', { class: 'btn', onclick: () => download(`/admin/audit?format=csv&limit=5000&${params()}`, 'audit-log.csv') }, icon('download'), 'Export CSV'));
  const f = { action: h('input', { class: 'input', placeholder: 'Action, e.g. login.failed' }), user: h('input', { class: 'input', placeholder: 'User email' }),
    workspace: h('input', { class: 'input', placeholder: 'Workspace ID', style: { maxWidth: '130px' } }),
    from: h('input', { class: 'input', type: 'date', style: { width: 'auto' } }), to: h('input', { class: 'input', type: 'date', style: { width: 'auto' } }) };
  const params = () => Object.entries(f).filter(([, el]) => el.value).map(([k, el]) => `${k}=${encodeURIComponent(el.value)}`).join('&');
  const tbody = h('tbody');
  const load = async () => {
    const rows = await api('GET', `/admin/audit?limit=500&${params()}`);
    tbody.replaceChildren(...rows.map((r) => h('tr', { style: { cursor: 'default' } }, h('td', { class: 'muted' }, fmtDate(r.created_at)), h('td', {}, r.user_email || 'system'),
      h('td', {}, h('code', {}, r.action)), h('td', {}, r.workspace_name || '—'), h('td', { style: { maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.target || ''),
      h('td', { class: 'muted', style: { maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.meta ? JSON.stringify(r.meta) : ''), h('td', { class: 'muted' }, r.ip || ''))));
  };
  Object.values(f).forEach((el) => el.addEventListener('change', load));
  shell.body.replaceChildren(h('div', { class: 'toolbar' }, ...Object.values(f), h('button', { class: 'btn primary', onclick: load }, 'Apply')),
    h('div', { class: 'tbl' }, h('div', { style: { overflowX: 'auto' } }, h('table', {}, h('thead', {}, h('tr', {}, ['Time', 'User', 'Action', 'Workspace', 'Target', 'Details', 'IP'].map((x) => h('th', {}, x)))), tbody))));
  load();
}

// ---------- Plans ----------

async function plans() {
  header('Plans & billing');
  const s = await api('GET', '/admin/settings');
  const P = s.plan_defaults;
  const prices = s.stripe_prices || {};
  const fields = [['price', 'Price / seat / month ($)'], ['members', 'Members'], ['storage_mb', 'Storage (MB)'], ['ai_per_month', 'AI requests / month'], ['history_days', 'Version history (days)']];
  const inputs = {};
  const cards = Object.entries(P).map(([key, p]) => {
    inputs[key] = {};
    return h('div', { class: 'card' }, h('h3', {}, p.name), h('div', { class: 'sub' }, key),
      fields.map(([f, label]) => h('label', { class: 'field' }, h('span', {}, label), inputs[key][f] = h('input', { class: 'input', type: 'number', value: p[f] ?? '' }))),
      h('label', { class: 'row', style: { marginBottom: '8px' } }, inputs[key].guests = h('input', { type: 'checkbox', checked: !!p.guests }), 'Guests allowed'),
      h('label', { class: 'row', style: { marginBottom: '12px' } }, inputs[key].audit = h('input', { type: 'checkbox', checked: !!p.audit }), 'Audit log'),
      key === 'free' || key === 'enterprise' ? null : h('label', { class: 'field' }, h('span', {}, 'Stripe price ID'), inputs[key].stripe = h('input', { class: 'input', value: prices[key] || '', placeholder: 'price_…' })));
  });
  const save = async () => {
    const plansOut = {};
    const pricesOut = {};
    for (const [key, f] of Object.entries(inputs)) {
      plansOut[key] = { guests: f.guests.checked, audit: f.audit.checked };
      for (const [k] of fields) if (f[k].value !== '') plansOut[key][k] = Number(f[k].value);
      if (key === 'enterprise' && f.price.value === '') plansOut[key].price = null;
      if (f.stripe?.value) pricesOut[key] = f.stripe.value.trim();
    }
    try { await api('PUT', '/admin/settings', { plans: plansOut, stripe_prices: pricesOut }); toast('Plans saved'); } catch (e) { toast(e.message, { error: true }); }
  };
  shell.body.replaceChildren(h('p', { class: 'muted', style: { marginTop: 0 } }, 'Limits apply to every workspace on the plan, unless a workspace has its own custom limits. Set Stripe price IDs (recurring, per seat) to enable online checkout.'),
    h('div', { class: 'cards' }, cards), h('button', { class: 'btn primary', onclick: save }, 'Save plans'));
}

// ---------- Settings ----------

async function settings() {
  header('Settings');
  const s = await api('GET', '/admin/settings');
  const inp = (key, label, opts = {}) => h('label', { class: 'field' }, h('span', {}, label),
    opts.options ? h('select', { class: 'input', 'data-k': key }, opts.options.map(([v, l]) => h('option', { value: v, selected: (s[key] ?? opts.def) === v }, l)))
      : opts.area ? h('textarea', { class: 'input', 'data-k': key, rows: 2 }, s[key] || '')
        : h('input', { class: 'input', 'data-k': key, type: opts.type || 'text', value: s[key] ?? '', placeholder: opts.ph || '' }),
    opts.help ? h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, opts.help) : null);
  const smtp = s.smtp || {};
  const sm = (k, label, type = 'text', ph = '') => h('label', { class: 'field' }, h('span', {}, label), h('input', { class: 'input', 'data-smtp': k, type, value: smtp[k] ?? '', placeholder: ph }));
  const section = (title, help, ...kids) => h('div', { class: 'card', style: { marginBottom: '12px' } }, h('h3', {}, title), h('div', { class: 'sub' }, help), h('div', { class: 'form-grid' }, ...kids));
  const body = h('div', {},
    section('General', 'Branding and links shown to everyone.', inp('app_name', 'App name'), inp('support_email', 'Support email', { type: 'email' }),
      inp('terms_url', 'Terms of service URL'), inp('privacy_url', 'Privacy policy URL'),
      inp('announcement', 'Announcement banner', { area: true, help: 'Shown at the top of the app for every user. Leave empty to hide.' })),
    section('Sign-up & access', 'Who can create accounts.',
      inp('signup_mode', 'Sign-up', { options: [['open', 'Open to anyone'], ['invite', 'Invitation only'], ['closed', 'Closed']], def: 'open' }),
      inp('signup_domains', 'Allowed email domains', { ph: 'acme.com, acme.co.uk', help: 'Optional. Limits open sign-up to these domains.' }),
      inp('default_plan', 'Plan for new workspaces', { options: Object.entries(s.plan_defaults).map(([k, p]) => [k, p.name]), def: 'free' }),
      inp('max_workspaces_per_user', 'Workspaces a user can own', { type: 'number' })),
    section('Email', 'SiteGround: Site Tools → Email → Accounts. Use the outgoing server details shown there (usually your domain, port 465).',
      sm('host', 'SMTP host', 'text', 'mail.example.com'), sm('port', 'Port', 'number', '465'), sm('user', 'Username', 'text', 'no-reply@example.com'),
      sm('pass', 'Password', 'password'), inp('mail_from', 'From address', { type: 'email' })),
    section('AI', 'Powers summaries, action items, translation and “Ask your notes”. Get a key at console.anthropic.com.',
      inp('anthropic_api_key', 'Anthropic API key', { type: 'password', ph: 'sk-ant-…' }), inp('ai_model', 'Model', { ph: 'claude-opus-5-5 (default)' })),
    section('Stripe', 'For paid plans. Webhook URL: ' + location.origin + '/api/stripe/webhook (events: checkout.session.completed, customer.subscription.*).',
      inp('stripe_secret', 'Secret key', { type: 'password', ph: 'sk_live_…' }), inp('stripe_webhook_secret', 'Webhook signing secret', { type: 'password', ph: 'whsec_…' })),
    h('button', { class: 'btn primary', onclick: async () => {
      const out = {};
      body.querySelectorAll('[data-k]').forEach((el) => { out[el.dataset.k] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value.trim() || null; });
      const smtpOut = {};
      body.querySelectorAll('[data-smtp]').forEach((el) => { if (el.value) smtpOut[el.dataset.smtp] = el.dataset.smtp === 'port' ? Number(el.value) : el.value.trim(); });
      out.smtp = Object.keys(smtpOut).length ? smtpOut : null;
      try { await api('PUT', '/admin/settings', out); toast('Settings saved'); } catch (e) { toast(e.message, { error: true }); }
    } }, 'Save settings'));
  shell.body.replaceChildren(body);
}

// ---------- System ----------

async function system() {
  header('System health', h('button', { class: 'btn', onclick: route }, 'Refresh'));
  const s = await api('GET', '/admin/system');
  const ok = (v, good = 'Ready', bad = 'Not set up') => h('span', { class: 'status ' + (v ? 'ok' : 'warn') }, v ? good : bad);
  const rows = [
    ['PlioPad version', s.version], ['Node.js', s.node], ['Database', s.db], ['Schema version', s.schema],
    ['Uptime', `${s.uptime_h} hours`], ['Memory', `${s.memory_mb} MB`], ['Load average', s.load],
    ['File storage', s.storage_writable ? h('span', { class: 'status ok' }, 'Writable') : h('span', { class: 'status bad' }, 'Not writable')],
    ['Free disk', s.storage_free_gb === null ? 'Unknown' : `${s.storage_free_gb} GB`],
    ['Background jobs', s.jobs_last ? `Last ran ${relTime(s.jobs_last)}` : h('span', { class: 'status warn' }, 'Not run yet')],
    ['Email (SMTP)', ok(s.mail)], ['AI (Claude)', ok(s.ai_ready)], ['Stripe billing', ok(s.stripe)],
    ['App folder', h('code', {}, s.app_dir)],
    ['Data folder', s.data_dir ? h('code', {}, s.data_dir) : h('span', { class: 'status warn' }, 'None: create a folder named pliopad-data next to the app folder')],
    ['Settings file', h('div', {}, h('code', {}, s.config_file), s.config_in_app ? h('div', { class: 'status warn', style: { marginTop: '4px' } }, 'Inside the app folder: a redeploy may remove it. Move it to the data folder.') : null)],
    ['Uploaded files', h('code', {}, s.storage_dir)],
    ['App downloads', h('div', {}, h('code', {}, s.downloads_dir), ...(s.downloads || []).map((d) => h('div', { style: { marginTop: '4px' } }, `${d.name}: `, d.file ? h('code', {}, d.file + (d.version ? ` (v${d.version})` : '')) : h('span', { class: 'status warn' }, 'not found'))))],
  ];
  shell.body.replaceChildren(h('div', { class: 'tbl health' }, h('table', {}, h('tbody', {}, rows.map(([k, v]) => h('tr', { style: { cursor: 'default' } }, h('td', {}, k), h('td', {}, v)))))));
}

// ---------- Maintenance: take the platform offline, and run upkeep tasks ----------

async function maintenance() {
  header('Maintenance');
  const render = (d) => {
    const m = d.mode;
    const msg = h('textarea', { class: 'input', rows: 2, placeholder: 'What people see, e.g. “Upgrading the database. Back by 10 pm.”' }, m?.message || '');
    const local = (t) => { const x = new Date(t); return new Date(x - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
    const until = h('input', { class: 'input', type: 'datetime-local', value: m?.until ? local(m.until) : '' });
    const setMode = async (on) => {
      if (on && !(await confirmBox('Start maintenance?', 'Everyone except platform admins sees the maintenance page. The Windows and Android apps keep working offline and sync afterwards.', { ok: 'Start maintenance', danger: true }))) return;
      try { render(await api('POST', '/admin/maintenance/mode', { on, message: msg.value.trim(), until: until.value ? new Date(until.value).getTime() : null })); toast(on ? 'Maintenance mode is on' : 'PlioPad is back online'); }
      catch (e) { toast(e.message, { error: true }); }
    };
    const modeCard = h('div', { class: 'card', style: { marginBottom: '16px', borderColor: m ? 'var(--warn)' : '' } },
      h('h3', {}, 'Maintenance mode ', h('span', { class: 'status ' + (m ? 'warn' : 'ok') }, m ? 'On: only platform admins can use PlioPad' : 'Off: PlioPad is online')),
      h('div', { class: 'sub' }, m ? `Started ${relTime(m.started_at)}${m.by ? ' by ' + m.by : ''}. You can keep working and test while it is on.` : 'Take PlioPad offline for everyone but platform admins while you upgrade, restore or clean up.'),
      h('label', { class: 'field' }, h('span', {}, 'Message'), msg),
      h('label', { class: 'field' }, h('span', {}, 'Expected back (optional)'), until),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
        m ? [h('button', { class: 'btn primary', onclick: () => setMode(false) }, 'End maintenance'), h('button', { class: 'btn', onclick: () => setMode(true) }, 'Update message')]
          : h('button', { class: 'btn danger', onclick: () => setMode(true) }, 'Start maintenance')));
    const tasks = h('div', { class: 'card' }, h('h3', {}, 'Upkeep tasks'),
      h('div', { class: 'sub' }, 'Safe to run at any time; heavier ones are best run during maintenance. Start with a backup.'),
      h('div', { class: 'tbl' }, h('table', {}, h('tbody', {}, d.tasks.map((t) => {
        const btn = h('button', { class: 'btn sm' }, 'Run');
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = 'Running…';
          try { const r = await api('POST', '/admin/maintenance/run', { task: t.id }); toast(r.result.message, { error: !r.result.ok }); render(r); }
          catch (e) { toast(e.message, { error: true }); btn.disabled = false; btn.textContent = 'Run'; }
        };
        return h('tr', { style: { cursor: 'default' } },
          h('td', {}, h('div', { style: { fontWeight: 600 } }, t.title), h('div', { class: 'sub', style: { margin: 0 } }, t.detail)),
          h('td', { style: { width: '38%' } }, t.last ? h('div', {}, h('span', { class: 'status ' + (t.last.ok ? 'ok' : 'bad') }, relTime(t.last.at)), h('div', { class: 'sub', style: { margin: 0 } }, t.last.message)) : h('span', { class: 'sub' }, 'Not run yet')),
          h('td', { style: { width: '90px', textAlign: 'right' } }, btn));
      })))),
      d.backups.length ? h('div', { class: 'sub', style: { marginTop: '12px' } }, `Backups in pliopad-data/backups: ${d.backups.map((b) => `${b.name} (${Math.round(b.size / 1024).toLocaleString()} KB)`).join(', ')}`) : null);
    shell.body.replaceChildren(modeCard, tasks);
  };
  render(await api('GET', '/admin/maintenance'));
}

boot();
