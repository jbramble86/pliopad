// Workspaces, members, invitations, the workspace audit log, import/export and billing.
import fs from 'node:fs';
import path from 'node:path';
import { route } from '../http.js';
import { db } from '../db.js';
import * as A from '../auth.js';
import * as Blocks from '../blocks.js';
import { createWorkspace } from '../seed.js';
import { allPlans, getPlan, limit, checkMembers } from '../plans.js';
import { saveNote, nextSeq, noteOut, notebookOut, tagOut } from '../notes.js';
import * as Stripe from '../stripe.js';
import { ApiError, nowMs, month, setting, sendMail, baseUrl, randomHex, jdec, jenc, uuid, isUuid, config, ROOT } from '../util.js';

export const storageDir = () => {
  const d = path.resolve(ROOT, config('storage', 'storage'));
  fs.mkdirSync(d, { recursive: true });
  return d;
};

export async function wsOut(ws, role) {
  const plan = getPlan(ws.plan);
  return {
    id: Number(ws.id), name: ws.name, slug: ws.slug, plan: ws.plan, plan_name: plan.name, status: ws.status, role,
    settings: jdec(ws.settings, {}), plan_renews: ws.plan_renews ? Number(ws.plan_renews) : null,
    limits: Object.fromEntries(['members', 'storage_mb', 'ai_per_month', 'history_days', 'audit', 'guests'].map((k) => [k, limit(ws, k)])),
    usage: {
      members: Number(await db.val('SELECT COUNT(*) FROM members WHERE workspace_id=?', [ws.id])),
      storage_mb: Math.round(Number(ws.storage_bytes) / 104857.6) / 10,
      ai: ws.ai_period === month() ? Number(ws.ai_used) : 0,
      notes: Number(await db.val('SELECT COUNT(*) FROM notes WHERE workspace_id=? AND deleted=0', [ws.id])),
    },
  };
}

export async function deleteWorkspace(ws) {
  for (const f of await db.all('SELECT path FROM files WHERE workspace_id=?', [ws.id])) fs.rmSync(path.join(storageDir(), f.path), { force: true });
  for (const t of ['notes', 'notebooks', 'tags', 'versions', 'comments', 'files', 'members', 'invites', 'presence']) {
    await db.q(`DELETE FROM ${t} WHERE workspace_id=?`, [ws.id]);
  }
  await db.q('DELETE FROM workspaces WHERE id=?', [ws.id]);
}

const ownerCount = async (ws) => Number(await db.val("SELECT COUNT(*) FROM members WHERE workspace_id=? AND role='owner'", [ws.id]));

route('POST', '/api/workspaces', async (ctx) => {
  const u = await A.requireUser(ctx);
  const owned = Number(await db.val("SELECT COUNT(*) FROM members WHERE user_id=? AND role='owner'", [u.id]));
  if (owned >= Number(setting('max_workspaces_per_user', 10)) && !Number(u.is_super)) throw new ApiError(403, 'You have reached the workspace limit.');
  const ws = await createWorkspace(u, String(ctx.req_('name')).trim());
  await A.audit(ctx, ws.id, 'workspace.created', ws.name);
  return wsOut(ws, 'owner');
});

route('GET', '/api/w/:ws', async (ctx) => {
  const { ws, role } = await A.requireWorkspace(ctx);
  return wsOut(ws, role);
});

route('PATCH', '/api/w/:ws', async (ctx) => {
  const { ws, role } = await A.requireWorkspace(ctx, 'admin');
  const d = {};
  if (ctx.in('name')) d.name = String(ctx.in('name')).trim().slice(0, 190);
  if (ctx.body.settings && typeof ctx.body.settings === 'object') {
    const allowed = ['default_role', 'allow_public_pages', 'allow_guests', 'icon', 'brand_color', 'require_mfa'];
    const picked = Object.fromEntries(Object.entries(ctx.body.settings).filter(([k]) => allowed.includes(k)));
    d.settings = jenc({ ...jdec(ws.settings, {}), ...picked });
  }
  if (Object.keys(d).length) await db.update('workspaces', d, { id: ws.id });
  await A.audit(ctx, ws.id, 'workspace.updated', null, { fields: Object.keys(d) });
  return wsOut(await db.one('SELECT * FROM workspaces WHERE id=?', [ws.id]), role);
});

route('DELETE', '/api/w/:ws', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'owner');
  if (String(ctx.in('confirm')) !== ws.name) throw new ApiError(422, 'Type the workspace name to confirm.');
  await deleteWorkspace(ws);
  await A.audit(ctx, null, 'workspace.deleted', ws.name, { id: Number(ws.id) });
  return { ok: true };
});

route('GET', '/api/w/:ws/members', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const members = (await db.all(`SELECT u.id, u.name, u.email, u.color, u.last_seen, u.totp_secret, m.role, m.joined_at
    FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.joined_at`, [ws.id]))
    .map(({ totp_secret, ...m }) => ({ ...m, id: Number(m.id), mfa: !!totp_secret }));
  const base = baseUrl(ctx.req);
  const invites = (await db.all('SELECT id, email, role, created_at, token FROM invites WHERE workspace_id=? AND accepted_at IS NULL', [ws.id]))
    .map((i) => ({ ...i, link: `${base}/app/#/invite/${i.token}` }));
  return { members, invites };
});

route('POST', '/api/w/:ws/invites', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'admin');
  const role = ['guest', 'member', 'admin'].includes(ctx.in('role')) ? ctx.in('role') : 'member';
  if (role === 'guest' && !limit(ws, 'guests')) throw new ApiError(402, 'Guests need a paid plan (Personal, Team or higher).', 'limit');
  const emails = String(ctx.req_('email')).split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const invited = [];
  for (const email of emails) {
    if (await db.val('SELECT 1 FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?', [ws.id, email])) continue;
    await checkMembers(ws);
    const token = randomHex(24);
    await db.insert('invites', { workspace_id: ws.id, email, role, token, created_by: user.id, created_at: nowMs() });
    const link = `${baseUrl(ctx.req)}/app/#/invite/${token}`;
    await sendMail(email, `${user.name} invited you to ${ws.name}`, `${user.name} invited you to the ${ws.name} workspace on ${setting('app_name', 'PlioPad')}.\n\nJoin here: ${link}`);
    await A.audit(ctx, ws.id, 'member.invited', email, { role });
    invited.push({ email, link });
  }
  return { invited };
});

route('DELETE', '/api/w/:ws/invites/:id', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'admin');
  await db.q('DELETE FROM invites WHERE id=? AND workspace_id=?', [Number(ctx.params.id), ws.id]);
  return { ok: true };
});

route('PATCH', '/api/w/:ws/members/:uid', async (ctx) => {
  const { ws, role: myRole } = await A.requireWorkspace(ctx, 'admin');
  const role = String(ctx.req_('role'));
  if (!(role in A.ROLES)) throw new ApiError(422, 'Unknown role.');
  if (role === 'owner' && myRole !== 'owner') throw new ApiError(403, 'Only an owner can make someone an owner.');
  const current = await db.val('SELECT role FROM members WHERE workspace_id=? AND user_id=?', [ws.id, Number(ctx.params.uid)]);
  if (current === 'owner' && role !== 'owner' && (await ownerCount(ws)) < 2) throw new ApiError(422, 'A workspace needs at least one owner.');
  await db.update('members', { role }, { workspace_id: ws.id, user_id: Number(ctx.params.uid) });
  await A.audit(ctx, ws.id, 'member.role_changed', ctx.params.uid, { role });
  await Stripe.syncSeats(ws);
  return { ok: true };
});

route('DELETE', '/api/w/:ws/members/:uid', async (ctx) => {
  const me = await A.requireUser(ctx);
  const self = Number(ctx.params.uid) === Number(me.id);
  const { ws } = await A.requireWorkspace(ctx, self ? 'guest' : 'admin');
  const target = await db.val('SELECT role FROM members WHERE workspace_id=? AND user_id=?', [ws.id, Number(ctx.params.uid)]);
  if (target === 'owner' && (await ownerCount(ws)) < 2) throw new ApiError(422, 'A workspace needs at least one owner.');
  await db.q('DELETE FROM members WHERE workspace_id=? AND user_id=?', [ws.id, Number(ctx.params.uid)]);
  await A.audit(ctx, ws.id, self ? 'member.left' : 'member.removed', ctx.params.uid);
  await Stripe.syncSeats(ws);
  return { ok: true };
});

/** Shared by the workspace audit log and the platform admin console. Supports ?format=csv. */
export async function auditQuery(ctx, where, params) {
  where = [...where];
  params = [...params];
  if (ctx.query.action) { where.push('a.action LIKE ?'); params.push(`%${ctx.query.action}%`); }
  if (ctx.query.user) { where.push('u.email LIKE ?'); params.push(`%${ctx.query.user}%`); }
  if (ctx.query.from) { where.push('a.created_at >= ?'); params.push(Date.parse(ctx.query.from)); }
  if (ctx.query.to) { where.push('a.created_at < ?'); params.push(Date.parse(ctx.query.to) + 86400000); }
  const lim = Math.min(5000, Number(ctx.query.limit || 200));
  const rows = (await db.all(`SELECT a.*, u.email AS user_email, w.name AS workspace_name FROM audit a LEFT JOIN users u ON u.id=a.user_id
    LEFT JOIN workspaces w ON w.id=a.workspace_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ${lim}`, params))
    .map((r) => ({ ...r, id: Number(r.id), created_at: Number(r.created_at), meta: jdec(r.meta, null) }));
  if (ctx.query.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['time', 'workspace', 'user', 'action', 'target', 'ip', 'details'].join(',')];
    for (const r of rows) lines.push([new Date(r.created_at).toISOString(), r.workspace_name, r.user_email, r.action, r.target, r.ip, r.meta ? jenc(r.meta) : ''].map(esc).join(','));
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit-log.csv"' });
    ctx.res.end(lines.join('\n'));
    return undefined;
  }
  return rows;
}

route('GET', '/api/w/:ws/audit', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'admin');
  if (!limit(ws, 'audit')) throw new ApiError(402, 'The audit log is part of the Business plan.', 'limit');
  return auditQuery(ctx, ['a.workspace_id=?'], [ws.id]);
});

route('GET', '/api/w/:ws/export', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'admin');
  await A.audit(ctx, ws.id, 'workspace.exported');
  const data = {
    format: 'pliopad-export-1', exported_at: new Date().toISOString(), workspace: { name: ws.name },
    notebooks: (await db.all('SELECT * FROM notebooks WHERE workspace_id=? AND deleted=0', [ws.id])).map(notebookOut),
    tags: (await db.all('SELECT * FROM tags WHERE workspace_id=? AND deleted=0', [ws.id])).map(tagOut),
    notes: (await db.all('SELECT * FROM notes WHERE workspace_id=? AND deleted=0', [ws.id])).map((r) => noteOut(r)),
  };
  ctx.res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${ws.slug}-export.json"` });
  ctx.res.end(JSON.stringify(data, null, 1));
});

route('GET', '/api/w/:ws/notes/:id/markdown', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx);
  const r = await db.one('SELECT title, content FROM notes WHERE id=? AND workspace_id=? AND deleted=0', [ctx.params.id, ws.id]);
  if (!r) throw new ApiError(404, 'Not found');
  const name = (r.title || 'Untitled').replace(/[^\w\- ]+/g, '').slice(0, 80) || 'note';
  ctx.res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.md"` });
  ctx.res.end(Blocks.toMarkdown(r.title || 'Untitled', jdec(r.content, [])));
});

route('POST', '/api/w/:ws/import', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'member', true);
  const format = String(ctx.req_('format'));
  const content = String(ctx.req_('content'));
  let nb = isUuid(ctx.in('notebook_id')) ? ctx.in('notebook_id') : null;
  if (!nb) {
    nb = uuid();
    await db.insert('notebooks', { id: nb, workspace_id: ws.id, name: 'Imported ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      icon: '📦', seq: await nextSeq(ws.id), updated_at: nowMs(), created_by: user.id });
  }
  let created = 0;
  if (format === 'enex') {
    const notes = Blocks.parseEnex(content);
    if (!notes.length) throw new ApiError(422, 'That does not look like an Evernote .enex export.');
    const tagIds = {};
    for (const note of notes) {
      const tags = [];
      for (const name of note.tags) {
        if (!tagIds[name]) {
          tagIds[name] = (await db.val('SELECT id FROM tags WHERE workspace_id=? AND name=? AND deleted=0', [ws.id, name])) || uuid();
          await db.upsert('tags', { id: tagIds[name], workspace_id: ws.id, name, seq: await nextSeq(ws.id), updated_at: nowMs() }, ['id']);
        }
        tags.push(tagIds[name]);
      }
      await saveNote(ws, user, uuid(), { title: note.title, notebook_id: nb, tags, created_at: note.created, content: Blocks.fromHtml(note.html) });
      created++;
    }
  } else if (format === 'markdown') {
    let title = String(ctx.in('filename', 'Imported note')).replace(/\.(md|markdown|txt)$/i, '').replace(/\s[0-9a-f]{32}$/, ''); // Notion adds an id
    let body = content;
    const m = /^#\s+(.+)\r?\n/.exec(body);
    if (m) { title = m[1].trim(); body = body.slice(m[0].length); }
    await saveNote(ws, user, uuid(), { title, notebook_id: nb, content: Blocks.fromMarkdown(body) });
    created = 1;
  } else if (format === 'html') {
    await saveNote(ws, user, uuid(), { title: String(ctx.in('filename', 'Imported page')).replace(/\.html?$/i, ''), notebook_id: nb, content: Blocks.fromHtml(content) });
    created = 1;
  } else {
    throw new ApiError(422, 'Supported formats: enex, markdown, html.');
  }
  await A.audit(ctx, ws.id, 'workspace.imported', format, { notes: created });
  return { created, notebook_id: nb };
});

// ---------- Billing ----------

route('GET', '/api/w/:ws/billing', async (ctx) => {
  const { ws, role } = await A.requireWorkspace(ctx, 'admin');
  return { workspace: await wsOut(ws, role), plans: allPlans(), stripe: Stripe.stripeEnabled(), has_customer: !!ws.stripe_customer };
});

route('POST', '/api/w/:ws/billing/checkout', async (ctx) => {
  const { ws, user } = await A.requireWorkspace(ctx, 'owner');
  const plan = getPlan(String(ctx.req_('plan')));
  const seats = Number(await db.val("SELECT COUNT(*) FROM members WHERE workspace_id=? AND role<>'guest'", [ws.id]));
  if (seats > plan.members) throw new ApiError(422, `The ${plan.name} plan is for up to ${plan.members} member${plan.members === 1 ? '' : 's'}. This workspace has ${seats}.`);
  await A.audit(ctx, ws.id, 'billing.checkout_started', ctx.req_('plan'));
  return { url: await Stripe.checkout(ws, user, String(ctx.req_('plan')), baseUrl(ctx.req)) };
});

route('POST', '/api/w/:ws/billing/portal', async (ctx) => {
  const { ws } = await A.requireWorkspace(ctx, 'owner');
  return { url: await Stripe.portal(ws, baseUrl(ctx.req)) };
});
