using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Pliopad.Core;
using Windows.System;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>
/// Notion-style block editor. Each block is a native text box while you edit it and rich text when you don't,
/// so Markdown marks never clutter the page. Keyboard behaviour follows Notion: Enter splits, Backspace merges,
/// Tab indents, "/" inserts blocks, "[[" links notes, and "# ", "- ", "[] " … turn a line into a heading, list or to-do.
/// </summary>
public sealed class BlockEditor : StackPanel
{
    public static readonly (string T, string Label, string Icon, string Hint)[] Types =
    [
        ("p", "Text", "Aa", "Plain text"), ("h1", "Heading 1", "H1", "Big section heading"), ("h2", "Heading 2", "H2", "Medium heading"),
        ("h3", "Heading 3", "H3", "Small heading"), ("todo", "To-do list", "☑", "Track tasks"), ("ul", "Bulleted list", "•", "Simple list"),
        ("ol", "Numbered list", "1.", "Numbered list"), ("toggle", "Toggle list", "▸", "Hide content inside"), ("quote", "Quote", "❝", "Capture a quote"),
        ("callout", "Callout", "💡", "Make text stand out"), ("code", "Code", "</>", "Code snippet"), ("hr", "Divider", "—", "Separate sections"),
        ("img", "Image", "🖼", "Upload a picture"), ("page", "Page", "📄", "Embed a sub-page"),
    ];

    private readonly List<Block> _blocks;
    private readonly List<BlockView> _views = [];
    public Func<string, Note?> LookupNote { get; init; } = _ => null;
    public Action<string> OpenLink { get; init; } = _ => { };
    public Func<Task<string?>> PickNote { get; init; } = () => Task.FromResult<string?>(null);
    public Func<string?> NewSubPage { get; init; } = () => null;
    public Func<Task<string?>> PickImage { get; init; } = () => Task.FromResult<string?>(null);
    public Func<string, string> ResolveSrc { get; init; } = s => s;
    public Action? FocusTitle { get; init; }
    public bool ReadOnly { get; init; }
    public event Action? Changed;

    public BlockEditor(List<Block> blocks)
    {
        Spacing = 1;
        _blocks = blocks.Count > 0 ? blocks : [new Block()];
    }

    public List<Block> Blocks => _blocks;

    public void Build()
    {
        Children.Clear();
        _views.Clear();
        foreach (var b in _blocks) { var v = new BlockView(this, b); _views.Add(v); Children.Add(v); }
        Relayout();
    }

    /// <summary>Numbers, toggle visibility and indents after a structural change.</summary>
    internal void Relayout()
    {
        int n = 0; int? hideBelow = null;
        for (int i = 0; i < _blocks.Count; i++)
        {
            var b = _blocks[i];
            if (hideBelow != null && b.Indent <= hideBelow) hideBelow = null;
            _views[i].Visibility = hideBelow != null ? Visibility.Collapsed : Visibility.Visible;
            if (b.T == "toggle" && !b.Checked && hideBelow == null) hideBelow = b.Indent;
            n = b.T == "ol" ? (i > 0 && _blocks[i - 1].T == "ol" && _blocks[i - 1].Indent == b.Indent ? n + 1 : 1) : 0;
            _views[i].SetNumber(n);
        }
    }

    internal void Touch(Block b) { b.Touch(); Changed?.Invoke(); }

    internal int IndexOf(BlockView v) => _views.IndexOf(v);

    internal BlockView Insert(int index, Block b)
    {
        _blocks.Insert(index, b);
        var v = new BlockView(this, b);
        _views.Insert(index, v);
        Children.Insert(index, v);
        Relayout();
        Changed?.Invoke();
        return v;
    }

    internal void Remove(int index)
    {
        _blocks.RemoveAt(index);
        _views.RemoveAt(index);
        Children.RemoveAt(index);
        if (_blocks.Count == 0) Insert(0, new Block());
        Relayout();
        Changed?.Invoke();
    }

    /// <summary>Rebuilds one block's view (after its type changed).</summary>
    internal BlockView Rebuild(int index)
    {
        var v = new BlockView(this, _blocks[index]);
        _views[index] = v;
        Children[index] = v;
        Relayout();
        Changed?.Invoke();
        return v;
    }

    internal void Move(int index, int delta)
    {
        int to = index + delta;
        if (to < 0 || to >= _blocks.Count) return;
        var b = _blocks[index]; var v = _views[index];
        _blocks.RemoveAt(index); _views.RemoveAt(index); Children.RemoveAt(index);
        _blocks.Insert(to, b); _views.Insert(to, v); Children.Insert(to, v);
        b.Touch();
        Relayout();
        Changed?.Invoke();
        v.FocusAt(int.MaxValue);
    }

    internal void FocusBlock(int index, int caret)
    {
        // Skip hidden (collapsed toggle) and non-text blocks when moving with the arrows.
        if (index < 0) { FocusTitle?.Invoke(); return; }
        if (index >= _views.Count) return;
        _views[index].FocusAt(caret);
    }

    internal int NextVisible(int from, int dir)
    {
        for (int i = from + dir; i >= 0 && i < _views.Count; i += dir)
            if (_views[i].Visibility == Visibility.Visible && _views[i].IsText) return i;
        return dir < 0 ? -1 : _views.Count;
    }

    public void FocusStart() => FocusBlock(0, 0);
    public void FocusEnd() => FocusBlock(_views.Count - 1, int.MaxValue);

    public bool HasFocus => _views.Any(v => v.Editing);

    /// <summary>Clicking the empty space under the last block adds a paragraph there, like Notion.</summary>
    public void ClickBelow()
    {
        if (ReadOnly) return;
        var last = _blocks[^1];
        if (last.T == "p" && last.X.Length == 0) { FocusEnd(); return; }
        Insert(_blocks.Count, new Block()).FocusAt(0);
    }

    // ---- shared menus ----

    internal static List<MenuFlyoutItem> TypeItems(Action<string> pick, bool turnInto)
    {
        var items = new List<MenuFlyoutItem>();
        foreach (var (t, label, icon, _) in Types)
        {
            if (turnInto && t is "hr" or "img" or "page") continue;
            var it = new MenuFlyoutItem { Text = label, Icon = new FontIcon { Glyph = icon, FontFamily = new FontFamily("Segoe UI Emoji, Segoe UI") } };
            ToolTipService.SetToolTip(it, Types.First(x => x.T == t).Hint);
            it.Click += (_, _) => pick(t);
            items.Add(it);
        }
        return items;
    }

    internal MenuFlyout TypeMenu(Action<string> pick, bool turnInto)
    {
        var m = new MenuFlyout();
        foreach (var it in TypeItems(pick, turnInto)) m.Items.Add(it);
        return m;
    }

    internal async Task InsertSpecial(int index, string type)
    {
        switch (type)
        {
            case "hr":
                _blocks[index].T = "hr"; _blocks[index].X = ""; Rebuild(index);
                if (index == _blocks.Count - 1) Insert(index + 1, new Block()).FocusAt(0); else FocusBlock(index + 1, 0);
                break;
            case "img":
                if (await PickImage() is { } src) { _blocks[index].T = "img"; _blocks[index].X = ""; _blocks[index].Src = src; Rebuild(index); Insert(index + 1, new Block()).FocusAt(0); }
                break;
            case "page":
                if (NewSubPage() is { } id) { _blocks[index].T = "page"; _blocks[index].Src = id; _blocks[index].X = ""; Rebuild(index); Insert(index + 1, new Block()); OpenLink("note:" + id); }
                break;
        }
    }
}

/// <summary>One block row: hover gutter (+ and ⋮⋮), a prefix (bullet, number, checkbox…) and the content.</summary>
public sealed class BlockView : Grid
{
    private readonly BlockEditor _ed;
    private readonly Block _b;
    private TextBox? _box;
    private RichTextBlock? _rich;
    private TextBlock? _number;
    private readonly StackPanel _gutter;
    public bool Editing { get; private set; }
    public bool IsText => Core.Blocks.TextTypes.Contains(_b.T);

    private double FontSize => _b.T switch { "h1" => 30, "h2" => 24, "h3" => 19, _ => 16 };
    private Thickness TopGap => _b.T switch { "h1" => new Thickness(0, 22, 0, 2), "h2" => new Thickness(0, 16, 0, 1), "h3" => new Thickness(0, 10, 0, 1), _ => new Thickness(0, 1, 0, 1) };

    public BlockView(BlockEditor ed, Block b)
    {
        _ed = ed; _b = b;
        Margin = TopGap;
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(48) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(b.Indent * 26) });
        ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);

        _gutter = H(0);
        _gutter.Opacity = 0;
        _gutter.HorizontalAlignment = HorizontalAlignment.Right;
        _gutter.VerticalAlignment = VerticalAlignment.Top;
        _gutter.Margin = new Thickness(0, _b.T switch { "h1" => 8, "h2" => 5, "h3" => 2, _ => 0 }, 2, 0);
        if (!ed.ReadOnly)
        {
            var add = Ui.IconButton("", () => { }, "Click to add a block below", 12);
            add.Padding = new Thickness(3);
            add.Flyout = ed.TypeMenu(t => AddBelow(t), false);
            var handle = Ui.IconButton("", () => { }, "Block menu", 12);
            handle.Padding = new Thickness(3);
            handle.Flyout = HandleMenu();
            _gutter.Children.Add(add);
            _gutter.Children.Add(handle);
        }
        Children.Add(_gutter);
        PointerEntered += (_, _) => _gutter.Opacity = 1;
        PointerExited += (_, _) => _gutter.Opacity = 0;

        var prefix = Prefix();
        if (prefix != null) { SetColumn(prefix, 2); Children.Add(prefix); }
        var content = Content();
        SetColumn(content, 3);
        Children.Add(content);
    }

    public void SetNumber(int n) { if (_number != null) _number.Text = n + "."; }

    private FrameworkElement? Prefix()
    {
        FrameworkElement? el = _b.T switch
        {
            "ul" => new TextBlock { Text = (_b.Indent % 3) switch { 0 => "•", 1 => "◦", _ => "▪" }, FontSize = 18, Foreground = Ui.B("PText"), Margin = new Thickness(4, 1, 8, 0) },
            "ol" => _number = new TextBlock { Text = "1.", FontSize = 16, Foreground = Ui.B("PText"), Margin = new Thickness(2, 3, 6, 0), MinWidth = 18, TextAlignment = TextAlignment.Right },
            "todo" => TodoBox(),
            "toggle" => ToggleArrow(),
            _ => null,
        };
        if (el != null) el.VerticalAlignment = VerticalAlignment.Top;
        return el;
    }

    private CheckBox TodoBox()
    {
        var c = new CheckBox { IsChecked = _b.Checked, MinWidth = 0, Padding = new Thickness(0), Margin = new Thickness(0, -1, 6, 0), IsEnabled = !_ed.ReadOnly };
        c.Click += (_, _) => { _b.C = c.IsChecked == true ? true : null; _ed.Touch(_b); Refresh(); };
        return c;
    }

    private Button ToggleArrow()
    {
        var b = Ui.IconButton(_b.Checked ? "" : "", () => { }, _b.Checked ? "Collapse" : "Expand", 11);
        b.Padding = new Thickness(4);
        b.Margin = new Thickness(0, 1, 4, 0);
        b.Click += (_, _) =>
        {
            _b.C = _b.Checked ? null : true;
            ((FontIcon)b.Content).Glyph = _b.Checked ? "" : "";
            _ed.Touch(_b);
            _ed.Relayout();
        };
        return b;
    }

    // ---- content ----

    private FrameworkElement Content()
    {
        switch (_b.T)
        {
            case "hr":
                return new Border { Height = 1, Background = Ui.B("PBorder"), Margin = new Thickness(0, 12, 0, 12) };
            case "img":
                return ImageContent();
            case "page":
                var target = _b.Src != null ? _ed.LookupNote(_b.Src) : null;
                var page = Ui.Flat(Ui.H(8, new TextBlock { Text = target?.DisplayIcon ?? "📄", FontSize = 16 },
                    Underlined(target?.DisplayTitle ?? "Page not available")), () => { if (_b.Src != null) _ed.OpenLink("note:" + _b.Src); }, pad: 4);
                page.HorizontalAlignment = HorizontalAlignment.Left;
                return page;
            case "bookmark":
            case "file":
                var url = _b.Src ?? _b.X;
                var link = Ui.Flat(Ui.H(8, Ui.I(_b.T == "file" ? "" : "", 14), Underlined(_b.Cap ?? (string.IsNullOrEmpty(_b.X) ? url : _b.X))),
                    () => _ = Launcher.LaunchUriAsync(new Uri(_ed.ResolveSrc(url))), pad: 4);
                link.HorizontalAlignment = HorizontalAlignment.Left;
                return link;
        }
        var host = new Grid();
        _rich = new RichTextBlock { FontSize = FontSize, Foreground = Ui.B(_b.T == "todo" && _b.Checked ? "PMuted" : "PText"), TextWrapping = TextWrapping.Wrap, Padding = new Thickness(0, 3, 0, 3), IsTextSelectionEnabled = false };
        if (_b.T is "h1" or "h2" or "h3") _rich.FontWeight = FontWeights.SemiBold;
        if (_b.T == "code") { _rich.FontFamily = Ui.Mono; _rich.FontSize = 14; }
        if (_b.T == "quote") _rich.FontSize = 17;
        RenderRich();
        host.Children.Add(_rich);
        if (!_ed.ReadOnly)
        {
            host.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
            host.Tapped += (_, e) => { if (!Editing && e.OriginalSource is not Microsoft.UI.Xaml.Documents.Hyperlink) { e.Handled = true; FocusAt(int.MaxValue); } };
        }
        FrameworkElement result = host;
        if (_b.T == "quote") result = new Border { Child = host, BorderBrush = Ui.B("PText"), BorderThickness = new Thickness(3, 0, 0, 0), Padding = new Thickness(14, 0, 0, 0) };
        if (_b.T == "callout")
        {
            var g = new Grid { ColumnSpacing = 10 };
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.Children.Add(new TextBlock { Text = _b.Lang ?? "💡", FontSize = 18, Margin = new Thickness(0, 1, 0, 0) });
            SetColumn(host, 1); g.Children.Add(host);
            result = new Border { Child = g, Background = Ui.B("PCallout"), CornerRadius = new CornerRadius(6), Padding = new Thickness(14, 12, 16, 12), Margin = new Thickness(0, 4, 0, 4) };
        }
        if (_b.T == "code")
            result = new Border { Child = host, Background = Ui.B("PCode"), CornerRadius = new CornerRadius(6), Padding = new Thickness(18, 14, 18, 14), Margin = new Thickness(0, 4, 0, 4) };
        return result;
    }

    private static TextBlock Underlined(string s) => new() { Text = s, FontSize = 16, Foreground = Ui.B("PText"), TextDecorations = Windows.UI.Text.TextDecorations.Underline };

    private FrameworkElement ImageContent()
    {
        var src = _b.Src ?? "";
        var img = new Image { Stretch = Stretch.Uniform, MaxHeight = 560, HorizontalAlignment = HorizontalAlignment.Left };
        try
        {
            img.Source = src.StartsWith("local:") ? new BitmapImage(new Uri(src[6..])) : new BitmapImage(new Uri(_ed.ResolveSrc(src)));
        }
        catch (UriFormatException) { }
        var stack = Ui.V(6, new Border { Child = img, CornerRadius = new CornerRadius(4), HorizontalAlignment = HorizontalAlignment.Left });
        if (!string.IsNullOrEmpty(_b.Cap)) stack.Children.Add(Ui.T(_b.Cap!, 13, "PMuted"));
        stack.Margin = new Thickness(0, 6, 0, 6);
        return stack;
    }

    private void RenderRich()
    {
        if (_rich == null) return;
        _rich.Blocks.Clear();
        if (_b.X.Length == 0)
        {
            // Placeholder, like Notion's faint hints.
            var hint = _b.T switch { "h1" => "Heading 1", "h2" => "Heading 2", "h3" => "Heading 3", "todo" => "To-do", "ul" or "ol" => "List", "quote" => "Quote", "toggle" => "Toggle", "callout" => "Callout", "code" => "Code", _ => "" };
            _rich.Blocks.Add(new Microsoft.UI.Xaml.Documents.Paragraph { Inlines = { new Microsoft.UI.Xaml.Documents.Run { Text = hint == "" ? " " : hint, Foreground = Ui.B("PFaint") } } });
            return;
        }
        _rich.Blocks.Add(_b.T == "code"
            ? new Microsoft.UI.Xaml.Documents.Paragraph { Inlines = { new Microsoft.UI.Xaml.Documents.Run { Text = _b.X } } }
            : Ui.Inline(_b.X, _ed.OpenLink, FontSize, _b.T == "todo" && _b.Checked));
    }

    private void Refresh()
    {
        if (_rich != null) _rich.Foreground = Ui.B(_b.T == "todo" && _b.Checked ? "PMuted" : "PText");
        RenderRich();
    }

    // ---- editing ----

    public void FocusAt(int caret)
    {
        if (!IsText || _ed.ReadOnly) return;
        BeginEdit();
        _box!.Focus(FocusState.Programmatic);
        _box.SelectionStart = Math.Clamp(caret, 0, _box.Text.Length);
        _box.SelectionLength = 0;
    }

    private void BeginEdit()
    {
        if (Editing || _rich == null) return;
        Editing = true;
        _box ??= MakeBox();
        _box.Text = _b.X;
        var host = (Panel)_rich.Parent;
        _rich.Visibility = Visibility.Collapsed;
        if (_box.Parent == null) host.Children.Add(_box);
        _box.Visibility = Visibility.Visible;
    }

    private void EndEdit()
    {
        if (!Editing) return;
        Editing = false;
        if (_box != null) _box.Visibility = Visibility.Collapsed;
        if (_rich != null) { RenderRich(); _rich.Visibility = Visibility.Visible; }
    }

    private TextBox MakeBox()
    {
        var box = Ui.Bare(new TextBox
        {
            FontSize = FontSize, TextWrapping = TextWrapping.Wrap, AcceptsReturn = _b.T == "code", IsSpellCheckEnabled = _b.T != "code",
            FontWeight = _b.T is "h1" or "h2" or "h3" ? FontWeights.SemiBold : FontWeights.Normal,
            PlaceholderText = _b.T == "p" ? "Type '/' for commands" : "",
        });
        if (_b.T == "code") { box.FontFamily = Ui.Mono; box.FontSize = 14; }
        if (_b.T == "quote") box.FontSize = 17;
        box.TextChanged += (_, _) => OnText(box);
        box.PreviewKeyDown += OnKey;
        box.LostFocus += (_, _) => EndEdit();
        box.Paste += OnPaste;
        return box;
    }

    private bool _applying;

    private void OnText(TextBox box)
    {
        if (_applying || box.Text == _b.X) return;
        _b.X = box.Text;
        _ed.Touch(_b);
        var i = _ed.IndexOf(this);

        // "/" on an empty line opens the block menu.
        if (box.Text == "/")
        {
            var menu = _ed.TypeMenu(t => { _applying = true; box.Text = ""; _b.X = ""; _applying = false; ChangeType(t, true); }, false);
            menu.ShowAt(box, new FlyoutShowOptions { Placement = FlyoutPlacementMode.BottomEdgeAlignedLeft });
            return;
        }
        // "[[" links another note.
        if (box.SelectionStart >= 2 && box.Text.Substring(box.SelectionStart - 2, 2) == "[[")
        {
            var at = box.SelectionStart - 2;
            _ = LinkNote(box, at);
            return;
        }
        // Markdown shortcuts at the start of a plain paragraph.
        if (_b.T == "p")
        {
            if (box.Text == "---") { _applying = true; box.Text = ""; _applying = false; _b.X = ""; _ = _ed.InsertSpecial(i, "hr"); return; }
            if (box.Text is "[x] " or "[X] ") { _b.C = true; Convert("todo", 4); return; }
            if (Core.Blocks.Shortcut(box.Text) is { } s) { Convert(s.Type, s.Length); return; }
        }
    }

    private void Convert(string type, int strip)
    {
        _b.X = _b.X[strip..];
        ChangeType(type, true);
    }

    private async Task LinkNote(TextBox box, int at)
    {
        var id = await _ed.PickNote();
        var text = box.Text;
        if (id != null && _ed.LookupNote(id) is { } n)
        {
            var link = $"[{n.DisplayTitle}](note:{id})";
            box.Text = text[..at] + link + text[(at + 2)..];
            box.Focus(FocusState.Programmatic);
            box.SelectionStart = at + link.Length;
        }
    }

    private void ChangeType(string type, bool focus)
    {
        var i = _ed.IndexOf(this);
        if (type is "hr" or "img" or "page") { _ = _ed.InsertSpecial(i, type); return; }
        if (type != "todo" && type != "toggle") _b.C = null;
        if (type == "toggle") _b.C = true;
        _b.T = type;
        _b.Touch();
        var v = _ed.Rebuild(i);
        if (focus) v.FocusAt(0);
    }

    private void AddBelow(string type)
    {
        var i = _ed.IndexOf(this);
        var v = _ed.Insert(i + 1, new Block { T = type is "hr" or "img" or "page" ? "p" : type, Ind = _b.Ind, C = type == "toggle" ? true : null });
        if (type is "hr" or "img" or "page") _ = _ed.InsertSpecial(i + 1, type); else v.FocusAt(0);
    }

    private MenuFlyout HandleMenu()
    {
        var i = () => _ed.IndexOf(this);
        var m = new MenuFlyout();
        var turn = new MenuFlyoutSubItem { Text = "Turn into", Icon = new FontIcon { Glyph = "", FontFamily = Ui.Symbols } };
        foreach (var item in BlockEditor.TypeItems(t => ChangeType(t, false), true)) turn.Items.Add(item);
        if (IsText) m.Items.Add(turn);
        if (_b.T == "callout") m.Items.Add(Ui.Item("Change icon", async () =>
        {
            if (await Ui.Prompt(XamlRoot, "Callout icon (an emoji)", _b.Lang ?? "💡") is { Length: > 0 } e) { _b.Lang = e.Trim(); _ed.Rebuild(i()); }
        }, ""));
        if (_b.T == "img") m.Items.Add(Ui.Item("Caption", async () =>
        {
            if (await Ui.Prompt(XamlRoot, "Caption", _b.Cap ?? "") is { } c) { _b.Cap = c.Length == 0 ? null : c; _ed.Rebuild(i()); }
        }, ""));
        m.Items.Add(Ui.Item("Duplicate   Ctrl+Shift+D", () => Duplicate(), ""));
        m.Items.Add(Ui.Item("Move up   Alt+Shift+↑", () => _ed.Move(i(), -1), ""));
        m.Items.Add(Ui.Item("Move down   Alt+Shift+↓", () => _ed.Move(i(), 1), ""));
        m.Items.Add(new MenuFlyoutSeparator());
        m.Items.Add(Ui.Item("Delete", () => { var k = i(); _ed.Remove(k); _ed.FocusBlock(Math.Max(0, k - 1), int.MaxValue); }, "", true));
        return m;
    }

    private void Duplicate()
    {
        var copy = _b.Clone();
        copy.Id = Guid.NewGuid().ToString();
        copy.Touch();
        _ed.Insert(_ed.IndexOf(this) + 1, copy).FocusAt(int.MaxValue);
    }

    private void OnPaste(object sender, TextControlPasteEventArgs e)
    {
        // Multi-line paste becomes blocks (Markdown understood), like Notion.
        var dp = Windows.ApplicationModel.DataTransfer.Clipboard.GetContent();
        if (_b.T == "code" || !dp.Contains(Windows.ApplicationModel.DataTransfer.StandardDataFormats.Text)) return;
        e.Handled = true;
        _ = PasteText(dp);
    }

    private async Task PasteText(Windows.ApplicationModel.DataTransfer.DataPackageView dp)
    {
        var text = await dp.GetTextAsync();
        var box = _box!;
        if (!text.Contains('\n'))
        {
            var s = box.SelectionStart;
            box.Text = box.Text[..s] + text + box.Text[(s + box.SelectionLength)..];
            box.SelectionStart = s + text.Length;
            return;
        }
        var blocks = Core.Blocks.FromMarkdown(text);
        if (blocks.Count == 0) return;
        var i = _ed.IndexOf(this);
        var at = i + 1;
        if (_b.X.Length == 0) { _ed.Remove(i); at = i; }
        BlockView? last = null;
        foreach (var b in blocks) last = _ed.Insert(at++, b);
        last?.FocusAt(int.MaxValue);
    }

    private bool CaretOnFirstLine(TextBox box)
    {
        if (box.SelectionStart == 0) return true;
        var first = box.GetRectFromCharacterIndex(0, false);
        var here = box.GetRectFromCharacterIndex(Math.Max(0, box.SelectionStart - 1), true);
        return here.Top - first.Top < 4;
    }

    private bool CaretOnLastLine(TextBox box)
    {
        if (box.SelectionStart >= box.Text.Length) return true;
        var last = box.GetRectFromCharacterIndex(Math.Max(0, box.Text.Length - 1), true);
        var here = box.GetRectFromCharacterIndex(box.SelectionStart, false);
        return last.Top - here.Top < 4;
    }

    private void OnKey(object sender, KeyRoutedEventArgs e)
    {
        var box = (TextBox)sender;
        var i = _ed.IndexOf(this);
        bool ctrl = Ui.Ctrl(), shift = Ui.Shift(), alt = Ui.Alt();
        int caret = box.SelectionStart;

        switch (e.Key)
        {
            case VirtualKey.Enter when _b.T == "code" && !ctrl:
                return; // newline inside code
            case VirtualKey.Enter when ctrl:
                e.Handled = true;
                if (_b.T == "todo") { _b.C = _b.Checked ? null : true; _ed.Touch(_b); _ed.Rebuild(i).FocusAt(caret); }
                else if (_b.T == "toggle") { _b.C = _b.Checked ? null : true; _ed.Touch(_b); _ed.Rebuild(i).FocusAt(caret); }
                else if (_b.T == "code") _ed.Insert(i + 1, new Block()).FocusAt(0);
                return;
            case VirtualKey.Enter when shift:
                e.Handled = true;
                var s0 = box.SelectionStart;
                box.Text = box.Text[..s0] + "\n" + box.Text[(s0 + box.SelectionLength)..];
                box.SelectionStart = s0 + 1;
                return;
            case VirtualKey.Enter:
                e.Handled = true;
                // Enter on an empty list item leaves the list (Notion behaviour).
                if (box.Text.Length == 0 && _b.T != "p")
                {
                    if (_b.Indent > 0) { _b.Ind = _b.Indent - 1 > 0 ? _b.Indent - 1 : null; _ed.Touch(_b); _ed.Rebuild(i).FocusAt(0); }
                    else ChangeType("p", true);
                    return;
                }
                var before = box.Text[..caret];
                var after = box.Text[(caret + box.SelectionLength)..];
                _applying = true; box.Text = before; _applying = false;
                _b.X = before; _ed.Touch(_b);
                var nextType = Core.Blocks.KeepOnEnter.Contains(_b.T) ? _b.T : "p";
                var ind = _b.Ind;
                if (_b.T == "toggle" && _b.Checked) { ind = _b.Indent + 1; }
                if (caret == 0 && before.Length == 0 && after.Length > 0)
                {
                    // Enter at the very start pushes the line down instead of splitting it.
                    _applying = true; box.Text = after; _applying = false; _b.X = after;
                    _ed.Insert(i, new Block { T = nextType == _b.T ? _b.T : "p", Ind = _b.Ind });
                    FocusAt(0);
                    return;
                }
                _ed.Insert(i + 1, new Block { T = nextType, X = after, Ind = ind }).FocusAt(0);
                return;

            case VirtualKey.Back when caret == 0 && box.SelectionLength == 0:
                e.Handled = true;
                if (_b.T != "p") { ChangeType("p", true); return; }
                if (_b.Indent > 0) { _b.Ind = _b.Indent - 1 > 0 ? _b.Indent - 1 : null; _ed.Touch(_b); _ed.Rebuild(i).FocusAt(0); return; }
                if (i == 0) { if (box.Text.Length == 0 && _ed.Blocks.Count > 1) { _ed.Remove(0); _ed.FocusBlock(0, 0); } return; }
                var prev = _ed.Blocks[i - 1];
                if (!Core.Blocks.TextTypes.Contains(prev.T))
                {
                    // Backspace after a divider/image removes it.
                    if (box.Text.Length == 0) { _ed.Remove(i); _ed.FocusBlock(i - 1, int.MaxValue); } else _ed.Remove(i - 1);
                    return;
                }
                var join = prev.X.Length;
                prev.X += box.Text;
                prev.Touch();
                _ed.Remove(i);
                _ed.Rebuild(i - 1).FocusAt(join);
                return;

            case VirtualKey.Delete when caret == box.Text.Length && box.SelectionLength == 0 && i + 1 < _ed.Blocks.Count:
                var next = _ed.Blocks[i + 1];
                if (!Core.Blocks.TextTypes.Contains(next.T)) return;
                e.Handled = true;
                _applying = true; box.Text += next.X; _applying = false;
                _b.X = box.Text; _ed.Touch(_b);
                _ed.Remove(i + 1);
                box.SelectionStart = caret;
                return;

            case VirtualKey.Tab:
                e.Handled = true;
                var cur = _b.Indent;
                var max = i > 0 ? _ed.Blocks[i - 1].Indent + 1 : 0;
                var nextInd = shift ? Math.Max(0, cur - 1) : Math.Min(max, cur + 1);
                if (nextInd == cur) return;
                _b.Ind = nextInd > 0 ? nextInd : null;
                _ed.Touch(_b);
                _ed.Rebuild(i).FocusAt(caret);
                return;

            case VirtualKey.Up when alt && shift: e.Handled = true; _ed.Move(i, -1); return;
            case VirtualKey.Down when alt && shift: e.Handled = true; _ed.Move(i, 1); return;
            case VirtualKey.Up when !shift && CaretOnFirstLine(box):
                e.Handled = true; _ed.FocusBlock(_ed.NextVisible(i, -1), int.MaxValue); return;
            case VirtualKey.Down when !shift && CaretOnLastLine(box):
                var n2 = _ed.NextVisible(i, 1);
                if (n2 < _ed.Blocks.Count) { e.Handled = true; _ed.FocusBlock(n2, 0); }
                return;
            case VirtualKey.Left when caret == 0 && box.SelectionLength == 0 && i > 0:
                e.Handled = true; _ed.FocusBlock(_ed.NextVisible(i, -1), int.MaxValue); return;
            case VirtualKey.Right when caret == box.Text.Length && box.SelectionLength == 0:
                var n3 = _ed.NextVisible(i, 1);
                if (n3 < _ed.Blocks.Count) { e.Handled = true; _ed.FocusBlock(n3, 0); }
                return;
            case VirtualKey.Escape:
                e.Handled = true; EndEdit(); return;

            case VirtualKey.B when ctrl: e.Handled = true; Wrap(box, "**"); return;
            case VirtualKey.I when ctrl: e.Handled = true; Wrap(box, "*"); return;
            case VirtualKey.E when ctrl: e.Handled = true; Wrap(box, "`"); return;
            case VirtualKey.S when ctrl && shift: e.Handled = true; Wrap(box, "~~"); return;
            case VirtualKey.D when ctrl && shift: e.Handled = true; Duplicate(); return;
            case VirtualKey.Number7 when ctrl && shift: e.Handled = true; ChangeType("ol", true); return;
            case VirtualKey.Number8 when ctrl && shift: e.Handled = true; ChangeType("ul", true); return;
            case VirtualKey.Number9 when ctrl && shift: e.Handled = true; ChangeType("todo", true); return;
        }
    }

    private static void Wrap(TextBox box, string mark)
    {
        int s = box.SelectionStart, l = box.SelectionLength;
        var t = box.Text;
        // Toggle off if the selection is already wrapped.
        if (s >= mark.Length && s + l + mark.Length <= t.Length && t.Substring(s - mark.Length, mark.Length) == mark && t.Substring(s + l, mark.Length) == mark)
        {
            box.Text = t[..(s - mark.Length)] + t.Substring(s, l) + t[(s + l + mark.Length)..];
            box.SelectionStart = s - mark.Length; box.SelectionLength = l;
            return;
        }
        box.Text = t[..s] + mark + t.Substring(s, l) + mark + t[(s + l)..];
        box.SelectionStart = s + mark.Length;
        box.SelectionLength = l;
    }
}
