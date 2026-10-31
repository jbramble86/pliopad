// Notes, notebooks and tags: serialization, versioned saves with merging, search, tasks and sync sequencing.
import { db } from './db.js';
import * as Blocks from './blocks.js';
import { ApiError, nowMs, isUuid, jdec, jenc, strLimit, clampStr, uuid } from './util.js';

export async function nextSeq(wsId) {
  return db.tx(async () => {
    await db.q('UPDATE workspaces SET seq = seq + 1 WHERE id=?', [wsId]);
    return Number(await db.val('SELECT seq FROM workspaces WHERE id=?', [wsId]));
  });
}

const n = (v) => (v === null || v === undefined ? null : Number(v));

/** Every page lives in a notebook. Pages without one go to the workspace's Inbox (created if it doesn't exist). */
export async function defaultNotebookId(ws, userId = null) {
  const nbs = await db.all('SELECT id, name FROM notebooks WHERE workspace_id=? AND deleted=0 ORDER BY sort, name', [ws.id]);
  const found = nbs.find((nb) => nb.name.toLowerCase() === 'inbox') || nbs[0];
  if (found) return found.id;
  const id = uuid();
  await db.insert('notebooks', { id, workspace_id: ws.id, name: 'Inbox', icon: '📥', sort: 0, seq: await nextSeq(ws.id), updated_at: nowMs(), created_by: userId });
  return id;
}

/** The notebook a page belongs in: its parent's (sub-pages and database rows), else its own, else the Inbox. */
async function notebookFor(ws, userId, parentId, notebookId) {
  if (parentId) {
    const p = await db.one('SELECT notebook_id FROM notes WHERE id=? AND workspace_id=?', [parentId, ws.id]);
    if (p?.notebook_id) return p.notebook_id;
  }
  return notebookId || defaultNotebookId(ws, userId);
}

/** Moves a page's sub-pages (and theirs) along with it to another notebook. */
async function moveDescendants(ws, parentId, notebookId) {
  let level = [parentId];
  for (let depth = 0; level.length && depth < 20; depth++) {
    const kids = await db.all(`SELECT id FROM notes WHERE workspace_id=? AND deleted=0 AND parent_id IN (${level.map(() => '?').join(',')})`, [ws.id, ...level]);
    for (const k of kids) await db.update('notes', { notebook_id: notebookId, seq: await nextSeq(ws.id) }, { id: k.id });
    level = kids.map((k) => k.id);
  }
}

/** One-time fix for pages saved before every page had to be in a notebook. */
export async function fileOrphanPages() {
  const rows = await db.all('SELECT id, workspace_id, parent_id FROM notes WHERE notebook_id IS NULL AND deleted=0 ORDER BY parent_id IS NOT NULL');
  for (const r of rows) {
    const ws = { id: Number(r.workspace_id) };
    const nb = await notebookFor(ws, null, r.parent_id, null);
    await db.update('notes', { notebook_id: nb, seq: await nextSeq(ws.id) }, { id: r.id });
  }
  return rows.length;
}

export function noteOut(r, withContent = true) {
  const content = jdec(r.content, []);
  const out = {
    id: r.id, notebook_id: r.notebook_id, parent_id: r.parent_id, kind: r.kind, title: r.title, icon: r.icon, cover: r.cover,
    props: jdec(r.props, {}), tags: jdec(r.tags, []), pinned: !!Number(r.pinned), sort: Number(r.sort), version: Number(r.version),
    seq: Number(r.seq), created_by: n(r.created_by), updated_by: n(r.updated_by), created_at: Number(r.created_at),
    updated_at: Number(r.updated_at), trashed_at: n(r.trashed_at), deleted: !!Number(r.deleted), share_slug: r.share_slug,
    reminder_at: n(r.reminder_at), reminder_done: !!Number(r.reminder_done), is_template: !!Number(r.is_template),
    locked: !!Number(r.locked), snippet: strLimit(String(r.plain || '').replace(/\n/g, ' '), 180),
  };
  if (r.kind === 'db') out.db_schema = jdec(r.db_schema, {});
  if (withContent) out.content = content;
  else out.thumb = content.find((b) => b.t === 'img' && b.src)?.src ?? null;
  return out;
}

export const notebookOut = (r) => ({ id: r.id, name: r.name, stack: r.stack, icon: r.icon, color: r.color, sort: Number(r.sort),
  seq: Number(r.seq), updated_at: Number(r.updated_at), deleted: !!Number(r.deleted) });

export const tagOut = (r) => ({ id: r.id, name: r.name, color: r.color, seq: Number(r.seq), updated_at: Number(r.updated_at), deleted: !!Number(r.deleted) });

export const findNote = (ws, id) => db.one('SELECT * FROM notes WHERE id=? AND workspace_id=?', [id, ws.id]);

/**
 * Creates or updates a note. `input` may hold any editable field plus base_version / base_updated (the server version
 * the client was editing). Returns { row, merged }.
 */
export async function saveNote(ws, user, id, input) {
  if (!isUuid(id)) throw new ApiError(422, 'Note ids must be UUIDs.');
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  return db.tx(async () => {
    const row = await findNote(ws, id);
    if (!row && (await db.val('SELECT 1 FROM notes WHERE id=?', [id]))) throw new ApiError(409, 'That id is already used.');
    if (row && Number(row.locked) && !has('locked') && has('content')) throw new ApiError(423, 'This page is locked. Unlock it to edit.');
    const now = nowMs();
    let merged = false;
    const data = {};
    if (has('content')) {
      let client = Blocks.sanitize(input.content);
      for (const b of client) if (!b.u) b.u = now;
      if (row && input.base_version !== undefined && Number(input.base_version) < Number(row.version)) {
        client = Blocks.merge(jdec(row.content, []), client, Number(input.base_updated || 0));
        merged = true;
      }
      data.content = jenc(client);
      data.plain = Blocks.plain(client);
    }
    if (has('title')) data.title = clampStr(input.title ?? '', 500);
    if (has('icon')) data.icon = clampStr(input.icon || null, 32);
    if (has('cover')) data.cover = clampStr(input.cover || null, 255);
    for (const k of ['notebook_id', 'parent_id']) if (has(k)) data[k] = isUuid(input[k]) ? input[k] : null;
    if (data.parent_id && data.parent_id === id) throw new ApiError(422, 'A page cannot be its own parent.');
    if (has('kind')) data.kind = input.kind === 'db' ? 'db' : 'note';
    for (const k of ['props', 'db_schema']) if (has(k)) data[k] = input[k] == null ? null : jenc(input[k]);
    if (has('tags')) data.tags = jenc((Array.isArray(input.tags) ? input.tags : []).filter(isUuid));
    for (const k of ['pinned', 'reminder_done', 'is_template', 'locked']) if (has(k)) data[k] = input[k] ? 1 : 0;
    if (has('sort')) data.sort = Number(input.sort) || 0;
    if (has('reminder_at')) { data.reminder_at = input.reminder_at ? Number(input.reminder_at) : null; data.reminder_sent = 0; }
    if (has('trashed')) data.trashed_at = input.trashed ? now : null;
    // The creation date can be changed (e.g. for notes that existed on paper before). Not in the future.
    if (has('created_at') && row && Number(input.created_at) > 0 && Number(input.created_at) !== Number(row.created_at)) data.created_at = Math.min(Number(input.created_at), now);
    // Every page belongs to a notebook (sub-pages and database rows share their parent's).
    const parentId = has('parent_id') ? data.parent_id : row?.parent_id ?? null;
    const notebookId = await notebookFor(ws, user.id, parentId, has('notebook_id') ? data.notebook_id : row?.notebook_id ?? null);
    if (!row || notebookId !== row.notebook_id) data.notebook_id = notebookId;
    else delete data.notebook_id;
    if (!Object.keys(data).length && row) return { row, merged: false };

    data.seq = await nextSeq(ws.id);
    data.updated_at = now;
    data.updated_by = user.id;
    if (row) {
      data.version = Number(row.version) + 1;
      await snapshot(ws, row);
      await db.update('notes', data, { id });
      if (data.notebook_id) await moveDescendants(ws, id, data.notebook_id);
    } else {
      await db.insert('notes', { title: '', content: '[]', plain: '', ...data, id, workspace_id: ws.id, created_by: user.id,
        created_at: Number(input.created_at) || now, version: 1 });
    }
    return { row: await findNote(ws, id), merged };
  });
}

/** Keeps a version snapshot at most every 10 minutes per editor, and whenever someone else edits. */
async function snapshot(ws, row) {
  const last = await db.one('SELECT user_id, created_at FROM versions WHERE note_id=? ORDER BY id DESC LIMIT 1', [row.id]);
  if (last && Number(last.user_id) === Number(row.updated_by) && nowMs() - Number(last.created_at) < 600000) return;
  if ((row.content || '[]') === '[]' && !row.title) return;
  await db.insert('versions', { note_id: row.id, workspace_id: ws.id, version: row.version, title: row.title, content: row.content,
    user_id: row.updated_by, created_at: Number(row.updated_at) });
}

/** Deletes for good, leaving a tombstone so offline devices learn about it on their next sync. Children go too. */
export async function hardDelete(ws, id) {
  await db.update('notes', { deleted: 1, content: '[]', plain: '', title: '', props: null, share_slug: null, seq: await nextSeq(ws.id), updated_at: nowMs() },
    { id, workspace_id: ws.id });
  await db.q('DELETE FROM versions WHERE note_id=?', [id]);
  await db.q('DELETE FROM comments WHERE note_id=?', [id]);
  for (const c of await db.all('SELECT id FROM notes WHERE parent_id=? AND workspace_id=? AND deleted=0', [id, ws.id])) await hardDelete(ws, c.id);
}

// ---------- Search ----------

/**
 * Evernote-style search grammar: words, "exact phrases", -exclude, tag:name, notebook:name, intitle:word,
 * is:todo | done | pinned | db | reminder | shared, has:image | file | code | link, created:7d, updated:2w
 */
export async function search(ws, q, max = 50) {
  const where = ['n.workspace_id=?', 'n.deleted=0', 'n.trashed_at IS NULL'];
  const params = [ws.id];
  const terms = [];
  for (const m of String(q).matchAll(/(-?)(\w+:)?("([^"]*)"|\S+)/gu)) {
    const neg = m[1] === '-';
    const op = (m[2] || '').replace(':', '');
    const val = m[4] !== undefined ? m[4] : m[3].replace(/^"|"$/g, '');
    if (!val) continue;
    const not = neg ? 'NOT ' : '';
    if (op === 'tag') {
      const ids = (await db.all(`SELECT id FROM tags WHERE workspace_id=? AND deleted=0 AND ${db.ilike('name')}`, [ws.id, val])).map((r) => r.id);
      where.push(`${not}(${ids.map(() => 'n.tags LIKE ?').join(' OR ') || '1=0'})`);
      params.push(...ids.map((t) => `%"${t}"%`));
    } else if (op === 'notebook') {
      where.push(`${not}n.notebook_id IN (SELECT id FROM notebooks WHERE workspace_id=? AND ${db.ilike('name')})`);
      params.push(ws.id, val);
    } else if (op === 'is') {
      const cond = {
        todo: `n.content LIKE '%"t":"todo"%'`, done: `n.content LIKE '%"t":"todo"%' AND n.content LIKE '%"c":true%'`,
        pinned: 'n.pinned=1', db: "n.kind='db'", reminder: 'n.reminder_at IS NOT NULL AND n.reminder_done=0', shared: 'n.share_slug IS NOT NULL',
      }[val] || '1=1';
      where.push(`${not}(${cond})`);
    } else if (op === 'has') {
      where.push(`${not}n.content LIKE ?`);
      params.push(`%"t":"${{ image: 'img', file: 'file', code: 'code' }[val] || 'bookmark'}"%`);
    } else if ((op === 'created' || op === 'updated') && /^\d+[dwmy]$/.test(val)) {
      const days = parseInt(val, 10) * { d: 1, w: 7, m: 30, y: 365 }[val.slice(-1)];
      where.push(`n.${op}_at ${neg ? '<' : '>='} ?`);
      params.push(nowMs() - days * 86400000);
    } else if (op === 'intitle') {
      where.push(not + db.ilike('n.title'));
      params.push(`%${val}%`);
      terms.push(val);
    } else {
      const full = (op ? op + ':' : '') + val;
      where.push(`${not}(${db.ilike('n.title')} OR ${db.ilike('n.plain')} OR n.id IN (SELECT note_id FROM files WHERE workspace_id=? AND ${db.ilike('ocr')}))`);
      params.push(`%${full}%`, `%${full}%`, ws.id, `%${full}%`);
      if (!neg) terms.push(full);
    }
  }
  const rows = await db.all(`SELECT n.* FROM notes n WHERE ${where.join(' AND ')} ORDER BY n.updated_at DESC LIMIT ${Math.min(500, max * 4)}`, params);
  // Rank: title hits beat body hits; recent beats old.
  const scored = rows.map((r) => {
    let score = 0;
    const title = String(r.title).toLowerCase();
    const body = String(r.plain || '').toLowerCase();
    for (const t of terms.map((x) => x.toLowerCase())) {
      if (title.includes(t)) score += 10;
      score += Math.min(5, body.split(t).length - 1);
    }
    score += Math.max(0, 3 - (nowMs() - Number(r.updated_at)) / (30 * 86400000));
    return { ...noteOut(r, false), score: Math.round(score * 100) / 100, hit: hitContext(String(r.plain || ''), terms) };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, max);
}

function hitContext(plain, terms) {
  for (const t of terms) {
    const p = plain.toLowerCase().indexOf(t.toLowerCase());
    if (p >= 0) {
      const start = Math.max(0, p - 60);
      return (start ? '…' : '') + plain.slice(start, start + 160).replace(/\n/g, ' ') + '…';
    }
  }
  return null;
}

/** Unchecked to-dos across the whole workspace: a task inbox that needs no separate task app. "@2026-11-03" sets a due date. */
export async function openTasks(ws) {
  const rows = await db.all(`SELECT id, title, icon, content, updated_at FROM notes WHERE workspace_id=? AND deleted=0 AND trashed_at IS NULL
    AND is_template=0 AND content LIKE '%"t":"todo"%' ORDER BY updated_at DESC LIMIT 300`, [ws.id]);
  const tasks = [];
  for (const r of rows) {
    for (const b of jdec(r.content, [])) {
      if (b.t !== 'todo' || b.c || !String(b.x || '').trim()) continue;
      tasks.push({ note_id: r.id, note_title: r.title, icon: r.icon, block_id: b.id, text: b.x, due: (/@(\d{4}-\d{2}-\d{2})/.exec(b.x) || [])[1] || null,
        updated_at: Number(r.updated_at) });
    }
  }
  return tasks.sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || String(a.due).localeCompare(String(b.due)));
}
