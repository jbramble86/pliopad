// Note content is a flat list of blocks: { id, t, x, ind?, c?, lang?, src?, cap?, col?, u }
//   t    type: p h1 h2 h3 todo ul ol quote code hr callout img file toggle page bookmark
//   x    text with light inline markup: **bold** *italic* ~~strike~~ `code` [label](url) [Title](note:ID)
//   ind  indent level · c checked (todo) / open (toggle) · u last-edit time in ms (drives merging)
import { parse } from 'node-html-parser';
import { uuid, nowMs, isUuid, escapeHtml } from './util.js';

export const TYPES = ['p', 'h1', 'h2', 'h3', 'todo', 'ul', 'ol', 'quote', 'code', 'hr', 'callout', 'img', 'file', 'toggle', 'page', 'bookmark'];

export function sanitize(blocks) {
  if (!Array.isArray(blocks)) return [];
  const seen = new Set();
  const out = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    let id = typeof b.id === 'string' && b.id.length <= 40 ? b.id : uuid();
    if (seen.has(id)) id = uuid();
    seen.add(id);
    const clean = { id, t: TYPES.includes(b.t) ? b.t : 'p', x: String(b.x ?? '').slice(0, 20000), u: Number(b.u) || 0 };
    if (b.ind) clean.ind = Math.max(0, Math.min(8, Number(b.ind) | 0));
    if (b.c) clean.c = true;
    for (const k of ['lang', 'src', 'cap', 'col']) if (typeof b[k] === 'string') clean[k] = b[k].slice(0, 2000);
    out.push(clean);
  }
  return out;
}

/**
 * Block-level merge, so two people (or a phone that was offline) editing different parts of a note never get a
 * conflict copy. `base` is when the client last saw the server's version of the note.
 */
export function merge(server, client, base) {
  const sIdx = new Map(server.map((b, i) => [b.id, i]));
  const cIds = new Set(client.map((b) => b.id));
  const result = [];
  for (const b of client) {
    if (sIdx.has(b.id)) {
      const sb = server[sIdx.get(b.id)];
      result.push((sb.u || 0) > (b.u || 0) ? sb : b);
    } else if ((b.u || 0) > base) {
      result.push(b); // new on the client
    } // otherwise the server deleted it after the client's copy was taken
  }
  // Blocks only the server has: added after the client's base are kept (next to their old neighbour); older ones were deleted by the client.
  server.forEach((sb, i) => {
    if (cIds.has(sb.id) || (sb.u || 0) <= base) return;
    let pos = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = result.findIndex((r) => r.id === server[j].id);
      if (k >= 0) { pos = k + 1; break; }
    }
    result.splice(pos, 0, sb);
  });
  return result;
}

export const inlineToPlain = (x) =>
  String(x).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|~~|`/g, '').replace(/(?<!\*)\*(?!\*)/g, '');

export function plain(blocks) {
  return blocks
    .filter((b) => b.t !== 'hr')
    .map((b) => inlineToPlain(b.x || '') + (b.cap ? ' ' + b.cap : ''))
    .filter((l) => l.trim() !== '')
    .join('\n');
}

/** Note ids this content links to: inline [Title](note:ID) links and child page blocks. */
export function links(blocks) {
  const ids = new Set();
  for (const b of blocks) {
    for (const m of String(b.x || '').matchAll(/\(note:([0-9a-f-]{36})\)/gi)) ids.add(m[1]);
    if (b.t === 'page' && isUuid(b.src)) ids.add(b.src);
  }
  return [...ids];
}

export const block = (t, x = '', extra = {}) => ({ id: uuid(), t, x, u: nowMs(), ...extra });

// ---------- Import ----------

export function fromMarkdown(md) {
  const blocks = [];
  let code = null;
  for (const line of String(md).split(/\r?\n/)) {
    if (code) {
      if (/^\s*```/.test(line)) { blocks.push(block('code', code.lines.join('\n'), { lang: code.lang })); code = null; }
      else code.lines.push(line);
      continue;
    }
    let m = /^\s*```(\w*)/.exec(line);
    if (m) { code = { lang: m[1], lines: [] }; continue; }
    if (!line.trim()) continue;
    const ind = Math.min(8, Math.floor((line.length - line.trimStart().length) / 2));
    const t = line.trim();
    const extra = ind ? { ind } : {};
    if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) blocks.push(block('h' + m[1].length, m[2]));
    else if ((m = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(t))) blocks.push(block('todo', m[2], { ...extra, ...(m[1].trim() ? { c: true } : {}) }));
    else if ((m = /^[-*+]\s+(.*)$/.exec(t))) blocks.push(block('ul', m[1], extra));
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) blocks.push(block('ol', m[1], extra));
    else if ((m = /^>\s?(.*)$/.exec(t))) blocks.push(block('quote', m[1]));
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) blocks.push(block('hr'));
    else if ((m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(t))) blocks.push(block('img', '', { src: m[2], cap: m[1] }));
    else blocks.push(block('p', t, extra));
  }
  if (code) blocks.push(block('code', code.lines.join('\n'), { lang: code.lang }));
  return blocks;
}

const BLOCK_TAGS = new Set(['div', 'p', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'pre', 'blockquote', 'hr', 'en-media', 'img', 'figure', 'section', 'article', 'header', 'footer', 'main']);
const tagOf = (n) => (n.nodeType === 1 ? String(n.rawTagName || '').toLowerCase() : null);

function inlineFromDom(node, skipLists = false) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.text.replace(/\s+/g, ' '); continue; }
    const tag = tagOf(n);
    if (!tag || ['script', 'style'].includes(tag)) continue;
    if (skipLists && (tag === 'ul' || tag === 'ol')) continue;
    const inner = inlineFromDom(n, skipLists);
    if (tag === 'b' || tag === 'strong') out += inner.trim() ? `**${inner}**` : inner;
    else if (tag === 'i' || tag === 'em') out += inner.trim() ? `*${inner}*` : inner;
    else if (tag === 's' || tag === 'strike' || tag === 'del') out += `~~${inner}~~`;
    else if (tag === 'code') out += '`' + inner + '`';
    else if (tag === 'a') out += /^(https?:|mailto:)/i.test(n.getAttribute('href') || '') ? `[${inner}](${n.getAttribute('href')})` : inner;
    else if (tag === 'br') out += ' ';
    else if (tag !== 'en-todo') out += inner;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Converts HTML, including Evernote ENML (the XHTML inside an .enex export) and clipped web pages, to blocks. */
export function fromHtml(html) {
  const blocks = [];
  const root = parse(String(html).replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/gi, ''), { lowerCaseTagName: true, comment: false });
  const walk = (node, ind) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const txt = n.text.trim();
        if (txt) blocks.push(block('p', txt.replace(/\s+/g, ' ')));
        continue;
      }
      const tag = tagOf(n);
      if (!tag || ['script', 'style', 'nav', 'noscript', 'iframe', 'form', 'button', 'svg'].includes(tag)) continue;
      if (['h1', 'h2', 'h3'].includes(tag)) blocks.push(block(tag, inlineFromDom(n)));
      else if (['h4', 'h5', 'h6'].includes(tag)) blocks.push(block('h3', inlineFromDom(n)));
      else if (tag === 'ul' || tag === 'ol') {
        for (const li of n.childNodes) {
          if (tagOf(li) !== 'li') continue;
          const checked = li.getAttribute('data-checked'); // Evernote's newer checklists
          const extra = { ...(ind ? { ind: Math.min(8, ind) } : {}), ...(checked === 'true' ? { c: true } : {}) };
          blocks.push(block(checked != null ? 'todo' : tag, inlineFromDom(li, true), extra));
          for (const sub of li.childNodes) if (['ul', 'ol'].includes(tagOf(sub))) walk({ childNodes: [sub] }, ind + 1);
        }
      } else if (tag === 'blockquote') blocks.push(block('quote', inlineFromDom(n)));
      else if (tag === 'pre') blocks.push(block('code', n.text));
      else if (tag === 'hr') blocks.push(block('hr'));
      else if (tag === 'img') {
        const src = n.getAttribute('src') || '';
        if (/^https?:/i.test(src)) blocks.push(block('img', '', { src, cap: n.getAttribute('alt') || '' }));
      } else if (tag === 'en-media') blocks.push(block('file', '', { src: 'enex:' + (n.getAttribute('hash') || ''), cap: n.getAttribute('type') || 'attachment' }));
      else if (tag === 'table') {
        for (const tr of n.querySelectorAll('tr')) {
          const cells = tr.childNodes.filter((c) => ['td', 'th'].includes(tagOf(c))).map((c) => c.text.trim());
          if (cells.some(Boolean)) blocks.push(block('p', cells.join(' | ')));
        }
      } else if (['div', 'p', 'span', 'font', 'section', 'article', 'main', 'header', 'footer', 'figure', 'body', 'html', 'en-note', 'li'].includes(tag)) {
        if (n.childNodes.some((c) => BLOCK_TAGS.has(tagOf(c)))) walk(n, ind);
        else {
          const todo = n.querySelector('en-todo');
          const x = inlineFromDom(n);
          if (todo) blocks.push(block('todo', x, todo.getAttribute('checked') === 'true' ? { c: true } : {}));
          else if (x.trim()) blocks.push(block('p', x));
        }
      } else walk(n, ind);
    }
  };
  walk(root, 0);
  return blocks;
}

/** Notes inside an Evernote .enex export: [{ title, created, tags, html }]. */
export function parseEnex(xml) {
  const notes = [];
  for (const m of String(xml).matchAll(/<note>([\s\S]*?)<\/note>/g)) {
    const body = m[1];
    const pick = (tag) => (new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body) || [])[1] || '';
    const unCdata = (s) => s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
    const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const created = pick('created'); // 20240131T120000Z
    const iso = created.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
    notes.push({
      title: decode(pick('title')),
      created: Date.parse(iso) || Date.now(),
      tags: [...body.matchAll(/<tag>([\s\S]*?)<\/tag>/g)].map((t) => decode(t[1]).trim()).filter(Boolean),
      html: unCdata(pick('content')),
    });
  }
  return notes;
}

// ---------- Export / public rendering ----------

export function toMarkdown(title, blocks) {
  let md = `# ${title}\n\n`;
  let n = 0;
  for (const b of blocks) {
    const pad = '  '.repeat(b.ind || 0);
    const x = b.x || '';
    n = b.t === 'ol' ? n + 1 : 0;
    const line = {
      h1: `# ${x}`, h2: `## ${x}`, h3: `### ${x}`, todo: `${pad}- [${b.c ? 'x' : ' '}] ${x}`, ul: `${pad}- ${x}`, toggle: `${pad}- ${x}`,
      ol: `${pad}${n}. ${x}`, quote: `> ${x}`, callout: `> ${x}`, code: '```' + (b.lang || '') + `\n${x}\n` + '```', hr: '---',
      img: `![${b.cap || ''}](${b.src || ''})`, bookmark: `[${x || b.src}](${b.src || ''})`,
    }[b.t] ?? pad + x;
    md += line + '\n\n';
  }
  return md;
}

export function inlineHtml(x, noteUrl) {
  let h = escapeHtml(x);
  h = h.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_, label, href) => {
    href = href.replace(/&amp;/g, '&');
    if (href.startsWith('note:')) href = noteUrl(href.slice(5));
    else if (!/^(https?:|mailto:)/i.test(href)) href = '#';
    return `<a href="${escapeHtml(href)}">${label}</a>`;
  });
  return h.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>').replace(/~~([^~]+)~~/g, '<s>$1</s>');
}

export function toHtml(blocks, noteUrl, fileUrl) {
  return blocks.map((b) => {
    const x = inlineHtml(b.x || '', noteUrl);
    const style = b.ind ? ` style="margin-left:${b.ind * 24}px"` : '';
    let src = b.src || '';
    if (isUuid(src) && ['img', 'file'].includes(b.t)) src = fileUrl(src);
    const s = escapeHtml(src);
    switch (b.t) {
      case 'h1': case 'h2': case 'h3': return `<${b.t}>${x}</${b.t}>`;
      case 'todo': return `<div class="todo"${style}><input type="checkbox" disabled${b.c ? ' checked' : ''}> <span>${x}</span></div>`;
      case 'ul': return `<div class="li"${style}>• ${x}</div>`;
      case 'ol': return `<div class="li"${style}>${x}</div>`;
      case 'quote': return `<blockquote>${x}</blockquote>`;
      case 'callout': return `<div class="callout">${x}</div>`;
      case 'code': return `<pre><code>${escapeHtml(b.x)}</code></pre>`;
      case 'hr': return '<hr>';
      case 'img': return `<figure><img src="${s}" alt=""><figcaption>${escapeHtml(b.cap)}</figcaption></figure>`;
      case 'file': return `<p><a href="${s}">📎 ${escapeHtml(b.cap || 'Attachment')}</a></p>`;
      case 'bookmark': return `<p><a class="bookmark" href="${s}">🔗 ${x || s}</a></p>`;
      case 'toggle': return `<details${style}><summary>${x}</summary></details>`;
      case 'page': return `<p><a href="${escapeHtml(noteUrl(src))}">📄 ${x}</a></p>`;
      default: return `<p${style}>${x}</p>`;
    }
  }).join('\n');
}
