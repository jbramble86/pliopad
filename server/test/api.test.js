// End-to-end API tests: starts a real server on a throwaway SQLite database. Run with `npm test` (Node 22.5+).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { merge, fromMarkdown, fromHtml, parseEnex } from '../src/blocks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pliopad-test-'));
const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
let proc;

async function api(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

before(async () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ app_key: 'test', debug: true, db: { driver: 'sqlite', file: path.join(dir, 'db.sqlite') }, storage: path.join(dir, 'files') }));
  proc = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), PLIOPAD_CONFIG: path.join(dir, 'config.json') }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => proc.stdout.on('data', (d) => String(d).includes('listening') && resolve()));
});

after(() => { proc?.kill(); });

test('block merge keeps edits from both sides', () => {
  const base = 1000;
  const server = [{ id: 'a', t: 'p', x: 'A', u: 500 }, { id: 'b', t: 'p', x: 'B server', u: 2000 }, { id: 's', t: 'p', x: 'new on server', u: 2100 }, { id: 'd', t: 'p', x: 'deleted by client', u: 400 }];
  const client = [{ id: 'a', t: 'p', x: 'A client', u: 1500 }, { id: 'b', t: 'p', x: 'B', u: 300 }, { id: 'c', t: 'p', x: 'new on client', u: 1600 }];
  const out = merge(server, client, base);
  assert.deepEqual(out.map((b) => b.x), ['A client', 'B server', 'new on server', 'new on client']);
});

test('markdown, html and enex import', () => {
  const md = fromMarkdown('# Title\n- [x] done\n- [ ] todo\n  - nested\n```js\nlet a\n```\n> quote');
  assert.deepEqual(md.map((b) => b.t), ['h1', 'todo', 'todo', 'ul', 'code', 'quote']);
  assert.equal(md[1].c, true);
  assert.equal(md[3].ind, 1);
  const html = fromHtml('<div><h2>Hi</h2><p>Some <b>bold</b> <a href="https://x.com">link</a></p><ul><li>one<ul><li>two</li></ul></li></ul><div><en-todo checked="true"/>Buy milk</div></div>');
  assert.deepEqual(html.map((b) => [b.t, b.x, b.ind || 0]), [['h2', 'Hi', 0], ['p', 'Some **bold** [link](https://x.com)', 0], ['ul', 'one', 0], ['ul', 'two', 1], ['todo', 'Buy milk', 0]]);
  const enex = parseEnex('<en-export><note><title>A &amp; B</title><created>20240131T120000Z</created><tag>x</tag><content><![CDATA[<en-note><div>Hello</div></en-note>]]></content></note></en-export>');
  assert.equal(enex[0].title, 'A & B');
  assert.deepEqual(enex[0].tags, ['x']);
  assert.equal(fromHtml(enex[0].html)[0].x, 'Hello');
});

let owner, ws, member;

test('sign up creates a workspace with starter content; first user is platform admin', async () => {
  const r = await api('POST', '/api/auth/signup', { name: 'Ada', email: 'ada@example.com', password: 'correct horse battery' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  owner = r.data.token;
  ws = r.data.workspaces[0].id;
  assert.equal(r.data.user.is_super, true);
  const b = await api('GET', `/api/w/${ws}/bootstrap`, null, owner);
  assert.equal(b.data.notebooks.length, 2);
  assert.ok(b.data.tree.some((n) => n.kind === 'db'));
  const weak = await api('POST', '/api/auth/signup', { email: 'x@example.com', password: 'short' });
  assert.equal(weak.status, 422);
});

test('login, wrong password and two-factor', async () => {
  assert.equal((await api('POST', '/api/auth/login', { email: 'ada@example.com', password: 'nope nope nope' })).status, 401);
  const ok = await api('POST', '/api/auth/login', { email: 'ada@example.com', password: 'correct horse battery' });
  assert.equal(ok.status, 200);
  const setup = await api('POST', '/api/me/mfa/setup', null, ok.data.token);
  assert.match(setup.data.uri, /^otpauth:\/\/totp\//);
  assert.equal((await api('POST', '/api/me/mfa/enable', { secret: setup.data.secret, code: '000000' }, ok.data.token)).status, 422);
});

test('notes: create, edit, concurrent edits merge, versions, backlinks, search', async () => {
  const id = crypto.randomUUID();
  const b1 = { id: crypto.randomUUID(), t: 'p', x: 'Quarterly planning with **budget**', u: Date.now() };
  let r = await api('PUT', `/api/w/${ws}/notes/${id}`, { title: 'Planning', content: [b1] }, owner);
  assert.equal(r.status, 200);
  assert.equal(r.data.version, 1);
  const v1 = r.data;
  // Two devices edit from version 1.
  const b2 = { id: crypto.randomUUID(), t: 'todo', x: 'Book venue', u: Date.now() + 1 };
  r = await api('PUT', `/api/w/${ws}/notes/${id}`, { content: [b1, b2], base_version: 1, base_updated: v1.updated_at }, owner);
  const b3 = { id: crypto.randomUUID(), t: 'p', x: 'Offline phone edit', u: Date.now() + 2 };
  r = await api('PUT', `/api/w/${ws}/notes/${id}`, { content: [b1, b3], base_version: 1, base_updated: v1.updated_at }, owner);
  assert.equal(r.data.merged, true);
  assert.deepEqual(r.data.content.map((b) => b.x).sort(), ['Book venue', 'Offline phone edit', 'Quarterly planning with **budget**'].sort());

  const other = crypto.randomUUID();
  await api('PUT', `/api/w/${ws}/notes/${other}`, { title: 'Links here', content: [{ id: 'l1', t: 'p', x: `See [Planning](note:${id})` }] }, owner);
  r = await api('GET', `/api/w/${ws}/notes/${id}`, null, owner);
  assert.equal(r.data.backlinks[0].id, other);

  r = await api('GET', `/api/w/${ws}/search?q=${encodeURIComponent('budget is:todo')}`, null, owner);
  assert.equal(r.data[0].id, id);
  r = await api('GET', `/api/w/${ws}/search?q=${encodeURIComponent('intitle:planning -venue')}`, null, owner);
  assert.equal(r.data.length, 0);
  r = await api('GET', `/api/w/${ws}/tasks`, null, owner);
  assert.ok(r.data.some((t) => t.text === 'Book venue'));
  r = await api('GET', `/api/w/${ws}/graph`, null, owner);
  assert.ok(r.data.edges.some(([a, b]) => a === other && b === id));
});

test('sync: pull by sequence, push offline changes, tombstones', async () => {
  let r = await api('GET', `/api/w/${ws}/sync?since=0`, null, owner);
  const seq = r.data.seq;
  assert.ok(r.data.notes.length >= 5);
  const nb = crypto.randomUUID();
  const n = crypto.randomUUID();
  r = await api('POST', `/api/w/${ws}/sync`, { notebooks: [{ id: nb, name: 'Phone' }], notes: [{ id: n, title: 'From phone', notebook_id: nb, content: [{ id: 'x', t: 'p', x: 'hi' }] }] }, owner);
  assert.deepEqual(r.data.errors, []);
  r = await api('GET', `/api/w/${ws}/sync?since=${seq}`, null, owner);
  assert.ok(r.data.notes.some((x) => x.id === n));
  assert.ok(r.data.notebooks.some((x) => x.id === nb));
  await api('POST', `/api/w/${ws}/sync`, { notes: [{ id: n, deleted: true }] }, owner);
  r = await api('GET', `/api/w/${ws}/sync?since=${r.data.seq}`, null, owner);
  assert.equal(r.data.notes.find((x) => x.id === n).deleted, true);
});

test('roles: invited guest can read but not write; outsiders get nothing', async () => {
  let r = await api('POST', `/api/w/${ws}/invites`, { email: 'gus@example.com', role: 'member' }, owner);
  const token = r.data.invited[0].link.split('/').pop();
  r = await api('POST', '/api/auth/signup', { name: 'Gus', email: 'gus@example.com', password: 'another long password', invite: token });
  member = r.data.token;
  assert.equal(r.data.workspaces[0].id, ws);
  const members = await api('GET', `/api/w/${ws}/members`, null, owner);
  const gus = members.data.members.find((m) => m.email === 'gus@example.com');
  await api('PATCH', `/api/w/${ws}/members/${gus.id}`, { role: 'guest' }, owner);
  assert.equal((await api('PUT', `/api/w/${ws}/notes/${crypto.randomUUID()}`, { title: 'x' }, member)).status, 403);
  assert.equal((await api('GET', `/api/w/${ws}/notes`, null, member)).status, 200);
  assert.equal((await api('GET', '/api/admin/stats', null, member)).status, 403);
  const outsider = await api('POST', '/api/auth/signup', { email: 'eve@example.com', password: 'yet another password' });
  assert.equal((await api('GET', `/api/w/${ws}/notes`, null, outsider.data.token)).status, 403);
  assert.equal((await api('GET', `/api/w/${ws}/notes`)).status, 401);
});

test('publishing a page and serving it publicly', async () => {
  const id = crypto.randomUUID();
  await api('PUT', `/api/w/${ws}/notes/${id}`, { title: 'Public <doc>', content: [{ id: 'p', t: 'p', x: 'Hello **world** <script>x</script>' }] }, owner);
  const r = await api('POST', `/api/w/${ws}/notes/${id}/share`, { enabled: true }, owner);
  const html = await (await fetch(r.data.share_url.replace(/^https?:\/\/[^/]+/, BASE))).text();
  assert.match(html, /<strong>world<\/strong>/);
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /Public &lt;doc&gt;/);
});

test('import Evernote and Markdown', async () => {
  const enex = '<?xml version="1.0"?><en-export><note><title>Recipe</title><tag>food</tag><content><![CDATA[<en-note><h1>Pancakes</h1><ul><li>Flour</li></ul></en-note>]]></content></note><note><title>Second</title><content><![CDATA[<en-note>Text</en-note>]]></content></note></en-export>';
  let r = await api('POST', `/api/w/${ws}/import`, { format: 'enex', content: enex }, owner);
  assert.equal(r.data.created, 2);
  r = await api('POST', `/api/w/${ws}/import`, { format: 'markdown', filename: 'Roadmap 0123456789abcdef0123456789abcdef.md', content: '- [ ] ship' }, owner);
  assert.equal(r.data.created, 1);
  r = await api('GET', `/api/w/${ws}/search?q=tag:food`, null, owner);
  assert.equal(r.data[0].title, 'Recipe');
});

test('file upload and signed download', async () => {
  const fd = new FormData();
  fd.append('file', new Blob(['hello file'], { type: 'text/plain' }), 'hello.txt');
  fd.append('ocr', 'invoice number 4471');
  const res = await fetch(`${BASE}/api/w/${ws}/files`, { method: 'POST', headers: { Authorization: `Bearer ${owner}` }, body: fd });
  const f = await res.json();
  assert.equal(res.status, 200, JSON.stringify(f));
  const dl = await fetch(f.url.replace(/^https?:\/\/[^/]+/, BASE));
  assert.equal(await dl.text(), 'hello file');
  assert.equal((await fetch(f.url.replace(/^https?:\/\/[^/]+/, BASE).replace(/.$/, '0'))).status, 403);
});

test('platform admin: stats, tenants, suspend, audit, settings masking, impersonation', async () => {
  let r = await api('GET', '/api/admin/stats', null, owner);
  assert.equal(r.status, 200);
  assert.ok(r.data.users >= 3);
  r = await api('GET', '/api/admin/workspaces?q=Ada', null, owner);
  assert.equal(r.data.rows[0].id, ws);
  await api('PUT', '/api/admin/settings', { anthropic_api_key: 'sk-ant-secret-1234', app_name: 'Pliopad Test' }, owner);
  r = await api('GET', '/api/admin/settings', null, owner);
  assert.equal(r.data.anthropic_api_key, '••••1234');
  assert.equal(r.data.app_name, 'Pliopad Test');
  const users = await api('GET', '/api/admin/users?q=eve', null, owner);
  const imp = await api('POST', `/api/admin/users/${users.data.rows[0].id}/impersonate`, { reason: 'support ticket 12' }, owner);
  const me = await api('GET', '/api/me', null, imp.data.token);
  assert.equal(me.data.user.email, 'eve@example.com');
  r = await api('GET', '/api/admin/audit?action=impersonated', null, owner);
  assert.equal(r.data[0].meta.reason, 'support ticket 12');
  await api('PATCH', `/api/admin/workspaces/${ws}`, { status: 'suspended' }, owner);
  assert.equal((await api('GET', `/api/w/${ws}/notes`, null, member)).status, 423);
  await api('PATCH', `/api/admin/workspaces/${ws}`, { status: 'active' }, owner);
  const csv = await fetch(`${BASE}/api/admin/audit?format=csv`, { headers: { Authorization: `Bearer ${owner}` } });
  assert.match(await csv.text(), /^time,workspace,user,action/);
});
