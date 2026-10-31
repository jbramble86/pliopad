using System.Text.Json.Nodes;

namespace Pliopad.Core;

/// <summary>
/// The Home layout: which sections show, in what order. Saved to the account (prefs.home), so web, Windows and
/// Android all show the same Home; a copy is kept on this PC for offline.
/// </summary>
public sealed record HomeLayout(List<string> Order, HashSet<string> Hidden)
{
    public static readonly (string Key, string Label)[] Sections =
        [("actions", "Quick actions"), ("recent", "Jump back in"), ("scratch", "Quick jot"), ("tasks", "Tasks"), ("shortcuts", "Pinned"),
         ("reminders", "Reminders"), ("notebooks", "Notebooks"), ("updated", "Recently edited")];

    /// <summary>Full-width sections; the rest sit side by side in columns.</summary>
    public static readonly HashSet<string> Wide = ["actions", "recent"];

    public static HomeLayout Default => new(Sections.Select(s => s.Key).ToList(), []);

    public static string Label(string key) => Sections.FirstOrDefault(s => s.Key == key).Label ?? key;

    /// <summary>Every known section once, in order; unknown keys dropped, new ones appended.</summary>
    public static HomeLayout Normalize(IEnumerable<string> order, IEnumerable<string> hidden)
    {
        static string Key(string k) => k == "edited" ? "updated" : k; // older Android builds
        var known = Sections.Select(s => s.Key).ToHashSet();
        return new(order.Select(Key).Where(known.Contains).Concat(Sections.Select(s => s.Key)).Distinct().ToList(),
            hidden.Select(Key).Where(known.Contains).ToHashSet());
    }

    public static HomeLayout? FromPrefs(JsonObject? prefs)
    {
        if (prefs?["home"] is not JsonObject home) return null;
        static IEnumerable<string> List(JsonNode? n) => n is JsonArray a ? a.Select(x => (string?)x).OfType<string>() : [];
        return Normalize(List(home["order"]), List(home["hidden"]));
    }

    public JsonObject ToJson() => new()
    {
        ["order"] = new JsonArray(Order.Select(k => (JsonNode?)k).ToArray()),
        ["hidden"] = new JsonArray(Hidden.Select(k => (JsonNode?)k).ToArray()),
    };

    /// <summary>The visible sections grouped for layout: each wide section alone, runs of the others together.</summary>
    public List<List<string>> Groups()
    {
        var groups = new List<List<string>>();
        foreach (var k in Order.Where(k => !Hidden.Contains(k)))
            if (groups.Count == 0 || Wide.Contains(k) || Wide.Contains(groups[^1][0])) groups.Add([k]);
            else groups[^1].Add(k);
        return groups;
    }
}
