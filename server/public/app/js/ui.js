// Small UI toolkit: element builder, icons, toasts, menus, modals and formatting helpers.

// Views build children with `cond ? h(...) : null`; let append/replaceChildren skip those instead of printing "null".
for (const method of ['append', 'replaceChildren']) {
  const native = Element.prototype[method];
  Element.prototype[method] = function (...nodes) { return native.apply(this, nodes.filter((n) => n !== null && n !== undefined && n !== false)); };
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checksq: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  graph: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8M18 8l-5 8"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  board: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  gallery: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  page: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
};

export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'i ' + cls);
  s.innerHTML = PATHS[name] || '';
  return s;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = () => { clearTimeout(t); fn(); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const store = {
  get(k, def = null) { try { const v = localStorage.getItem('pliopad.' + k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('pliopad.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('pliopad.' + k); } catch { /* ignore */ } },
};

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
}));

// ---- Toasts ----
let toastWrap;
export function toast(msg, { error = false, action = null, ms = 3500 } = {}) {
  toastWrap ||= document.body.appendChild(h('div', { class: 'toast-wrap' }));
  const t = h('div', { class: 'toast' + (error ? ' err' : '') }, msg, action && h('button', { onclick: () => { action.run(); t.remove(); } }, action.label));
  toastWrap.append(t);
  setTimeout(() => t.remove(), action ? ms * 2 : ms);
}

// ---- Floating menu ----
let openPop = null;
export function closePop() { openPop?.remove(); openPop = null; document.removeEventListener('mousedown', onDocDown, true); }
function onDocDown(e) { if (openPop && !openPop.contains(e.target)) closePop(); }

/** items: [{label, icon, hint, danger, run, sub:[...]}, '-' for a divider, {head:'Title'}] */
export function popMenu(anchor, items, { small = true, align = 'left', x, y } = {}) {
  closePop();
  const pop = h('div', { class: 'pop' + (small ? ' small' : '') });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { pop.append(h('hr')); continue; }
    if (it.head) { pop.append(h('div', { class: 'pop-head' }, it.head)); continue; }
    if (it.el) { pop.append(it.el); continue; }
    pop.append(h('div', { class: 'item' + (it.danger ? ' danger' : ''), onclick: (e) => {
      e.stopPropagation();
      if (it.sub) return popMenu(e.currentTarget, it.sub, { small });
      closePop();
      it.run?.();
    } }, it.icon ? h('span', { class: 'ico' }, typeof it.icon === 'string' && PATHS[it.icon] ? icon(it.icon) : it.icon) : null,
    h('span', { class: 'grow ellipsis' }, it.label), it.hint ? h('span', { class: 'hint' }, it.hint) : null,
    it.sub ? icon('chevron') : null, it.checked ? icon('check') : null));
  }
  document.body.append(pop);
  placePop(pop, anchor, { align, x, y });
  openPop = pop;
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true));
  return pop;
}

export function placePop(pop, anchor, { align = 'left', x, y } = {}) {
  const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, bottom: y, top: y };
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = align === 'right' ? r.right - pw : r.left;
  let top = r.bottom + 4;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 4);
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

export function setOpenPop(p) { closePop(); openPop = p; setTimeout(() => document.addEventListener('mousedown', onDocDown, true)); }

// ---- Modals ----
export function modal(title, body, { wide = false, actions = [], onClose } = {}) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'modal' + (wide ? ' wide' : '') },
      title ? h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'btn icon', onclick: close, 'aria-label': 'Close' }, icon('x'))) : null,
      h('div', { class: 'modal-body' }, body),
      actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', { class: 'btn ' + (a.primary ? 'primary' : '') + (a.danger ? ' danger' : ''),
        onclick: async () => { if ((await a.run?.()) !== false) close(); } }, a.label))) : null));
  document.body.append(ov);
  document.addEventListener('keydown', onKey);
  setTimeout(() => ov.querySelector('input, textarea, select')?.focus(), 20);
  return { close, el: ov };
}

export function confirmBox(title, text, { ok = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal(title, h('p', { style: { margin: 0 } }, text), {
      actions: [{ label: 'Cancel', run: () => { done = true; resolve(false); } }, { label: ok, primary: !danger, danger, run: () => { done = true; resolve(true); } }],
      onClose: () => !done && resolve(false),
    });
  });
}

export function promptBox(title, { label = '', value = '', placeholder = '', ok = 'Save', type = 'text' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', value, placeholder, type });
    const m = modal(title, h('label', { class: 'field' }, label ? h('span', {}, label) : null, input), {
      actions: [{ label: 'Cancel', run: () => { done = true; resolve(null); } }, { label: ok, primary: true, run: () => { done = true; resolve(input.value.trim()); } }],
      onClose: () => !done && resolve(null),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; resolve(input.value.trim()); m.close(); } });
    setTimeout(() => input.select(), 30);
  });
}

// ---- Emoji picker ----
const EMOJI = '📄 📝 📓 📒 📕 📗 📘 📙 📚 🗂️ 📁 📌 📍 🗒️ 🗓️ 📅 📊 📈 🧭 🗺️ 🚀 💡 ⭐ ✅ ☑️ 🎯 🔥 ⚡ 🧠 💬 📣 🔖 🏷️ 🔒 🔑 🧪 🛠️ ⚙️ 💼 🏢 🏠 🌱 🌍 ✈️ 🍳 🎨 🎵 📷 🎬 💰 🧾 📦 🛒 ❤️ 👋 🙂 🤝 👥 🐛 🧩 🎓 🏆 📮 ☕'.split(' ');
export function emojiPicker(anchor, onPick) {
  const grid = h('div', { class: 'emoji-grid' }, EMOJI.map((e) => h('button', { onclick: () => { closePop(); onPick(e); } }, e)),
    h('button', { title: 'Remove icon', onclick: () => { closePop(); onPick(null); } }, '✕'));
  return popMenu(anchor, [{ el: grid }]);
}

// ---- Formatting ----
export function relTime(ms) {
  if (!ms) return '';
  const d = (Date.now() - ms) / 1000;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 6) return `${Math.round(d / 86400)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const avatar = (u, size = 24) => h('span', { class: 'avatar', title: u.name, style: { background: u.color || '#6366f1', width: size + 'px', height: size + 'px' } }, initials(u.name));
export const fmtBytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

/** Minimal, safe Markdown → HTML for AI answers. */
export function mdToHtml(md) {
  const lines = esc(md).split('\n');
  let out = '';
  let inList = false;
  for (const l of lines) {
    const li = /^\s*[-*]\s+(\[[ x]\]\s*)?(.*)$/.exec(l);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1] ? (li[1].includes('x') ? '☑ ' : '☐ ') : ''}${inline(li[2])}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    const hd = /^(#{1,3})\s+(.*)$/.exec(l);
    if (hd) out += `<h${hd[1].length + 1}>${inline(hd[2])}</h${hd[1].length + 1}>`;
    else if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  return out + (inList ? '</ul>' : '');
  function inline(s) { return s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>'); }
}
