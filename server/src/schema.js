// Database schema, written once in a portable dialect and adapted to MySQL or SQLite. Safe to run on every start.
import { db } from './db.js';
import { setSetting } from './util.js';

export const SCHEMA_VERSION = 1;

const TABLES = {
  settings: 'k VARCHAR(100) PRIMARY KEY, v {TEXT}',
  users: `{ID}, email VARCHAR(190) NOT NULL UNIQUE, name VARCHAR(190) NOT NULL, pass_hash VARCHAR(255) NOT NULL,
    is_super INT NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'active', totp_secret VARCHAR(64) NULL,
    color VARCHAR(16) NULL, prefs {TEXT} NULL, created_at BIGINT NOT NULL, last_seen BIGINT NULL`,
  workspaces: `{ID}, name VARCHAR(190) NOT NULL, slug VARCHAR(60) NOT NULL UNIQUE, plan VARCHAR(30) NOT NULL DEFAULT 'free',
    status VARCHAR(20) NOT NULL DEFAULT 'active', seq BIGINT NOT NULL DEFAULT 0, storage_bytes BIGINT NOT NULL DEFAULT 0,
    ai_used INT NOT NULL DEFAULT 0, ai_period VARCHAR(7) NULL, stripe_customer VARCHAR(80) NULL, stripe_sub VARCHAR(80) NULL,
    plan_renews BIGINT NULL, seats INT NOT NULL DEFAULT 1, settings {TEXT} NULL, created_at BIGINT NOT NULL`,
  members: `workspace_id BIGINT NOT NULL, user_id BIGINT NOT NULL, role VARCHAR(20) NOT NULL, joined_at BIGINT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)`,
  tokens: `{ID}, user_id BIGINT NOT NULL, hash CHAR(64) NOT NULL UNIQUE, label VARCHAR(120) NULL, kind VARCHAR(20) NOT NULL DEFAULT 'session',
    created_at BIGINT NOT NULL, last_used BIGINT NULL, expires_at BIGINT NULL, impersonator_id BIGINT NULL`,
  invites: `{ID}, workspace_id BIGINT NOT NULL, email VARCHAR(190) NOT NULL, role VARCHAR(20) NOT NULL, token CHAR(48) NOT NULL UNIQUE,
    created_by BIGINT NOT NULL, created_at BIGINT NOT NULL, accepted_at BIGINT NULL`,
  notebooks: `id VARCHAR(36) PRIMARY KEY, workspace_id BIGINT NOT NULL, name VARCHAR(190) NOT NULL, stack VARCHAR(190) NULL,
    icon VARCHAR(32) NULL, color VARCHAR(16) NULL, sort DOUBLE NOT NULL DEFAULT 0, seq BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL, deleted INT NOT NULL DEFAULT 0, created_by BIGINT NULL`,
  notes: `id VARCHAR(36) PRIMARY KEY, workspace_id BIGINT NOT NULL, notebook_id VARCHAR(36) NULL, parent_id VARCHAR(36) NULL,
    kind VARCHAR(10) NOT NULL DEFAULT 'note', title VARCHAR(500) NOT NULL DEFAULT '', icon VARCHAR(32) NULL, cover VARCHAR(255) NULL,
    content {LONGTEXT} NULL, plain {LONGTEXT} NULL, props {TEXT} NULL, db_schema {TEXT} NULL, tags {TEXT} NULL,
    pinned INT NOT NULL DEFAULT 0, sort DOUBLE NOT NULL DEFAULT 0, version INT NOT NULL DEFAULT 1, seq BIGINT NOT NULL DEFAULT 0,
    created_by BIGINT NULL, updated_by BIGINT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    trashed_at BIGINT NULL, deleted INT NOT NULL DEFAULT 0, share_slug VARCHAR(40) NULL UNIQUE,
    reminder_at BIGINT NULL, reminder_done INT NOT NULL DEFAULT 0, reminder_sent INT NOT NULL DEFAULT 0,
    is_template INT NOT NULL DEFAULT 0, locked INT NOT NULL DEFAULT 0`,
  tags: `id VARCHAR(36) PRIMARY KEY, workspace_id BIGINT NOT NULL, name VARCHAR(120) NOT NULL, color VARCHAR(16) NULL,
    seq BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL, deleted INT NOT NULL DEFAULT 0`,
  versions: `{ID}, note_id VARCHAR(36) NOT NULL, workspace_id BIGINT NOT NULL, version INT NOT NULL, title VARCHAR(500) NOT NULL,
    content {LONGTEXT} NULL, user_id BIGINT NULL, created_at BIGINT NOT NULL`,
  comments: `{ID}, workspace_id BIGINT NOT NULL, note_id VARCHAR(36) NOT NULL, block_id VARCHAR(40) NULL, user_id BIGINT NOT NULL,
    body {TEXT} NOT NULL, resolved INT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL`,
  files: `id VARCHAR(36) PRIMARY KEY, workspace_id BIGINT NOT NULL, note_id VARCHAR(36) NULL, name VARCHAR(255) NOT NULL,
    mime VARCHAR(120) NOT NULL, size BIGINT NOT NULL, path VARCHAR(255) NOT NULL, ocr {LONGTEXT} NULL,
    created_by BIGINT NULL, created_at BIGINT NOT NULL`,
  audit: `{ID}, workspace_id BIGINT NULL, user_id BIGINT NULL, action VARCHAR(80) NOT NULL, target VARCHAR(190) NULL,
    meta {TEXT} NULL, ip VARCHAR(45) NULL, created_at BIGINT NOT NULL`,
  presence: `note_id VARCHAR(36) NOT NULL, user_id BIGINT NOT NULL, workspace_id BIGINT NOT NULL, editing INT NOT NULL DEFAULT 0,
    at BIGINT NOT NULL, PRIMARY KEY (note_id, user_id)`,
  throttle: '{ID}, k VARCHAR(190) NOT NULL, at BIGINT NOT NULL',
  notifications: `{ID}, user_id BIGINT NOT NULL, workspace_id BIGINT NULL, kind VARCHAR(40) NOT NULL, body {TEXT} NOT NULL,
    note_id VARCHAR(36) NULL, read_at BIGINT NULL, created_at BIGINT NOT NULL`,
};

const INDEXES = {
  members: ['user_id'],
  tokens: ['user_id'],
  notebooks: ['workspace_id, seq'],
  notes: ['workspace_id, seq', 'workspace_id, notebook_id', 'workspace_id, parent_id', 'workspace_id, updated_at', 'reminder_at'],
  tags: ['workspace_id, seq'],
  versions: ['note_id, created_at'],
  comments: ['note_id'],
  files: ['workspace_id', 'note_id'],
  audit: ['workspace_id, created_at', 'created_at', 'user_id'],
  throttle: ['k, at'],
  notifications: ['user_id, created_at'],
};

export async function migrate() {
  const mysql = db.driver === 'mysql';
  const map = mysql
    ? { '{ID}': 'id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY', '{TEXT}': 'TEXT', '{LONGTEXT}': 'LONGTEXT' }
    : { '{ID}': 'id INTEGER PRIMARY KEY AUTOINCREMENT', '{TEXT}': 'TEXT', '{LONGTEXT}': 'TEXT' };
  for (const [name, cols] of Object.entries(TABLES)) {
    let sql = `CREATE TABLE IF NOT EXISTS ${name} (${cols.replace(/\{\w+\}/g, (m) => map[m])})`;
    if (mysql) sql += ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    await db.q(sql);
  }
  for (const [table, list] of Object.entries(INDEXES)) {
    for (const cols of list) {
      const idx = `ix_${table}_${cols.replace(/\W+/g, '_')}`;
      try {
        await db.q(mysql ? `CREATE INDEX ${idx} ON ${table} (${cols})` : `CREATE INDEX IF NOT EXISTS ${idx} ON ${table} (${cols})`);
      } catch { /* MySQL has no IF NOT EXISTS for indexes; an existing one is fine */ }
    }
  }
  await setSetting(db, 'schema_version', SCHEMA_VERSION);
}
