// Passwords, bearer tokens, roles, TOTP two-factor, throttling and the audit log.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';
import { ApiError, nowMs, randomHex, sha256, jdec, jenc } from './util.js';

export const ROLES = { guest: 0, member: 1, admin: 2, owner: 3 };
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(pw, stored) {
  const [alg, salt, hex] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hex) return false;
  const key = await scrypt(pw, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, Buffer.from(hex, 'hex'));
}

export function validatePassword(p) {
  if (String(p).length < 10) throw new ApiError(422, 'Use at least 10 characters for your password.');
}

export async function issueToken(userId, label = 'web', kind = 'session', impersonator = null, ttlDays = 90) {
  const raw = randomHex(32);
  await db.insert('tokens', {
    user_id: userId, hash: sha256(raw), label: String(label).slice(0, 120), kind, created_at: nowMs(), last_used: nowMs(),
    expires_at: ttlDays ? nowMs() + ttlDays * 86400000 : null, impersonator_id: impersonator,
  });
  return raw;
}

/** Resolves the signed-in user from "Authorization: Bearer <token>" onto ctx.user / ctx.token. */
export async function loadUser(ctx) {
  if (ctx._authLoaded) return ctx.user;
  ctx._authLoaded = true;
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec((ctx.req.headers.authorization || '').trim());
  if (!m) return null;
  const t = await db.one('SELECT * FROM tokens WHERE hash=?', [sha256(m[1].toLowerCase())]);
  if (!t || (t.expires_at && Number(t.expires_at) < nowMs())) return null;
  const u = await db.one('SELECT * FROM users WHERE id=?', [t.user_id]);
  if (!u || u.status !== 'active') return null;
  if (nowMs() - Number(t.last_used) > 60000) {
    await db.update('tokens', { last_used: nowMs() }, { id: t.id });
    await db.update('users', { last_seen: nowMs() }, { id: u.id });
  }
  ctx.user = u;
  ctx.token = t;
  return u;
}

export async function requireUser(ctx) {
  const u = await loadUser(ctx);
  if (!u) throw new ApiError(401, 'Please sign in.', 'auth');
  return u;
}

export async function requireSuper(ctx) {
  const u = await requireUser(ctx);
  if (!Number(u.is_super)) throw new ApiError(403, 'Platform administrators only.');
  return u;
}

/** Checks membership and minimum role. Returns { ws, role, user }. */
export async function requireWorkspace(ctx, minRole = 'guest', write = false) {
  const user = await requireUser(ctx);
  const ws = await db.one('SELECT * FROM workspaces WHERE id=?', [Number(ctx.params.ws)]);
  if (!ws) throw new ApiError(404, 'Workspace not found.');
  let role = await db.val('SELECT role FROM members WHERE workspace_id=? AND user_id=?', [ws.id, user.id]);
  if (!role && Number(user.is_super)) role = 'owner';
  if (!role) throw new ApiError(403, 'You are not a member of this workspace.');
  if (ROLES[role] < ROLES[minRole]) throw new ApiError(403, 'Your role does not allow this.');
  if (ws.status === 'suspended') throw new ApiError(423, 'This workspace is suspended. Contact support.', 'suspended');
  if (write && role === 'guest') throw new ApiError(403, 'Guests have read-only access.');
  return { ws, role, user };
}

export function publicUser(u) {
  return { id: Number(u.id), email: u.email, name: u.name, color: u.color, is_super: !!Number(u.is_super), mfa: !!u.totp_secret, prefs: jdec(u.prefs, {}) };
}

export async function throttle(key, max, windowSec) {
  await db.q('DELETE FROM throttle WHERE at < ?', [nowMs() - 86400000]);
  const n = Number(await db.val('SELECT COUNT(*) FROM throttle WHERE k=? AND at>?', [key, nowMs() - windowSec * 1000]));
  if (n >= max) throw new ApiError(429, 'Too many attempts. Please wait a few minutes and try again.');
  await db.insert('throttle', { k: key, at: nowMs() });
}

export async function audit(ctx, wsId, action, target = null, meta = {}) {
  if (ctx?.token?.impersonator_id) meta = { ...meta, impersonated_by: Number(ctx.token.impersonator_id) };
  await db.insert('audit', {
    workspace_id: wsId ?? null, user_id: ctx?.user?.id ?? null, action, target: target === null ? null : String(target).slice(0, 190),
    meta: Object.keys(meta).length ? jenc(meta) : null, ip: ctx?.ip ?? null, created_at: nowMs(),
  });
}

// ---- TOTP (RFC 6238): works with Google Authenticator, 1Password, Authy, Microsoft Authenticator ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function totpSecret() {
  return [...crypto.randomBytes(20)].map((b) => B32[b & 31]).join('');
}

function totpCode(secret, step) {
  let bits = '';
  for (const c of secret.toUpperCase()) {
    const p = B32.indexOf(c);
    if (p >= 0) bits += p.toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) || []).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[19] & 0xf;
  const n = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
  return String(n).padStart(6, '0');
}

export function totpVerify(secret, code) {
  const c = String(code).replace(/\D/g, '');
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((i) => totpCode(secret, step + i) === c);
}
