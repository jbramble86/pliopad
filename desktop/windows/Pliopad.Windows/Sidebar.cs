using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>The sidebar: workspace menu, quick links, pinned notes, notebooks grouped into collections, tags.</summary>
public sealed partial class MainWindow
{
    private readonly HashSet<string> _collapsed = [];
    private bool _collapsedLoaded;

    private void RenderSidebar()
    {
        if (!_collapsedLoaded)
        {
            _collapsedLoaded = true;
            foreach (var k in (R.Pref("collapsed") ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries)) _collapsed.Add(k);
        }
        var notes = R.Notes();
        var notebooks = R.Notebooks();
        var tags = R.Tags();
        var count = notes.Where(n => n.NotebookId != null).GroupBy(n => n.NotebookId!).ToDictionary(g => g.Key, g => g.Count());
        var p = new StackPanel { Padding = new Thickness(6, 4, 6, 16), Spacing = 1 };

        p.Children.Add(WorkspaceButton());
        p.Children.Add(Row("", "Search", () => ShowPalette(), "Ctrl+K", glyph: true));
        p.Children.Add(Row("", "Home", () => Navigate(new Route("home")), selected: Route.Kind == "home" && OpenNoteId == null, glyph: true));
        var openTasks = R.OpenTasks().Count;
        p.Children.Add(Row("", "Tasks", () => Navigate(new Route("tasks")), openTasks > 0 ? openTasks.ToString() : null, Route.Kind == "tasks", glyph: true));
        p.Children.Add(Row("🪐", "PlioSphere", () => Navigate(new Route("sphere")), null, Route.Kind == "sphere"));
        if (R.AiEnabled) p.Children.Add(Row("", "Ask AI", () => Navigate(new Route("ask")), selected: Route.Kind == "ask", glyph: true));
        p.Children.Add(Row("", "All notes", () => Navigate(new Route("all")), notes.Count.ToString(), Route.Kind == "all", glyph: true));
        if (R.CanWrite) p.Children.Add(Row("", "New page", () => NewNote(), "Ctrl+N", glyph: true));

        // Pinned notes
        var pinned = notes.Where(n => n.Pinned).OrderBy(n => n.Title).ToList();
        if (pinned.Count > 0 && Section(p, "shortcuts", "Pinned", () => Navigate(new Route("pinned"))))
            foreach (var n in pinned) p.Children.Add(Row(n.DisplayIcon, n.DisplayTitle, () => OpenNote(n.Id), selected: OpenNoteId == n.Id && !Route.HasList));

        // Notebooks, stacks first (Evernote), then loose notebooks
        if (Section(p, "notebooks", "Notebooks", null, R.CanWrite ? () => _ = NewNotebook(null) : null))
        {
            foreach (var stack in notebooks.Where(nb => nb.Stack != null).GroupBy(nb => nb.Stack!).OrderBy(g => g.Key))
            {
                var key = "stack:" + stack.Key;
                var open = !_collapsed.Contains(key);
                var row = Row(open ? "📚" : "📚", stack.Key, () => Navigate(new Route("stack", stack.Key)), null, Route.Kind == "stack" && Route.Arg == stack.Key);
                row.ContextFlyout = StackMenu(stack.Key);
                p.Children.Add(WithChevron(row, open, () => { Toggle(key); RenderSidebar(); }));
                if (open)
                    foreach (var nb in stack) p.Children.Add(NotebookRow(nb, count.GetValueOrDefault(nb.Id), 18));
            }
            foreach (var nb in notebooks.Where(nb => nb.Stack == null)) p.Children.Add(NotebookRow(nb, count.GetValueOrDefault(nb.Id), 0));
            if (notebooks.Count == 0) p.Children.Add(Hint("No notebooks yet"));
        }

        // Tags
        if (tags.Count > 0 && Section(p, "tags", "Tags", null))
        {
            var tagCount = notes.SelectMany(n => n.TagIds).GroupBy(t => t).ToDictionary(g => g.Key, g => g.Count());
            foreach (var t in tags)
            {
                var row = Row("#", t.Name, () => Navigate(new Route("tag", t.Id)), tagCount.GetValueOrDefault(t.Id).ToString(), Route.Kind == "tag" && Route.Arg == t.Id);
                if (R.CanWrite) row.ContextFlyout = Menu(
                    Item("Rename", async () => { if (await Prompt(Root, "Rename tag", t.Name) is { } s) R.RenameTag(t.Id, s); }, ""),
                    Item("Delete tag", async () => { if (await Confirm(Root, $"Delete #{t.Name}?", "Notes keep their content; only the tag is removed.")) R.DeleteTag(t.Id); }, "", true));
                p.Children.Add(row);
            }
        }

        p.Children.Add(new Border { Height = 10 });
        p.Children.Add(Row("", "Templates", () => Navigate(new Route("templates")), null, Route.Kind == "templates", glyph: true));
        var trash = R.Store.Trash(R.WsId).Count;
        p.Children.Add(Row("", "Trash", () => Navigate(new Route("trash")), trash > 0 ? trash.ToString() : null, Route.Kind == "trash", glyph: true));

        var offset = _sidebarScroll.VerticalOffset;
        _sidebarScroll.Content = p;
        _sidebarScroll.UpdateLayout();
        _sidebarScroll.ChangeView(null, offset, null, true);
    }

    private static TextBlock Hint(string s) { var t = T(s, 12, "PFaint"); t.Margin = new Thickness(12, 4, 0, 4); return t; }

    private void Toggle(string key)
    {
        if (!_collapsed.Remove(key)) _collapsed.Add(key);
        R.SetPref("collapsed", string.Join("|", _collapsed));
    }

    /// <summary>Section header ("Notebooks  +"). Returns whether it is expanded.</summary>
    private bool Section(StackPanel p, string key, string title, Action? open, Action? add = null)
    {
        var expanded = !_collapsed.Contains(key);
        var g = new Grid { Margin = new Thickness(0, 14, 0, 2) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var head = Flat(H(4, T(title, 12, "PMuted", semibold: true), I(expanded ? "" : "", 9)), () =>
        {
            if (open != null && expanded && Ctrl()) { open(); return; }
            Toggle(key); RenderSidebar();
        }, pad: 6);
        head.HorizontalAlignment = HorizontalAlignment.Left;
        head.Padding = new Thickness(8, 2, 8, 2);
        if (open != null) ToolTipService.SetToolTip(head, "Click to collapse · Ctrl+click to open all");
        g.Children.Add(head);
        if (add != null) { var b = IconButton("", add, "New notebook", 11); Grid.SetColumn(b, 1); g.Children.Add(b); }
        p.Children.Add(g);
        return expanded;
    }

    private UIElement WithChevron(Button row, bool open, Action toggle)
    {
        var g = new Grid();
        g.Children.Add(row);
        var chev = IconButton(open ? "" : "", toggle, open ? "Collapse" : "Expand", 9);
        chev.HorizontalAlignment = HorizontalAlignment.Left;
        chev.VerticalAlignment = VerticalAlignment.Center;
        chev.Margin = new Thickness(-2, 0, 0, 0);
        chev.Opacity = 0.8;
        // The chevron sits over the emoji slot; the emoji hides while the pointer is over the row, like Notion.
        var emoji = (TextBlock)((Grid)row.Content).Children[0];
        chev.Visibility = Visibility.Collapsed;
        g.PointerEntered += (_, _) => { chev.Visibility = Visibility.Visible; emoji.Opacity = 0; };
        g.PointerExited += (_, _) => { chev.Visibility = Visibility.Collapsed; emoji.Opacity = 1; };
        g.Children.Add(chev);
        return g;
    }

    private Button NotebookRow(Notebook nb, int count, double indent)
    {
        var row = Row(nb.Icon ?? "📓", nb.Name, () => Navigate(new Route("notebook", nb.Id)), count.ToString(), Route.Kind == "notebook" && Route.Arg == nb.Id, indent);
        if (!R.CanWrite) return row;
        var stacks = R.Notebooks().Where(x => x.Stack != null).Select(x => x.Stack!).Distinct().OrderBy(x => x).ToList();
        var move = new MenuFlyoutSubItem { Text = "Move to collection", Icon = new FontIcon { Glyph = "", FontFamily = Symbols } };
        foreach (var s in stacks.Where(s => s != nb.Stack)) move.Items.Add(Item(s, () => R.SetNotebookStack(nb.Id, s)));
        if (stacks.Count > 0) move.Items.Add(new MenuFlyoutSeparator());
        move.Items.Add(Item("New collection…", async () => { if (await Prompt(Root, "New collection", "", "Collection name", "Create") is { Length: > 0 } s) R.SetNotebookStack(nb.Id, s); }, ""));
        if (nb.Stack != null) move.Items.Add(Item("Remove from collection", () => R.SetNotebookStack(nb.Id, null), ""));
        row.ContextFlyout = Menu(
            Item("New note here", () => NewNote(nb.Id), ""),
            new MenuFlyoutSeparator(),
            Item("Rename", async () => { if (await Prompt(Root, "Rename notebook", nb.Name) is { } s) R.RenameNotebook(nb.Id, s); }, ""),
            Item("Change icon", async () => { if (await Prompt(Root, "Notebook icon (an emoji)", nb.Icon ?? "📓") is { Length: > 0 } s) R.SetNotebookIcon(nb.Id, s.Trim()); }, ""),
            move,
            new MenuFlyoutSeparator(),
            Item("Delete notebook", async () =>
            {
                if (await Confirm(Root, $"Delete “{nb.Name}”?", "Its notes move to the trash, where you can restore them.")) { R.DeleteNotebook(nb.Id); if (Route.Arg == nb.Id) Navigate(new Route("home")); }
            }, "", true));
        return row;
    }

    private MenuFlyout? StackMenu(string stack) => !R.CanWrite ? null : Menu(
        Item("New notebook in collection", () => _ = NewNotebook(stack), ""),
        Item("Add notebooks…", () => _ = PickNotebooksForStack(stack), ""),
        Item("Rename collection", async () => { if (await Prompt(Root, "Rename collection", stack) is { Length: > 0 } s) { R.RenameStack(stack, s); if (Route.Kind == "stack" && Route.Arg == stack) Navigate(new Route("stack", s), remember: false); } }, ""),
        new MenuFlyoutSeparator(),
        Item("Ungroup collection", () => R.UngroupStack(stack), ""));

    public async Task NewNotebook(string? stack)
    {
        if (await Prompt(Root, stack == null ? "New notebook" : $"New notebook in {stack}", "", "Notebook name", "Create") is { Length: > 0 } name)
            Navigate(new Route("notebook", R.CreateNotebook(name, stack)));
    }

    private async Task PickNotebooksForStack(string stack)
    {
        var boxes = R.Notebooks().Select(nb => new CheckBox { Content = $"{nb.Icon ?? "📓"}  {nb.Name}" + (nb.Stack != null && nb.Stack != stack ? $"  ({nb.Stack})" : ""), IsChecked = nb.Stack == stack, Tag = nb }).ToList();
        var list = new StackPanel();
        foreach (var b in boxes) list.Children.Add(b);
        var dlg = new ContentDialog { XamlRoot = Root, Title = $"Notebooks in {stack}", Content = new ScrollViewer { Content = list, MaxHeight = 420 }, PrimaryButtonText = "Save", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary };
        if (await dlg.ShowAsync() != ContentDialogResult.Primary) return;
        foreach (var b in boxes)
        {
            var nb = (Notebook)b.Tag;
            if (b.IsChecked == true && nb.Stack != stack) R.SetNotebookStack(nb.Id, stack);
            else if (b.IsChecked != true && nb.Stack == stack) R.SetNotebookStack(nb.Id, null);
        }
    }

    private UIElement WorkspaceButton()
    {
        var ws = R.Workspace;
        var name = ws?.Name ?? "Workspace";
        var avatar = new Border
        {
            Width = 22, Height = 22, CornerRadius = new CornerRadius(5), Background = B("PAccent"),
            Child = new TextBlock { Text = name[..1].ToUpperInvariant(), FontSize = 12, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
        };
        var g = new Grid { ColumnSpacing = 8 };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.Children.Add(avatar);
        var label = V(0, T(name, 14, semibold: true), T(R.User?.Email ?? "", 11, "PMuted"));
        Grid.SetColumn(label, 1); g.Children.Add(label);
        var chev = I("", 10); Grid.SetColumn(chev, 2); g.Children.Add(chev);
        var b = Flat(g, pad: 8);
        b.HorizontalAlignment = HorizontalAlignment.Stretch;
        b.HorizontalContentAlignment = HorizontalAlignment.Stretch;
        b.Margin = new Thickness(0, 4, 0, 6);

        var menu = new MenuFlyout();
        foreach (var w in R.Workspaces)
        {
            var item = new ToggleMenuFlyoutItem { Text = $"{w.Name}  ·  {w.Plan}", IsChecked = w.Id == R.WsId };
            item.Click += (_, _) => { R.SwitchWorkspace(w.Id); _history.Clear(); OpenNoteId = null; _ = R.SyncNow(); Navigate(new Route("home"), remember: false); };
            menu.Items.Add(item);
        }
        menu.Items.Add(new MenuFlyoutSeparator());
        var theme = R.Pref("theme") ?? "system";
        var themeMenu = Sub("Appearance", "");
        foreach (var (k, l) in new[] { ("system", "Use system setting"), ("light", "Light"), ("dark", "Dark") })
        {
            var t = new ToggleMenuFlyoutItem { Text = l, IsChecked = theme == k };
            t.Click += async (_, _) => { R.SetPref("theme", k == "system" ? null : k); await Alert(Root, "Appearance", T("Restart PlioPad to apply the new theme.", 14)); };
            themeMenu.Items.Add(t);
        }
        menu.Items.Add(themeMenu);
        menu.Items.Add(Item("Sync now   F5", () => _ = R.SyncNow(), ""));
        menu.Items.Add(Item("Quick capture   Ctrl+Alt+N", () => QuickCapture.Show(), ""));
        menu.Items.Add(Item("Keyboard shortcuts", () => _ = ShowShortcuts(), ""));
        menu.Items.Add(Item("Open PlioPad on the web", () => _ = Windows.System.Launcher.LaunchUriAsync(new Uri(R.Server)), ""));
        menu.Items.Add(new MenuFlyoutSeparator());
        menu.Items.Add(Item("Sign out", async () =>
        {
            if (!await Confirm(Root, "Sign out?", "Notes that haven't synced yet will be lost. PlioPad syncs them first if you're online.", "Sign out")) return;
            await R.SyncNow();
            await R.SignOut();
            SignedOut();
        }, "", true));
        b.Flyout = menu;
        return b;
    }

    private async Task ShowShortcuts()
    {
        var rows = new (string, string)[]
        {
            ("Ctrl+K", "Search and commands"), ("Ctrl+N", "New note"), ("Ctrl+Shift+N", "New database"), ("Ctrl+D", "Today's daily note"),
            ("Ctrl+Alt+N", "Quick capture from anywhere in Windows"), ("Ctrl+Shift+O", "Open the note in its own window"), ("Ctrl+\\", "Show or hide the sidebar"),
            ("Alt+Left", "Back"), ("Ctrl+1 / 2 / 3 / 4", "Home / Tasks / All notes / PlioSphere"), ("F5", "Sync now"),
            ("", ""), ("In the editor", ""), ("/", "Insert a block"), ("[[", "Link to another note"), ("# ## ###", "Headings"), ("- or *", "Bulleted list"),
            ("1.", "Numbered list"), ("[]", "To-do"), (">", "Quote"), ("```", "Code"), ("Ctrl+B / I / E", "Bold, italic, code"), ("Ctrl+Shift+S", "Strikethrough"),
            ("Tab / Shift+Tab", "Indent / outdent"), ("Alt+Shift+↑/↓", "Move block"), ("Ctrl+Enter", "Check a to-do"), ("Ctrl+Shift+D", "Duplicate block"),
        };
        var g = new Grid { ColumnSpacing = 24, RowSpacing = 6 };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.ColumnDefinitions.Add(new ColumnDefinition());
        for (int i = 0; i < rows.Length; i++)
        {
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var k = T(rows[i].Item1, 13, "PMuted", semibold: true); Grid.SetRow(k, i); g.Children.Add(k);
            var v = T(rows[i].Item2, 13, rows[i].Item1 == "In the editor" ? "PText" : "PText", semibold: rows[i].Item1 == "In the editor"); Grid.SetRow(v, i); Grid.SetColumn(v, 1); g.Children.Add(v);
            if (rows[i].Item1 == "In the editor") { Grid.SetColumn(k, 0); k.Text = "In the editor"; k.Foreground = B("PText"); v.Text = ""; }
        }
        await Alert(Root, "Keyboard shortcuts", g);
    }
}
