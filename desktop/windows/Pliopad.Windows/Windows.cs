using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
using Pliopad.Core;
using System.Runtime.InteropServices;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>A note in its own window, for side-by-side work across monitors.</summary>
public sealed class NoteWindow : Window, INoteHost
{
    private static readonly List<NoteWindow> Open_ = [];
    private readonly Grid _root = new();
    private NoteView _view;

    public Window Window => this;
    public XamlRoot Root => _root.XamlRoot;

    private NoteWindow(string id)
    {
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Pliopad.ico"));
        AppWindow.Resize(new Windows.Graphics.SizeInt32(900, 900));
        ExtendsContentIntoTitleBar = true;
        _root.Background = B("PBg");
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(32) });
        _root.RowDefinitions.Add(new RowDefinition());
        var bar = new Border { Background = B("PBg") };
        _root.Children.Add(bar);
        SetTitleBar(bar);
        _view = Show(id);
        Content = _root;
        _root.KeyboardAccelerators.Add(Key(Windows.System.VirtualKey.W, Windows.System.VirtualKeyModifiers.Control, Close));
        _root.KeyboardAcceleratorPlacementMode = Microsoft.UI.Xaml.Input.KeyboardAcceleratorPlacementMode.Hidden;
        Closed += (_, _) => { _view.Flush(); Open_.Remove(this); };
    }

    private NoteView Show(string id)
    {
        if (_view != null) { _view.Flush(); _root.Children.Remove(_view); }
        var v = new NoteView(this, id);
        Grid.SetRow(v, 1);
        _root.Children.Add(v);
        Title = (App.Repo.Note(id)?.DisplayTitle ?? "Note") + " – PlioPad";
        return v;
    }

    /// <summary>Links inside a note window open in the same window.</summary>
    public void OpenNote(string id) { App.Repo.TrackVisit(id); _view = Show(id); }

    public static void Open(string id)
    {
        if (Open_.FirstOrDefault(w => w._view.NoteId == id) is { } existing) { existing.Activate(); return; }
        App.Main?.FlushOpenNote();
        var w = new NoteWindow(id);
        Open_.Add(w);
        w.Activate();
    }

    public static void ExternalChangeAll() { foreach (var w in Open_) w._view.ExternalChange(); }
    public static void CloseAll() { foreach (var w in Open_.ToList()) w.Close(); }
}

/// <summary>
/// Ctrl+Alt+N from anywhere in Windows opens a small capture window; Ctrl+Enter files the thought into Inbox.
/// Uses RegisterHotKey on the main window, so it works while Pliopad is in the background.
/// </summary>
public static class QuickCapture
{
    private const int HotkeyId = 0x504C;
    private const int WM_HOTKEY = 0x0312;
    private static nint _hwnd;
    private static SubclassProc? _proc; // kept alive for the native callback
    private static Window? _window;

    private delegate nint SubclassProc(nint hWnd, uint msg, nint wParam, nint lParam, nint id, nint data);
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(nint hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(nint hWnd, int id);
    [DllImport("comctl32.dll")] private static extern bool SetWindowSubclass(nint hWnd, SubclassProc proc, nint id, nint data);
    [DllImport("comctl32.dll")] private static extern nint DefSubclassProc(nint hWnd, uint msg, nint wParam, nint lParam);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint hWnd);

    public static bool Registered { get; private set; }

    public static void Register(Window main)
    {
        if (_hwnd != 0) return;
        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(main);
        _proc = (h, msg, w, l, id, data) =>
        {
            if (msg == WM_HOTKEY && (int)w == HotkeyId) { main.DispatcherQueue.TryEnqueue(Show); return 0; }
            return DefSubclassProc(h, msg, w, l);
        };
        SetWindowSubclass(_hwnd, _proc, 1, 0);
        // MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 'N'
        Registered = RegisterHotKey(_hwnd, HotkeyId, 0x0002 | 0x0001 | 0x4000, 0x4E);
    }

    public static void Unregister() { if (_hwnd != 0) UnregisterHotKey(_hwnd, HotkeyId); }

    public static void Show()
    {
        var R = App.Repo;
        if (!R.SignedIn || !R.CanWrite) return;
        if (_window != null) { _window.Activate(); return; }
        var w = new Window { Title = "Quick capture – PlioPad", ExtendsContentIntoTitleBar = true };
        _window = w;
        w.AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Pliopad.ico"));
        w.AppWindow.Resize(new Windows.Graphics.SizeInt32(560, 360));
        if (w.AppWindow.Presenter is OverlappedPresenter p) { p.IsAlwaysOnTop = true; p.IsMaximizable = false; p.IsMinimizable = false; }
        var area = DisplayArea.GetFromWindowId(w.AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        w.AppWindow.Move(new Windows.Graphics.PointInt32(area.X + (area.Width - 560) / 2, area.Y + area.Height / 5));

        var box = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, PlaceholderText = "Capture a thought…  The first line becomes the title. Markdown works: - [ ] to-dos, # headings.", FontSize = 15 };
        Bare(box);
        box.Padding = new Thickness(0, 6, 0, 6);
        var notebooks = R.Notebooks();
        var nbPick = new ComboBox { ItemsSource = notebooks.Select(n => $"{n.Icon ?? "📓"}  {n.Name}").ToList(), MinWidth = 180 };
        var def = R.DefaultNotebook();
        nbPick.SelectedIndex = Math.Max(0, notebooks.FindIndex(n => n.Id == def));
        var pin = new CheckBox { Content = "Pin it", MinWidth = 0 };
        var save = new Button { Content = "Save  Ctrl+Enter", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };

        void Save()
        {
            var text = box.Text.Replace("\r", "\n").Trim();
            if (text.Length == 0) { w.Close(); return; }
            var lines = text.Split('\n');
            var title = lines[0].TrimStart('#', ' ').Trim();
            var body = Blocks.FromMarkdown(string.Join("\n", lines.Skip(1)));
            var nb = nbPick.SelectedIndex >= 0 && nbPick.SelectedIndex < notebooks.Count ? notebooks[nbPick.SelectedIndex].Id : null;
            var id = R.CreateNote(title.Length > 120 ? title[..120] : title, body, nb);
            if (pin.IsChecked == true) R.SetPinned(id, true);
            w.Close();
        }
        save.Click += (_, _) => Save();
        box.PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Windows.System.VirtualKey.Enter && Ctrl()) { e.Handled = true; Save(); }
            else if (e.Key == Windows.System.VirtualKey.Escape) { e.Handled = true; w.Close(); }
        };

        var root = new Grid { Background = B("PBg"), Padding = new Thickness(20, 8, 20, 16), RowSpacing = 10 };
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(28) });
        root.RowDefinitions.Add(new RowDefinition());
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var head = H(8, I("", 13, "PAccent"), T("Quick capture", 13, "PMuted", semibold: true));
        root.Children.Add(head);
        w.SetTitleBar(head);
        Grid.SetRow(box, 1); root.Children.Add(box);
        var foot = new Grid();
        foot.ColumnDefinitions.Add(new ColumnDefinition());
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        foot.Children.Add(H(12, nbPick, pin));
        Grid.SetColumn(save, 1); foot.Children.Add(save);
        Grid.SetRow(foot, 2); root.Children.Add(foot);
        w.Content = root;
        w.Closed += (_, _) => _window = null;
        w.Activate();
        SetForegroundWindow(WinRT.Interop.WindowNative.GetWindowHandle(w));
        box.Loaded += (_, _) => box.Focus(FocusState.Programmatic);
    }
}

/// <summary>Native Windows notifications for note reminders (checked every 30 seconds, also while minimized).</summary>
public sealed class Reminders
{
    private readonly MainWindow _main;
    private readonly HashSet<string> _shown;
    private bool _ok;

    public Reminders(MainWindow main)
    {
        _main = main;
        _shown = (App.Repo.Store.Get("reminders.shown") ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        try
        {
            AppNotificationManager.Default.NotificationInvoked += (_, e) => main.DispatcherQueue.TryEnqueue(() => Invoked(e.Arguments));
            AppNotificationManager.Default.Register();
            _ok = true;
        }
        catch (Exception) { _ok = false; }
        var t = main.DispatcherQueue.CreateTimer();
        t.Interval = TimeSpan.FromSeconds(30);
        t.Tick += (_, _) => Check();
        t.Start();
        Check();
    }

    private void Invoked(IDictionary<string, string> args)
    {
        if (args.TryGetValue("done", out var doneId)) { App.Repo.ReminderDone(doneId); return; }
        if (args.TryGetValue("note", out var id))
        {
            _main.OpenNote(id);
            _main.Activate();
        }
    }

    private void Check()
    {
        var R = App.Repo;
        if (!R.SignedIn || !_ok) return;
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var n in R.Notes().Where(n => n.ReminderAt is { } at && at <= now && at > now - 86_400_000 && !n.ReminderDone))
        {
            var key = n.Id + ":" + n.ReminderAt;
            if (!_shown.Add(key)) continue;
            var toast = new AppNotificationBuilder()
                .AddArgument("note", n.Id)
                .AddText("⏰ " + n.DisplayTitle)
                .AddText(string.IsNullOrWhiteSpace(n.Plain) ? "Reminder" : n.Plain.Length > 120 ? n.Plain[..120] + "…" : n.Plain)
                .AddButton(new AppNotificationButton("Open").AddArgument("note", n.Id))
                .AddButton(new AppNotificationButton("Mark done").AddArgument("done", n.Id))
                .BuildNotification();
            try { AppNotificationManager.Default.Show(toast); } catch { }
        }
        R.Store.Set("reminders.shown", string.Join("|", _shown.TakeLast(200)));
    }
}
