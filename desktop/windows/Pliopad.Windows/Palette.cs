using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using Windows.System;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>Ctrl+K: one box to jump to any note or run any command.</summary>
public sealed partial class MainWindow : INoteHost
{
    Window INoteHost.Window => this;

    private (string Icon, string Label, string? Keys, Action Run)[] Commands() =>
    [
        ("📝", "New note", "Ctrl+N", () => NewNote()),
        ("▦", "New database", "Ctrl+Shift+N", NewDatabase),
        ("📅", "Today's daily note", "Ctrl+D", DailyNote),
        ("⚡", "Quick capture", "Ctrl+Alt+N", () => QuickCapture.Show()),
        ("📓", "New notebook", null, () => _ = NewNotebook(null)),
        ("🏡", "Go to Home", "Ctrl+1", () => Navigate(new Route("home"))),
        ("☑️", "Go to Tasks", "Ctrl+2", () => Navigate(new Route("tasks"))),
        ("📄", "Go to All notes", "Ctrl+3", () => Navigate(new Route("all"))),
        ("🪐", "Open PlioSphere", "Ctrl+4", () => Navigate(new Route("sphere"))),
        ("🔎", "Full search with filters", "Ctrl+Shift+F", () => Navigate(new Route("search", ""))),
        ("🗑️", "Go to Trash", null, () => Navigate(new Route("trash"))),
        ("🔄", "Sync now", "F5", () => _ = R.SyncNow()),
        ("◧", "Toggle sidebar", "Ctrl+\\", ToggleSidebar),
        ("🪟", "Open this note in a new window", "Ctrl+Shift+O", () => { if (OpenNoteId != null) NoteWindow.Open(OpenNoteId); }),
    ];

    public void ShowPalette(string initial = "")
    {
        if (!R.SignedIn) return;
        _overlay.Children.Clear();
        _overlay.Background = B("PScrim");
        _overlay.Visibility = Visibility.Visible;

        var box = new TextBox { PlaceholderText = "Search notes or type a command…", Text = initial, FontSize = 16, BorderThickness = new Thickness(0), Padding = new Thickness(16, 14, 16, 14) };
        Bare(box);
        box.Padding = new Thickness(16, 14, 16, 14);
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, IsItemClickEnabled = true, MaxHeight = 420, Padding = new Thickness(6) };
        var panel = new Border
        {
            Width = 640, CornerRadius = new CornerRadius(12), Background = B("PBg"), BorderBrush = B("PBorder"), BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 90, 0, 0),
            Child = V(0, box, new Border { Height = 1, Background = B("PBorder") }, list,
                new Border { Padding = new Thickness(16, 8, 16, 8), Child = T("↑↓ to move · Enter to open · Shift+Enter opens in a new window · Esc to close", 12, "PFaint") }),
            Shadow = new ThemeShadow(),
        };
        panel.Translation = new System.Numerics.Vector3(0, 0, 40);
        _overlay.Children.Add(panel);
        _overlay.Tapped += Dismiss;

        void Fill()
        {
            list.Items.Clear();
            var q = box.Text.Trim();
            foreach (var c in Commands().Where(c => q.Length > 0 && c.Label.Contains(q, StringComparison.OrdinalIgnoreCase)).Take(4))
                list.Items.Add(PaletteRow(c.Icon, c.Label, c.Keys, c.Run, null));
            var notes = q.Length == 0
                ? R.RecentIds().Select(R.Note).Where(n => n is { Deleted: false, TrashedAt: null }).Cast<Note>().Concat(R.Notes()).DistinctBy(n => n.Id).Take(8)
                : R.Search(q).Take(12);
            foreach (var n in notes)
            {
                var nb = R.Notebooks().FirstOrDefault(x => x.Id == n.NotebookId);
                list.Items.Add(PaletteRow(n.DisplayIcon, n.DisplayTitle, nb?.Name, () => OpenNote(n.Id), n.Id));
            }
            if (q.Length == 0) foreach (var c in Commands().Take(4)) list.Items.Add(PaletteRow(c.Icon, c.Label, c.Keys, c.Run, null));
            if (q.Length > 0 && R.CanWrite) list.Items.Add(PaletteRow("＋", $"New note “{q}”", null, () => NewNote(title: q), null));
            if (list.Items.Count > 0) list.SelectedIndex = 0;
        }
        void Run(object? item)
        {
            if (item is not FrameworkElement { Tag: ValueTuple<Action, string?> tag }) return;
            var (run, id) = tag;
            Close();
            if (Shift() && id != null) NoteWindow.Open(id); else run();
        }
        box.TextChanged += (_, _) => Fill();
        box.PreviewKeyDown += (_, e) =>
        {
            switch (e.Key)
            {
                case VirtualKey.Down: list.SelectedIndex = Math.Min(list.Items.Count - 1, list.SelectedIndex + 1); list.ScrollIntoView(list.SelectedItem); e.Handled = true; break;
                case VirtualKey.Up: list.SelectedIndex = Math.Max(0, list.SelectedIndex - 1); list.ScrollIntoView(list.SelectedItem); e.Handled = true; break;
                case VirtualKey.Enter: e.Handled = true; Run(list.SelectedItem); break;
                case VirtualKey.Escape: e.Handled = true; Close(); break;
            }
        };
        list.ItemClick += (_, e) => Run(e.ClickedItem);
        Fill();
        box.Loaded += (_, _) => { box.Focus(FocusState.Programmatic); box.SelectionStart = box.Text.Length; };

        void Dismiss(object s, TappedRoutedEventArgs e) { if (e.OriginalSource == _overlay) Close(); }
        void Close()
        {
            _overlay.Tapped -= Dismiss;
            _overlay.Visibility = Visibility.Collapsed;
            _overlay.Children.Clear();
        }
    }

    private static FrameworkElement PaletteRow(string icon, string label, string? trailing, Action run, string? noteId)
    {
        var g = new Grid { ColumnSpacing = 12, Padding = new Thickness(6, 6, 6, 6), Tag = (run, noteId) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(22) });
        g.ColumnDefinitions.Add(new ColumnDefinition());
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.Children.Add(new TextBlock { Text = icon, FontSize = 15, HorizontalAlignment = HorizontalAlignment.Center });
        var t = T(label, 14); Grid.SetColumn(t, 1); g.Children.Add(t);
        if (trailing != null) { var k = T(trailing, 12, "PFaint"); Grid.SetColumn(k, 2); g.Children.Add(k); }
        return g;
    }
}
