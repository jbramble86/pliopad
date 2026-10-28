// Notion-style databases: a page whose child pages are rows, shown as Table, Board, Calendar, Gallery or List views.
import { h, icon, popMenu, promptBox, confirmBox, avatar, uuid, toast } from './ui.js';

export const PROP_TYPES = [
  ['text', 'Text'], ['number', 'Number'], ['select', 'Select'], ['multi', 'Multi-select'], ['status', 'Status'],
  ['date', 'Date'], ['person', 'Person'], ['checkbox', 'Checkbox'], ['url', 'URL'],
];
const VIEW_TYPES = [['table', 'Table', 'table'], ['board', 'Board', 'board'], ['calendar', 'Calendar', 'calendar'], ['gallery', 'Gallery', 'gallery'], ['list', 'List', 'list']];
const COLORS = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink'];
const hasOptions = (p) => ['select', 'multi', 'status'].includes(p.type);

export class DatabaseView {
  /** opts: rows, members, readOnly, saveSchema(schema), openRow(id), createRow({title, props}) -> row, updateRow(id, patch) */
  constructor(root, schema, opts) {
    this.root = root;
    this.opts = opts;
    this.schema = { props: [], views: [], ...(schema || {}) };
    if (!this.schema.views.length) this.schema.views.push({ id: uuid(), name: 'Table', type: 'table' });
    this.rows = opts.rows || [];
    this.viewId = this.schema.views[0].id;
    this.filter = '';
    this.month = new Date();
    this.month.setDate(1);
    this.render();
  }

  get view() { return this.schema.views.find((v) => v.id === this.viewId) || this.schema.views[0]; }
  prop(id) { return this.schema.props.find((p) => p.id === id); }
  saveSchema() { this.opts.saveSchema?.(this.schema); }

  setRows(rows) { this.rows = rows; this.render(); }

  visibleRows() {
    const q = this.filter.trim().toLowerCase();
    let rows = q ? this.rows.filter((r) => (r.title || '').toLowerCase().includes(q) || Object.values(r.props || {}).some((v) => String(v).toLowerCase().includes(q))) : [...this.rows];
    const s = this.view.sort;
    if (s?.prop) {
      const p = this.prop(s.prop);
      const key = (r) => {
        if (s.prop === 'title') return (r.title || '').toLowerCase();
        const v = r.props?.[s.prop];
        if (p && hasOptions(p)) return p.options?.findIndex((o) => o.id === v) ?? 99;
        return v ?? '';
      };
      rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * (s.dir === 'desc' ? -1 : 1));
    }
    return rows;
  }

  render() {
    const ro = this.opts.readOnly;
    const tabs = h('div', { class: 'db-tabs' },
      this.schema.views.map((v) => h('button', { class: 'db-tab' + (v.id === this.view.id ? ' active' : ''),
        onclick: (e) => (v.id === this.view.id && !ro ? this.viewMenu(e.currentTarget, v) : ((this.viewId = v.id), this.render())) },
        icon(VIEW_TYPES.find((t) => t[0] === v.type)?.[2] || 'table'), v.name)),
      ro ? null : h('button', { class: 'db-tab', title: 'Add a view', onclick: (e) => this.addView(e.currentTarget) }, icon('plus')),
      h('div', { class: 'db-tools' },
        h('input', { class: 'input', placeholder: 'Search…', value: this.filter, oninput: (e) => { this.filter = e.target.value; this.renderBody(); } }),
        ro ? null : h('button', { class: 'btn primary sm', onclick: () => this.newRow({}) }, icon('plus'), 'New')));
    this.body = h('div', { class: 'db-body' });
    this.root.replaceChildren(h('div', { class: 'db' }, tabs, this.body));
    this.renderBody();
  }

  renderBody() {
    const type = this.view.type;
    const fn = { table: this.table, board: this.board, calendar: this.calendar, gallery: this.gallery, list: this.list }[type] || this.table;
    this.body.replaceChildren(fn.call(this));
  }

  // ---------- Cells ----------

  valueView(p, v) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '';
    switch (p.type) {
      case 'select': case 'status': {
        const o = p.options?.find((x) => x.id === v);
        return o ? h('span', { class: 'opt', 'data-c': o.color }, o.name) : '';
      }
      case 'multi': return (Array.isArray(v) ? v : [v]).map((id) => p.options?.find((x) => x.id === id)).filter(Boolean).map((o) => h('span', { class: 'opt', 'data-c': o.color }, o.name));
      case 'checkbox': return v ? '☑' : '☐';
      case 'person': { const m = this.opts.members?.find((x) => Number(x.id) === Number(v)); return m ? h('span', { class: 'row', style: { gap: '6px' } }, avatar(m, 18), m.name) : ''; }
      case 'date': return new Date(v + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      case 'url': return h('a', { href: v, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, String(v).replace(/^https?:\/\//, ''));
      default: return String(v);
    }
  }

  async setProp(row, propId, value) {
    row.props = { ...(row.props || {}), [propId]: value };
    if (value === null || value === undefined || value === '') delete row.props[propId];
    this.renderBody();
    try { await this.opts.updateRow(row.id, { props: row.props }); } catch (e) { toast(e.message, { error: true }); }
  }

  editCell(anchor, row, p) {
    if (this.opts.readOnly) return;
    const v = row.props?.[p.id];
    if (p.type === 'checkbox') return this.setProp(row, p.id, !v || undefined);
    if (hasOptions(p)) {
      const multi = p.type === 'multi';
      const cur = multi ? (Array.isArray(v) ? v : v ? [v] : []) : v;
      return popMenu(anchor, [
        ...(p.options || []).map((o) => ({ label: o.name, icon: h('span', { class: 'opt', 'data-c': o.color, style: { width: '10px', height: '10px', padding: 0 } }),
          checked: multi ? cur.includes(o.id) : cur === o.id,
          run: () => this.setProp(row, p.id, multi ? (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id]) : cur === o.id ? null : o.id) })),
        '-',
        { label: 'New option…', icon: 'plus', run: async () => {
          const name = await promptBox('New option', { label: 'Name' });
          if (!name) return;
          const o = { id: uuid().slice(0, 8), name, color: COLORS[(p.options?.length || 0) % COLORS.length] };
          p.options = [...(p.options || []), o];
          this.saveSchema();
          this.setProp(row, p.id, multi ? [...cur, o.id] : o.id);
        } },
      ]);
    }
    if (p.type === 'person') {
      return popMenu(anchor, [...(this.opts.members || []).map((m) => ({ label: m.name, icon: avatar(m, 18), checked: Number(v) === Number(m.id), run: () => this.setProp(row, p.id, Number(m.id)) })),
        '-', { label: 'Clear', run: () => this.setProp(row, p.id, null) }]);
    }
    // Inline input for text, number, date and URL.
    const input = h('input', { class: 'cell-in', type: p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text', value: v ?? '' });
    const done = (save) => {
      if (!input.isConnected) return;
      if (save) {
        let val = input.value.trim();
        if (p.type === 'number') val = val === '' ? null : Number(val);
        if (p.type === 'url' && val && !/^https?:\/\//.test(val)) val = 'https://' + val;
        this.setProp(row, p.id, val === '' ? null : val);
      } else this.renderBody();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    input.onblur = () => done(true);
    anchor.replaceWith(input);
    input.focus();
  }

  async newRow(props, title = '') {
    try {
      const row = await this.opts.createRow({ title, props });
      this.rows.push(row);
      this.renderBody();
      return row;
    } catch (e) { toast(e.message, { error: true }); return null; }
  }

  // ---------- Properties & views ----------

  async addProp(anchor) {
    popMenu(anchor, [{ head: 'Property type' }, ...PROP_TYPES.map(([type, label]) => ({ label, run: async () => {
      const name = await promptBox('New property', { label: 'Name', value: label });
      if (!name) return;
      const p = { id: uuid().slice(0, 8), name, type };
      if (type === 'status') p.options = [{ id: 'todo', name: 'Not started', color: 'gray' }, { id: 'doing', name: 'In progress', color: 'blue' }, { id: 'done', name: 'Done', color: 'green' }];
      if (type === 'select' || type === 'multi') p.options = [];
      this.schema.props.push(p);
      this.saveSchema();
      this.renderBody();
    } }))]);
  }

  propMenu(anchor, p) {
    if (this.opts.readOnly) return;
    const view = this.view;
    const sortBy = (dir) => { view.sort = { prop: p?.id || 'title', dir }; this.saveSchema(); this.renderBody(); };
    if (!p) return popMenu(anchor, [{ label: 'Sort A → Z', run: () => sortBy('asc') }, { label: 'Sort Z → A', run: () => sortBy('desc') }]);
    popMenu(anchor, [
      { label: 'Rename', icon: 'note', run: async () => { const n = await promptBox('Rename property', { value: p.name }); if (n) { p.name = n; this.saveSchema(); this.renderBody(); } } },
      { label: 'Type', icon: 'chevron', sub: PROP_TYPES.map(([t, l]) => ({ label: l, checked: p.type === t, run: () => { p.type = t; if (hasOptions(p)) p.options ||= []; this.saveSchema(); this.renderBody(); } })) },
      hasOptions(p) ? { label: 'Edit options…', icon: 'list', run: () => this.editOptions(p) } : null,
      { label: 'Sort ascending', run: () => sortBy('asc') },
      { label: 'Sort descending', run: () => sortBy('desc') },
      '-',
      { label: 'Delete property', icon: 'trash', danger: true, run: async () => {
        if (!(await confirmBox('Delete property?', `“${p.name}” and its values will be removed from every row.`, { ok: 'Delete', danger: true }))) return;
        this.schema.props = this.schema.props.filter((x) => x.id !== p.id);
        this.saveSchema();
        this.renderBody();
      } },
    ]);
  }

  async editOptions(p) {
    const text = await promptBox(`Options for “${p.name}”`, { label: 'Comma-separated, in order', value: (p.options || []).map((o) => o.name).join(', ') });
    if (text === null) return;
    const names = text.split(',').map((s) => s.trim()).filter(Boolean);
    p.options = names.map((name, i) => p.options?.find((o) => o.name === name) || { id: uuid().slice(0, 8), name, color: COLORS[i % COLORS.length] });
    this.saveSchema();
    this.renderBody();
  }

  addView(anchor) {
    popMenu(anchor, VIEW_TYPES.map(([type, label, ico]) => ({ label, icon: ico, run: () => {
      const v = { id: uuid().slice(0, 8), name: label, type };
      if (type === 'board') v.group = this.schema.props.find(hasOptions)?.id;
      if (type === 'calendar') v.date = this.schema.props.find((p) => p.type === 'date')?.id;
      this.schema.views.push(v);
      this.viewId = v.id;
      this.saveSchema();
      this.render();
    } })));
  }

  viewMenu(anchor, v) {
    popMenu(anchor, [
      { label: 'Rename view', icon: 'note', run: async () => { const n = await promptBox('Rename view', { value: v.name }); if (n) { v.name = n; this.saveSchema(); this.render(); } } },
      v.type === 'board' ? { label: 'Group by', icon: 'board', sub: this.schema.props.filter(hasOptions).map((p) => ({ label: p.name, checked: v.group === p.id, run: () => { v.group = p.id; this.saveSchema(); this.renderBody(); } })) } : null,
      v.type === 'calendar' ? { label: 'Date property', icon: 'calendar', sub: this.schema.props.filter((p) => p.type === 'date').map((p) => ({ label: p.name, checked: v.date === p.id, run: () => { v.date = p.id; this.saveSchema(); this.renderBody(); } })) } : null,
      { label: 'Clear sort', run: () => { delete v.sort; this.saveSchema(); this.renderBody(); } },
      '-',
      this.schema.views.length > 1 ? { label: 'Delete view', icon: 'trash', danger: true, run: () => { this.schema.views = this.schema.views.filter((x) => x.id !== v.id); this.viewId = this.schema.views[0].id; this.saveSchema(); this.render(); } } : null,
    ]);
  }

  // ---------- Views ----------

  table() {
    const ro = this.opts.readOnly;
    const props = this.schema.props;
    const head = h('tr', {}, h('th', { onclick: (e) => this.propMenu(e.currentTarget, null) }, 'Name'),
      props.map((p) => h('th', { onclick: (e) => this.propMenu(e.currentTarget, p) }, p.name)),
      ro ? null : h('th', { style: { width: '40px' }, title: 'Add a property', onclick: (e) => this.addProp(e.currentTarget) }, '+'));
    const body = this.visibleRows().map((r) => h('tr', {},
      h('td', { class: 'title' }, h('div', { class: 'cell', onclick: () => this.opts.openRow(r.id) }, r.icon || '📄', h('span', { class: 'ellipsis' }, r.title || 'Untitled'))),
      props.map((p) => h('td', {}, h('div', { class: 'cell', onclick: (e) => this.editCell(e.currentTarget, r, p) }, this.valueView(p, r.props?.[p.id])))),
      ro ? null : h('td', {})));
    return h('div', {}, h('div', { class: 'db-scroll' }, h('table', { class: 'dbt' }, h('thead', {}, head), h('tbody', {}, body))),
      ro ? null : h('div', { class: 'db-add', onclick: () => this.newRow({}) }, icon('plus'), 'New row'));
  }

  board() {
    const v = this.view;
    const p = this.prop(v.group) || this.schema.props.find(hasOptions);
    if (!p) return h('div', { class: 'empty' }, 'Add a Select or Status property to group cards into columns.');
    const cols = [...(p.options || []).map((o) => ({ id: o.id, name: o.name, color: o.color })), { id: null, name: `No ${p.name}`, color: 'gray' }];
    const rows = this.visibleRows();
    const card = (r) => h('div', { class: 'board-card', draggable: this.opts.readOnly ? null : 'true',
      ondragstart: (e) => e.dataTransfer.setData('text/x-pliopad-row', r.id), onclick: () => this.opts.openRow(r.id) },
      h('div', { class: 't' }, (r.icon ? r.icon + ' ' : '') + (r.title || 'Untitled')),
      h('div', { class: 'p' }, this.schema.props.filter((x) => x.id !== p.id && r.props?.[x.id] !== undefined).slice(0, 3).map((x) => h('span', {}, this.valueView(x, r.props[x.id])))));
    return h('div', { class: 'board' }, cols.map((c) => {
      const items = rows.filter((r) => (r.props?.[p.id] ?? null) === c.id);
      if (c.id === null && !items.length) return null;
      const col = h('div', { class: 'board-col',
        ondragover: (e) => { if (e.dataTransfer.types.includes('text/x-pliopad-row')) { e.preventDefault(); col.classList.add('drop'); } },
        ondragleave: () => col.classList.remove('drop'),
        ondrop: (e) => { col.classList.remove('drop'); const r = this.rows.find((x) => x.id === e.dataTransfer.getData('text/x-pliopad-row')); if (r) this.setProp(r, p.id, c.id); } },
      h('h4', {}, h('span', { class: 'opt', 'data-c': c.color }, c.name), h('span', { class: 'muted' }, items.length)),
      items.map(card),
      this.opts.readOnly ? null : h('div', { class: 'db-add', onclick: () => this.newRow(c.id ? { [p.id]: c.id } : {}) }, icon('plus'), 'New'));
      return col;
    }));
  }

  calendar() {
    const v = this.view;
    const p = this.prop(v.date) || this.schema.props.find((x) => x.type === 'date');
    if (!p) return h('div', { class: 'empty' }, 'Add a Date property to use the calendar.');
    const first = new Date(this.month);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start on Monday
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = iso(new Date());
    const rows = this.visibleRows();
    const cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div', { class: 'dow' }, d));
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = iso(d);
      cells.push(h('div', { class: (d.getMonth() !== first.getMonth() ? 'other ' : '') + (key === today ? 'today' : ''),
        ondblclick: () => !this.opts.readOnly && this.newRow({ [p.id]: key }) },
        h('div', { class: 'day-n' }, d.getDate()),
        rows.filter((r) => r.props?.[p.id] === key).map((r) => h('div', { class: 'ev', onclick: () => this.opts.openRow(r.id) }, r.title || 'Untitled'))));
    }
    const nav = (n) => { this.month.setMonth(this.month.getMonth() + n); this.renderBody(); };
    return h('div', {}, h('div', { class: 'row', style: { margin: '4px 0 10px' } },
      h('strong', { class: 'grow' }, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, 'Double-click a day to add'),
      h('button', { class: 'btn sm', onclick: () => nav(-1) }, '‹'), h('button', { class: 'btn sm', onclick: () => { this.month = new Date(); this.month.setDate(1); this.renderBody(); } }, 'Today'),
      h('button', { class: 'btn sm', onclick: () => nav(1) }, '›')), h('div', { class: 'cal' }, cells));
  }

  gallery() {
    return h('div', { class: 'gallery' }, this.visibleRows().map((r) => h('div', { class: 'g', onclick: () => this.opts.openRow(r.id) },
      h('div', { class: 'cover' }, r.thumb ? h('img', { src: r.thumb, alt: '' }) : r.icon || '📄'),
      h('div', { class: 't' }, r.title || 'Untitled'),
      h('div', { class: 'p muted', style: { padding: '0 10px 10px', fontSize: '12px', display: 'flex', gap: '4px', flexWrap: 'wrap' } },
        this.schema.props.slice(0, 2).map((p) => h('span', {}, this.valueView(p, r.props?.[p.id])))))),
    this.opts.readOnly ? null : h('div', { class: 'g', style: { display: 'grid', placeItems: 'center', minHeight: '150px', color: 'var(--muted)' }, onclick: () => this.newRow({}) }, '+ New'));
  }

  list() {
    return h('div', {}, this.visibleRows().map((r) => h('div', { class: 'nav-item', onclick: () => this.opts.openRow(r.id) },
      h('span', { class: 'ico' }, r.icon || '📄'), h('span', { class: 'grow ellipsis' }, r.title || 'Untitled'),
      this.schema.props.slice(0, 3).map((p) => h('span', { style: { fontSize: '12px' } }, this.valueView(p, r.props?.[p.id]))))),
    this.opts.readOnly ? null : h('div', { class: 'db-add', onclick: () => this.newRow({}) }, icon('plus'), 'New'));
  }
}

/** Properties panel shown at the top of a row page. */
export function propsPanel(schema, row, { members, readOnly, onChange }) {
  const view = new DatabaseView(document.createElement('div'), schema, { rows: [row], members, readOnly,
    updateRow: (id, patch) => onChange(patch.props), saveSchema: () => {}, openRow: () => {}, createRow: () => null });
  view.renderBody = () => panel.replaceChildren(...rows());
  const rows = () => schema.props.map((p) => h('div', { class: 'prop-row' },
    h('div', { class: 'pname' }, p.name),
    h('div', { class: 'cell', style: { cursor: readOnly ? 'default' : 'pointer', minHeight: '28px', padding: '3px 6px', borderRadius: '4px' },
      onclick: (e) => view.editCell(e.currentTarget, row, p) }, view.valueView(p, row.props?.[p.id]) || h('span', { class: 'muted' }, 'Empty'))));
  const panel = h('div', { class: 'props' }, ...rows());
  return panel;
}
