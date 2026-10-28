using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using System.Text.Json.Nodes;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>
/// A Notion database: every row is a page with typed properties, shown as a table, a board or a calendar.
/// Uses the same schema as the web app, so views and fields round-trip.
/// </summary>
public sealed class DatabaseView : StackPanel
{
    private static Repo R => App.Repo;
    private readonly INoteHost _host;
    private readonly string _dbId;
    private JsonObject _schema = [];
    private string? _viewId;
    private DateTime _month = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    private static Dictionary<long, string>? _members;

    public static readonly string[] PropTypes = ["text", "number", "select", "multi", "status", "date", "person", "checkbox", "url"];
    private static readonly string[] Palette = ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink"];

    public DatabaseView(INoteHost host, string dbId)
    {
        _host = host;
        _dbId = dbId;
        Spacing = 8;
        Margin = new Thickness(0, 8, 0, 0);
        Render();
        if (_members == null) _ = LoadMembers();
    }

    private async Task LoadMembers()
    {
        try { _members = (await R.Api.Members(R.WsId)).ToDictionary(m => m.Id, m => m.Name); DispatcherQueue.TryEnqueue(Render); } catch { _members = []; }
    }

    private Note Db => R.Note(_dbId)!;
    private JsonArray Props => _schema["props"] as JsonArray ?? (JsonArray)(_schema["props"] = new JsonArray());
    private JsonArray Views => _schema["views"] as JsonArray ?? (JsonArray)(_schema["views"] = new JsonArray());
    private JsonObject View => Views.OfType<JsonObject>().FirstOrDefault(v => (string?)v["id"] == _viewId) ?? Views.OfType<JsonObject>().First();

    private void Save() { R.SetSchema(_dbId, _schema); Render(); }

    public void Render()
    {
        try { _schema = JsonNode.Parse(Db.DbSchema ?? "{}") as JsonObject ?? []; } catch { _schema = []; }
        if (Views.Count == 0) Views.Add(new JsonObject { ["id"] = "v1", ["name"] = "Table", ["type"] = "table" });
        _viewId ??= (string?)Views[0]!["id"];
        Children.Clear();
        Children.Add(Tabs());
        var rows = R.Rows(_dbId);
        var view = View;
        Children.Add((string?)view["type"] switch
        {
            "board" => Board(rows, view),
            "calendar" => Calendar(rows, view),
            _ => Table(rows),
        });
    }

    // ---- view tabs ----

    private UIElement Tabs()
    {
        var bar = new Grid { BorderBrush = B("PBorder"), BorderThickness = new Thickness(0, 0, 0, 1), Padding = new Thickness(0, 0, 0, 4) };
        bar.ColumnDefinitions.Add(new ColumnDefinition());
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var tabs = H(2);
        foreach (var v in Views.OfType<JsonObject>())
        {
            var id = (string?)v["id"];
            var glyph = (string?)v["type"] switch { "board" => "", "calendar" => "", _ => "" };
            var active = id == _viewId;
            var b = Flat(H(6, I(glyph, 12, active ? "PText" : "PMuted"), T((string?)v["name"] ?? "View", 13, active ? "PText" : "PMuted", semibold: active)), () => { _viewId = id; Render(); }, pad: 6);
            if (active) b.BorderBrush = B("PText");
            if (R.CanWrite) b.ContextFlyout = Menu(
                Item("Rename view", async () => { if (await Prompt(_host.Root, "Rename view", (string?)v["name"] ?? "") is { Length: > 0 } s) { v["name"] = s; Save(); } }, ""),
                (string?)v["type"] == "board" ? Sub("Group by", "", Props.OfType<JsonObject>().Where(HasOptions).Select(p => (MenuFlyoutItemBase)Item((string?)p["name"] ?? "", () => { v["group"] = (string?)p["id"]; Save(); })).ToArray()) : null,
                (string?)v["type"] == "calendar" ? Sub("Date property", "", Props.OfType<JsonObject>().Where(p => (string?)p["type"] == "date").Select(p => (MenuFlyoutItemBase)Item((string?)p["name"] ?? "", () => { v["date"] = (string?)p["id"]; Save(); })).ToArray()) : null,
                Views.Count > 1 ? Item("Delete view", () => { Views.Remove(v); _viewId = null; Save(); }, "", true) : null);
            tabs.Children.Add(b);
        }
        if (R.CanWrite)
        {
            var add = IconButton("", () => { }, "Add a view", 11);
            add.Flyout = Menu(
                Item("Table", () => AddView("table"), ""),
                Item("Board", () => AddView("board"), ""),
                Item("Calendar", () => AddView("calendar"), ""));
            tabs.Children.Add(add);
        }
        bar.Children.Add(tabs);
        if (R.CanWrite)
        {
            var newBtn = new Button { Content = "New", Style = (Style)Application.Current.Resources["AccentButtonStyle"], Padding = new Thickness(12, 4, 12, 4) };
            newBtn.Click += (_, _) => NewRow(null, null);
            Grid.SetColumn(newBtn, 1);
            bar.Children.Add(newBtn);
        }
        return bar;
    }

    private void AddView(string type)
    {
        var v = new JsonObject { ["id"] = Guid.NewGuid().ToString()[..8], ["name"] = char.ToUpper(type[0]) + type[1..], ["type"] = type };
        if (type == "board") v["group"] = (string?)Props.OfType<JsonObject>().FirstOrDefault(HasOptions)?["id"];
        if (type == "calendar") v["date"] = (string?)Props.OfType<JsonObject>().FirstOrDefault(p => (string?)p["type"] == "date")?["id"];
        Views.Add(v);
        _viewId = (string?)v["id"];
        Save();
    }

    private static bool HasOptions(JsonObject p) => (string?)p["type"] is "select" or "multi" or "status";

    private void NewRow(string? propId, JsonNode? value)
    {
        var id = R.CreateNote("", [], null, _dbId, useDefaultNotebook: false);
        if (propId != null) R.SetProp(id, propId, value?.DeepClone());
        _host.OpenNote(id);
    }

    // ---- table ----

    private UIElement Table(List<Note> rows)
    {
        var props = Props.OfType<JsonObject>().ToList();
        var g = new Grid();
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(260) });
        foreach (var _ in props) g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(170) });
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(44) });

        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        Cell(g, 0, 0, HeaderCell("", "Name", null));
        for (int c = 0; c < props.Count; c++) Cell(g, 0, c + 1, HeaderCell(TypeGlyph((string?)props[c]["type"]), (string?)props[c]["name"] ?? "", props[c]));
        if (R.CanWrite) Cell(g, 0, props.Count + 1, IconButton("", () => _ = AddProperty(), "Add a property", 12), border: false);

        for (int r = 0; r < rows.Count; r++)
        {
            var row = rows[r];
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var title = Flat(H(6, new TextBlock { Text = row.Icon ?? "📄", FontSize = 13 }, T(row.DisplayTitle, 14, semibold: true)), () => _host.OpenNote(row.Id), "Open", 4);
            title.HorizontalAlignment = HorizontalAlignment.Stretch;
            title.HorizontalContentAlignment = HorizontalAlignment.Left;
            if (R.CanWrite) title.ContextFlyout = Menu(Item("Delete row", () => R.Trash(row.Id), "", true));
            Cell(g, r + 1, 0, title);
            var values = R.PropsNode(row);
            for (int c = 0; c < props.Count; c++) Cell(g, r + 1, c + 1, Editor(row, props[c], values[(string)props[c]["id"]!], compact: true));
        }
        if (R.CanWrite)
        {
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var add = Flat(H(6, I("", 12), T("New", 13, "PMuted")), () => NewRow(null, null), pad: 6);
            add.HorizontalAlignment = HorizontalAlignment.Left;
            Cell(g, rows.Count + 1, 0, add, border: false);
        }
        return new ScrollViewer { Content = g, HorizontalScrollMode = ScrollMode.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollMode = ScrollMode.Disabled };
    }

    private static void Cell(Grid g, int r, int c, FrameworkElement el, bool border = true)
    {
        var b = new Border { Child = el, Padding = new Thickness(4, 2, 4, 2), MinHeight = 36 };
        if (border) { b.BorderBrush = B("PBorder"); b.BorderThickness = new Thickness(0, 0, c == 0 ? 1 : 1, 1); }
        Grid.SetRow(b, r); Grid.SetColumn(b, c);
        g.Children.Add(b);
    }

    private static string TypeGlyph(string? t) => t switch
    {
        "number" => "", "select" or "status" => "", "multi" => "", "date" => "", "person" => "", "checkbox" => "", "url" => "", _ => "",
    };

    private FrameworkElement HeaderCell(string glyph, string name, JsonObject? p)
    {
        var b = Flat(H(6, I(glyph, 12), T(name, 13, "PMuted")), pad: 4);
        b.HorizontalAlignment = HorizontalAlignment.Stretch;
        b.HorizontalContentAlignment = HorizontalAlignment.Left;
        if (p != null && R.CanWrite)
        {
            var type = new MenuFlyoutSubItem { Text = "Type" };
            foreach (var t in PropTypes)
                type.Items.Add(Item(t == "multi" ? "Multi-select" : char.ToUpper(t[0]) + t[1..], () =>
                {
                    p["type"] = t;
                    if (HasOptions(p) && p["options"] == null) p["options"] = t == "status" ? StatusOptions() : new JsonArray();
                    Save();
                }, TypeGlyph(t)));
            b.Flyout = Menu(
                Item("Rename", async () => { if (await Prompt(_host.Root, "Rename property", name) is { Length: > 0 } s) { p["name"] = s; Save(); } }, ""),
                type,
                HasOptions(p) ? Item("Edit options", () => _ = EditOptions(p), "") : null,
                new MenuFlyoutSeparator(),
                Item("Delete property", async () => { if (await Confirm(_host.Root, $"Delete “{name}”?", "The values in every row are removed too.")) { Props.Remove(p); Save(); } }, "", true));
        }
        return b;
    }

    private static JsonArray StatusOptions() =>
    [
        new JsonObject { ["id"] = "todo", ["name"] = "Not started", ["color"] = "gray" },
        new JsonObject { ["id"] = "doing", ["name"] = "In progress", ["color"] = "blue" },
        new JsonObject { ["id"] = "done", ["name"] = "Done", ["color"] = "green" },
    ];

    private async Task AddProperty()
    {
        var name = new TextBox { PlaceholderText = "Property name", Text = "" };
        var type = new ComboBox { ItemsSource = PropTypes.Select(t => t == "multi" ? "Multi-select" : char.ToUpper(t[0]) + t[1..]).ToList(), SelectedIndex = 0, HorizontalAlignment = HorizontalAlignment.Stretch };
        var dlg = new ContentDialog { XamlRoot = _host.Root, Title = "New property", Content = V(10, name, type), PrimaryButtonText = "Add", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary };
        if (await dlg.ShowAsync() != ContentDialogResult.Primary) return;
        var t = PropTypes[Math.Max(0, type.SelectedIndex)];
        var p = new JsonObject { ["id"] = Guid.NewGuid().ToString()[..8], ["name"] = name.Text.Trim().Length > 0 ? name.Text.Trim() : "Property", ["type"] = t };
        if (t == "status") p["options"] = StatusOptions(); else if (HasOptions(p)) p["options"] = new JsonArray();
        Props.Add(p);
        Save();
    }

    private async Task EditOptions(JsonObject p)
    {
        var opts = p["options"] as JsonArray ?? [];
        var box = new TextBox { AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 140, Width = 320, Text = string.Join("\n", opts.OfType<JsonObject>().Select(o => (string?)o["name"])) };
        var dlg = new ContentDialog { XamlRoot = _host.Root, Title = "Options (one per line)", Content = box, PrimaryButtonText = "Save", CloseButtonText = "Cancel", DefaultButton = ContentDialogButton.Primary };
        if (await dlg.ShowAsync() != ContentDialogResult.Primary) return;
        var names = box.Text.Replace("\r", "\n").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var next = new JsonArray();
        for (int i = 0; i < names.Length; i++)
            next.Add(opts.OfType<JsonObject>().FirstOrDefault(o => (string?)o["name"] == names[i])?.DeepClone() ?? new JsonObject { ["id"] = Guid.NewGuid().ToString()[..8], ["name"] = names[i], ["color"] = Palette[i % Palette.Length] });
        p["options"] = next;
        Save();
    }

    // ---- property editors (used in table cells and on the row page) ----

    public static Brush OptionBrush(string? color) => new SolidColorBrush(color switch
    {
        "blue" => Windows.UI.Color.FromArgb(70, 35, 131, 226), "green" => Windows.UI.Color.FromArgb(70, 15, 123, 108),
        "yellow" => Windows.UI.Color.FromArgb(80, 223, 171, 1), "orange" => Windows.UI.Color.FromArgb(70, 217, 115, 13),
        "red" => Windows.UI.Color.FromArgb(70, 224, 62, 62), "purple" => Windows.UI.Color.FromArgb(70, 105, 64, 165),
        "pink" => Windows.UI.Color.FromArgb(70, 173, 26, 114), _ => Windows.UI.Color.FromArgb(50, 120, 119, 116),
    });

    private static Border Pill(string text, string? color) => new()
    {
        Child = T(text, 12, "PText"), Background = OptionBrush(color), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 1, 6, 2),
        HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center,
    };

    private static string Display(JsonObject p, JsonNode? v)
    {
        if (v == null) return "";
        var opts = p["options"] as JsonArray;
        return (string?)p["type"] switch
        {
            "select" or "status" => (string?)opts?.OfType<JsonObject>().FirstOrDefault(o => (string?)o["id"] == v.ToString())?["name"] ?? "",
            "person" => long.TryParse(v.ToString(), out var uid) ? _members?.GetValueOrDefault(uid) ?? (uid == R.User?.Id ? R.User!.Name : $"Member {uid}") : "",
            "checkbox" => v.ToString() == "true" ? "✓" : "",
            "date" => DateTime.TryParse(v.ToString(), out var dd) ? dd.ToString(dd.Year == DateTime.Today.Year ? "MMM d" : "MMM d, yyyy") : v.ToString(),
            _ => v.ToString(),
        };
    }

    private FrameworkElement Editor(Note row, JsonObject p, JsonNode? v, bool compact) => Field(_host, row, p, v, R.CanWrite && !row.Locked, Render);

    /// <summary>One editable value. Changes are saved to the row note's props right away.</summary>
    public static FrameworkElement Field(INoteHost host, Note row, JsonObject p, JsonNode? v, bool editable, Action? after = null)
    {
        var pid = (string)p["id"]!;
        var type = (string?)p["type"] ?? "text";
        void Set(JsonNode? value) { R.SetProp(row.Id, pid, value); after?.Invoke(); }
        if (!editable)
        {
            if (HasOptions(p) && v != null) return Pill(Display(p, v), (string?)(p["options"] as JsonArray)?.OfType<JsonObject>().FirstOrDefault(o => (string?)o["id"] == v.ToString())?["color"]);
            return T(Display(p, v), 14);
        }
        switch (type)
        {
            case "checkbox":
                var cb = new CheckBox { IsChecked = v?.ToString() == "true", MinWidth = 0 };
                cb.Click += (_, _) => Set(cb.IsChecked == true ? JsonValue.Create(true) : null);
                return cb;
            case "date":
                var dp = new CalendarDatePicker { PlaceholderText = "Empty", BorderThickness = new Thickness(0), Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent), MinWidth = 0 };
                if (v != null && DateTime.TryParse(v.ToString(), out var d)) dp.Date = d;
                dp.DateChanged += (_, e) => Set(e.NewDate is { } nd ? JsonValue.Create(nd.ToString("yyyy-MM-dd")) : null);
                return dp;
            case "select":
            case "status":
            case "person":
            case "multi":
                var opts = type == "person"
                    ? (_members ?? (R.User != null ? new() { [R.User.Id] = R.User.Name } : [])).Select(kv => (Id: kv.Key.ToString(), Name: kv.Value, Color: (string?)"gray")).ToList()
                    : (p["options"] as JsonArray ?? []).OfType<JsonObject>().Select(o => (Id: (string)o["id"]!, Name: (string?)o["name"] ?? "", Color: (string?)o["color"])).ToList();
                var selected = type == "multi" ? (v as JsonArray)?.Select(x => x?.ToString() ?? "").ToHashSet() ?? [] : v != null ? [v.ToString()] : new HashSet<string>();
                var pills = new WrapPanelLite { Spacing = 4 };
                foreach (var o in opts.Where(o => selected.Contains(o.Id))) pills.Children.Add(Pill(o.Name, o.Color));
                if (pills.Children.Count == 0) pills.Children.Add(T("Empty", 13, "PFaint"));
                var btn = Flat(pills, pad: 4);
                btn.HorizontalAlignment = HorizontalAlignment.Stretch;
                btn.HorizontalContentAlignment = HorizontalAlignment.Left;
                var menu = new MenuFlyout();
                foreach (var o in opts)
                {
                    var it = new ToggleMenuFlyoutItem { Text = o.Name, IsChecked = selected.Contains(o.Id) };
                    it.Click += (_, _) =>
                    {
                        if (type == "multi")
                        {
                            if (!selected.Remove(o.Id)) selected.Add(o.Id);
                            Set(selected.Count == 0 ? null : new JsonArray(selected.Select(s => (JsonNode)JsonValue.Create(s)!).ToArray()));
                        }
                        else if (type == "person") Set(selected.Contains(o.Id) ? null : JsonValue.Create(long.Parse(o.Id)));
                        else Set(selected.Contains(o.Id) ? null : JsonValue.Create(o.Id));
                    };
                    menu.Items.Add(it);
                }
                if (opts.Count == 0) menu.Items.Add(new MenuFlyoutItem { Text = type == "person" ? "Members load when you're online" : "No options yet — use the column menu", IsEnabled = false });
                btn.Flyout = menu;
                return btn;
            default:
                var box = Bare(new TextBox { Text = v?.ToString() ?? "", PlaceholderText = "Empty", FontSize = 14, TextWrapping = TextWrapping.NoWrap });
                box.Padding = new Thickness(4, 5, 4, 5);
                void Commit()
                {
                    var s = box.Text.Trim();
                    if (s == (v?.ToString() ?? "")) return;
                    if (s.Length == 0) { Set(null); return; }
                    if (type == "number") { if (double.TryParse(s, out var num)) Set(JsonValue.Create(num)); return; }
                    if (type == "url" && !s.StartsWith("http")) s = "https://" + s;
                    Set(JsonValue.Create(s));
                }
                box.LostFocus += (_, _) => Commit();
                OnEnter(box, Commit);
                return box;
        }
    }

    /// <summary>The fields block shown at the top of a row's page.</summary>
    public static UIElement RowFields(INoteHost host, Note db, Note row, bool readOnly)
    {
        JsonObject schema;
        try { schema = JsonNode.Parse(db.DbSchema ?? "{}") as JsonObject ?? []; } catch { schema = []; }
        var values = R.PropsNode(row);
        var g = new Grid { ColumnSpacing = 12, RowSpacing = 2, Margin = new Thickness(0, 4, 0, 6) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(160) });
        g.ColumnDefinitions.Add(new ColumnDefinition { MaxWidth = 420 });
        int r = 0;
        foreach (var p in (schema["props"] as JsonArray ?? []).OfType<JsonObject>())
        {
            g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var label = H(8, I(TypeGlyph((string?)p["type"]), 13), T((string?)p["name"] ?? "", 14, "PMuted"));
            label.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetRow(label, r); g.Children.Add(label);
            var f = Field(host, row, p, values[(string)p["id"]!], !readOnly);
            f.MinHeight = 34;
            Grid.SetRow(f, r); Grid.SetColumn(f, 1); g.Children.Add(f);
            r++;
        }
        return g;
    }

    // ---- board ----

    private UIElement Board(List<Note> rows, JsonObject view)
    {
        var p = Props.OfType<JsonObject>().FirstOrDefault(x => (string?)x["id"] == (string?)view["group"]) ?? Props.OfType<JsonObject>().FirstOrDefault(HasOptions);
        if (p == null) return T("Add a Select or Status property to group the board by.", 14, "PMuted");
        var pid = (string)p["id"]!;
        var opts = (p["options"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var cols = H(12);
        var groups = opts.Select(o => ((string?)o["id"], (string?)o["name"] ?? "", (string?)o["color"])).ToList();
        groups.Insert(0, (null, "No " + ((string?)p["name"] ?? "value"), "gray"));
        foreach (var (oid, name, color) in groups)
        {
            var inCol = rows.Where(r =>
            {
                var v = R.PropsNode(r)[pid];
                return oid == null ? v == null || (v is JsonArray a && a.Count == 0) : v is JsonArray arr ? arr.Any(x => x?.ToString() == oid) : v?.ToString() == oid;
            }).ToList();
            if (oid == null && inCol.Count == 0) continue;
            var col = V(6, H(8, Pill(name, color), T(inCol.Count.ToString(), 12, "PFaint")));
            col.Width = 260;
            foreach (var r in inCol)
            {
                var values = R.PropsNode(r);
                var card = V(4, T((r.Icon != null ? r.Icon + " " : "") + r.DisplayTitle, 14, semibold: true));
                foreach (var other in Props.OfType<JsonObject>().Where(x => x != p && values[(string)x["id"]!] != null).Take(3))
                    card.Children.Add(T(Display(other, values[(string)other["id"]!]), 12, "PMuted"));
                var b = Flat(card, () => _host.OpenNote(r.Id), pad: 10);
                b.HorizontalAlignment = HorizontalAlignment.Stretch;
                b.HorizontalContentAlignment = HorizontalAlignment.Left;
                b.Background = B("PCard");
                b.BorderBrush = B("PBorder");
                b.BorderThickness = new Thickness(1);
                if (R.CanWrite)
                {
                    var move = new MenuFlyoutSubItem { Text = "Move to" };
                    foreach (var (gid, gname, _) in groups.Where(x => x.Item1 != oid))
                        move.Items.Add(Item(gname, () => { R.SetProp(r.Id, pid, gid == null ? null : (string?)p["type"] == "multi" ? new JsonArray(JsonValue.Create(gid)) : JsonValue.Create(gid)); Render(); }));
                    b.ContextFlyout = Menu(move, Item("Delete", () => { R.Trash(r.Id); Render(); }, "", true));
                }
                col.Children.Add(b);
            }
            if (R.CanWrite)
            {
                var add = Flat(H(6, I("", 12), T("New", 13, "PMuted")), () => NewRow(oid == null ? null : pid, oid == null ? null : (string?)p["type"] == "multi" ? new JsonArray(JsonValue.Create(oid)) : JsonValue.Create(oid)), pad: 6);
                add.HorizontalAlignment = HorizontalAlignment.Left;
                col.Children.Add(add);
            }
            cols.Children.Add(col);
        }
        return new ScrollViewer { Content = cols, HorizontalScrollMode = ScrollMode.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollMode = ScrollMode.Disabled, Padding = new Thickness(0, 6, 0, 12) };
    }

    // ---- calendar ----

    private UIElement Calendar(List<Note> rows, JsonObject view)
    {
        var p = Props.OfType<JsonObject>().FirstOrDefault(x => (string?)x["id"] == (string?)view["date"]) ?? Props.OfType<JsonObject>().FirstOrDefault(x => (string?)x["type"] == "date");
        if (p == null) return T("Add a Date property to use the calendar.", 14, "PMuted");
        var pid = (string)p["id"]!;
        var byDay = rows.Select(r => (r, d: R.PropsNode(r)[pid]?.ToString())).Where(x => x.d != null).GroupBy(x => x.d!).ToDictionary(g => g.Key, g => g.Select(x => x.r).ToList());

        var head = H(4, T(_month.ToString("MMMM yyyy"), 16, semibold: true),
            IconButton("", () => { _month = _month.AddMonths(-1); Render(); }, "Previous month", 12),
            Flat(T("Today", 13, "PMuted"), () => { _month = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1); Render(); }, pad: 6),
            IconButton("", () => { _month = _month.AddMonths(1); Render(); }, "Next month", 12));
        var g = new Grid();
        for (int c = 0; c < 7; c++) g.ColumnDefinitions.Add(new ColumnDefinition());
        g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var first = (int)System.Globalization.CultureInfo.CurrentCulture.DateTimeFormat.FirstDayOfWeek;
        for (int c = 0; c < 7; c++) { var t = T(System.Globalization.CultureInfo.CurrentCulture.DateTimeFormat.AbbreviatedDayNames[(c + first) % 7], 12, "PMuted"); t.Margin = new Thickness(6, 0, 0, 4); Grid.SetColumn(t, c); g.Children.Add(t); }
        var start = _month.AddDays(-(((int)_month.DayOfWeek - first + 7) % 7));
        for (int w = 0; w < 6; w++)
        {
            g.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Auto) });
            for (int c = 0; c < 7; c++)
            {
                var day = start.AddDays(w * 7 + c);
                var key = day.ToString("yyyy-MM-dd");
                var isToday = day == DateTime.Today;
                var cellStack = V(2);
                var num = T(day.Day.ToString(), 12, day.Month == _month.Month ? (isToday ? "PRed" : "PText") : "PFaint", semibold: isToday);
                var top = new Grid();
                top.Children.Add(num);
                if (R.CanWrite)
                {
                    var plus = IconButton("", () => NewRow(pid, JsonValue.Create(key)), "New on this day", 10);
                    plus.HorizontalAlignment = HorizontalAlignment.Right;
                    plus.Padding = new Thickness(2);
                    plus.Opacity = 0;
                    top.Children.Add(plus);
                    cellStack.PointerEntered += (_, _) => plus.Opacity = 1;
                    cellStack.PointerExited += (_, _) => plus.Opacity = 0;
                }
                cellStack.Children.Add(top);
                foreach (var r in byDay.GetValueOrDefault(key) ?? [])
                {
                    var chip = Flat(T(r.DisplayTitle, 12), () => _host.OpenNote(r.Id), pad: 4);
                    chip.Background = B("PCallout");
                    chip.HorizontalAlignment = HorizontalAlignment.Stretch;
                    chip.HorizontalContentAlignment = HorizontalAlignment.Left;
                    cellStack.Children.Add(chip);
                }
                var cell = new Border { Child = cellStack, MinHeight = 96, Padding = new Thickness(6, 4, 6, 4), BorderBrush = B("PBorder"), BorderThickness = new Thickness(c == 0 ? 1 : 0, w == 0 ? 1 : 0, 1, 1), Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent) };
                Grid.SetRow(cell, w + 1); Grid.SetColumn(cell, c);
                g.Children.Add(cell);
            }
        }
        return V(8, head, g);
    }
}
