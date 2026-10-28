// PlioPad launcher: starts the server and makes startup failures visible instead of a bare "502 Bad Gateway".
// If src/server.js fails to load, this keeps answering on PORT with the error, and writes it to
// pliopad-data/logs/startup.log (found the same way the server finds its data folder).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function logDir() {
  const candidates = [];
  for (let dir = path.dirname(ROOT); ; dir = path.dirname(dir)) {
    candidates.push(path.join(dir, 'pliopad-data'));
    if (dir === path.dirname(dir)) break;
  }
  candidates.push(path.join(os.homedir(), 'pliopad-data'));
  const data = candidates.find((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  return path.join(data || ROOT, 'logs');
}

function record(kind, err) {
  const line = `${new Date().toISOString()} ${kind}: ${err?.stack || err}\n`;
  console.error(line);
  try { fs.mkdirSync(logDir(), { recursive: true }); fs.appendFileSync(path.join(logDir(), 'startup.log'), line); } catch { /* best effort */ }
}

// Crashes after startup are logged too (the host restarts the app).
process.on('uncaughtException', (e) => { record('Crash', e); process.exit(1); });
process.on('unhandledRejection', (e) => record('Unhandled rejection', e));

try {
  await import('./src/server.js');
} catch (e) {
  record('Startup failed', e);
  const port = Number(process.env.PORT || 3000);
  const message = String(e?.message || e).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
  http.createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><title>PlioPad is unavailable</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:0 16px;color:#101D59">
<h1>PlioPad failed to start</h1><p>The error was:</p><pre style="white-space:pre-wrap;background:#FAF9F5;padding:12px;border-radius:8px">${message}</pre>
<p style="color:#5D6485">Full details are in <code>pliopad-data/logs/startup.log</code>.</p></body>`);
  }).listen(port, () => console.error(`PlioPad failed to start; serving the error on port ${port}`));
}
