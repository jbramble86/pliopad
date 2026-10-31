using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Pliopad.Core;
using Windows.UI;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>
/// PlioSphere on Windows: notes as stars in a slowly turning 3D sphere. Drag to spin, wheel to zoom,
/// click a note to light up its links, click it again to open it. Every note keeps its name.
/// </summary>
public sealed class SphereView : Grid
{
    private static readonly Color[] Palette = [Rgb(0x647BFF), Rgb(0x83EBC0), Rgb(0xF4D6A0), Rgb(0xF59EB5), Rgb(0x9AD0F5), Rgb(0xC3B1FF)];
    private static readonly Color Ivory = Rgb(0xFAF9F5), Mint = Rgb(0x83EBC0), Thread = Rgb(0xAAB6F0);
    private static Color Rgb(int v) => Color.FromArgb(255, (byte)(v >> 16), (byte)(v >> 8), (byte)v);

    private readonly MainWindow _main;
    private readonly Sphere _sphere;
    private readonly Canvas _canvas = new() { Background = new SolidColorBrush(Colors.Transparent) };
    private readonly List<Line> _lines = [];
    private readonly List<Line> _autoLines = [];
    private bool _showAuto = App.Repo.Pref("sphereAuto") != "0";
    private readonly List<Ellipse> _dots = [];
    private readonly List<Ellipse> _glows = [];
    private readonly List<TextBlock> _labels = [];
    private readonly Color[] _colors;
    private readonly Border _card = new() { Visibility = Visibility.Collapsed };
    private float _yaw = 0.5f, _pitch = -0.3f, _zoom = 1f;
    private int? _hover, _selected;
    private DateTime _lastTouch = DateTime.MinValue;
    private Windows.Foundation.Point? _dragFrom;
    private float _dragYaw, _dragPitch;
    private bool _dragMoved;
    private List<Sphere.Projected> _projected = [];
    private TimeSpan _lastFrame;

    public SphereView(MainWindow main)
    {
        _main = main;
        var R = App.Repo;
        _sphere = Sphere.Build(R.Notes(), tagNames: R.Tags().ToDictionary(t => t.Id, t => t.Name));
        var groups = _sphere.Nodes.Select(n => n.Group).Where(g => g != null).Distinct().ToList();
        _colors = _sphere.Nodes.Select(n => n.Group == null ? Ivory : Palette[groups.IndexOf(n.Group) % Palette.Length]).ToArray();

        Background = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0.5, 0), EndPoint = new Windows.Foundation.Point(0.5, 1),
            GradientStops = { new GradientStop { Color = Rgb(0x101D59), Offset = 0 }, new GradientStop { Color = Rgb(0x0A1240), Offset = 1 } },
        };
        RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        RowDefinitions.Add(new RowDefinition());

        var head = new Grid { Padding = new Thickness(24, 14, 16, 10) };
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var title = V(0, new TextBlock { Text = "PlioSphere", FontSize = 22, FontWeight = Microsoft.UI.Text.FontWeights.Bold, Foreground = new SolidColorBrush(Colors.White) },
            new TextBlock { Text = $"{_sphere.Nodes.Count} notes · {_sphere.Edges.Count} links · {_sphere.Discovered.Count} discovered", FontSize = 12, Foreground = new SolidColorBrush(Mint) });
        head.Children.Add(title);
        // Discovered links on/off (remembered).
        var auto = new CheckBox { Content = new TextBlock { Text = "Discovered links", Foreground = new SolidColorBrush(Colors.White) }, IsChecked = _showAuto, MinWidth = 0, Margin = new Thickness(0, 0, 12, 0) };
        ToolTipService.SetToolTip(auto, "Connections PlioPad found by itself: mentions, shared tags and similar wording");
        auto.Click += (_, _) => { _showAuto = auto.IsChecked == true; R.SetPref("sphereAuto", _showAuto ? null : "0"); if (_selected != null) Select(_selected); };
        var recenter = new Button { Content = "Recenter", Foreground = new SolidColorBrush(Colors.White) };
        recenter.Click += (_, _) => { _yaw = 0.5f; _pitch = -0.3f; _zoom = 1f; Select(null); };
        var tools = H(0, auto, recenter);
        tools.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(tools, 1);
        head.Children.Add(tools);
        Children.Add(head);

        var stage = new Grid();
        SetRow(stage, 1);
        stage.Children.Add(_canvas);
        _card.HorizontalAlignment = HorizontalAlignment.Center;
        _card.VerticalAlignment = VerticalAlignment.Bottom;
        _card.Margin = new Thickness(16, 0, 16, 36);
        stage.Children.Add(_card);
        var hint = new TextBlock { Text = "Drag to spin · scroll to zoom · click a note to see its links, click again to open it", FontSize = 12, Foreground = new SolidColorBrush(Rgb(0x9BA4D0)), Margin = new Thickness(18, 0, 0, 10), VerticalAlignment = VerticalAlignment.Bottom, IsHitTestVisible = false };
        stage.Children.Add(hint);
        Children.Add(stage);

        if (_sphere.Nodes.Count == 0)
        {
            stage.Children.Add(new TextBlock { Text = "Link notes with [[ to see them connect here.", Foreground = new SolidColorBrush(Rgb(0xAEB6E0)), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
            return;
        }

        // Shapes are created once and moved every frame (cheaper than rebuilding them).
        foreach (var _ in _sphere.Discovered) { var l = new Line { IsHitTestVisible = false, StrokeDashArray = [4, 5] }; _autoLines.Add(l); _canvas.Children.Add(l); }
        foreach (var _ in _sphere.Edges) { var l = new Line { IsHitTestVisible = false }; _lines.Add(l); _canvas.Children.Add(l); }
        for (int i = 0; i < _sphere.Nodes.Count; i++)
        {
            var glow = new Ellipse { Fill = new SolidColorBrush(_colors[i]), IsHitTestVisible = false, Visibility = Visibility.Collapsed };
            var dot = new Ellipse { Fill = new SolidColorBrush(_colors[i]), IsHitTestVisible = false };
            var label = new TextBlock { Text = Trim(_sphere.Nodes[i].Title), Foreground = new SolidColorBrush(Colors.White), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, IsHitTestVisible = false, TextAlignment = TextAlignment.Center };
            _glows.Add(glow); _dots.Add(dot); _labels.Add(label);
            _canvas.Children.Add(glow); _canvas.Children.Add(dot); _canvas.Children.Add(label);
        }

        _canvas.PointerPressed += OnPressed;
        _canvas.PointerMoved += OnMoved;
        _canvas.PointerReleased += OnReleased;
        _canvas.PointerExited += (_, _) => { if (_dragFrom == null) _hover = null; };
        _canvas.PointerWheelChanged += (_, e) => { _zoom = Math.Clamp(_zoom * (e.GetCurrentPoint(_canvas).Properties.MouseWheelDelta > 0 ? 1.08f : 0.93f), 0.6f, 4f); _lastTouch = DateTime.Now; };
        Loaded += (_, _) => CompositionTarget.Rendering += OnFrame;
        Unloaded += (_, _) => CompositionTarget.Rendering -= OnFrame;
    }

    private static string Trim(string t) => t.Length > 26 ? t[..25] + "…" : t;

    private void OnFrame(object? sender, object e)
    {
        var now = ((RenderingEventArgs)e).RenderingTime;
        var dt = _lastFrame == TimeSpan.Zero ? 0 : (float)(now - _lastFrame).TotalSeconds;
        _lastFrame = now;
        // A slow drift, paused while you interact (and for a moment after) or have a note selected.
        if (_selected == null && _hover == null && _dragFrom == null && (DateTime.Now - _lastTouch).TotalSeconds > 2.5) _yaw += dt * 0.12f;
        Draw();
    }

    private void Draw()
    {
        var w = (float)_canvas.ActualWidth; var h = (float)_canvas.ActualHeight;
        if (w < 10 || h < 10) return;
        _projected = _sphere.Project(w, h, _yaw, _pitch, _zoom);
        var at = new Sphere.Projected[_sphere.Nodes.Count];
        foreach (var p in _projected) at[p.Index] = p;
        var focus = _selected ?? _hover;
        var near = focus is int f ? (_showAuto ? _sphere.Neighbors[f].Concat(_sphere.DiscoveredOf[f].Select(d => d.Other)).ToHashSet() : _sphere.Neighbors[f]) : null;
        for (int k = 0; k < _sphere.Discovered.Count; k++)
        {
            var (a, b, _) = _sphere.Discovered[k];
            var l = _autoLines[k];
            l.Visibility = _showAuto ? Visibility.Visible : Visibility.Collapsed;
            if (!_showAuto) continue;
            var pa = at[a]; var pb = at[b];
            var on = focus != null && (a == focus || b == focus);
            var depth = (pa.Depth + pb.Depth) / 2;
            l.X1 = pa.X; l.Y1 = pa.Y; l.X2 = pb.X; l.Y2 = pb.Y;
            l.Stroke = new SolidColorBrush(on ? Mint : focus != null ? Color.FromArgb(10, 255, 255, 255) : Color.FromArgb((byte)(255 * (0.14 + 0.36 * depth)), Mint.R, Mint.G, Mint.B));
            l.StrokeThickness = (on ? 1.6 : 1) * (0.6 + 0.6 * depth);
            Canvas.SetZIndex(l, 0);
        }

        for (int k = 0; k < _sphere.Edges.Count; k++)
        {
            var (a, b) = _sphere.Edges[k];
            var pa = at[a]; var pb = at[b];
            var on = focus != null && (a == focus || b == focus);
            var depth = (pa.Depth + pb.Depth) / 2;
            var l = _lines[k];
            l.X1 = pa.X; l.Y1 = pa.Y; l.X2 = pb.X; l.Y2 = pb.Y;
            l.Stroke = new SolidColorBrush(on ? Mint : focus != null ? Color.FromArgb(13, 255, 255, 255) : Color.FromArgb((byte)(255 * (0.08 + 0.32 * depth)), Thread.R, Thread.G, Thread.B));
            l.StrokeThickness = (on ? 2 : 1) * (0.6 + 0.6 * depth);
            Canvas.SetZIndex(l, 0);
        }
        int z = 1;
        foreach (var p in _projected)
        {
            var n = _sphere.Nodes[p.Index];
            var dim = focus != null && p.Index != focus && near?.Contains(p.Index) != true;
            var fade = dim ? 0.18 : 0.35 + 0.65 * p.Depth;
            var r = Sphere.Radius(n) * p.Scale * (p.Index == focus ? 1.5f : 1f) * MathF.Min(1.8f, MathF.Sqrt(_zoom));
            var dot = _dots[p.Index];
            dot.Width = dot.Height = r * 2; dot.Opacity = fade;
            Canvas.SetLeft(dot, p.X - r); Canvas.SetTop(dot, p.Y - r); Canvas.SetZIndex(dot, z++);
            var glow = _glows[p.Index];
            var glowing = p.Index == focus || (!dim && p.Depth > 0.7f && n.Degree >= 3);
            glow.Visibility = glowing ? Visibility.Visible : Visibility.Collapsed;
            if (glowing) { glow.Width = glow.Height = r * 5.2; glow.Opacity = 0.22 * fade; Canvas.SetLeft(glow, p.X - r * 2.6); Canvas.SetTop(glow, p.Y - r * 2.6); Canvas.SetZIndex(glow, z - 1); }
            var label = _labels[p.Index];
            label.FontSize = (9 + 4 * p.Depth) * (p.Index == focus ? 1.2 : 1);
            label.Opacity = dim ? 0.12 : 0.3 + 0.7 * p.Depth;
            label.Measure(new Windows.Foundation.Size(double.PositiveInfinity, double.PositiveInfinity));
            Canvas.SetLeft(label, p.X - label.DesiredSize.Width / 2); Canvas.SetTop(label, p.Y + r + 2); Canvas.SetZIndex(label, z++);
        }
    }

    private int? Pick(Windows.Foundation.Point pt)
    {
        Sphere.Projected? best = null;
        foreach (var p in _projected)
        {
            var reach = Math.Max(12, Sphere.Radius(_sphere.Nodes[p.Index]) * p.Scale + 6);
            if (Math.Abs(p.X - pt.X) < reach && Math.Abs(p.Y - pt.Y) < reach && Math.Sqrt((p.X - pt.X) * (p.X - pt.X) + (p.Y - pt.Y) * (p.Y - pt.Y)) < reach
                && (best == null || p.Depth > best.Value.Depth)) best = p;
        }
        return best?.Index;
    }

    private void OnPressed(object sender, PointerRoutedEventArgs e)
    {
        _canvas.CapturePointer(e.Pointer);
        _dragFrom = e.GetCurrentPoint(_canvas).Position;
        _dragYaw = _yaw; _dragPitch = _pitch; _dragMoved = false;
        _lastTouch = DateTime.Now;
    }

    private void OnMoved(object sender, PointerRoutedEventArgs e)
    {
        var pt = e.GetCurrentPoint(_canvas).Position;
        if (_dragFrom is { } from)
        {
            var dx = pt.X - from.X; var dy = pt.Y - from.Y;
            if (Math.Abs(dx) + Math.Abs(dy) > 4) _dragMoved = true;
            _yaw = _dragYaw + (float)dx * 0.006f;
            _pitch = Math.Clamp(_dragPitch - (float)dy * 0.006f, -1.4f, 1.4f);
            _lastTouch = DateTime.Now;
            return;
        }
        _hover = Pick(pt);
    }

    private void OnReleased(object sender, PointerRoutedEventArgs e)
    {
        _canvas.ReleasePointerCapture(e.Pointer);
        if (_dragFrom != null && !_dragMoved)
        {
            var hit = Pick(e.GetCurrentPoint(_canvas).Position);
            // First click selects (and lights up its links); clicking the selected note again opens it.
            if (hit != null && hit == _selected) _main.OpenNote(_sphere.Nodes[hit.Value].Id);
            else Select(hit);
        }
        _dragFrom = null;
    }

    private void Select(int? i)
    {
        _selected = i;
        if (i is not int idx) { _card.Visibility = Visibility.Collapsed; return; }
        var n = _sphere.Nodes[idx];
        var links = _sphere.Neighbors[idx].Count;
        var found = _showAuto ? _sphere.DiscoveredOf[idx] : [];
        var open = new Button { Content = "Open", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
        open.Click += (_, _) => _main.OpenNote(n.Id);
        var row = new Grid { ColumnSpacing = 14, MinWidth = 320 };
        row.ColumnDefinitions.Add(new ColumnDefinition());
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(V(2, new TextBlock { Text = n.Title, FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = new SolidColorBrush(Rgb(0x101D59)), TextTrimming = TextTrimming.CharacterEllipsis },
            new TextBlock { Text = $"{links} linked note{(links == 1 ? "" : "s")}" + (found.Count > 0 ? $" · {found.Count} discovered" : ""), FontSize = 13, Foreground = new SolidColorBrush(Rgb(0x5D6485)) },
            found.Count > 0 ? new TextBlock { Text = string.Join(Environment.NewLine, found.Take(3).Select(d => $"✦ {_sphere.Nodes[d.Other].Title} · {d.Why}")), FontSize = 12, Foreground = new SolidColorBrush(Rgb(0x101D59)), TextWrapping = TextWrapping.Wrap, MaxWidth = 420 } : null));
        Grid.SetColumn(open, 1);
        row.Children.Add(open);
        _card.Child = row;
        _card.Background = new SolidColorBrush(Ivory);
        _card.CornerRadius = new CornerRadius(16);
        _card.Padding = new Thickness(16, 12, 12, 12);
        _card.Visibility = Visibility.Visible;
    }
}
