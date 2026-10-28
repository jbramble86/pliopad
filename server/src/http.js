// Minimal router and request helpers on top of node:http. Routes look like "GET /api/w/:ws/notes/:id".
import { ApiError, config } from './util.js';

const routes = [];

export function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, regex, keys, handler });
}

export function sendJson(res, data, status = 200) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const MAX_JSON = 25 * 1024 * 1024;

async function readJson(req) {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) return {};
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_JSON) throw new ApiError(413, 'Request too large.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new ApiError(400, 'Invalid JSON.'); }
}

/** Builds the per-request context handed to every route handler. */
function context(req, res, url, params, body) {
  return {
    req, res, url, params, body,
    query: Object.fromEntries(url.searchParams),
    ip: (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '').trim().slice(0, 45),
    in(key, def = null) { return body[key] ?? url.searchParams.get(key) ?? def; },
    has(key) { return Object.prototype.hasOwnProperty.call(body, key); },
    req_(key) {
      const v = this.in(key);
      if (v === null || v === '') throw new ApiError(422, `Missing field: ${key}`);
      return v;
    },
    user: null, token: null,
  };
}

export async function dispatch(req, res, url) {
  try {
    let allowed = false;
    for (const r of routes) {
      const m = url.pathname.match(r.regex);
      if (!m) continue;
      allowed = true;
      if (r.method !== req.method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const isMultipart = (req.headers['content-type'] || '').startsWith('multipart/form-data');
      const body = isMultipart || r.method === 'GET' ? {} : await readJson(req);
      const ctx = context(req, res, url, params, body);
      const out = await r.handler(ctx);
      if (out !== undefined && !res.headersSent) sendJson(res, out);
      return;
    }
    throw new ApiError(allowed ? 405 : 404, allowed ? 'Method not allowed' : 'Not found');
  } catch (e) {
    if (e instanceof ApiError) return sendJson(res, { error: e.message, code: e.code }, e.status);
    console.error('[pliopad]', e);
    sendJson(res, { error: config('debug') ? String(e.message) : 'Something went wrong on the server.' }, 500);
  }
}
