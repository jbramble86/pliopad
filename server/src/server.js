// Pliopad server: API, static web app and admin console, file downloads, published pages, installer and background jobs.
// Listens on PORT (SiteGround's Node.js manager sets it), default 3000.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { migrate } from './schema.js';
import { dispatch, route, sendJson } from './http.js';
import { renderPublicPage, renderInstaller } from './pages.js';
import { renderLanding } from './landing.js';
import { startJobs } from './jobs.js';
import { ROOT, CONFIG_FILE, VERSION, config, reloadConfig, isInstalled, loadSettings, setting, hmac, randomHex, nowMs, ApiError } from './util.js';
import { hashPassword } from './auth.js';
import { webhook } from './stripe.js';
import { createWorkspace } from './seed.js';
import { storageDir } from './routes/workspace.js';
import './routes/auth.js';
import './routes/workspace.js';
import './routes/content.js';
import './routes/admin.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain',
  '.apk': 'application/vnd.android.package-archive', '.zip': 'application/zip', '.dmg': 'application/x-apple-diskimage' };

route('GET', '/api/health', async () => ({ ok: true, version: VERSION }));
route('GET', '/api/config', async () => ({ app_name: setting('app_name', 'PlioPad'), signup_mode: setting('signup_mode', 'open'),
  terms_url: setting('terms_url'), privacy_url: setting('privacy_url'), version: VERSION }));

// ---- App downloads: drop builds into the downloads folder (see public/downloads/README.txt) and the web app offers them ----
// PLIOPAD_DOWNLOADS can point outside the app folder, so large builds stay out of Git and survive redeploys.
const DOWNLOADS = path.resolve(ROOT, config('downloads', 'public/downloads'));
const APPS = [
  { id: 'windows', name: 'Windows', file: 'Pliopad-Windows.zip', note: 'Windows 10 and 11, 64-bit. Unzip and run Pliopad.exe.' },
  { id: 'android', name: 'Android', file: 'Pliopad-Android.apk', note: 'Android 8 or newer. Allow installs from your browser when asked.' },
  { id: 'mac', name: 'macOS', file: 'Pliopad-Mac.dmg', note: 'macOS 14 or newer.' },
];
route('GET', '/api/downloads', async () => {
  let versions = {};
  try { versions = JSON.parse(fs.readFileSync(path.join(DOWNLOADS, 'versions.json'), 'utf8')); } catch { /* optional */ }
  return APPS.map((a) => {
    const file = path.join(DOWNLOADS, a.file);
    const stat = fs.existsSync(file) ? fs.statSync(file) : null;
    return { ...a, available: !!stat, url: stat ? `/downloads/${a.file}` : null, size: stat?.size || null, version: versions[a.id] || null, updated_at: stat ? stat.mtimeMs : null };
  });
});

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/app' || rel === '/admin') { res.writeHead(301, { Location: rel + '/' }); res.end(); return true; }
  if (rel.endsWith('/')) rel += 'index.html';
  const isDownload = rel.startsWith('/downloads/');
  const base = isDownload ? DOWNLOADS : PUBLIC;
  const file = path.normalize(path.join(base, isDownload ? rel.slice('/downloads'.length) : rel));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file);
  // Always revalidate, so a deploy is picked up immediately; unchanged files cost a 304.
  const mtime = fs.statSync(file).mtime;
  mtime.setMilliseconds(0);
  const since = Date.parse(req.headers['if-modified-since'] || '');
  if (since && since >= mtime.getTime()) { res.writeHead(304); res.end(); return true; }
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Last-Modified': mtime.toUTCString() };
  // App installers download as files (with a size, so browsers show progress).
  if (file.startsWith(DOWNLOADS + path.sep)) Object.assign(headers, { 'Content-Disposition': `attachment; filename="${path.basename(file)}"`, 'Content-Length': fs.statSync(file).size });
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
  return true;
}

async function serveFile(req, res, id, sig) {
  if (hmac(id).slice(0, 32) !== sig) { res.writeHead(403); return res.end(); }
  const f = await db.one('SELECT * FROM files WHERE id=?', [id]);
  const file = f && path.join(storageDir(), f.path);
  if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const inline = /^(image\/(png|jpe?g|gif|webp|heic)|application\/pdf|video\/|audio\/)/.test(f.mime);
  res.writeHead(200, {
    'Content-Type': f.mime, 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name)}"`,
  });
  fs.createReadStream(file).pipe(res);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function install(req, res) {
  const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
  try {
    if (String(form.admin_password || '').length < 10) throw new Error('Use at least 10 characters for the password.');
    const cfg = {
      app_key: randomHex(32),
      base_url: (form.base_url || '').replace(/\/$/, '') || undefined,
      db: form.driver === 'sqlite'
        ? { driver: 'sqlite', file: path.join(ROOT, 'data.sqlite') }
        : { driver: 'mysql', host: form.host || 'localhost', database: form.database, user: form.user, password: form.password },
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    reloadConfig();
    await db.init();
    await migrate();
    await loadSettings(db);
    if (!Number(await db.val('SELECT COUNT(*) FROM users'))) {
      const uid = await db.insert('users', { email: String(form.email).trim().toLowerCase(), name: String(form.name).trim(),
        pass_hash: await hashPassword(String(form.admin_password)), is_super: 1, color: '#6366f1', created_at: nowMs(), last_seen: nowMs() });
      await createWorkspace(await db.one('SELECT * FROM users WHERE id=?', [uid]), `${String(form.name).trim()}'s workspace`);
    }
    startJobs();
    res.writeHead(302, { Location: '/app/#/login' });
    res.end();
  } catch (e) {
    fs.rmSync(CONFIG_FILE, { force: true });
    reloadConfig();
    await db.close().catch(() => {});
    renderInstaller(res, `Setup failed: ${e.message}`);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (!isInstalled()) {
      if (p.startsWith('/api/')) return sendJson(res, { error: 'Pliopad is not installed yet. Open /install in your browser.' }, 503);
      if (p === '/install' && req.method === 'POST') return install(req, res);
      if (p.startsWith('/app') || p.startsWith('/admin') || p === '/' || p === '/install') return renderInstaller(res);
    }
    if (p === '/api/stripe/webhook' && req.method === 'POST') {
      await webhook(await readBody(req), req.headers['stripe-signature'] || '');
      return sendJson(res, { received: true });
    }
    if (p.startsWith('/api/')) return dispatch(req, res, url);
    let m;
    if ((m = /^\/f\/([0-9a-f-]{36})\/([0-9a-f]{32})$/.exec(p))) return serveFile(req, res, m[1], m[2]);
    if ((m = /^\/s\/([0-9a-f]{20})$/.exec(p))) return renderPublicPage(req, res, m[1]);
    if (p === '/' ) return renderLanding(res);
    if (req.method === 'GET' && serveStatic(req, res, p)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (e) {
    if (e instanceof ApiError) return sendJson(res, { error: e.message }, e.status);
    console.error('[pliopad]', e);
    if (!res.headersSent) sendJson(res, { error: 'Something went wrong on the server.' }, 500);
  }
});

async function main() {
  if (isInstalled()) {
    await db.init();
    await migrate();
    await loadSettings(db);
    startJobs();
  }
  const port = Number(process.env.PORT || config('port', 3000));
  server.listen(port, () => console.log(`Pliopad ${VERSION} listening on http://localhost:${port}${isInstalled() ? '' : ' (open /install to set up)'}`));
}

main().catch((e) => {
  console.error('[pliopad] failed to start:', e);
  process.exit(1);
});
