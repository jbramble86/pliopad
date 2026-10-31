using System.Text.RegularExpressions;

namespace Pliopad.Core;

/// <summary>
/// Discovered links for PlioSphere: connections PlioPad finds on its own, beside the links people make with [[.
/// Signals, strongest first: one note mentions another's title; notes share tags; notes use the same distinctive
/// words (TF-IDF cosine similarity). Runs on this PC, offline. Same algorithm as the server's related.js.
/// </summary>
public static partial class Related
{
    public sealed record Doc(string Id, string Title, string Text, IReadOnlyList<string> Tags);
    public sealed record Link(string A, string B, double Score, string Why);

    private static readonly HashSet<string> Stop = ("a about above after again against all also am an and any are as at be because been before being below between both but by can " +
        "could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself " +
        "just let me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their " +
        "them then there these they this those through to too under until up very was we were what when where which while who whom why will with would " +
        "you your yours new note notes page pages todo done get got make made use used one two also via per etc yes okay ok").Split(' ').ToHashSet();
    private const int MaxTerms = 30, PerNote = 3;
    private const double MinScore = 0.22;

    [GeneratedRegex(@"[a-zÀ-ɏ][a-zÀ-ɏ0-9'-]{2,}")] private static partial Regex WordRe();

    private static List<string> Tokens(string text) =>
        WordRe().Matches(text.ToLowerInvariant()).Select(m => m.Value.EndsWith("'s") ? m.Value[..^2] : m.Value).Where(w => !Stop.Contains(w)).ToList();

    private sealed class Pair(int i, int j) { public int I = i, J = j; public double Score; public List<string> Words = []; public List<string> Why = []; }

    public static List<Link> Find(IReadOnlyList<Doc> notes, ISet<string>? linked = null, IReadOnlyDictionary<string, string>? tagNames = null)
    {
        int n = notes.Count;
        if (n < 2) return [];
        var df = new Dictionary<string, int>();
        var tfs = notes.Select(d =>
        {
            var tf = new Dictionary<string, int>();
            foreach (var w in Tokens(d.Title)) tf[w] = tf.GetValueOrDefault(w) + 3;
            foreach (var w in Tokens(d.Text.Length > 20000 ? d.Text[..20000] : d.Text)) tf[w] = tf.GetValueOrDefault(w) + 1;
            foreach (var w in tf.Keys) df[w] = df.GetValueOrDefault(w) + 1;
            return tf;
        }).ToList();
        var common = Math.Max(3.0, n * 0.5);
        var vecs = tfs.Select(tf =>
        {
            var v = tf.Select(kv => (W: kv.Key, X: (1 + Math.Log(kv.Value)) * Math.Log((n + 1.0) / (df.GetValueOrDefault(kv.Key, 1) + 0.5))))
                .Where(t => t.X > 0 && df.GetValueOrDefault(t.W) < common).OrderByDescending(t => t.X).Take(MaxTerms).ToList();
            var norm = Math.Sqrt(v.Sum(t => t.X * t.X)); if (norm <= 0) norm = 1;
            return v.ToDictionary(t => t.W, t => t.X / norm);
        }).ToList();
        var postings = new Dictionary<string, List<int>>();
        for (int i = 0; i < vecs.Count; i++) foreach (var w in vecs[i].Keys) (postings.TryGetValue(w, out var l) ? l : postings[w] = []).Add(i);
        var pairs = new Dictionary<long, Pair>();
        Pair At(int x, int y) { int i = Math.Min(x, y), j = Math.Max(x, y); long k = (long)i * 1_000_000 + j; return pairs.TryGetValue(k, out var p) ? p : pairs[k] = new Pair(i, j); }
        foreach (var (w, list) in postings)
        {
            if (list.Count > 60) continue;
            for (int x = 0; x < list.Count; x++)
                for (int y = x + 1; y < list.Count; y++) { var p = At(list[x], list[y]); p.Score += vecs[list[x]][w] * vecs[list[y]][w]; p.Words.Add(w); }
        }
        var byTag = new Dictionary<string, List<int>>();
        for (int i = 0; i < n; i++) foreach (var t in notes[i].Tags) (byTag.TryGetValue(t, out var l) ? l : byTag[t] = []).Add(i);
        foreach (var (t, list) in byTag)
        {
            if (list.Count > 40) continue;
            for (int x = 0; x < list.Count; x++)
                for (int y = x + 1; y < list.Count; y++) { var p = At(list[x], list[y]); p.Score += 0.35; p.Why.Add("#" + (tagNames?.GetValueOrDefault(t) ?? "tag")); }
        }
        var titles = notes.Select((d, i) => (I: i, T: d.Title.Trim().ToLowerInvariant())).Where(x => x.T.Length >= 4 && Tokens(x.T).Count > 0).ToList();
        for (int i = 0; i < n; i++)
        {
            var text = notes[i].Text.ToLowerInvariant();
            if (text.Length == 0) continue;
            foreach (var (j, t) in titles)
            {
                if (j == i) continue;
                var k = text.IndexOf(t, StringComparison.Ordinal);
                if (k < 0) continue;
                if ((k > 0 && char.IsLetterOrDigit(text[k - 1])) || (k + t.Length < text.Length && char.IsLetterOrDigit(text[k + t.Length]))) continue;
                var p = At(i, j); p.Score += 1; p.Why.Insert(0, $"Mentions “{notes[j].Title}”");
            }
        }
        var best = new Dictionary<int, List<Pair>>();
        foreach (var p in pairs.Values)
        {
            if (p.Score < MinScore) continue;
            string a = notes[p.I].Id, b = notes[p.J].Id;
            if (linked != null && (linked.Contains($"{a}|{b}") || linked.Contains($"{b}|{a}"))) continue;
            (best.TryGetValue(p.I, out var l1) ? l1 : best[p.I] = []).Add(p);
            (best.TryGetValue(p.J, out var l2) ? l2 : best[p.J] = []).Add(p);
        }
        var keep = new HashSet<Pair>();
        foreach (var list in best.Values) foreach (var p in list.OrderByDescending(p => p.Score).Take(PerNote)) keep.Add(p);
        return keep.OrderByDescending(p => p.Score).Select(p =>
        {
            var words = p.Words.OrderByDescending(w => vecs[p.I].GetValueOrDefault(w)).Take(3);
            return new Link(notes[p.I].Id, notes[p.J].Id, p.Score, p.Why.Count > 0 ? string.Join(" · ", p.Why.Take(2)) : "Similar: " + string.Join(", ", words));
        }).ToList();
    }
}
