// Shared helpers: config, ids, JSON, errors, settings and mail.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSION = '1.1.0';
const argConfig = process.argv.find((a) => a.startsWith('--config='))?.slice(9);
/**
 * The data folder: settings (config.json), uploaded files (storage/) and app downloads (downloads/) live here, outside the
 * folder a redeploy replaces. Found automatically, first match wins:
 *   PLIOPAD_DATA; "pliopad-data" in any folder above the app; ~/pliopad-data; ~/www/<site>/pliopad-data.
 * Without one, everything stays in the app folder (local development).
 */
function dataDirCandidates() {
  const out = [];
  for (let dir = path.dirname(ROOT); ; dir = path.dirname(dir)) {
    out.push(path.join(dir, 'pliopad-data'));
    if (dir === path.dirname(dir)) break;
  }
  const home = os.homedir();
  out.push(path.join(home, 'pliopad-data'));
  try { for (const site of fs.readdirSync(path.join(home, 'www'))) out.push(path.join(home, 'www', site, 'pliopad-data')); } catch { /* no ~/www */ }
  return [...new Set(out)];
}
export const DATA_DIR_SEARCHED = process.env.PLIOPAD_DATA ? [path.resolve(ROOT, process.env.PLIOPAD_DATA)] : dataDirCandidates();
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// A data folder that holds config.json wins over an empty one.
export let DATA_DIR = process.env.PLIOPAD_DATA ? path.resolve(ROOT, process.env.PLIOPAD_DATA)
  : DATA_DIR_SEARCHED.find((d) => fs.existsSync(path.join(d, 'config.json'))) || DATA_DIR_SEARCHED.find(isDir) || null;
/** Where a brand-new install keeps its data when no data folder exists yet: ~/pliopad-data, outside every site folder. */
export const DEFAULT_DATA_DIR = path.join(os.homedir(), 'pliopad-data');

/** Appends a line to logs/startup.log in the data folder (or the app folder), which the host's File Manager can show. */
export function appLog(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    const dir = path.join(DATA_DIR || ROOT, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'startup.log'), `${line}\n`);
  } catch { /* best effort */ }
}

/** A file or folder in the data folder, falling back to the app folder when it hasn't been moved there yet. */
export function dataPath(name) {
  if (!DATA_DIR) return path.join(ROOT, name);
  const inData = path.join(DATA_DIR, name);
  const inApp = path.join(ROOT, name);
  return !fs.existsSync(inData) && fs.existsSync(inApp) ? inApp : inData;
}

// A relative PLIOPAD_CONFIG is relative to the app folder.
/** Warnings about settings found at startup (printed to the log by server.js). */
export const STARTUP_WARNINGS = [];
// PLIOPAD_CONFIG is only trusted when the file exists; a wrong path must not hide the real settings file.
const envConfig = process.env.PLIOPAD_CONFIG && path.resolve(ROOT, process.env.PLIOPAD_CONFIG);
if (envConfig && !fs.existsSync(envConfig)) STARTUP_WARNINGS.push(`PLIOPAD_CONFIG points to ${envConfig}, which does not exist; ignoring it.`);
const CONFIG_PINNED = !!argConfig || !!(envConfig && fs.existsSync(envConfig));
export let CONFIG_FILE = argConfig ? path.resolve(ROOT, argConfig) : CONFIG_PINNED ? envConfig : dataPath('config.json');

/**
 * Where the installer saves settings: the configured file, or a data folder outside the app (created if needed),
 * never the app folder itself, which a redeploy replaces.
 */
export function settingsTarget() {
  if (CONFIG_PINNED) return CONFIG_FILE;
  const dir = DATA_DIR || DEFAULT_DATA_DIR;
  fs.mkdirSync(dir, { recursive: true });
  DATA_DIR = dir;
  CONFIG_FILE = path.join(dir, 'config.json');
  return CONFIG_FILE;
}

export class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let cfg = null;
export function config(key, def = undefined) {
  if (cfg === null) cfg = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
  if (key === undefined) return cfg;
  let env = key === 'config' ? undefined : process.env['PLIOPAD_' + key.toUpperCase()];
  // Structured settings (PLIOPAD_DB) can be given as JSON in an environment variable.
  if (env && /^s*[{[]/.test(env)) try { env = JSON.parse(env); } catch { /* keep the raw string */ }
  return env ?? cfg[key] ?? def;
}
export function reloadConfig() { cfg = null; }
export const isInstalled = () => !!config('db');

export const nowMs = () => Date.now();
export const uuid = () => crypto.randomUUID();
export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (s) => crypto.createHmac('sha256', String(config('app_key', 'dev'))).update(s).digest('hex');

export function jdec(s, def = []) {
  if (s === null || s === undefined || s === '') return def;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s) ?? def; } catch { return def; }
}
export const jenc = (v) => JSON.stringify(v);

export function slugify(s) {
  const out = String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40);
  return out || 'workspace';
}

export const strLimit = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const clampStr = (v, n) => (v === null || v === undefined ? null : String(v).slice(0, n));
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const ymd = (d = new Date()) => d.toISOString().slice(0, 10);
export const month = (d = new Date()) => d.toISOString().slice(0, 7);

export function baseUrl(req) {
  const c = config('base_url');
  if (c) return c.replace(/\/$/, '');
  if (!req) return 'http://localhost:' + (process.env.PORT || 3000);
  const proto = req.headers['x-forwarded-proto']?.split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// ---- Settings: stored in the database and editable from the admin console; config.json is the fallback. ----
let settingsCache = {};
export function setting(key, def = null) {
  return settingsCache[key] ?? config(key) ?? def;
}
export async function loadSettings(db) {
  const rows = await db.all('SELECT k, v FROM settings');
  // A stored JSON null (or an empty value) means "not set"; never let it come back as the text "null".
  settingsCache = Object.fromEntries(rows.map((r) => [r.k, jdec(r.v, null)]).filter(([, v]) => v !== null && v !== ''));
}
export async function setSetting(db, key, value) {
  if (value === null || value === undefined || value === '') {
    await db.q('DELETE FROM settings WHERE k=?', [key]);
    delete settingsCache[key];
    return;
  }
  await db.upsert('settings', { k: key, v: jenc(value) }, ['k']);
  settingsCache[key] = value;
}

// ---- Mail: SMTP from settings (SiteGround gives every site an SMTP account). Logs instead when not configured. ----
let transport = null;
export async function sendMail(to, subject, text) {
  const smtp = setting('smtp');
  if (!smtp?.host) {
    console.log(`[mail not configured] to=${to} subject=${subject}\n${text}`);
    return false;
  }
  try {
    if (!transport) {
      const nodemailer = (await import('nodemailer')).default;
      transport = nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port || 465), secure: Number(smtp.port || 465) === 465,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined });
    }
    await transport.sendMail({ from: `${setting('app_name', 'PlioPad')} <${setting('mail_from') || smtp.user}>`, to, subject, text });
    return true;
  } catch (e) {
    console.error('[mail] failed:', e.message);
    return false;
  }
}
export function resetMailTransport() { transport = null; }
