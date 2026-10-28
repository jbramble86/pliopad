using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using System.Text.Json.Nodes;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>A window that can show notes (the main window or a separate note window).</summary>
public interface INoteHost
{
    Window Window { get; }
    XamlRoot Root { get; }
    void OpenNote(string id);
}

/// <summary>A page: breadcrumb bar, icon and title, properties, the block editor (or a database), and backlinks.</summary>
public sealed class NoteView : Grid
{
    private Repo R => App.Repo;
    private readonly INoteHost _host;
    public string NoteId { get; }
    private Note _note;
    private BlockEditor _editor = null!;
    private readonly TextBox _title;
    private readonly StackPanel _page = new() { Spacing = 0 };
    private readonly ScrollViewer _scroll = new() { HorizontalScrollMode = ScrollMode.Disabled };
    private readonly Grid _bar = new() { Height = 44, Padding = new Thickness(12, 0, 8, 0) };
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _saveTimer;
    private bool _pending;
    private bool ReadOnly => !R.CanWrite || _note.Locked || _note.TrashedAt != null;

    public NoteView(INoteHost host, string id)
    {
        _host = host;
        NoteId = id;
        _note = R.Note(id)!;
        Background = B("PBg");
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Children.Add(_bar);
        SetRow(_scroll, 1);
        Children.Add(_scroll);

        _saveTimer = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread().CreateTimer();
        _saveTimer.Interval = TimeSpan.FromMilliseconds(500);
        _saveTimer.IsRepeating = false;
        _saveTimer.Tick += (_, _) => Flush();

        _title = Bare(new TextBox
        {
            FontSize = 40, FontWeight = Microsoft.UI.Text.FontWeights.Bold, PlaceholderText = _note.Kind == "db" ? "Untitled database" : "Untitled",
            TextWrapping = TextWrapping.Wrap, AcceptsReturn = false, Text = _note.Title,
        });
        _title.TextChanged += (_, _) => { if (_title.Text != _note.Title) { _note.Title = _title.Text; Schedule(); } };
        _title.KeyDown += (_, e) =>
        {
            if (e.Key is Windows.System.VirtualKey.Enter or Windows.System.VirtualKey.Down) { e.Handled = true; _editor.FocusStart(); }
        };

        Build();
        Unloaded += (_, _) => Flush();
    }

    private void Build()
    {
        _note = R.Note(NoteId) ?? _note;
        _title.IsReadOnly = ReadOnly;
        BuildBar();
        _page.Children.Clear();
        _page.MaxWidth = _note.Kind == "db" ? 1400 : 760;
        _page.Padding = new Thickness(56, 28, 56, 0);
        _page.HorizontalAlignment = HorizontalAlignment.Stretch;

        // Icon (click to change), like Notion's page icon.
        var icon = Flat(new TextBlock { Text = _note.DisplayIcon, FontSize = 52 }, null, "Change icon", 4);
        icon.HorizontalAlignment = HorizontalAlignment.Left;
        icon.Margin = new Thickness(-6, 24, 0, 0);
        if (!ReadOnly) icon.Flyout = IconPicker();
        _page.Children.Add(icon);
        _page.Children.Add(_title);

        if (_note.TrashedAt != null) _page.Children.Add(Banner("This note is in the trash.", ("Restore", () => R.Restore(NoteId))));
        else if (_note.Locked) _page.Children.Add(Banner("This page is locked.", R.CanWrite ? ("Unlock", () => R.Update(NoteId, n => n.Locked = false)) : null));

        _page.Children.Add(PropertiesRow());

        _editor = new BlockEditor(Blocks.Parse(_note.Content))
        {
            ReadOnly = ReadOnly,
            LookupNote = R.Note,
            OpenLink = OpenLink,
            PickNote = () => Pickers.PickNote(_host.Root, NoteId),
            NewSubPage = () => R.CanWrite ? R.CreateNote("", [], null, NoteId, useDefaultNotebook: false) : null,
            PickImage = PickImage,
            ResolveSrc = R.Api.Absolute,
            FocusTitle = () => { _title.Focus(FocusState.Programmatic); _title.SelectionStart = _title.Text.Length; },
        };
        _editor.Changed += Schedule;
        _editor.Build();
        _editor.Margin = new Thickness(-48, 12, 0, 0);
        _page.Children.Add(_editor);

        if (_note.Kind == "db") _page.Children.Add(new DatabaseView(_host, NoteId));

        // A tall click target under the last block, so clicking below the text keeps writing.
        var tail = new Border { Height = 160, Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent) };
        tail.Tapped += (_, _) => _editor.ClickBelow();
        if (_note.Kind != "db") _page.Children.Add(tail);

        var back = R.Backlinks(NoteId);
        if (back.Count > 0)
        {
            _page.Children.Add(Divider());
            _page.Children.Add(T($"{back.Count} backlink{(back.Count == 1 ? "" : "s")}", 13, "PMuted", semibold: true));
            foreach (var n in back) { var r = Row(n.DisplayIcon, n.DisplayTitle, () => _host.OpenNote(n.Id)); r.Margin = new Thickness(-8, 0, 0, 0); _page.Children.Add(r); }
        }
        _page.Children.Add(new Border { Height = 80 });
        _scroll.Content = _page;
    }

    private Border Banner(string text, (string, Action)? action)
    {
        var row = H(12, T(text, 13, "PText"));
        if (action is { } a) row.Children.Add(Flat(T(a.Item1, 13, "PAccent", semibold: true), a.Item2));
        return new Border { Child = row, Background = B("PCallout"), CornerRadius = new CornerRadius(6), Padding = new Thickness(12, 6, 12, 6), Margin = new Thickness(0, 8, 0, 0) };
    }

    // ---- top bar ----

    private void BuildBar()
    {
        _bar.Children.Clear();
        _bar.ColumnDefinitions.Clear();
        _bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var crumbs = H(2);
        crumbs.VerticalAlignment = VerticalAlignment.Center;
        if (_note.NotebookId != null && R.Notebooks().FirstOrDefault(x => x.Id == _note.NotebookId) is { } nb && App.Main != null)
        {
            if (nb.Stack != null) crumbs.Children.Add(Flat(T(nb.Stack, 13, "PMuted"), () => App.Main.Navigate(new Route("stack", nb.Stack)), pad: 4));
            if (nb.Stack != null) crumbs.Children.Add(T("/", 13, "PFaint"));
            crumbs.Children.Add(Flat(T($"{nb.Icon ?? "📓"} {nb.Name}", 13, "PMuted"), () => App.Main.Navigate(new Route("notebook", nb.Id)), pad: 4));
            crumbs.Children.Add(T("/", 13, "PFaint"));
        }
        var parents = new List<Note>();
        for (var p = _note.ParentId != null ? R.Note(_note.ParentId) : null; p != null && parents.Count < 4; p = p.ParentId != null ? R.Note(p.ParentId) : null) parents.Insert(0, p);
        foreach (var p in parents)
        {
            crumbs.Children.Add(Flat(T($"{p.DisplayIcon} {p.DisplayTitle}", 13, "PMuted"), () => _host.OpenNote(p.Id), pad: 4));
            crumbs.Children.Add(T("/", 13, "PFaint"));
        }
        crumbs.Children.Add(T($"{_note.DisplayIcon} {_note.DisplayTitle}", 13, "PText"));
        _bar.Children.Add(crumbs);

        var actions = H(0);
        SetColumn(actions, 1);
        actions.VerticalAlignment = VerticalAlignment.Center;
        actions.Children.Add(T("Edited " + RelTime(_note.UpdatedAt), 12, "PFaint"));
        ((FrameworkElement)actions.Children[0]).Margin = new Thickness(0, 0, 8, 0);
        if (R.CanWrite && _note.TrashedAt == null)
        {
            actions.Children.Add(Flat(T("Share", 13), () => _ = Share(), "Publish to the web", 8));
            actions.Children.Add(IconButton(_note.Pinned ? "" : "", () => { R.SetPinned(NoteId, !_note.Pinned); _note.Pinned = !_note.Pinned; BuildBar(); }, _note.Pinned ? "Remove from shortcuts" : "Add to shortcuts"));
            var comments = IconButton("", () => _ = ShowComments(), "Comments");
            actions.Children.Add(comments);
            if (R.AiEnabled)
            {
                var ai = IconButton("", () => { }, "AI");
                ai.Flyout = AiMenu();
                actions.Children.Add(ai);
            }
        }
        var more = IconButton("", () => { }, "More");
        var menu = App.Main?.NoteMenu(_note, forList: _host is not NoteWindow) ?? new MenuFlyout();
        if (_note.TrashedAt == null)
        {
            menu.Items.Insert(0, Item("Version history", () => _ = ShowHistory(), ""));
            if (R.CanWrite)
            {
                menu.Items.Insert(0, Item(_note.ReminderAt != null && !_note.ReminderDone ? "Change reminder" : "Set reminder", () => _ = SetReminder(), ""));
                menu.Items.Insert(0, Item(_note.Locked ? "Unlock page" : "Lock page", () => { R.Update(NoteId, n => n.Locked = !n.Locked); Build(); }, ""));
            }
            if (_host is not NoteWindow) menu.Items.Insert(0, Item("Open in new window   Ctrl+Shift+O", () => NoteWindow.Open(NoteId), ""));
        }
        more.Flyout = menu;
        actions.Children.Add(more);
        _bar.Children.Add(actions);
    }

    private Flyout IconPicker()
    {
        var grid = new GridView { SelectionMode = ListViewSelectionMode.None, IsItemClickEnabled = true, MaxWidth = 340, MaxHeight = 260 };
        foreach (var e in "📄 📝 📓 📔 📒 📚 🗒️ 📌 ⭐ ✅ 💡 🔥 🎯 🚀 📅 🗓️ 📊 📈 💼 🏠 🧠 🎨 🎵 🍳 ✈️ 🏃 💰 🛒 🔧 🧪 🌱 ❤️ 😀 🐛 🔒 🌍 🧩 🏷️ 📦 🎓".Split(' '))
            grid.Items.Add(new TextBlock { Text = e, FontSize = 22, Padding = new Thickness(2) });
        var fly = new Flyout();
        grid.ItemClick += (_, e) => { R.SetIcon(NoteId, ((TextBlock)e.ClickedItem).Text); fly.Hide(); Build(); };
        fly.Content = V(8, grid, Flat(T("Remove icon", 13, "PMuted"), () => { R.SetIcon(NoteId, null); fly.Hide(); Build(); }));
        return fly;
    }

    // ---- properties: tags, reminder, database row fields ----

    private UIElement PropertiesRow()
    {
        var p = new StackPanel { Spacing = 4, Margin = new Thickness(0, 8, 0, 0) };
        // Rows of a database show that database's fields.
        if (_note.ParentId != null && R.Note(_note.ParentId) is { Kind: "db" } db)
            p.Children.Add(DatabaseView.RowFields(_host, db, _note, ReadOnly));

        var chips = new WrapPanelLite { Spacing = 6 };
        var tags = R.Tags();
        foreach (var tid in _note.TagIds)
        {
            var t = tags.FirstOrDefault(x => x.Id == tid);
            if (t == null) continue;
            var chip = Flat(T("#" + t.Name, 13, "PMuted"), ReadOnly ? null : () => R.SetTags(NoteId, _note.TagIds.Where(x => x != tid)), ReadOnly ? null : "Click to remove", 6);
            chip.Background = B("PCallout");
            chips.Children.Add(chip);
        }
        if (!ReadOnly)
        {
            var add = Flat(H(4, I("", 12), T(_note.TagIds.Count == 0 ? "Add a tag" : "Tag", 13, "PMuted")), null, null, 6);
            add.Flyout = TagFlyout();
            chips.Children.Add(add);
        }
        if (_note.ReminderAt is { } at && !_note.ReminderDone)
        {
            var due = at < DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var rem = Flat(H(4, I("", 12, due ? "PRed" : "PAccent"), T(LocalTime(at), 13, due ? "PRed" : "PAccent")), () => _ = SetReminder(), "Change reminder", 6);
            chips.Children.Add(rem);
        }
        p.Children.Add(chips);
        return p;
    }

    private Flyout TagFlyout()
    {
        var fly = new Flyout();
        var box = new TextBox { PlaceholderText = "Find or create a tag", Width = 240 };
        var list = new StackPanel();
        void Fill()
        {
            list.Children.Clear();
            var q = box.Text.Trim().TrimStart('#');
            var all = R.Tags().Where(t => !_note.TagIds.Contains(t.Id) && t.Name.Contains(q, StringComparison.OrdinalIgnoreCase)).Take(8);
            foreach (var t in all) list.Children.Add(Row("#", t.Name, () => { R.SetTags(NoteId, [.. _note.TagIds, t.Id]); fly.Hide(); }));
            if (q.Length > 0 && !R.Tags().Any(t => t.Name.Equals(q, StringComparison.OrdinalIgnoreCase)))
                list.Children.Add(Row("+", $"Create “{q}”", () => { var id = R.CreateTag(q); R.SetTags(NoteId, [.. _note.TagIds, id]); fly.Hide(); }));
        }
        box.TextChanged += (_, _) => Fill();
        OnEnter(box, () => { if (list.Children.FirstOrDefault() is Button b) { b.Focus(FocusState.Programmatic); ((Microsoft.UI.Xaml.Automation.Provider.IInvokeProvider)new Microsoft.UI.Xaml.Automation.Peers.ButtonAutomationPeer(b)).Invoke(); } });
        fly.Opened += (_, _) => { box.Text = ""; Fill(); box.Focus(FocusState.Programmatic); };
        fly.Content = V(6, box, list);
        return fly;
    }

    private async Task SetReminder()
    {
        var now = DateTime.Now;
        var start = _note.ReminderAt is { } at ? DateTimeOffset.FromUnixTimeMilliseconds(at).LocalDateTime : now.AddHours(1);
        var date = new CalendarDatePicker { Date = start.Date, Header = "Date" };
        var time = new TimePicker { Time = start.TimeOfDay, Header = "Time", MinuteIncrement = 5 };
        var quick = H(6,
            Flat(T("In 1 hour", 13, "PAccent"), () => { date.Date = now.AddHours(1).Date; time.Time = now.AddHours(1).TimeOfDay; }),
            Flat(T("Tonight", 13, "PAccent"), () => { date.Date = now.Date; time.Time = new TimeSpan(19, 0, 0); }),
            Flat(T("Tomorrow 9am", 13, "PAccent"), () => { date.Date = now.Date.AddDays(1); time.Time = new TimeSpan(9, 0, 0); }));
        var dlg = new ContentDialog
        {
            XamlRoot = _host.Root, Title = "Remind me", Content = V(12, quick, date, time),
            PrimaryButtonText = "Set reminder", SecondaryButtonText = _note.ReminderAt != null ? "Remove" : "", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary,
        };
        var r = await dlg.ShowAsync();
        if (r == ContentDialogResult.Secondary) R.SetReminder(NoteId, null);
        if (r != ContentDialogResult.Primary || date.Date is not { } d) return;
        var when = d.Date + time.Time;
        R.SetReminder(NoteId, new DateTimeOffset(when).ToUnixTimeMilliseconds());
    }

    // ---- editor plumbing ----

    private void OpenLink(string target)
    {
        if (target.StartsWith("note:")) { Flush(); _host.OpenNote(target[5..]); return; }
        if (Uri.TryCreate(R.Api.Absolute(target), UriKind.Absolute, out var u)) _ = Windows.System.Launcher.LaunchUriAsync(u);
    }

    private async Task<string?> PickImage()
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        foreach (var ext in new[] { ".png", ".jpg", ".jpeg", ".gif", ".webp" }) picker.FileTypeFilter.Add(ext);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(_host.Window));
        var file = await picker.PickSingleFileAsync();
        return file == null ? null : R.ImportImage(file.Path, App.DataDir);
    }

    private void Schedule()
    {
        _pending = true;
        _saveTimer.Stop();
        _saveTimer.Start();
    }

    public void Flush()
    {
        if (!_pending) return;
        _pending = false;
        _saveTimer.Stop();
        R.SaveContent(NoteId, _note.Title, _editor.Blocks);
    }

    public void FocusTitle() => DispatcherQueue.TryEnqueue(() => _title.Focus(FocusState.Programmatic));

    /// <summary>Synced edits from other devices appear when you're not in the middle of typing here.</summary>
    public void ExternalChange()
    {
        var fresh = R.Note(NoteId);
        if (fresh == null || _pending) return;
        var changed = fresh.Content != Blocks.Encode(_editor.Blocks) || fresh.Title != _title.Text;
        var meta = fresh.Pinned != _note.Pinned || fresh.Tags != _note.Tags || fresh.ReminderAt != _note.ReminderAt || fresh.Locked != _note.Locked
            || fresh.TrashedAt != _note.TrashedAt || fresh.Icon != _note.Icon || fresh.NotebookId != _note.NotebookId || fresh.Props != _note.Props || fresh.DbSchema != _note.DbSchema;
        if (!changed && !meta) { _note = fresh; return; }
        if (_editor.HasFocus || _title.FocusState != FocusState.Unfocused) { if (meta) { _note = fresh; BuildBar(); } return; }
        var offset = _scroll.VerticalOffset;
        _title.Text = fresh.Title;
        Build();
        _scroll.UpdateLayout();
        _scroll.ChangeView(null, offset, null, true);
    }

    // ---- online features ----

    private async Task<bool> PushFirst()
    {
        Flush();
        await R.SyncNow();
        if (R.Note(NoteId)?.Dirty == true) { await Alert(_host.Root, "You're offline", T("Connect to the internet to use this.", 14)); return false; }
        return true;
    }

    private MenuFlyout AiMenu() => Menu(
        Item("Summarize", () => _ = RunAi("summarize", "Summary"), ""),
        Item("Find action items", () => _ = RunAi("actions", "Action items"), ""),
        Item("Continue writing", () => _ = RunAi("continue", null), ""),
        Item("Suggest a title", () => _ = RunAi("title", null), ""));

    private async Task RunAi(string action, string? heading)
    {
        if (!await PushFirst()) return;
        var progress = new ContentDialog { XamlRoot = _host.Root, Title = "Thinking…", Content = new ProgressBar { IsIndeterminate = true, Width = 300 } };
        _ = progress.ShowAsync();
        try
        {
            var res = await R.Api.Ai(R.WsId, action, NoteId);
            progress.Hide();
            if (action == "title")
            {
                if (res.Title is { Length: > 0 } t) { _title.Text = t; _note.Title = t; Schedule(); }
                return;
            }
            var blocks = Blocks.FromMarkdown(res.Markdown ?? "");
            if (heading != null) blocks.Insert(0, new Block { T = "h3", X = heading });
            foreach (var b in blocks) _editor.Blocks.Add(b);
            _editor.Build();
            Schedule();
        }
        catch (Exception e) { progress.Hide(); await Alert(_host.Root, "AI", T(e.Message, 14)); }
    }

    private async Task Share()
    {
        if (!await PushFirst()) return;
        try
        {
            var on = _note.ShareSlug != null;
            var toggle = new ToggleSwitch { Header = "Publish to the web", IsOn = on, OnContent = "Anyone with the link can view", OffContent = "Only workspace members" };
            var link = new TextBox { IsReadOnly = true, Visibility = on ? Visibility.Visible : Visibility.Collapsed, Text = on ? R.Server + "/s/" + _note.ShareSlug : "" };
            var copy = Flat(T("Copy link", 13, "PAccent"), () =>
            {
                var dp = new Windows.ApplicationModel.DataTransfer.DataPackage(); dp.SetText(link.Text);
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dp);
            });
            copy.Visibility = link.Visibility;
            toggle.Toggled += async (_, _) =>
            {
                var r = await R.Api.Share(R.WsId, NoteId, toggle.IsOn);
                link.Text = r.Url ?? (r.Slug != null ? R.Server + "/s/" + r.Slug : "");
                link.Visibility = copy.Visibility = toggle.IsOn ? Visibility.Visible : Visibility.Collapsed;
                _ = R.SyncNow();
            };
            await Alert(_host.Root, "Share", V(10, toggle, link, copy));
        }
        catch (Exception e) { await Alert(_host.Root, "Share", T(e.Message, 14)); }
    }

    private async Task ShowComments()
    {
        if (!await PushFirst()) return;
        var list = new StackPanel { Spacing = 10, Width = 420 };
        async Task Load()
        {
            list.Children.Clear();
            foreach (var c in await R.Api.Comments(R.WsId, NoteId))
            {
                var body = T(c.Body, 14); body.TextWrapping = TextWrapping.Wrap;
                list.Children.Add(V(2, H(8, T(c.UserName, 13, semibold: true), T(RelTime(c.CreatedAt), 12, "PFaint")), body));
            }
            if (list.Children.Count == 0) list.Children.Add(T("No comments yet.", 13, "PMuted"));
        }
        try
        {
            await Load();
            var box = new TextBox { PlaceholderText = "Add a comment…", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 60 };
            var send = new Button { Content = "Comment", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
            send.Click += async (_, _) => { if (box.Text.Trim().Length == 0) return; await R.Api.AddComment(R.WsId, NoteId, box.Text.Trim()); box.Text = ""; await Load(); };
            await Alert(_host.Root, "Comments", V(12, list, box, send));
        }
        catch (Exception e) { await Alert(_host.Root, "Comments", T(e.Message, 14)); }
    }

    private async Task ShowHistory()
    {
        if (!await PushFirst()) return;
        try
        {
            var versions = await R.Api.Versions(R.WsId, NoteId);
            var list = new StackPanel { Spacing = 2, Width = 420 };
            ContentDialog? dlg = null;
            foreach (var v in versions)
            {
                var row = Row("🕓", $"{LocalTime(v.CreatedAt)}  ·  {v.UserName ?? "someone"}", async () =>
                {
                    dlg?.Hide();
                    if (!await Confirm(_host.Root, "Restore this version?", "The current content is kept in history too.", "Restore")) return;
                    var restored = await R.Api.RestoreVersion(R.WsId, v.Id);
                    R.Store.UpsertNote(restored.ToLocal(R.WsId));
                    R.Store.NotifyChanged();
                    _title.Text = restored.Title;
                    Build();
                }, "v" + v.Version);
                list.Children.Add(row);
            }
            if (versions.Count == 0) list.Children.Add(T("No earlier versions yet.", 13, "PMuted"));
            dlg = new ContentDialog { XamlRoot = _host.Root, Title = "Version history", Content = new ScrollViewer { Content = list, MaxHeight = 460 }, CloseButtonText = "Close" };
            await dlg.ShowAsync();
        }
        catch (Exception e) { await Alert(_host.Root, "Version history", T(e.Message, 14)); }
    }
}

/// <summary>A tiny wrapping row of chips (WinUI has no built-in wrap panel).</summary>
public sealed class WrapPanelLite : Panel
{
    public double Spacing { get; set; } = 6;

    protected override Windows.Foundation.Size MeasureOverride(Windows.Foundation.Size available)
    {
        double x = 0, y = 0, line = 0, width = 0;
        foreach (var c in Children)
        {
            c.Measure(new Windows.Foundation.Size(available.Width, double.PositiveInfinity));
            if (x > 0 && x + c.DesiredSize.Width > available.Width) { y += line + Spacing; x = 0; line = 0; }
            x += c.DesiredSize.Width + Spacing;
            line = Math.Max(line, c.DesiredSize.Height);
            width = Math.Max(width, x);
        }
        return new Windows.Foundation.Size(double.IsInfinity(available.Width) ? width : Math.Min(width, available.Width), y + line);
    }

    protected override Windows.Foundation.Size ArrangeOverride(Windows.Foundation.Size final)
    {
        double x = 0, y = 0, line = 0;
        foreach (var c in Children)
        {
            if (x > 0 && x + c.DesiredSize.Width > final.Width) { y += line + Spacing; x = 0; line = 0; }
            c.Arrange(new Windows.Foundation.Rect(x, y, c.DesiredSize.Width, c.DesiredSize.Height));
            x += c.DesiredSize.Width + Spacing;
            line = Math.Max(line, c.DesiredSize.Height);
        }
        return final;
    }
}
