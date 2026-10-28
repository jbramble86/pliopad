// Sign-up, sign-in, profile, two-factor, sessions, password reset and invitations.
import { route } from '../http.js';
import { db } from '../db.js';
import * as A from '../auth.js';
import { createWorkspace } from '../seed.js';
import { allPlans } from '../plans.js';
import { aiAvailable } from '../ai.js';
import { stripeEnabled, syncSeats } from '../stripe.js';
import { ApiError, nowMs, setting, sendMail, baseUrl, sha256, VERSION, jenc, jdec } from '../util.js';

export async function mePayload(u) {
  const workspaces = (await db.all(`SELECT w.id, w.name, w.slug, w.plan, w.status, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id=? ORDER BY m.joined_at`, [u.id])).map((w) => ({ ...w, id: Number(w.id) }));
  return {
    user: A.publicUser(u), workspaces, ai: aiAvailable(), billing: stripeEnabled(), plans: allPlans(),
    app: { name: setting('app_name', 'PlioPad'), announcement: setting('announcement'), version: VERSION },
  };
}

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

route('POST', '/api/auth/signup', async (ctx) => {
  await A.throttle('signup:' + ctx.ip, 10, 3600);
  const email = String(ctx.req_('email')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, 'Enter a valid email address.');
  const pass = String(ctx.req_('password'));
  A.validatePassword(pass);
  const first = !Number(await db.val('SELECT COUNT(*) FROM users'));
  const invite = ctx.in('invite') ? await db.one('SELECT * FROM invites WHERE token=? AND accepted_at IS NULL', [ctx.in('invite')]) : null;
  const mode = setting('signup_mode', 'open');
  if (!first && mode === 'closed') throw new ApiError(403, 'Sign-ups are closed.');
  if (!first && mode === 'invite' && !invite) throw new ApiError(403, 'Sign-up is by invitation only.');
  const domains = String(setting('signup_domains', '') || '').split(',').map((d) => d.trim()).filter(Boolean);
  if (!first && domains.length && !invite && !domains.includes(email.split('@')[1])) throw new ApiError(403, 'Sign-up is limited to approved email domains.');
  if (await db.val('SELECT 1 FROM users WHERE email=?', [email])) throw new ApiError(409, 'An account with that email already exists. Sign in instead.');
  const name = String(ctx.in('name', '') || '').trim() || email.split('@')[0];
  const uid = await db.insert('users', { email, name: name.slice(0, 190), pass_hash: await A.hashPassword(pass), is_super: first ? 1 : 0,
    color: COLORS[Math.floor(Math.random() * COLORS.length)], created_at: nowMs(), last_seen: nowMs() });
  const u = await db.one('SELECT * FROM users WHERE id=?', [uid]);
  ctx.user = u;
  if (invite) {
    await db.insert('members', { workspace_id: invite.workspace_id, user_id: uid, role: invite.role, joined_at: nowMs() });
    await db.update('invites', { accepted_at: nowMs() }, { id: invite.id });
    await A.audit(ctx, invite.workspace_id, 'member.joined', email);
  } else {
    const ws = await createWorkspace(u, String(ctx.in('workspace', '') || '').trim() || `${name}'s workspace`);
    await A.audit(ctx, ws.id, 'workspace.created', ws.name);
  }
  await A.audit(ctx, null, 'user.signup', email);
  return { token: await A.issueToken(uid, ctx.in('device', 'web')), ...(await mePayload(u)) };
});

route('POST', '/api/auth/login', async (ctx) => {
  const email = String(ctx.req_('email')).trim().toLowerCase();
  await A.throttle('login:' + ctx.ip, 30, 900);
  await A.throttle('login:' + email, 8, 900);
  const u = await db.one('SELECT * FROM users WHERE email=?', [email]);
  if (!u || !(await A.verifyPassword(String(ctx.req_('password')), u.pass_hash))) {
    await db.insert('audit', { action: 'login.failed', target: email, ip: ctx.ip, created_at: nowMs() });
    throw new ApiError(401, 'That email and password do not match.');
  }
  if (u.status !== 'active') throw new ApiError(403, 'This account is disabled.');
  if (u.totp_secret) {
    const code = String(ctx.in('code', '') || '');
    if (!code) throw new ApiError(401, 'Enter the 6-digit code from your authenticator app.', 'mfa');
    if (!A.totpVerify(u.totp_secret, code)) throw new ApiError(401, 'That code is not right. Try the newest one.', 'mfa');
  }
  ctx.user = u;
  await A.audit(ctx, null, 'login', email, { device: ctx.in('device', 'web') });
  return { token: await A.issueToken(u.id, ctx.in('device', 'web')), ...(await mePayload(u)) };
});

route('POST', '/api/auth/logout', async (ctx) => {
  await A.loadUser(ctx);
  if (ctx.token) await db.q('DELETE FROM tokens WHERE id=?', [ctx.token.id]);
  return { ok: true };
});

route('POST', '/api/auth/forgot', async (ctx) => {
  await A.throttle('forgot:' + ctx.ip, 5, 3600);
  const u = await db.one('SELECT * FROM users WHERE email=?', [String(ctx.req_('email')).trim().toLowerCase()]);
  if (u) {
    await db.q("DELETE FROM tokens WHERE user_id=? AND kind='reset'", [u.id]);
    const raw = await A.issueToken(u.id, 'password reset', 'reset', null, 1);
    await sendMail(u.email, `Reset your ${setting('app_name', 'PlioPad')} password`,
      `Open this link within 24 hours to choose a new password:\n\n${baseUrl(ctx.req)}/app/#/reset/${raw}\n\nIf you did not ask for this, you can ignore this email.`);
  }
  return { ok: true }; // the same answer either way, so emails cannot be probed
});

route('POST', '/api/auth/reset', async (ctx) => {
  const t = await db.one("SELECT * FROM tokens WHERE hash=? AND kind='reset' AND expires_at>?", [sha256(String(ctx.req_('token'))), nowMs()]);
  if (!t) throw new ApiError(400, 'This reset link has expired. Ask for a new one.');
  const pass = String(ctx.req_('password'));
  A.validatePassword(pass);
  await db.update('users', { pass_hash: await A.hashPassword(pass) }, { id: t.user_id });
  await db.q('DELETE FROM tokens WHERE user_id=?', [t.user_id]); // signs out everywhere
  return { ok: true };
});

route('GET', '/api/me', async (ctx) => mePayload(await A.requireUser(ctx)));

route('PATCH', '/api/me', async (ctx) => {
  const u = await A.requireUser(ctx);
  const d = {};
  if (ctx.in('name')) d.name = String(ctx.in('name')).trim().slice(0, 190);
  if (ctx.in('color')) d.color = String(ctx.in('color')).slice(0, 16);
  if (ctx.body.prefs && typeof ctx.body.prefs === 'object') d.prefs = jenc({ ...jdec(u.prefs, {}), ...ctx.body.prefs });
  if (ctx.in('new_password')) {
    if (!(await A.verifyPassword(String(ctx.in('password', '')), u.pass_hash))) throw new ApiError(403, 'Your current password is not right.');
    A.validatePassword(ctx.in('new_password'));
    d.pass_hash = await A.hashPassword(String(ctx.in('new_password')));
    await db.q('DELETE FROM tokens WHERE user_id=? AND id<>?', [u.id, ctx.token.id]);
  }
  if (Object.keys(d).length) await db.update('users', d, { id: u.id });
  return mePayload(await db.one('SELECT * FROM users WHERE id=?', [u.id]));
});

route('POST', '/api/me/mfa/setup', async (ctx) => {
  const u = await A.requireUser(ctx);
  const secret = A.totpSecret();
  const app = setting('app_name', 'PlioPad');
  return { secret, uri: `otpauth://totp/${encodeURIComponent(`${app}:${u.email}`)}?secret=${secret}&issuer=${encodeURIComponent(app)}` };
});

route('POST', '/api/me/mfa/enable', async (ctx) => {
  const u = await A.requireUser(ctx);
  const secret = String(ctx.req_('secret'));
  if (!A.totpVerify(secret, ctx.req_('code'))) throw new ApiError(422, 'That code is not right. Check the time on your phone and try again.');
  await db.update('users', { totp_secret: secret }, { id: u.id });
  await A.audit(ctx, null, 'mfa.enabled', u.email);
  return { ok: true };
});

route('POST', '/api/me/mfa/disable', async (ctx) => {
  const u = await A.requireUser(ctx);
  if (!u.totp_secret || !A.totpVerify(u.totp_secret, ctx.req_('code'))) throw new ApiError(422, 'That code is not right.');
  await db.update('users', { totp_secret: null }, { id: u.id });
  await A.audit(ctx, null, 'mfa.disabled', u.email);
  return { ok: true };
});

route('GET', '/api/me/sessions', async (ctx) => {
  const u = await A.requireUser(ctx);
  const rows = await db.all("SELECT * FROM tokens WHERE user_id=? AND kind IN ('session','api') ORDER BY last_used DESC", [u.id]);
  return rows.map((t) => ({ id: Number(t.id), label: t.label, kind: t.kind, created_at: Number(t.created_at), last_used: Number(t.last_used),
    current: Number(t.id) === Number(ctx.token.id) }));
});

route('DELETE', '/api/me/sessions/:id', async (ctx) => {
  const u = await A.requireUser(ctx);
  await db.q('DELETE FROM tokens WHERE id=? AND user_id=?', [Number(ctx.params.id), u.id]);
  return { ok: true };
});

route('POST', '/api/me/tokens', async (ctx) => {
  const u = await A.requireUser(ctx);
  const label = String(ctx.in('label', 'API token'));
  const token = await A.issueToken(u.id, label, 'api', null, null);
  await A.audit(ctx, null, 'api_token.created', label);
  return { token };
});

route('GET', '/api/me/notifications', async (ctx) => {
  const u = await A.requireUser(ctx);
  return db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', [u.id]);
});

route('POST', '/api/me/notifications/read', async (ctx) => {
  const u = await A.requireUser(ctx);
  await db.q('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL', [nowMs(), u.id]);
  return { ok: true };
});

route('GET', '/api/invites/:token', async (ctx) => {
  const i = await db.one(`SELECT i.email, i.role, w.name AS workspace FROM invites i JOIN workspaces w ON w.id=i.workspace_id
    WHERE i.token=? AND i.accepted_at IS NULL`, [ctx.params.token]);
  if (!i) throw new ApiError(404, 'This invitation was already used or withdrawn.');
  return { ...i, has_account: !!(await db.val('SELECT 1 FROM users WHERE email=?', [i.email])) };
});

route('POST', '/api/invites/:token/accept', async (ctx) => {
  const u = await A.requireUser(ctx);
  const i = await db.one('SELECT * FROM invites WHERE token=? AND accepted_at IS NULL', [ctx.params.token]);
  if (!i) throw new ApiError(404, 'This invitation was already used or withdrawn.');
  if (!(await db.val('SELECT 1 FROM members WHERE workspace_id=? AND user_id=?', [i.workspace_id, u.id]))) {
    await db.insert('members', { workspace_id: i.workspace_id, user_id: u.id, role: i.role, joined_at: nowMs() });
  }
  await db.update('invites', { accepted_at: nowMs() }, { id: i.id });
  await A.audit(ctx, i.workspace_id, 'member.joined', u.email);
  await syncSeats(await db.one('SELECT * FROM workspaces WHERE id=?', [i.workspace_id]));
  return mePayload(u);
});
