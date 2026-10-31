using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using Windows.System;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>Where the main window is: a list (notebook, tag, …) or a full-page view (home, tasks, ask), plus the open note.</summary>
public sealed record Route(string Kind, string? Arg = null)
{
    public bool HasList => Kind is "all" or "notebook" or "stack" or "tag" or "pinned" or "trash" or "templates" or "search";
}

/// <summary>
/// The main window: Notion-style sidebar, an Evernote-style note list, and the page. Built from WinUI controls in code.
/// </summary>
public sealed partial class MainWindow : Window
{
    private Repo R => App.Repo;
    private readonly Grid _root = new();
    private readonly Grid _body = new();
    private readonly ScrollViewer _sidebarScroll = new() { HorizontalScrollMode = ScrollMode.Disabled };
    private readonly Border _sidebar = new();
    private readonly Grid _listPane = new();
    private readonly ContentControl _content = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Stretch };
    private readonly TextBlock _syncLabel = T("", 12, "PMuted");
    private readonly Grid _titleBar = new() { Height = 40 };
    private readonly Button _backButton;
    private readonly Grid _overlay = new() { Visibility = Visibility.Collapsed };

    public Route Route { get; private set; } = new("home");
    public string? OpenNoteId { get; private set; }
    private readonly Stack<(Route, string?)> _history = new();
    private NoteView? _noteView;
    private bool _sidebarHidden;
    private bool _refreshQueued;
    private readonly DispatcherQueueTimerWrapper _syncTimer;
    private Reminders? _reminders;

    public MainWindow()
    {
        Title = "PlioPad";
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Pliopad.ico"));
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1360, 860));
        ExtendsContentIntoTitleBar = true;
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;

        _backButton = IconButton("", GoBack, "Back (Alt+Left)", 12);
        _backButton.Visibility = Visibility.Collapsed;

        Content = _root;
        _root.Background = B("PBg");
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        BuildTitleBar();
        Grid.SetRow(_body, 1);
        _root.Children.Add(_body);
        Grid.SetRowSpan(_overlay, 2);
        _root.Children.Add(_overlay);

        _body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(252) });
        _body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(320) });
        _body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _sidebar.Background = B("PSidebar");
        _sidebar.BorderBrush = B("PBorder");
        _sidebar.BorderThickness = new Thickness(0, 0, 1, 0);
        _sidebar.Child = _sidebarScroll;
        _body.Children.Add(_sidebar);
        _listPane.BorderBrush = B("PBorder");
        _listPane.BorderThickness = new Thickness(0, 0, 1, 0);
        Grid.SetColumn(_listPane, 1);
        _body.Children.Add(_listPane);
        Grid.SetColumn(_content, 2);
        _body.Children.Add(_content);

        AddShortcuts();

        R.Store.Changed += QueueRefresh;
        R.SyncStatusChanged += () => DispatcherQueue.TryEnqueue(() => _syncLabel.Text = R.SyncStatus);
        _syncTimer = new DispatcherQueueTimerWrapper(DispatcherQueue, TimeSpan.FromSeconds(45), () => _ = R.SyncNow());
        // Coming back to the window syncs, but at most once a minute (focus changes are frequent).
        var lastFocusSync = DateTime.MinValue;
        Activated += (_, e) =>
        {
            if (e.WindowActivationState == WindowActivationState.Deactivated || !R.SignedIn || DateTime.Now - lastFocusSync < TimeSpan.FromMinutes(1)) return;
            lastFocusSync = DateTime.Now;
            _ = R.SyncNow();
        };
        Closed += (_, _) => { _noteView?.Flush(); QuickCapture.Unregister(); NoteWindow.CloseAll(); };

        if (R.SignedIn) Start(); else ShowSignIn();
    }

    // ---- title bar ----

    private void BuildTitleBar()
    {
        _titleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(252) });
        _titleBar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var left = new Border { Background = B("PSidebar"), BorderBrush = B("PBorder"), BorderThickness = new Thickness(0, 0, 1, 0) };
        var logo = new Image { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(Path.Combine(AppContext.BaseDirectory, "Assets", "Pliopad-64.png"))), Width = 18, Height = 18 };
        left.Child = H(8, logo, T("PlioPad", 13, "PMuted", semibold: true));
        ((StackPanel)left.Child).Margin = new Thickness(14, 0, 0, 0);
        ((StackPanel)left.Child).VerticalAlignment = VerticalAlignment.Center;
        _titleBar.Children.Add(left);
        var right = H(6, _backButton, _syncLabel);
        right.Margin = new Thickness(10, 0, 0, 0);
        right.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(right, 1);
        _titleBar.Children.Add(right);
        _root.Children.Add(_titleBar);
        SetTitleBar(_titleBar);
        _titleBar.Loaded += (_, _) => UpdateDragRegions();
        _titleBar.SizeChanged += (_, _) => UpdateDragRegions();
    }

    /// <summary>Lets the back button take clicks while the rest of the strip drags the window.</summary>
    private void UpdateDragRegions()
    {
        if (_titleBar.XamlRoot == null) return;
        var scale = _titleBar.XamlRoot.RasterizationScale;
        var src = Microsoft.UI.Input.InputNonClientPointerSource.GetForWindowId(AppWindow.Id);
        if (_backButton.Visibility == Visibility.Collapsed || _backButton.ActualWidth == 0) { src.ClearRegionRects(Microsoft.UI.Input.NonClientRegionKind.Passthrough); return; }
        var t = _backButton.TransformToVisual(null).TransformBounds(new Windows.Foundation.Rect(0, 0, _backButton.ActualWidth, _backButton.ActualHeight));
        src.SetRegionRects(Microsoft.UI.Input.NonClientRegionKind.Passthrough,
            [new Windows.Graphics.RectInt32((int)(t.X * scale), (int)(t.Y * scale), (int)(t.Width * scale), (int)(t.Height * scale))]);
    }

    // ---- start / sign in ----

    private void ShowSignIn()
    {
        _sidebar.Visibility = Visibility.Collapsed;
        _listPane.Visibility = Visibility.Collapsed;
        Grid.SetColumn(_content, 0);
        Grid.SetColumnSpan(_content, 3);
        _content.Content = new SignInView(() => DispatcherQueue.TryEnqueue(Start));
    }

    private void Start()
    {
        _sidebar.Visibility = Visibility.Visible;
        Grid.SetColumnSpan(_content, 1);
        _ = R.RefreshMe();
        _ = R.SyncNow();
        _syncTimer.Start();
        _reminders ??= new Reminders(this);
        QuickCapture.Register(this);
        var start = R.Pref("route") is { } saved && saved.Split('|') is [var k, var a] ? new Route(k, a == "" ? null : a) : new Route("home");
        Navigate(start, null, remember: false);
        if (AutoTest.Folder != null) _ = AutoTest.Run(this, _root);
    }

    public void SignedOut()
    {
        _syncTimer.Stop();
        _history.Clear();
        OpenNoteId = null;
        ShowSignIn();
    }

    // ---- routing ----

    public void Navigate(Route route, string? noteId = null, bool remember = true)
    {
        if (remember && (Route != route || OpenNoteId != noteId)) _history.Push((Route, OpenNoteId));
        _overlay.Visibility = Visibility.Collapsed;
        _overlay.Children.Clear();
        _noteView?.Flush();
        Route = route;
        OpenNoteId = noteId;
        if (!route.HasList && route.Kind != "note") R.SetPref("route", route.Kind + "|" + route.Arg);
        else if (route.HasList && route.Kind != "search") R.SetPref("route", route.Kind + "|" + route.Arg);
        Render();
    }

    public void OpenNote(string id)
    {
        R.TrackVisit(id);
        var n = R.Note(id);
        // The note list always stays beside the open note: the current list if the note is in it, otherwise All notes.
        Navigate(Route.HasList && n != null && InCurrentList(n) ? Route : new Route("all"), id);
    }

    private bool InCurrentList(Note n) => Route.Kind switch
    {
        "all" or "search" => true,
        "notebook" => n.NotebookId == Route.Arg,
        "stack" => R.Notebooks().Any(nb => nb.Id == n.NotebookId && nb.Stack == Route.Arg),
        "tag" => n.TagIds.Contains(Route.Arg ?? ""),
        "pinned" => n.Pinned,
        "trash" => n.TrashedAt != null,
        "templates" => n.IsTemplate,
        _ => false,
    };

    public void GoBack()
    {
        if (_history.Count == 0) return;
        _noteView?.Flush();
        (Route, OpenNoteId) = _history.Pop();
        Render();
    }

    private void Render()
    {
        if (!R.SignedIn) return;
        _backButton.Visibility = _history.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        DispatcherQueue.TryEnqueue(UpdateDragRegions);
        RenderSidebar();
        var showList = Route.HasList;
        _listPane.Visibility = showList ? Visibility.Visible : Visibility.Collapsed;
        _body.ColumnDefinitions[0].Width = new GridLength(_sidebarHidden ? 0 : 252);
        _sidebar.Visibility = _sidebarHidden ? Visibility.Collapsed : Visibility.Visible;
        _body.ColumnDefinitions[1].Width = showList ? new GridLength(320) : new GridLength(0);
        if (showList) RenderList();

        if (OpenNoteId != null && R.Note(OpenNoteId) is { } note)
        {
            if (_noteView?.NoteId != note.Id) { _noteView = new NoteView(this, note.Id); }
            _content.Content = _noteView;
            Title = note.DisplayTitle + " – PlioPad";
            return;
        }
        _noteView = null;
        Title = "PlioPad";
        _content.Content = Route.Kind switch
        {
            "home" => new HomeView(this),
            "tasks" => new TasksView(this),
            "ask" => new AskView(this),
            "sphere" => new SphereView(this),
            _ => EmptyPane(),
        };
    }

    private UIElement EmptyPane()
    {
        var p = V(10,
            new TextBlock { Text = "📝", FontSize = 40, HorizontalAlignment = HorizontalAlignment.Center },
            T("Select a note, or create a new one", 15, "PMuted"),
            H(8, Flat(T("New note  Ctrl+N", 13, "PAccent"), () => NewNote()), Flat(T("Search  Ctrl+K", 13, "PAccent"), () => ShowPalette())));
        foreach (var c in p.Children) ((FrameworkElement)c).HorizontalAlignment = HorizontalAlignment.Center;
        p.VerticalAlignment = VerticalAlignment.Center;
        return p;
    }

    /// <summary>Store changes (local edits, sync) refresh the chrome once per frame, never mid-typing in the editor.</summary>
    private void QueueRefresh()
    {
        if (_refreshQueued) return;
        _refreshQueued = true;
        DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () =>
        {
            _refreshQueued = false;
            if (!R.SignedIn) { if (_content.Content is not SignInView) SignedOut(); return; }
            RenderSidebar();
            if (Route.HasList) RenderList();
            if (OpenNoteId != null && R.Note(OpenNoteId) == null) { OpenNoteId = null; Render(); return; }
            _noteView?.ExternalChange();
            NoteWindow.ExternalChangeAll();
            if (_content.Content is IRefreshable r) r.Refresh();
        });
    }

    // ---- actions shared by views ----

    public string? NewNote(string? notebookId = null, string title = "", List<Block>? blocks = null)
    {
        if (!R.CanWrite) return null;
        notebookId ??= Route.Kind == "notebook" ? Route.Arg : null;
        var id = R.CreateNote(title, blocks ?? [], notebookId);
        Navigate(Route.HasList && Route.Kind is "notebook" or "all" ? Route : new Route("all"), id);
        _noteView?.FocusTitle();
        return id;
    }

    public void NewDatabase()
    {
        if (!R.CanWrite) return;
        var id = R.NewDatabase(Route.Kind == "notebook" ? Route.Arg : null);
        Navigate(new Route("all"), id);
        _noteView?.FocusTitle();
    }

    public void DailyNote() { if (R.CanWrite) OpenNote(R.DailyNote()); }

    public void FlushOpenNote() => _noteView?.Flush();

    public void ToggleSidebar(){ _sidebarHidden = !_sidebarHidden; Render(); }

    public XamlRoot Root => _root.XamlRoot;
    public Panel ToastHost => _root;

    private void AddShortcuts()
    {
        _root.KeyboardAcceleratorPlacementMode = KeyboardAcceleratorPlacementMode.Hidden;
        var C = VirtualKeyModifiers.Control;
        void Add(VirtualKey k, VirtualKeyModifiers m, Action a) => _root.KeyboardAccelerators.Add(Key(k, m, () => { if (R.SignedIn) a(); }));
        Add(VirtualKey.K, C, () => ShowPalette());
        Add(VirtualKey.P, C, () => ShowPalette());
        Add(VirtualKey.F, C | VirtualKeyModifiers.Shift, () => Navigate(new Route("search", "")));
        Add(VirtualKey.N, C, () => NewNote());
        Add(VirtualKey.N, C | VirtualKeyModifiers.Shift, () => NewDatabase());
        Add(VirtualKey.D, C, DailyNote);
        Add((VirtualKey)220, C, ToggleSidebar); // Ctrl+\
        Add(VirtualKey.Left, VirtualKeyModifiers.Menu, GoBack);
        Add(VirtualKey.F5, VirtualKeyModifiers.None, () => _ = R.SyncNow());
        Add(VirtualKey.Number1, C, () => Navigate(new Route("home")));
        Add(VirtualKey.Number2, C, () => Navigate(new Route("tasks")));
        Add(VirtualKey.Number3, C, () => Navigate(new Route("all")));
        Add(VirtualKey.Number4, C, () => Navigate(new Route("sphere")));
        Add(VirtualKey.O, C | VirtualKeyModifiers.Shift, () => { if (OpenNoteId != null) NoteWindow.Open(OpenNoteId); });
    }
}

/// <summary>Views that can redraw themselves when synced data changes.</summary>
public interface IRefreshable { void Refresh(); }

public sealed class DispatcherQueueTimerWrapper
{
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer _t;
    public DispatcherQueueTimerWrapper(Microsoft.UI.Dispatching.DispatcherQueue q, TimeSpan every, Action tick)
    {
        _t = q.CreateTimer();
        _t.Interval = every;
        _t.IsRepeating = true;
        _t.Tick += (_, _) => tick();
    }
    public void Start() => _t.Start();
    public void Stop() => _t.Stop();
}
