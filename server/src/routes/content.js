// Notes, notebooks, tags, search, tasks, graph, versions, comments, presence, files, sharing, AI, sync and the web clipper.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { route } from '../http.js';
import { db } from '../db.js';
import * as A from '../auth.js';
import * as Blocks from '../blocks.js';
import { related } from '../related.js';
import * as N from '../notes.js';
import { limit, useAi, checkStorage } from '../plans.js';
import { runAction, askNotes } from '../ai.js';
import { wsOut, storageDir } from './workspace.js';
import { ApiError, nowMs, baseUrl, randomHex, hmac, jdec, uuid, isUuid, strLimit, clampStr } from '../util.js';

export const fileUrl = (base, id) => `${base}/f/${id}/${hmac(id).slice(0, 32)}`;

async function noteFull(ctx, ws, row) {
  const out = N.noteOut(row);
  out.backlinks = await db.all(`SELECT id, title, icon FROM notes WHERE workspace_id=? AND deleted=0 AND trashed_at IS NULL AND id<>? AND content LIKE ? LIMIT 50`,
    [ws.id, row.id, `%note:${row.id}%`]);
  const crumbs = [];
  let pid = row.parent_id;
  for (let i = 0; pid && i < 10; i++) {
    const p = await db.one('SELECT id, title, icon, parent_id FROM notes WHERE id=? AND workspace_id=?', [pid, ws.id]);
    if (!p) break;
    crumbs.unshift({ id: p.id, title: p.title, icon: p.icon });
    pid = p.parent_id;
  }
  out.breadcrumbs = crumbs;
  out.comment_count = Number(await db.val('SELECT COUNT(*) FROM comments WHERE note_id=? AND resolved=0', [row.id]));
  if (out.share_slug) out.share_url = `${baseUrl(ctx.req)}/s/${out.share_slug}`;
  return out;
}

route('GET', '/api/w/:ws/bootstrap', async (ctx) => {
  const { ws, role } = await A.requireWorkspace(ctx);
  const tree = (await db.all(`SELECT id, notebook_id, parent_id, kind, title, icon, pinned, sort, updated_at, trashed_at, is_template, reminder_at, reminder_done
    FROM notes WHERE workspace_id=? AND deleted=0 ORDER BY sort, created_at`, [ws.id]))
    .map((n) => ({ ...n, pinned: !!Number(n.pinned), is_template: !!Number(n.is_template), sort: Number(n.sort), updated_at: Number(n.updated_at),
      trashed_at: n.trashed_at ? Number(n.trashed_at) : null, reminder_at: n.reminder_at ? Number(n.reminder_at) : null, reminder_done: !!Number(n.reminder_done) }));
  return {
    workspace: await wsOut(ws, role),
    notebooks: (await db.all('SELECT * FROM notebooks WHERE workspace_id=? AND deleted=0 ORDER BY stack, sort, name', [ws.id])).map(N.notebookOut),
    tags: (await db.all('SELECT * FROM tags WHERE workspace_id=? AND deleted=0 ORDER BY name', [ws.id])).map(N.tagOut),
    tree,
    members: (await db.all('SELECT u.id, u.name, u.color FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?', [ws.id])).map((m) => ({ ...m, id: Number(m.id) })),
    seq: Number(ws.seq),
  };
});

route('GET', '/api/w/:ws/notes', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const q = ctx.query;
  const where = ['workspace_id=?', 'deleted=0', q.trash ? 'trashed_at IS NOT NULL' : 'trashed_at IS NULL'];
  const params = [ws.id];
  if (q.notebook) { where.push('notebook_id=?'); params.push(q.notebook); }
  if (q.parent) { where.push('parent_id=?'); params.push(q.parent); }
  else if (!q.all_levels) where.push("(parent_id IS NULL OR parent_id NOT IN (SELECT id FROM notes WHERE kind='db'))");
  if (q.tag) { where.push('tags LIKE ?'); params.push(`%"${q.tag}"%`); }
  if (q.pinned) where.push('pinned=1');
  where.push(q.templates ? 'is_template=1' : 'is_template=0');
  if (q.reminders) where.push('reminder_at IS NOT NULL');
  if (q.shared) where.push('share_slug IS NOT NULL');
  const sort = { created: 'created_at DESC', title: 'title ASC', manual: 'sort ASC, created_at ASC', reminder: 'reminder_done ASC, reminder_at ASC' }[q.sort]
    || 'pinned DESC, updated_at DESC';
  const lim = Math.min(1000, Number(q.limit || 300));
  return (await db.all(`SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ${lim}`, params)).map((r) => N.noteOut(r, false));
});

route('GET', '/api/w/:ws/notes/:id', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const row = await N.findNote(ws, ctx.params.id);
  if (!row || Number(row.deleted)) throw new ApiError(404, 'This page was deleted or never existed.');
  return noteFull(ctx, ws, row);
});

route('PUT', '/api/w/:ws/notes/:id', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'guest', true);
  const isNew = !(await N.findNote(ws, ctx.params.id));
  const { row, merged } = await N.saveNote(ws, user, ctx.params.id, ctx.body);
  if (isNew) await A.audit(ctx, ws.id, 'note.created', ctx.params.id);
  if (ctx.has('trashed')) await A.audit(ctx, ws.id, ctx.body.trashed ? 'note.trashed' : 'note.restored', ctx.params.id);
  return { ...(await noteFull(ctx, ws, row)), merged };
});

route('DELETE', '/api/w/:ws/notes/:id', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'member', true);
  await N.hardDelete(ws, ctx.params.id);
  await A.audit(ctx, ws.id, 'note.deleted', ctx.params.id);
  return { ok: true };
});

route('POST', '/api/w/:ws/trash/empty', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'admin');
  const rows = await db.all('SELECT id FROM notes WHERE workspace_id=? AND trashed_at IS NOT NULL AND deleted=0', [ws.id]);
  for (const r of rows) await N.hardDelete(ws, r.id);
  await A.audit(ctx, ws.id, 'trash.emptied', null, { notes: rows.length });
  return { deleted: rows.length };
});

route('POST', '/api/w/:ws/notes/:id/duplicate', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'guest', true);
  const src = await N.findNote(ws, ctx.params.id);
  if (!src) throw new ApiError(404, 'Not found');
  const content = jdec(src.content, []).map((b) => ({ ...b, id: uuid(), u: nowMs() }));
  const title = ctx.in('title') ?? (ctx.in('from_template') ? src.title : `${src.title || 'Untitled'} (copy)`);
  const { row } = await N.saveNote(ws, user, uuid(), {
    title, icon: src.icon, cover: src.cover, kind: src.kind, db_schema: jdec(src.db_schema, null), props: jdec(src.props, null),
    notebook_id: ctx.has('notebook_id') ? ctx.body.notebook_id : src.notebook_id, parent_id: ctx.has('parent_id') ? ctx.body.parent_id : src.parent_id,
    tags: jdec(src.tags, []), content,
  });
  return noteFull(ctx, ws, row);
});

// ---------- Versions ----------

route('GET', '/api/w/:ws/notes/:id/versions', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const since = nowMs() - limit(ws, 'history_days') * 86400000;
  return db.all(`SELECT v.id, v.version, v.title, v.created_at, u.name AS user_name FROM versions v LEFT JOIN users u ON u.id=v.user_id
    WHERE v.note_id=? AND v.workspace_id=? AND v.created_at>=? ORDER BY v.id DESC LIMIT 100`, [ctx.params.id, ws.id, since]);
});

route('GET', '/api/w/:ws/versions/:vid', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const v = await db.one('SELECT * FROM versions WHERE id=? AND workspace_id=?', [Number(ctx.params.vid), ws.id]);
  if (!v) throw new ApiError(404, 'Not found');
  return { ...v, content: jdec(v.content, []) };
});

route('POST', '/api/w/:ws/versions/:vid/restore', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'member', true);
  const v = await db.one('SELECT * FROM versions WHERE id=? AND workspace_id=?', [Number(ctx.params.vid), ws.id]);
  if (!v) throw new ApiError(404, 'Not found');
  const content = jdec(v.content, []).map((b) => ({ ...b, u: nowMs() }));
  const { row } = await N.saveNote(ws, user, v.note_id, { title: v.title, content });
  await A.audit(ctx, ws.id, 'note.version_restored', v.note_id, { version: Number(v.version) });
  return noteFull(ctx, ws, row);
});

// ---------- Sharing ----------

route('POST', '/api/w/:ws/notes/:id/share', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'member', true);
  const row = await N.findNote(ws, ctx.params.id);
  if (!row) throw new ApiError(404, 'Not found');
  if (jdec(ws.settings, {}).allow_public_pages === false) throw new ApiError(403, 'Your admin has turned off public pages.');
  const slug = ctx.in('enabled') ? row.share_slug || randomHex(10) : null;
  await db.update('notes', { share_slug: slug, seq: await N.nextSeq(ws.id) }, { id: row.id });
  await A.audit(ctx, ws.id, slug ? 'note.published' : 'note.unpublished', row.id);
  return { share_slug: slug, share_url: slug ? `${baseUrl(ctx.req)}/s/${slug}` : null };
});

// ---------- Notebooks & tags ----------

route('PUT', '/api/w/:ws/notebooks/:id', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'member', true);
  const id = ctx.params.id;
  if (!isUuid(id)) throw new ApiError(422, 'Bad id');
  const exists = await db.one('SELECT workspace_id FROM notebooks WHERE id=?', [id]);
  if (exists && Number(exists.workspace_id) !== Number(ws.id)) throw new ApiError(409, 'That id is already used.');
  const row = { id, workspace_id: ws.id, seq: await N.nextSeq(ws.id), updated_at: nowMs() };
  for (const [k, len] of [['name', 190], ['stack', 190], ['icon', 32], ['color', 16]]) {
    if (ctx.has(k)) row[k] = ctx.body[k] ? clampStr(ctx.body[k], len) : k === 'name' ? 'Untitled' : null;
  }
  if (ctx.has('sort')) row.sort = Number(ctx.body.sort) || 0;
  if (!exists) Object.assign(row, { name: row.name || 'Untitled', created_by: user.id });
  await db.upsert('notebooks', row, ['id']);
  return N.notebookOut(await db.one('SELECT * FROM notebooks WHERE id=?', [id]));
});

route('DELETE', '/api/w/:ws/notebooks/:id', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'member', true);
  for (const n of await db.all('SELECT id FROM notes WHERE notebook_id=? AND workspace_id=? AND trashed_at IS NULL AND deleted=0', [ctx.params.id, ws.id])) {
    await db.update('notes', { trashed_at: nowMs(), notebook_id: null, seq: await N.nextSeq(ws.id), updated_at: nowMs() }, { id: n.id });
  }
  await db.update('notebooks', { deleted: 1, seq: await N.nextSeq(ws.id), updated_at: nowMs() }, { id: ctx.params.id, workspace_id: ws.id });
  await A.audit(ctx, ws.id, 'notebook.deleted', ctx.params.id);
  return { ok: true };
});

route('PUT', '/api/w/:ws/tags/:id', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'member', true);
  if (!isUuid(ctx.params.id)) throw new ApiError(422, 'Bad id');
  const owner = await db.val('SELECT workspace_id FROM tags WHERE id=?', [ctx.params.id]);
  if (owner && Number(owner) !== Number(ws.id)) throw new ApiError(409, 'That id is already used.');
  await db.upsert('tags', { id: ctx.params.id, workspace_id: ws.id, name: String(ctx.req_('name')).replace(/^[#\s]+|\s+$/g, '').slice(0, 120),
    color: ctx.in('color'), seq: await N.nextSeq(ws.id), updated_at: nowMs(), deleted: 0 }, ['id']);
  return N.tagOut(await db.one('SELECT * FROM tags WHERE id=?', [ctx.params.id]));
});

route('DELETE', '/api/w/:ws/tags/:id', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'member', true);
  await db.update('tags', { deleted: 1, seq: await N.nextSeq(ws.id), updated_at: nowMs() }, { id: ctx.params.id, workspace_id: ws.id });
  return { ok: true };
});

// ---------- Search, tasks, graph ----------

route('GET', '/api/w/:ws/search', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  return N.search(ws, String(ctx.query.q || '').trim(), Math.min(100, Number(ctx.query.limit || 40)));
});

route('GET', '/api/w/:ws/tasks', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  return N.openTasks(ws);
});

route('POST', '/api/w/:ws/tasks/toggle', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'guest', true);
  const row = await N.findNote(ws, String(ctx.req_('note_id')));
  if (!row) throw new ApiError(404, 'Not found');
  const content = jdec(row.content, []).map((b) => {
    if (b.id !== ctx.body.block_id) return b;
    const { c, ...rest } = b;
    return c ? { ...rest, u: nowMs() } : { ...rest, c: true, u: nowMs() };
  });
  await N.saveNote(ws, user, row.id, { content });
  return { ok: true };
});

route('GET', '/api/w/:ws/graph', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const rows = await db.all('SELECT id, title, icon, parent_id, notebook_id, content, plain, tags FROM notes WHERE workspace_id=? AND deleted=0 AND trashed_at IS NULL AND is_template=0 LIMIT 2000', [ws.id]);
  const ids = new Set(rows.map((r) => r.id));
  const nodes = [];
  const edges = [];
  for (const r of rows) {
    nodes.push({ id: r.id, title: r.title || 'Untitled', icon: r.icon, notebook_id: r.notebook_id });
    for (const to of Blocks.links(jdec(r.content, []))) if (ids.has(to) && to !== r.id) edges.push([r.id, to, 'link']);
    if (r.parent_id && ids.has(r.parent_id)) edges.push([r.parent_id, r.id, 'child']);
  }
  // Discovered links: connections PlioPad finds by itself (mentions, shared tags, similar wording).
  const linked = new Set(edges.map(([x, y]) => `${x}|${y}`));
  const tagNames = Object.fromEntries((await db.all('SELECT id, name FROM tags WHERE workspace_id=? AND deleted=0', [ws.id])).map((t) => [t.id, t.name]));
  const auto = related(rows.map((r) => ({ id: r.id, title: r.title, text: r.plain || '', tags: jdec(r.tags, []) })), linked, tagNames);
  return { nodes, edges, auto };
});

// ---------- Comments & presence ----------

const commentSelect = 'SELECT c.*, u.name AS user_name, u.color AS user_color FROM comments c JOIN users u ON u.id=c.user_id';

route('GET', '/api/w/:ws/notes/:id/comments', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  return db.all(`${commentSelect} WHERE c.note_id=? AND c.workspace_id=? ORDER BY c.id`, [ctx.params.id, ws.id]);
});

route('POST', '/api/w/:ws/notes/:id/comments', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx);
  const note = await N.findNote(ws, ctx.params.id);
  if (!note) throw new ApiError(404, 'Not found');
  const body = String(ctx.req_('body')).trim().slice(0, 5000);
  const id = await db.insert('comments', { workspace_id: ws.id, note_id: note.id, block_id: ctx.in('block_id'), user_id: user.id, body, created_at: nowMs() });
  // @mentions notify the people mentioned; otherwise the page's author hears about it.
  const members = await db.all('SELECT u.id, u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?', [ws.id]);
  let notify = members.filter((m) => body.toLowerCase().includes('@' + m.name.toLowerCase())).map((m) => Number(m.id));
  if (!notify.length && note.created_by) notify = [Number(note.created_by)];
  for (const uid of new Set(notify)) {
    if (uid === Number(user.id)) continue;
    await db.insert('notifications', { user_id: uid, workspace_id: ws.id, kind: 'comment', note_id: note.id,
      body: `${user.name} commented on “${note.title || 'Untitled'}”: ${strLimit(body, 120)}`, created_at: nowMs() });
  }
  return db.one(`${commentSelect} WHERE c.id=?`, [id]);
});

route('PATCH', '/api/w/:ws/comments/:cid', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  await db.update('comments', { resolved: ctx.in('resolved') ? 1 : 0 }, { id: Number(ctx.params.cid), workspace_id: ws.id });
  return { ok: true };
});

route('DELETE', '/api/w/:ws/comments/:cid', async (ctx) => {
  const { ws, role, user } = await A.requireWorkspace(ctx);
  const c = await db.one('SELECT * FROM comments WHERE id=? AND workspace_id=?', [Number(ctx.params.cid), ws.id]);
  if (c && (Number(c.user_id) === Number(user.id) || A.ROLES[role] >= 2)) await db.q('DELETE FROM comments WHERE id=?', [c.id]);
  return { ok: true };
});

/** Heartbeat while a page is open: who else is here, and the page's current version (so open copies refresh live). */
route('POST', '/api/w/:ws/presence', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx);
  const noteId = String(ctx.req_('note_id'));
  await db.upsert('presence', { note_id: noteId, user_id: user.id, workspace_id: ws.id, editing: ctx.in('editing') ? 1 : 0, at: nowMs() }, ['note_id', 'user_id']);
  const others = await db.all(`SELECT u.id, u.name, u.color, p.editing FROM presence p JOIN users u ON u.id=p.user_id
    WHERE p.note_id=? AND p.at>? AND p.user_id<>?`, [noteId, nowMs() - 30000, user.id]);
  const v = await db.val('SELECT version FROM notes WHERE id=? AND workspace_id=?', [noteId, ws.id]);
  return { others, version: v === null ? null : Number(v) };
});

// ---------- Files ----------

route('POST', '/api/w/:ws/files', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'guest', true);
  const declared = Number(ctx.req.headers['content-length'] || 0);
  if (declared > 64 * 1048576) throw new ApiError(413, 'Files can be up to 64 MB.');
  const request = new Request('http://local/upload', { method: 'POST', headers: { 'content-type': ctx.req.headers['content-type'] },
    body: Readable.toWeb(ctx.req), duplex: 'half' });
  const fd = await request.formData();
  const file = fd.get('file');
  if (!file || typeof file === 'string') throw new ApiError(422, 'No file was uploaded.');
  checkStorage(ws, file.size);
  const blocked = /\.(php\d?|phtml|exe|bat|cmd|sh|js|mjs|html?|svg)$/i;
  const name = String(file.name || 'file').slice(0, 255);
  const mime = blocked.test(name) ? 'application/octet-stream' : file.type || 'application/octet-stream';
  const id = isUuid(fd.get('id')) ? fd.get('id') : uuid();
  const rel = path.join(String(ws.id), id.slice(0, 2), id);
  fs.mkdirSync(path.dirname(path.join(storageDir(), rel)), { recursive: true });
  fs.writeFileSync(path.join(storageDir(), rel), Buffer.from(await file.arrayBuffer()));
  const noteId = isUuid(fd.get('note_id')) ? fd.get('note_id') : null;
  await db.insert('files', { id, workspace_id: ws.id, note_id: noteId, name, mime, size: file.size, path: rel.replace(/\\/g, '/'),
    ocr: fd.get('ocr') ? String(fd.get('ocr')).slice(0, 200000) : null, created_by: user.id, created_at: nowMs() });
  await db.q('UPDATE workspaces SET storage_bytes = storage_bytes + ? WHERE id=?', [file.size, ws.id]);
  return { id, url: fileUrl(baseUrl(ctx.req), id), name, mime, size: file.size };
});

route('POST', '/api/w/:ws/files/:id/ocr', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'guest', true);
  await db.update('files', { ocr: String(ctx.req_('text')).slice(0, 200000) }, { id: ctx.params.id, workspace_id: ws.id });
  return { ok: true };
});

route('GET', '/api/w/:ws/files', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const base = baseUrl(ctx.req);
  return (await db.all(`SELECT f.id, f.name, f.mime, f.size, f.note_id, f.created_at, n.title AS note_title FROM files f LEFT JOIN notes n ON n.id=f.note_id
    WHERE f.workspace_id=? ORDER BY f.created_at DESC LIMIT 500`, [ws.id])).map((f) => ({ ...f, url: fileUrl(base, f.id) }));
});

// ---------- AI ----------

route('POST', '/api/w/:ws/ai', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'member');
  const note = ctx.in('note_id') ? await N.findNote(ws, String(ctx.in('note_id'))) : null;
  const action = String(ctx.req_('action'));
  const title = note?.title ?? String(ctx.in('title', ''));
  const text = String(ctx.in('text') ?? note?.plain ?? '');
  if (!text.trim() && action !== 'outline') throw new ApiError(422, 'There is no text to work with yet.');
  await useAi(ws);
  const existing = (await db.all('SELECT name FROM tags WHERE workspace_id=? AND deleted=0 LIMIT 200', [ws.id])).map((t) => t.name);
  const res = await runAction(action, title, text.slice(0, 120000), { selection: ctx.in('selection'), language: ctx.in('language'), topic: ctx.in('topic'), existing });
  if (res.markdown) res.blocks = Blocks.fromMarkdown(res.markdown);
  await A.audit(ctx, ws.id, 'ai.' + action, note?.id ?? null);
  return res;
});

route('POST', '/api/w/:ws/ai/ask', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'member');
  await useAi(ws);
  await A.audit(ctx, ws.id, 'ai.ask');
  return askNotes(ws, String(ctx.req_('question')).trim());
});

// ---------- Sync (Android and any other offline-first client) ----------

/** Everything that changed after `since` (a workspace sequence number). Deletions arrive as tombstones. */
route('GET', '/api/w/:ws/sync', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const since = Number(ctx.query.since || 0);
  const PAGE = 300;
  const notes = await db.all(`SELECT * FROM notes WHERE workspace_id=? AND seq>? ORDER BY seq LIMIT ${PAGE}`, [ws.id, since]);
  const more = notes.length === PAGE;
  const upTo = more ? Number(notes.at(-1).seq) : Number(ws.seq);
  return {
    seq: upTo, more,
    notes: notes.map((r) => N.noteOut(r)),
    notebooks: (await db.all('SELECT * FROM notebooks WHERE workspace_id=? AND seq>? AND seq<=?', [ws.id, since, upTo])).map(N.notebookOut),
    tags: (await db.all('SELECT * FROM tags WHERE workspace_id=? AND seq>? AND seq<=?', [ws.id, since, upTo])).map(N.tagOut),
  };
});

const SYNC_FIELDS = ['title', 'icon', 'cover', 'content', 'notebook_id', 'parent_id', 'kind', 'props', 'db_schema', 'tags', 'pinned', 'sort',
  'reminder_at', 'reminder_done', 'is_template', 'base_version', 'base_updated', 'created_at', 'locked'];

/** Push local changes. Notes carry base_version/base_updated, so concurrent edits merge block by block. */
route('POST', '/api/w/:ws/sync', async (ctx) => {
  const { ws, role, user } = await A.requireWorkspace(ctx, 'guest', true);
  const res = { notes: [], notebooks: [], tags: [], errors: [] };
  for (const nb of ctx.body.notebooks || []) {
    if (!isUuid(nb.id)) continue;
    const owner = await db.val('SELECT workspace_id FROM notebooks WHERE id=?', [nb.id]);
    if (owner && Number(owner) !== Number(ws.id)) continue;
    await db.upsert('notebooks', { id: nb.id, workspace_id: ws.id, name: clampStr(nb.name || 'Untitled', 190), stack: clampStr(nb.stack || null, 190),
      icon: clampStr(nb.icon || null, 32), color: clampStr(nb.color || null, 16), sort: Number(nb.sort) || 0, deleted: nb.deleted ? 1 : 0,
      seq: await N.nextSeq(ws.id), updated_at: nowMs(), ...(owner ? {} : { created_by: user.id }) }, ['id']);
    res.notebooks.push(nb.id);
  }
  for (const t of ctx.body.tags || []) {
    if (!isUuid(t.id)) continue;
    const owner = await db.val('SELECT workspace_id FROM tags WHERE id=?', [t.id]);
    if (owner && Number(owner) !== Number(ws.id)) continue;
    await db.upsert('tags', { id: t.id, workspace_id: ws.id, name: clampStr(t.name || 'tag', 120), color: clampStr(t.color || null, 16),
      deleted: t.deleted ? 1 : 0, seq: await N.nextSeq(ws.id), updated_at: nowMs() }, ['id']);
    res.tags.push(t.id);
  }
  for (const n of ctx.body.notes || []) {
    try {
      if (n.deleted) {
        if (A.ROLES[role] >= 1) await N.hardDelete(ws, String(n.id));
      } else {
        const fields = Object.fromEntries(SYNC_FIELDS.filter((k) => k in n).map((k) => [k, n[k]]));
        if ('trashed_at' in n) fields.trashed = !!n.trashed_at;
        await N.saveNote(ws, user, String(n.id), fields);
      }
      res.notes.push(n.id);
    } catch (e) {
      res.errors.push({ id: n.id ?? null, error: e.message });
    }
  }
  return res;
});

// ---------- Web clipper ----------

route('POST', '/api/w/:ws/clip', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'guest', true);
  const url = String(ctx.in('url', ''));
  const content = [Blocks.block('bookmark', String(ctx.in('title', url)), { src: url })];
  if (ctx.in('note')) content.unshift(Blocks.block('callout', String(ctx.in('note'))));
  if (ctx.in('html')) content.push(...Blocks.fromHtml(String(ctx.in('html'))).slice(0, 2000));
  else if (ctx.in('text')) content.push(...Blocks.fromMarkdown(String(ctx.in('text'))));
  const { row } = await N.saveNote(ws, user, uuid(), { title: String(ctx.in('title', 'Clipped page')).slice(0, 500), icon: '🔖',
    notebook_id: isUuid(ctx.in('notebook_id')) ? ctx.in('notebook_id') : null, tags: Array.isArray(ctx.body.tags) ? ctx.body.tags : [], content });
  await A.audit(ctx, ws.id, 'note.clipped', row.id, { url });
  return { id: row.id };
});
