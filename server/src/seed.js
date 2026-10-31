// New workspaces start with useful content, so nobody lands on an empty screen.
import { db } from './db.js';
import * as Blocks from './blocks.js';
import { saveNote, nextSeq } from './notes.js';
import { setting, slugify, randomHex, nowMs, month, uuid, ymd } from './util.js';

export async function createWorkspace(user, name) {
  let slug = slugify(name);
  while (await db.val('SELECT 1 FROM workspaces WHERE slug=?', [slug])) slug = `${slugify(name).slice(0, 32)}-${randomHex(3)}`;
  const id = await db.insert('workspaces', { name: String(name).slice(0, 190), slug, plan: setting('default_plan', 'free'), status: 'active',
    created_at: nowMs(), ai_period: month() });
  await db.insert('members', { workspace_id: id, user_id: user.id, role: 'owner', joined_at: nowMs() });
  const ws = await db.one('SELECT * FROM workspaces WHERE id=?', [id]);
  await starterContent(ws, user);
  return db.one('SELECT * FROM workspaces WHERE id=?', [id]);
}

const WELCOME = `## Everything you know, connected
PlioPad keeps **quick notes**, **pages** and **databases** together, and maps how they link in **PlioSphere**.
### Try these
- [ ] Type \`/\` on an empty line to insert any block
- [ ] Type \`[[\` to link to another page; backlinks appear automatically
- [ ] Press \`Ctrl+K\` to search or jump anywhere
- [ ] Search like a pro: \`tag:getting-started is:todo updated:7d\`
- [ ] Open the Android app and scan a document; its text becomes searchable
- [ ] Click ✨ in the toolbar to summarize a note or pull out action items
> Tip: everything syncs between the web, Windows and Android apps, including edits made offline.`;

async function starterContent(ws, user) {
  const inbox = uuid();
  const work = uuid();
  for (const [id, name, stack, icon, sort] of [[inbox, 'Inbox', null, '📥', 0], [work, 'Projects', 'Work', '🚀', 1]]) {
    await db.insert('notebooks', { id, workspace_id: ws.id, name, stack, icon, sort, seq: await nextSeq(ws.id), updated_at: nowMs(), created_by: user.id });
  }
  const tag = uuid();
  await db.insert('tags', { id: tag, workspace_id: ws.id, name: 'getting-started', color: '#6366f1', seq: await nextSeq(ws.id), updated_at: nowMs() });

  await saveNote(ws, user, uuid(), { title: 'Welcome to PlioPad', icon: '👋', notebook_id: inbox, pinned: true, tags: [tag], content: Blocks.fromMarkdown(WELCOME) });

  const dbId = uuid();
  const options = [{ id: 'todo', name: 'To do', color: 'gray' }, { id: 'doing', name: 'In progress', color: 'blue' }, { id: 'done', name: 'Done', color: 'green' }];
  await saveNote(ws, user, dbId, {
    title: 'Product roadmap', icon: '🗺️', kind: 'db', notebook_id: work,
    content: [Blocks.block('p', 'A database: every row is a page. Switch between Board, Table and Calendar views above.')],
    db_schema: {
      props: [
        { id: 'status', name: 'Status', type: 'status', options },
        { id: 'owner', name: 'Owner', type: 'person' },
        { id: 'due', name: 'Due', type: 'date' },
        { id: 'pts', name: 'Estimate', type: 'number' },
      ],
      views: [
        { id: 'v1', name: 'Board', type: 'board', group: 'status' },
        { id: 'v2', name: 'Table', type: 'table' },
        { id: 'v3', name: 'Calendar', type: 'calendar', date: 'due' },
      ],
    },
  });
  const rows = [['Launch beta', 'doing', 5, 7], ['Android offline sync', 'done', 8, -3], ['Customer interviews', 'todo', 3, 14]];
  for (const [i, [title, status, pts, days]] of rows.entries()) {
    await saveNote(ws, user, uuid(), { title, parent_id: dbId, sort: i,
      props: { status, owner: Number(user.id), due: ymd(new Date(Date.now() + days * 86400000)), pts } });
  }
  await saveNote(ws, user, uuid(), { title: 'Meeting notes', icon: '🗒️', is_template: true, notebook_id: work,
    content: Blocks.fromMarkdown('## Attendees\n- Name\n## Agenda\n1. Topic\n## Notes\nWhat was discussed\n## Action items\n- [ ] Task @' + ymd()) });
}
