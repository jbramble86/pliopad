// App shell: hash routing, sidebar (notebooks, page tree, tags), note list, command palette, quick capture and sign-in screens.
import { h, icon, toast, popMenu, modal, promptBox, confirmBox, debounce, relTime, avatar, uuid, store, esc } from './ui.js';
import { state, api, wsApi, setToken, startImpersonation, setUnauthorizedHandler, canWrite, isAdmin, noteMeta, notebook, tag } from './api.js';
import { showNote, closeNote, currentNote } from './note.js';
import { settingsPage, tasksPage, askPage, graphPage } from './pages.js';
import { homePage } from './home.js';

const root = document.getElementById('app');
let shell = null; // { el, side, list, main }
let listSpec = null;
let lastHash = '';

export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
export const currentListHash = () => `#/w/${state.wsId}/${listSpec ? listSpec.type + (listSpec.arg ? '/' + listSpec.arg : '') : 'all'}`;

setUnauthorizedHandler(() => { setToken(null); state.me = null; shell = null; go('#/login'); });

// ---------- Theme ----------
function applyTheme() {
  const t = store.get('theme', 'system');
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}
applyTheme();

// ---------- Router ----------
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const first = parts[0] || '';
  if (first === 'impersonate' && parts[1]) {
    startImpersonation(parts[1]);
    history.replaceState(null, '', '#/'); // keep the token out of the history
    state.me = null;
    shell = null;
    return route();
  }
  if (['login', 'signup', 'forgot'].includes(first)) return authScreen(first);
  if (first === 'reset') return resetScreen(parts[1]);
  if (first === 'invite') return inviteScreen(parts[1]);
  if (!state.token) return go('#/login');
  if (!state.me) {
    try { state.me = await api('GET', '/me'); } catch (e) { if (e.status !== 401) toast(e.message, { error: true }); return; }
  }
  if (first === 'billing') return go(`#/w/${store.get('ws') || state.me.workspaces[0]?.id}/settings/billing`);
  if (first !== 'w' || !parts[1]) {
    const last = store.get('ws');
    const ws = state.me.workspaces.find((w) => w.id === last) || state.me.workspaces[0];
    if (!ws) return noWorkspace();
    return go(`#/w/${ws.id}/home`);
  }
  const wsId = Number(parts[1]);
  if (wsId !== state.wsId || !shell) {
    await closeNote();
    state.wsId = wsId;
    store.set('ws', wsId);
    try { state.boot = await wsApi('GET', '/bootstrap'); } catch (e) {
      toast(e.message, { error: true });
      if (e.status === 403 || e.status === 404) { store.del('ws'); return go('#/'); }
      return;
    }
    buildShell();
  }
  const rest = parts.slice(2);
  const ni = rest.indexOf('n');
  const noteId = ni >= 0 ? rest[ni + 1] : null;
  const listPart = ni >= 0 ? rest.slice(0, ni) : rest;
  const pageTypes = ['home', 'tasks', 'ask', 'graph', 'settings'];
  const [type, arg] = listPart;
  lastHash = location.hash;
  if (!type && !noteId) return go(`#/w/${state.wsId}/home`);

  if (pageTypes.includes(type)) {
    await closeNote();
    setMode('page');
    renderSidebar();
    const main = shell.main;
    main.replaceChildren();
    if (type === 'home') return homePage(main);
    if (type === 'tasks') return tasksPage(main);
    if (type === 'ask') return askPage(main);
    if (type === 'graph') return graphPage(main);
    return settingsPage(main, arg || 'general');
  }
  const spec = type ? { type, arg } : noteId ? null : { type: 'all' };
  if (spec && (!listSpec || spec.type !== listSpec.type || spec.arg !== listSpec.arg)) { listSpec = spec; await renderList(); }
  if (!spec) listSpec = null;
  setMode(spec ? 'list' : 'page', noteId);
  renderSidebar();
  if (noteId) {
    shell.list.querySelectorAll('.note-card').forEach((c) => c.classList.toggle('active', c.dataset.id === noteId));
    await showNote(shell.main, noteId);
  } else {
    await closeNote();
    shell.main.replaceChildren(h('div', { class: 'topbar' }, h('button', { class: 'btn icon mobile-only', onclick: () => setPane('side') }, icon('menu'))),
      h('div', { class: 'empty', style: { marginTop: '12vh' } }, h('div', { class: 'big' }, '🗒️'), h('div', {}, 'Select a note, or'),
        canWrite() ? h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => newInContext() }, icon('plus'), 'New note')) : null,
        h('p', { class: 'muted', style: { marginTop: '18px', fontSize: '13px' } }, h('kbd', {}, 'Ctrl'), ' + ', h('kbd', {}, 'K'), ' to search · ', h('kbd', {}, 'Alt'), ' + ', h('kbd', {}, 'N'), ' for a quick note')));
  }
}

function setMode(mode, noteId) {
  shell.el.classList.toggle('page-mode', mode === 'page');
  setPane(mode === 'page' || noteId ? 'main' : 'list');
}
function setPane(p) { shell.el.dataset.pane = p; }

addEventListener('hashchange', route);

// ---------- Boot data ----------
export async function refreshBoot() {
  try {
    const b = await wsApi('GET', '/bootstrap');
    state.boot = b;
    renderSidebar();
  } catch { /* keep the old data */ }
}

// ---------- Shell ----------
function buildShell() {
  const el = h('div', { class: 'shell' + (store.get('sideCollapsed') ? ' side-collapsed' : '') });
  const side = h('aside', { class: 'side' });
  const list = h('section', { class: 'list' + (store.get('compact') ? ' compact' : '') });
  const main = h('main', { class: 'main' });
  el.append(side, list, main);
  const banner = state.impersonating
    ? h('div', { class: 'banner warn' }, icon('shield'), h('span', { class: 'grow' }, `Support session: you are signed in as ${state.me.user.name} (${state.me.user.email}). Every action is recorded in the audit log.`),
      h('button', { class: 'btn sm', onclick: signOut }, 'End session'))
    : state.me.app.announcement && state.me.app.announcement !== 'null' ? h('div', { class: 'banner' }, '📣 ', state.me.app.announcement) : null;
  root.replaceChildren(...[banner, el].filter(Boolean));
  if (banner) el.style.height = 'calc(100vh - 36px)';
  shell = { el, side, list, main };
  listSpec = null;
  document.title = `${state.boot.workspace.name} · ${state.me.app.name}`;
}

function navItem({ ico, label, href, active, count, onclick, extra, drop, cls = '' }) {
  const el = h(href ? 'a' : 'div', { class: 'nav-item ' + cls + (active ? ' active' : ''), href, onclick },
    h('span', { class: 'ico' }, typeof ico === 'string' && ico.length > 3 ? icon(ico) : ico), h('span', { class: 'grow ellipsis' }, label),
    count ? h('span', { class: 'count' }, count) : null, extra);
  if (drop) {
    el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-pliopad-note')) { e.preventDefault(); el.classList.add('drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { el.classList.remove('drop'); const id = e.dataTransfer.getData('text/x-pliopad-note'); if (id) drop(id); });
  }
  return el;
}

function renderSidebar() {
  if (!shell) return;
  const b = state.boot;
  const base = `#/w/${state.wsId}`;
  const h0 = location.hash;
  const is = (p) => h0 === base + p || h0.startsWith(base + p + '/');
  const live = b.tree.filter((n) => !n.trashed_at);
  const ws = b.workspace;

  const top = h('div', { class: 'side-top' }, h('button', { class: 'ws-switch', onclick: (e) => wsMenu(e.currentTarget) },
    h('span', { class: 'ws-logo' }, ws.name[0]?.toUpperCase() || 'F'), h('span', { class: 'grow ellipsis', style: { fontWeight: 600 } }, ws.name), icon('down')));
  const actions = h('div', { class: 'side-actions' },
    h('button', { class: 'btn search-btn', onclick: () => palette() }, icon('search'), h('span', { class: 'grow', style: { textAlign: 'left' } }, 'Search'), h('kbd', {}, 'Ctrl K')),
    canWrite() ? h('button', { class: 'btn primary', title: 'New (Alt+N)', onclick: (e) => newMenu(e.currentTarget) }, icon('plus')) : null);

  const scroll = h('div', { class: 'side-scroll' });
  const dueReminders = live.filter((n) => n.reminder_at && !n.reminder_done).length;
  scroll.append(h('div', { class: 'nav-sec', style: { marginTop: '4px' } },
    navItem({ ico: 'home', label: 'Home', href: base + '/home', active: is('/home') }),
    navItem({ ico: 'note', label: 'All notes', href: base + '/all', active: is('/all') }),
    navItem({ ico: 'star', label: 'Shortcuts', href: base + '/pinned', active: is('/pinned'), count: live.filter((n) => n.pinned).length || null }),
    navItem({ ico: 'checksq', label: 'Tasks', href: base + '/tasks', active: is('/tasks') }),
    navItem({ ico: 'bell', label: 'Reminders', href: base + '/reminders', active: is('/reminders'), count: dueReminders || null }),
    state.me.ai ? navItem({ ico: 'sparkles', label: 'Ask AI', href: base + '/ask', active: is('/ask') }) : null,
    navItem({ ico: 'graph', label: 'Graph', href: base + '/graph', active: is('/graph') })));

  // Notebooks, grouped into stacks.
  const nbSec = h('div', { class: 'nav-sec' }, h('div', { class: 'nav-head' }, 'Notebooks',
    canWrite() ? h('button', { class: 'btn icon', style: { width: '20px', height: '20px' }, title: 'New notebook or stack', onclick: (e) => popMenu(e.currentTarget, [
      { label: 'New notebook', icon: 'book', run: () => newNotebook() },
      { label: 'New stack…', icon: 'list', run: newStack },
    ]) }, icon('plus')) : null));
  const stacks = {};
  for (const nb of b.notebooks) (stacks[nb.stack || ''] ||= []).push(nb);
  const open = new Set(store.get('open', []));
  const toggle = (key) => { open.has(key) ? open.delete(key) : open.add(key); store.set('open', [...open]); renderSidebar(); };
  // Stacks start expanded so no notebook is hidden; the person can collapse them.
  const closed = new Set(store.get('closedStacks', []));
  const toggleStack = (key) => { closed.has(key) ? closed.delete(key) : closed.add(key); store.set('closedStacks', [...closed]); renderSidebar(); };
  const rowBtn = (ico, title, run) => h('button', { class: 'btn icon hover-btn', style: { width: '22px', height: '22px' }, title,
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); run(e.currentTarget); } }, icon(ico));
  const nbItem = (nb) => {
    const it = navItem({ ico: nb.icon || '📓', label: nb.name, href: `${base}/nb/${nb.id}`, active: is(`/nb/${nb.id}`),
      count: live.filter((n) => n.notebook_id === nb.id && !n.is_template && !isDbRow(n)).length || null,
      extra: canWrite() ? [rowBtn('plus', `New note in ${nb.name}`, () => createNote({ notebook_id: nb.id })), rowBtn('more', 'Notebook options', (a) => notebookMenu(a, nb))] : null,
      drop: (id) => moveNote(id, { notebook_id: nb.id }) });
    if (canWrite()) {
      it.addEventListener('contextmenu', (e) => { e.preventDefault(); notebookMenu(null, nb, e); });
      it.draggable = true; // drag a notebook onto a stack to move it there
      it.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/x-pliopad-notebook', nb.id));
    }
    return it;
  };
  const stackRow = (stack, count) => {
    const key = 'stack:' + stack;
    const isOpen = !closed.has(key);
    const row = navItem({ ico: h('span', { class: 'twisty' + (isOpen ? ' open' : '') }, icon('chevron')), label: stack, onclick: () => toggleStack(key), count,
      extra: canWrite() ? [rowBtn('plus', `New notebook in ${stack}`, () => newNotebook(stack)), rowBtn('more', 'Stack options', (a) => stackMenu(a, stack))] : null });
    if (canWrite()) {
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); stackMenu(null, stack, e); });
      row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-pliopad-notebook')) { e.preventDefault(); row.classList.add('drop'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => { row.classList.remove('drop'); const id = e.dataTransfer.getData('text/x-pliopad-notebook'); if (id) setNotebookStack(id, stack); });
    }
    return [row, isOpen];
  };
  for (const [stack, nbs] of Object.entries(stacks).sort(([a], [b2]) => a.localeCompare(b2))) {
    if (!stack) { nbs.forEach((nb) => nbSec.append(nbItem(nb))); continue; }
    const [row, isOpen] = stackRow(stack, nbs.length);
    nbSec.append(row);
    if (isOpen) nbs.forEach((nb) => { const it = nbItem(nb); it.style.paddingLeft = '22px'; nbSec.append(it); });
  }
  if (!b.notebooks.length && canWrite()) nbSec.append(h('div', { class: 'nav-item', onclick: () => newNotebook() }, h('span', { class: 'ico' }, icon('plus')), h('span', { class: 'muted' }, 'Create a notebook')));
  // Dropping a notebook on the section header takes it out of its stack.
  if (canWrite()) {
    const head = nbSec.firstChild;
    head.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-pliopad-notebook')) { e.preventDefault(); head.classList.add('drop'); } });
    head.addEventListener('dragleave', () => head.classList.remove('drop'));
    head.addEventListener('drop', (e) => { head.classList.remove('drop'); const id = e.dataTransfer.getData('text/x-pliopad-notebook'); if (id) setNotebookStack(id, null); });
  }
  scroll.append(nbSec);

  // Pages: Notion-style tree of pages outside notebooks.
  const pagesSec = h('div', { class: 'nav-sec' }, h('div', { class: 'nav-head' }, 'Pages',
    canWrite() ? h('button', { class: 'btn icon', style: { width: '20px', height: '20px' }, title: 'New page', onclick: () => createNote({ notebook_id: null }) }, icon('plus')) : null));
  const kids = (pid) => live.filter((n) => n.parent_id === pid && !n.is_template).sort((a, c) => a.sort - c.sort || a.updated_at - c.updated_at);
  const curId = (/\/n\/([0-9a-f-]{36})/.exec(h0) || [])[1];
  const treeItem = (n, depth) => {
    const children = noteMeta(n.id)?.kind === 'db' ? [] : kids(n.id);
    const key = 'p:' + n.id;
    const it = navItem({ ico: n.icon || (n.kind === 'db' ? '▦' : '📄'), label: n.title || 'Untitled', href: `${base}/n/${n.id}`, active: curId === n.id,
      extra: canWrite() ? h('button', { class: 'btn icon hover-btn', style: { width: '22px', height: '22px' }, title: 'Add a page inside',
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); open.add(key); store.set('open', [...open]); createNote({ parent_id: n.id, notebook_id: null }); } }, icon('plus')) : null,
      drop: (id) => id !== n.id && moveNote(id, { parent_id: n.id, notebook_id: null }) });
    it.style.paddingLeft = 8 + depth * 14 + 'px';
    it.prepend(h('span', { class: 'twisty' + (open.has(key) ? ' open' : ''), style: { visibility: children.length ? 'visible' : 'hidden' },
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); toggle(key); } }, icon('chevron')));
    it.draggable = true;
    it.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/x-pliopad-note', n.id));
    pagesSec.append(it);
    if (open.has(key)) children.forEach((c) => treeItem(c, depth + 1));
  };
  const topPages = live.filter((n) => !n.notebook_id && !n.parent_id && !n.is_template);
  topPages.forEach((n) => treeItem(n, 0));
  if (!topPages.length) pagesSec.append(h('div', { class: 'muted', style: { padding: '2px 8px', fontSize: '12px' } }, 'Pages without a notebook appear here.'));
  scroll.append(pagesSec);

  if (b.tags.length) {
    const tagSec = h('div', { class: 'nav-sec' }, h('div', { class: 'nav-head' }, 'Tags'));
    b.tags.forEach((t) => tagSec.append(navItem({ ico: h('span', { style: { color: t.color || 'var(--muted)' } }, '#'), label: t.name, href: `${base}/tag/${t.id}`, active: is(`/tag/${t.id}`),
      extra: canWrite() ? h('button', { class: 'btn icon hover-btn', style: { width: '22px', height: '22px' }, onclick: (e) => { e.preventDefault(); e.stopPropagation(); tagMenu(e.currentTarget, t); } }, icon('more')) : null })));
    scroll.append(tagSec);
  }

  const foot = h('div', { class: 'side-foot' },
    navItem({ ico: 'template', label: 'Templates', href: base + '/templates', active: is('/templates') }),
    navItem({ ico: 'globe', label: 'Published', href: base + '/shared', active: is('/shared') }),
    navItem({ ico: 'trash', label: 'Trash', href: base + '/trash', active: is('/trash'), count: b.tree.filter((n) => n.trashed_at).length || null }),
    navItem({ ico: 'gear', label: 'Settings & members', href: base + '/settings/general', active: is('/settings') }),
    navItem({ ico: 'download', label: 'Get the apps', onclick: () => import('./apps.js').then((m) => m.appsDialog()) }));
  shell.side.replaceChildren(top, actions, scroll, foot);
}

const isDbRow = (n) => n.parent_id && noteMeta(n.parent_id)?.kind === 'db';

async function moveNote(id, patch) {
  try {
    await wsApi('PUT', `/notes/${id}`, patch);
    Object.assign(noteMeta(id) || {}, patch);
    toast('Moved');
    renderSidebar();
    renderList();
  } catch (e) { toast(e.message, { error: true }); }
}

function wsMenu(anchor) {
  popMenu(anchor, [
    { head: state.me.user.email },
    ...state.me.workspaces.map((w) => ({ label: w.name, icon: h('span', { class: 'ws-logo', style: { width: '18px', height: '18px', fontSize: '10px' } }, w.name[0]?.toUpperCase()),
      checked: w.id === state.wsId, run: () => { shell = null; go(`#/w/${w.id}/home`); } })),
    { label: 'Create workspace', icon: 'plus', run: async () => {
      const name = await promptBox('Create a workspace', { label: 'Name', placeholder: 'Acme Inc.', ok: 'Create' });
      if (!name) return;
      try { const w = await api('POST', '/workspaces', { name }); state.me = await api('GET', '/me'); shell = null; go(`#/w/${w.id}/home`); } catch (e) { toast(e.message, { error: true }); }
    } },
    '-',
    { label: 'Settings', icon: 'gear', run: () => go(`#/w/${state.wsId}/settings/general`) },
    isAdmin() ? { label: 'Invite members', icon: 'users', run: () => go(`#/w/${state.wsId}/settings/members`) } : null,
    { label: 'Theme', icon: 'sun', sub: ['system', 'light', 'dark'].map((t) => ({ label: t[0].toUpperCase() + t.slice(1), checked: store.get('theme', 'system') === t, run: () => { store.set('theme', t); applyTheme(); } })) },
    { label: 'Keyboard shortcuts', icon: 'more', hint: 'Ctrl+/', run: shortcutsHelp },
    { label: 'Get the desktop & mobile apps', icon: 'download', run: () => import('./apps.js').then((m) => m.appsDialog()) },
    state.me.user.is_super ? { label: 'Admin console', icon: 'shield', run: () => { location.href = '/admin/'; } } : null,
    '-',
    { label: 'Sign out', icon: 'logout', run: signOut },
  ]);
}

async function signOut() {
  await closeNote();
  try { await api('POST', '/auth/logout', {}); } catch { /* already signed out */ }
  setToken(null);
  state.me = null;
  shell = null;
  go('#/login');
}

function newMenu(anchor) {
  popMenu(anchor, [
    { label: 'Note', icon: 'note', hint: 'Alt+N', run: () => newInContext() },
    { label: 'Quick capture', icon: 'inbox', hint: 'Alt+Q', run: quickCapture },
    { label: 'Page', icon: 'page', run: () => createNote({ notebook_id: null }) },
    { label: 'Database', icon: 'table', run: () => createNote({ notebook_id: null, database: true }) },
    { label: 'Daily note', icon: 'calendar', hint: 'Alt+D', run: dailyNote },
    templatesSub(),
    '-',
    { label: 'Notebook', icon: 'book', run: newNotebook },
    { label: 'Import (Evernote, Markdown)', icon: 'upload', run: () => go(`#/w/${state.wsId}/settings/import`) },
  ]);
}

function templatesSub() {
  const tpls = state.boot.tree.filter((n) => n.is_template && !n.trashed_at);
  if (!tpls.length) return null;
  return { label: 'From template', icon: 'template', sub: tpls.map((t) => ({ label: `${t.icon || '📄'} ${t.title || 'Untitled'}`, run: () => fromTemplate(t.id) })) };
}

async function fromTemplate(id) {
  try {
    const nb = listSpec?.type === 'nb' ? listSpec.arg : defaultNotebook();
    const c = await wsApi('POST', `/notes/${id}/duplicate`, { from_template: true, notebook_id: nb, parent_id: null });
    await wsApi('PUT', `/notes/${c.id}`, { is_template: false, title: `${c.title} ${new Date().toLocaleDateString()}` });
    await refreshBoot();
    openCreated(c.id);
  } catch (e) { toast(e.message, { error: true }); }
}

function defaultNotebook() {
  const nbs = state.boot.notebooks;
  return (nbs.find((n) => n.name.toLowerCase() === 'inbox') || nbs[0])?.id || null;
}

function newInContext() {
  const s = listSpec || {};
  createNote({ notebook_id: s.type === 'nb' ? s.arg : defaultNotebook(), tags: s.type === 'tag' ? [s.arg] : [], pinned: s.type === 'pinned' });
}

/** Creates a note and (by default) opens it. Returns the saved note. */
export async function createNote({ title = '', notebook_id, parent_id = null, database = false, tags = [], pinned = false, content, open = true } = {}) {
  if (!canWrite()) return null;
  const id = uuid();
  const body = { title, notebook_id: notebook_id === undefined ? defaultNotebook() : notebook_id, parent_id, tags, pinned };
  if (content) body.content = content;
  if (database) Object.assign(body, { kind: 'db', title: title || '', db_schema: {
    props: [{ id: 'status', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'Not started', color: 'gray' }, { id: 'doing', name: 'In progress', color: 'blue' }, { id: 'done', name: 'Done', color: 'green' }] },
      { id: 'date', name: 'Date', type: 'date' }, { id: 'owner', name: 'Owner', type: 'person' }],
    views: [{ id: 'v1', name: 'Table', type: 'table' }, { id: 'v2', name: 'Board', type: 'board', group: 'status' }, { id: 'v3', name: 'Calendar', type: 'calendar', date: 'date' }] } });
  try {
    const n = await wsApi('PUT', `/notes/${id}`, body);
    state.boot.tree.push({ id, notebook_id: n.notebook_id, parent_id, kind: n.kind, title: n.title, icon: n.icon, pinned: n.pinned, sort: 0, updated_at: n.updated_at });
    renderSidebar();
    if (open) openCreated(id);
    return n;
  } catch (e) { toast(e.message, { error: true }); return null; }
}

function openCreated(id) {
  const meta = noteMeta(id);
  const inList = listSpec && (listSpec.type === 'all' || (listSpec.type === 'nb' && meta?.notebook_id === listSpec.arg) || listSpec.type === 'tag' || listSpec.type === 'pinned');
  if (inList && meta?.notebook_id) { renderList(); go(`${currentListHash()}/n/${id}`); } else go(`#/w/${state.wsId}/n/${id}`);
}

async function newNotebook(stack = null) {
  const name = await promptBox(stack ? `New notebook in ${stack}` : 'New notebook', { label: 'Name', placeholder: 'Meeting notes', ok: 'Create' });
  if (!name) return;
  const id = uuid();
  try {
    const nb = await wsApi('PUT', `/notebooks/${id}`, { name, icon: '📓', stack, sort: state.boot.notebooks.length });
    state.boot.notebooks.push(nb);
    go(`#/w/${state.wsId}/nb/${id}`);
  } catch (e) { toast(e.message, { error: true }); }
}

// ---------- Stacks (groups of notebooks; a stack exists while at least one notebook is in it) ----------
const stackNames = () => [...new Set(state.boot.notebooks.map((n) => n.stack).filter(Boolean))].sort((a, b) => a.localeCompare(b));

async function setNotebookStack(id, stack) {
  const nb = notebook(id);
  if (!nb || (nb.stack || null) === (stack || null)) return;
  try {
    Object.assign(nb, await wsApi('PUT', `/notebooks/${id}`, { stack: stack || null }));
    toast(stack ? `Moved “${nb.name}” to ${stack}` : `Removed “${nb.name}” from its stack`);
    renderSidebar();
  } catch (e) { toast(e.message, { error: true }); }
}

/** Lets the person pick notebooks with checkboxes, e.g. to put them into a stack. */
function pickNotebooks(title, candidates, okLabel) {
  return new Promise((resolve) => {
    if (!candidates.length) { toast('There are no other notebooks to add.'); return resolve(null); }
    let done = false;
    const boxes = candidates.map((nb) => ({ nb, box: h('input', { type: 'checkbox' }) }));
    modal(title, h('div', {}, boxes.map(({ nb, box }) => h('label', { class: 'row', style: { padding: '6px 0', cursor: 'pointer' } }, box,
      h('span', {}, `${nb.icon || '📓'} ${nb.name}`), nb.stack ? h('span', { class: 'muted', style: { fontSize: '12px' } }, `in ${nb.stack}`) : null))), {
      actions: [{ label: 'Cancel', run: () => { done = true; resolve(null); } },
        { label: okLabel, primary: true, run: () => { done = true; resolve(boxes.filter((b) => b.box.checked).map((b) => b.nb)); } }],
      onClose: () => !done && resolve(null),
    });
  });
}

async function newStack() {
  const name = await promptBox('New stack', { label: 'Stack name', placeholder: 'Work', ok: 'Next' });
  if (!name) return;
  const picked = await pickNotebooks(`Add notebooks to “${name}”`, state.boot.notebooks, 'Create stack');
  if (!picked) return;
  if (!picked.length) {
    // A stack needs a notebook in it; offer to create the first one.
    return newNotebook(name);
  }
  for (const nb of picked) await setNotebookStack(nb.id, name);
}

function stackMenu(anchor, stack, ev) {
  const members = state.boot.notebooks.filter((n) => n.stack === stack);
  popMenu(anchor, [
    { head: stack },
    { label: 'New notebook in this stack', icon: 'plus', run: () => newNotebook(stack) },
    { label: 'Add notebooks…', icon: 'book', run: async () => {
      const picked = await pickNotebooks(`Add notebooks to “${stack}”`, state.boot.notebooks.filter((n) => n.stack !== stack), 'Add');
      for (const nb of picked || []) await setNotebookStack(nb.id, stack);
    } },
    { label: 'Remove notebooks…', icon: 'x', run: async () => {
      const picked = await pickNotebooks(`Remove notebooks from “${stack}”`, members, 'Remove');
      for (const nb of picked || []) await setNotebookStack(nb.id, null);
    } },
    { label: 'Rename stack', icon: 'note', run: async () => {
      const name = await promptBox('Rename stack', { value: stack, ok: 'Rename' });
      if (!name || name === stack) return;
      for (const nb of members) await setNotebookStack(nb.id, name);
    } },
    '-',
    { label: 'Ungroup stack', icon: 'trash', danger: true, run: async () => {
      if (!(await confirmBox('Ungroup stack?', `The ${members.length} notebook${members.length === 1 ? '' : 's'} in “${stack}” are kept and shown on their own.`, { ok: 'Ungroup' }))) return;
      for (const nb of members) await setNotebookStack(nb.id, null);
    } },
  ], ev ? { x: ev.clientX, y: ev.clientY } : {});
}

function notebookMenu(anchor, nb, ev) {
  const upd = async (patch) => { try { Object.assign(nb, await wsApi('PUT', `/notebooks/${nb.id}`, patch)); renderSidebar(); renderList(); } catch (e) { toast(e.message, { error: true }); } };
  const stacks = stackNames().filter((s) => s !== nb.stack);
  popMenu(anchor, [
    { label: 'New note here', icon: 'plus', run: () => createNote({ notebook_id: nb.id }) },
    '-',
    { label: 'Rename', icon: 'note', run: async () => { const n = await promptBox('Rename notebook', { value: nb.name }); if (n) upd({ name: n }); } },
    { label: 'Change icon', icon: 'star', run: () => import('./ui.js').then(({ emojiPicker }) => emojiPicker(anchor || document.querySelector('.side-scroll'), (e) => upd({ icon: e || '📓' }))) },
    { label: 'Move to stack', icon: 'list', sub: [
      ...stacks.map((s) => ({ label: s, run: () => setNotebookStack(nb.id, s) })),
      stacks.length ? '-' : null,
      { label: 'New stack…', icon: 'plus', run: async () => { const s = await promptBox('New stack', { label: 'Stack name', placeholder: 'Work', ok: 'Move' }); if (s) setNotebookStack(nb.id, s); } },
      nb.stack ? { label: 'Remove from stack', icon: 'x', run: () => setNotebookStack(nb.id, null) } : null,
    ] },
    '-',
    { label: 'Delete notebook', icon: 'trash', danger: true, run: async () => {
      if (!(await confirmBox('Delete notebook?', `“${nb.name}” will be deleted and its notes moved to the trash (restorable for 30 days).`, { ok: 'Delete', danger: true }))) return;
      await wsApi('DELETE', `/notebooks/${nb.id}`);
      await refreshBoot();
      go(`#/w/${state.wsId}/all`);
    } },
  ], ev ? { x: ev.clientX, y: ev.clientY } : {});
}

function tagMenu(anchor, t) {
  popMenu(anchor, [
    { label: 'Rename', icon: 'note', run: async () => { const n = await promptBox('Rename tag', { value: t.name }); if (n) { await wsApi('PUT', `/tags/${t.id}`, { name: n, color: t.color }); refreshBoot(); } } },
    { label: 'Color', icon: 'sun', sub: ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#71717a'].map((c) => ({ label: h('span', { style: { color: c } }, '● ' + c), run: async () => { await wsApi('PUT', `/tags/${t.id}`, { name: t.name, color: c }); refreshBoot(); } })) },
    { label: 'Delete tag', icon: 'trash', danger: true, run: async () => { await wsApi('DELETE', `/tags/${t.id}`); await refreshBoot(); go(`#/w/${state.wsId}/all`); } },
  ]);
}

// ---------- Note list ----------
const LIST_TITLES = { all: ['All notes', 'note'], pinned: ['Shortcuts', 'star'], reminders: ['Reminders', 'bell'], trash: ['Trash', 'trash'], templates: ['Templates', 'template'], shared: ['Published pages', 'globe'] };

export async function renderList() {
  if (!shell || !listSpec) return;
  const s = listSpec;
  const sortKey = store.get('sort:' + s.type, s.type === 'reminders' ? 'reminder' : 'updated');
  const q = new URLSearchParams({ sort: sortKey });
  let title;
  let ico;
  if (s.type === 'nb') { const nb = notebook(s.arg); title = nb?.name || 'Notebook'; ico = nb?.icon || '📓'; q.set('notebook', s.arg); }
  else if (s.type === 'tag') { title = '#' + (tag(s.arg)?.name || 'tag'); ico = 'tag'; q.set('tag', s.arg); }
  else {
    [title, ico] = LIST_TITLES[s.type] || LIST_TITLES.all;
    if (s.type === 'pinned') q.set('pinned', 1);
    if (s.type === 'trash') q.set('trash', 1);
    if (s.type === 'templates') q.set('templates', 1);
    if (s.type === 'reminders') q.set('reminders', 1);
    if (s.type === 'shared') q.set('shared', 1);
  }
  const scroll = h('div', { class: 'list-scroll' }, h('div', { class: 'empty' }, 'Loading…'));
  const compact = shell.list.classList.contains('compact');
  shell.list.replaceChildren(h('div', { class: 'list-head' },
    h('h2', {}, h('button', { class: 'btn icon mobile-only', onclick: () => setPane('side') }, icon('menu')),
      typeof ico === 'string' && ico.length > 3 ? icon(ico) : ico, h('span', { class: 'grow ellipsis' }, title),
      canWrite() && s.type !== 'trash' ? h('button', { class: 'btn sm', onclick: () => (s.type === 'templates' ? createTemplate() : newInContext()) }, icon('plus'), 'New') : null,
      canWrite() && s.type === 'nb' && notebook(s.arg) ? h('button', { class: 'btn icon', title: 'Notebook options', onclick: (e) => notebookMenu(e.currentTarget, notebook(s.arg)) }, icon('more')) : null,
      canWrite() && s.type === 'tag' && tag(s.arg) ? h('button', { class: 'btn icon', title: 'Tag options', onclick: (e) => tagMenu(e.currentTarget, tag(s.arg)) }, icon('more')) : null),
    h('div', { class: 'list-tools' }, h('span', { class: 'count grow' }, ''),
      h('button', { class: 'btn sm', style: { borderColor: 'transparent' }, onclick: (e) => popMenu(e.currentTarget, [
        ['updated', 'Date updated'], ['created', 'Date created'], ['title', 'Title'], ['reminder', 'Reminder date']].map(([k, l]) => ({ label: l, checked: sortKey === k,
        run: () => { store.set('sort:' + s.type, k); renderList(); } })), { align: 'right' }) }, 'Sort ', icon('down')),
      h('button', { class: 'btn icon', title: compact ? 'Show snippets' : 'Compact list', onclick: () => { shell.list.classList.toggle('compact'); store.set('compact', shell.list.classList.contains('compact')); renderList(); } }, icon(compact ? 'note' : 'list')),
      s.type === 'trash' && isAdmin() ? h('button', { class: 'btn sm danger', onclick: emptyTrash }, 'Empty') : null)), scroll);
  let notes;
  try { notes = await wsApi('GET', '/notes?' + q); } catch (e) { scroll.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
  if (listSpec !== s) return;
  shell.list.querySelector('.count').textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
  if (!notes.length) {
    scroll.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'big' }, { trash: '🗑️', pinned: '⭐', reminders: '⏰', templates: '🧩', shared: '🌐' }[s.type] || '📝'),
      { trash: 'Trash is empty.', pinned: 'Star a note to add it to your shortcuts.', reminders: 'No reminders. Add one from a note’s ⋯ menu.',
        templates: 'Save any page as a template from its ⋯ menu.', shared: 'Nothing is published yet. Use Share → Publish on any page.' }[s.type] || 'No notes here yet.'));
    return;
  }
  const curId = (/\/n\/([0-9a-f-]{36})/.exec(location.hash) || [])[1];
  scroll.replaceChildren(...notes.map((n) => {
    const card = h('a', { class: 'note-card' + (n.id === curId ? ' active' : ''), 'data-id': n.id, href: `${currentListHash()}/n/${n.id}`, draggable: 'true',
      ondragstart: (e) => e.dataTransfer.setData('text/x-pliopad-note', n.id) },
    h('div', { class: 'grow' },
      h('h3', { class: 'ellipsis' }, (n.icon ? n.icon + ' ' : '') + (n.title || 'Untitled')),
      h('p', {}, n.kind === 'db' ? 'Database' : n.snippet || h('span', { style: { fontStyle: 'italic' } }, 'Empty note')),
      h('div', { class: 'meta' }, n.pinned ? icon('star') : null, s.type === 'reminders' && n.reminder_at ? h('span', { class: 'badge' + (n.reminder_at < Date.now() && !n.reminder_done ? ' accent' : '') }, '⏰ ' + new Date(n.reminder_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })) : relTime(n.updated_at),
        s.type !== 'nb' && notebook(n.notebook_id) ? h('span', {}, '· ' + notebook(n.notebook_id).name) : null,
        n.share_slug ? icon('globe') : null,
        (n.tags || []).slice(0, 3).map((id) => tag(id) && h('span', { class: 'chip' }, '#' + tag(id).name)))),
    n.thumb ? h('img', { class: 'thumb', src: n.thumb, alt: '', loading: 'lazy' }) : null);
    return card;
  }));
}

export const refreshList = () => renderList();

async function emptyTrash() {
  if (!(await confirmBox('Empty trash?', 'Everything in the trash will be permanently deleted.', { ok: 'Empty trash', danger: true }))) return;
  const r = await wsApi('POST', '/trash/empty', {});
  toast(`Deleted ${r.deleted} notes`);
  await refreshBoot();
  renderList();
}

async function createTemplate() {
  const n = await createNote({ title: 'New template', notebook_id: null, open: false });
  if (!n) return;
  await wsApi('PUT', `/notes/${n.id}`, { is_template: true });
  await refreshBoot();
  renderList();
  go(`#/w/${state.wsId}/templates/n/${n.id}`);
}

// ---------- Quick capture & daily note ----------
export function quickCapture() {
  if (!canWrite()) return;
  const ta = h('textarea', { class: 'input', rows: 7, placeholder: 'Write anything. The first line becomes the title.\n\n- [ ] Lists and to-dos work too' });
  const nbSel = h('select', { class: 'input', style: { width: 'auto' } }, state.boot.notebooks.map((nb) => h('option', { value: nb.id, selected: nb.id === defaultNotebook() }, nb.name)));
  const save = async () => {
    const text = ta.value.trim();
    if (!text) return false;
    const [first, ...rest] = text.split('\n');
    const { markdownToBlocks } = await import('./editor.js');
    await createNote({ title: first.replace(/^#+\s*/, '').slice(0, 200), notebook_id: nbSel.value, content: markdownToBlocks(rest.join('\n')), open: false });
    toast('Saved to ' + (notebook(nbSel.value)?.name || 'notes'));
    renderList();
  };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { save(); m.close(); } });
  const m = modal('Quick capture', h('div', {}, ta, h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'muted' }, 'Save to'), nbSel, h('span', { class: 'grow' }), h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Ctrl+Enter'))),
    { actions: [{ label: 'Cancel' }, { label: 'Save note', primary: true, run: save }] });
}

export async function dailyNote() {
  const title = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const existing = state.boot.tree.find((n) => n.title === title && !n.trashed_at);
  if (existing) return go(`#/w/${state.wsId}/n/${existing.id}`);
  let journal = state.boot.notebooks.find((n) => n.name === 'Journal');
  if (!journal) {
    journal = await wsApi('PUT', `/notebooks/${uuid()}`, { name: 'Journal', icon: '📔', sort: 99 });
    state.boot.notebooks.push(journal);
  }
  const { markdownToBlocks } = await import('./editor.js');
  await createNote({ title, notebook_id: journal.id, content: markdownToBlocks('## Top 3 today\n- [ ] \n## Notes\n\n## Wins'), open: true });
}

// ---------- Command palette ----------
export function palette() {
  const input = h('input', { placeholder: 'Search notes, or type a command…  (try tag:, notebook:, is:todo)' });
  const results = h('div', { class: 'results' });
  let items = [];
  let sel = 0;
  const base = `#/w/${state.wsId}`;
  const commands = [
    canWrite() && { t: 'New note', s: 'Alt+N', ico: '📝', run: newInContext },
    canWrite() && { t: 'Quick capture', s: 'Alt+Q', ico: '⚡', run: quickCapture },
    canWrite() && { t: 'New page', ico: '📄', run: () => createNote({ notebook_id: null }) },
    canWrite() && { t: 'New database', ico: '▦', run: () => createNote({ notebook_id: null, database: true }) },
    canWrite() && { t: "Today's daily note", s: 'Alt+D', ico: '📅', run: dailyNote },
    { t: 'Tasks across all notes', ico: '☑', run: () => go(base + '/tasks') },
    state.me.ai && { t: 'Ask AI about your notes', ico: '✨', run: () => go(base + '/ask') },
    { t: 'Graph view', ico: '🕸', run: () => go(base + '/graph') },
    { t: 'Settings', ico: '⚙️', run: () => go(base + '/settings/general') },
    { t: 'Toggle dark mode', ico: '🌓', run: () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); store.set('theme', cur === 'dark' ? 'light' : 'dark'); applyTheme(); } },
  ].filter(Boolean);
  const draw = () => {
    results.replaceChildren(...items.map((it, i) => h('div', { class: 'res' + (i === sel ? ' sel' : ''), onmousedown: (e) => { e.preventDefault(); pick(i); } },
      h('span', { style: { width: '20px', textAlign: 'center' } }, it.ico || '📄'),
      h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 't ellipsis' }, it.t), it.sub ? h('div', { class: 's ellipsis' }, it.sub) : null),
      it.s ? h('span', { class: 's' }, it.s) : null)));
    results.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  };
  const noteItem = (n, sub) => ({ t: n.title || 'Untitled', ico: n.icon || (n.kind === 'db' ? '▦' : '📄'), sub, run: () => go(`${base}/n/${n.id}`) });
  const local = (q) => {
    const ql = q.toLowerCase();
    const live = state.boot.tree.filter((n) => !n.trashed_at);
    const notes = q ? live.filter((n) => (n.title || 'untitled').toLowerCase().includes(ql)) : [...live].sort((a, b) => b.updated_at - a.updated_at);
    const cmds = q ? commands.filter((c) => c.t.toLowerCase().includes(ql)) : commands.slice(0, 5);
    items = [...notes.slice(0, 8).map((n) => noteItem(n, notebook(n.notebook_id)?.name || (q ? '' : 'Recent'))), ...cmds];
    if (q && state.me.ai) items.push({ t: `Ask AI: “${q}”`, ico: '✨', run: () => { store.set('askq', q); go(base + '/ask'); } });
    sel = 0;
    draw();
  };
  const remote = debounce(async (q) => {
    if (!q || q.length < 2) return;
    try {
      const found = await wsApi('GET', `/search?q=${encodeURIComponent(q)}&limit=20`);
      if (input.value.trim() !== q) return;
      const seen = new Set(items.map((i) => i.id));
      const extra = found.filter((n) => !seen.has(n.id)).map((n) => ({ ...noteItem(n, n.hit || n.snippet), id: n.id }));
      const titleHits = items.filter((i) => !i.s && i.run && !i.id);
      items = [...extra.slice(0, 15), ...items.filter((i) => !titleHits.includes(i) || !found.some((f) => f.title === i.t))];
      draw();
    } catch { /* keep local results */ }
  }, 180);
  const pick = (i) => { const it = items[i]; if (!it) return; m.close(); it.run(); };
  input.addEventListener('input', () => { const q = input.value.trim(); local(q); remote(q); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
  });
  const box = h('div', { class: 'modal palette' }, input, results, h('div', { class: 'tips' }, 'Operators: tag:work  notebook:inbox  is:todo  has:image  updated:7d  intitle:plan  -exclude  "exact phrase"'));
  const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) m.close(); } }, box);
  const m = { close: () => { ov.remove(); document.removeEventListener('keydown', esc1); } };
  const esc1 = (e) => { if (e.key === 'Escape') m.close(); };
  document.addEventListener('keydown', esc1);
  document.body.append(ov);
  local('');
  input.focus();
}

function shortcutsHelp() {
  const rows = [['Ctrl K', 'Search and commands'], ['Alt N', 'New note'], ['Alt Q', 'Quick capture'], ['Alt D', 'Daily note'], ['Ctrl \\', 'Toggle sidebar'],
    ['/', 'Insert a block'], ['[[', 'Link to a page'], ['Ctrl B / I / E', 'Bold / italic / code'], ['Ctrl K (in text)', 'Add link'], ['Ctrl Enter', 'Check a to-do'],
    ['Tab / Shift Tab', 'Indent / outdent'], ['Alt Shift ↑ ↓', 'Move block'], ['# ## ###', 'Headings'], ['- or *', 'Bulleted list'], ['[] ', 'To-do'], ['> ', 'Quote'], ['```', 'Code block'], ['---', 'Divider']];
  modal('Keyboard shortcuts', h('table', { class: 'grid' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))));
}

document.addEventListener('keydown', (e) => {
  if (!shell || document.querySelector('.overlay')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k' && !e.target.closest?.('.blk-text')) { e.preventDefault(); palette(); }
  else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); palette(); }
  else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newInContext(); }
  else if (e.altKey && e.key.toLowerCase() === 'q') { e.preventDefault(); quickCapture(); }
  else if (e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); dailyNote(); }
  else if (mod && e.key === '\\') { e.preventDefault(); shell.el.classList.toggle('side-collapsed'); store.set('sideCollapsed', shell.el.classList.contains('side-collapsed')); }
  else if (mod && e.key === '/') { e.preventDefault(); shortcutsHelp(); }
});

// ---------- Auth screens ----------
function authCard(title, sub, body, foot) {
  root.replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), state.appName || 'PlioPad'),
    h('h1', {}, title), h('p', { class: 'sub' }, sub), body, foot ? h('div', { class: 'auth-foot' }, foot) : null)));
  setTimeout(() => root.querySelector('input')?.focus(), 30);
}

function form(fields, submitLabel, onSubmit) {
  const err = h('div', { class: 'form-error hidden' });
  const btn = h('button', { class: 'btn primary', style: { width: '100%', height: '38px' }, type: 'submit' }, submitLabel);
  const f = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    btn.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(f)), err); } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); } finally { btn.disabled = false; }
  } }, err, fields.map(([name, label, type = 'text', extra = {}]) => h('label', { class: 'field' + (extra.hidden ? ' hidden' : ''), 'data-f': name }, h('span', {}, label),
    h('input', { class: 'input', name, type, required: extra.optional ? null : true, autocomplete: extra.ac, minLength: extra.min, value: extra.value || '', placeholder: extra.ph }))), btn);
  return f;
}

async function afterAuth(r) {
  setToken(r.token);
  state.me = r;
  shell = null;
  const ws = r.workspaces[0];
  go(ws ? `#/w/${ws.id}/all` : '#/');
}

async function authScreen(kind) {
  if (state.token && kind !== 'forgot') { try { state.me ||= await api('GET', '/me'); return go('#/'); } catch { /* show the form */ } }
  try { const c = await api('GET', '/config'); state.appName = c.app_name; state.signupMode = c.signup_mode; } catch { /* defaults */ }
  if (kind === 'login') {
    const f = form([['email', 'Email', 'email', { ac: 'email' }], ['password', 'Password', 'password', { ac: 'current-password' }],
      ['code', 'Authentication code', 'text', { optional: true, hidden: true, ac: 'one-time-code', ph: '123456' }]], 'Sign in', async (v, err) => {
      try { await afterAuth(await api('POST', '/auth/login', { ...v, device: 'web' })); } catch (e) {
        if (e.code === 'mfa') { f.querySelector('[data-f="code"]').classList.remove('hidden'); f.querySelector('[name="code"]').focus(); }
        throw e;
      }
    });
    return authCard('Welcome back', 'Sign in to your workspace.', f,
      [h('a', { href: '#/forgot' }, 'Forgot password?'), state.signupMode !== 'closed' ? [' · ', h('a', { href: '#/signup' }, 'Create an account')] : null]);
  }
  if (kind === 'signup') {
    const invite = store.get('invite');
    const f = form([['name', 'Your name', 'text', { ac: 'name' }], ['email', 'Work email', 'email', { ac: 'email' }], ['password', 'Password (10+ characters)', 'password', { ac: 'new-password', min: 10 }],
      ...(invite ? [] : [['workspace', 'Workspace name', 'text', { optional: true, ph: 'Acme Inc.' }]])], 'Create account', async (v) => {
      const r = await api('POST', '/auth/signup', { ...v, invite, device: 'web' });
      store.del('invite');
      await afterAuth(r);
    });
    return authCard(invite ? 'Join your team' : 'Create your workspace', 'Notes, docs and databases in one place. Free to start.', f, ['Already have an account? ', h('a', { href: '#/login' }, 'Sign in')]);
  }
  const f = form([['email', 'Email', 'email']], 'Send reset link', async (v) => {
    await api('POST', '/auth/forgot', v);
    f.replaceWith(h('p', {}, 'If that email has an account, a reset link is on its way. Check your inbox.'));
  });
  authCard('Reset your password', 'We will email you a link to choose a new password.', f, h('a', { href: '#/login' }, 'Back to sign in'));
}

function resetScreen(token) {
  const f = form([['password', 'New password (10+ characters)', 'password', { min: 10, ac: 'new-password' }]], 'Save password', async (v) => {
    await api('POST', '/auth/reset', { token, password: v.password });
    toast('Password changed. Sign in with your new password.');
    go('#/login');
  });
  authCard('Choose a new password', 'You will be signed out on all devices.', f);
}

async function inviteScreen(token) {
  try {
    const inv = await api('GET', `/invites/${token}`);
    if (state.token) {
      const body = h('div', {}, h('button', { class: 'btn primary', style: { width: '100%' }, onclick: async () => { state.me = await api('POST', `/invites/${token}/accept`, {}); shell = null; const w = state.me.workspaces.find((x) => x.name === inv.workspace) || state.me.workspaces.at(-1); go(`#/w/${w.id}/home`); } }, `Join ${inv.workspace}`));
      return authCard(`Join ${inv.workspace}`, `You were invited as ${inv.role}.`, body);
    }
    store.set('invite', token);
    go(inv.has_account ? '#/login' : '#/signup');
    if (inv.has_account) toast(`Sign in to join ${inv.workspace}`);
  } catch (e) { authCard('Invitation unavailable', e.message, h('a', { class: 'btn', href: '#/login' }, 'Go to sign in')); }
}

function noWorkspace() {
  authCard('No workspace yet', 'Create a workspace to get started.', form([['name', 'Workspace name']], 'Create workspace', async (v) => {
    const w = await api('POST', '/workspaces', v);
    state.me = await api('GET', '/me');
    go(`#/w/${w.id}/home`);
  }), h('a', { href: '#', onclick: (e) => { e.preventDefault(); signOut(); } }, 'Sign out'));
}

// Accept pending invites after signing in.
addEventListener('hashchange', async () => {
  const inv = store.get('invite');
  if (inv && state.token && state.me && !location.hash.startsWith('#/signup')) {
    store.del('invite');
    try { state.me = await api('POST', `/invites/${inv}/accept`, {}); shell = null; toast('You joined a new workspace'); route(); } catch { /* invite already used */ }
  }
});

route();
