using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pliopad.Core;

/// <summary>A note as stored on this PC. Dirty rows are pushed on the next sync; Rev guards edits made during a push.</summary>
public sealed class Note
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public long WsId { get; set; }
    public string? NotebookId { get; set; }
    public string? ParentId { get; set; }
    public string Kind { get; set; } = "note";
    public string Title { get; set; } = "";
    public string? Icon { get; set; }
    public string Content { get; set; } = "[]";
    public string Plain { get; set; } = "";
    public string? Props { get; set; }
    public string? DbSchema { get; set; }
    public string Tags { get; set; } = "[]";
    public bool Pinned { get; set; }
    public double Sort { get; set; }
    public int Version { get; set; }
    public long BaseUpdated { get; set; }
    public long CreatedAt { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public long UpdatedAt { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public long? UpdatedBy { get; set; }
    public long? TrashedAt { get; set; }
    public long? ReminderAt { get; set; }
    public bool ReminderDone { get; set; }
    public bool IsTemplate { get; set; }
    public bool Locked { get; set; }
    public string? ShareSlug { get; set; }
    public bool Dirty { get; set; }
    public int Rev { get; set; }
    public bool Deleted { get; set; }

    public string DisplayTitle => string.IsNullOrWhiteSpace(Title) ? "Untitled" : Title;
    public string DisplayIcon => Icon ?? (Kind == "db" ? "▦" : "📄");
    public List<string> TagIds => JsonSerializer.Deserialize<List<string>>(Tags) ?? [];
}

public sealed class Notebook
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public long WsId { get; set; }
    public string Name { get; set; } = "";
    public string? Stack { get; set; }
    public string? Icon { get; set; }
    public double Sort { get; set; }
    public bool Dirty { get; set; }
    public bool Deleted { get; set; }
}

public sealed class Tag
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public long WsId { get; set; }
    public string Name { get; set; } = "";
    public string? Color { get; set; }
    public bool Dirty { get; set; }
    public bool Deleted { get; set; }
}

public sealed record Workspace(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("role")] string Role = "member",
    [property: JsonPropertyName("plan")] string Plan = "free");

public sealed record User(
    [property: JsonPropertyName("id")] long Id,
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("color")] string? Color = null);

// ---- Server shapes ----

public sealed class ServerNote
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("notebook_id")] public string? NotebookId { get; set; }
    [JsonPropertyName("parent_id")] public string? ParentId { get; set; }
    [JsonPropertyName("kind")] public string Kind { get; set; } = "note";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("icon")] public string? Icon { get; set; }
    [JsonPropertyName("content")] public JsonElement? Content { get; set; }
    [JsonPropertyName("props")] public JsonElement? Props { get; set; }
    [JsonPropertyName("db_schema")] public JsonElement? DbSchema { get; set; }
    [JsonPropertyName("tags")] public List<string> Tags { get; set; } = [];
    [JsonPropertyName("pinned")] public bool Pinned { get; set; }
    [JsonPropertyName("sort")] public double Sort { get; set; }
    [JsonPropertyName("version")] public int Version { get; set; } = 1;
    [JsonPropertyName("updated_by")] public long? UpdatedBy { get; set; }
    [JsonPropertyName("created_at")] public long CreatedAt { get; set; }
    [JsonPropertyName("updated_at")] public long UpdatedAt { get; set; }
    [JsonPropertyName("trashed_at")] public long? TrashedAt { get; set; }
    [JsonPropertyName("deleted")] public bool Deleted { get; set; }
    [JsonPropertyName("share_slug")] public string? ShareSlug { get; set; }
    [JsonPropertyName("reminder_at")] public long? ReminderAt { get; set; }
    [JsonPropertyName("reminder_done")] public bool ReminderDone { get; set; }
    [JsonPropertyName("is_template")] public bool IsTemplate { get; set; }
    [JsonPropertyName("locked")] public bool Locked { get; set; }

    public Note ToLocal(long ws)
    {
        var content = Content is { ValueKind: JsonValueKind.Array } c ? c.GetRawText() : "[]";
        return new Note
        {
            Id = Id, WsId = ws, NotebookId = NotebookId, ParentId = ParentId, Kind = Kind, Title = Title, Icon = Icon,
            Content = content, Plain = Blocks.Plain(Blocks.Parse(content)),
            Props = Props is { ValueKind: JsonValueKind.Object } p ? p.GetRawText() : null,
            DbSchema = DbSchema is { ValueKind: JsonValueKind.Object } d ? d.GetRawText() : null,
            Tags = JsonSerializer.Serialize(Tags), Pinned = Pinned, Sort = Sort, Version = Version, BaseUpdated = UpdatedAt,
            CreatedAt = CreatedAt, UpdatedAt = UpdatedAt, UpdatedBy = UpdatedBy, TrashedAt = TrashedAt, ReminderAt = ReminderAt,
            ReminderDone = ReminderDone, IsTemplate = IsTemplate, Locked = Locked, ShareSlug = ShareSlug,
        };
    }
}

public sealed class ServerNotebook
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("stack")] public string? Stack { get; set; }
    [JsonPropertyName("icon")] public string? Icon { get; set; }
    [JsonPropertyName("sort")] public double Sort { get; set; }
    [JsonPropertyName("deleted")] public bool Deleted { get; set; }
}

public sealed class ServerTag
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("color")] public string? Color { get; set; }
    [JsonPropertyName("deleted")] public bool Deleted { get; set; }
}

public sealed class SyncPull
{
    [JsonPropertyName("seq")] public long Seq { get; set; }
    [JsonPropertyName("more")] public bool More { get; set; }
    [JsonPropertyName("notes")] public List<ServerNote> Notes { get; set; } = [];
    [JsonPropertyName("notebooks")] public List<ServerNotebook> Notebooks { get; set; } = [];
    [JsonPropertyName("tags")] public List<ServerTag> Tags { get; set; } = [];
}

public sealed class SyncPushResult
{
    [JsonPropertyName("notes")] public List<string> Notes { get; set; } = [];
}

public sealed class MeResponse
{
    [JsonPropertyName("token")] public string? Token { get; set; }
    [JsonPropertyName("user")] public User User { get; set; } = new(0, "", "");
    [JsonPropertyName("workspaces")] public List<Workspace> Workspaces { get; set; } = [];
    [JsonPropertyName("ai")] public bool Ai { get; set; }
}

public sealed class AskSource
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("n")] public int N { get; set; }
}

public sealed class AskResult
{
    [JsonPropertyName("answer")] public string Answer { get; set; } = "";
    [JsonPropertyName("sources")] public List<AskSource> Sources { get; set; } = [];
}

public sealed class AiResult
{
    [JsonPropertyName("markdown")] public string? Markdown { get; set; }
    [JsonPropertyName("title")] public string? Title { get; set; }
}
