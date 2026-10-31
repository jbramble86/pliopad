using Pliopad.Core;

// `seed <dataDir> <server>`: signs a fresh test account into a data folder, for launching the app against a dev server.
if (args is ["seed", var seedDir, var seedServer])
{
    var repo = new Repo(seedDir);
    await repo.SignUp(seedServer, "Jordan Tester", $"desk-{Guid.NewGuid():N}"[..13] + "@example.test", "correct-horse-battery-9");
    var work = repo.Notebooks().FirstOrDefault(n => n.Name == "Work")?.Id ?? repo.CreateNotebook("Work", null);
    repo.SetNotebookStack(work, "Projects");
    repo.CreateNotebook("Clients", "Projects", "💼");
    repo.CreateNotebook("Recipes", null, "🍳");
    var today = DateTime.Today;
    var plan = repo.CreateNote("Q4 launch plan", Blocks.FromMarkdown(
        $"## Goals\nShip the **desktop apps** and grow *weekly actives* by 20%.\n- [ ] Finish Windows beta @{today:yyyy-MM-dd}\n- [ ] Record demo video @{today.AddDays(3):yyyy-MM-dd}\n- [x] Pick pricing\n- [ ] Write launch post @{today.AddDays(-1):yyyy-MM-dd}\n## Notes\n> Keep it fast. Keep it calm.\n1. Beta\n2. Feedback\n3. Launch\n```\npliopad --sync\n```"), work);
    repo.SetPinned(plan, true);
    repo.SetReminder(plan, DateTimeOffset.UtcNow.AddHours(3).ToUnixTimeMilliseconds());
    var tag = repo.CreateTag("launch");
    repo.SetTags(plan, [tag]);
    repo.CreateNote("Weekly sync", Blocks.FromMarkdown($"Discussed the roadmap with the team.\n- [ ] Send notes to [Q4 launch plan](note:{plan})"), work);
    await repo.SyncNow();
    Console.WriteLine("seeded: " + repo.SyncStatus);
    return 0;
}

// `pending <dataDir> <outFile>`: writes what the next push would send, one note per line (for diagnosing proxies/firewalls).
if (args is ["pending", var pDir, var pOut])
{
    var repo = new Repo(pDir);
    var lines = repo.Store.DirtyNotes(repo.WsId).Select(n => Api.NoteToJson(n).ToJsonString()).ToList();
    lines.Insert(0, $"ws={repo.WsId} server={repo.Server} dirtyNotebooks={repo.Store.DirtyNotebooks(repo.WsId).Count} dirtyTags={repo.Store.DirtyTags(repo.WsId).Count}");
    File.WriteAllLines(pOut, lines);
    return 0;
}

int failed = 0, passed = 0;
async Task Test(string name, Func<Task> body)
{
    try { await body(); passed++; Console.WriteLine("ok   " + name); }
    catch (Exception e) { failed++; Console.WriteLine("FAIL " + name + ": " + e.Message); }
}
void Eq<T>(T expected, T actual, string what = "") { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"{what} expected <{expected}> got <{actual}>"); }
void True(bool v, string what) { if (!v) throw new Exception(what); }

string TempDir() { var d = Path.Combine(Path.GetTempPath(), "pliopad-test-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }

await Test("blocks round trip keeps ids and edit times", async () =>
{
    var b = new Block { T = "todo", X = "Ship it @2026-11-01", C = true, U = 42 };
    var back = Blocks.Parse(Blocks.Encode([b]))[0];
    Eq(b.Id, back.Id); Eq(42L, back.U); Eq("todo", back.T); True(back.Checked, "checked");
    True(!Blocks.Encode([new Block()]).Contains("\"ind\""), "nulls omitted");
    await Task.CompletedTask;
});

await Test("markdown import", async () =>
{
    var b = Blocks.FromMarkdown("# Title\n- [x] done\n  - child\n1. one\n```\ncode\n```\n> q");
    Eq("h1,todo,ul,ol,code,quote", string.Join(",", b.Select(x => x.T)));
    True(b[1].Checked, "todo checked"); Eq(1, b[2].Indent, "indent"); Eq("code", b[4].X);
    await Task.CompletedTask;
});

await Test("shortcuts, plain text, tasks and links", async () =>
{
    Eq(("h2", 3), Blocks.Shortcut("## x")!.Value);
    Eq(null, Blocks.Shortcut("hello"));
    Eq("bold link", Blocks.InlineToPlain("**bold** [link](note:x)"));
    var id = Guid.NewGuid().ToString();
    var blocks = new List<Block> { new() { T = "todo", X = "Call @2026-01-02" }, new() { T = "todo", X = "x", C = true }, new() { T = "p", X = $"see [n](note:{id})" } };
    var tasks = Blocks.OpenTasks("n", "Note", blocks);
    Eq(1, tasks.Count); Eq("2026-01-02", tasks[0].Due);
    True(Blocks.Links(blocks).Contains(id), "link found");
    await Task.CompletedTask;
});

await Test("scratch pad reuses block ids line by line", async () =>
{
    var old = Blocks.FromMarkdown("a\nb");
    var fresh = Blocks.ReuseIds(Blocks.FromMarkdown("a\nc\nd"), old);
    Eq(old[0].Id, fresh[0].Id); Eq(old[0].U, fresh[0].U); Eq(old[1].Id, fresh[1].Id);
    Eq("a\n- [ ] t", Blocks.ToMarkdownLines(Blocks.FromMarkdown("a\n- [ ] t")));
    await Task.CompletedTask;
});

await Test("PlioSphere discovers links: mentions, shared tags, similar wording", async () =>
{
    var docs = new List<Related.Doc>
    {
        new("trip", "Trip to Lisbon", "Flights booked. Find a venue near Alfama for the team dinner, check the budget.", []),
        new("dinner", "Team dinner", "Venue shortlist in Alfama, budget per head, dietary needs.", []),
        new("plan", "Q4 plan", "Goals for the quarter. See the Trip to Lisbon for the offsite.", []),
        new("gym", "Gym", "Squats, deadlifts, rows.", ["t1"]),
        new("run", "Running", "Intervals on Tuesday.", ["t1"]),
        new("linked", "Already linked", "Venue budget Alfama dinner", []),
    };
    var found = Related.Find(docs, new HashSet<string> { "linked|dinner" }, new Dictionary<string, string> { ["t1"] = "fitness" });
    Related.Link? Has(string a, string b) => found.FirstOrDefault(l => (l.A == a && l.B == b) || (l.A == b && l.B == a));
    True(Has("trip", "dinner") != null, "similar wording");
    True(Has("plan", "trip")?.Why.Contains("Mentions “Trip to Lisbon”") == true, "mention");
    True(Has("gym", "run")?.Why.Contains("#fitness") == true, "shared tag");
    True(Has("linked", "dinner") == null && Has("gym", "trip") == null, "no hand-made or unrelated pairs");
    await Task.CompletedTask;
});

await Test("home layout: account order, old keys, new sections, grouping", async () =>
{
    var prefs = System.Text.Json.Nodes.JsonNode.Parse("{\"home\":{\"order\":[\"tasks\",\"recent\",\"edited\",\"gone\"],\"hidden\":[\"edited\"]}}") as System.Text.Json.Nodes.JsonObject;
    var l = HomeLayout.FromPrefs(prefs)!;
    Eq("tasks,recent,updated,actions,scratch,shortcuts,reminders,notebooks", string.Join(",", l.Order), "order");
    True(l.Hidden.SetEquals(["updated"]), "old key mapped");
    Eq("tasks|recent|actions|scratch,shortcuts,reminders,notebooks", string.Join("|", l.Groups().Select(g => string.Join(",", g))), "groups");
    Eq(null, HomeLayout.FromPrefs(null), "no account layout");
    await Task.CompletedTask;
});

await Test("store: local edits are dirty, notebooks and stacks", async () =>
{
    var repo = new Repo(TempDir());
    typeof(Repo).GetProperty("WsId")!.SetValue(repo, 7L);
    var nb = repo.CreateNotebook("Work", "Projects");
    var id = repo.CreateNote("Hello", Blocks.FromMarkdown("- [ ] one"), nb);
    var n = repo.Note(id)!;
    True(n.Dirty, "dirty"); Eq(nb, n.NotebookId); Eq("one", n.Plain);
    Eq(1, repo.OpenTasks().Count);
    repo.ToggleTask(id, Blocks.Parse(n.Content)[0].Id);
    Eq(0, repo.OpenTasks().Count);
    repo.RenameStack("Projects", "Clients");
    Eq("Clients", repo.Notebooks().Single().Stack);
    Eq(1, repo.Search("hello").Count); Eq(1, repo.Search("notebook:work").Count); Eq(0, repo.Search("missing").Count);
    var daily = repo.DailyNote();
    Eq(daily, repo.DailyNote(), "daily note reused");
    repo.Trash(id);
    True(repo.Notes().All(x => x.Id != id), "trashed hidden");
    repo.DeleteNotebook(nb);
    True(repo.Notebooks().All(x => x.Id != nb), "notebook gone");
    await Task.CompletedTask;
});

var server = Environment.GetEnvironmentVariable("PLIOPAD_TEST_SERVER");
if (server != null)
{
    await Test("sync round trip with a second device and block merge", async () =>
    {
        var email = $"win-{Guid.NewGuid():N}@example.test";
        var a = new Repo(TempDir());
        await a.SignUp(server, "Windows Tester", email, "correct-horse-battery-9");
        True(a.SignedIn, "signed in");
        var seeded = a.Notes().Count;
        True(seeded > 0, "pulled the starter content");

        var id = a.CreateNote("From Windows", Blocks.FromMarkdown("first\nsecond"));
        await a.SyncNow();
        True(!a.Note(id)!.Dirty, "pushed: " + a.SyncStatus);

        // A second PC signs in, sees the note, and both edit different blocks while offline.
        var b = new Repo(TempDir());
        await b.SignIn(server, email, "correct-horse-battery-9", null);
        var nb = b.Note(id) ?? throw new Exception("second device did not get the note");
        var ba = Blocks.Parse(nb.Content); ba[1].X = "second (edited on B)"; ba[1].Touch();
        b.SaveContent(id, nb.Title, ba);
        await Task.Delay(5);
        var aa = Blocks.Parse(a.Note(id)!.Content); aa[0].X = "first (edited on A)"; aa[0].Touch();
        a.SaveContent(id, "From Windows", aa);

        await b.SyncNow();
        await a.SyncNow();
        await b.SyncNow();
        var finalA = Blocks.Parse(a.Note(id)!.Content).Select(x => x.X).ToList();
        var finalB = Blocks.Parse(b.Note(id)!.Content).Select(x => x.X).ToList();
        Eq("first (edited on A)|second (edited on B)", string.Join("|", finalA), "A merged");
        Eq(string.Join("|", finalA), string.Join("|", finalB), "B matches");

        // Notebooks, stacks and trash sync too.
        var nbId = a.CreateNotebook("Desk", "Office");
        a.MoveTo(id, nbId);
        await a.SyncNow(); await b.SyncNow();
        Eq("Office", b.Notebooks().First(x => x.Id == nbId).Stack);
        Eq(nbId, b.Note(id)!.NotebookId);
        a.Trash(id); await a.SyncNow(); await b.SyncNow();
        True(b.Notes().All(x => x.Id != id), "trash synced");
    });
}

Console.WriteLine($"\n{passed} passed, {failed} failed");
return failed == 0 ? 0 : 1;
