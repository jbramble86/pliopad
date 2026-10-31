// Home: PlioPad's dashboard of widgets (jump back in, quick jot, tasks, pinned notes, reminders, notebooks).
import { h, icon, toast, debounce, relTime, store, uuid } from './ui.js';
import { state, api, wsApi, canWrite, noteMeta, notebook } from './api.js';
import { go, createNote, quickCapture, dailyNote, palette } from './main.js';
import { markdownToBlocks } from './editor.js';

/** Home sections, in their default order. The layout (order + hidden) is saved to the account, so it is the same on every device. */
const WIDGETS = [
  ['actions', 'Quick actions'], ['recent', 'Jump back in'], ['scratch', 'Quick jot'], ['tasks', 'Tasks'], ['shortcuts', 'Pinned'],
  ['reminders', 'Reminders'], ['notebooks', 'Notebooks'], ['updated', 'Recently edited'],
];
const LABEL = Object.fromEntries(WIDGETS);
// These span the full width; the rest flow into two columns.
const WIDE = new Set(['actions', 'recent']);

/** The saved layout: every known section once, in order, with unknown keys dropped and new ones appended. */
function homeLayout() {
  const saved = state.me.user.prefs?.home;
  const order = [...(saved?.order || []).filter((k) => LABEL[k]), ...WIDGETS.map(([k]) => k)].filter((k, i, a) => a.indexOf(k) === i);
  return { order, hidden: new Set(saved ? saved.hidden || [] : store.get('homeHidden', [])) };
}

async function saveLayout(order, hidden) {
  const home = { order, hidden: [...hidden] };
  state.me.user.prefs = { ...(state.me.user.prefs || {}), home };
  try { await api('PATCH', '/me', { prefs: { home } }); } catch (e) { toast(e.message, { error: true }); }
}
const SCRATCH_TITLE = 'Quick jot';
// Notes created before the rename are still found.
const isScratch = (n) => n.title === SCRATCH_TITLE || n.title === 'Scratch pad';

/** Remembers that a note was opened, for the "Jump back in" row. */
export function trackVisit(id) {
  const key = 'recent:' + state.wsId;
  store.set(key, [id, ...store.get(key, []).filter((x) => x !== id)].slice(0, 24));
}


const live = () => state.boot.tree.filter((n) => !n.trashed_at && !n.is_template);
const open = (id) => go(`#/w/${state.wsId}/n/${id}`);
const label = (n) => n.title || 'Untitled';
const ico = (n) => n.icon || (n.kind === 'db' ? '▦' : '📄');

function section(key, title, iconName, body, action) {
  return h('section', { class: 'hw', 'data-w': key },
    h('div', { class: 'hw-head' }, h('span', { class: 'hw-badge' }, icon(iconName)), h('span', { class: 'grow' }, title), action || null),
    body);
}

/** A steady colour per note or notebook (from its id), for tiles and bands. */
const TINTS = ['#647BFF', '#2FBF8A', '#FF7A70', '#F5A524', '#9B7BFF', '#3BA7FF', '#EC6FB0'];
const tint = (id) => TINTS[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length];

/** Notes edited per day over the last 14 days, as small bars. */
function activity(notes) {
  const day = 86400000, start = new Date(); start.setHours(0, 0, 0, 0);
  const counts = Array(14).fill(0);
  for (const n of notes) { const d = Math.floor((start.getTime() + day - n.updated_at) / day); if (d >= 0 && d < 14) counts[13 - d]++; }
  const max = Math.max(1, ...counts);
  return h('div', { class: 'hw-activity', title: 'Notes edited per day, last two weeks' },
    counts.map((c, i) => h('span', { class: 'hw-bar' + (i === 13 ? ' today' : ''), style: { height: Math.max(6, (c / max) * 100) + '%' }, title: `${c} edited` })));
}

function row(n, meta, onclick) {
  return h('a', { class: 'hw-row', href: `#/w/${state.wsId}/n/${n.id}`, onclick },
    h('span', { class: 'hw-ico' }, ico(n)), h('span', { class: 'grow ellipsis' }, label(n)), meta ? h('span', { class: 'hw-meta' }, meta) : null);
}

function empty(text) { return h('div', { class: 'hw-empty' }, text); }

export async function homePage(main) {
  const { order, hidden } = homeLayout();
  const notes = live();
  const name = (state.me.user.name || '').split(' ')[0];
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  // ---- Jump back in: the notes you opened last, as cards ----
  const visited = store.get('recent:' + state.wsId, []).map(noteMeta).filter((n) => n && !n.trashed_at);
  const recent = [...visited, ...[...notes].sort((a, b) => b.updated_at - a.updated_at).filter((n) => !visited.includes(n))].slice(0, 10);
  const recentRow = h('div', { class: 'hw-cards' },
    recent.map((n) => h('a', { class: 'hw-card', href: `#/w/${state.wsId}/n/${n.id}` },
      h('div', { class: 'hw-card-top', style: { background: `linear-gradient(135deg, ${tint(n.notebook_id || n.id)}, ${tint((n.notebook_id || n.id) + 'x')})` } }), h('div', { class: 'hw-card-ico' }, ico(n)),
      h('div', { class: 'hw-card-title' }, label(n)), h('div', { class: 'hw-card-meta' }, relTime(n.updated_at)))));

  // ---- Quick jot: a real note, so it syncs to the phone and works offline there ----
  const scratchBox = h('textarea', { class: 'hw-scratch', placeholder: 'Jot something down…  It saves as you type and syncs to your phone.', disabled: !canWrite() });
  let scratchId = notes.find(isScratch)?.id || null;
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
      // At a glance: how much is late, due today, coming up, or undated.
      const groups = [['late', 'Overdue', tasks.filter((t) => t.due && t.due < todayIso).length], ['today', 'Today', tasks.filter((t) => t.due === todayIso).length],
        ['soon', 'Upcoming', tasks.filter((t) => t.due && t.due > todayIso).length], ['none', 'No date', tasks.filter((t) => !t.due).length]].filter((g) => g[2]);
      const summary = h('div', { class: 'hw-tasksum' },
        h('div', { class: 'hw-seg' }, groups.map(([k, , c]) => h('span', { class: 'seg-' + k, style: { flex: c } }))),
        h('div', { class: 'hw-legend' }, groups.map(([k, l, c]) => h('span', {}, h('i', { class: 'seg-' + k }), h('b', {}, c), ' ', l))));
      tasksBody.replaceChildren(summary, ...tasks.slice(0, 6).map((t) => h('div', { class: 'hw-row hw-task' },
        h('input', { type: 'checkbox', disabled: !canWrite(), onchange: async (e) => {
          try { await wsApi('POST', '/tasks/toggle', { note_id: t.note_id, block_id: t.block_id }); e.target.closest('.hw-task').classList.add('done'); } catch (x) { toast(x.message, { error: true }); }
        } }),
        h('span', { class: 'grow ellipsis', onclick: () => open(t.note_id) }, t.text.replace(/\*\*|`|@\d{4}-\d{2}-\d{2}/g, '').trim()),
        t.due ? h('span', { class: 'hw-due' + (t.due < todayIso ? ' late' : t.due === todayIso ? ' today' : '') }, t.due === todayIso ? 'Today' : t.due.slice(5)) : null)),
      tasks.length > 6 ? h('a', { class: 'hw-more', href: `#/w/${state.wsId}/tasks` }, `View all ${tasks.length} →`) : null);
    } catch (e) { tasksBody.replaceChildren(empty(e.message)); }
  })();

  // ---- Pinned, reminders, notebooks, recently edited ----
  const pinned = notes.filter((n) => n.pinned);
  const reminders = notes.filter((n) => n.reminder_at && !n.reminder_done).sort((a, b) => a.reminder_at - b.reminder_at).slice(0, 6);
  const counts = {};
  for (const n of notes) if (n.notebook_id) counts[n.notebook_id] = (counts[n.notebook_id] || 0) + 1;
  const edited = [...notes].sort((a, b) => b.updated_at - a.updated_at).slice(0, 8);

  const widgets = {
    scratch: section('scratch', 'Quick jot', 'note', h('div', {}, scratchBox, h('div', { class: 'row' }, scratchStatus, h('span', { class: 'grow' }),
      scratchId ? h('a', { class: 'hw-more', href: '#', onclick: (e) => { e.preventDefault(); open(scratchId); } }, 'Open as page →') : null))),
    tasks: section('tasks', 'Tasks', 'checksq', tasksBody, h('a', { class: 'hw-more', href: `#/w/${state.wsId}/tasks` }, 'All')),
    shortcuts: section('shortcuts', 'Pinned', 'star', pinned.length ? h('div', { class: 'hw-tiles' }, pinned.slice(0, 6).map((n) =>
      h('a', { class: 'hw-tile', href: `#/w/${state.wsId}/n/${n.id}`, style: { '--t': tint(n.id) } }, h('span', { class: 'hw-tile-ico' }, ico(n)), h('span', { class: 'hw-tile-name' }, label(n)))))
      : empty('Pin a note to keep it here.')),
    reminders: section('reminders', 'Reminders', 'bell', reminders.length ? h('div', {}, reminders.map((n) => {
      const d = new Date(n.reminder_at);
      return h('a', { class: 'hw-row hw-remind', href: `#/w/${state.wsId}/n/${n.id}` },
        h('span', { class: 'hw-date' + (n.reminder_at < Date.now() ? ' due' : '') }, h('small', {}, d.toLocaleString(undefined, { month: 'short' })), h('b', {}, d.getDate())),
        h('span', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ellipsis' }, label(n)),
          h('div', { class: 'hw-meta' }, d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }))));
    })) : empty('No upcoming reminders.')),
    notebooks: section('notebooks', 'Notebooks', 'book', state.boot.notebooks.length ? h('div', { class: 'hw-grid' }, state.boot.notebooks.map((nb) =>
      h('a', { class: 'hw-nb', href: `#/w/${state.wsId}/nb/${nb.id}`, style: { '--t': tint(nb.id) } }, h('span', { class: 'hw-nb-ico' }, nb.icon || '📓'),
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { class: 'ellipsis' }, nb.name), h('div', { class: 'hw-meta' }, `${counts[nb.id] || 0} notes${nb.stack ? ' · ' + nb.stack : ''}`),
          h('div', { class: 'hw-fill' }, h('span', { style: { width: Math.max(4, ((counts[nb.id] || 0) / Math.max(1, ...Object.values(counts))) * 100) + '%' } }))))))
      : empty('No notebooks yet.')),
    updated: section('updated', 'Recently edited', 'clock', h('div', {}, activity(notes), ...edited.slice(0, 5).map((n) => row(n, relTime(n.updated_at) + (notebook(n.notebook_id) ? ' · ' + notebook(n.notebook_id).name : ''))))),
  };

  // Customize: show or hide each section and move it up or down. Changes apply as you make them.
  const customize = () => {
    const list = h('div', { class: 'home-layout' });
    const apply = () => { saveLayout(order, hidden); draw(); homePage(main); };
    const move = (i, d) => { [order[i], order[i + d]] = [order[i + d], order[i]]; apply(); };
    const draw = () => list.replaceChildren(...order.map((k, i) => h('div', { class: 'home-layout-row' + (hidden.has(k) ? ' off' : '') },
      h('label', { class: 'row grow' }, h('input', { type: 'checkbox', checked: !hidden.has(k), onchange: (e) => { if (e.target.checked) hidden.delete(k); else hidden.add(k); apply(); } }), LABEL[k]),
      h('button', { class: 'btn icon', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'btn icon', title: 'Move down', disabled: i === order.length - 1, onclick: () => move(i, 1) }, '↓'))));
    draw();
    import('./ui.js').then(({ modal }) => modal('Customize Home', h('div', {}, h('p', { class: 'muted', style: { marginTop: 0 } }, 'Your layout is saved to your account and used on every device.'), list), {
      actions: [{ label: 'Reset to default', run: () => { order.splice(0, order.length, ...WIDGETS.map(([k]) => k)); hidden.clear(); apply(); return false; } }, { label: 'Done', primary: true }],
    }));
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

  widgets.actions = h('div', { class: 'home-quick' }, quick.map(([e, l, run]) => h('button', { class: 'home-q', onclick: run }, h('span', {}, e), l)));
  widgets.recent = section('recent', 'Jump back in', 'history', recent.length ? recentRow : empty('Pages you open show up here.'));
  // In the saved order: wide sections on their own, runs of the others side by side in two columns.
  const blocks = () => {
    const out = [];
    let run = null;
    for (const k of order.filter((k) => !hidden.has(k))) {
      if (WIDE.has(k)) { run = null; out.push(widgets[k]); continue; }
      if (!run) out.push(run = h('div', { class: 'home-cols' }));
      run.append(widgets[k]);
    }
    return out;
  };

  const page = h('div', { class: 'home' },
    h('div', { class: 'home-inner' },
      h('div', { class: 'home-head' },
        h('div', { class: 'grow' }, h('div', { class: 'home-sub' }, today), h('h1', { class: 'home-title' }, name ? `Hi ${name}, here's your day` : "Here's your day")),
        h('button', { class: 'btn icon home-custom', title: 'Customize Home', onclick: customize }, icon('gear'))),
      ...blocks()));

  main.replaceChildren(h('div', { class: 'topbar' },
    h('button', { class: 'btn icon mobile-only', onclick: () => { document.querySelector('.shell').dataset.pane = 'side'; } }, icon('menu')),
    h('span', { class: 'crumbs' }, h('span', { style: { padding: '2px 6px', color: 'var(--fg)' } }, '🏡 Home'))), h('div', { class: 'main-scroll' }, page));
}

/** Quick jot blocks back to the plain text shown in the box. */
function blocksToText(blocks) {
  let n = 0;
  return (blocks || []).map((b) => {
    n = b.t === 'ol' ? n + 1 : 0;
    const pad = '  '.repeat(b.ind || 0);
    return { todo: `${pad}- [${b.c ? 'x' : ' '}] `, ul: `${pad}- `, ol: `${pad}${n}. `, h1: '# ', h2: '## ', h3: '### ', quote: '> ' }[b.t] ?? pad;
  }).map((prefix, i) => prefix + (blocks[i].x || '')).join('\n');
}
