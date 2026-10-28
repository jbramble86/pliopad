using Microsoft.Data.Sqlite;

namespace Pliopad.Core;

/// <summary>
/// The offline database on this PC (SQLite in %LOCALAPPDATA%\Pliopad). Everything the UI shows comes from here;
/// <see cref="SyncEngine"/> keeps it in step with the server.
/// </summary>
public sealed class Store : IDisposable
{
    private readonly SqliteConnection _db;
    private readonly object _lock = new();
    public event Action? Changed;

    public Store(string path)
    {
        _db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Cache = SqliteCacheMode.Shared }.ToString());
        _db.Open();
        Exec("PRAGMA journal_mode=WAL");
        Exec("""
            CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, ws INTEGER, notebook_id TEXT, parent_id TEXT, kind TEXT, title TEXT, icon TEXT,
              content TEXT, plain TEXT, props TEXT, db_schema TEXT, tags TEXT, pinned INTEGER, sort REAL, version INTEGER, base_updated INTEGER,
              created_at INTEGER, updated_at INTEGER, updated_by INTEGER, trashed_at INTEGER, reminder_at INTEGER, reminder_done INTEGER,
              is_template INTEGER, locked INTEGER, share_slug TEXT, dirty INTEGER, rev INTEGER, deleted INTEGER);
            CREATE INDEX IF NOT EXISTS notes_ws ON notes(ws, updated_at);
            CREATE TABLE IF NOT EXISTS notebooks(id TEXT PRIMARY KEY, ws INTEGER, name TEXT, stack TEXT, icon TEXT, sort REAL, dirty INTEGER, deleted INTEGER);
            CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY, ws INTEGER, name TEXT, color TEXT, dirty INTEGER, deleted INTEGER);
            CREATE TABLE IF NOT EXISTS sync_state(ws INTEGER PRIMARY KEY, seq INTEGER, last_sync INTEGER);
            CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
            """);
    }

    public void Dispose() => _db.Dispose();
    public void NotifyChanged() => Changed?.Invoke();

    private void Exec(string sql, params (string, object?)[] args)
    {
        lock (_lock)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
    }

    private List<T> Query<T>(string sql, Func<SqliteDataReader, T> map, params (string, object?)[] args)
    {
        lock (_lock)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v ?? DBNull.Value);
            using var r = cmd.ExecuteReader();
            var list = new List<T>();
            while (r.Read()) list.Add(map(r));
            return list;
        }
    }

    // ---- key/value (session, preferences, recent visits) ----

    public string? Get(string key) => Query("SELECT v FROM kv WHERE k=$k", r => r.GetString(0), ("$k", key)).FirstOrDefault();
    public void Set(string key, string? value)
    {
        if (value == null) Exec("DELETE FROM kv WHERE k=$k", ("$k", key));
        else Exec("INSERT INTO kv(k,v) VALUES($k,$v) ON CONFLICT(k) DO UPDATE SET v=excluded.v", ("$k", key), ("$v", value));
    }

    // ---- notes ----

    private const string NoteCols = "id, ws, notebook_id, parent_id, kind, title, icon, content, plain, props, db_schema, tags, pinned, sort, version, base_updated, created_at, updated_at, updated_by, trashed_at, reminder_at, reminder_done, is_template, locked, share_slug, dirty, rev, deleted";

    private static string? S(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);
    private static long? L(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetInt64(i);

    private static Note ReadNote(SqliteDataReader r) => new()
    {
        Id = r.GetString(0), WsId = r.GetInt64(1), NotebookId = S(r, 2), ParentId = S(r, 3), Kind = S(r, 4) ?? "note", Title = S(r, 5) ?? "",
        Icon = S(r, 6), Content = S(r, 7) ?? "[]", Plain = S(r, 8) ?? "", Props = S(r, 9), DbSchema = S(r, 10), Tags = S(r, 11) ?? "[]",
        Pinned = r.GetInt64(12) != 0, Sort = r.GetDouble(13), Version = (int)r.GetInt64(14), BaseUpdated = r.GetInt64(15), CreatedAt = r.GetInt64(16),
        UpdatedAt = r.GetInt64(17), UpdatedBy = L(r, 18), TrashedAt = L(r, 19), ReminderAt = L(r, 20), ReminderDone = r.GetInt64(21) != 0,
        IsTemplate = r.GetInt64(22) != 0, Locked = r.GetInt64(23) != 0, ShareSlug = S(r, 24), Dirty = r.GetInt64(25) != 0, Rev = (int)r.GetInt64(26),
        Deleted = r.GetInt64(27) != 0,
    };

    public void UpsertNote(Note n) => Exec($"""
        INSERT INTO notes({NoteCols}) VALUES($id,$ws,$nb,$parent,$kind,$title,$icon,$content,$plain,$props,$schema,$tags,$pinned,$sort,$version,$base,
          $created,$updated,$by,$trashed,$rem,$remdone,$tpl,$locked,$slug,$dirty,$rev,$deleted)
        ON CONFLICT(id) DO UPDATE SET ws=excluded.ws, notebook_id=excluded.notebook_id, parent_id=excluded.parent_id, kind=excluded.kind,
          title=excluded.title, icon=excluded.icon, content=excluded.content, plain=excluded.plain, props=excluded.props, db_schema=excluded.db_schema,
          tags=excluded.tags, pinned=excluded.pinned, sort=excluded.sort, version=excluded.version, base_updated=excluded.base_updated,
          created_at=excluded.created_at, updated_at=excluded.updated_at, updated_by=excluded.updated_by, trashed_at=excluded.trashed_at,
          reminder_at=excluded.reminder_at, reminder_done=excluded.reminder_done, is_template=excluded.is_template, locked=excluded.locked,
          share_slug=excluded.share_slug, dirty=excluded.dirty, rev=excluded.rev, deleted=excluded.deleted
        """,
        ("$id", n.Id), ("$ws", n.WsId), ("$nb", n.NotebookId), ("$parent", n.ParentId), ("$kind", n.Kind), ("$title", n.Title), ("$icon", n.Icon),
        ("$content", n.Content), ("$plain", n.Plain), ("$props", n.Props), ("$schema", n.DbSchema), ("$tags", n.Tags), ("$pinned", n.Pinned ? 1 : 0),
        ("$sort", n.Sort), ("$version", n.Version), ("$base", n.BaseUpdated), ("$created", n.CreatedAt), ("$updated", n.UpdatedAt), ("$by", n.UpdatedBy),
        ("$trashed", n.TrashedAt), ("$rem", n.ReminderAt), ("$remdone", n.ReminderDone ? 1 : 0), ("$tpl", n.IsTemplate ? 1 : 0), ("$locked", n.Locked ? 1 : 0),
        ("$slug", n.ShareSlug), ("$dirty", n.Dirty ? 1 : 0), ("$rev", n.Rev), ("$deleted", n.Deleted ? 1 : 0));

    public Note? Note(string id) => Query($"SELECT {NoteCols} FROM notes WHERE id=$id", ReadNote, ("$id", id)).FirstOrDefault();

    /// <summary>Live notes (not trashed, not deleted, not templates) of a workspace, newest first.</summary>
    public List<Note> Notes(long ws) =>
        Query($"SELECT {NoteCols} FROM notes WHERE ws=$ws AND deleted=0 AND trashed_at IS NULL AND is_template=0 ORDER BY updated_at DESC", ReadNote, ("$ws", ws));

    public List<Note> Trash(long ws) =>
        Query($"SELECT {NoteCols} FROM notes WHERE ws=$ws AND deleted=0 AND trashed_at IS NOT NULL ORDER BY trashed_at DESC", ReadNote, ("$ws", ws));

    public List<Note> Templates(long ws) =>
        Query($"SELECT {NoteCols} FROM notes WHERE ws=$ws AND deleted=0 AND trashed_at IS NULL AND is_template=1 ORDER BY title", ReadNote, ("$ws", ws));

    public List<Note> DirtyNotes(long ws) => Query($"SELECT {NoteCols} FROM notes WHERE ws=$ws AND dirty=1", ReadNote, ("$ws", ws));

    public void MarkClean(string id, int rev) => Exec("UPDATE notes SET dirty=0 WHERE id=$id AND rev=$rev", ("$id", id), ("$rev", rev));
    public void DeleteNote(string id) => Exec("DELETE FROM notes WHERE id=$id", ("$id", id));

    /// <summary>Local edit: bumps the revision and marks the row for the next push.</summary>
    public Note SaveLocal(Note n, bool touch = true)
    {
        n.Dirty = true;
        n.Rev++;
        if (touch) n.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        n.Plain = Blocks.Plain(Blocks.Parse(n.Content));
        UpsertNote(n);
        return n;
    }

    // ---- notebooks and tags ----

    public List<Notebook> Notebooks(long ws) => Query("SELECT id, ws, name, stack, icon, sort, dirty, deleted FROM notebooks WHERE ws=$ws AND deleted=0 ORDER BY sort, name",
        r => new Notebook { Id = r.GetString(0), WsId = r.GetInt64(1), Name = r.GetString(2), Stack = S(r, 3), Icon = S(r, 4), Sort = r.GetDouble(5), Dirty = r.GetInt64(6) != 0, Deleted = r.GetInt64(7) != 0 },
        ("$ws", ws));

    public List<Notebook> DirtyNotebooks(long ws) => Query("SELECT id, ws, name, stack, icon, sort, dirty, deleted FROM notebooks WHERE ws=$ws AND dirty=1",
        r => new Notebook { Id = r.GetString(0), WsId = r.GetInt64(1), Name = r.GetString(2), Stack = S(r, 3), Icon = S(r, 4), Sort = r.GetDouble(5), Dirty = true, Deleted = r.GetInt64(7) != 0 },
        ("$ws", ws));

    public void UpsertNotebook(Notebook nb) => Exec("""
        INSERT INTO notebooks(id, ws, name, stack, icon, sort, dirty, deleted) VALUES($id,$ws,$name,$stack,$icon,$sort,$dirty,$deleted)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, stack=excluded.stack, icon=excluded.icon, sort=excluded.sort, dirty=excluded.dirty, deleted=excluded.deleted
        """, ("$id", nb.Id), ("$ws", nb.WsId), ("$name", nb.Name), ("$stack", nb.Stack), ("$icon", nb.Icon), ("$sort", nb.Sort), ("$dirty", nb.Dirty ? 1 : 0), ("$deleted", nb.Deleted ? 1 : 0));

    public List<Tag> Tags(long ws) => Query("SELECT id, ws, name, color, dirty, deleted FROM tags WHERE ws=$ws AND deleted=0 ORDER BY name",
        r => new Tag { Id = r.GetString(0), WsId = r.GetInt64(1), Name = r.GetString(2), Color = S(r, 3), Dirty = r.GetInt64(4) != 0 }, ("$ws", ws));

    public List<Tag> DirtyTags(long ws) => Query("SELECT id, ws, name, color, dirty, deleted FROM tags WHERE ws=$ws AND dirty=1",
        r => new Tag { Id = r.GetString(0), WsId = r.GetInt64(1), Name = r.GetString(2), Color = S(r, 3), Dirty = true, Deleted = r.GetInt64(5) != 0 }, ("$ws", ws));

    public void UpsertTag(Tag t) => Exec("""
        INSERT INTO tags(id, ws, name, color, dirty, deleted) VALUES($id,$ws,$name,$color,$dirty,$deleted)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, dirty=excluded.dirty, deleted=excluded.deleted
        """, ("$id", t.Id), ("$ws", t.WsId), ("$name", t.Name), ("$color", t.Color), ("$dirty", t.Dirty ? 1 : 0), ("$deleted", t.Deleted ? 1 : 0));

    public void CleanNotebooks(IEnumerable<string> ids) { foreach (var id in ids) Exec("UPDATE notebooks SET dirty=0 WHERE id=$id", ("$id", id)); Exec("DELETE FROM notebooks WHERE deleted=1 AND dirty=0"); }
    public void CleanTags(IEnumerable<string> ids) { foreach (var id in ids) Exec("UPDATE tags SET dirty=0 WHERE id=$id", ("$id", id)); Exec("DELETE FROM tags WHERE deleted=1 AND dirty=0"); }

    // ---- sync state ----

    public long Seq(long ws) => Query("SELECT seq FROM sync_state WHERE ws=$ws", r => r.GetInt64(0), ("$ws", ws)).FirstOrDefault();
    public long LastSync(long ws) => Query("SELECT last_sync FROM sync_state WHERE ws=$ws", r => r.GetInt64(0), ("$ws", ws)).FirstOrDefault();
    public void SaveSeq(long ws, long seq) => Exec("INSERT INTO sync_state(ws, seq, last_sync) VALUES($ws,$seq,$t) ON CONFLICT(ws) DO UPDATE SET seq=excluded.seq, last_sync=excluded.last_sync",
        ("$ws", ws), ("$seq", seq), ("$t", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));

    /// <summary>Forget all synced data (sign out).</summary>
    public void Wipe() => Exec("DELETE FROM notes; DELETE FROM notebooks; DELETE FROM tags; DELETE FROM sync_state; DELETE FROM kv WHERE k NOT LIKE 'pref.%';");
}
