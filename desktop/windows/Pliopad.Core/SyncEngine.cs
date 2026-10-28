using System.Text.Json.Nodes;

namespace Pliopad.Core;

/// <summary>
/// Two-way sync for one workspace, the same protocol as the Android app:
/// 1. upload images that are still local, 2. push dirty rows (each note carries the server version it was based on, so the
/// server merges concurrent edits block by block), 3. pull everything newer than our sequence number.
/// </summary>
public sealed class SyncEngine(Store store, Api api)
{
    public async Task<int> Run(long ws)
    {
        await UploadPending(ws);
        await Push(ws);
        return await Pull(ws);
    }

    private async Task UploadPending(long ws)
    {
        foreach (var n in store.DirtyNotes(ws))
        {
            if (!n.Content.Contains("\"local:")) continue;
            var uploaded = new Dictionary<string, string>();
            foreach (var b in Blocks.Parse(n.Content))
            {
                if (b.Src is not { } src || !src.StartsWith("local:")) continue;
                var path = src["local:".Length..];
                if (!File.Exists(path)) continue;
                var mime = Path.GetExtension(path).ToLowerInvariant() switch { ".png" => "image/png", ".gif" => "image/gif", ".webp" => "image/webp", ".jpg" or ".jpeg" => "image/jpeg", _ => "application/octet-stream" };
                uploaded[b.Id] = (await api.UploadFile(ws, path, mime, n.Id)).Url;
            }
            if (uploaded.Count == 0) continue;
            // Only replace the sources, keeping any edits made while uploading.
            var fresh = store.Note(n.Id);
            if (fresh == null) continue;
            var blocks = Blocks.Parse(fresh.Content);
            foreach (var b in blocks) if (uploaded.TryGetValue(b.Id, out var url)) { b.Src = url; b.Touch(); }
            fresh.Content = Blocks.Encode(blocks);
            store.SaveLocal(fresh, touch: false);
        }
    }

    private async Task Push(long ws)
    {
        var notes = store.DirtyNotes(ws);
        var notebooks = store.DirtyNotebooks(ws);
        var tags = store.DirtyTags(ws);
        if (notes.Count == 0 && notebooks.Count == 0 && tags.Count == 0) return;
        var body = new JsonObject
        {
            ["notebooks"] = new JsonArray(notebooks.Select(nb => (JsonNode)new JsonObject
            {
                ["id"] = nb.Id, ["name"] = nb.Name, ["stack"] = nb.Stack, ["icon"] = nb.Icon, ["sort"] = nb.Sort, ["deleted"] = nb.Deleted,
            }).ToArray()),
            ["tags"] = new JsonArray(tags.Select(t => (JsonNode)new JsonObject { ["id"] = t.Id, ["name"] = t.Name, ["color"] = t.Color, ["deleted"] = t.Deleted }).ToArray()),
            ["notes"] = new JsonArray(notes.Select(n => (JsonNode)Api.NoteToJson(n)).ToArray()),
        };
        var res = await api.Push(ws, body);
        var ok = res.Notes.ToHashSet();
        foreach (var n in notes)
        {
            if (!ok.Contains(n.Id)) continue;
            if (n.Deleted) store.DeleteNote(n.Id); else store.MarkClean(n.Id, n.Rev);
        }
        if (notebooks.Count > 0) store.CleanNotebooks(notebooks.Select(x => x.Id));
        if (tags.Count > 0) store.CleanTags(tags.Select(x => x.Id));
    }

    private async Task<int> Pull(long ws)
    {
        var seq = store.Seq(ws);
        int changed = 0;
        SyncPull r;
        do
        {
            r = await api.Pull(ws, seq);
            foreach (var nb in r.Notebooks)
                store.UpsertNotebook(new Notebook { Id = nb.Id, WsId = ws, Name = nb.Name, Stack = nb.Stack, Icon = nb.Icon, Sort = nb.Sort, Deleted = nb.Deleted });
            foreach (var t in r.Tags) store.UpsertTag(new Tag { Id = t.Id, WsId = ws, Name = t.Name, Color = t.Color, Deleted = t.Deleted });
            foreach (var s in r.Notes)
            {
                var local = store.Note(s.Id);
                if (s.Deleted) store.DeleteNote(s.Id);
                // Local edits win for now; they are pushed against the old base, and the server merges them.
                else if (local?.Dirty == true) continue;
                else store.UpsertNote(s.ToLocal(ws));
                changed++;
            }
            seq = r.Seq;
            store.SaveSeq(ws, seq);
        } while (r.More);
        return changed;
    }
}
