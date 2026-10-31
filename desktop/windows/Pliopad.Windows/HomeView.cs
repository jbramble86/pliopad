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
    /// <summary>Edit Home: the real cards get a handle to drag them and an eye to hide or show them.</summary>
    private bool _editing;
    private HomeLayout _layout = HomeLayout.Default;
    private readonly Dictionary<string, Grid> _editables = [];
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
        var layout = _layout = R.HomeLayout;
        var notes = R.Notes();
        var name = (R.User?.Name ?? "").Split(' ')[0];
        var page = new StackPanel { MaxWidth = 1180, Padding = new Thickness(48, 36, 48, 64), Spacing = 22 };

        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(V(2, T(DateTime.Now.ToString("dddd, MMMM d"), 13, "PMuted"), T(name.Length > 0 ? $"Hi {name}, here's your day" : "Here's your day", 32, bold: true)));
        FrameworkElement custom;
        if (_editing)
        {
            var done = new Button { Content = "Done", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
            done.Click += (_, _) => { _editing = false; Build(); };
            custom = H(8, Flat(T("Reset", 13), () => { _layout = HomeLayout.Default; SaveLayout(); }, pad: 8), done);
        }
        else custom = Flat(H(6, I("\uE70F", 13), T("Edit", 13, "PMuted")), async () => { await R.RefreshMe(); _editing = true; Build(); }, "Edit Home", 8);
        custom.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(custom, 1);
        head.Children.Add(custom);
        Border? hint = null;
        if (_editing)
        {
            hint = new Border { Background = B("PSelected"), CornerRadius = new CornerRadius(10), Padding = new Thickness(14, 10, 14, 10),
                Child = T("Drag cards by their handle to move them, and use the eye to hide or show them. Your layout is saved to your account, so every device matches.", 13) };
            ((TextBlock)hint.Child).TextWrapping = TextWrapping.Wrap;
        }
        page.Children.Add(head);
        if (hint != null) page.Children.Add(hint);

        var widgets = new Dictionary<string, Func<FrameworkElement>>
        {
            ["actions"] = QuickActions,
            ["recent"] = () => RecentSection(notes),
            ["scratch"] = () => Widget("scratch", "Quick jot", "\uE70F", ScratchPad(notes), Flat(T("Open as page", 12, "PMuted"), OpenScratch, pad: 4)),
            ["tasks"] = () => Widget("tasks", "Tasks", "\uE73A", Tasks(), Flat(T("All", 12, "PAccent"), () => _main.Navigate(new Route("tasks")), pad: 4)),
            ["shortcuts"] = () => Widget("shortcuts", "Pinned", "\uE735", PinTiles(notes.Where(n => n.Pinned).Take(6).ToList())),
            ["reminders"] = () => Widget("reminders", "Reminders", "\uEA8F", Reminders(notes.Where(n => n.ReminderAt != null && !n.ReminderDone).OrderBy(n => n.ReminderAt).Take(5).ToList())),
            ["notebooks"] = () => Widget("notebooks", "Notebooks", "\uE82D", Notebooks(notes)),
            ["updated"] = () => Widget("updated", "Recently edited", "\uE81C", V(0,
                NoteRows(notes.Take(6).ToList(), n => RelTime(n.UpdatedAt) + (R.Notebooks().FirstOrDefault(x => x.Id == n.NotebookId) is { } nb ? " · " + nb.Name : ""), "Nothing yet."))),
        };

        // Wide sections on their own; runs of the others side by side in columns.
        // While editing, hidden sections stay in place (dimmed) so they can be shown again.
        _runs.Clear();
        _editables.Clear();
        FrameworkElement Make(string k) => _editing ? Editable(k, widgets[k]()) : widgets[k]();
        foreach (var group in layout.Groups(includeHidden: _editing))
        {
            if (HomeLayout.Wide.Contains(group[0])) { page.Children.Add(Make(group[0])); continue; }
            var grid = new Grid { ColumnSpacing = 16, RowSpacing = 16 };
            _runs.Add((grid, group.Select(Make).ToList()));
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

    /// <summary>Notebooks you're working in first: a tile each, with how many notes and when you last touched it.</summary>
    private UIElement Notebooks(List<Note> notes)
    {
        var byNb = notes.Where(n => n.NotebookId != null).GroupBy(n => n.NotebookId!).ToDictionary(g => g.Key, g => (Count: g.Count(), Last: g.Max(n => n.UpdatedAt)));
        var list = R.Notebooks().OrderByDescending(nb => byNb.GetValueOrDefault(nb.Id).Last).ThenBy(nb => nb.Name, StringComparer.OrdinalIgnoreCase).Take(6).ToList();
        if (list.Count == 0) return Empty("No notebooks yet.");
        var grid = new Grid { ColumnSpacing = 8, RowSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        for (int i = 0; i < list.Count; i++)
        {
            if (i % 2 == 0) grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var nb = list[i];
            var info = byNb.GetValueOrDefault(nb.Id);
            var tint = Tint(nb.Id);
            var icon = new Border { Width = 32, Height = 32, CornerRadius = new CornerRadius(9), Background = Solid(Alpha(tint, .18)), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 6),
                Child = new TextBlock { Text = nb.Icon ?? "📓", FontSize = 16, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } };
            var content = V(1, icon, T(nb.Name, 13, semibold: true),
                T(info.Count == 0 ? "Empty" : $"{info.Count} note{(info.Count == 1 ? "" : "s")} · {RelTime(info.Last)}", 12, "PMuted"),
                nb.Stack != null ? new TextBlock { Text = nb.Stack, FontSize = 11, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Solid(tint), Margin = new Thickness(0, 3, 0, 0), TextTrimming = TextTrimming.CharacterEllipsis } : null);
            var tile = new Button
            {
                Content = content, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Stretch,
                VerticalContentAlignment = VerticalAlignment.Top, MinHeight = 96, Padding = new Thickness(12, 10, 12, 10), CornerRadius = new CornerRadius(12),
                Background = Solid(Alpha(tint, .09)), BorderBrush = Solid(Alpha(tint, .25)), BorderThickness = new Thickness(1),
            };
            tile.Click += (_, _) => _main.Navigate(new Route("notebook", nb.Id));
            Grid.SetRow(tile, i / 2); Grid.SetColumn(tile, i % 2);
            grid.Children.Add(tile);
        }
        return grid;
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

    /// <summary>Turns Edit Home on or off.</summary>
    public void SetEditing(bool on) { _editing = on; Build(); }

    private void SaveLayout()
    {
        _ = R.SaveHomeLayout(_layout);
        var offset = VerticalOffset;
        Build();
        UpdateLayout();
        ChangeView(null, offset, null, true);
    }

    /// <summary>A card while editing: a handle to drag it, an eye to hide or show it, a dashed outline; clicks inside are blocked.</summary>
    private Grid Editable(string k, FrameworkElement card)
    {
        var hidden = _layout.Hidden.Contains(k);
        var accent = Rgb(0x647BFF);
        var handle = new Border
        {
            Background = hidden ? B("PFaint") : Solid(accent), CornerRadius = new CornerRadius(13), Padding = new Thickness(8, 4, 12, 4), HorizontalAlignment = HorizontalAlignment.Left,
            Child = H(6, new FontIcon { Glyph = "\uE76F", FontFamily = Symbols, FontSize = 12, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White) },
                new TextBlock { Text = HomeLayout.Label(k), FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White) }),
        };
        ToolTipService.SetToolTip(handle, "Drag to move");
        var eye = IconButton(hidden ? "\uED1A" : "\uE7B3", () => { if (!_layout.Hidden.Remove(k)) _layout.Hidden.Add(k); SaveLayout(); }, hidden ? "Show on Home" : "Hide from Home", 14);
        eye.HorizontalAlignment = HorizontalAlignment.Right;
        var tools = new Grid { Margin = new Thickness(0, 0, 0, 6), Children = { handle, eye } };
        card.Opacity = hidden ? .4 : 1;
        var outline = new Microsoft.UI.Xaml.Shapes.Rectangle { Stroke = Solid(Alpha(accent, .5)), StrokeThickness = 1.5, StrokeDashArray = [4, 3], RadiusX = 18, RadiusY = 18, Margin = new Thickness(-4) };
        var blocker = new Border { Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent) }; // keeps clicks off the card's own buttons
        var body = new Grid { Children = { outline, card, blocker } };
        var line = new Border { Height = 4, CornerRadius = new CornerRadius(2), Background = Solid(accent), Visibility = Visibility.Collapsed };
        var wrap = new Grid { Tag = card.Tag, RenderTransform = new TranslateTransform() };
        wrap.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        wrap.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Grid.SetRow(body, 1);
        wrap.Children.Add(tools);
        wrap.Children.Add(body);
        wrap.Children.Add(line);
        wrap.Margin = new Thickness(0, 6, 0, 6);
        _editables[k] = wrap;

        // Dragging: the real card follows the pointer and drops before or after the card under it.
        Windows.Foundation.Point start = default;
        double startOffset = 0;
        string? target = null;
        var after = false;
        handle.PointerPressed += (_, e) =>
        {
            handle.CapturePointer(e.Pointer);
            start = e.GetCurrentPoint(this).Position;
            startOffset = VerticalOffset;
            for (FrameworkElement? el = wrap; el != null && el != this; el = el.Parent as FrameworkElement) Canvas.SetZIndex(el, 10);
            wrap.Opacity = .92;
            e.Handled = true;
        };
        handle.PointerMoved += (_, e) =>
        {
            if (handle.PointerCaptures?.Count is not > 0) return;
            var p = e.GetCurrentPoint(this).Position;
            // Keep the page scrolling while dragging near its edges.
            if (p.Y < 70) ChangeView(null, VerticalOffset - 18, null, true); else if (p.Y > ActualHeight - 70) ChangeView(null, VerticalOffset + 18, null, true);
            var t = (TranslateTransform)wrap.RenderTransform;
            t.X = p.X - start.X; t.Y = p.Y - start.Y + (VerticalOffset - startOffset);
            target = null;
            foreach (var (key, other) in _editables)
            {
                ((Border)other.Children[2]).Visibility = Visibility.Collapsed;
                if (key == k) continue;
                var r = other.TransformToVisual(this).TransformBounds(new Windows.Foundation.Rect(0, 0, other.ActualWidth, other.ActualHeight));
                if (!r.Contains(p)) continue;
                target = key;
                after = p.Y > r.Y + r.Height / 2;
                var mark = (Border)other.Children[2];
                Grid.SetRow(mark, after ? 1 : 0);
                mark.VerticalAlignment = after ? VerticalAlignment.Bottom : VerticalAlignment.Top;
                mark.Margin = after ? new Thickness(0, 0, 0, -10) : new Thickness(0, -10, 0, 0);
                mark.Visibility = Visibility.Visible;
            }
        };
        handle.PointerReleased += (_, e) =>
        {
            handle.ReleasePointerCapture(e.Pointer);
            if (target != null)
            {
                _layout.Order.Remove(k);
                _layout.Order.Insert(_layout.Order.IndexOf(target) + (after ? 1 : 0), k);
            }
            SaveLayout();
        };
        return wrap;
    }
}
