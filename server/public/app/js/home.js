// Home: an Evernote-style dashboard of widgets (recent notes, scratch pad, tasks, shortcuts, reminders, notebooks),
// laid out and styled like a Notion page.
import { h, icon, toast, debounce, relTime, store, uuid } from './ui.js';
import { state, wsApi, canWrite, noteMeta, notebook } from './api.js';
import { go, createNote, quickCapture, dailyNote, palette } from './main.js';
import { markdownToBlocks } from './editor.js';

const WIDGETS = [
  ['recent', 'Recently visited'], ['scratch', 'Scratch pad'], ['tasks', 'Tasks'], ['shortcuts', 'Shortcuts'],
  ['reminders', 'Reminders'], ['notebooks', 'Notebooks'], ['updated', 'Recently edited'],
];
const SCRATCH_TITLE = 'Scratch pad';

/** Remembers that a note was opened, for the "Recently visited" row. */
export function trackVisit(id) {
  const key = 'recent:' + state.wsId;
  store.set(key, [id, ...store.get(key, []).filter((x) => x !== id)].slice(0, 24));
}

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Good evening' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

const live = () => state.boot.tree.filter((n) => !n.trashed_at && !n.is_template);
const open = (id) => go(`#/w/${state.wsId}/n/${id}`);
const label = (n) => n.title || 'Untitled';
const ico = (n) => n.icon || (n.kind === 'db' ? '▦' : '📄');

function section(key, title, iconName, body, action) {
  return h('section', { class: 'hw', 'data-w': key },
    h('div', { class: 'hw-head' }, icon(iconName), h('span', { class: 'grow' }, title), action || null),
    body);
}

function row(n, meta, onclick) {
  return h('a', { class: 'hw-row', href: `#/w/${state.wsId}/n/${n.id}`, onclick },
    h('span', { class: 'hw-ico' }, ico(n)), h('span', { class: 'grow ellipsis' }, label(n)), meta ? h('span', { class: 'hw-meta' }, meta) : null);
}

function empty(text) { return h('div', { class: 'hw-empty' }, text); }

export async function homePage(main) {
  const hidden = new Set(store.get('homeHidden', []));
  const notes = live();
  const name = (state.me.user.name || '').split(' ')[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // ---- Recently visited: cards like Notion's home ----
  const visited = store.get('recent:' + state.wsId, []).map(noteMeta).filter((n) => n && !n.trashed_at);
  const recent = [...visited, ...[...notes].sort((a, b) => b.updated_at - a.updated_at).filter((n) => !visited.includes(n))].slice(0, 10);
  const recentRow = h('div', { class: 'hw-cards' },
    recent.map((n) => h('a', { class: 'hw-card', href: `#/w/${state.wsId}/n/${n.id}` },
      h('div', { class: 'hw-card-top' }), h('div', { class: 'hw-card-ico' }, ico(n)),
      h('div', { class: 'hw-card-title' }, label(n)), h('div', { class: 'hw-card-meta' }, relTime(n.updated_at)))));

  // ---- Scratch pad: a real note, so it syncs to the phone and works offline there ----
  const scratchBox = h('textarea', { class: 'hw-scratch', placeholder: 'Jot something down…  It saves as you type and syncs to your phone.', disabled: !canWrite() });
  let scratchId = notes.find((n) => n.title === SCRATCH_TITLE)?.id || null;
  let scratchVersion = null;
  (async () => {
    if (!scratchId) return;
    try {
      const n = await wsApi('GET', `/notes/${scratchId}`);
      scratchVersion = n;
      scratchBox.value = blocksToText(n.content);
    } catch { /* show empty */ }
  })();
  const saveScratch = debounce(async () => {
    // Reuse block ids line by line, so edits from the phone and the web merge instead of replacing each other.
    const old = scratchVersion?.content || [];
    const blocks = markdownToBlocks(scratchBox.value).map((b, i) => (old[i] ? { ...b, id: old[i].id, u: old[i].t === b.t && old[i].x === b.x ? old[i].u : Date.now() } : b));
    try {
      if (!scratchId) {
        scratchId = uuid();
        const n = await wsApi('PUT', `/notes/${scratchId}`, { title: SCRATCH_TITLE, icon: '🗒️', notebook_id: null, content: blocks });
        state.boot.tree.push({ id: scratchId, title: SCRATCH_TITLE, icon: '🗒️', kind: 'note', updated_at: n.updated_at, sort: 0 });
        scratchVersion = n;
      } else {
        scratchVersion = await wsApi('PUT', `/notes/${scratchId}`, { content: blocks, base_version: scratchVersion?.version, base_updated: scratchVersion?.updated_at });
      }
      scratchStatus.textContent = 'Saved';
    } catch (e) { scratchStatus.textContent = e.message; }
  }, 800);
  const scratchStatus = h('span', { class: 'hw-meta' }, '');
  scratchBox.addEventListener('input', () => { scratchStatus.textContent = 'Saving…'; saveScratch(); });

  // ---- Tasks: open to-dos from every note ----
  const tasksBody = h('div', {}, empty('Loading…'));
  (async () => {
    try {
      const tasks = await wsApi('GET', '/tasks');
      const todayIso = new Date().toISOString().slice(0, 10);
      if (!tasks.length) return tasksBody.replaceChildren(empty('No open to-dos. Add “[ ]” to any note.'));
      tasksBody.replaceChildren(...tasks.slice(0, 7).map((t) => h('div', { class: 'hw-row hw-task' },
        h('input', { type: 'checkbox', disabled: !canWrite(), onchange: async (e) => {
          try { await wsApi('POST', '/tasks/toggle', { note_id: t.note_id, block_id: t.block_id }); e.target.closest('.hw-task').classList.add('done'); } catch (x) { toast(x.message, { error: true }); }
        } }),
        h('span', { class: 'grow ellipsis', onclick: () => open(t.note_id) }, t.text.replace(/\*\*|`|@\d{4}-\d{2}-\d{2}/g, '').trim()),
        t.due ? h('span', { class: 'hw-due' + (t.due < todayIso ? ' late' : t.due === todayIso ? ' today' : '') }, t.due === todayIso ? 'Today' : t.due.slice(5)) : null)),
      tasks.length > 7 ? h('a', { class: 'hw-more', href: `#/w/${state.wsId}/tasks` }, `View all ${tasks.length} →`) : null);
    } catch (e) { tasksBody.replaceChildren(empty(e.message)); }
  })();

  // ---- Shortcuts, reminders, notebooks, recently edited ----
  const pinned = notes.filter((n) => n.pinned);
  const reminders = notes.filter((n) => n.reminder_at && !n.reminder_done).sort((a, b) => a.reminder_at - b.reminder_at).slice(0, 6);
  const counts = {};
  for (const n of notes) if (n.notebook_id) counts[n.notebook_id] = (counts[n.notebook_id] || 0) + 1;
  const edited = [...notes].sort((a, b) => b.updated_at - a.updated_at).slice(0, 8);

  const widgets = {
    scratch: section('scratch', 'Scratch pad', 'note', h('div', {}, scratchBox, h('div', { class: 'row' }, scratchStatus, h('span', { class: 'grow' }),
      scratchId ? h('a', { class: 'hw-more', href: '#', onclick: (e) => { e.preventDefault(); open(scratchId); } }, 'Open as page →') : null))),
    tasks: section('tasks', 'Tasks', 'checksq', tasksBody, h('a', { class: 'hw-more', href: `#/w/${state.wsId}/tasks` }, 'All')),
    shortcuts: section('shortcuts', 'Shortcuts', 'star', pinned.length ? h('div', {}, pinned.map((n) => row(n))) : empty('Star a note to pin it here.')),
    reminders: section('reminders', 'Reminders', 'bell', reminders.length ? h('div', {}, reminders.map((n) => row(n, new Date(n.reminder_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))))
      : empty('No upcoming reminders.')),
    notebooks: section('notebooks', 'Notebooks', 'book', state.boot.notebooks.length ? h('div', { class: 'hw-grid' }, state.boot.notebooks.map((nb) =>
      h('a', { class: 'hw-nb', href: `#/w/${state.wsId}/nb/${nb.id}` }, h('span', { class: 'hw-ico' }, nb.icon || '📓'),
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ellipsis' }, nb.name), h('div', { class: 'hw-meta' }, `${counts[nb.id] || 0} notes${nb.stack ? ' · ' + nb.stack : ''}`)))))
      : empty('No notebooks yet.')),
    updated: section('updated', 'Recently edited', 'clock', h('div', {}, edited.map((n) => row(n, relTime(n.updated_at) + (notebook(n.notebook_id) ? ' · ' + notebook(n.notebook_id).name : ''))))),
  };

  const customize = () => {
    const list = h('div', {}, WIDGETS.map(([k, l]) => h('label', { class: 'row', style: { padding: '6px 0' } },
      h('input', { type: 'checkbox', checked: !hidden.has(k), onchange: (e) => { if (e.target.checked) hidden.delete(k); else hidden.add(k); store.set('homeHidden', [...hidden]); homePage(main); } }), l)));
    import('./ui.js').then(({ modal }) => modal('Customize Home', list));
  };

  const quick = [
    canWrite() && ['📝', 'New note', () => createNote({})],
    canWrite() && ['⚡', 'Quick capture', quickCapture],
    canWrite() && ['📅', 'Daily note', dailyNote],
    canWrite() && ['▦', 'New database', () => createNote({ notebook_id: null, database: true })],
    ['🔎', 'Search', palette],
    state.me.ai && ['✨', 'Ask AI', () => go(`#/w/${state.wsId}/ask`)],
    ['💻', 'Get the apps', () => import('./apps.js').then((m) => m.appsDialog())],
  ].filter(Boolean);

  const page = h('div', { class: 'home' },
    h('div', { class: 'home-inner' },
      h('div', { class: 'home-head' },
        h('div', { class: 'grow' }, h('div', { class: 'home-sub' }, today), h('h1', { class: 'home-title' }, `${greeting()}${name ? ', ' + name : ''}`)),
        h('button', { class: 'btn icon home-custom', title: 'Customize Home', onclick: customize }, icon('gear'))),
      h('div', { class: 'home-quick' }, quick.map(([e, l, run]) => h('button', { class: 'home-q', onclick: run }, h('span', {}, e), l))),
      hidden.has('recent') ? null : section('recent', 'Recently visited', 'history', recent.length ? recentRow : empty('Pages you open show up here.')),
      h('div', { class: 'home-cols' }, ['scratch', 'tasks', 'shortcuts', 'reminders', 'notebooks', 'updated'].filter((k) => !hidden.has(k)).map((k) => widgets[k]))));

  main.replaceChildren(h('div', { class: 'topbar' },
    h('button', { class: 'btn icon mobile-only', onclick: () => { document.querySelector('.shell').dataset.pane = 'side'; } }, icon('menu')),
    h('span', { class: 'crumbs' }, h('span', { style: { padding: '2px 6px', color: 'var(--fg)' } }, '🏡 Home'))), h('div', { class: 'main-scroll' }, page));
}

/** Scratch pad blocks back to the plain text shown in the box. */
function blocksToText(blocks) {
  let n = 0;
  return (blocks || []).map((b) => {
    n = b.t === 'ol' ? n + 1 : 0;
    const pad = '  '.repeat(b.ind || 0);
    return { todo: `${pad}- [${b.c ? 'x' : ' '}] `, ul: `${pad}- `, ol: `${pad}${n}. `, h1: '# ', h2: '## ', h3: '### ', quote: '> ' }[b.t] ?? pad;
  }).map((prefix, i) => prefix + (blocks[i].x || '')).join('\n');
}
