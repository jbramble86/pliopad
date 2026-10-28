// Platform admin console: overview, tenants, users, audit log, plans, settings and system health. Super admins only.
import { h, icon, toast, confirmBox, promptBox, relTime, fmtDate, debounce, store } from '/app/js/ui.js';
import { state, api, download } from '/app/js/api.js';

const root = document.getElementById('admin');
const theme = store.get('theme', 'system');
if (theme !== 'system') document.documentElement.dataset.theme = theme;

const NAV = [
  ['overview', 'Overview', 'home'], ['tenants', 'Workspaces', 'book'], ['users', 'Users', 'users'], ['audit', 'Audit log', 'history'],
  [null, 'Configuration'], ['plans', 'Plans & billing', 'card'], ['settings', 'Settings', 'gear'], ['system', 'System health', 'shield'],
];
let shell = null;

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
    ...NAV.map(([k, label, ico]) => (k ? h('a', { href: '#/' + k, class: k === active ? 'active' : '', onclick: () => shell.el.classList.remove('nav-open') }, icon(ico), label) : h('div', { class: 'sec' }, label))),
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
    await ({ overview, tenants, users, audit, plans, settings, system }[page] || overview)(arg);
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
    ['Pliopad version', s.version], ['Node.js', s.node], ['Database', s.db], ['Schema version', s.schema],
    ['Uptime', `${s.uptime_h} hours`], ['Memory', `${s.memory_mb} MB`], ['Load average', s.load],
    ['File storage', s.storage_writable ? h('span', { class: 'status ok' }, 'Writable') : h('span', { class: 'status bad' }, 'Not writable')],
    ['Free disk', s.storage_free_gb === null ? 'Unknown' : `${s.storage_free_gb} GB`],
    ['Background jobs', s.jobs_last ? `Last ran ${relTime(s.jobs_last)}` : h('span', { class: 'status warn' }, 'Not run yet')],
    ['Email (SMTP)', ok(s.mail)], ['AI (Claude)', ok(s.ai_ready)], ['Stripe billing', ok(s.stripe)],
  ];
  shell.body.replaceChildren(h('div', { class: 'tbl health' }, h('table', {}, h('tbody', {}, rows.map(([k, v]) => h('tr', { style: { cursor: 'default' } }, h('td', {}, k), h('td', {}, v)))))));
}

boot();
