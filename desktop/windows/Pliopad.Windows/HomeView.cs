using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>Home: an Evernote-style dashboard of widgets, laid out and styled like a Notion page (same widgets as web and Android).</summary>
public sealed class HomeView : ScrollPage, IRefreshable
{
    private Repo R => App.Repo;
    private readonly MainWindow _main;
    private readonly Grid _cols = new() { ColumnSpacing = 16, RowSpacing = 16 };
    private readonly List<FrameworkElement> _widgets = [];
    private int _colCount;
    private TextBox? _scratch;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _scratchTimer;
    public const string ScratchTitle = "Scratch pad";

    private static readonly (string Key, string Label)[] All =
        [("recent", "Recently visited"), ("scratch", "Scratch pad"), ("tasks", "Tasks"), ("shortcuts", "Shortcuts"), ("reminders", "Reminders"), ("notebooks", "Notebooks"), ("updated", "Recently edited")];

    public HomeView(MainWindow main)
    {
        _main = main;
        Background = B("PBg");
        SizeChanged += (_, e) => { var c = e.NewSize.Width >= 1180 ? 3 : e.NewSize.Width >= 760 ? 2 : 1; if (c != _colCount) Layout(c); };
        Build();
        Unloaded += (_, _) => SaveScratch();
    }

    private HashSet<string> Hidden => (R.Pref("homeHidden") ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries).ToHashSet();

    public void Refresh()
    {
        // Don't rebuild under the cursor while someone is typing in the scratch pad.
        if (_scratch?.FocusState is FocusState.Keyboard or FocusState.Pointer or FocusState.Programmatic) return;
        var offset = VerticalOffset;
        Build();
        UpdateLayout();
        ChangeView(null, offset, null, true);
    }

    private void Build()
    {
        var hidden = Hidden;
        var notes = R.Notes();
        var name = (R.User?.Name ?? "").Split(' ')[0];
        var page = new StackPanel { MaxWidth = 1180, Padding = new Thickness(48, 36, 48, 64), Spacing = 22 };

        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(V(2, T(DateTime.Now.ToString("dddd, MMMM d"), 13, "PMuted"), T($"{Greeting()}{(name.Length > 0 ? ", " + name : "")}", 32, bold: true)));
        var custom = IconButton("", () => _ = Customize(), "Customize Home");
        custom.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(custom, 1);
        head.Children.Add(custom);
        page.Children.Add(head);

        // Quick actions, as pills.
        var quick = new WrapPanelLite { Spacing = 8 };
        void Q(string e, string label, Action run, string? keys = null)
        {
            var b = Flat(H(8, new TextBlock { Text = e, FontSize = 14 }, T(label, 14)), run, keys, 12);
            b.CornerRadius = new CornerRadius(18);
            b.BorderBrush = B("PBorder");
            b.BorderThickness = new Thickness(1);
            b.Padding = new Thickness(14, 7, 16, 7);
            quick.Children.Add(b);
        }
        if (R.CanWrite)
        {
            Q("📝", "New note", () => _main.NewNote(), "Ctrl+N");
            Q("⚡", "Quick capture", () => QuickCapture.Show(), "Ctrl+Alt+N, from anywhere in Windows");
            Q("📅", "Daily note", _main.DailyNote, "Ctrl+D");
            Q("▦", "New database", _main.NewDatabase, "Ctrl+Shift+N");
        }
        Q("🔎", "Search", () => _main.ShowPalette(), "Ctrl+K");
        if (R.AiEnabled) Q("✨", "Ask AI", () => _main.Navigate(new Route("ask")));
        page.Children.Add(quick);

        if (!hidden.Contains("recent")) page.Children.Add(Widget("Recently visited", "", RecentCards(notes)));

        _widgets.Clear();
        var widgets = new Dictionary<string, Func<FrameworkElement>>
        {
            ["scratch"] = () => Widget("Scratch pad", "", ScratchPad(notes), Flat(T("Open as page", 12, "PMuted"), OpenScratch, pad: 4)),
            ["tasks"] = () => Widget("Tasks", "", Tasks(), Flat(T("All", 12, "PMuted"), () => _main.Navigate(new Route("tasks")), pad: 4)),
            ["shortcuts"] = () => Widget("Shortcuts", "", NoteRows(notes.Where(n => n.Pinned).ToList(), _ => null, "Star a note to pin it here.")),
            ["reminders"] = () => Widget("Reminders", "", NoteRows(notes.Where(n => n.ReminderAt != null && !n.ReminderDone).OrderBy(n => n.ReminderAt).Take(6).ToList(), n => LocalTime(n.ReminderAt!.Value), "No upcoming reminders.")),
            ["notebooks"] = () => Widget("Notebooks", "", Notebooks(notes)),
            ["updated"] = () => Widget("Recently edited", "", NoteRows(notes.Take(8).ToList(), n => RelTime(n.UpdatedAt) + (R.Notebooks().FirstOrDefault(x => x.Id == n.NotebookId) is { } nb ? " · " + nb.Name : ""), "Nothing yet.")),
        };
        foreach (var (k, _) in All.Skip(1)) if (!hidden.Contains(k)) _widgets.Add(widgets[k]());
        page.Children.Add(_cols);
        Layout(_colCount == 0 ? 2 : _colCount);
        Body = page;
    }

    /// <summary>Masonry-ish columns: widgets go to the shortest column so the page stays balanced.</summary>
    private void Layout(int count)
    {
        _colCount = count;
        // Detach widgets from the old columns first; WinUI won't re-parent an element that still has a parent.
        foreach (var old in _cols.Children.OfType<StackPanel>()) old.Children.Clear();
        _cols.Children.Clear();
        _cols.ColumnDefinitions.Clear();
        var stacks = Enumerable.Range(0, count).Select(_ => new StackPanel { Spacing = 16 }).ToList();
        for (int i = 0; i < count; i++)
        {
            _cols.ColumnDefinitions.Add(new ColumnDefinition());
            Grid.SetColumn(stacks[i], i);
            _cols.Children.Add(stacks[i]);
        }
        var heights = new double[count];
        foreach (var w in _widgets)
        {
            (w.Parent as Panel)?.Children.Remove(w);
            var c = Array.IndexOf(heights, heights.Min());
            stacks[c].Children.Add(w);
            heights[c] += Estimate(w);
        }
    }

    private static double Estimate(FrameworkElement w) => w.Tag is double d ? d : 200;

    private Border Widget(string title, string glyph, UIElement body, UIElement? action = null)
    {
        var head = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(H(8, I(glyph, 13), T(title, 13, "PMuted", semibold: true)));
        if (action != null) { Grid.SetColumn((FrameworkElement)action, 1); head.Children.Add(action); }
        var card = Card(V(0, head, body), 16);
        card.CornerRadius = new CornerRadius(14);
        card.Tag = 80.0 + (body is StackPanel sp ? sp.Children.Count * 36 : 160);
        return card;
    }

    private static TextBlock Empty(string s) { var t = T(s, 13, "PFaint"); t.Margin = new Thickness(4, 4, 0, 8); t.TextWrapping = TextWrapping.Wrap; return t; }

    private UIElement RecentCards(List<Note> notes)
    {
        var ids = R.RecentIds();
        var visited = ids.Select(id => notes.FirstOrDefault(n => n.Id == id)).Where(n => n != null).Cast<Note>().ToList();
        var recent = visited.Concat(notes.Where(n => !visited.Contains(n))).Take(10).ToList();
        if (recent.Count == 0) return Empty("Pages you open show up here.");
        var row = H(12);
        foreach (var n in recent)
        {
            var top = new Border { Height = 36, Background = B("PCallout"), CornerRadius = new CornerRadius(10, 10, 0, 0) };
            var icon = new TextBlock { Text = n.DisplayIcon, FontSize = 22, Margin = new Thickness(12, -14, 0, 0) };
            var title = T(n.DisplayTitle, 13, semibold: true);
            title.TextWrapping = TextWrapping.Wrap; title.MaxLines = 2; title.Margin = new Thickness(12, 2, 12, 0);
            var meta = T(RelTime(n.UpdatedAt), 11, "PFaint"); meta.Margin = new Thickness(12, 2, 12, 10);
            var card = new Border
            {
                Width = 148, Height = 124, CornerRadius = new CornerRadius(10), BorderBrush = B("PBorder"), BorderThickness = new Thickness(1), Background = B("PBg"),
                Child = V(0, top, icon, title, meta),
            };
            var b = new Button { Content = card, Padding = new Thickness(0), CornerRadius = new CornerRadius(10), BorderThickness = new Thickness(0) };
            b.Click += (_, _) => _main.OpenNote(n.Id);
            row.Children.Add(b);
        }
        return new ScrollViewer { Content = row, HorizontalScrollMode = ScrollMode.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollMode = ScrollMode.Disabled, Padding = new Thickness(0, 0, 0, 8) };
    }

    private StackPanel NoteRows(List<Note> list, Func<Note, string?> meta, string empty)
    {
        var p = new StackPanel { Spacing = 0 };
        foreach (var n in list)
        {
            var r = Row(n.DisplayIcon, n.DisplayTitle, () => _main.OpenNote(n.Id), meta(n));
            r.Margin = new Thickness(-8, 0, -8, 0);
            p.Children.Add(r);
        }
        if (list.Count == 0) p.Children.Add(Empty(empty));
        return p;
    }

    private StackPanel Tasks()
    {
        var p = new StackPanel();
        var tasks = R.OpenTasks();
        var today = DateTime.Today.ToString("yyyy-MM-dd");
        foreach (var t in tasks.Take(7))
        {
            var g = new Grid { ColumnSpacing = 4 };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var cb = new CheckBox { MinWidth = 0, IsEnabled = R.CanWrite, Padding = new Thickness(0), Margin = new Thickness(0, 0, 6, 0) };
            cb.Click += (_, _) => R.ToggleTask(t.NoteId, t.BlockId);
            g.Children.Add(cb);
            var label = Flat(T(Blocks.StripDue(t.Text), 14), () => _main.OpenNote(t.NoteId), t.NoteTitle, 4);
            label.HorizontalAlignment = HorizontalAlignment.Stretch;
            label.HorizontalContentAlignment = HorizontalAlignment.Left;
            Grid.SetColumn(label, 1); g.Children.Add(label);
            if (t.Due != null)
            {
                var due = T(t.Due == today ? "Today" : DateTime.TryParse(t.Due, out var d) ? d.ToString("MMM d") : t.Due, 12, string.CompareOrdinal(t.Due, today) < 0 ? "PRed" : t.Due == today ? "POrange" : "PMuted");
                Grid.SetColumn(due, 2); g.Children.Add(due);
            }
            p.Children.Add(g);
        }
        if (tasks.Count == 0) p.Children.Add(Empty("No open to-dos. Type [] in any note."));
        else if (tasks.Count > 7) p.Children.Add(Flat(T($"View all {tasks.Count} →", 13, "PAccent"), () => _main.Navigate(new Route("tasks")), pad: 4));
        return p;
    }

    private StackPanel Notebooks(List<Note> notes)
    {
        var counts = notes.Where(n => n.NotebookId != null).GroupBy(n => n.NotebookId!).ToDictionary(g => g.Key, g => g.Count());
        var p = new StackPanel();
        foreach (var nb in R.Notebooks())
        {
            var r = Row(nb.Icon ?? "📓", nb.Name, () => _main.Navigate(new Route("notebook", nb.Id)), counts.GetValueOrDefault(nb.Id) + (nb.Stack != null ? " · " + nb.Stack : ""));
            r.Margin = new Thickness(-8, 0, -8, 0);
            p.Children.Add(r);
        }
        if (p.Children.Count == 0) p.Children.Add(Empty("No notebooks yet."));
        return p;
    }

    // ---- scratch pad: a real note, so it syncs to the phone and the web ----

    private string? ScratchId() => R.Notes().FirstOrDefault(n => n.Title == ScratchTitle)?.Id;

    private UIElement ScratchPad(List<Note> notes)
    {
        var n = notes.FirstOrDefault(x => x.Title == ScratchTitle);
        _scratch = new TextBox
        {
            AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 150, MaxHeight = 340, PlaceholderText = "Jot something down…  It saves as you type and syncs to your phone.",
            Text = n != null ? Blocks.ToMarkdownLines(Blocks.Parse(n.Content)) : "", IsReadOnly = !R.CanWrite, FontSize = 14,
        };
        Bare(_scratch);
        _scratch.Padding = new Thickness(0, 4, 0, 4);
        _scratchTimer = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread().CreateTimer();
        _scratchTimer.Interval = TimeSpan.FromMilliseconds(800);
        _scratchTimer.IsRepeating = false;
        _scratchTimer.Tick += (_, _) => SaveScratch();
        _scratch.TextChanged += (_, _) => { _scratch.Tag = "dirty"; _scratchTimer.Stop(); _scratchTimer.Start(); };
        return _scratch;
    }

    private void SaveScratch()
    {
        if (_scratch?.Tag as string != "dirty") return;
        _scratch.Tag = null;
        _scratchTimer?.Stop();
        var id = ScratchId();
        var old = id != null ? Blocks.Parse(R.Note(id)!.Content) : [];
        var blocks = Blocks.ReuseIds(Blocks.FromMarkdown(_scratch.Text), old);
        if (id == null) R.CreateNote(ScratchTitle, blocks, null, useDefaultNotebook: false, icon: "🗒️");
        else R.SaveContent(id, ScratchTitle, blocks);
    }

    private void OpenScratch()
    {
        SaveScratch();
        var id = ScratchId() ?? R.CreateNote(ScratchTitle, [], null, useDefaultNotebook: false, icon: "🗒️");
        _main.OpenNote(id);
    }

    private async Task Customize()
    {
        var hidden = Hidden;
        var list = new StackPanel();
        foreach (var (k, l) in All)
        {
            var cb = new CheckBox { Content = l, IsChecked = !hidden.Contains(k) };
            cb.Click += (_, _) => { if (cb.IsChecked == true) hidden.Remove(k); else hidden.Add(k); R.SetPref("homeHidden", string.Join("|", hidden)); };
            list.Children.Add(cb);
        }
        await Alert(_main.Root, "Customize Home", list);
        Build();
    }
}
