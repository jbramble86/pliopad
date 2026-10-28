using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Pliopad.Core;

/// <summary>
/// One block of a note, in the same format as the server, web and Android apps:
/// T = type (p h1 h2 h3 todo ul ol quote callout code hr img file toggle page bookmark), X = text with light Markdown,
/// Ind = indent, C = checked/open, U = last edit time in ms (the server merges edits block by block using it).
/// </summary>
public sealed class Block
{
    [JsonPropertyName("id")] public string Id { get; set; } = Guid.NewGuid().ToString();
    [JsonPropertyName("t")] public string T { get; set; } = "p";
    [JsonPropertyName("x")] public string X { get; set; } = "";
    [JsonPropertyName("ind")] public int? Ind { get; set; }
    [JsonPropertyName("c")] public bool? C { get; set; }
    [JsonPropertyName("lang")] public string? Lang { get; set; }
    [JsonPropertyName("src")] public string? Src { get; set; }
    [JsonPropertyName("cap")] public string? Cap { get; set; }
    [JsonPropertyName("col")] public string? Col { get; set; }
    [JsonPropertyName("u")] public long U { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    [JsonIgnore] public bool Checked => C == true;
    [JsonIgnore] public int Indent => Ind ?? 0;

    public Block Clone() => (Block)MemberwiseClone();
    public void Touch() => U = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

public sealed record OpenTask(string NoteId, string NoteTitle, string BlockId, string Text, string? Due);

public static partial class Blocks
{
    public static readonly HashSet<string> TextTypes = ["p", "h1", "h2", "h3", "todo", "ul", "ol", "quote", "callout", "toggle", "code"];
    public static readonly HashSet<string> KeepOnEnter = ["todo", "ul", "ol"];

    public static readonly JsonSerializerOptions Json = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static List<Block> Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        try { return JsonSerializer.Deserialize<List<Block>>(raw, Json) ?? []; } catch (JsonException) { return []; }
    }

    public static string Encode(IEnumerable<Block> blocks) => JsonSerializer.Serialize(blocks, Json);

    [GeneratedRegex(@"\[([^\]]*)\]\([^)]*\)")] private static partial Regex LinkRe();
    [GeneratedRegex(@"(?<!\*)\*(?!\*)")] private static partial Regex SingleStarRe();
    [GeneratedRegex(@"@(\d{4}-\d{2}-\d{2})")] private static partial Regex DueRe();
    [GeneratedRegex(@"\(note:([0-9a-f-]{36})\)")] private static partial Regex NoteLinkRe();

    public static string InlineToPlain(string x) =>
        SingleStarRe().Replace(LinkRe().Replace(x, "$1").Replace("**", "").Replace("~~", "").Replace("`", ""), "");

    public static string Plain(IEnumerable<Block> blocks) => string.Join("\n",
        blocks.Where(b => b.T != "hr").Select(b => InlineToPlain(b.X) + (b.Cap is { } c ? " " + c : "")).Where(l => !string.IsNullOrWhiteSpace(l)));

    /// <summary>Markdown-ish text (pasted, imported or typed in the scratch pad) to blocks.</summary>
    public static List<Block> FromMarkdown(string md)
    {
        var outList = new List<Block>();
        List<string>? code = null;
        foreach (var line in md.Replace("\r", "").Split('\n'))
        {
            if (code != null)
            {
                if (line.TrimStart().StartsWith("```")) { outList.Add(new Block { T = "code", X = string.Join("\n", code) }); code = null; }
                else code.Add(line);
                continue;
            }
            if (line.TrimStart().StartsWith("```")) { code = []; continue; }
            if (string.IsNullOrWhiteSpace(line)) continue;
            int lead = line.Length - line.TrimStart().Length;
            int? ind = Math.Min(8, lead / 2) is var i && i > 0 ? i : null;
            var t = line.Trim();
            Match m;
            if (t.StartsWith("### ")) outList.Add(new Block { T = "h3", X = t[4..] });
            else if (t.StartsWith("## ")) outList.Add(new Block { T = "h2", X = t[3..] });
            else if (t.StartsWith("# ")) outList.Add(new Block { T = "h1", X = t[2..] });
            else if ((m = Regex.Match(t, @"^[-*+]\s+\[([ xX])\]\s*(.*)$")).Success) outList.Add(new Block { T = "todo", X = m.Groups[2].Value, C = m.Groups[1].Value.Trim().Length > 0 ? true : null, Ind = ind });
            else if ((m = Regex.Match(t, @"^[-*+•]\s+(.*)$")).Success) outList.Add(new Block { T = "ul", X = m.Groups[1].Value, Ind = ind });
            else if ((m = Regex.Match(t, @"^\d+[.)]\s+(.*)$")).Success) outList.Add(new Block { T = "ol", X = m.Groups[1].Value, Ind = ind });
            else if (t.StartsWith("> ")) outList.Add(new Block { T = "quote", X = t[2..] });
            else if (t == "---") outList.Add(new Block { T = "hr" });
            else outList.Add(new Block { T = "p", X = t, Ind = ind });
        }
        if (code != null) outList.Add(new Block { T = "code", X = string.Join("\n", code) });
        return outList;
    }

    /// <summary>"# ", "- ", "[] " … typed at the start of a text block: the new type and the prefix length.</summary>
    public static (string Type, int Length)? Shortcut(string text)
    {
        (string, string)[] rules = [("### ", "h3"), ("## ", "h2"), ("# ", "h1"), ("- ", "ul"), ("* ", "ul"), ("1. ", "ol"), ("[] ", "todo"),
            ("[ ] ", "todo"), ("> ", "quote"), ("```", "code"), ("! ", "callout"), ("|> ", "toggle")];
        foreach (var (prefix, type) in rules) if (text.StartsWith(prefix)) return (type, prefix.Length);
        return null;
    }

    public static List<OpenTask> OpenTasks(string noteId, string title, IEnumerable<Block> blocks) =>
        blocks.Where(b => b.T == "todo" && !b.Checked && !string.IsNullOrWhiteSpace(b.X))
            .Select(b => new OpenTask(noteId, title, b.Id, InlineToPlain(b.X), DueRe().Match(b.X) is { Success: true } m ? m.Groups[1].Value : null)).ToList();

    public static string StripDue(string text) => DueRe().Replace(text, "").Trim();

    public static HashSet<string> Links(IEnumerable<Block> blocks)
    {
        var ids = new HashSet<string>();
        foreach (var b in blocks)
        {
            foreach (Match m in NoteLinkRe().Matches(b.X)) ids.Add(m.Groups[1].Value);
            if (b.T == "page" && b.Src != null) ids.Add(b.Src);
        }
        return ids;
    }

    /// <summary>Scratch-pad style editing: reuse block ids line by line so edits on other devices merge instead of replacing.</summary>
    public static List<Block> ReuseIds(List<Block> fresh, List<Block> old)
    {
        for (int i = 0; i < fresh.Count && i < old.Count; i++)
        {
            fresh[i].Id = old[i].Id;
            fresh[i].U = old[i].T == fresh[i].T && old[i].X == fresh[i].X ? old[i].U : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
        return fresh;
    }

    public static string ToMarkdownLines(IEnumerable<Block> blocks)
    {
        int n = 0;
        return string.Join("\n", blocks.Select(b =>
        {
            n = b.T == "ol" ? n + 1 : 0;
            var pad = new string(' ', b.Indent * 2);
            return b.T switch
            {
                "todo" => $"{pad}- [{(b.Checked ? "x" : " ")}] ", "ul" => $"{pad}- ", "ol" => $"{pad}{n}. ",
                "h1" => "# ", "h2" => "## ", "h3" => "### ", "quote" => "> ", _ => pad,
            } + b.X;
        }));
    }
}
