// Server-rendered pages: published notes (/s/:slug) and the first-run installer. The website is in landing.js.
import { db } from './db.js';
import * as Blocks from './blocks.js';
import { fileUrl } from './routes/content.js';
import { escapeHtml as e, jdec, setting, baseUrl } from './util.js';

const BASE_CSS = `
:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#e5e7eb;--accent:#4f46e5;--soft:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--accent:#818cf8;--soft:#161b22}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}code{background:var(--soft);padding:.1em .35em;border-radius:4px;font-size:.9em}
pre{background:var(--soft);padding:14px 16px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{border-left:3px solid var(--line);margin:0;padding-left:14px;color:var(--muted)}
.callout{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:8px 0}
img{max-width:100%;border-radius:8px}figure{margin:16px 0}figcaption{color:var(--muted);font-size:13px}hr{border:0;border-top:1px solid var(--line);margin:24px 0}`;

export async function renderPublicPage(req, res, slug) {
  const note = await db.one('SELECT * FROM notes WHERE share_slug=? AND deleted=0 AND trashed_at IS NULL', [slug]);
  const ws = note ? await db.one('SELECT * FROM workspaces WHERE id=?', [note.workspace_id]) : null;
  if (!note || !ws || ws.status !== 'active' || jdec(ws.settings, {}).allow_public_pages === false) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Not found</title><style>${BASE_CSS}</style><main style="max-width:560px;margin:15vh auto;padding:0 16px"><h1>This page isn't published</h1><p>The link may be wrong, or the owner stopped sharing it.</p></main>`);
  }
  const base = baseUrl(req);
  // Links to other published pages work; links to private pages are disabled.
  const shared = new Map((await db.all('SELECT id, share_slug FROM notes WHERE workspace_id=? AND share_slug IS NOT NULL', [ws.id])).map((r) => [r.id, r.share_slug]));
  const noteUrl = (id) => (shared.has(id) ? `${base}/s/${shared.get(id)}` : '#');
  const body = Blocks.toHtml(jdec(note.content, []), noteUrl, (id) => fileUrl(base, id));
  const children = await db.all('SELECT title, icon, share_slug FROM notes WHERE parent_id=? AND share_slug IS NOT NULL AND deleted=0 AND trashed_at IS NULL ORDER BY sort', [note.id]);
  const desc = e(String(note.plain || '').slice(0, 160).replace(/\s+/g, ' '));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(note.title || 'Untitled')}</title><meta name="description" content="${desc}">
<meta property="og:title" content="${e(note.title || 'Untitled')}"><meta property="og:description" content="${desc}">
<style>${BASE_CSS}
main{max-width:760px;margin:0 auto;padding:56px 16px 96px}.icon{font-size:56px;line-height:1}h1.title{font-size:40px;line-height:1.2;margin:12px 0 24px}
.todo{display:flex;gap:8px;align-items:flex-start;margin:4px 0}.li{margin:4px 0}.kids a{display:block;padding:6px 0}
footer{color:var(--muted);font-size:13px;border-top:1px solid var(--line);margin-top:48px;padding-top:16px}</style></head>
<body><main>${note.icon ? `<div class="icon">${e(note.icon)}</div>` : ''}<h1 class="title">${e(note.title || 'Untitled')}</h1>
${body}${children.length ? `<div class="kids"><hr>${children.map((c) => `<a href="${base}/s/${c.share_slug}">${e(c.icon || '📄')} ${e(c.title || 'Untitled')}</a>`).join('')}</div>` : ''}
<footer>Published with ${e(setting('app_name', 'PlioPad'))} · ${e(ws.name)}</footer></main></body></html>`);
}

export function renderInstaller(res, error = '') {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Install Pliopad</title>
<style>${BASE_CSS}main{max-width:520px;margin:6vh auto;padding:0 16px 64px}label{display:block;font-size:13px;font-weight:600;margin:14px 0 4px}
input,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
fieldset{border:1px solid var(--line);border-radius:12px;padding:8px 16px 18px;margin:18px 0}legend{font-weight:600;padding:0 6px}
button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;font-size:15px;cursor:pointer}
.err{background:#fee2e2;color:#991b1b;padding:10px 14px;border-radius:8px}.hint{color:var(--muted);font-size:13px}</style></head>
<body><main><h1>Set up Pliopad</h1><p class="hint">This runs once. It creates the database tables and your platform administrator account.</p>
${error ? `<p class="err">${e(error)}</p>` : ''}
<form method="post" action="/install">
<fieldset><legend>Database</legend>
<label>Type</label><select name="driver"><option value="mysql">MySQL / MariaDB (SiteGround)</option><option value="sqlite">SQLite (local testing only)</option></select>
<label>Host</label><input name="host" value="localhost"><label>Database name</label><input name="database">
<label>Database user</label><input name="user"><label>Database password</label><input name="password" type="password">
<p class="hint">On SiteGround: Site Tools → MySQL → Databases. Create a database and a user, and give the user all privileges.</p></fieldset>
<fieldset><legend>Your administrator account</legend>
<label>Name</label><input name="name" required><label>Email</label><input name="email" type="email" required>
<label>Password (10+ characters)</label><input name="admin_password" type="password" minlength="10" required>
<label>Site address</label><input name="base_url" placeholder="https://notes.example.com"></fieldset>
<button>Install</button></form></main></body></html>`);
}
