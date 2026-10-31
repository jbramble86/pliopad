// Shared by the Help center and the admin console: attachments for support requests, and how articles are shown.
import { h, icon, toast, fmtBytes } from './ui.js';
import { uploadSupportFile } from './api.js';

/** An "Attach" button plus the files picked so far (uploaded straight away). ids() lists them for the message. */
export function attachPicker() {
  let files = [];
  const chips = h('div', { class: 'sp-chips' });
  const input = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/*,.pdf,.txt,.log,.zip,.json,.csv' });
  const draw = () => chips.replaceChildren(...files.map((f) => h('span', { class: 'sp-chip' + (f.id ? '' : ' busy') }, icon('page'), f.name,
    f.id ? h('button', { class: 'btn icon', title: 'Remove', onclick: () => { files = files.filter((x) => x !== f); draw(); } }, icon('x')) : ' …')));
  input.addEventListener('change', async () => {
    for (const file of [...input.files].slice(0, 5 - files.length)) {
      const entry = { name: file.name };
      files.push(entry);
      draw();
      try { Object.assign(entry, await uploadSupportFile(file)); } catch (e) { files = files.filter((x) => x !== entry); toast(e.message, { error: true }); }
      draw();
    }
    input.value = '';
  });
  const button = h('button', { class: 'btn', type: 'button', title: 'Attach screenshots or files (up to 5, 10 MB each)', onclick: () => input.click() }, icon('upload'), 'Attach');
  return { button, chips, input, ids: () => files.filter((f) => f.id).map((f) => f.id), busy: () => files.some((f) => !f.id), clear: () => { files = []; draw(); } };
}

/** A message's attachments: image thumbnails and file links. */
export function messageFiles(files = []) {
  if (!files.length) return null;
  return h('div', { class: 'sp-files' }, files.map((f) => f.mime.startsWith('image/')
    ? h('a', { class: 'sp-thumb', href: f.url, target: '_blank', rel: 'noopener', title: f.name }, h('img', { src: f.url, alt: f.name, loading: 'lazy' }))
    : h('a', { class: 'sp-file', href: f.url, target: '_blank', rel: 'noopener' }, icon('download'), f.name, h('span', { class: 'muted' }, ' · ' + fmtBytes(f.size)))));
}

/** Article bodies: paragraphs separated by blank lines; "- " and "1. " lines become lists. */
export function articleBody(text) {
  return text.split(/\n\s*\n/).map((para) => {
    const lines = para.split('\n');
    if (lines.every((l) => /^- /.test(l))) return h('ul', {}, lines.map((l) => h('li', {}, l.slice(2))));
    if (lines.every((l) => /^\d+\. /.test(l))) return h('ol', {}, lines.map((l) => h('li', {}, l.replace(/^\d+\. /, ''))));
    return h('p', {}, lines.map((l, i) => [i ? h('br') : null, /^- /.test(l) ? '• ' + l.slice(2) : l]));
  });
}
