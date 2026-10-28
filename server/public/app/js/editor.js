// Block editor. The block list is the source of truth; each block renders to one row with a contenteditable text area.
// Inline markup is stored as light Markdown (**b** *i* ~~s~~ `code` [label](url) [Title](note:ID)).
import { h, icon, esc, popMenu, closePop, setOpenPop, placePop, emojiPicker, promptBox, uuid, toast } from './ui.js';

const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'todo', 'ul', 'ol', 'quote', 'callout', 'toggle', 'code']);
const KEEP_ON_ENTER = new Set(['todo', 'ul', 'ol']);

export const BLOCK_TYPES = [
  { t: 'p', label: 'Text', ico: 'Aa', keys: 'text paragraph plain' },
  { t: 'h1', label: 'Heading 1', ico: 'H1', keys: 'heading title h1 #' },
  { t: 'h2', label: 'Heading 2', ico: 'H2', keys: 'heading subtitle h2 ##' },
  { t: 'h3', label: 'Heading 3', ico: 'H3', keys: 'heading h3 ###' },
  { t: 'todo', label: 'To-do list', ico: '☑', keys: 'todo task checkbox check []' },
  { t: 'ul', label: 'Bulleted list', ico: '•', keys: 'bullet list unordered -' },
  { t: 'ol', label: 'Numbered list', ico: '1.', keys: 'numbered ordered list 1.' },
  { t: 'toggle', label: 'Toggle list', ico: '▸', keys: 'toggle collapse details' },
  { t: 'quote', label: 'Quote', ico: '❝', keys: 'quote blockquote >' },
  { t: 'callout', label: 'Callout', ico: '💡', keys: 'callout note info warning tip' },
  { t: 'code', label: 'Code', ico: '</>', keys: 'code snippet pre ```' },
  { t: 'hr', label: 'Divider', ico: '—', keys: 'divider line hr separator ---' },
];

const now = () => Date.now();

// ---------- Inline Markdown <-> HTML ----------

export function inlineToHtml(x) {
  let s = esc(x);
  s = s.replace(/\[([^\]]*)\]\(note:([0-9a-f-]{36})\)/g, '<a data-note="$2" href="#">$1</a>');
  s = s.replace(/\[([^\]]*)\]\(((?:https?:|mailto:)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, '<i>$1</i>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  s = s.replace(/(^|\s)@(\d{4}-\d{2}-\d{2})/g, '$1<mark class="due">@$2</mark>');
  return s.replace(/\n/g, '<br>');
}

export function htmlToInline(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/ /g, ' '); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    const inner = htmlToInline(n);
    if (tag === 'br') out += '\n';
    else if (!inner) continue;
    else if (tag === 'b' || tag === 'strong' || (tag === 'span' && /bold|[6-9]00/.test(n.style.fontWeight))) out += wrapMark(inner, '**');
    else if (tag === 'i' || tag === 'em') out += wrapMark(inner, '*');
    else if (tag === 's' || tag === 'strike' || tag === 'del') out += wrapMark(inner, '~~');
    else if (tag === 'code') out += '`' + inner.replace(/`/g, '') + '`';
    else if (tag === 'a') out += n.dataset.note ? `[${inner}](note:${n.dataset.note})` : /^(https?:|mailto:)/.test(n.getAttribute('href') || '') ? `[${inner}](${n.getAttribute('href')})` : inner;
    else if (tag === 'div' || tag === 'p') out += (out && !out.endsWith('\n') ? '\n' : '') + inner;
    else out += inner;
  }
  return out;
}

function wrapMark(inner, m) {
  const lead = inner.match(/^\s*/)[0];
  const trail = inner.match(/\s*$/)[0];
  const core = inner.trim();
  return core ? `${lead}${m}${core}${m}${trail}` : inner;
}

// ---------- Caret helpers ----------

function caretOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return 0;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function pointAt(el, offset) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = offset;
  let node;
  while ((node = walker.nextNode())) {
    if (left <= node.nodeValue.length) return [node, left];
    left -= node.nodeValue.length;
  }
  return [el, el.childNodes.length];
}

function setCaret(el, offset) {
  el.focus({ preventScroll: true });
  const sel = getSelection();
  const r = document.createRange();
  const [node, off] = offset === Infinity ? [el, el.childNodes.length] : pointAt(el, Math.max(0, offset));
  r.setStart(node, off);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  const rect = r.getBoundingClientRect?.();
  if (rect && (rect.top < 60 || rect.bottom > innerHeight - 40)) el.scrollIntoView({ block: 'nearest' });
}

function rangeFor(el, start, end) {
  const r = document.createRange();
  r.setStart(...pointAt(el, start));
  r.setEnd(...pointAt(el, end));
  return r;
}

function caretOnEdgeLine(el, which) {
  const sel = getSelection();
  if (!sel.rangeCount) return true;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(true);
  const rect = r.getClientRects()[0];
  if (!rect) return true;
  const box = el.getBoundingClientRect();
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
  return which === 'up' ? rect.top - box.top < lh : box.bottom - rect.bottom < lh;
}

// ---------- Paste: plain text / Markdown to blocks ----------

export function markdownToBlocks(md) {
  const out = [];
  let code = null;
  for (const line of md.replace(/\r/g, '').split('\n')) {
    if (code) {
      if (/^\s*```/.test(line)) { out.push({ t: 'code', x: code.join('\n') }); code = null; } else code.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { code = []; continue; }
    if (!line.trim()) continue;
    const ind = Math.min(8, Math.floor((line.length - line.trimStart().length) / 2));
    const t = line.trim();
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) out.push({ t: 'h' + m[1].length, x: m[2] });
    else if ((m = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(t))) out.push({ t: 'todo', x: m[2], c: m[1].trim() ? true : undefined, ind });
    else if ((m = /^[-*+•]\s+(.*)$/.exec(t))) out.push({ t: 'ul', x: m[1], ind });
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) out.push({ t: 'ol', x: m[1], ind });
    else if ((m = /^>\s?(.*)$/.exec(t))) out.push({ t: 'quote', x: m[1] });
    else if (/^(-{3,}|\*{3,})$/.test(t)) out.push({ t: 'hr', x: '' });
    else out.push({ t: 'p', x: t, ind });
  }
  if (code) out.push({ t: 'code', x: code.join('\n') });
  return out.map((b) => ({ ...b, id: uuid(), u: now(), ind: b.ind || undefined }));
}

// ---------- Editor ----------

export class Editor {
  /**
   * opts: readOnly, onChange(blocks), openNote(id), noteTitle(id), pickPage(query) -> [{id,title,icon}],
   * createPage(title) -> id, upload(file) -> {url,name,mime}, ai(action, extra) -> blocks, comment(blockId, text)
   */
  constructor(root, blocks, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.blocks = (blocks || []).map((b) => ({ ...b }));
    if (!this.blocks.length) this.blocks.push(this.newBlock('p'));
    this.readOnly = !!opts.readOnly;
    this.menu = null; // slash or page-link menu state
    this.el = h('div', { class: 'editor' });
    root.replaceChildren(this.el);
    this.bind();
    this.render();
  }

  newBlock(t, x = '', extra = {}) { return { id: uuid(), t, x, u: now(), ...extra }; }
  index(id) { return this.blocks.findIndex((b) => b.id === id); }
  textEl(id) { return this.el.querySelector(`.blk[data-id="${id}"] .blk-text`); }
  changed(b) { if (b) b.u = now(); this.opts.onChange?.(this.blocks); }
  getBlocks() { return this.blocks.map((b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== null && v !== false))); }

  /** Replaces content (e.g. after a merge or a live update) while keeping the caret where it was. */
  setBlocks(blocks) {
    const focus = this.focusState();
    this.blocks = blocks.map((b) => ({ ...b }));
    if (!this.blocks.length) this.blocks.push(this.newBlock('p'));
    this.render();
    if (focus) this.restoreFocus(focus);
  }

  focusState() {
    const el = document.activeElement?.closest?.('.blk-text');
    if (!el || !this.el.contains(el)) return null;
    return { id: el.closest('.blk').dataset.id, offset: caretOffset(el) };
  }

  restoreFocus({ id, offset }) {
    const el = this.textEl(id);
    if (el) setCaret(el, offset);
  }

  focusBlock(id, where = 'end') {
    const el = this.textEl(id);
    if (!el) return;
    setCaret(el, where === 'start' ? 0 : where === 'end' ? Infinity : where);
  }

  focusEnd() {
    const last = [...this.blocks].reverse().find((b) => TEXT_TYPES.has(b.t));
    if (last) this.focusBlock(last.id);
  }

  // ---------- Rendering ----------

  render() {
    const frag = document.createDocumentFragment();
    const olCount = [];
    let hideBelow = null;
    for (const b of this.blocks) {
      const ind = b.ind || 0;
      if (hideBelow !== null && ind <= hideBelow) hideBelow = null;
      olCount.length = ind + 1;
      olCount[ind] = b.t === 'ol' ? (olCount[ind] || 0) + 1 : 0;
      const el = this.renderBlock(b, olCount[ind]);
      if (hideBelow !== null) el.classList.add('collapsed-child');
      if (b.t === 'toggle' && !b.c && hideBelow === null) hideBelow = ind;
      frag.append(el);
    }
    this.el.replaceChildren(frag);
  }

  rerender(focusId, offset) {
    this.render();
    if (focusId) this.focusBlock(focusId, offset ?? 'end');
  }

  renderBlock(b, olNum) {
    const ro = this.readOnly;
    const row = h('div', { class: 'blk' + (b.t === 'todo' && b.c ? ' done' : '') + (b.t === 'toggle' && b.c ? ' open' : ''),
      'data-id': b.id, 'data-t': b.t, 'data-col': b.col || null, style: b.ind ? { '--ind': b.ind } : null });
    if (!ro) {
      row.append(h('div', { class: 'blk-handle' },
        h('button', { title: 'Add a block below', onclick: () => this.addBelow(b.id) }, icon('plus')),
        h('button', { class: 'grip', title: 'Drag to move · click for options', draggable: 'true',
          ondragstart: (e) => { e.dataTransfer.setData('text/x-pliopad-block', b.id); e.dataTransfer.effectAllowed = 'move'; row.style.opacity = '.4'; },
          ondragend: () => { row.style.opacity = ''; this.clearDrop(); },
          onclick: (e) => this.blockMenu(e.currentTarget, b) }, icon('grip'))));
    }
    // Gutter: checkbox, bullet, number, toggle arrow, callout icon.
    const gutter = h('div', { class: 'blk-gutter' });
    if (b.t === 'todo') gutter.append(h('input', { type: 'checkbox', checked: !!b.c, disabled: ro && !this.opts.allowCheck,
      onchange: (e) => { b.c = e.target.checked || undefined; row.classList.toggle('done', !!b.c); this.changed(b); } }));
    if (b.t === 'ol') gutter.textContent = `${olNum}.`;
    if (b.t === 'toggle') { gutter.append(icon('chevron')); gutter.onclick = () => { b.c = !b.c || undefined; this.rerender(); this.changed(b); }; }
    if (b.t === 'callout') { gutter.textContent = b.src || '💡'; if (!ro) gutter.onclick = () => emojiPicker(gutter, (e) => { b.src = e || '💡'; this.rerender(); this.changed(b); }); }
    row.append(gutter);

    if (b.t === 'hr') { row.append(h('div', { class: 'blk-text', contenteditable: 'false' }, h('hr'))); return row; }
    if (b.t === 'img') {
      const cap = h('figcaption', { contenteditable: ro ? 'false' : 'true', oninput: (e) => { b.cap = e.target.textContent; this.changed(b); } }, b.cap || '');
      row.append(h('figure', { class: 'blk-media', style: { margin: 0 } }, b.src ? h('img', { src: b.src, loading: 'lazy', alt: b.cap || '' }) : h('div', { class: 'muted' }, 'Image'), cap));
      return row;
    }
    if (b.t === 'file' || b.t === 'bookmark') {
      const isFile = b.t === 'file';
      const href = b.src && /^(https?:|\/)/.test(b.src) ? b.src : null;
      row.append(h('div', { class: 'blk-media' }, h('a', { class: 'card-link', href: href || '#', target: '_blank', rel: 'noopener' },
        icon(isFile ? 'page' : 'link'), h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, (isFile ? b.cap : b.x) || b.src || 'Link'),
          h('div', { class: 'sub ellipsis' }, isFile ? 'Attachment' : b.src)))));
      return row;
    }
    if (b.t === 'page') {
      const title = this.opts.noteTitle?.(b.src) || b.x || 'Untitled';
      row.append(h('div', { class: 'blk-media' }, h('a', { class: 'page-link', href: '#', onclick: (e) => { e.preventDefault(); this.opts.openNote?.(b.src); } },
        icon('page'), title)));
      return row;
    }
    const text = h('div', { class: 'blk-text', contenteditable: ro ? 'false' : 'true', spellcheck: b.t === 'code' ? 'false' : 'true',
      'data-placeholder': { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', todo: 'To-do', ul: 'List', ol: 'List', quote: 'Quote', toggle: 'Toggle', callout: 'Callout', code: 'Code' }[b.t] || '' });
    if (b.t === 'code') text.textContent = b.x || '';
    else text.innerHTML = inlineToHtml(b.x || '');
    row.append(text);
    if (b.t === 'code' && !ro) row.append(h('button', { class: 'lang', onclick: async () => { const l = await promptBox('Code language', { value: b.lang || '', placeholder: 'javascript' }); if (l !== null) { b.lang = l || undefined; this.rerender(); this.changed(b); } } }, b.lang || 'plain text'));
    return row;
  }

  // ---------- Events ----------

  bind() {
    const el = this.el;
    el.addEventListener('input', (e) => this.onInput(e));
    el.addEventListener('keydown', (e) => this.onKey(e));
    el.addEventListener('paste', (e) => this.onPaste(e));
    el.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a || !el.contains(a)) return;
      if (a.dataset.note) { e.preventDefault(); this.opts.openNote?.(a.dataset.note); return; }
      if (a.closest('.blk-text') && (e.ctrlKey || e.metaKey || this.readOnly)) { e.preventDefault(); open(a.href, '_blank', 'noopener'); }
      else if (a.closest('.blk-text')) e.preventDefault();
    });
    el.addEventListener('dragover', (e) => this.onDragOver(e));
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) this.clearDrop(); });
    el.addEventListener('drop', (e) => this.onDrop(e));
    this.selHandler = () => this.updateBubble();
    document.addEventListener('selectionchange', this.selHandler);
  }

  destroy() {
    document.removeEventListener('selectionchange', this.selHandler);
    this.bubble?.remove();
    this.closeMenu();
  }

  blockOf(target) {
    const row = target.closest?.('.blk');
    return row ? this.blocks[this.index(row.dataset.id)] : null;
  }

  syncFromDom(b) {
    const t = this.textEl(b.id);
    if (!t) return;
    b.x = b.t === 'code' ? t.innerText.replace(/\n$/, '') : htmlToInline(t);
  }

  onInput(e) {
    const t = e.target.closest('.blk-text');
    const b = t && this.blockOf(t);
    if (!b) return;
    this.syncFromDom(b);
    if (b.t !== 'code' && e.inputType?.startsWith('insert') && this.markdownShortcut(b, t, (e.data || '').length)) return;
    this.changed(b);
    if (b.t !== 'code') this.checkTriggers(b, t);
  }

  /** "# ", "- ", "[] ", "> ", "```" … at the start of a text block turn it into that block type, as soon as the prefix is typed. */
  markdownShortcut(b, t, inserted) {
    if (b.t !== 'p') return false;
    const text = t.textContent;
    const off = caretOffset(t);
    const rules = [[/^###\s/, 'h3'], [/^##\s/, 'h2'], [/^#\s/, 'h1'], [/^[-*+]\s/, 'ul'], [/^1[.)]\s/, 'ol'], [/^\[\s?\]\s/, 'todo'],
      [/^\[x\]\s/i, 'todo', true], [/^>\s/, 'quote'], [/^```/, 'code'], [/^---$/, 'hr'], [/^\|>\s/, 'toggle'], [/^!\s/, 'callout']];
    for (const [re, type, checked] of rules) {
      const m = re.exec(text);
      // Only when the characters just typed complete the prefix, so editing text that happens to start with "# " later does nothing.
      if (!m || off - inserted > m[0].length || off < m[0].length) continue;
      b.t = type;
      b.x = htmlToInline(t).slice(m[0].length).trim();
      if (checked) b.c = true;
      if (type === 'hr') {
        const next = this.newBlock('p', '', b.ind ? { ind: b.ind } : {});
        this.blocks.splice(this.index(b.id) + 1, 0, next);
        this.changed(b);
        this.rerender(next.id, 'start');
        return true;
      }
      this.changed(b);
      this.rerender(b.id, Math.max(0, off - m[0].length));
      return true;
    }
    return false;
  }

  // ---------- Slash menu and [[page links ----------

  checkTriggers(b, t) {
    const before = t.textContent.slice(0, caretOffset(t));
    const slash = /(?:^|\s)\/([\p{L}\d ]{0,24})$/u.exec(before);
    const link = /\[\[([^\]\n]{0,40})$/.exec(before);
    if (link) return this.openMenu('link', b, t, before.length - link[0].length, link[1]);
    if (slash && !/\s{2}$/.test(slash[1])) return this.openMenu('slash', b, t, before.length - slash[1].length - 1, slash[1]);
    this.closeMenu();
  }

  slashItems(q) {
    const items = [
      ...BLOCK_TYPES.map((x) => ({ label: x.label, ico: x.ico, keys: x.keys, run: (b) => this.convert(b, x.t) })),
      { label: 'Image', ico: '🖼', keys: 'image picture photo upload', run: (b) => this.pickFile(b, 'image/*') },
      { label: 'File', ico: '📎', keys: 'file attachment pdf upload', run: (b) => this.pickFile(b, '') },
      { label: 'Web bookmark', ico: '🔗', keys: 'bookmark link url web embed', run: (b) => this.addBookmark(b) },
      { label: 'Sub-page', ico: '📄', keys: 'page subpage child new nested', run: (b) => this.addSubPage(b) },
      { label: 'Link to page', ico: '↗', keys: 'link page mention reference', run: (b) => this.openLinkPickerFor(b) },
      { label: 'Database', ico: '▦', keys: 'database table board kanban calendar', run: (b) => this.addSubPage(b, true) },
      { label: "Today's date", ico: '📅', keys: 'date today due', run: (b) => this.insertText(b, '@' + new Date().toISOString().slice(0, 10) + ' ') },
    ];
    if (this.opts.ai) {
      items.push(
        { label: 'AI: Continue writing', ico: '✨', keys: 'ai continue write', run: (b) => this.aiInsert(b, 'continue') },
        { label: 'AI: Summarize page', ico: '✨', keys: 'ai summarize summary tldr', run: (b) => this.aiInsert(b, 'summarize') },
        { label: 'AI: Find action items', ico: '✨', keys: 'ai action items tasks todo', run: (b) => this.aiInsert(b, 'actions') },
        { label: 'AI: Draft from a topic', ico: '✨', keys: 'ai draft outline write generate', run: (b) => this.aiInsert(b, 'outline') },
      );
    }
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.label.toLowerCase().includes(s) || i.keys.includes(s)) : items;
  }

  openMenu(kind, b, t, start, query) {
    const items = kind === 'slash' ? this.slashItems(query) : this.linkItems(query);
    if (kind === 'slash' && !items.length) return this.closeMenu();
    const prev = this.menu;
    this.menu = { kind, blockId: b.id, start, query, items, sel: prev && prev.kind === kind ? Math.min(prev.sel, items.length - 1) : 0 };
    this.drawMenu(t);
  }

  linkItems(q) {
    const found = (this.opts.pickPage?.(q) || []).slice(0, 8).map((p) => ({ label: p.title || 'Untitled', ico: p.icon || '📄', run: (b) => this.insertLink(b, p.id, p.title || 'Untitled') }));
    if (q.trim()) found.push({ label: `Create page “${q.trim()}”`, ico: '+', run: async (b) => { const id = await this.opts.createPage?.(q.trim()); if (id) this.insertLink(b, id, q.trim()); } });
    return found;
  }

  drawMenu(t) {
    const m = this.menu;
    if (!this.menuEl) this.menuEl = h('div', { class: 'pop' });
    const pop = this.menuEl;
    pop.replaceChildren(h('div', { class: 'pop-head' }, m.kind === 'slash' ? 'Blocks' : 'Link to page'),
      ...m.items.map((it, i) => h('div', { class: 'item' + (i === m.sel ? ' sel' : ''), onmousedown: (e) => { e.preventDefault(); this.pickMenu(i); } },
        h('span', { class: 'ico' }, it.ico), h('span', {}, it.label))),
      ...(m.items.length ? [] : [h('div', { class: 'item muted' }, 'Type to search pages')]));
    if (!pop.isConnected) { document.body.append(pop); setOpenPop(pop); }
    const sel = getSelection();
    const rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : t.getBoundingClientRect();
    placePop(pop, null, { x: rect.left || t.getBoundingClientRect().left, y: rect.bottom || t.getBoundingClientRect().bottom });
    pop.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  closeMenu() {
    if (this.menuEl?.isConnected) closePop();
    this.menuEl = null;
    this.menu = null;
  }

  async pickMenu(i) {
    const m = this.menu;
    const it = m?.items[i];
    if (!it) return;
    const b = this.blocks[this.index(m.blockId)];
    const t = this.textEl(b.id);
    // Remove the "/query" or "[[query" text that opened the menu.
    const end = caretOffset(t);
    const r = rangeFor(t, m.start, Math.max(end, m.start));
    r.deleteContents();
    this.syncFromDom(b);
    this.closeMenu();
    setCaret(t, m.start);
    await it.run(b);
  }

  // ---------- Keyboard ----------

  onKey(e) {
    const t = e.target.closest('.blk-text');
    const b = t && this.blockOf(t);
    if (!b) return;
    const mod = e.ctrlKey || e.metaKey;
    if (this.menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.menu.items.length;
        this.menu.sel = (this.menu.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % Math.max(1, n);
        return this.drawMenu(t);
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return this.pickMenu(this.menu.sel); }
      if (e.key === 'Escape') { e.preventDefault(); return this.closeMenu(); }
    }
    const sel = getSelection();
    const collapsed = sel.isCollapsed;
    const off = caretOffset(t);
    const len = t.textContent.length;

    if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); return this.format('bold'); }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); return this.format('italic'); }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); return this.format('code'); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'x') { e.preventDefault(); return this.format('strike'); }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); return this.format('link'); }
    if (mod && e.key === 'Enter' && b.t === 'todo') { e.preventDefault(); b.c = !b.c || undefined; this.changed(b); return this.rerender(b.id, off); }
    if (mod && e.key.toLowerCase() === 'd' && e.shiftKey) { e.preventDefault(); return this.duplicate(b); }
    if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); return this.move(b, e.key === 'ArrowUp' ? -1 : 1); }

    if (b.t === 'code') {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); return; }
      if (e.key === 'Enter' && !mod) { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
      if (e.key === 'Enter' && mod) { e.preventDefault(); return this.addBelow(b.id); }
    }

    if (e.key === 'Enter' && !e.shiftKey && b.t !== 'code') { e.preventDefault(); return this.split(b, t); }
    if (e.key === 'Tab') { e.preventDefault(); return this.indent(b, e.shiftKey ? -1 : 1, off); }
    if (e.key === 'Backspace' && collapsed && off === 0) { e.preventDefault(); return this.backspaceAtStart(b, t); }
    if (e.key === 'Delete' && collapsed && off === len) { e.preventDefault(); return this.mergeNext(b, t); }
    if (e.key === 'ArrowUp' && collapsed && !e.shiftKey && caretOnEdgeLine(t, 'up')) { const p = this.neighbour(b, -1); if (p) { e.preventDefault(); this.focusBlock(p.id, 'end'); } }
    if (e.key === 'ArrowDown' && collapsed && !e.shiftKey && caretOnEdgeLine(t, 'down')) { const n = this.neighbour(b, 1); if (n) { e.preventDefault(); this.focusBlock(n.id, 'start'); } }
  }

  neighbour(b, dir) {
    for (let i = this.index(b.id) + dir; i >= 0 && i < this.blocks.length; i += dir) {
      const x = this.blocks[i];
      if (TEXT_TYPES.has(x.t) && !this.textEl(x.id)?.closest('.collapsed-child')) return x;
    }
    return null;
  }

  split(b, t) {
    const sel = getSelection();
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const off = caretOffset(t);
    const textEmpty = t.textContent.trim() === '';
    // Empty list item: leave the list (outdent first).
    if (textEmpty && (KEEP_ON_ENTER.has(b.t) || b.t === 'toggle' || b.t === 'quote' || b.t === 'callout')) {
      if (b.ind) b.ind--; else { b.t = 'p'; delete b.c; }
      this.changed(b);
      return this.rerender(b.id, 'start');
    }
    const i = this.index(b.id);
    if (off === 0 && !textEmpty) {
      const above = this.newBlock(KEEP_ON_ENTER.has(b.t) ? b.t : 'p', '', b.ind ? { ind: b.ind } : {});
      this.blocks.splice(i, 0, above);
      this.changed(above);
      return this.rerender(b.id, 'start');
    }
    const after = r.cloneRange();
    after.setEnd(t, t.childNodes.length);
    const holder = document.createElement('div');
    holder.append(after.extractContents());
    b.x = htmlToInline(t);
    const rest = htmlToInline(holder);
    let type = KEEP_ON_ENTER.has(b.t) ? b.t : 'p';
    let ind = b.ind || 0;
    if (b.t === 'toggle') { type = 'p'; if (b.c) ind++; }
    const next = this.newBlock(type, rest, ind ? { ind } : {});
    this.blocks.splice(i + 1, 0, next);
    this.changed(b);
    this.rerender(next.id, 'start');
  }

  indent(b, dir, off) {
    const i = this.index(b.id);
    const prevInd = i > 0 ? this.blocks[i - 1].ind || 0 : -1;
    const n = Math.max(0, Math.min(8, (b.ind || 0) + dir, prevInd + 1));
    if (n === (b.ind || 0)) return;
    b.ind = n || undefined;
    this.changed(b);
    this.rerender(b.id, off);
  }

  backspaceAtStart(b, t) {
    if (b.t !== 'p' && b.t !== 'code') { b.t = 'p'; delete b.c; this.changed(b); return this.rerender(b.id, 'start'); }
    if (b.ind) { b.ind--; this.changed(b); return this.rerender(b.id, 'start'); }
    const i = this.index(b.id);
    if (i === 0) return;
    const prev = this.blocks[i - 1];
    if (!TEXT_TYPES.has(prev.t)) { this.blocks.splice(i - 1, 1); this.changed(); return this.rerender(b.id, 'start'); }
    const joinAt = this.textEl(prev.id)?.textContent.length ?? 0;
    this.syncFromDom(b);
    prev.x = (prev.x || '') + (b.x || '');
    this.blocks.splice(i, 1);
    this.changed(prev);
    this.rerender(prev.id, joinAt);
  }

  mergeNext(b, t) {
    const i = this.index(b.id);
    const next = this.blocks[i + 1];
    if (!next) return;
    const at = t.textContent.length;
    this.syncFromDom(b);
    if (TEXT_TYPES.has(next.t)) b.x = (b.x || '') + (next.x || '');
    this.blocks.splice(i + 1, 1);
    this.changed(b);
    this.rerender(b.id, at);
  }

  // ---------- Block operations ----------

  convert(b, type) {
    if (type === 'hr') {
      const i = this.index(b.id);
      if (!b.x) b.t = 'hr'; else this.blocks.splice(i + 1, 0, this.newBlock('hr'));
      const next = this.newBlock('p');
      this.blocks.splice(this.index(b.id) + (b.t === 'hr' ? 1 : 2), 0, next);
      this.changed(b);
      return this.rerender(next.id, 'start');
    }
    b.t = type;
    if (type !== 'todo' && type !== 'toggle') delete b.c;
    if (type === 'toggle') b.c = true;
    this.changed(b);
    this.rerender(b.id, 'end');
  }

  addBelow(id, block) {
    const i = this.index(id);
    const src = this.blocks[i];
    const nb = block || this.newBlock('p', '', src?.ind ? { ind: src.ind } : {});
    this.blocks.splice(i + 1, 0, nb);
    this.changed(nb);
    this.rerender(nb.id, 'start');
    return nb;
  }

  insertBlocks(b, list) {
    if (!list.length) return;
    const i = this.index(b.id);
    const replace = TEXT_TYPES.has(b.t) && !(b.x || '').trim() && b.t === 'p';
    const fresh = list.map((x) => ({ ...x, id: x.id || uuid(), u: now() }));
    this.blocks.splice(replace ? i : i + 1, replace ? 1 : 0, ...fresh);
    this.changed(fresh[0]);
    const last = [...fresh].reverse().find((x) => TEXT_TYPES.has(x.t));
    this.rerender(last?.id, 'end');
  }

  insertText(b, text) {
    const t = this.textEl(b.id);
    t.focus();
    document.execCommand('insertText', false, text);
    this.syncFromDom(b);
    this.changed(b);
  }

  insertLink(b, id, title) {
    const t = this.textEl(b.id);
    t.focus();
    const sel = getSelection();
    const r = sel.getRangeAt(0);
    const a = h('a', { 'data-note': id, href: '#' }, title);
    r.insertNode(a);
    const space = document.createTextNode(' ');
    a.after(space);
    r.setStartAfter(space);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    this.syncFromDom(b);
    this.changed(b);
  }

  openLinkPickerFor(b) {
    this.insertText(b, '[[');
    this.checkTriggers(b, this.textEl(b.id));
  }

  duplicate(b) {
    const copy = { ...b, id: uuid(), u: now() };
    this.blocks.splice(this.index(b.id) + 1, 0, copy);
    this.changed(copy);
    this.rerender(copy.id);
  }

  remove(b) {
    const i = this.index(b.id);
    this.blocks.splice(i, 1);
    if (!this.blocks.length) this.blocks.push(this.newBlock('p'));
    this.changed();
    const near = this.blocks[Math.min(i, this.blocks.length - 1)];
    this.rerender(near.id, 'end');
  }

  move(b, dir) {
    const i = this.index(b.id);
    const j = i + dir;
    if (j < 0 || j >= this.blocks.length) return;
    [this.blocks[i], this.blocks[j]] = [this.blocks[j], this.blocks[i]];
    this.changed(b);
    this.rerender(b.id, 'end');
  }

  blockMenu(anchor, b) {
    const turn = BLOCK_TYPES.filter((x) => x.t !== 'hr').map((x) => ({ label: x.label, icon: h('span', { style: { fontSize: '11px', fontWeight: 700 } }, x.ico), checked: b.t === x.t,
      run: () => this.convert(b, x.t) }));
    const colors = ['default', 'gray', 'blue', 'green', 'yellow', 'red', 'purple'].map((c) => ({ label: c[0].toUpperCase() + c.slice(1), checked: (b.col || 'default') === c,
      run: () => { b.col = c === 'default' ? undefined : c; this.changed(b); this.rerender(); } }));
    popMenu(anchor, [
      TEXT_TYPES.has(b.t) ? { label: 'Turn into', icon: 'chevron', sub: turn } : null,
      { label: 'Color', icon: 'sun', sub: colors },
      { label: 'Duplicate', icon: 'copy', hint: 'Ctrl+Shift+D', run: () => this.duplicate(b) },
      { label: 'Move up', icon: 'back', hint: 'Alt+Shift+↑', run: () => this.move(b, -1) },
      { label: 'Move down', icon: 'down', hint: 'Alt+Shift+↓', run: () => this.move(b, 1) },
      this.opts.comment ? { label: 'Comment', icon: 'chat', run: () => this.opts.comment(b.id, b.x) } : null,
      this.opts.ai && TEXT_TYPES.has(b.t) ? { label: 'Improve writing', icon: 'sparkles', run: () => this.aiReplace(b) } : null,
      '-',
      { label: 'Delete', icon: 'trash', danger: true, hint: 'Del', run: () => this.remove(b) },
    ]);
  }

  // ---------- Media ----------

  pickFile(b, accept) {
    const input = h('input', { type: 'file', accept, multiple: true });
    input.onchange = () => this.uploadFiles(b, [...input.files]);
    input.click();
  }

  async uploadFiles(b, files) {
    if (!this.opts.upload) return;
    for (const f of files) {
      try {
        toast(`Uploading ${f.name}…`);
        const up = await this.opts.upload(f);
        const isImg = /^image\//.test(up.mime);
        const nb = this.newBlock(isImg ? 'img' : 'file', '', { src: up.url, cap: isImg ? '' : up.name });
        this.blocks.splice(this.index(b.id) + 1, 0, nb);
        b = nb;
        this.changed(nb);
        this.rerender();
      } catch (e) {
        toast(e.message, { error: true });
      }
    }
  }

  async addBookmark(b) {
    const url = await promptBox('Add a web bookmark', { label: 'Link', placeholder: 'https://' });
    if (!url) return;
    const src = /^https?:\/\//.test(url) ? url : 'https://' + url;
    this.insertBlocks(b, [{ t: 'bookmark', x: src.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], src }]);
  }

  async addSubPage(b, database = false) {
    const id = await this.opts.createChild?.(database);
    if (!id) return;
    this.insertBlocks(b, [{ t: 'page', x: database ? 'Untitled database' : 'Untitled', src: id }]);
  }

  async aiInsert(b, action) {
    let extra = {};
    if (action === 'outline') {
      const topic = await promptBox('Draft a page with AI', { label: 'What should it be about?', placeholder: 'Onboarding plan for a new engineer', ok: 'Draft' });
      if (!topic) return;
      extra = { topic };
    }
    try {
      toast('✨ Thinking…');
      const blocks = await this.opts.ai(action, extra);
      this.insertBlocks(b, blocks || []);
    } catch (e) {
      toast(e.message, { error: true });
    }
  }

  async aiReplace(b, selection) {
    try {
      toast('✨ Improving…');
      const blocks = await this.opts.ai('improve', { selection: selection || b.x });
      if (!blocks?.length) return;
      if (selection) { this.insertText(b, blocks.map((x) => x.x).join(' ')); return; }
      const i = this.index(b.id);
      this.blocks.splice(i, 1, ...blocks.map((x) => ({ ...x, id: uuid(), u: now() })));
      this.changed();
      this.rerender();
    } catch (e) {
      toast(e.message, { error: true });
    }
  }

  // ---------- Paste & drag-and-drop ----------

  onPaste(e) {
    const t = e.target.closest('.blk-text');
    const b = t && this.blockOf(t);
    if (!b) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); return this.uploadFiles(b, files); }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    e.preventDefault();
    if (b.t === 'code' || !text.includes('\n')) {
      if (/^https?:\/\/\S+$/.test(text.trim()) && !getSelection().isCollapsed) {
        document.execCommand('createLink', false, text.trim());
      } else document.execCommand('insertText', false, text);
      this.syncFromDom(b);
      return this.changed(b);
    }
    this.insertBlocks(b, markdownToBlocks(text));
  }

  onDragOver(e) {
    const isBlock = e.dataTransfer.types.includes('text/x-pliopad-block');
    const isFile = e.dataTransfer.types.includes('Files');
    if (this.readOnly || (!isBlock && !isFile)) return;
    e.preventDefault();
    const row = e.target.closest('.blk');
    this.clearDrop();
    if (!row) return;
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  }

  clearDrop() { this.el.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); }

  onDrop(e) {
    const row = this.el.querySelector('.drop-before, .drop-after');
    const before = row?.classList.contains('drop-before');
    this.clearDrop();
    if (!row) return;
    e.preventDefault();
    const target = this.blocks[this.index(row.dataset.id)];
    const id = e.dataTransfer.getData('text/x-pliopad-block');
    if (id) {
      if (id === target.id) return;
      const [moved] = this.blocks.splice(this.index(id), 1);
      this.blocks.splice(this.index(target.id) + (before ? 0 : 1), 0, moved);
      moved.u = now();
      this.changed(moved);
      return this.rerender();
    }
    const files = [...e.dataTransfer.files];
    if (files.length) {
      const anchor = before ? this.blocks[this.index(target.id) - 1] || target : target;
      this.uploadFiles(anchor, files);
    }
  }

  // ---------- Selection bubble ----------

  updateBubble() {
    if (this.readOnly) return;
    const sel = getSelection();
    const t = sel.rangeCount && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('.blk-text') : null;
    if (!t || sel.isCollapsed || !this.el.contains(t) || !t.contains(sel.focusNode) || this.blockOf(t)?.t === 'code') {
      this.bubble?.remove();
      return;
    }
    if (!this.bubble) {
      const btn = (label, title, act, style) => h('button', { title, style, onmousedown: (e) => { e.preventDefault(); act(); } }, label);
      this.bubble = h('div', { class: 'bubble' },
        btn('B', 'Bold (Ctrl+B)', () => this.format('bold'), { fontWeight: 800 }),
        btn('i', 'Italic (Ctrl+I)', () => this.format('italic'), { fontStyle: 'italic', fontFamily: 'serif' }),
        btn('S', 'Strikethrough', () => this.format('strike'), { textDecoration: 'line-through' }),
        btn('<>', 'Code (Ctrl+E)', () => this.format('code'), { fontFamily: 'monospace', fontSize: '12px' }),
        btn(icon('link'), 'Link (Ctrl+K)', () => this.format('link')),
        this.opts.ai ? btn(icon('sparkles'), 'Improve with AI', () => { const b = this.blockOf(t); this.aiReplace(b, getSelection().toString()); }) : null,
        this.opts.comment ? btn(icon('chat'), 'Comment', () => { const b = this.blockOf(t); this.opts.comment(b.id, getSelection().toString()); }) : null);
    }
    if (!this.bubble.isConnected) document.body.append(this.bubble);
    const r = sel.getRangeAt(0).getBoundingClientRect();
    this.bubble.style.left = Math.max(8, Math.min(r.left + r.width / 2 - this.bubble.offsetWidth / 2, innerWidth - this.bubble.offsetWidth - 8)) + 'px';
    this.bubble.style.top = Math.max(8, r.top - this.bubble.offsetHeight - 8) + 'px';
  }

  async format(kind) {
    const sel = getSelection();
    const t = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('.blk-text');
    const b = t && this.blockOf(t);
    if (!b || b.t === 'code') return;
    if (kind === 'bold') document.execCommand('bold');
    else if (kind === 'italic') document.execCommand('italic');
    else if (kind === 'strike') document.execCommand('strikeThrough');
    else if (kind === 'code') {
      const r = sel.getRangeAt(0);
      const inCode = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest('code');
      if (inCode) inCode.replaceWith(document.createTextNode(inCode.textContent));
      else if (!r.collapsed) { const c = document.createElement('code'); c.textContent = r.toString(); r.deleteContents(); r.insertNode(c); }
    } else if (kind === 'link') {
      const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      const url = await promptBox('Add link', { label: 'URL', placeholder: 'https://' });
      if (!url || !saved) return;
      sel.removeAllRanges();
      sel.addRange(saved);
      document.execCommand('createLink', false, /^(https?:|mailto:)/.test(url) ? url : 'https://' + url);
    }
    this.syncFromDom(b);
    this.changed(b);
  }
}
