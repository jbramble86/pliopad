// Background jobs, run inside the server process every minute (no cron needed on SiteGround).
import { db } from './db.js';
import { hardDelete } from './notes.js';
import { limit } from './plans.js';
import { nowMs, sendMail, setSetting, setting, config } from './util.js';

const DAY = 86400000;
let running = false;
let lastDaily = 0;

async function remindersDue() {
  const due = await db.all(`SELECT n.id, n.title, n.workspace_id, n.created_by, n.reminder_at FROM notes n
    WHERE n.reminder_at IS NOT NULL AND n.reminder_at <= ? AND n.reminder_done=0 AND n.reminder_sent=0 AND n.deleted=0 AND n.trashed_at IS NULL LIMIT 200`, [nowMs()]);
  for (const n of due) {
    await db.update('notes', { reminder_sent: 1 }, { id: n.id });
    if (!n.created_by) continue;
    const title = n.title || 'Untitled';
    await db.insert('notifications', { user_id: n.created_by, workspace_id: n.workspace_id, kind: 'reminder', note_id: n.id, body: `Reminder: ${title}`, created_at: nowMs() });
    const u = await db.one('SELECT email FROM users WHERE id=?', [n.created_by]);
    const base = String(config('base_url') || '');
    if (u) await sendMail(u.email, `Reminder: ${title}`, `You asked to be reminded about “${title}”.${base ? `\n\n${base}/app/#/w/${n.workspace_id}/n/${n.id}` : ''}`);
  }
}

async function daily() {
  // Trash older than 30 days is deleted for good.
  for (const ws of await db.all('SELECT * FROM workspaces')) {
    for (const r of await db.all('SELECT id FROM notes WHERE workspace_id=? AND trashed_at IS NOT NULL AND trashed_at < ? AND deleted=0', [ws.id, nowMs() - 30 * DAY])) {
      await hardDelete(ws, r.id);
    }
    // Version history beyond the plan's retention.
    await db.q('DELETE FROM versions WHERE workspace_id=? AND created_at < ?', [ws.id, nowMs() - limit(ws, 'history_days') * DAY]);
  }
  await db.q('DELETE FROM presence WHERE at < ?', [nowMs() - DAY]);
  await db.q('DELETE FROM tokens WHERE expires_at IS NOT NULL AND expires_at < ?', [nowMs()]);
  await db.q('DELETE FROM audit WHERE created_at < ?', [nowMs() - Number(setting('audit_retention_days', 730)) * DAY]);
}

export function startJobs() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await remindersDue();
      if (nowMs() - lastDaily > DAY) {
        lastDaily = nowMs();
        await daily();
      }
      await setSetting(db, 'jobs_last', nowMs());
    } catch (e) {
      console.error('[pliopad] background job failed:', e.message);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 5000);
  return setInterval(tick, 60000).unref();
}
