// Maintenance: a switch that takes PlioPad offline for everyone but platform admins (the apps keep working
// offline and sync afterwards), plus one-click upkeep tasks for the admin console.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db } from './db.js';
import * as A from './auth.js';
import { hardDelete, fileOrphanPages } from './notes.js';
import * as Blocks from './blocks.js';
import { limit } from './plans.js';
import { storageDir } from './routes/workspace.js';
import { nowMs, setting, setSetting, dataPath, jdec, escapeHtml as e } from './util.js';

const DAY = 86400000;

// ---------- Maintenance mode ----------

/** { on, message, until, started_at, by } or null. */
export const mode = () => (setting('maintenance', null)?.on ? setting('maintenance') : null);

export async function setMode(on, { message = '', until = null } = {}, user = null) {
  await setSetting(db, 'maintenance', on ? { on: true, message: String(message || '').slice(0, 500), until: Number(until) || null, started_at: nowMs(), by: user?.name || null } : null);
}

/** Public status for the apps and the site (never who turned it on). */
export const status = () => { const m = mode(); return m ? { on: true, message: m.message, until: m.until } : { on: false }; };

// Always reachable during maintenance: health, status, sign-in, the admin console, and the app shell (it shows the notice itself).
const OPEN = [/^\/api\/health$/, /^\/api\/site-info$/, /^\/api\/config$/, /^\/api\/auth\/login$/, /^\/api\/me$/, /^\/api\/downloads$/,
  /^\/api\/admin\//, /^\/admin(\/|$)/, /^\/app(\/|$)/, /^\/brand\//, /^\/downloads\//, /^\/$/, /^\/favicon/];

/**
 * During maintenance: returns true when the request was answered with the maintenance notice.
 * Platform admins (by their sign-in token) pass through, so they can work and test.
 */
export async function gate(req, res, p) {
  const m = mode();
  if (!m || OPEN.some((re) => re.test(p))) return false;
  const user = await A.loadUser({ req }).catch(() => null);
  if (user && Number(user.is_super)) return false;
  res.setHeader('Retry-After', '60');
  if (p.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: m.message || 'PlioPad is down for maintenance. Please try again soon.', code: 'maintenance', until: m.until }));
  } else {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page(m));
  }
  return true;
}

/** The branded "down for maintenance" page (also used for published pages and file links). */
export function page(m) {
  const until = m.until ? `<p class="until">Expected back <b id="until" data-t="${Number(m.until)}"></b></p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>PlioPad · Maintenance</title><link rel="icon" href="/brand/PlioPad-mark.svg">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 500px at 70% 10%,#22348f,transparent 60%),#101D59;color:#fff;font:17px/1.6 Inter,system-ui,sans-serif}
main{max-width:520px;padding:32px 24px;text-align:center}img{width:64px;height:64px;margin:0 auto 18px;display:block}h1{margin:0 0 10px;font-size:30px;letter-spacing:-.02em}
p{color:#C9CFEA;margin:8px 0}.until b{color:#83EBC0}.msg{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 18px;color:#fff;margin-top:18px}</style></head>
<body><main><img src="/brand/PlioPad-desktop.svg" alt=""><h1>We'll be right back</h1>
<p>PlioPad is down for scheduled maintenance. Your notes are safe, and the Windows and Android apps keep working offline and sync when we're back.</p>
${m.message ? `<div class="msg">${e(m.message)}</div>` : ''}${until}</main>
<script>const u=document.getElementById('until');if(u){const t=new Date(+u.dataset.t);u.textContent=t.toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'});}</script></body></html>`;
}

// ---------- Upkeep tasks ----------

const backupsDir = () => dataPath('backups');

/** Every table, as gzipped JSON, into pliopad-data/backups (the 10 newest are kept). */
async function backup() {
  const tables = (db.driver === 'mysql' ? await db.all('SHOW TABLES') : await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
    .map((r) => Object.values(r)[0]);
  const dump = { app: 'PlioPad', created_at: nowMs(), driver: db.driver, tables: {} };
  let rows = 0;
  for (const t of tables) { dump.tables[t] = await db.all(`SELECT * FROM ${t}`); rows += dump.tables[t].length; }
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const name = `pliopad-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json.gz`;
  fs.writeFileSync(path.join(dir, name), zlib.gzipSync(JSON.stringify(dump)));
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.json.gz')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 10))) fs.rmSync(path.join(dir, old), { force: true });
  const kb = Math.round(fs.statSync(path.join(dir, name)).size / 1024);
  return `Saved ${name} (${rows.toLocaleString('en-US')} rows, ${kb.toLocaleString('en-US')} KB) in ${dir}.`;
}

export const TASKS = [
  { id: 'backup', title: 'Back up the database', detail: 'Saves every table to pliopad-data/backups as a compressed file. The 10 newest backups are kept.', run: backup },
  {
    id: 'trash', title: 'Empty old trash', detail: 'Deletes notes that have been in the trash for more than 30 days, on every device.',
    async run() {
      let n = 0;
      for (const ws of await db.all('SELECT * FROM workspaces')) {
        for (const r of await db.all('SELECT id FROM notes WHERE workspace_id=? AND trashed_at IS NOT NULL AND trashed_at < ? AND deleted=0', [ws.id, nowMs() - 30 * DAY])) { await hardDelete(ws, r.id); n++; }
      }
      return `Deleted ${n} note${n === 1 ? '' : 's'} from the trash.`;
    },
  },
  {
    id: 'versions', title: 'Trim version history', detail: "Removes page history older than each workspace's plan allows.",
    async run() {
      let n = 0;
      for (const ws of await db.all('SELECT * FROM workspaces')) {
        const cut = nowMs() - limit(ws, 'history_days') * DAY;
        n += Number(await db.val('SELECT COUNT(*) FROM versions WHERE workspace_id=? AND created_at < ?', [ws.id, cut]));
        await db.q('DELETE FROM versions WHERE workspace_id=? AND created_at < ?', [ws.id, cut]);
      }
      return `Removed ${n} old version${n === 1 ? '' : 's'}.`;
    },
  },
  {
    id: 'files', title: 'Clean up files and recount storage', detail: 'Deletes uploaded files that nothing uses any more, and recounts how much storage each workspace uses.',
    async run() {
      const dir = storageDir();
      const rows = await db.all('SELECT id, path, size, note_id, workspace_id FROM files');
      const known = new Set(rows.map((r) => path.normalize(r.path)));
      let removedFiles = 0, freed = 0, missing = 0;
      // Files on disk that the database doesn't know about.
      const walk = (d) => { for (const f of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
        const full = path.join(d, f.name);
        if (f.isDirectory()) walk(full);
        else if (!known.has(path.normalize(path.relative(dir, full)))) { freed += fs.statSync(full).size; fs.rmSync(full, { force: true }); removedFiles++; }
      } };
      walk(dir);
      // Database rows whose file is gone.
      for (const r of rows) if (!fs.existsSync(path.join(dir, r.path))) { await db.q('DELETE FROM files WHERE id=?', [r.id]); missing++; }
      for (const ws of await db.all('SELECT id FROM workspaces')) {
        const used = Number(await db.val('SELECT COALESCE(SUM(size), 0) FROM files WHERE workspace_id=?', [ws.id]));
        await db.update('workspaces', { storage_bytes: used }, { id: ws.id });
      }
      return `Removed ${removedFiles} unused file${removedFiles === 1 ? '' : 's'} (${Math.round(freed / 1048576 * 10) / 10} MB), cleared ${missing} missing file record${missing === 1 ? '' : 's'}, and recounted storage.`;
    },
  },
  {
    id: 'sessions', title: 'Clear expired sign-ins', detail: 'Removes expired sign-in tokens, old login-attempt records, stale presence and read notifications older than 90 days.',
    async run() {
      const count = async (sql, args) => Number(await db.val(sql, args));
      const t = await count('SELECT COUNT(*) FROM tokens WHERE expires_at IS NOT NULL AND expires_at < ?', [nowMs()]);
      await db.q('DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < ?', [nowMs()]);
      await db.q('DELETE FROM throttle WHERE at < ?', [Math.floor((nowMs() - DAY) / 1000)]).catch(() => db.q('DELETE FROM throttle WHERE at < ?', [nowMs() - DAY]));
      await db.q('DELETE FROM presence WHERE at < ?', [nowMs() - DAY]);
      await db.q('DELETE FROM notifications WHERE created_at < ? AND read_at IS NOT NULL', [nowMs() - 90 * DAY]).catch(() => {});
      return `Removed ${t} expired sign-in${t === 1 ? '' : 's'} and cleared old activity records.`;
    },
  },
  {
    id: 'search', title: 'Rebuild search text', detail: 'Recomputes the searchable text of every note from its content (fixes search results that look out of date).',
    async run() {
      let n = 0;
      for (const r of await db.all('SELECT id, content, plain FROM notes WHERE deleted=0')) {
        const plain = Blocks.plain(jdec(r.content, []));
        if (plain !== r.plain) { await db.update('notes', { plain }, { id: r.id }); n++; }
      }
      return `Updated the search text of ${n} note${n === 1 ? '' : 's'}.`;
    },
  },
  { id: 'orphans', title: 'File pages into notebooks', detail: 'Puts any page without a notebook into its parent’s notebook or the Inbox.', async run() { const n = await fileOrphanPages(); return `Filed ${n} page${n === 1 ? '' : 's'}.`; } },
  {
    id: 'optimize', title: 'Optimize the database', detail: 'Reclaims space and refreshes the statistics the database uses to stay fast.',
    async run() {
      if (db.driver === 'mysql') {
        const tables = (await db.all('SHOW TABLES')).map((r) => Object.values(r)[0]);
        for (const t of tables) await db.all(`OPTIMIZE TABLE ${t}`);
        return `Optimized ${tables.length} tables.`;
      }
      await db.q('VACUUM');
      await db.q('ANALYZE');
      return 'Compacted and analyzed the database.';
    },
  },
];

/** Runs one task, records its result for the admin console, and returns it. */
export async function runTask(id) {
  const task = TASKS.find((t) => t.id === id);
  if (!task) throw new Error('Unknown task');
  const started = nowMs();
  let result;
  try { result = { ok: true, message: await task.run() }; } catch (err) { result = { ok: false, message: err.message }; }
  const last = { ...(setting('maintenance_runs', {}) || {}), [id]: { ...result, at: started, ms: nowMs() - started } };
  await setSetting(db, 'maintenance_runs', last);
  return last[id];
}

export function overview() {
  const runs = setting('maintenance_runs', {}) || {};
  let backups = [];
  try { backups = fs.readdirSync(backupsDir()).filter((f) => f.endsWith('.json.gz')).sort().reverse().map((f) => ({ name: f, size: fs.statSync(path.join(backupsDir(), f)).size })); } catch { /* none yet */ }
  return { mode: mode(), tasks: TASKS.map(({ id, title, detail }) => ({ id, title, detail, last: runs[id] || null })), backups };
}
