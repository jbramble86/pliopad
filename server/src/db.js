// Database layer. MySQL/MariaDB in production (SiteGround), Node's built-in SQLite for local development and tests.
// Every helper is async; db.tx() runs a callback in a transaction, and queries inside it use the same connection.
import { AsyncLocalStorage } from 'node:async_hooks';
import { config, ApiError } from './util.js';

const txStore = new AsyncLocalStorage();
let impl = null;

async function connect() {
  const c = config('db');
  if (!c) throw new ApiError(503, 'Pliopad is not installed yet.');
  if (c.driver === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    const sq = new DatabaseSync(c.file);
    sq.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    let chain = Promise.resolve(); // SQLite: serialize transactions
    return {
      driver: 'sqlite',
      async run(sql, params) {
        const st = sq.prepare(sql);
        const p = params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
        if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) return { rows: st.all(...p).map((r) => ({ ...r })) };
        const r = st.run(...p);
        return { rows: [], insertId: Number(r.lastInsertRowid), affected: Number(r.changes) };
      },
      async tx(fn) {
        const prev = chain;
        let release;
        chain = new Promise((r) => (release = r));
        await prev;
        sq.exec('BEGIN');
        try {
          const out = await txStore.run(this, fn);
          sq.exec('COMMIT');
          return out;
        } catch (e) {
          sq.exec('ROLLBACK');
          throw e;
        } finally {
          release();
        }
      },
      async close() { sq.close(); },
    };
  }
  const mysql = (await import('mysql2/promise')).default;
  const pool = mysql.createPool({
    host: c.host || 'localhost', port: c.port || 3306, user: c.user, password: c.password, database: c.database,
    connectionLimit: c.pool || 10, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: false, dateStrings: true,
  });
  const runOn = async (conn, sql, params) => {
    const [res] = await conn.query(sql, params.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v)));
    return Array.isArray(res) ? { rows: res } : { rows: [], insertId: res.insertId, affected: res.affectedRows };
  };
  return {
    driver: 'mysql',
    run: (sql, params) => runOn(pool, sql, params),
    async tx(fn) {
      const conn = await pool.getConnection();
      const scoped = { driver: 'mysql', run: (sql, params) => runOn(conn, sql, params), tx: (f) => f() };
      await conn.beginTransaction();
      try {
        const out = await txStore.run(scoped, fn);
        await conn.commit();
        return out;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
    close: () => pool.end(),
  };
}

const current = async () => txStore.getStore() || impl || (impl = await connect());

export const db = {
  async init() { impl = await connect(); return impl.driver; },
  async close() { if (impl) await impl.close(); impl = null; },
  get driver() { return impl?.driver; },
  async q(sql, params = []) { return (await current()).run(sql, params); },
  async all(sql, params = []) { return (await this.q(sql, params)).rows; },
  async one(sql, params = []) { return (await this.all(sql, params))[0] ?? null; },
  async val(sql, params = []) {
    const r = await this.one(sql, params);
    return r ? Object.values(r)[0] : null;
  },
  async insert(table, row) {
    const cols = Object.keys(row);
    const r = await this.q(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, Object.values(row));
    return r.insertId;
  },
  async update(table, row, where) {
    const set = Object.keys(row).map((c) => `${c}=?`).join(',');
    const w = Object.keys(where).map((c) => `${c}=?`).join(' AND ');
    return (await this.q(`UPDATE ${table} SET ${set} WHERE ${w}`, [...Object.values(row), ...Object.values(where)])).affected;
  },
  async upsert(table, row, keys) {
    const where = Object.fromEntries(keys.map((k) => [k, row[k]]));
    const w = keys.map((c) => `${c}=?`).join(' AND ');
    if (await this.val(`SELECT COUNT(*) FROM ${table} WHERE ${w}`, Object.values(where))) {
      const rest = Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
      if (Object.keys(rest).length) await this.update(table, rest, where);
    } else {
      await this.insert(table, row);
    }
  },
  async tx(fn) {
    if (txStore.getStore()) return fn();
    return (await current()).tx(fn);
  },
  /** Case-insensitive LIKE for the active driver (MySQL's default collation is already case-insensitive). */
  ilike(col) { return impl?.driver === 'sqlite' ? `${col} LIKE ? COLLATE NOCASE` : `${col} LIKE ?`; },
};
