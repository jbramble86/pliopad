using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Pliopad.Core;

/// <summary>
/// The app's single source of truth: the signed-in session, the current workspace, local edits and background sync.
/// Edits always land in the local database first and are pushed shortly after, so the app works offline.
/// </summary>
public sealed class Repo
{
    public Store Store { get; }
    public Api Api { get; }
    private readonly SyncEngine _sync;
    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private CancellationTokenSource? _soon;

    /// <summary>The app always uses pliopad.com. PLIOPAD_SERVER overrides it for development and tests only.</summary>
    public static string DefaultServer => Environment.GetEnvironmentVariable("PLIOPAD_SERVER") ?? "https://pliopad.com";
    public string Server { get; private set; } = DefaultServer;
    public string? Token { get; private set; }
    public User? User { get; private set; }
    public List<Workspace> Workspaces { get; private set; } = [];
    public long WsId { get; private set; }
    public bool AiEnabled { get; private set; }
    public string SyncStatus { get; private set; } = "";
    public event Action? SyncStatusChanged;

    public Workspace? Workspace => Workspaces.FirstOrDefault(w => w.Id == WsId);
    public bool CanWrite => Workspace?.Role != "guest";
    public bool SignedIn => Token != null && WsId != 0;

    public Repo(string dataDir)
    {
        Directory.CreateDirectory(dataDir);
        Store = new Store(Path.Combine(dataDir, "pliopad.db"));
        Api = new Api(() => Server, () => Token) { Log = line => { try { File.AppendAllText(Path.Combine(dataDir, "network.log"), line + Environment.NewLine); } catch { } } };
        _sync = new SyncEngine(Store, Api);
        Token = Unprotect(Store.Get("token"));
        WsId = long.TryParse(Store.Get("ws"), out var ws) ? ws : 0;
        try
        {
            User = Store.Get("user") is { } u ? JsonSerializer.Deserialize<User>(u, Blocks.Json) : null;
            Workspaces = Store.Get("workspaces") is { } w ? JsonSerializer.Deserialize<List<Workspace>>(w, Blocks.Json) ?? [] : [];
        }
        catch (JsonException) { }
        AiEnabled = Store.Get("ai") == "1";
    }

    // The token is encrypted for this Windows user account (DPAPI), never stored in clear text.
    private static string? Protect(string? s) => s == null ? null : Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(s), null, DataProtectionScope.CurrentUser));
    private static string? Unprotect(string? s)
    {
        if (s == null) return null;
        try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(s), null, DataProtectionScope.CurrentUser)); } catch { return null; }
    }

    private static string NormalizeServer(string server)
    {
        server = server.Trim().TrimEnd('/');
        return server.StartsWith("http") ? server : "https://" + server;
    }

    public Task SignIn(string server, string email, string password, string? code) =>
        Begin(NormalizeServer(server), Api.Login(NormalizeServer(server), email.Trim(), password, string.IsNullOrWhiteSpace(code) ? null : code.Trim()));

    public Task SignUp(string server, string name, string email, string password) =>
        Begin(NormalizeServer(server), Api.Signup(NormalizeServer(server), name.Trim(), email.Trim(), password));

    private async Task Begin(string server, Task<MeResponse> auth)
    {
        var me = await auth;
        Server = server;
        Token = me.Token ?? throw new ApiException(401, "Sign-in failed");
        Store.Set("token", Protect(Token));
        ApplyMe(me);
        if (WsId == 0 || Workspace == null) SwitchWorkspace(me.Workspaces.FirstOrDefault()?.Id ?? 0);
        await SyncNow();
    }

    private void ApplyMe(MeResponse me)
    {
        User = me.User;
        Workspaces = me.Workspaces;
        AiEnabled = me.Ai;
        Store.Set("user", JsonSerializer.Serialize(me.User, Blocks.Json));
        Store.Set("workspaces", JsonSerializer.Serialize(me.Workspaces, Blocks.Json));
        Store.Set("ai", me.Ai ? "1" : "0");
    }

    /// <summary>The Home layout from the account; the copy on this PC (or the old show/hide setting) when offline.</summary>
    public HomeLayout HomeLayout => HomeLayout.FromPrefs(User?.Prefs)
        ?? HomeLayout.Normalize([], (Pref("homeHidden") ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries));

    public async Task SaveHomeLayout(HomeLayout layout)
    {
        if (User == null) return;
        var prefs = User.Prefs?.DeepClone() as JsonObject ?? [];
        prefs["home"] = layout.ToJson();
        User = User with { Prefs = prefs };
        Store.Set("user", JsonSerializer.Serialize(User, Blocks.Json));
        try { await Api.SavePrefs(new JsonObject { ["home"] = layout.ToJson() }); } catch { /* offline: this PC keeps it; the account keeps its last layout */ }
    }

    public async Task RefreshMe()
    {
        try { ApplyMe(await Api.Me()); }
        catch (ApiException e) when (e.Status == 401) { await SignOut(); }
        catch { /* offline: keep the cached profile */ }
    }

    public void SwitchWorkspace(long id)
    {
        WsId = id;
        Store.Set("ws", id.ToString());
        Store.NotifyChanged();
    }

    public async Task SignOut()
    {
        await Api.Logout();
        Token = null;
        User = null;
        WsId = 0;
        Store.Wipe();
        Store.NotifyChanged();
    }

    // ---- sync ----

    private void SetStatus(string s) { SyncStatus = s; SyncStatusChanged?.Invoke(); }

    public async Task SyncNow()
    {
        if (!SignedIn) return;
        if (!await _syncLock.WaitAsync(0)) return;
        try
        {
            SetStatus("Syncing…");
            var changed = await _sync.Run(WsId);
            SetStatus("Synced " + DateTime.Now.ToString("t"));
            if (changed > 0) Store.NotifyChanged();
        }
        catch (ApiException e) when (e.Status == 401) { SetStatus("Signed out"); await SignOut(); }
        catch (ApiException e) when (e.Code == "maintenance") { SetStatus("PlioPad is down for maintenance — changes are saved on this PC"); }
        catch (Exception e) { SetStatus(e is HttpRequestException ? "Offline — changes are saved on this PC" : "Sync failed: " + e.Message); }
        finally { _syncLock.Release(); }
    }

    /// <summary>Debounced push after local edits.</summary>
    public void RequestSync()
    {
        _soon?.Cancel();
        var cts = _soon = new CancellationTokenSource();
        _ = Task.Delay(1500, cts.Token).ContinueWith(t => { if (!t.IsCanceled) _ = SyncNow(); }, TaskScheduler.Default);
    }

    // ---- reads ----

    public List<Note> Notes() => Store.Notes(WsId);
    public List<Notebook> Notebooks() => Store.Notebooks(WsId);
    public List<Tag> Tags() => Store.Tags(WsId);
    public Note? Note(string id) => Store.Note(id);

    public List<OpenTask> OpenTasks() =>
        Notes().SelectMany(n => Blocks.OpenTasks(n.Id, n.DisplayTitle, Blocks.Parse(n.Content)))
            .OrderBy(t => t.Due ?? "9999").ToList();

    public List<Note> Backlinks(string id) => Notes().Where(n => n.Id != id && n.Content.Contains(id)).ToList();

    /// <summary>Local full-text search with the same operators as the server: notebook:, tag:, is:todo, is:pinned.</summary>
    public List<Note> Search(string q)
    {
        var words = new List<string>();
        IEnumerable<Note> list = Notes();
        foreach (var part in q.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var p = part.ToLowerInvariant();
            if (p.StartsWith("notebook:")) { var name = p[9..]; var ids = Notebooks().Where(nb => nb.Name.ToLowerInvariant().Contains(name)).Select(nb => nb.Id).ToHashSet(); list = list.Where(n => n.NotebookId != null && ids.Contains(n.NotebookId)); }
            else if (p.StartsWith("tag:")) { var name = p[4..].TrimStart('#'); var ids = Tags().Where(t => t.Name.ToLowerInvariant() == name).Select(t => t.Id).ToHashSet(); list = list.Where(n => n.TagIds.Any(ids.Contains)); }
            else if (p == "is:todo") list = list.Where(n => n.Content.Contains("\"t\":\"todo\""));
            else if (p == "is:pinned") list = list.Where(n => n.Pinned);
            else words.Add(p);
        }
        return list.Select(n => (n, score: words.Sum(w => (n.Title.ToLowerInvariant().Contains(w) ? 3 : 0) + (n.Plain.ToLowerInvariant().Contains(w) ? 1 : 0))))
            .Where(x => words.All(w => x.n.Title.Contains(w, StringComparison.OrdinalIgnoreCase) || x.n.Plain.Contains(w, StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(x => x.score).ThenByDescending(x => x.n.UpdatedAt).Select(x => x.n).Take(100).ToList();
    }

    // ---- recent visits (Home "Recently visited") ----

    public List<string> RecentIds() => Store.Get($"recent.{WsId}") is { } s ? JsonSerializer.Deserialize<List<string>>(s) ?? [] : [];
    public void TrackVisit(string id) => Store.Set($"recent.{WsId}", JsonSerializer.Serialize(new[] { id }.Concat(RecentIds().Where(x => x != id)).Take(24)));

    public string? Pref(string key) => Store.Get("pref." + key);
    public void SetPref(string key, string? value) => Store.Set("pref." + key, value);

    // ---- note edits ----

    public string? DefaultNotebook() => (Notebooks().FirstOrDefault(nb => nb.Name.Equals("Inbox", StringComparison.OrdinalIgnoreCase)) ?? Notebooks().FirstOrDefault())?.Id;

    public string CreateNote(string title = "", List<Block>? blocks = null, string? notebookId = null, string? parentId = null,
        bool useDefaultNotebook = true, string kind = "note", string? dbSchema = null, string? icon = null)
    {
        var n = new Note
        {
            WsId = WsId, Title = title, Content = Blocks.Encode(blocks ?? []), Kind = kind, DbSchema = dbSchema, Icon = icon, ParentId = parentId,
            // Every page lives in a notebook: sub-pages and database rows share their parent's, everything else defaults to the Inbox.
            NotebookId = (parentId != null ? Store.Note(parentId)?.NotebookId : null) ?? notebookId ?? DefaultNotebook(), Sort = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };
        Store.SaveLocal(n);
        Changed();
        return n.Id;
    }

    private void Changed() { Store.NotifyChanged(); RequestSync(); }

    public void Update(string id, Action<Note> change, bool notify = true)
    {
        var n = Store.Note(id);
        if (n == null) return;
        change(n);
        Store.SaveLocal(n);
        if (notify) Changed(); else RequestSync();
    }

    /// <summary>Editor saves: no list refresh storm while typing, only a debounced push.</summary>
    public void SaveContent(string id, string title, List<Block> blocks) => Update(id, n => { n.Title = title; n.Content = Blocks.Encode(blocks); }, notify: false);

    public void SetPinned(string id, bool v) => Update(id, n => n.Pinned = v);
    public void SetIcon(string id, string? icon) => Update(id, n => n.Icon = icon);
    public void MoveTo(string id, string? notebookId) => Update(id, n => n.NotebookId = notebookId);
    public void SetReminder(string id, long? at) => Update(id, n => { n.ReminderAt = at; n.ReminderDone = false; });
    public void ReminderDone(string id) => Update(id, n => n.ReminderDone = true);
    public void Trash(string id) => Update(id, n => n.TrashedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    public void Restore(string id) => Update(id, n => n.TrashedAt = null);
    public void DeleteForever(string id) => Update(id, n => n.Deleted = true);
    public void SetTemplate(string id, bool v) => Update(id, n => n.IsTemplate = v);
    public void SetTags(string id, IEnumerable<string> tags) => Update(id, n => n.Tags = JsonSerializer.Serialize(tags.Distinct().ToList()));
    public void EmptyTrash() { foreach (var n in Store.Trash(WsId)) DeleteForever(n.Id); }

    public void ToggleTask(string noteId, string blockId) => Update(noteId, n =>
    {
        var blocks = Blocks.Parse(n.Content);
        foreach (var b in blocks) if (b.Id == blockId) { b.C = b.Checked ? null : true; b.Touch(); }
        n.Content = Blocks.Encode(blocks);
    });

    public Dictionary<string, string> PropsOf(Note n)
    {
        try { return JsonNode.Parse(n.Props ?? "{}")!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value is JsonValue v && v.TryGetValue<string>(out var s) ? s : kv.Value?.ToJsonString() ?? ""); }
        catch { return []; }
    }

    public JsonObject PropsNode(Note n) { try { return (n.Props != null ? JsonNode.Parse(n.Props) as JsonObject : null) ?? []; } catch { return []; } }

    /// <summary>Sets one database property; values keep their JSON type (numbers, booleans, option ids, person ids).</summary>
    public void SetProp(string id, string key, JsonNode? value) => Update(id, n =>
    {
        var o = PropsNode(n);
        if (value == null) o.Remove(key); else o[key] = value;
        n.Props = o.ToJsonString();
    });

    public string? Duplicate(string id, bool fromTemplate = false)
    {
        var n = Store.Note(id);
        if (n == null) return null;
        var blocks = Blocks.Parse(n.Content);
        foreach (var b in blocks) { b.Id = Guid.NewGuid().ToString(); b.Touch(); }
        var title = fromTemplate ? $"{n.Title} {DateTime.Now:d}" : $"{n.DisplayTitle} (copy)";
        var newId = CreateNote(title, blocks, n.NotebookId, fromTemplate ? null : n.ParentId, n.NotebookId == null && fromTemplate, n.Kind, n.DbSchema, n.Icon);
        Update(newId, x => { x.Tags = n.Tags; x.Props = n.Props; });
        return newId;
    }

    /// <summary>Today's journal page: opens it if it exists, otherwise creates it in a "Journal" notebook.</summary>
    public string DailyNote()
    {
        var title = DateTime.Now.ToString("dddd, MMMM d, yyyy");
        if (Notes().FirstOrDefault(n => n.Title == title) is { } existing) return existing.Id;
        var journal = Notebooks().FirstOrDefault(nb => nb.Name == "Journal")?.Id ?? CreateNotebook("Journal", null, "📔");
        return CreateNote(title, Blocks.FromMarkdown("## Top 3 today\n- [ ] \n## Notes\n\n## Wins"), journal);
    }

    /// <summary>Same starting schema as the web app: Status, Date and Owner, with Table, Board and Calendar views.</summary>
    public string NewDatabase(string? notebookId)
    {
        const string schema = """
            {"props":[{"id":"status","name":"Status","type":"status","options":[{"id":"todo","name":"Not started","color":"gray"},{"id":"doing","name":"In progress","color":"blue"},{"id":"done","name":"Done","color":"green"}]},
            {"id":"date","name":"Date","type":"date"},{"id":"owner","name":"Owner","type":"person"}],
            "views":[{"id":"v1","name":"Table","type":"table"},{"id":"v2","name":"Board","type":"board","group":"status"},{"id":"v3","name":"Calendar","type":"calendar","date":"date"}]}
            """;
        return CreateNote("", [], notebookId, kind: "db", dbSchema: JsonNode.Parse(schema)!.ToJsonString());
    }

    public void SetSchema(string id, JsonObject schema) => Update(id, n => n.DbSchema = schema.ToJsonString());

    public List<Note> Rows(string dbId) => Notes().Where(n => n.ParentId == dbId).OrderBy(n => n.Sort).ToList();

    // ---- notebooks, stacks and tags (a stack is a name shared by notebooks; it exists while a notebook is in it) ----

    private void UpdateNotebook(string id, Action<Notebook> change)
    {
        var nb = Store.Notebooks(WsId).FirstOrDefault(x => x.Id == id);
        if (nb == null) return;
        change(nb);
        nb.Dirty = true;
        Store.UpsertNotebook(nb);
        Changed();
    }

    public string CreateNotebook(string name, string? stack, string icon = "📓")
    {
        var nb = new Notebook { WsId = WsId, Name = string.IsNullOrWhiteSpace(name) ? "Untitled" : name.Trim(), Stack = string.IsNullOrWhiteSpace(stack) ? null : stack.Trim(), Icon = icon, Sort = 99, Dirty = true };
        Store.UpsertNotebook(nb);
        Changed();
        return nb.Id;
    }

    public void RenameNotebook(string id, string name) => UpdateNotebook(id, nb => nb.Name = string.IsNullOrWhiteSpace(name) ? nb.Name : name.Trim());
    public void SetNotebookIcon(string id, string? icon) => UpdateNotebook(id, nb => nb.Icon = icon ?? "📓");
    public void SetNotebookStack(string id, string? stack) => UpdateNotebook(id, nb => nb.Stack = string.IsNullOrWhiteSpace(stack) ? null : stack.Trim());
    public void RenameStack(string old, string name) { foreach (var nb in Notebooks().Where(x => x.Stack == old)) SetNotebookStack(nb.Id, name); }
    public void UngroupStack(string stack) { foreach (var nb in Notebooks().Where(x => x.Stack == stack)) SetNotebookStack(nb.Id, null); }

    /// <summary>Deleting a notebook moves its notes to the trash, like on the web.</summary>
    public void DeleteNotebook(string id)
    {
        foreach (var n in Notes().Where(n => n.NotebookId == id)) { n.TrashedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); n.NotebookId = null; Store.SaveLocal(n); }
        UpdateNotebook(id, nb => nb.Deleted = true);
    }

    public string CreateTag(string name)
    {
        var t = new Tag { WsId = WsId, Name = name.Trim().TrimStart('#'), Dirty = true };
        Store.UpsertTag(t);
        Changed();
        return t.Id;
    }

    public void RenameTag(string id, string name)
    {
        var t = Tags().FirstOrDefault(x => x.Id == id);
        if (t == null || string.IsNullOrWhiteSpace(name)) return;
        t.Name = name.Trim().TrimStart('#'); t.Dirty = true; Store.UpsertTag(t); Changed();
    }

    public void DeleteTag(string id)
    {
        var t = Tags().FirstOrDefault(x => x.Id == id);
        if (t == null) return;
        t.Deleted = true; t.Dirty = true; Store.UpsertTag(t); Changed();
    }

    /// <summary>Copies an image into app storage; the block points at it until sync uploads it.</summary>
    public string ImportImage(string path, string dataDir)
    {
        var dir = Path.Combine(dataDir, "pending");
        Directory.CreateDirectory(dir);
        var dest = Path.Combine(dir, Guid.NewGuid() + Path.GetExtension(path).ToLowerInvariant());
        File.Copy(path, dest);
        return "local:" + dest;
    }
}
