using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>The Evernote-style middle pane: notes in the current notebook, stack, tag, search, trash…</summary>
public sealed partial class MainWindow
{
    private TextBox? _searchBox;
    private ListView? _list;
    private string _lastListKey = "";

    private (string Title, string Icon, List<Note> Notes) ListSpec()
    {
        var notes = R.Notes();
        var nbs = R.Notebooks();
        var sort = R.Pref("sort") ?? "updated";
        IEnumerable<Note> Sorted(IEnumerable<Note> l) => sort switch
        {
            "created" => l.OrderByDescending(n => n.CreatedAt),
            "title" => l.OrderBy(n => n.DisplayTitle, StringComparer.CurrentCultureIgnoreCase),
            _ => l.OrderByDescending(n => n.UpdatedAt),
        };
        // Database rows live inside their database, not in note lists.
        var dbIds = notes.Where(n => n.Kind == "db").Select(n => n.Id).ToHashSet();
        var top = notes.Where(n => n.ParentId == null || !dbIds.Contains(n.ParentId)).ToList();
        switch (Route.Kind)
        {
            case "notebook":
                var nb = nbs.FirstOrDefault(x => x.Id == Route.Arg);
                return (nb?.Name ?? "Notebook", nb?.Icon ?? "📓", Sorted(top.Where(n => n.NotebookId == Route.Arg)).ToList());
            case "stack":
                var ids = nbs.Where(x => x.Stack == Route.Arg).Select(x => x.Id).ToHashSet();
                return (Route.Arg ?? "Stack", "📚", Sorted(top.Where(n => n.NotebookId != null && ids.Contains(n.NotebookId))).ToList());
            case "tag":
                var tag = R.Tags().FirstOrDefault(t => t.Id == Route.Arg);
                return ("#" + (tag?.Name ?? "tag"), "#", Sorted(top.Where(n => n.TagIds.Contains(Route.Arg!))).ToList());
            case "pinned": return ("Shortcuts", "⭐", Sorted(top.Where(n => n.Pinned)).ToList());
            case "trash": return ("Trash", "🗑️", R.Store.Trash(R.WsId));
            case "templates": return ("Templates", "🧩", R.Store.Templates(R.WsId));
            case "search": return ("Search", "🔎", string.IsNullOrWhiteSpace(Route.Arg) ? [] : R.Search(Route.Arg));
            default: return ("All notes", "📄", Sorted(top).ToList());
        }
    }

    private void RenderList()
    {
        var (title, icon, notes) = ListSpec();
        var key = Route.Kind + "|" + Route.Arg;
        var fresh = key != _lastListKey;
        _lastListKey = key;
        var scroll = !fresh && _list != null ? FindScroll(_list)?.VerticalOffset ?? 0 : 0;

        _listPane.Children.Clear();
        _listPane.RowDefinitions.Clear();
        _listPane.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _listPane.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var head = new Grid { Padding = new Thickness(16, 12, 8, 8), RowSpacing = 6 };
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        head.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var titleRow = H(8, new TextBlock { Text = icon, FontSize = 18, VerticalAlignment = VerticalAlignment.Center }, T(title, 18, bold: true));
        head.Children.Add(titleRow);
        var actions = H(0);
        Grid.SetColumn(actions, 1);
        head.Children.Add(actions);

        if (Route.Kind == "trash")
        {
            if (notes.Count > 0 && R.CanWrite)
                actions.Children.Add(Flat(T("Empty", 13, "PRed"), async () =>
                {
                    if (await Confirm(Root, "Empty the trash?", $"{notes.Count} notes will be deleted for good on every device.", "Empty trash")) R.EmptyTrash();
                }));
        }
        else if (Route.Kind != "search")
        {
            var sort = R.Pref("sort") ?? "updated";
            var sortMenu = new MenuFlyout();
            foreach (var (k, l) in new[] { ("updated", "Last edited"), ("created", "Created"), ("title", "Title") })
            {
                var it = new ToggleMenuFlyoutItem { Text = l, IsChecked = sort == k };
                it.Click += (_, _) => { R.SetPref("sort", k); RenderList(); };
                sortMenu.Items.Add(it);
            }
            var sortBtn = IconButton("", () => { }, "Sort");
            sortBtn.Flyout = sortMenu;
            actions.Children.Add(sortBtn);
            if (R.CanWrite && Route.Kind != "templates")
                actions.Children.Add(IconButton("", () => NewNote(Route.Kind == "notebook" ? Route.Arg : null), "New note (Ctrl+N)"));
            if (Route.Kind == "notebook" && R.CanWrite)
            {
                var more = IconButton("", () => { }, "Notebook");
                var nb = R.Notebooks().FirstOrDefault(x => x.Id == Route.Arg);
                if (nb != null) more.Flyout = NotebookRow(nb, 0, 0).ContextFlyout;
                actions.Children.Add(more);
            }
        }

        if (Route.Kind == "search")
        {
            _searchBox ??= NewSearchBox();
            if (_searchBox.Text != (Route.Arg ?? "")) _searchBox.Text = Route.Arg ?? "";
            (_searchBox.Parent as Panel)?.Children.Remove(_searchBox);
            Grid.SetRow(_searchBox, 1);
            Grid.SetColumnSpan(_searchBox, 2);
            head.Children.Add(_searchBox);
            if (fresh) DispatcherQueue.TryEnqueue(() => _searchBox.Focus(FocusState.Programmatic));
        }
        else
        {
            var count = T($"{notes.Count} note{(notes.Count == 1 ? "" : "s")}", 12, "PMuted");
            Grid.SetRow(count, 1);
            head.Children.Add(count);
        }
        _listPane.Children.Add(head);

        _list = new ListView { SelectionMode = ListViewSelectionMode.Single, IsItemClickEnabled = true, Padding = new Thickness(6, 0, 6, 12) };
        foreach (var n in notes) _list.Items.Add(NoteCard(n));
        _list.ItemClick += (_, e) => { if (e.ClickedItem is FrameworkElement f && f.Tag is string id) Navigate(Route, id); };
        var sel = notes.FindIndex(n => n.Id == OpenNoteId);
        if (sel >= 0) _list.SelectedIndex = sel;
        Grid.SetRow(_list, 1);
        _listPane.Children.Add(_list);
        if (notes.Count == 0)
        {
            var empty = T(Route.Kind switch { "trash" => "Trash is empty", "search" => string.IsNullOrWhiteSpace(Route.Arg) ? "Type to search titles and text.\nTry notebook:, tag:, is:todo, is:pinned" : "No matches", "templates" => "Mark a note as a template from its ⋯ menu", _ => "No notes here yet" }, 13, "PMuted");
            empty.TextWrapping = TextWrapping.Wrap;
            empty.TextAlignment = TextAlignment.Center;
            empty.Margin = new Thickness(24, 40, 24, 0);
            empty.HorizontalAlignment = HorizontalAlignment.Center;
            Grid.SetRow(empty, 1);
            _listPane.Children.Add(empty);
        }
        if (scroll > 0) _list.Loaded += (_, _) => FindScroll(_list)?.ChangeView(null, scroll, null, true);
    }

    private TextBox NewSearchBox()
    {
        var box = new TextBox { PlaceholderText = "Search notes", Margin = new Thickness(0, 4, 8, 0) };
        box.TextChanged += (_, _) => { if (Route.Kind == "search" && box.Text != Route.Arg) { Route = new Route("search", box.Text); RenderList(); box.Focus(FocusState.Programmatic); box.SelectionStart = box.Text.Length; } };
        return box;
    }

    private static ScrollViewer? FindScroll(DependencyObject d)
    {
        if (d is ScrollViewer s) return s;
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(d); i++) if (FindScroll(VisualTreeHelper.GetChild(d, i)) is { } r) return r;
        return null;
    }

    private FrameworkElement NoteCard(Note n)
    {
        var nb = n.NotebookId != null ? R.Notebooks().FirstOrDefault(x => x.Id == n.NotebookId) : null;
        var snippet = n.Plain.Replace('\n', ' ');
        if (snippet.Length > 160) snippet = snippet[..160];
        var title = T((n.Kind == "db" ? "▦ " : n.Icon != null ? n.Icon + " " : "") + n.DisplayTitle, 14, semibold: true);
        var body = T(snippet, 13, "PMuted");
        body.TextWrapping = TextWrapping.Wrap;
        body.MaxLines = 2;
        var metaText = (Route.Kind == "trash" && n.TrashedAt is { } t ? "Deleted " + RelTime(t) : RelTime(n.UpdatedAt)) + (nb != null && Route.Kind != "notebook" ? "  ·  " + nb.Name : "");
        var meta = H(6, n.Pinned ? I("", 11, "POrange") : null, n.ReminderAt != null && !n.ReminderDone ? I("", 11, "PAccent") : null,
            n.Dirty ? I("", 11, "PFaint") : null, T(metaText, 12, "PFaint"));
        var card = V(3, title, string.IsNullOrWhiteSpace(snippet) ? null : body, meta);
        card.Padding = new Thickness(10, 10, 6, 10);
        card.Tag = n.Id;
        if (n.Dirty) ToolTipService.SetToolTip(meta.Children.OfType<FontIcon>().LastOrDefault() ?? (UIElement)meta, "Waiting to sync");
        card.ContextFlyout = NoteMenu(n, forList: true);
        return card;
    }

    /// <summary>The ⋯ / right-click menu for a note, shared by the list and the note header.</summary>
    public MenuFlyout NoteMenu(Note n, bool forList)
    {
        if (n.TrashedAt != null)
            return Menu(
                Item("Restore", () => R.Restore(n.Id), ""),
                Item("Delete forever", async () => { if (await Confirm(Root, "Delete forever?", $"“{n.DisplayTitle}” will be removed on every device.")) R.DeleteForever(n.Id); }, "", true));
        var move = new MenuFlyoutSubItem { Text = "Move to", Icon = new FontIcon { Glyph = "", FontFamily = Symbols } };
        foreach (var nb in R.Notebooks()) move.Items.Add(Item($"{nb.Icon ?? "📓"}  {nb.Name}" + (nb.Stack != null ? $"  ·  {nb.Stack}" : ""), () => R.MoveTo(n.Id, nb.Id)));
        if (move.Items.Count == 0) move.IsEnabled = false;
        var canWrite = R.CanWrite;
        return Menu(
            forList ? Item("Open in new window", () => NoteWindow.Open(n.Id), "") : null,
            canWrite ? Item(n.Pinned ? "Remove from shortcuts" : "Add to shortcuts", () => R.SetPinned(n.Id, !n.Pinned), "") : null,
            canWrite ? move : null,
            canWrite ? Item("Duplicate", () => { if (R.Duplicate(n.Id) is { } id) OpenNote(id); }, "") : null,
            canWrite && n.IsTemplate ? Item("New note from template", () => { if (R.Duplicate(n.Id, fromTemplate: true) is { } id) { R.SetTemplate(id, false); OpenNote(id); } }, "") : null,
            canWrite ? Item(n.IsTemplate ? "Stop using as template" : "Use as template", () => R.SetTemplate(n.Id, !n.IsTemplate), "") : null,
            Item("Copy as Markdown", () =>
            {
                var dp = new Windows.ApplicationModel.DataTransfer.DataPackage();
                dp.SetText("# " + n.DisplayTitle + "\n\n" + Blocks.ToMarkdownLines(Blocks.Parse(n.Content)));
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
            }, ""),
            Item("Export to Markdown file…", () => _ = ExportMarkdown(n), ""),
            canWrite ? new MenuFlyoutSeparator() : null,
            canWrite ? Item("Move to trash", () => R.Trash(n.Id), "", true) : null);
    }

    private async Task ExportMarkdown(Note n)
    {
        var picker = new Windows.Storage.Pickers.FileSavePicker { SuggestedFileName = string.Concat(n.DisplayTitle.Split(Path.GetInvalidFileNameChars())) };
        picker.FileTypeChoices.Add("Markdown", [".md"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync();
        if (file == null) return;
        await Windows.Storage.FileIO.WriteTextAsync(file, "# " + n.DisplayTitle + "\n\n" + Blocks.ToMarkdownLines(Blocks.Parse(n.Content)));
    }
}
