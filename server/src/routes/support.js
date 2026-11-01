// Support tickets (the Help center's articles are in routes/help.js). Users open requests from any app; platform admins work them in the admin console.
//
// Status:   open (waiting on support) · answered (waiting on the customer) · on_hold · closed
// Priority: low · normal · high · urgent
// Messages: "message" (seen by both sides), "note" (internal, staff only), "event" (status/priority/assignee changes, staff only)
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { route } from '../http.js';
import { db } from '../db.js';
import * as A from '../auth.js';
import { ApiError, nowMs, clampStr, sendMail, setting, setSetting, baseUrl, hmac, uuid, isUuid, dataPath } from '../util.js';

export const STATUSES = ['open', 'answered', 'on_hold', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const STATUS_NAME = { open: 'Waiting on support', answered: 'Waiting on customer', on_hold: 'On hold', closed: 'Closed' };
const DAY = 86400000;
const MAX_FILE = 10 * 1048576;
const FILES_PER_MESSAGE = 5;

const n = (v) => (v === null || v === undefined ? null : Number(v));
const ticketOut = (r) => r && {
  id: Number(r.id), user_id: Number(r.user_id), workspace_id: n(r.workspace_id), subject: r.subject, category: r.category, status: r.status,
  priority: r.priority || 'normal', assignee_id: n(r.assignee_id), platform: r.platform, app_version: r.app_version, last_from: r.last_from,
  rating: r.rating || null, rating_comment: r.rating_comment || null, article_id: r.article_id || null, created_at: Number(r.created_at), updated_at: Number(r.updated_at), closed_at: n(r.closed_at),
};

// ---------- Attachments ----------

const filesDir = () => dataPath('support-files');
export const supportFileUrl = (base, id) => `${base}/api/support/files/${id}/${hmac('support:' + id).slice(0, 32)}`;
const fileOut = (base, f) => ({ id: f.id, name: f.name, mime: f.mime, size: Number(f.size), url: supportFileUrl(base, f.id) });

/** Files the user uploaded but hasn't attached yet, claimed for this message (max 5). */
async function claimFiles(ids, userId, ticketId, messageId, staff) {
  const list = (Array.isArray(ids) ? ids : []).filter(isUuid).slice(0, FILES_PER_MESSAGE);
  for (const id of list) {
    await db.q(`UPDATE ticket_files SET ticket_id=?, message_id=? WHERE id=? AND message_id IS NULL AND ${staff ? '1=1' : 'user_id=?'}`,
      staff ? [ticketId, messageId, id] : [ticketId, messageId, id, userId]);
  }
}

async function thread(req, ticketId, { staff }) {
  const rows = await db.all(`SELECT m.*, u.name AS author FROM ticket_messages m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.ticket_id=? ${staff ? '' : "AND m.kind='message'"} ORDER BY m.id`, [ticketId]);
  const files = await db.all('SELECT * FROM ticket_files WHERE ticket_id=? AND message_id IS NOT NULL', [ticketId]);
  const base = baseUrl(req);
  return rows.map((m) => ({
    id: Number(m.id), kind: m.kind || 'message', staff: !!Number(m.staff), author: m.author || null, body: m.body, created_at: Number(m.created_at),
    files: files.filter((f) => Number(f.message_id) === Number(m.id)).map((f) => fileOut(base, f)),
  }));
}

async function addMessage(ticketId, userId, { body, staff = false, kind = 'message', files = [] }) {
  const id = await db.insert('ticket_messages', { ticket_id: ticketId, user_id: userId, staff: staff ? 1 : 0, kind, body: clampStr(body, 20000), created_at: nowMs() });
  if (files.length) await claimFiles(files, userId, ticketId, id, staff);
  return id;
}

/** Records a change (status, priority, assignee) in the thread, visible to staff. */
const event = (ticketId, userId, text) => addMessage(ticketId, userId, { body: text, staff: true, kind: 'event' });

/** Emails whoever should act: the assignee, else the support address, else every platform admin. */
async function tellStaff(req, t, text) {
  let to = null;
  if (t.assignee_id) to = await db.val('SELECT email FROM users WHERE id=? AND status=?', [t.assignee_id, 'active']);
  to ||= setting('support_email') || (await db.all('SELECT email FROM users WHERE is_super=1 AND status=?', ['active'])).map((u) => u.email).join(',');
  if (to) await sendMail(to, `[Support #${t.id}] ${t.subject}`, `${text}\n\nOpen it in the admin console: ${baseUrl(req)}/admin/#/support/${t.id}`);
}

route('POST', '/api/support/files', async (ctx) => {
  const u = await A.requireUser(ctx);
  if (Number(ctx.req.headers['content-length'] || 0) > MAX_FILE + 65536) throw new ApiError(413, 'Attachments can be up to 10 MB.');
  const request = new Request('http://local/upload', { method: 'POST', headers: { 'content-type': ctx.req.headers['content-type'] }, body: Readable.toWeb(ctx.req), duplex: 'half' });
  const file = (await request.formData()).get('file');
  if (!file || typeof file === 'string') throw new ApiError(422, 'No file was uploaded.');
  if (file.size > MAX_FILE) throw new ApiError(413, 'Attachments can be up to 10 MB.');
  const name = String(file.name || 'file').slice(0, 255);
  // Served as a download unless it's a plain image, so nothing uploaded can run in the browser.
  const mime = /^image\/(png|jpe?g|gif|webp|heic)$/i.test(file.type || '') ? file.type : 'application/octet-stream';
  const id = uuid();
  const rel = path.join(id.slice(0, 2), id);
  fs.mkdirSync(path.join(filesDir(), id.slice(0, 2)), { recursive: true });
  fs.writeFileSync(path.join(filesDir(), rel), Buffer.from(await file.arrayBuffer()));
  await db.insert('ticket_files', { id, ticket_id: null, message_id: null, user_id: u.id, name, mime, size: file.size, path: rel.replace(/\\/g, '/'), created_at: nowMs() });
  return fileOut(baseUrl(ctx.req), { id, name, mime, size: file.size });
});

route('GET', '/api/support/files/:id/:sig', async (ctx) => {
  const { id, sig } = ctx.params;
  if (!isUuid(id) || sig !== hmac('support:' + id).slice(0, 32)) throw new ApiError(404, 'Not found');
  const f = await db.one('SELECT * FROM ticket_files WHERE id=?', [id]);
  const file = f && path.join(filesDir(), f.path);
  if (!f || !fs.existsSync(file)) throw new ApiError(404, 'Not found');
  ctx.res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${f.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}` });
  fs.createReadStream(file).pipe(ctx.res);
});

// ---------- The user's own requests ----------

route('GET', '/api/support/tickets', async (ctx) => {
  const u = await A.requireUser(ctx);
  const rows = await db.all('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 100', [u.id]);
  return rows.map((r) => ({ ...ticketOut(r), unread: r.last_from === 'staff' && (r.user_read_at === null || Number(r.user_read_at) < Number(r.updated_at)) }));
});

route('POST', '/api/support/tickets', async (ctx) => {
  const u = await A.requireUser(ctx);
  const subject = String(ctx.in('subject', '')).trim();
  const body = String(ctx.in('body', '')).trim();
  if (!subject || !body) throw new ApiError(422, 'Add a subject and describe what you need help with.');
  const open = Number(await db.val('SELECT COUNT(*) FROM tickets WHERE user_id=? AND status<>?', [u.id, 'closed']));
  if (open >= 10) throw new ApiError(429, 'You have 10 open requests. Please wait for a reply or close one first.');
  let wsId = Number(ctx.in('workspace_id')) || null;
  if (wsId && !(await db.val('SELECT 1 FROM members WHERE workspace_id=? AND user_id=?', [wsId, u.id]))) wsId = null;
  const category = ['question', 'problem', 'billing', 'idea'].includes(ctx.in('category')) ? ctx.in('category') : 'question';
  // Asked from a help article ("Did this help?" → No): remember which one, so support sees what the customer already read.
  const article = ctx.in('article_id') ? await db.one('SELECT id, title FROM help_articles WHERE id=?', [String(ctx.in('article_id'))]) : null;
  const now = nowMs();
  const id = await db.insert('tickets', { user_id: u.id, workspace_id: wsId, subject: clampStr(subject, 200), category, status: 'open', article_id: article?.id || null,
    priority: category === 'problem' ? 'high' : 'normal', platform: clampStr(ctx.in('platform', null), 40), app_version: clampStr(ctx.in('app_version', null), 40),
    last_from: 'user', user_read_at: now, created_at: now, updated_at: now });
  await addMessage(id, u.id, { body, files: ctx.body.files });
  await A.audit(ctx, wsId, 'support.ticket_opened', id);
  const t = ticketOut(await db.one('SELECT * FROM tickets WHERE id=?', [id]));
  await tellStaff(ctx.req, t, `${u.name} <${u.email}> opened a support request${t.platform ? ` from ${t.platform}${t.app_version ? ' ' + t.app_version : ''}` : ''}${article ? ` after reading “${article.title}”` : ''}:\n\n${body}`);
  return userView(ctx, id);
});

async function ownTicket(ctx) {
  const u = await A.requireUser(ctx);
  const t = await db.one('SELECT * FROM tickets WHERE id=? AND user_id=?', [Number(ctx.params.id), u.id]);
  if (!t) throw new ApiError(404, 'That request was not found.');
  return { u, t: ticketOut(t) };
}
/** The help article a request was asked from, if any. */
const articleOf = async (t) => (t.article_id ? (await db.one('SELECT id, title FROM help_articles WHERE id=?', [t.article_id])) || null : null);
const userView = async (ctx, id) => {
  const t = ticketOut(await db.one('SELECT * FROM tickets WHERE id=?', [id]));
  return { ...t, article: await articleOf(t), messages: await thread(ctx.req, id, { staff: false }) };
};

route('GET', '/api/support/tickets/:id', async (ctx) => {
  const { t } = await ownTicket(ctx);
  await db.update('tickets', { user_read_at: nowMs() }, { id: t.id });
  return userView(ctx, t.id);
});

route('POST', '/api/support/tickets/:id/messages', async (ctx) => {
  const { u, t } = await ownTicket(ctx);
  const body = String(ctx.in('body', '')).trim();
  if (!body) throw new ApiError(422, 'Write a message first.');
  await addMessage(t.id, u.id, { body, files: ctx.body.files });
  if (t.status === 'closed') await event(t.id, null, 'Reopened by the customer');
  const now = nowMs();
  await db.update('tickets', { status: 'open', last_from: 'user', updated_at: now, user_read_at: now, closed_at: null }, { id: t.id });
  await tellStaff(ctx.req, t, `${u.name} replied${t.status === 'closed' ? ' (and reopened the request)' : ''}:\n\n${body}`);
  return userView(ctx, t.id);
});

route('POST', '/api/support/tickets/:id/close', async (ctx) => {
  const { t } = await ownTicket(ctx);
  if (t.status !== 'closed') {
    await event(t.id, null, 'Marked as solved by the customer');
    await db.update('tickets', { status: 'closed', updated_at: nowMs(), closed_at: nowMs() }, { id: t.id });
  }
  return userView(ctx, t.id);
});

/** After a request is solved the customer can say how it went. */
route('POST', '/api/support/tickets/:id/rate', async (ctx) => {
  const { t } = await ownTicket(ctx);
  const rating = ctx.in('rating');
  if (!['good', 'bad'].includes(rating)) throw new ApiError(422, 'Choose good or bad.');
  const comment = clampStr(String(ctx.in('comment', '') || '').trim() || null, 1000);
  await db.update('tickets', { rating, rating_comment: comment }, { id: t.id });
  await event(t.id, null, `Customer rated the support ${rating === 'good' ? '👍 good' : '👎 bad'}${comment ? `: “${comment}”` : ''}`);
  return userView(ctx, t.id);
});

// ---------- Admin: the support queue ----------

/** The platform admins tickets can be assigned to. */
route('GET', '/api/admin/support/staff', async (ctx) => {
  await A.requireSuper(ctx);
  return (await db.all('SELECT id, name, email FROM users WHERE is_super=1 AND status=? ORDER BY name', ['active'])).map((u) => ({ ...u, id: Number(u.id) }));
});

/** Saved replies: reusable answers, inserted into a reply with one click. */
route('GET', '/api/admin/support/macros', async (ctx) => { await A.requireSuper(ctx); return setting('support_macros', []); });
route('PUT', '/api/admin/support/macros', async (ctx) => {
  await A.requireSuper(ctx);
  const list = (Array.isArray(ctx.body.macros) ? ctx.body.macros : []).slice(0, 100)
    .map((m) => ({ id: isUuid(m.id) ? m.id : uuid(), title: clampStr(String(m.title || '').trim(), 120), body: clampStr(String(m.body || ''), 10000) }))
    .filter((m) => m.title && m.body);
  await setSetting(db, 'support_macros', list);
  return list;
});

route('GET', '/api/admin/tickets', async (ctx) => {
  const me = await A.requireSuper(ctx);
  const where = ['1=1'];
  const params = [];
  const q = ctx.query;
  if (STATUSES.includes(q.status)) { where.push('t.status=?'); params.push(q.status); }
  else if (q.status === 'active') where.push("t.status<>'closed'");
  if (PRIORITIES.includes(q.priority)) { where.push('t.priority=?'); params.push(q.priority); }
  if (q.assignee === 'me') { where.push('t.assignee_id=?'); params.push(me.id); }
  else if (q.assignee === 'none') where.push('t.assignee_id IS NULL');
  if (q.q) {
    where.push(`(${db.ilike('t.subject')} OR ${db.ilike('u.email')} OR ${db.ilike('u.name')} OR t.id IN (SELECT ticket_id FROM ticket_messages WHERE ${db.ilike('body')}))`);
    params.push(...Array(4).fill(`%${q.q}%`));
    if (/^#?\d+$/.test(q.q.trim())) { where[where.length - 1] = `(${where[where.length - 1]} OR t.id=?)`; params.push(Number(q.q.replace('#', ''))); }
  }
  const rows = await db.all(`SELECT t.*, u.name AS user_name, u.email AS user_email, w.name AS workspace_name, a.name AS assignee_name,
      (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id AND m.kind='message') AS messages
    FROM tickets t JOIN users u ON u.id = t.user_id LEFT JOIN workspaces w ON w.id = t.workspace_id LEFT JOIN users a ON a.id = t.assignee_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'on_hold' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END,
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 300`, params);
  const counts = Object.fromEntries((await db.all('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status')).map((r) => [r.status, Number(r.n)]));
  counts.mine = Number(await db.val("SELECT COUNT(*) FROM tickets WHERE assignee_id=? AND status<>'closed'", [me.id]));
  counts.unassigned = Number(await db.val("SELECT COUNT(*) FROM tickets WHERE assignee_id IS NULL AND status<>'closed'"));
  return {
    rows: rows.map((r) => ({ ...ticketOut(r), user_name: r.user_name, user_email: r.user_email, workspace_name: r.workspace_name, assignee_name: r.assignee_name,
      messages: Number(r.messages), unread: r.last_from === 'user' && r.status !== 'closed' && (r.staff_read_at === null || Number(r.staff_read_at) < Number(r.updated_at)) })),
    counts,
  };
});

route('GET', '/api/admin/tickets/:id', async (ctx) => {
  await A.requireSuper(ctx);
  const t = await db.one('SELECT * FROM tickets WHERE id=?', [Number(ctx.params.id)]);
  if (!t) throw new ApiError(404, 'Ticket not found.');
  await db.update('tickets', { staff_read_at: nowMs() }, { id: t.id });
  const user = await db.one('SELECT id, name, email, status, created_at, last_seen FROM users WHERE id=?', [t.user_id]);
  const workspaces = await db.all('SELECT w.id, w.name, w.plan, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id=?', [t.user_id]);
  const history = await db.all('SELECT id, subject, status, created_at FROM tickets WHERE user_id=? AND id<>? ORDER BY created_at DESC LIMIT 10', [t.user_id, t.id]);
  return {
    ...ticketOut(t),
    article: await articleOf(t),
    user: user && { ...user, id: Number(user.id), created_at: Number(user.created_at), last_seen: n(user.last_seen) },
    workspaces: workspaces.map((w) => ({ ...w, id: Number(w.id) })),
    history: history.map((h) => ({ ...h, id: Number(h.id), created_at: Number(h.created_at) })),
    messages: await thread(ctx.req, t.id, { staff: true }),
  };
});

/** A reply to the customer, or (note: true) an internal note only staff can see. */
route('POST', '/api/admin/tickets/:id/reply', async (ctx) => {
  const staff = await A.requireSuper(ctx);
  const t = ticketOut(await db.one('SELECT * FROM tickets WHERE id=?', [Number(ctx.params.id)]));
  if (!t) throw new ApiError(404, 'Ticket not found.');
  const body = String(ctx.in('body', '')).trim();
  if (!body) throw new ApiError(422, 'Write something first.');
  const note = !!ctx.body.note;
  const now = nowMs();
  await addMessage(t.id, staff.id, { body, staff: true, kind: note ? 'note' : 'message', files: ctx.body.files });
  const changes = { updated_at: now, staff_read_at: now };
  if (!t.assignee_id) changes.assignee_id = staff.id; // whoever answers first owns it
  if (!note) {
    const status = STATUSES.includes(ctx.in('status')) ? ctx.in('status') : 'answered';
    Object.assign(changes, { status, last_from: 'staff', closed_at: status === 'closed' ? now : null });
    if (status !== t.status && status !== 'answered') await event(t.id, staff.id, `Status: ${STATUS_NAME[status]}`);
    await db.insert('notifications', { user_id: t.user_id, workspace_id: t.workspace_id, kind: 'support', note_id: null,
      body: `Support replied to “${String(t.subject).slice(0, 120)}”`, created_at: now });
    const user = await db.one('SELECT email FROM users WHERE id=?', [t.user_id]);
    const app = setting('app_name', 'PlioPad');
    if (user) await sendMail(user.email, `Re: ${t.subject} [${app} support #${t.id}]`, `${body}\n\n—\nReply from the Help center in any ${app} app: ${baseUrl(ctx.req)}/app/#/help/${t.id}`);
  }
  await db.update('tickets', changes, { id: t.id });
  await A.audit(ctx, t.workspace_id, note ? 'support.note' : 'support.replied', t.id);
  return { ok: true };
});

async function applyChanges(ctx, staff, t, input) {
  const changes = {};
  if (STATUSES.includes(input.status) && input.status !== t.status) {
    changes.status = input.status;
    changes.closed_at = input.status === 'closed' ? nowMs() : null;
    await event(t.id, staff.id, `Status: ${STATUS_NAME[input.status]}`);
  }
  if (PRIORITIES.includes(input.priority) && input.priority !== t.priority) {
    changes.priority = input.priority;
    await event(t.id, staff.id, `Priority: ${input.priority}`);
  }
  if ('assignee_id' in input) {
    const to = input.assignee_id === null ? null : Number(input.assignee_id);
    if (to !== t.assignee_id) {
      const who = to && (await db.one('SELECT name FROM users WHERE id=? AND is_super=1', [to]));
      if (to && !who) throw new ApiError(422, 'Tickets can only be assigned to platform admins.');
      changes.assignee_id = to;
      await event(t.id, staff.id, to ? `Assigned to ${who.name}` : 'Unassigned');
    }
  }
  if (Object.keys(changes).length) {
    await db.update('tickets', { ...changes, updated_at: nowMs() }, { id: t.id });
    await A.audit(ctx, t.workspace_id, 'support.updated', t.id, changes);
  }
}

route('PATCH', '/api/admin/tickets/:id', async (ctx) => {
  const staff = await A.requireSuper(ctx);
  const t = ticketOut(await db.one('SELECT * FROM tickets WHERE id=?', [Number(ctx.params.id)]));
  if (!t) throw new ApiError(404, 'Ticket not found.');
  await applyChanges(ctx, staff, t, ctx.body);
  return { ok: true };
});

/** The same change for several tickets at once (status and/or assignee). */
route('POST', '/api/admin/tickets/bulk', async (ctx) => {
  const staff = await A.requireSuper(ctx);
  const ids = (Array.isArray(ctx.body.ids) ? ctx.body.ids : []).map(Number).filter(Boolean).slice(0, 200);
  for (const id of ids) {
    const t = ticketOut(await db.one('SELECT * FROM tickets WHERE id=?', [id]));
    if (t) await applyChanges(ctx, staff, t, ctx.body);
  }
  return { ok: true, updated: ids.length };
});

// ---------- Upkeep (run daily) ----------

/** Requests waiting on the customer for a week close themselves; unattached uploads older than a day are removed. */
export async function supportUpkeep() {
  const now = nowMs();
  for (const t of await db.all("SELECT id FROM tickets WHERE status='answered' AND updated_at < ?", [now - 7 * DAY])) {
    await event(t.id, null, 'Closed automatically after 7 days without a reply from the customer');
    await db.update('tickets', { status: 'closed', closed_at: now, updated_at: now }, { id: t.id });
  }
  for (const f of await db.all('SELECT id, path FROM ticket_files WHERE message_id IS NULL AND created_at < ?', [now - DAY])) {
    try { fs.unlinkSync(path.join(filesDir(), f.path)); } catch { /* already gone */ }
    await db.q('DELETE FROM ticket_files WHERE id=?', [f.id]);
  }
}
