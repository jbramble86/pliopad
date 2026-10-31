namespace Pliopad.Core;

/// <summary>
/// PlioSphere: notes as points in a 3D sphere, links as threads. The same deterministic layout as the Android
/// app and the web, so a workspace looks alike everywhere.
/// </summary>
public sealed class Sphere
{
    public sealed class Node(string id, string title, string? group)
    {
        public string Id { get; } = id;
        public string Title { get; } = title;
        public string? Group { get; } = group;
        public float X, Y, Z;
        public int Degree;
        internal float Vx, Vy, Vz;
    }

    /// <summary>A node at the current rotation: screen position, perspective scale and depth (0 back … 1 front).</summary>
    public readonly record struct Projected(int Index, float X, float Y, float Scale, float Depth);

    public List<Node> Nodes { get; } = [];
    public List<(int A, int B)> Edges { get; } = [];
    public List<HashSet<int>> Neighbors { get; } = [];
    /// <summary>Links PlioPad discovered by itself (drawn dashed), with the reason.</summary>
    public List<(int A, int B, string Why)> Discovered { get; } = [];
    /// <summary>Per note: the notes PlioPad connected it to, and why.</summary>
    public List<List<(int Other, string Why)>> DiscoveredOf { get; } = [];

    /// <summary>Builds the sphere from notes: [[links]] and sub-pages become threads; best-linked notes come first.</summary>
    public static Sphere Build(IEnumerable<Note> notes, int maxNodes = 300, IReadOnlyDictionary<string, string>? tagNames = null)
    {
        var list = notes.ToList();
        var ids = list.Select(n => n.Id).ToHashSet();
        var links = new HashSet<(string, string)>();
        foreach (var n in list)
        {
            foreach (var to in Blocks.Links(Blocks.Parse(n.Content)))
                if (to != n.Id && ids.Contains(to)) links.Add(string.CompareOrdinal(n.Id, to) < 0 ? (n.Id, to) : (to, n.Id));
            if (n.ParentId != null && ids.Contains(n.ParentId))
                links.Add(string.CompareOrdinal(n.Id, n.ParentId) < 0 ? (n.Id, n.ParentId) : (n.ParentId, n.Id));
        }
        var degree = new Dictionary<string, int>();
        foreach (var (a, b) in links) { degree[a] = degree.GetValueOrDefault(a) + 1; degree[b] = degree.GetValueOrDefault(b) + 1; }
        var chosen = list.OrderByDescending(n => degree.GetValueOrDefault(n.Id)).ThenByDescending(n => n.UpdatedAt).Take(maxNodes).ToList();
        var s = new Sphere();
        foreach (var n in chosen) s.Nodes.Add(new Node(n.Id, (n.Icon != null ? n.Icon + " " : "") + n.DisplayTitle, n.NotebookId));
        var index = s.Nodes.Select((n, i) => (n.Id, i)).ToDictionary(x => x.Id, x => x.i);
        foreach (var (a, b) in links)
            if (index.TryGetValue(a, out var i) && index.TryGetValue(b, out var j)) { s.Edges.Add((i, j)); s.Nodes[i].Degree++; s.Nodes[j].Degree++; }
        foreach (var _ in s.Nodes) s.Neighbors.Add([]);
        foreach (var (a, b) in s.Edges) { s.Neighbors[a].Add(b); s.Neighbors[b].Add(a); }
        // Links PlioPad finds by itself: mentions of other notes, shared tags, similar wording.
        var docs = chosen.Select(n => new Related.Doc(n.Id, n.Title, n.Plain, n.TagIds)).ToList();
        var linkedIds = links.Select(l => $"{l.Item1}|{l.Item2}").ToHashSet();
        foreach (var l in Related.Find(docs, linkedIds, tagNames))
            if (index.TryGetValue(l.A, out var i) && index.TryGetValue(l.B, out var j)) s.Discovered.Add((i, j, l.Why));
        foreach (var _ in s.Nodes) s.DiscoveredOf.Add([]);
        foreach (var (a, b, why) in s.Discovered) { s.DiscoveredOf[a].Add((b, why)); s.DiscoveredOf[b].Add((a, why)); }
        s.Layout();
        return s;
    }

    private void Layout()
    {
        var nodes = Nodes;
        if (nodes.Count == 0) return;
        var rnd = new Random(nodes.Aggregate(7, (h, n) => unchecked(h * 31 + n.Id.Aggregate(0, (a, c) => a + c))));
        var golden = Math.PI * (3 - Math.Sqrt(5));
        for (int i = 0; i < nodes.Count; i++)
        {
            var y = 1 - (i + 0.5) / nodes.Count * 2;
            var r = Math.Sqrt(1 - y * y);
            var t = golden * i + rnd.NextDouble() * 0.3;
            nodes[i].X = (float)(Math.Cos(t) * r * 300); nodes[i].Y = (float)(y * 300); nodes[i].Z = (float)(Math.Sin(t) * r * 300);
        }
        // Hand-made and discovered links both pull notes together.
        var springs = Edges.Concat(Discovered.Select(d => (d.A, d.B))).ToList();
        int iterations = nodes.Count > 120 ? 200 : 300;
        for (int step = 0; step < iterations; step++)
        {
            var cool = 1f - step / (float)iterations * 0.85f;
            for (int i = 0; i < nodes.Count; i++)
                for (int j = i + 1; j < nodes.Count; j++)
                {
                    var a = nodes[i]; var b = nodes[j];
                    float dx = a.X - b.X, dy = a.Y - b.Y, dz = a.Z - b.Z;
                    var d2 = Math.Max(dx * dx + dy * dy + dz * dz, 1f); var d = MathF.Sqrt(d2); var f = 9000f / d2;
                    dx /= d; dy /= d; dz /= d;
                    a.Vx += dx * f; a.Vy += dy * f; a.Vz += dz * f; b.Vx -= dx * f; b.Vy -= dy * f; b.Vz -= dz * f;
                }
            foreach (var (ia, ib) in springs)
            {
                var a = nodes[ia]; var b = nodes[ib];
                float dx = b.X - a.X, dy = b.Y - a.Y, dz = b.Z - a.Z;
                var d = Math.Max(MathF.Sqrt(dx * dx + dy * dy + dz * dz), 1f); var f = (d - 90f) * 0.03f;
                a.Vx += dx / d * f; a.Vy += dy / d * f; a.Vz += dz / d * f; b.Vx -= dx / d * f; b.Vy -= dy / d * f; b.Vz -= dz / d * f;
            }
            foreach (var n in nodes)
            {
                n.Vx -= n.X * 0.004f; n.Vy -= n.Y * 0.004f; n.Vz -= n.Z * 0.004f;
                n.Vx *= 0.75f; n.Vy *= 0.75f; n.Vz *= 0.75f;
                n.X += n.Vx * cool; n.Y += n.Vy * cool; n.Z += n.Vz * cool;
            }
        }
        float cx = nodes.Average(n => n.X), cy = nodes.Average(n => n.Y), cz = nodes.Average(n => n.Z);
        var far = Math.Max(1f, nodes.Max(n => MathF.Sqrt((n.X - cx) * (n.X - cx) + (n.Y - cy) * (n.Y - cy) + (n.Z - cz) * (n.Z - cz))));
        foreach (var n in nodes) { n.X = (n.X - cx) / far; n.Y = (n.Y - cy) / far; n.Z = (n.Z - cz) / far; }
    }

    /// <summary>Rotates (yaw, then pitch) and projects with perspective into a w×h area; sorted back to front.</summary>
    public List<Projected> Project(float w, float h, float yaw, float pitch, float zoom)
    {
        float cyw = MathF.Cos(yaw), syw = MathF.Sin(yaw), cp = MathF.Cos(pitch), sp = MathF.Sin(pitch);
        var radius = Math.Min(w, h) * 0.40f * zoom;
        const float camera = 3.2f;
        var list = new List<Projected>(Nodes.Count);
        for (int i = 0; i < Nodes.Count; i++)
        {
            var n = Nodes[i];
            var x1 = n.X * cyw + n.Z * syw;
            var z1 = -n.X * syw + n.Z * cyw;
            var y2 = n.Y * cp - z1 * sp;
            var z2 = n.Y * sp + z1 * cp;
            var s = camera / (camera - z2);
            list.Add(new Projected(i, w / 2 + x1 * radius * s, h / 2 + y2 * radius * s, s, Math.Clamp((z2 + 1f) / 2f, 0f, 1f)));
        }
        list.Sort((a, b) => a.Depth.CompareTo(b.Depth));
        return list;
    }

    /// <summary>Dot radius in pixels before perspective: larger for well-linked notes.</summary>
    public static float Radius(Node n) => 3.5f + MathF.Sqrt(n.Degree) * 2.4f;
}
