using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Pliopad.Core;

// Help center: articles (the same on every platform) and support requests, answered from the admin console.

public sealed record HelpCategory([property: JsonPropertyName("id")] string Id, [property: JsonPropertyName("name")] string Name, [property: JsonPropertyName("icon")] string Icon);
public sealed record HelpArticle([property: JsonPropertyName("id")] string Id, [property: JsonPropertyName("category")] string Category,
    [property: JsonPropertyName("title")] string Title, [property: JsonPropertyName("body")] string Body);
public sealed record HelpData([property: JsonPropertyName("categories")] List<HelpCategory> Categories, [property: JsonPropertyName("articles")] List<HelpArticle> Articles);

public sealed record SupportFile([property: JsonPropertyName("id")] string Id, [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("mime")] string Mime, [property: JsonPropertyName("size")] long Size, [property: JsonPropertyName("url")] string Url);
public sealed record TicketMessage([property: JsonPropertyName("id")] long Id, [property: JsonPropertyName("staff")] bool Staff,
    [property: JsonPropertyName("author")] string? Author, [property: JsonPropertyName("body")] string Body, [property: JsonPropertyName("created_at")] long CreatedAt,
    [property: JsonPropertyName("files")] List<SupportFile>? Files);
public sealed record Ticket([property: JsonPropertyName("id")] long Id, [property: JsonPropertyName("subject")] string Subject,
    [property: JsonPropertyName("status")] string Status, [property: JsonPropertyName("created_at")] long CreatedAt, [property: JsonPropertyName("updated_at")] long UpdatedAt,
    [property: JsonPropertyName("unread")] bool Unread, [property: JsonPropertyName("rating")] string? Rating, [property: JsonPropertyName("messages")] List<TicketMessage>? Messages)
{
    public static readonly Dictionary<string, string> StatusNames = new() { ["open"] = "Waiting for support", ["answered"] = "Support replied", ["on_hold"] = "On hold", ["closed"] = "Solved" };
    public string StatusName => StatusNames.GetValueOrDefault(Status, Status);
}

/// <summary>An app build offered on the website (the newest one for each platform).</summary>
public sealed record AppBuild([property: JsonPropertyName("id")] string Id, [property: JsonPropertyName("version")] string? Version,
    [property: JsonPropertyName("url")] string? Url, [property: JsonPropertyName("available")] bool Available)
{
    /// <summary>True if version a is later than b (1.10.0 is later than 1.9.3).</summary>
    public static bool Newer(string a, string b)
    {
        var x = a.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
        var y = b.Split('.').Select(p => int.TryParse(p, out var n) ? n : 0).ToArray();
        for (int i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            var d = (i < x.Length ? x[i] : 0) - (i < y.Length ? y[i] : 0);
            if (d != 0) return d > 0;
        }
        return false;
    }
}

public sealed partial class Api
{
    public async Task<List<AppBuild>> Downloads() => Decode<List<AppBuild>>(await Call(HttpMethod.Get, "/downloads", auth: false));

    public async Task<HelpData> Help() => Decode<HelpData>(await Call(HttpMethod.Get, "/help", auth: false));
    public async Task<List<Ticket>> Tickets() => Decode<List<Ticket>>(await Call(HttpMethod.Get, "/support/tickets"));
    public async Task<Ticket> Ticket(long id) => Decode<Ticket>(await Call(HttpMethod.Get, $"/support/tickets/{id}"));

    public async Task<Ticket> OpenTicket(string subject, string body, string category, long? ws, string version, IEnumerable<string> files) =>
        Decode<Ticket>(await Call(HttpMethod.Post, "/support/tickets", new JsonObject
        {
            ["subject"] = subject, ["body"] = body, ["category"] = category, ["platform"] = "Windows", ["app_version"] = version, ["workspace_id"] = ws,
            ["files"] = new JsonArray(files.Select(f => (JsonNode?)f).ToArray()),
        }));

    public async Task<Ticket> ReplyTicket(long id, string body, IEnumerable<string> files) =>
        Decode<Ticket>(await Call(HttpMethod.Post, $"/support/tickets/{id}/messages", new JsonObject { ["body"] = body, ["files"] = new JsonArray(files.Select(f => (JsonNode?)f).ToArray()) }));
    public async Task<Ticket> CloseTicket(long id) => Decode<Ticket>(await Call(HttpMethod.Post, $"/support/tickets/{id}/close"));
    public async Task<Ticket> RateTicket(long id, string rating) => Decode<Ticket>(await Call(HttpMethod.Post, $"/support/tickets/{id}/rate", new JsonObject { ["rating"] = rating }));

    /// <summary>Uploads a screenshot or file for a support request (up to 10 MB).</summary>
    public async Task<SupportFile> UploadSupportFile(string path)
    {
        using var form = new MultipartFormDataContent();
        var file = new StreamContent(File.OpenRead(path));
        var ext = Path.GetExtension(path).ToLowerInvariant();
        file.Headers.ContentType = new MediaTypeHeaderValue(ext switch { ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg", ".gif" => "image/gif", ".webp" => "image/webp", _ => "application/octet-stream" });
        form.Add(file, "file", Path.GetFileName(path));
        using var req = new HttpRequestMessage(HttpMethod.Post, ServerBase + "/api/support/files") { Content = form };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token());
        using var res = await Http.SendAsync(req);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new ApiException((int)res.StatusCode, (int)res.StatusCode == 413 ? "Attachments can be up to 10 MB." : $"Upload failed ({(int)res.StatusCode})");
        return Decode<SupportFile>(text);
    }
}
