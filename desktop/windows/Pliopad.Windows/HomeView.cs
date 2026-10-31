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
    /// <summary>Each run of side-by-side sections: its grid and its cards, re-flowed into columns when the window resizes.</summary>
    private readonly List<(Grid Grid, List<FrameworkElement> Cards)> _runs = [];
    private int _colCount;
    private TextBox? _scratch;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? _scratchTimer;
    public const string ScratchTitle = "Quick jot";
    /// <summary>Quick jot notes created before the rename are still found.</summary>
    private static bool IsScratch(Note n) => n.Title is ScratchTitle or "Scratch pad";

    /// <summary>Each section's colour (same on web and Android).</summary>
    private static readonly Dictionary<string, Windows.UI.Color> Accent = new()
    {
        ["scratch"] = Rgb(0xF5A524), ["tasks"] = Rgb(0x647BFF), ["shortcuts"] = Rgb(0x9B7BFF), ["reminders"] = Rgb(0xFF7A70),
        ["notebooks"] = Rgb(0x2FBF8A), ["updated"] = Rgb(0x3BA7FF), ["recent"] = Rgb(0x647BFF),
    };
    private static readonly Windows.UI.Color[] Tints = [Rgb(0x647BFF), Rgb(0x2FBF8A), Rgb(0xFF7A70), Rgb(0xF5A524), Rgb(0x9B7BFF), Rgb(0x3BA7FF), Rgb(0xEC6FB0)];
    private static Windows.UI.Color Rgb(uint v, byte a = 255) => Windows.UI.Color.FromArgb(a, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    private static Windows.UI.Color Alpha(Windows.UI.Color c, double a) => Windows.UI.Color.FromArgb((byte)(a * 255), c.R, c.G, c.B);
    private static SolidColorBrush Solid(Windows.UI.Color c) => new(c);
    /// <summary>A steady colour per note or notebook, from its id (same hash as web and Android).</summary>
    private static Windows.UI.Color Tint(string? id) => Tints[(int)((id ?? "").Aggregate(7L, (a, ch) => (a * 31 + ch) & 0xFFFFFFFFL) % Tints.Length)];

    public HomeView(MainWindow main)
    {
        _main = main;
        Background = B("PBg");
        SizeChanged += (_, e) => { var c = e.NewSize.Width >= 1180 ? 3 : e.NewSize.Width >= 760 ? 2 : 1; if (c != _colCount) Layout(c); };
        Build();
        Unloaded += (_, _) => SaveScratch();
    }

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
        var layout = R.HomeLayout;
        var notes = R.Notes();
        var name = (R.User?.Name ?? "").Split(' ')[0];
        var page = new StackPanel { MaxWidth = 1180, Padding = new Thickness(48, 36, 48, 64), Spacing = 22 };

        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(V(2, T(DateTime.Now.ToString("dddd, MMMM d"), 13, "PMuted"), T(name.Length > 0 ? $"Hi {name}, here's your day" : "Here's your day", 32, bold: true)));
        var custom = IconButton("\uE713", () => _ = Customize(), "Customize Home");
        custom.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(custom, 1);
        head.Children.Add(custom);
        page.Children.Add(head);

        var widgets = new Dictionary<string, Func<FrameworkElement>>
        {
            ["actions"] = QuickActions,
            ["recent"] = () => RecentSection(notes),
            ["scratch"] = () => Widget("scratch", "Quick jot", "\uE70F", ScratchPad(notes), Flat(T("Open as page", 12, "PMuted"), OpenScratch, pad: 4)),
            ["tasks"] = () => Widget("tasks", "Tasks", "\uE73A", Tasks(), Flat(T("All", 12, "PAccent"), () => _main.Navigate(new Route("tasks")), pad: 4)),
            ["shortcuts"] = () => Widget("shortcuts", "Pinned", "\uE735", PinTiles(notes.Where(n => n.Pinned).Take(6).ToList())),
            ["reminders"] = () => Widget("reminders", "Reminders", "\uEA8F", Reminders(notes.Where(n => n.ReminderAt != null && !n.ReminderDone).OrderBy(n => n.ReminderAt).Take(5).ToList())),
            ["notebooks"] = () => Widget("notebooks", "Notebooks", "\uE82D", Notebooks(notes)),
            ["updated"] = () => Widget("updated", "Recently edited", "\uE81C", V(0, Activity(notes),
                NoteRows(notes.Take(5).ToList(), n => RelTime(n.UpdatedAt) + (R.Notebooks().FirstOrDefault(x => x.Id == n.NotebookId) is { } nb ? " · " + nb.Name : ""), "Nothing yet."))),
        };

        // Wide sections on their own; runs of the others side by side in columns.
        _runs.Clear();
        foreach (var group in layout.Groups())
        {
            if (HomeLayout.Wide.Contains(group[0])) { page.Children.Add(widgets[group[0]]()); continue; }
            var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
            _runs.Add((grid, group.Select(k => widgets[k]()).ToList()));
            page.Children.Add(grid);
        }
        Layout(_colCount == 0 ? 2 : _colCount);
        Body = page;
    }

    private FrameworkElement QuickActions()
    {
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
        return quick;
    }

    private FrameworkElement RecentSection(List<Note> notes)
    {
        var label = H(8, Badge("recent", "\uE81C", 22), T("Jump back in", 13, "PMuted", semibold: true));
        label.Margin = new Thickness(0, 0, 0, 10);
        return V(0, label, RecentCards(notes));
    }

    /// <summary>Masonry-ish columns: widgets go to the shortest column so the page stays balanced.</summary>
    private void Layout(int count)
    {
        _colCount = count;
        foreach (var (grid, cards) in _runs)
        {
            // Detach cards from the old columns first; WinUI won't re-parent an element that still has a parent.
            foreach (var old in grid.Children.OfType<StackPanel>()) old.Children.Clear();
            grid.Children.Clear();
            grid.ColumnDefinitions.Clear();
            var n = Math.Min(count, Math.Max(1, cards.Count));
            var stacks = Enumerable.Range(0, n).Select(_ => new StackPanel { Spacing = 16 }).ToList();
            for (int i = 0; i < n; i++)
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition());
                Grid.SetColumn(stacks[i], i);
                grid.Children.Add(stacks[i]);
            }
            var heights = new double[n];
            foreach (var w in cards)
            {
                (w.Parent as Panel)?.Children.Remove(w);
                var c = Array.IndexOf(heights, heights.Min());
                stacks[c].Children.Add(w);
                heights[c] += Estimate(w);
            }
        }
    }

    private static double Estimate(FrameworkElement w) => w.Tag is double d ? d : 200;

    private static Border Badge(string key, string glyph, double size = 28)
    {
        var accent = Accent.GetValueOrDefault(key, Rgb(0x647BFF));
        return new Border
        {
            Width = size, Height = size, CornerRadius = new CornerRadius(size * 0.28), Background = Solid(Alpha(accent, .16)),
            Child = new FontIcon { Glyph = glyph, FontFamily = Symbols, FontSize = size * 0.54, Foreground = Solid(accent), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
        };
    }

    private Border Widget(string key, string title, string glyph, UIElement body, UIElement? action = null)
    {
        var accent = Accent.GetValueOrDefault(key, Rgb(0x647BFF));
        var head = new Grid { Margin = new Thickness(0, 0, 0, 10) };
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(H(10, Badge(key, glyph), T(title, 15, semibold: true)));
        if (action != null) { ((FrameworkElement)action).VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn((FrameworkElement)action, 1); head.Children.Add(action); }
        var tint = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(0, 1) };
        tint.GradientStops.Add(new GradientStop { Color = Alpha(accent, .10), Offset = 0 });
        tint.GradientStops.Add(new GradientStop { Color = Alpha(accent, 0), Offset = .45 });
        var card = new Border
        {
            CornerRadius = new CornerRadius(16), Background = B("PCard"), BorderBrush = Solid(Alpha(accent, .28)), BorderThickness = new Thickness(1),
            Child = new Border { Background = tint, CornerRadius = new CornerRadius(15), Padding = new Thickness(16, 14, 16, 14), Child = V(0, head, body) },
        };
        card.Tag = 90.0 + (body is StackPanel sp ? sp.Children.Count * 40 : 180);
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
            var band = new LinearGradientBrush { StartPoint = new Windows.Foundation.Point(0, 0), EndPoint = new Windows.Foundation.Point(1, 0) };
            band.GradientStops.Add(new GradientStop { Color = Tint(n.NotebookId ?? n.Id), Offset = 0 });
            band.GradientStops.Add(new GradientStop { Color = Tint((n.NotebookId ?? n.Id) + "x"), Offset = 1 });
            var top = new Border { Height = 6, Background = band, CornerRadius = new CornerRadius(10, 10, 0, 0) };
            var icon = new TextBlock { Text = n.DisplayIcon, FontSize = 22, Margin = new Thickness(12, 12, 0, 0) };
            var title = T(n.DisplayTitle, 13, semibold: true);
            title.TextWrapping = TextWrapping.Wrap; title.MaxLines = 2; title.Margin = new Thickness(12, 6, 12, 0);
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
        if (tasks.Count > 0) p.Children.Add(TaskSummary(tasks, today));
        foreach (var t in tasks.Take(6))
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
        else if (tasks.Count > 6) p.Children.Add(Flat(T($"View all {tasks.Count} →", 13, "PAccent"), () => _main.Navigate(new Route("tasks")), pad: 4));
        return p;
    }

    private StackPanel Notebooks(List<Note> notes)
    {
        var counts = notes.Where(n => n.NotebookId != null).GroupBy(n => n.NotebookId!).ToDictionary(g => g.Key, g => g.Count());
        var most = Math.Max(1, counts.Values.DefaultIfEmpty(0).Max());
        var p = new StackPanel { Spacing = 2 };
        foreach (var nb in R.Notebooks().Take(8))
        {
            var count = counts.GetValueOrDefault(nb.Id);
            var tint = Tint(nb.Id);
            var g = new Grid { ColumnSpacing = 10 };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.Children.Add(new Border { Width = 34, Height = 34, CornerRadius = new CornerRadius(10), Background = Solid(Alpha(tint, .16)),
                Child = new TextBlock { Text = nb.Icon ?? "📓", FontSize = 17, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } });
            var top = new Grid();
            top.ColumnDefinitions.Add(new ColumnDefinition());
            top.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            top.Children.Add(T(nb.Name, 14));
            var c = T(count == 1 ? "1 note" : $"{count} notes", 12, "PFaint"); Grid.SetColumn(c, 1); top.Children.Add(c);
            var fill = new Grid { Height = 4, Margin = new Thickness(0, 6, 0, 0) };
            fill.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Math.Max(.04, count / (double)most), GridUnitType.Star) });
            fill.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - Math.Max(.04, count / (double)most) + 0.0001, GridUnitType.Star) });
            fill.Children.Add(new Border { Background = B("PBorder"), CornerRadius = new CornerRadius(2) });
            Grid.SetColumnSpan(fill.Children[0] as FrameworkElement, 2);
            fill.Children.Add(new Border { Background = Solid(tint), CornerRadius = new CornerRadius(2) });
            var info = V(0, top, fill); info.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(info, 1); g.Children.Add(info);
            var b = Flat(g, () => _main.Navigate(new Route("notebook", nb.Id)), pad: 6);
            b.HorizontalAlignment = HorizontalAlignment.Stretch; b.HorizontalContentAlignment = HorizontalAlignment.Stretch;
            b.Margin = new Thickness(-6, 0, -6, 0);
            p.Children.Add(b);
        }
        if (p.Children.Count == 0) p.Children.Add(Empty("No notebooks yet."));
        return p;
    }

    /// <summary>At a glance: how many to-dos are overdue, due today, coming up or undated.</summary>
    private static StackPanel TaskSummary(List<OpenTask> tasks, string today)
    {
        var groups = new (string Label, Brush Color, int Count)[]
        {
            ("Overdue", Solid(Rgb(0xEF4444)), tasks.Count(t => t.Due != null && string.CompareOrdinal(t.Due, today) < 0)),
            ("Today", Solid(Rgb(0xF5A524)), tasks.Count(t => t.Due == today)),
            ("Upcoming", Solid(Rgb(0x647BFF)), tasks.Count(t => t.Due != null && string.CompareOrdinal(t.Due, today) > 0)),
            ("No date", B("PBorder"), tasks.Count(t => t.Due == null)),
        }.Where(g => g.Count > 0).ToList();
        var bar = new Grid { Height = 8, ColumnSpacing = 3 };
        var legend = new WrapPanelLite { Spacing = 14 };
        foreach (var (label, color, count) in groups)
        {
            bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(count, GridUnitType.Star) });
            var seg = new Border { Background = color, CornerRadius = new CornerRadius(2) };
            Grid.SetColumn(seg, bar.ColumnDefinitions.Count - 1);
            bar.Children.Add(seg);
            legend.Children.Add(H(5, new Border { Width = 8, Height = 8, CornerRadius = new CornerRadius(2), Background = color }, T(count.ToString(), 12, semibold: true), T(label, 12, "PMuted")));
        }
        var p = V(8, new Border { CornerRadius = new CornerRadius(4), Child = bar }, legend);
        p.Margin = new Thickness(0, 0, 0, 8);
        return p;
    }

    /// <summary>Pinned notes as small coloured tiles, two to a row.</summary>
    private UIElement PinTiles(List<Note> pinned)
    {
        if (pinned.Count == 0) return Empty("Pin a note to keep it here.");
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        for (int i = 0; i < pinned.Count; i++)
        {
            if (i % 2 == 0) grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var n = pinned[i];
            var tint = Tint(n.Id);
            var title = T(n.DisplayTitle, 13, semibold: true); title.TextWrapping = TextWrapping.Wrap; title.MaxLines = 2;
            var tile = new Button
            {
                Content = V(6, new TextBlock { Text = n.DisplayIcon, FontSize = 20 }, title), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Top, MinHeight = 74, Padding = new Thickness(10),
                CornerRadius = new CornerRadius(12), Background = Solid(Alpha(tint, .12)), BorderBrush = Solid(Alpha(tint, .3)), BorderThickness = new Thickness(1),
            };
            tile.Click += (_, _) => _main.OpenNote(n.Id);
            Grid.SetRow(tile, i / 2); Grid.SetColumn(tile, i % 2);
            grid.Children.Add(tile);
        }
        return grid;
    }

    /// <summary>Reminders with a little calendar chip for the date.</summary>
    private UIElement Reminders(List<Note> list)
    {
        if (list.Count == 0) return Empty("No upcoming reminders.");
        var coral = Rgb(0xFF7A70);
        var p = new StackPanel { Spacing = 2 };
        foreach (var n in list)
        {
            var at = DateTimeOffset.FromUnixTimeMilliseconds(n.ReminderAt!.Value).LocalDateTime;
            var due = at < DateTime.Now;
            var fg = due ? new SolidColorBrush(Microsoft.UI.Colors.White) : Solid(Rgb(0xE2554B));
            var month = new TextBlock { Text = at.ToString("MMM").ToUpperInvariant(), FontSize = 9, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = fg, HorizontalAlignment = HorizontalAlignment.Center, CharacterSpacing = 60 };
            var day = new TextBlock { Text = at.Day.ToString(), FontSize = 16, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = fg, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, -2, 0, 0) };
            var chip = new Border { Width = 38, Height = 40, CornerRadius = new CornerRadius(9), Background = Solid(due ? coral : Alpha(coral, .14)),
                Child = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { month, day } } };
            var g = new Grid { ColumnSpacing = 10 };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.Children.Add(chip);
            var info = V(1, T(n.DisplayTitle, 14), T(at.ToString("ddd h:mm tt"), 12, "PMuted")); info.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(info, 1); g.Children.Add(info);
            var b = Flat(g, () => _main.OpenNote(n.Id), pad: 6);
            b.HorizontalAlignment = HorizontalAlignment.Stretch; b.HorizontalContentAlignment = HorizontalAlignment.Stretch;
            b.Margin = new Thickness(-6, 0, -6, 0);
            p.Children.Add(b);
        }
        return p;
    }

    /// <summary>Notes edited per day over the last two weeks, as small bars.</summary>
    private static Grid Activity(List<Note> notes)
    {
        var start = new DateTimeOffset(DateTime.Today).ToUnixTimeMilliseconds();
        const long day = 86_400_000;
        var counts = new int[14];
        foreach (var n in notes) { var d = (start + day - n.UpdatedAt) / day; if (n.UpdatedAt <= start + day && d is >= 0 and < 14) counts[13 - d]++; }
        var max = Math.Max(1, counts.Max());
        var blue = Rgb(0x3BA7FF);
        var g = new Grid { Height = 40, ColumnSpacing = 4, Margin = new Thickness(0, 0, 0, 10) };
        for (int i = 0; i < 14; i++)
        {
            g.ColumnDefinitions.Add(new ColumnDefinition());
            var bar = new Border { Height = Math.Max(3, counts[i] / (double)max * 40), VerticalAlignment = VerticalAlignment.Bottom, CornerRadius = new CornerRadius(3, 3, 1, 1),
                Background = Solid(i == 13 ? blue : Alpha(blue, .35)) };
            ToolTipService.SetToolTip(bar, $"{counts[i]} edited");
            Grid.SetColumn(bar, i); g.Children.Add(bar);
        }
        return g;
    }

    // ---- scratch pad: a real note, so it syncs to the phone and the web ----

    private string? ScratchId() => R.Notes().FirstOrDefault(IsScratch)?.Id;

    private UIElement ScratchPad(List<Note> notes)
    {
        var n = notes.FirstOrDefault(IsScratch);
        _scratch = new TextBox
        {
            AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 150, MaxHeight = 340, PlaceholderText = "Jot something down…  It saves as you type and syncs to your phone.",
            Text = n != null ? Blocks.ToMarkdownLines(Blocks.Parse(n.Content)) : "", IsReadOnly = !R.CanWrite, FontSize = 14,
        };
        Bare(_scratch);
        _scratch.Padding = new Thickness(0, 4, 0, 4);
        var amber = Rgb(0xF5A524);
        var paper = new Border { Background = Solid(Alpha(amber, .06)), BorderBrush = Solid(Alpha(amber, .3)), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(10), Padding = new Thickness(10, 4, 10, 4), Child = _scratch };
        _scratchTimer = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread().CreateTimer();
        _scratchTimer.Interval = TimeSpan.FromMilliseconds(800);
        _scratchTimer.IsRepeating = false;
        _scratchTimer.Tick += (_, _) => SaveScratch();
        _scratch.TextChanged += (_, _) => { _scratch.Tag = "dirty"; _scratchTimer.Stop(); _scratchTimer.Start(); };
        return paper;
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
        var layout = R.HomeLayout;
        var list = new StackPanel { MinWidth = 340 };
        void Draw()
        {
            list.Children.Clear();
            for (int i = 0; i < layout.Order.Count; i++)
            {
                var k = layout.Order[i];
                var idx = i;
                var g = new Grid();
                g.ColumnDefinitions.Add(new ColumnDefinition());
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var cb = new CheckBox { Content = HomeLayout.Label(k), IsChecked = !layout.Hidden.Contains(k) };
                cb.Click += (_, _) => { if (cb.IsChecked == true) layout.Hidden.Remove(k); else layout.Hidden.Add(k); Save(); };
                g.Children.Add(cb);
                var up = IconButton("\uE70E", () => Move(idx, -1), "Move up"); up.IsEnabled = i > 0; Grid.SetColumn(up, 1); g.Children.Add(up);
                var down = IconButton("\uE70D", () => Move(idx, 1), "Move down"); down.IsEnabled = i < layout.Order.Count - 1; Grid.SetColumn(down, 2); g.Children.Add(down);
                list.Children.Add(g);
            }
        }
        void Move(int i, int d) { (layout.Order[i], layout.Order[i + d]) = (layout.Order[i + d], layout.Order[i]); Save(); Draw(); }
        void Save() { _ = R.SaveHomeLayout(layout); Build(); }
        Draw();
        var reset = Flat(T("Reset to default", 13, "PAccent"), () => { layout = HomeLayout.Default; Save(); Draw(); }, pad: 6);
        reset.Margin = new Thickness(-6, 8, 0, 0);
        var note = T("Your layout is saved to your account and used on every device.", 12, "PMuted");
        note.TextWrapping = TextWrapping.Wrap; note.Margin = new Thickness(0, 0, 0, 8);
        await Alert(_main.Root, "Customize Home", V(0, note, list, reset));
        Build();
    }
}
