// The note/page view: title, metadata, properties, block editor, database views, autosave, presence and side drawers.
import { h, icon, toast, popMenu, modal, confirmBox, promptBox, emojiPicker, debounce, relTime, fmtDate, avatar, uuid, mdToHtml, store, esc } from './ui.js';
import { state, wsApi, upload, download, canWrite, noteMeta, notebook, tag, member } from './api.js';
import { Editor } from './editor.js';
import { DatabaseView, propsPanel } from './database.js';
import { go, refreshBoot, refreshList, currentListHash, createNote } from './main.js';
import { trackVisit } from './home.js';

let cur = null; // the open note's controller

export function currentNote() { return cur?.note || null; }

export async function closeNote() {
  if (!cur) return;
  await cur.flush();
  cur.destroy();
  cur = null;
}

/** Renders note `id` into the main pane. */
export async function showNote(main, id) {
  if (cur?.note.id === id) return;
  await closeNote();
  main.replaceChildren(h('div', { class: 'topbar' }), h('div', { class: 'main-scroll' }, h('div', { class: 'empty' }, 'Loading…')));
  let note;
  try {
    note = await wsApi('GET', `/notes/${id}`);
  } catch (e) {
    main.replaceChildren(h('div', { class: 'topbar' }), h('div', { class: 'empty' }, h('div', { class: 'big' }, '🔍'), e.message));
    return;
  }
  cur = new NoteController(main, note);
  trackVisit(id);
}

class NoteController {
  constructor(main, note) {
    this.main = main;
    this.note = note;
    this.pending = {};
    this.saving = false;
    this.lastTyped = 0;
    this.save = debounce(() => this.flush(), 700);
    this.render();
    this.presence();
    this.presenceTimer = setInterval(() => this.presence(), 10000);
    this.unload = (e) => { if (Object.keys(this.pending).length) { this.flush(); e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', this.unload);
  }

  destroy() {
    clearInterval(this.presenceTimer);
    removeEventListener('beforeunload', this.unload);
    this.editor?.destroy();
    this.save.cancel();
  }

  get readOnly() { const n = this.note; return !canWrite() || !!n.trashed_at || n.locked; }

  // ---------- Saving ----------

  /** Lets the user set when the note was created. */
  async editCreated() {
    const d = new Date(this.note.created_at);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const v = await promptBox('Created on', { label: 'Date and time', value: local, type: 'datetime-local', ok: 'Save' });
    if (!v) return;
    const ms = new Date(v).getTime();
    if (!ms || ms > Date.now()) return toast('Pick a date that isn't in the future.', { error: true });
    this.note.created_at = ms;
    this.queue({ created_at: ms });
    await this.flush();
    this.metaEl?.replaceWith(this.metaRow());
  }

  queue(fields) {
    Object.assign(this.pending, fields);
    this.lastTyped = Date.now();
    this.setStatus('Editing…');
    this.save();
  }

  async flush() {
    this.save.cancel();
    if (this.saving) { this.again = true; return; }
    if (!Object.keys(this.pending).length) return;
    this.saving = true;
    const patch = { ...this.pending };
    this.pending = {};
    if (patch.content) patch.content = this.editor.getBlocks();
    patch.base_version = this.note.version;
    patch.base_updated = this.note.updated_at;
    this.setStatus('Saving…');
    try {
      const r = await wsApi('PUT', `/notes/${this.note.id}`, patch);
      this.note.version = r.version;
      this.note.updated_at = r.updated_at;
      if (r.merged && patch.content && !Object.keys(this.pending).length) {
        this.editor.setBlocks(r.content);
        toast('Merged with changes made elsewhere');
      }
      const meta = noteMeta(this.note.id);
      if (meta) Object.assign(meta, { title: r.title, icon: r.icon, updated_at: r.updated_at, pinned: r.pinned, notebook_id: r.notebook_id });
      Object.assign(this.note, { title: r.title, icon: r.icon });
      const label = `${r.icon ? r.icon + ' ' : ''}${r.title || 'Untitled'}`;
      this.crumbEl.textContent = label;
      const card = document.querySelector(`.note-card[data-id="${r.id}"]`);
      if (card) {
        card.querySelector('h3').textContent = label;
        card.querySelector('p').textContent = r.snippet || 'Empty note';
      }
      this.setStatus('Saved');
      if ('title' in patch || 'icon' in patch) refreshSidebarSoon();
    } catch (e) {
      this.pending = { ...patch, ...this.pending };
      delete this.pending.base_version;
      delete this.pending.base_updated;
      this.setStatus(e.code === 'offline' ? 'Offline · will retry' : 'Not saved');
      if (e.status === 423 || e.status === 403) { toast(e.message, { error: true }); this.pending = {}; }
      else setTimeout(() => this.save(), 5000);
    } finally {
      this.saving = false;
      if (this.again) { this.again = false; this.flush(); }
    }
  }

  setStatus(s) { if (this.statusEl) this.statusEl.textContent = s; }

  /** Presence heartbeat; also picks up edits made by others while this page is open. */
  async presence() {
    try {
      const r = await wsApi('POST', '/presence', { note_id: this.note.id, editing: Date.now() - this.lastTyped < 15000 });
      this.presenceEl?.replaceChildren(...r.others.map((u) => avatar(u, 24)));
      if (r.version && r.version > this.note.version && !Object.keys(this.pending).length && !this.saving) {
        const fresh = await wsApi('GET', `/notes/${this.note.id}`);
        if (Object.keys(this.pending).length) return;
        const who = member(fresh.updated_by)?.name;
        Object.assign(this.note, fresh);
        this.editor?.setBlocks(fresh.content);
        if (this.titleEl && document.activeElement !== this.titleEl) this.titleEl.textContent = fresh.title;
        if (who && fresh.updated_by !== state.me.user.id) this.setStatus(`Updated by ${who}`);
        if (this.note.kind === 'db') this.loadRows();
      }
    } catch { /* offline: try again on the next beat */ }
  }

  // ---------- Rendering ----------

  render() {
    const n = this.note;
    this.statusEl = h('span', { class: 'save-state' }, n.updated_at ? `Edited ${relTime(n.updated_at)}` : '');
    this.presenceEl = h('div', { class: 'presence' });
    const crumbs = h('div', { class: 'crumbs' },
      h('button', { class: 'btn icon mobile-only', onclick: () => go(currentListHash()) }, icon('back')),
      n.notebook_id && notebook(n.notebook_id) ? [h('a', { href: `#/w/${state.wsId}/nb/${n.notebook_id}` }, notebook(n.notebook_id).name), h('span', { class: 'sep' }, '/')] : null,
      n.breadcrumbs.map((c) => [h('a', { href: `#/w/${state.wsId}/n/${c.id}` }, `${c.icon || ''} ${c.title || 'Untitled'}`), h('span', { class: 'sep' }, '/')]),
      this.crumbEl = h('span', { class: 'ellipsis', style: { padding: '2px 6px', color: 'var(--fg)' } }, `${n.icon ? n.icon + ' ' : ''}${n.title || 'Untitled'}`));
    const pin = h('button', { class: 'btn icon' + (n.pinned ? ' on' : ''), title: n.pinned ? 'Unpin' : 'Pin',
      onclick: async () => { n.pinned = !n.pinned; pin.classList.toggle('on', n.pinned); this.queue({ pinned: n.pinned }); await this.flush(); refreshBoot(); } }, icon('star'));
    const top = h('div', { class: 'topbar' }, crumbs, this.statusEl, this.presenceEl,
      canWrite() && !n.trashed_at ? [
        h('button', { class: 'btn sm', onclick: () => this.shareDialog() }, icon(n.share_slug ? 'globe' : 'share'), 'Share'),
        pin,
        h('button', { class: 'btn icon', title: 'Comments', onclick: () => this.comments() }, icon('chat')),
        h('button', { class: 'btn icon', title: 'Version history', onclick: () => this.history() }, icon('history')),
        state.me.ai ? h('button', { class: 'btn icon', title: 'AI', onclick: (e) => this.aiMenu(e.currentTarget) }, icon('sparkles')) : null,
      ] : null,
      h('button', { class: 'btn icon', title: 'More', onclick: (e) => this.moreMenu(e.currentTarget) }, icon('more')));

    this.scroll = h('div', { class: 'main-scroll' });
    // Clicking or tapping blank space anywhere in the page (margins, below the last line) starts typing at the end.
    this.scroll.addEventListener('click', (e) => {
      if (this.readOnly || window.getSelection()?.toString()) return;
      if (e.target.closest('[contenteditable="true"], a, button, input, textarea, select, label, .blk, .doc-props, .db, .backlinks, .doc-meta, .doc-icon, .doc-add')) return;
      this.editor?.focusEnd();
    });
    const wide = store.get('wide:' + n.id, n.kind === 'db');
    const doc = h('div', { class: 'doc' + (wide ? ' wide' : '') });
    this.doc = doc;
    if (n.trashed_at) doc.append(h('div', { class: 'banner warn', style: { borderRadius: '8px', marginBottom: '16px' } }, 'This page is in the trash.',
      h('button', { class: 'btn sm', onclick: () => this.restore() }, 'Restore'),
      h('button', { class: 'btn sm danger', onclick: () => this.deleteForever() }, 'Delete forever')));
    if (n.locked) doc.append(h('div', { class: 'banner', style: { borderRadius: '8px', marginBottom: '16px' } }, icon('lock'), 'This page is locked to prevent accidental edits.',
      canWrite() ? h('button', { class: 'btn sm', onclick: () => this.setLocked(false) }, 'Unlock') : null));

    const ro = this.readOnly;
    const iconEl = n.icon ? h('div', { class: 'doc-icon', onclick: (e) => !ro && emojiPicker(e.currentTarget, (x) => this.setIcon(x)) }, n.icon) : null;
    if (iconEl) doc.append(iconEl);
    else if (!ro) doc.append(h('div', { class: 'doc-add' }, h('button', { class: 'btn sm', style: { borderColor: 'transparent', color: 'var(--muted)' },
      onclick: (e) => emojiPicker(e.currentTarget, (x) => this.setIcon(x)) }, '☺ Add icon')));
    this.titleEl = h('div', { class: 'doc-title', contenteditable: ro ? 'false' : 'true', 'data-placeholder': 'Untitled', spellcheck: 'true',
      oninput: () => this.queue({ title: this.titleEl.textContent.replace(/\n/g, ' ') }),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.editor?.focusBlock(this.editor.blocks[0].id, 'start'); } },
      onpaste: (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\n/g, ' ')); } }, n.title);
    doc.append(this.titleEl, this.metaRow());

    const parent = n.parent_id ? noteMeta(n.parent_id) : null;
    if (parent?.kind === 'db') this.renderProps(doc, n.parent_id);

    const editorHost = h('div');
    doc.append(editorHost);
    if (n.kind === 'db') { this.dbHost = h('div'); doc.append(this.dbHost); this.loadRows(); }
    if (n.backlinks?.length) doc.append(h('div', { class: 'backlinks' }, h('h4', {}, `${n.backlinks.length} backlink${n.backlinks.length > 1 ? 's' : ''}`),
      n.backlinks.map((b) => h('a', { class: 'nav-item', href: `#/w/${state.wsId}/n/${b.id}` }, h('span', { class: 'ico' }, b.icon || '📄'), b.title || 'Untitled'))));
    this.scroll.append(doc);
    this.main.replaceChildren(top, this.scroll);

    this.editor = new Editor(editorHost, n.content, {
      readOnly: ro,
      onChange: () => this.queue({ content: true }),
      openNote: (id) => go(`#/w/${state.wsId}/n/${id}`),
      noteTitle: (id) => { const m = noteMeta(id); return m ? `${m.icon ? m.icon + ' ' : ''}${m.title || 'Untitled'}` : null; },
      pickPage: (q) => state.boot.tree.filter((x) => !x.trashed_at && x.id !== n.id && (x.title || 'Untitled').toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.updated_at - a.updated_at),
      createPage: async (title) => (await createNote({ title, notebook_id: n.notebook_id, open: false }))?.id,
      createChild: async (database) => (await createNote({ parent_id: n.id, notebook_id: n.notebook_id, database, open: false }))?.id,
      upload: (file) => upload(file, n.id),
      ai: state.me.ai ? (action, extra) => this.runAi(action, extra) : null,
      comment: (blockId, text) => this.comments(blockId, text),
    });
    if (!n.title && !ro) setTimeout(() => this.titleEl.focus(), 30);
  }

  metaRow() {
    const n = this.note;
    const ro = this.readOnly;
    const row = h('div', { class: 'doc-meta' });
    const nb = notebook(n.notebook_id);
    row.append(h('button', { class: 'btn sm', disabled: ro, onclick: (e) => this.moveMenu(e.currentTarget) }, icon('book'), nb ? nb.name : 'No notebook'));
    for (const id of n.tags || []) {
      const t = tag(id);
      if (t) row.append(h('span', { class: 'chip' }, '#' + t.name, ro ? null : h('button', { title: 'Remove tag', onclick: () => this.setTags(n.tags.filter((x) => x !== id)) }, '×')));
    }
    if (!ro) row.append(h('button', { class: 'btn sm', onclick: (e) => this.tagPicker(e.currentTarget) }, icon('tag'), 'Add tag'));
    if (n.reminder_at) row.append(h('span', { class: 'chip', style: n.reminder_done ? { textDecoration: 'line-through' } : null }, '⏰ ', fmtDate(n.reminder_at),
      ro ? null : h('button', { title: 'Remove reminder', onclick: () => this.setReminder(null) }, '×')));
    const by = member(n.updated_by);
    // The creation date is editable (handy for notes copied in from paper or another app).
    const created = new Date(n.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const createdEl = ro ? h('span', { class: 'muted' }, 'Created ' + created)
      : h('button', { class: 'btn sm', style: { borderColor: 'transparent', color: 'var(--muted)' }, title: 'Change the creation date', onclick: () => this.editCreated() }, 'Created ' + created);
    row.append(h('span', { class: 'grow' }), createdEl, h('span', {}, `Edited ${by ? 'by ' + by.name + ' ' : ''}${relTime(n.updated_at)}`));
    this.metaEl = row;
    return row;
  }

  refreshMeta() { const fresh = this.metaRow(); this.doc.querySelector('.doc-meta')?.replaceWith(fresh); }

  async renderProps(doc, parentId) {
    const holder = h('div');
    doc.insertBefore(holder, this.metaEl.nextSibling);
    try {
      const db = await wsApi('GET', `/notes/${parentId}`);
      holder.replaceWith(propsPanel(db.db_schema || {}, this.note, { members: state.boot.members, readOnly: this.readOnly,
        onChange: async (props) => { this.note.props = props; this.queue({ props }); } }));
    } catch { holder.remove(); }
  }

  async loadRows() {
    const n = this.note;
    const rows = await wsApi('GET', `/notes?parent=${n.id}&sort=manual&limit=1000`);
    if (this.db) return this.db.setRows(rows);
    this.db = new DatabaseView(this.dbHost, n.db_schema, {
      rows, members: state.boot.members, readOnly: this.readOnly,
      saveSchema: (schema) => { n.db_schema = schema; this.queue({ db_schema: schema }); },
      openRow: (id) => go(`#/w/${state.wsId}/n/${id}`),
      createRow: async ({ title, props }) => {
        const id = uuid();
        const r = await wsApi('PUT', `/notes/${id}`, { title, props, parent_id: n.id, notebook_id: n.notebook_id, sort: Date.now() });
        state.boot.tree.push({ id, parent_id: n.id, kind: 'note', title, updated_at: r.updated_at });
        return r;
      },
      updateRow: (id, patch) => wsApi('PUT', `/notes/${id}`, patch),
    });
  }

  // ---------- Metadata actions ----------

  async setIcon(x) {
    this.note.icon = x;
    this.queue({ icon: x });
    await this.flush();
    const doc = this.scroll.scrollTop;
    this.editor.destroy();
    this.render();
    this.scroll.scrollTop = doc;
  }

  async setTags(ids) {
    this.note.tags = ids;
    this.queue({ tags: ids });
    this.refreshMeta();
  }

  tagPicker(anchor) {
    const input = h('input', { class: 'input', placeholder: 'Find or create a tag', style: { margin: '4px', width: 'calc(100% - 8px)' } });
    const list = h('div');
    const draw = () => {
      const q = input.value.trim().toLowerCase().replace(/^#/, '');
      const matches = state.boot.tags.filter((t) => !this.note.tags.includes(t.id) && t.name.toLowerCase().includes(q)).slice(0, 8);
      list.replaceChildren(...matches.map((t) => h('div', { class: 'item', onclick: () => { pop.remove(); this.setTags([...this.note.tags, t.id]); } }, '#' + t.name)),
        q && !state.boot.tags.some((t) => t.name.toLowerCase() === q) ? h('div', { class: 'item', onclick: () => { pop.remove(); this.createTag(q); } }, icon('plus'), `Create “${q}”`) : null);
    };
    input.oninput = draw;
    input.onkeydown = (e) => { if (e.key === 'Enter') list.querySelector('.item')?.click(); };
    const pop = popMenu(anchor, [{ el: input }, { el: list }]);
    draw();
    setTimeout(() => input.focus(), 10);
  }

  async createTag(name) {
    const id = uuid();
    const t = await wsApi('PUT', `/tags/${id}`, { name });
    state.boot.tags.push(t);
    this.setTags([...this.note.tags, id]);
    refreshBoot();
  }

  moveMenu(anchor) {
    popMenu(anchor, [{ head: 'Move to notebook' }, ...state.boot.notebooks.map((nb) => ({ label: `${nb.icon || '📓'} ${nb.name}`, checked: nb.id === this.note.notebook_id,
      run: () => this.moveTo(nb.id) })), '-', { label: 'No notebook (page)', run: () => this.moveTo(null) }]);
  }

  async moveTo(nbId) {
    this.note.notebook_id = nbId;
    this.queue({ notebook_id: nbId });
    await this.flush();
    this.refreshMeta();
    refreshBoot();
    refreshList();
  }

  async setReminder(ms) {
    this.note.reminder_at = ms;
    this.note.reminder_done = false;
    this.queue({ reminder_at: ms, reminder_done: false });
    this.refreshMeta();
    await this.flush();
    refreshBoot();
  }

  async setLocked(v) {
    this.queue({ locked: v });
    await this.flush();
    this.note.locked = v;
    this.editor.destroy();
    this.render();
  }

  async restore() {
    await wsApi('PUT', `/notes/${this.note.id}`, { trashed: false });
    this.note.trashed_at = null;
    toast('Restored');
    await refreshBoot();
    refreshList();
    this.editor.destroy();
    this.render();
  }

  async deleteForever() {
    if (!(await confirmBox('Delete forever?', 'This page and its sub-pages will be permanently deleted. This cannot be undone.', { ok: 'Delete forever', danger: true }))) return;
    await wsApi('DELETE', `/notes/${this.note.id}`);
    this.pending = {};
    await refreshBoot();
    go(`#/w/${state.wsId}/trash`);
  }

  async trash() {
    this.pending = {};
    await wsApi('PUT', `/notes/${this.note.id}`, { trashed: true });
    const id = this.note.id;
    toast('Moved to trash', { action: { label: 'Undo', run: async () => { await wsApi('PUT', `/notes/${id}`, { trashed: false }); await refreshBoot(); refreshList(); go(`#/w/${state.wsId}/n/${id}`); } } });
    await refreshBoot();
    refreshList();
    go(currentListHash());
  }

  moreMenu(anchor) {
    const n = this.note;
    const w = canWrite() && !n.trashed_at;
    popMenu(anchor, [
      w ? { label: 'Move to notebook', icon: 'book', sub: state.boot.notebooks.map((nb) => ({ label: nb.name, checked: nb.id === n.notebook_id, run: () => this.moveTo(nb.id) })) } : null,
      w ? { label: n.reminder_at ? 'Change reminder' : 'Add reminder', icon: 'bell', run: () => this.reminderDialog() } : null,
      w ? { label: 'Duplicate', icon: 'copy', run: async () => { const c = await wsApi('POST', `/notes/${n.id}/duplicate`, {}); await refreshBoot(); go(`#/w/${state.wsId}/n/${c.id}`); } } : null,
      w ? { label: n.is_template ? 'Stop using as template' : 'Save as template', icon: 'template', run: async () => { n.is_template = !n.is_template; this.queue({ is_template: n.is_template }); await this.flush(); refreshBoot(); toast(n.is_template ? 'Saved as a template' : 'No longer a template'); } } : null,
      w && n.kind !== 'db' ? { label: 'Turn into database', icon: 'table', run: () => this.toDatabase() } : null,
      canWrite() ? { label: n.locked ? 'Unlock page' : 'Lock page', icon: 'lock', run: () => this.setLocked(!n.locked) } : null,
      { label: store.get('wide:' + n.id, n.kind === 'db') ? 'Normal width' : 'Full width', icon: 'expand', run: () => { const v = !store.get('wide:' + n.id, n.kind === 'db'); store.set('wide:' + n.id, v); this.doc.classList.toggle('wide', v); } },
      '-',
      { label: 'Copy link', icon: 'link', run: () => { navigator.clipboard?.writeText(location.href); toast('Link copied'); } },
      { label: 'Export as Markdown', icon: 'download', run: () => download(`/w/${state.wsId}/notes/${n.id}/markdown`, `${(n.title || 'note').replace(/[^\w\- ]+/g, '')}.md`) },
      { label: 'Print or save as PDF', icon: 'page', run: () => print() },
      '-',
      w ? { label: 'Move to trash', icon: 'trash', danger: true, hint: 'Del', run: () => this.trash() } : null,
    ]);
  }

  async toDatabase() {
    const schema = { props: [{ id: 'status', name: 'Status', type: 'status', options: [{ id: 'todo', name: 'Not started', color: 'gray' }, { id: 'doing', name: 'In progress', color: 'blue' }, { id: 'done', name: 'Done', color: 'green' }] },
      { id: 'date', name: 'Date', type: 'date' }], views: [{ id: 'v1', name: 'Table', type: 'table' }, { id: 'v2', name: 'Board', type: 'board', group: 'status' }] };
    this.queue({ kind: 'db', db_schema: schema });
    await this.flush();
    Object.assign(this.note, { kind: 'db', db_schema: schema });
    const meta = noteMeta(this.note.id);
    if (meta) meta.kind = 'db';
    this.editor.destroy();
    this.render();
    refreshBoot();
  }

  reminderDialog() {
    const def = new Date(this.note.reminder_at || Date.now() + 86400000);
    def.setMinutes(def.getMinutes() - def.getTimezoneOffset());
    const input = h('input', { class: 'input', type: 'datetime-local', value: def.toISOString().slice(0, 16) });
    const quick = (label, ms) => h('button', { class: 'btn sm', onclick: () => { m.close(); this.setReminder(ms); } }, label);
    const tomorrow9 = new Date(); tomorrow9.setDate(tomorrow9.getDate() + 1); tomorrow9.setHours(9, 0, 0, 0);
    const nextMon = new Date(); nextMon.setDate(nextMon.getDate() + ((8 - nextMon.getDay()) % 7 || 7)); nextMon.setHours(9, 0, 0, 0);
    const m = modal('Reminder', h('div', {}, h('div', { class: 'row', style: { marginBottom: '12px', flexWrap: 'wrap' } },
      quick('In 1 hour', Date.now() + 3600000), quick('Tomorrow 9:00', tomorrow9.getTime()), quick('Next Monday', nextMon.getTime())),
    h('label', { class: 'field' }, h('span', {}, 'Or pick a date and time'), input),
    h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'You will get a notification (and an email, if email is set up), and the Android app reminds you too.')), {
      actions: [this.note.reminder_at ? { label: 'Remove', danger: true, run: () => this.setReminder(null) } : null, { label: 'Cancel' },
        { label: 'Set reminder', primary: true, run: () => this.setReminder(new Date(input.value).getTime()) }].filter(Boolean),
    });
  }

  // ---------- Share ----------

  shareDialog() {
    const n = this.note;
    const body = h('div');
    const draw = () => {
      body.replaceChildren(
        h('div', { class: 'panel', style: { marginBottom: '12px' } },
          h('div', { class: 'row' }, icon('globe'), h('strong', { class: 'grow' }, 'Publish to the web'),
            h('button', { class: 'btn sm' + (n.share_slug ? '' : ' primary'), onclick: () => toggle(!n.share_slug) }, n.share_slug ? 'Unpublish' : 'Publish')),
          h('p', { class: 'help', style: { margin: '6px 0 0' } }, n.share_slug ? 'Anyone with the link can view this page. Published sub-pages are linked too.' : 'Create a read-only public link, for documentation, a roadmap or a team wiki.'),
          n.share_url ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('input', { class: 'input', readOnly: true, value: n.share_url }),
            h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(n.share_url); toast('Link copied'); } }, 'Copy'),
            h('a', { class: 'btn', href: n.share_url, target: '_blank' }, 'Open')) : null),
        h('div', { class: 'panel' }, h('div', { class: 'row' }, icon('users'), h('strong', { class: 'grow' }, 'Share with your team')),
          h('p', { class: 'help', style: { margin: '6px 0 10px' } }, `Everyone in ${state.boot.workspace.name} can find this page. Invite people, or guests with read-only access, from Settings → Members.`),
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(location.href); toast('Link copied'); } }, icon('link'), 'Copy internal link'),
            h('a', { class: 'btn', href: `#/w/${state.wsId}/settings/members`, onclick: () => m.close() }, 'Invite people'))));
    };
    const toggle = async (enabled) => {
      try {
        const r = await wsApi('POST', `/notes/${n.id}/share`, { enabled });
        n.share_slug = r.share_slug;
        n.share_url = r.share_url;
        draw();
      } catch (e) { toast(e.message, { error: true }); }
    };
    draw();
    const m = modal('Share', body, { wide: false });
  }

  // ---------- Drawers ----------

  drawer(title, content, extra) {
    this.scroll.querySelector('.drawer')?.remove();
    const d = h('div', { class: 'drawer' }, h('div', { class: 'drawer-head' }, h('span', { class: 'grow' }, title), extra,
      h('button', { class: 'btn icon', onclick: () => d.remove() }, icon('x'))), h('div', { class: 'drawer-body' }, content));
    this.main.style.position = 'relative';
    this.main.append(d);
    return d;
  }

  async comments(blockId = null, quote = '') {
    const list = h('div');
    const input = h('textarea', { class: 'input', rows: 3, placeholder: 'Add a comment… use @Name to notify someone' });
    const load = async () => {
      const rows = await wsApi('GET', `/notes/${this.note.id}/comments`);
      list.replaceChildren(...(rows.length ? rows.map((c) => h('div', { class: 'comment' + (c.resolved ? ' resolved' : '') },
        avatar({ name: c.user_name, color: c.user_color }, 28),
        h('div', { class: 'grow' }, h('div', { class: 'row' }, h('strong', {}, c.user_name), h('span', { class: 'muted', style: { fontSize: '12px' } }, relTime(Number(c.created_at))),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn sm', style: { borderColor: 'transparent' }, onclick: async () => { await wsApi('PATCH', `/comments/${c.id}`, { resolved: !Number(c.resolved) }); load(); } }, Number(c.resolved) ? 'Reopen' : 'Resolve')),
        c.block_id ? h('a', { class: 'muted', style: { fontSize: '12px', cursor: 'pointer' }, onclick: () => this.flashBlock(c.block_id) }, '↳ on a block') : null,
        h('div', { class: 'body' }, c.body)))) : [h('p', { class: 'muted' }, 'No comments yet.')]));
    };
    const send = async () => {
      const body = input.value.trim();
      if (!body) return;
      await wsApi('POST', `/notes/${this.note.id}/comments`, { body: quote ? `> ${quote}\n${body}` : body, block_id: blockId });
      input.value = '';
      quote = '';
      blockId = null;
      quoteEl.remove();
      load();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); };
    const quoteEl = quote ? h('blockquote', { class: 'muted', style: { borderLeft: '3px solid var(--line-2)', margin: '0 0 8px', paddingLeft: '10px', fontSize: '13px' } }, quote) : h('span');
    this.drawer('Comments', h('div', {}, list, h('div', { style: { marginTop: '12px' } }, quoteEl, input,
      h('div', { class: 'row', style: { marginTop: '8px', justifyContent: 'flex-end' } }, h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Ctrl+Enter'),
        h('button', { class: 'btn primary', onclick: send }, 'Comment')))));
    await load();
    setTimeout(() => input.focus(), 30);
  }

  flashBlock(id) {
    const el = this.scroll.querySelector(`.blk[data-id="${id}"]`);
    if (!el) return toast('That block was removed');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('selected');
    setTimeout(() => el.classList.remove('selected'), 1600);
  }

  async history() {
    const list = h('div');
    const preview = h('div');
    this.drawer('Version history', h('div', {}, h('p', { class: 'muted', style: { marginTop: 0, fontSize: '13px' } },
      `Kept for ${state.boot.workspace.limits.history_days} days on your plan.`), list, preview));
    const rows = await wsApi('GET', `/notes/${this.note.id}/versions`);
    if (!rows.length) return list.replaceChildren(h('p', { class: 'muted' }, 'No earlier versions yet. Versions are saved as you edit.'));
    list.replaceChildren(...rows.map((v) => h('div', { class: 'ver', onclick: async (e) => {
      list.querySelectorAll('.ver').forEach((x) => x.classList.remove('sel'));
      e.currentTarget.classList.add('sel');
      const full = await wsApi('GET', `/versions/${v.id}`);
      const host = h('div');
      modal(`${full.title || 'Untitled'} · ${fmtDate(Number(v.created_at))}`, host, { wide: true, actions: canWrite() ? [{ label: 'Close' }, { label: 'Restore this version', primary: true, run: async () => {
        await this.flush();
        const r = await wsApi('POST', `/versions/${v.id}/restore`, {});
        Object.assign(this.note, r);
        this.editor.setBlocks(r.content);
        this.titleEl.textContent = r.title;
        toast('Version restored');
      } }] : [] });
      new Editor(host, full.content, { readOnly: true, noteTitle: (id) => noteMeta(id)?.title });
    } }, h('div', {}, fmtDate(Number(v.created_at))), h('div', { class: 'muted', style: { fontSize: '12px' } }, v.user_name || 'Unknown'))));
  }

  // ---------- AI ----------

  async runAi(action, extra = {}) {
    await this.flush();
    const r = await wsApi('POST', '/ai', { action, note_id: this.note.id, ...extra, text: extra.text ?? undefined });
    return r.blocks || [];
  }

  aiMenu(anchor) {
    popMenu(anchor, [
      { head: 'AI for this page' },
      { label: 'Summarize', icon: 'sparkles', run: () => this.aiDrawer('summarize', 'Summary') },
      { label: 'Find action items', icon: 'checksq', run: () => this.aiDrawer('actions', 'Action items') },
      { label: 'Suggest tags', icon: 'tag', run: () => this.aiTags() },
      { label: 'Suggest a title', icon: 'note', run: () => this.aiTitle() },
      { label: 'Translate…', icon: 'globe', run: async () => { const language = await promptBox('Translate page', { label: 'Into which language?', value: 'Spanish', ok: 'Translate' }); if (language) this.aiDrawer('translate', `Translation (${language})`, { language }); } },
      '-',
      { label: 'Ask your whole workspace', icon: 'search', run: () => go(`#/w/${state.wsId}/ask`) },
    ]);
  }

  async aiDrawer(action, title, extra = {}) {
    const out = h('div', { class: 'ai-out' }, '✨ Thinking…');
    const actions = h('div', { class: 'row', style: { marginTop: '10px' } });
    this.drawer(title, h('div', {}, out, actions));
    try {
      await this.flush();
      const r = await wsApi('POST', '/ai', { action, note_id: this.note.id, ...extra });
      out.innerHTML = mdToHtml(r.markdown || '');
      if (canWrite() && !this.readOnly) {
        actions.append(
          h('button', { class: 'btn', onclick: () => { this.editor.blocks.unshift(...r.blocks.map((b) => ({ ...b, id: uuid() })), { id: uuid(), t: 'hr', x: '', u: Date.now() }); this.editor.rerender(); this.queue({ content: true }); toast('Inserted at the top'); } }, 'Insert at top'),
          h('button', { class: 'btn', onclick: () => { this.editor.blocks.push(...r.blocks.map((b) => ({ ...b, id: uuid() }))); this.editor.rerender(); this.queue({ content: true }); toast('Added to the end'); } }, 'Add to end'),
          h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(r.markdown); toast('Copied'); } }, 'Copy'));
      }
    } catch (e) {
      out.textContent = e.message;
    }
  }

  async aiTags() {
    try {
      toast('✨ Suggesting tags…');
      await this.flush();
      const r = await wsApi('POST', '/ai', { action: 'tags', note_id: this.note.id });
      const ids = [...this.note.tags];
      for (const name of r.tags) {
        let t = state.boot.tags.find((x) => x.name.toLowerCase() === name);
        if (!t) { t = await wsApi('PUT', `/tags/${uuid()}`, { name }); state.boot.tags.push(t); }
        if (!ids.includes(t.id)) ids.push(t.id);
      }
      this.setTags(ids);
      refreshBoot();
      toast(`Tagged: ${r.tags.map((x) => '#' + x).join(' ')}`);
    } catch (e) { toast(e.message, { error: true }); }
  }

  async aiTitle() {
    try {
      await this.flush();
      const r = await wsApi('POST', '/ai', { action: 'title', note_id: this.note.id });
      this.titleEl.textContent = r.title;
      this.queue({ title: r.title });
    } catch (e) { toast(e.message, { error: true }); }
  }
}

let sideTimer;
function refreshSidebarSoon() { clearTimeout(sideTimer); sideTimer = setTimeout(() => refreshBoot(), 400); }
