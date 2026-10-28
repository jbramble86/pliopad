using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Pliopad.Core;

public sealed class ApiException(int status, string message, string? code = null) : Exception(message)
{
    public int Status { get; } = status;
    public string? Code { get; } = code;
}

public sealed record Upload([property: JsonPropertyName("id")] string Id, [property: JsonPropertyName("url")] string Url);
public sealed record Comment([property: JsonPropertyName("id")] long Id, [property: JsonPropertyName("user_name")] string UserName,
    [property: JsonPropertyName("body")] string Body, [property: JsonPropertyName("resolved")] int Resolved, [property: JsonPropertyName("created_at")] long CreatedAt);
public sealed record VersionInfo([property: JsonPropertyName("id")] long Id, [property: JsonPropertyName("version")] int Version,
    [property: JsonPropertyName("title")] string Title, [property: JsonPropertyName("created_at")] long CreatedAt, [property: JsonPropertyName("user_name")] string? UserName);
public sealed record Member([property: JsonPropertyName("id")] long Id, [property: JsonPropertyName("name")] string Name, [property: JsonPropertyName("email")] string? Email);
public sealed record MembersResult([property: JsonPropertyName("members")] List<Member> Members);
public sealed record ShareResult([property: JsonPropertyName("share_slug")] string? Slug, [property: JsonPropertyName("share_url")] string? Url);

/// <summary>Thin client for the Pliopad REST API (the same endpoints the web and Android apps use).</summary>
public sealed class Api(Func<string> server, Func<string?> token)
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(120) };
    /// <summary>Receives details of responses that did not come from the Pliopad server itself.</summary>
    public Action<string>? Log { get; set; }

    public string ServerBase => server().TrimEnd('/');

    private async Task<string> Call(HttpMethod method, string path, object? body = null, bool auth = true, string? baseUrl = null)
    {
        using var req = new HttpRequestMessage(method, (baseUrl ?? ServerBase).TrimEnd('/') + "/api" + path);
        if (body != null) req.Content = JsonContent.Create(body, body.GetType(), options: Blocks.Json);
        else if (method != HttpMethod.Get) req.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
        if (auth && token() is { } t) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", t);
        req.Headers.UserAgent.ParseAdd("Pliopad-Windows/1.1.1");
        req.Headers.Accept.ParseAdd("application/json");
        using var res = await Http.SendAsync(req).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            string? msg = null, code = null;
            try { var o = JsonNode.Parse(text); msg = (string?)o?["error"]; code = (string?)o?["code"]; } catch { }
            // Not our server's JSON: a proxy or firewall answered. Keep enough to diagnose it.
            if (msg == null) Log?.Invoke($"{DateTime.Now:u} {method} {path} -> {(int)res.StatusCode} server={res.Headers.Server} body={text[..Math.Min(text.Length, 600)].ReplaceLineEndings(" ")}");
            throw new ApiException((int)res.StatusCode, msg ?? $"{method} {path.Split('?')[0]} was blocked ({(int)res.StatusCode})", code);
        }
        return text;
    }

    private static T Decode<T>(string text) => JsonSerializer.Deserialize<T>(text, Blocks.Json)!;

    public async Task<MeResponse> Login(string serverUrl, string email, string password, string? code) =>
        Decode<MeResponse>(await Call(HttpMethod.Post, "/auth/login",
            new Dictionary<string, string?> { ["email"] = email, ["password"] = password, ["device"] = "Windows", ["code"] = code }, auth: false, baseUrl: serverUrl));

    public async Task<MeResponse> Signup(string serverUrl, string name, string email, string password) =>
        Decode<MeResponse>(await Call(HttpMethod.Post, "/auth/signup",
            new Dictionary<string, string> { ["name"] = name, ["email"] = email, ["password"] = password, ["device"] = "Windows" }, auth: false, baseUrl: serverUrl));

    public async Task<MeResponse> Me() => Decode<MeResponse>(await Call(HttpMethod.Get, "/me"));

    public async Task Logout() { try { await Call(HttpMethod.Post, "/auth/logout"); } catch { } }

    public async Task<SyncPull> Pull(long ws, long since) => Decode<SyncPull>(await Call(HttpMethod.Get, $"/w/{ws}/sync?since={since}"));

    public async Task<SyncPushResult> Push(long ws, JsonObject body) => Decode<SyncPushResult>(await Call(HttpMethod.Post, $"/w/{ws}/sync", body));

    public async Task<AiResult> Ai(long ws, string action, string noteId) =>
        Decode<AiResult>(await Call(HttpMethod.Post, $"/w/{ws}/ai", new Dictionary<string, string> { ["action"] = action, ["note_id"] = noteId }));

    public async Task<AskResult> Ask(long ws, string question) =>
        Decode<AskResult>(await Call(HttpMethod.Post, $"/w/{ws}/ai/ask", new Dictionary<string, string> { ["question"] = question }));

    public async Task<List<Member>> Members(long ws) => Decode<MembersResult>(await Call(HttpMethod.Get, $"/w/{ws}/members")).Members;

    public async Task<List<Comment>> Comments(long ws, string noteId) => Decode<List<Comment>>(await Call(HttpMethod.Get, $"/w/{ws}/notes/{noteId}/comments"));
    public Task AddComment(long ws, string noteId, string body) => Call(HttpMethod.Post, $"/w/{ws}/notes/{noteId}/comments", new Dictionary<string, string> { ["body"] = body });
    public async Task<List<VersionInfo>> Versions(long ws, string noteId) => Decode<List<VersionInfo>>(await Call(HttpMethod.Get, $"/w/{ws}/notes/{noteId}/versions"));
    public async Task<ServerNote> RestoreVersion(long ws, long id) => Decode<ServerNote>(await Call(HttpMethod.Post, $"/w/{ws}/versions/{id}/restore"));
    public async Task<ShareResult> Share(long ws, string noteId, bool enabled) =>
        Decode<ShareResult>(await Call(HttpMethod.Post, $"/w/{ws}/notes/{noteId}/share", new Dictionary<string, bool> { ["enabled"] = enabled }));

    public async Task<Upload> UploadFile(long ws, string path, string mime, string? noteId)
    {
        using var form = new MultipartFormDataContent();
        var file = new StreamContent(File.OpenRead(path));
        file.Headers.ContentType = new MediaTypeHeaderValue(mime);
        form.Add(file, "file", Path.GetFileName(path));
        if (noteId != null) form.Add(new StringContent(noteId), "note_id");
        using var req = new HttpRequestMessage(HttpMethod.Post, ServerBase + $"/api/w/{ws}/files") { Content = form };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token());
        using var res = await Http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new ApiException((int)res.StatusCode, $"Upload failed ({(int)res.StatusCode})");
        return Decode<Upload>(text);
    }

    /// <summary>Absolute URL for a server-relative file link such as /f/{id}/{sig}.</summary>
    public string Absolute(string src) => src.StartsWith("/") ? ServerBase + src : src;

    public static JsonObject NoteToJson(Note n)
    {
        var o = new JsonObject { ["id"] = n.Id };
        if (n.Deleted) { o["deleted"] = true; return o; }
        o["title"] = n.Title;
        o["icon"] = n.Icon;
        o["notebook_id"] = n.NotebookId;
        o["parent_id"] = n.ParentId;
        o["kind"] = n.Kind;
        o["content"] = JsonNode.Parse(n.Content);
        if (n.Props != null) o["props"] = JsonNode.Parse(n.Props);
        if (n.DbSchema != null) o["db_schema"] = JsonNode.Parse(n.DbSchema);
        o["tags"] = JsonNode.Parse(n.Tags);
        o["pinned"] = n.Pinned;
        o["sort"] = n.Sort;
        o["reminder_at"] = n.ReminderAt;
        o["reminder_done"] = n.ReminderDone;
        o["is_template"] = n.IsTemplate;
        o["locked"] = n.Locked;
        o["trashed_at"] = n.TrashedAt;
        o["created_at"] = n.CreatedAt;
        if (n.Version > 0) { o["base_version"] = n.Version; o["base_updated"] = n.BaseUpdated; }
        return o;
    }
}
