using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using System.Text.RegularExpressions;
using Windows.UI.Text;

namespace Pliopad;

/// <summary>Small builders so views read top-down. All controls are plain WinUI.</summary>
public static partial class Ui
{
    public static Brush B(string key) => (Brush)Application.Current.Resources[key];
    public static readonly FontFamily Mono = new("Cascadia Mono, Consolas");
    public static readonly FontFamily Symbols = new("Segoe Fluent Icons, Segoe MDL2 Assets");

    public static TextBlock T(string text, double size = 14, string fg = "PText", bool bold = false, bool semibold = false) => new()
    {
        Text = text, FontSize = size, Foreground = B(fg), TextTrimming = TextTrimming.CharacterEllipsis,
        FontWeight = bold ? FontWeights.Bold : semibold ? FontWeights.SemiBold : FontWeights.Normal, VerticalAlignment = VerticalAlignment.Center,
    };

    public static FontIcon I(string glyph, double size = 14, string fg = "PMuted") => new() { Glyph = glyph, FontSize = size, FontFamily = Symbols, Foreground = B(fg) };

    public static StackPanel H(double spacing, params UIElement?[] kids)
    {
        var p = new StackPanel { Orientation = Orientation.Horizontal, Spacing = spacing };
        foreach (var k in kids) if (k != null) p.Children.Add(k);
        return p;
    }

    public static StackPanel V(double spacing, params UIElement?[] kids)
    {
        var p = new StackPanel { Spacing = spacing };
        foreach (var k in kids) if (k != null) p.Children.Add(k);
        return p;
    }

    /// <summary>A quiet, borderless button (hover shows a soft gray fill).</summary>
    public static Button Flat(object content, Action? click = null, string? tip = null, double pad = 6)
    {
        var b = new Button { Content = content, Padding = new Thickness(pad, pad * 0.66, pad, pad * 0.66), CornerRadius = new CornerRadius(5), MinWidth = 0, MinHeight = 0 };
        if (click != null) b.Click += (_, _) => click();
        if (tip != null) ToolTipService.SetToolTip(b, tip);
        return b;
    }

    public static Button IconButton(string glyph, Action click, string tip, double size = 15) => Flat(I(glyph, size), click, tip, 6);

    /// <summary>Sidebar/list row: icon, label, optional right-aligned trailing text.</summary>
    public static Button Row(string iconText, string label, Action click, string? trailing = null, bool selected = false, double indent = 0, bool glyph = false)
    {
        var g = new Grid { ColumnSpacing = 8 };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(20) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        UIElement ic = glyph ? I(iconText, 14) : new TextBlock { Text = iconText, FontSize = 14, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        g.Children.Add(ic);
        var t = T(label, 14, "PText");
        Grid.SetColumn(t, 1); g.Children.Add(t);
        if (trailing != null) { var c = T(trailing, 12, "PFaint"); Grid.SetColumn(c, 2); g.Children.Add(c); }
        var b = Flat(g, click, pad: 6);
        b.HorizontalAlignment = HorizontalAlignment.Stretch;
        b.HorizontalContentAlignment = HorizontalAlignment.Stretch;
        b.Padding = new Thickness(8 + indent, 4, 10, 4);
        if (selected) b.Background = B("PSelected");
        return b;
    }

    public static Border Card(UIElement child, double pad = 14) => new()
    {
        Child = child, Padding = new Thickness(pad), CornerRadius = new CornerRadius(10), Background = B("PCard"),
        BorderBrush = B("PBorder"), BorderThickness = new Thickness(1),
    };

    public static Border Divider() => new() { Height = 1, Background = B("PBorder"), Margin = new Thickness(0, 6, 0, 6) };

    public static TextBox Input(string placeholder, string text = "") => new() { PlaceholderText = placeholder, Text = text };

    /// <summary>Makes a text box blend into the page (no box, no focus underline) for editor use.</summary>
    public static T2 Bare<T2>(T2 box) where T2 : Control
    {
        var clear = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        foreach (var k in new[] { "TextControlBackground", "TextControlBackgroundPointerOver", "TextControlBackgroundFocused", "TextControlBackgroundDisabled",
                     "TextControlBorderBrush", "TextControlBorderBrushPointerOver", "TextControlBorderBrushFocused" })
            box.Resources[k] = clear;
        box.Resources["TextControlBorderThemeThicknessFocused"] = new Thickness(0);
        box.Resources["TextControlForeground"] = B("PText");
        box.Resources["TextControlForegroundFocused"] = B("PText");
        box.Resources["TextControlForegroundPointerOver"] = B("PText");
        box.Resources["TextControlPlaceholderForeground"] = B("PFaint");
        box.Resources["TextControlPlaceholderForegroundFocused"] = B("PFaint");
        box.Resources["TextControlPlaceholderForegroundPointerOver"] = B("PFaint");
        box.Background = clear;
        box.BorderThickness = new Thickness(0);
        box.Padding = new Thickness(0, 3, 0, 3);
        box.MinHeight = 0;
        return box;
    }

    public static MenuFlyoutItem Item(string text, Action run, string? glyph = null, bool danger = false)
    {
        var i = new MenuFlyoutItem { Text = text };
        if (glyph != null) i.Icon = new FontIcon { Glyph = glyph, FontFamily = Symbols };
        if (danger) i.Foreground = B("PRed");
        i.Click += (_, _) => run();
        return i;
    }

    public static MenuFlyoutSubItem Sub(string text, string? glyph, params MenuFlyoutItemBase[] items)
    {
        var s = new MenuFlyoutSubItem { Text = text };
        if (glyph != null) s.Icon = new FontIcon { Glyph = glyph, FontFamily = Symbols };
        foreach (var i in items) s.Items.Add(i);
        return s;
    }

    public static MenuFlyout Menu(params MenuFlyoutItemBase?[] items)
    {
        var m = new MenuFlyout();
        foreach (var i in items) if (i != null) m.Items.Add(i);
        return m;
    }

    public static string RelTime(long ms)
    {
        var d = DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(ms);
        if (d.TotalMinutes < 1) return "just now";
        if (d.TotalHours < 1) return $"{(int)d.TotalMinutes}m ago";
        if (d.TotalDays < 1) return $"{(int)d.TotalHours}h ago";
        if (d.TotalDays < 7) return $"{(int)d.TotalDays}d ago";
        return DateTimeOffset.FromUnixTimeMilliseconds(ms).LocalDateTime.ToString("MMM d");
    }

    public static string LocalTime(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).LocalDateTime.ToString("ddd MMM d, h:mm tt");

    // ---- dialogs ----

    public static async Task<string?> Prompt(XamlRoot root, string title, string value = "", string placeholder = "", string ok = "Save")
    {
        var box = new TextBox { Text = value, PlaceholderText = placeholder, MinWidth = 320 };
        box.SelectAll();
        var dlg = new ContentDialog { XamlRoot = root, Title = title, Content = box, PrimaryButtonText = ok, CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary };
        box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { e.Handled = true; dlg.Hide(); box.Tag = "ok"; } };
        var r = await dlg.ShowAsync();
        return r == ContentDialogResult.Primary || box.Tag as string == "ok" ? box.Text : null;
    }

    public static async Task<bool> Confirm(XamlRoot root, string title, string body, string ok = "Delete")
    {
        var dlg = new ContentDialog { XamlRoot = root, Title = title, Content = body, PrimaryButtonText = ok, CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Close };
        return await dlg.ShowAsync() == ContentDialogResult.Primary;
    }

    public static async Task Alert(XamlRoot root, string title, UIElement body)
    {
        var dlg = new ContentDialog { XamlRoot = root, Title = title, Content = new ScrollViewer { Content = body, MaxHeight = 520 }, CloseButtonText = "Close" };
        await dlg.ShowAsync();
    }

    public static void Toast(FrameworkElement anchor, string message)
    {
        var tip = new TeachingTip { Subtitle = message, IsLightDismissEnabled = true, PreferredPlacement = TeachingTipPlacementMode.BottomRight };
        if (anchor is Panel p) { p.Children.Add(tip); tip.Closed += (_, _) => p.Children.Remove(tip); }
        else return;
        tip.IsOpen = true;
        var timer = anchor.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(3);
        timer.IsRepeating = false;
        timer.Tick += (_, _) => tip.IsOpen = false;
        timer.Start();
    }

    // ---- inline Markdown → rich text ----

    [GeneratedRegex(@"\*\*(.+?)\*\*|~~(.+?)~~|`([^`]+)`|\[([^\]]*)\]\(([^)]+)\)|(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)|@(\d{4}-\d{2}-\d{2})")]
    private static partial Regex InlineRe();

    /// <summary>Renders **bold**, *italic*, ~~strike~~, `code`, [links](url|note:id) and @dates into a paragraph.</summary>
    public static Paragraph Inline(string text, Action<string> openLink, double size, bool strike = false)
    {
        var p = new Paragraph();
        int at = 0;
        foreach (Match m in InlineRe().Matches(text))
        {
            if (m.Index > at) p.Inlines.Add(Run(text[at..m.Index], strike));
            if (m.Groups[1].Success) p.Inlines.Add(new Bold { Inlines = { Run(m.Groups[1].Value, strike) } });
            else if (m.Groups[2].Success) p.Inlines.Add(Run(m.Groups[2].Value, true));
            else if (m.Groups[3].Success)
            {
                var r = Run(m.Groups[3].Value, strike);
                r.FontFamily = Mono; r.Foreground = B("PRed"); r.FontSize = size * 0.88;
                p.Inlines.Add(r);
            }
            else if (m.Groups[4].Success)
            {
                var target = m.Groups[5].Value;
                var link = new Hyperlink { UnderlineStyle = UnderlineStyle.Single, Foreground = B(target.StartsWith("note:") ? "PText" : "PAccent") };
                link.Inlines.Add(new Run { Text = (target.StartsWith("note:") ? "↗ " : "") + m.Groups[4].Value });
                link.Click += (_, _) => openLink(target);
                p.Inlines.Add(link);
            }
            else if (m.Groups[6].Success) p.Inlines.Add(new Italic { Inlines = { Run(m.Groups[6].Value, strike) } });
            else if (m.Groups[7].Success)
            {
                var due = m.Groups[7].Value;
                var today = DateTime.Today.ToString("yyyy-MM-dd");
                var r = new Run { Text = "📅 " + (due == today ? "Today" : DateTime.TryParse(due, out var d) ? d.ToString("MMM d") : due), FontSize = size * 0.9 };
                r.Foreground = B(string.CompareOrdinal(due, today) < 0 ? "PRed" : due == today ? "POrange" : "PAccent");
                p.Inlines.Add(r);
            }
            at = m.Index + m.Length;
        }
        if (at < text.Length) p.Inlines.Add(Run(text[at..], strike));
        return p;
    }

    private static Run Run(string s, bool strike) => new() { Text = s, TextDecorations = strike ? TextDecorations.Strikethrough : TextDecorations.None };

    public static void OnEnter(TextBox box, Action run) => box.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) { e.Handled = true; run(); } };

    public static string Greeting()
    {
        var h = DateTime.Now.Hour;
        return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    }

    public static bool Ctrl() => Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Control).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
    public static bool Shift() => Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Shift).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
    public static bool Alt() => Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Windows.System.VirtualKey.Menu).HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);

    public static KeyboardAccelerator Key(Windows.System.VirtualKey key, Windows.System.VirtualKeyModifiers mods, Action run)
    {
        var a = new KeyboardAccelerator { Key = key, Modifiers = mods };
        a.Invoked += (_, e) => { e.Handled = true; run(); };
        return a;
    }
}

/// <summary>A full-page view that scrolls vertically (ScrollViewer itself is sealed in WinUI).</summary>
public abstract class ScrollPage : UserControl
{
    protected readonly ScrollViewer Sv = new() { HorizontalScrollMode = ScrollMode.Disabled, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
    protected ScrollPage() { Content = Sv; Background = Ui.B("PBg"); }
    // Wrapped in a full-width grid: the scroll presenter otherwise centers a MaxWidth page by its desired width and it overflows.
    protected UIElement Body { set { var g = new Grid(); g.Children.Add(value); Sv.Content = g; } }
    protected double VerticalOffset => Sv.VerticalOffset;
    protected void ChangeView(double? x, double? y, float? zoom, bool instant) => Sv.ChangeView(x, y, zoom, instant);
}
