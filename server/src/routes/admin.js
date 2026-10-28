// Platform admin console API (super admins only): tenants, users, plans, audit, settings and system health.
import fs from 'node:fs';
import os from 'node:os';
import { route } from '../http.js';
import { db } from '../db.js';
import * as A from '../auth.js';
import { allPlans } from '../plans.js';
import { aiAvailable } from '../ai.js';
import { stripeEnabled } from '../stripe.js';
import { wsOut, deleteWorkspace, auditQuery, storageDir } from './workspace.js';
import path from 'node:path';
import { ApiError, nowMs, month, setting, setSetting, jdec, jenc, VERSION, resetMailTransport, ROOT, DATA_DIR, CONFIG_FILE } from '../util.js';

const page = (ctx) => {
  const p = Math.max(1, Number(ctx.query.page || 1));
  const per = Math.min(200, Math.max(10, Number(ctx.query.per || 50)));
  return { per, off: (p - 1) * per, page: p };
};
const num = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, r[k] === null ? null : Number(r[k])])) }));

route('GET', '/api/admin/stats', async (ctx) => {
  await A.requireSuper(ctx);
  const DAY = 86400000;
  const now = nowMs();
  const plans = allPlans();
  let mrr = 0;
  for (const w of await db.all(`SELECT w.plan, (SELECT COUNT(*) FROM members m WHERE m.workspace_id=w.id AND m.role<>'guest') AS seats
    FROM workspaces w WHERE w.status='active' AND w.plan IN ('pro','business')`)) mrr += (plans[w.plan]?.price || 0) * Math.max(1, Number(w.seats));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const signups = [];
  const active = [];
  for (let i = 29; i >= 0; i--) {
    const from = start.getTime() - i * DAY;
    const day = new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    signups.push({ day, n: Number(await db.val('SELECT COUNT(*) FROM users WHERE created_at>=? AND created_at<?', [from, from + DAY])) });
    active.push({ day, n: Number(await db.val('SELECT COUNT(DISTINCT user_id) FROM audit WHERE created_at>=? AND created_at<? AND user_id IS NOT NULL', [from, from + DAY])) });
  }
  const users = Number(await db.val('SELECT COUNT(*) FROM users'));
  const v = async (sql, p = []) => Number(await db.val(sql, p));
  return {
    users, users_7d: await v('SELECT COUNT(*) FROM users WHERE created_at>?', [now - 7 * DAY]),
    dau: await v('SELECT COUNT(*) FROM users WHERE last_seen>?', [now - DAY]),
    mau: await v('SELECT COUNT(*) FROM users WHERE last_seen>?', [now - 30 * DAY]),
    workspaces: await v('SELECT COUNT(*) FROM workspaces'),
    suspended: await v("SELECT COUNT(*) FROM workspaces WHERE status='suspended'"),
    notes: await v('SELECT COUNT(*) FROM notes WHERE deleted=0'),
    notes_7d: await v('SELECT COUNT(*) FROM notes WHERE created_at>? AND deleted=0', [now - 7 * DAY]),
    storage_mb: Math.round((await v('SELECT COALESCE(SUM(storage_bytes),0) FROM workspaces')) / 104857.6) / 10,
    ai_month: await v('SELECT COALESCE(SUM(ai_used),0) FROM workspaces WHERE ai_period=?', [month()]),
    mfa_pct: Math.round((100 * (await v('SELECT COUNT(*) FROM users WHERE totp_secret IS NOT NULL'))) / Math.max(1, users)),
    mrr,
    by_plan: num(await db.all("SELECT plan, COUNT(*) AS n FROM workspaces WHERE status='active' GROUP BY plan"), ['n']),
    signups, active,
    recent: num(await db.all('SELECT a.action, a.target, a.created_at, u.email FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 12'), ['created_at']),
  };
});

route('GET', '/api/admin/workspaces', async (ctx) => {
  await A.requireSuper(ctx);
  const { per, off, page: p } = page(ctx);
  const where = ['1=1'];
  const params = [];
  if (ctx.query.q) { where.push(`(${db.ilike('w.name')} OR ${db.ilike('w.slug')})`); params.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
  if (ctx.query.plan) { where.push('w.plan=?'); params.push(ctx.query.plan); }
  if (ctx.query.status) { where.push('w.status=?'); params.push(ctx.query.status); }
  const w = where.join(' AND ');
  const sort = { name: 'w.name', storage: 'w.storage_bytes DESC', members: 'members DESC', notes: 'notes DESC' }[ctx.query.sort] || 'w.created_at DESC';
  const rows = await db.all(`SELECT w.id, w.name, w.slug, w.plan, w.status, w.storage_bytes, w.ai_used, w.created_at,
    (SELECT COUNT(*) FROM members m WHERE m.workspace_id=w.id) AS members,
    (SELECT COUNT(*) FROM notes n WHERE n.workspace_id=w.id AND n.deleted=0) AS notes,
    (SELECT u.email FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=w.id AND m.role='owner' LIMIT 1) AS owner
    FROM workspaces w WHERE ${w} ORDER BY ${sort} LIMIT ${per} OFFSET ${off}`, params);
  return { rows: num(rows, ['id', 'storage_bytes', 'ai_used', 'created_at', 'members', 'notes']), total: Number(await db.val(`SELECT COUNT(*) FROM workspaces w WHERE ${w}`, params)), page: p, per };
});

route('GET', '/api/admin/workspaces/:id', async (ctx) => {
  await A.requireSuper(ctx);
  const ws = await db.one('SELECT * FROM workspaces WHERE id=?', [Number(ctx.params.id)]);
  if (!ws) throw new ApiError(404, 'Not found');
  return {
    ...(await wsOut(ws, 'owner')), created_at: Number(ws.created_at), stripe_customer: ws.stripe_customer, stripe_sub: ws.stripe_sub,
    members: num(await db.all('SELECT u.id, u.name, u.email, u.last_seen, m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=?', [ws.id]), ['id', 'last_seen']),
    audit: num(await db.all('SELECT a.*, u.email AS user_email FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.workspace_id=? ORDER BY a.id DESC LIMIT 50', [ws.id]), ['id', 'created_at']),
  };
});

route('PATCH', '/api/admin/workspaces/:id', async (ctx) => {
  await A.requireSuper(ctx);
  const ws = await db.one('SELECT * FROM workspaces WHERE id=?', [Number(ctx.params.id)]);
  if (!ws) throw new ApiError(404, 'Not found');
  const d = {};
  if (ctx.in('plan') && allPlans()[ctx.in('plan')]) d.plan = ctx.in('plan');
  if (['active', 'suspended'].includes(ctx.in('status'))) d.status = ctx.in('status');
  if (ctx.in('name')) d.name = String(ctx.in('name')).slice(0, 190);
  if (ctx.body.limits && typeof ctx.body.limits === 'object') {
    const limits = Object.fromEntries(Object.entries(ctx.body.limits).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, typeof v === 'boolean' ? v : Number(v)]));
    d.settings = jenc({ ...jdec(ws.settings, {}), limits });
  }
  if (ctx.in('reset_ai')) d.ai_used = 0;
  if (Object.keys(d).length) await db.update('workspaces', d, { id: ws.id });
  await A.audit(ctx, ws.id, 'admin.workspace_updated', ws.name, { ...d, settings: undefined, limits: ctx.body.limits });
  return { ok: true };
});

route('DELETE', '/api/admin/workspaces/:id', async (ctx) => {
  await A.requireSuper(ctx);
  const ws = await db.one('SELECT * FROM workspaces WHERE id=?', [Number(ctx.params.id)]);
  if (!ws) throw new ApiError(404, 'Not found');
  if (String(ctx.in('confirm')) !== ws.name) throw new ApiError(422, 'Type the workspace name to confirm.');
  await deleteWorkspace(ws);
  await A.audit(ctx, null, 'admin.workspace_deleted', ws.name, { id: Number(ws.id) });
  return { ok: true };
});

route('GET', '/api/admin/users', async (ctx) => {
  await A.requireSuper(ctx);
  const { per, off, page: p } = page(ctx);
  const where = ['1=1'];
  const params = [];
  if (ctx.query.q) { where.push(`(${db.ilike('email')} OR ${db.ilike('name')})`); params.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`); }
  if (ctx.query.status) { where.push('status=?'); params.push(ctx.query.status); }
  if (ctx.query.super) where.push('is_super=1');
  const w = where.join(' AND ');
  const rows = await db.all(`SELECT id, email, name, status, is_super, CASE WHEN totp_secret IS NULL THEN 0 ELSE 1 END AS mfa, created_at, last_seen,
    (SELECT COUNT(*) FROM members m WHERE m.user_id=users.id) AS workspaces FROM users WHERE ${w} ORDER BY created_at DESC LIMIT ${per} OFFSET ${off}`, params);
  return { rows: num(rows, ['id', 'is_super', 'mfa', 'created_at', 'last_seen', 'workspaces']), total: Number(await db.val(`SELECT COUNT(*) FROM users WHERE ${w}`, params)), page: p, per };
});

route('GET', '/api/admin/users/:id', async (ctx) => {
  await A.requireSuper(ctx);
  const u = await db.one('SELECT id, email, name, status, is_super, CASE WHEN totp_secret IS NULL THEN 0 ELSE 1 END AS mfa, created_at, last_seen FROM users WHERE id=?', [Number(ctx.params.id)]);
  if (!u) throw new ApiError(404, 'Not found');
  return {
    ...num([u], ['id', 'is_super', 'mfa', 'created_at', 'last_seen'])[0],
    workspaces: num(await db.all('SELECT w.id, w.name, w.plan, m.role FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=?', [u.id]), ['id']),
    sessions: num(await db.all("SELECT id, label, kind, created_at, last_used, impersonator_id FROM tokens WHERE user_id=? AND kind IN ('session','api') ORDER BY last_used DESC", [u.id]), ['id', 'created_at', 'last_used']),
    audit: num(await db.all('SELECT * FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 50', [u.id]), ['id', 'created_at']),
  };
});

route('PATCH', '/api/admin/users/:id', async (ctx) => {
  const me = await A.requireSuper(ctx);
  const u = await db.one('SELECT * FROM users WHERE id=?', [Number(ctx.params.id)]);
  if (!u) throw new ApiError(404, 'Not found');
  const self = Number(u.id) === Number(me.id);
  const d = {};
  if (['active', 'disabled'].includes(ctx.in('status'))) {
    if (self) throw new ApiError(422, 'You cannot disable yourself.');
    d.status = ctx.in('status');
    if (d.status === 'disabled') await db.q('DELETE FROM tokens WHERE user_id=?', [u.id]);
  }
  if (ctx.has('is_super')) {
    if (self && !ctx.body.is_super) throw new ApiError(422, 'You cannot remove your own admin access.');
    d.is_super = ctx.body.is_super ? 1 : 0;
  }
  if (ctx.in('name')) d.name = String(ctx.in('name')).slice(0, 190);
  if (ctx.in('reset_mfa')) d.totp_secret = null;
  if (Object.keys(d).length) await db.update('users', d, { id: u.id });
  await A.audit(ctx, null, 'admin.user_updated', u.email, { fields: Object.keys(d) });
  return { ok: true };
});

route('POST', '/api/admin/users/:id/revoke', async (ctx) => {
  await A.requireSuper(ctx);
  await db.q('DELETE FROM tokens WHERE user_id=?', [Number(ctx.params.id)]);
  await A.audit(ctx, null, 'admin.sessions_revoked', ctx.params.id);
  return { ok: true };
});

/** Signs in as a user to troubleshoot. Needs a reason, lasts one day, and every action is tagged in the audit log. */
route('POST', '/api/admin/users/:id/impersonate', async (ctx) => {
  const me = await A.requireSuper(ctx);
  const u = await db.one('SELECT * FROM users WHERE id=?', [Number(ctx.params.id)]);
  if (!u) throw new ApiError(404, 'Not found');
  await A.audit(ctx, null, 'admin.impersonated', u.email, { reason: String(ctx.req_('reason')).trim() });
  return { token: await A.issueToken(u.id, `Support session by ${me.email}`, 'session', me.id, 1) };
});

route('DELETE', '/api/admin/users/:id', async (ctx) => {
  const me = await A.requireSuper(ctx);
  const u = await db.one('SELECT * FROM users WHERE id=?', [Number(ctx.params.id)]);
  if (!u || Number(u.id) === Number(me.id)) throw new ApiError(422, 'This user cannot be deleted.');
  for (const ws of await db.all("SELECT w.* FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? AND m.role='owner'", [u.id])) {
    if (Number(await db.val('SELECT COUNT(*) FROM members WHERE workspace_id=?', [ws.id])) === 1) await deleteWorkspace(ws);
  }
  for (const t of ['members', 'tokens', 'presence', 'notifications']) await db.q(`DELETE FROM ${t} WHERE user_id=?`, [u.id]);
  await db.q('DELETE FROM users WHERE id=?', [u.id]);
  await A.audit(ctx, null, 'admin.user_deleted', u.email);
  return { ok: true };
});

route('GET', '/api/admin/audit', async (ctx) => {
  await A.requireSuper(ctx);
  return ctx.query.workspace ? auditQuery(ctx, ['a.workspace_id=?'], [Number(ctx.query.workspace)]) : auditQuery(ctx, ['1=1'], []);
});

const ADMIN_SETTINGS = ['app_name', 'signup_mode', 'signup_domains', 'default_plan', 'max_workspaces_per_user', 'mail_from', 'smtp', 'anthropic_api_key',
  'ai_model', 'stripe_secret', 'stripe_webhook_secret', 'stripe_prices', 'plans', 'announcement', 'support_email', 'terms_url', 'privacy_url'];
const SECRETS = ['anthropic_api_key', 'stripe_secret', 'stripe_webhook_secret'];
const mask = (v) => (v ? '••••' + String(v).slice(-4) : '');

route('GET', '/api/admin/settings', async (ctx) => {
  await A.requireSuper(ctx);
  const out = Object.fromEntries(ADMIN_SETTINGS.map((k) => [k, SECRETS.includes(k) ? mask(setting(k)) : setting(k)]));
  if (out.smtp?.pass) out.smtp = { ...out.smtp, pass: mask(out.smtp.pass) };
  return { ...out, plan_defaults: allPlans() };
});

route('PUT', '/api/admin/settings', async (ctx) => {
  await A.requireSuper(ctx);
  const changed = [];
  for (const [k, v] of Object.entries(ctx.body)) {
    if (!ADMIN_SETTINGS.includes(k)) continue;
    if (SECRETS.includes(k) && typeof v === 'string' && v.startsWith('••••')) continue; // unchanged mask
    let value = v;
    if (k === 'smtp' && v && typeof v.pass === 'string' && v.pass.startsWith('••••')) value = { ...v, pass: setting('smtp')?.pass };
    await setSetting(db, k, value);
    changed.push(k);
  }
  if (changed.includes('smtp')) resetMailTransport();
  await A.audit(ctx, null, 'admin.settings_changed', null, { keys: changed });
  return { ok: true, changed };
});

route('GET', '/api/admin/system', async (ctx) => {
  await A.requireSuper(ctx);
  const dir = storageDir();
  let freeGb = null;
  try { const s = fs.statfsSync(dir); freeGb = Math.round((s.bavail * s.bsize) / 1073741824 * 10) / 10; } catch { /* not supported everywhere */ }
  let writable = true;
  try { fs.accessSync(dir, fs.constants.W_OK); } catch { writable = false; }
  const dbVersion = db.driver === 'mysql' ? await db.val('SELECT VERSION()') : await db.val('SELECT sqlite_version()');
  return {
    version: VERSION, node: process.version, db: `${db.driver} ${dbVersion}`, schema: Number(setting('schema_version', 0)),
    uptime_h: Math.round(process.uptime() / 360) / 10, memory_mb: Math.round(process.memoryUsage().rss / 1048576), load: os.loadavg()[0].toFixed(2),
    storage_free_gb: freeGb, storage_writable: writable, ai_ready: aiAvailable(), stripe: stripeEnabled(), mail: !!setting('smtp')?.host,
    jobs_last: setting('jobs_last'),
    app_dir: ROOT, data_dir: DATA_DIR, config_file: CONFIG_FILE, storage_dir: dir,
    config_in_app: CONFIG_FILE.startsWith(ROOT + path.sep),
  };
});
