using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>Every open to-do across the workspace, grouped by when it's due.</summary>
public sealed class TasksView : ScrollPage, IRefreshable
{
    private Repo R => App.Repo;
    private readonly MainWindow _main;
    private bool _byNote;

    public TasksView(MainWindow main) { _main = main; Build(); }
    public void Refresh() => Build();

    private void Build()
    {
        var tasks = R.OpenTasks();
        var today = DateTime.Today.ToString("yyyy-MM-dd");
        var week = DateTime.Today.AddDays(7).ToString("yyyy-MM-dd");
        var page = new StackPanel { MaxWidth = 820, Padding = new Thickness(56, 36, 56, 64), Spacing = 6 };
        var head = new Grid();
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(V(2, T("☑️", 40), T("Tasks", 32, bold: true), T($"{tasks.Count} open to-dos from all your notes. Add a date with @{today}.", 14, "PMuted")));
        var toggle = Flat(T(_byNote ? "Group by date" : "Group by note", 13, "PMuted"), () => { _byNote = !_byNote; Build(); });
        toggle.VerticalAlignment = VerticalAlignment.Bottom;
        Grid.SetColumn(toggle, 1);
        head.Children.Add(toggle);
        page.Children.Add(head);

        IEnumerable<(string, string, List<OpenTask>)> groups = _byNote
            ? tasks.GroupBy(t => t.NoteId).Select(g => (g.First().NoteTitle, "PText", g.ToList()))
            : new[]
            {
                ("Overdue", "PRed", tasks.Where(t => t.Due != null && string.CompareOrdinal(t.Due, today) < 0).ToList()),
                ("Today", "POrange", tasks.Where(t => t.Due == today).ToList()),
                ("Next 7 days", "PAccent", tasks.Where(t => t.Due != null && string.CompareOrdinal(t.Due, today) > 0 && string.CompareOrdinal(t.Due, week) <= 0).ToList()),
                ("Later", "PText", tasks.Where(t => t.Due != null && string.CompareOrdinal(t.Due, week) > 0).ToList()),
                ("No date", "PMuted", tasks.Where(t => t.Due == null).ToList()),
            };
        foreach (var (title, color, list) in groups)
        {
            if (list.Count == 0) continue;
            var h = H(8, T(title, 15, color, semibold: true), T(list.Count.ToString(), 13, "PFaint"));
            h.Margin = new Thickness(0, 18, 0, 4);
            page.Children.Add(h);
            foreach (var t in list) page.Children.Add(TaskRow(t, today, showNote: !_byNote));
        }
        if (tasks.Count == 0) page.Children.Add(T("Nothing to do. Type [] in any note to add a to-do.", 14, "PMuted"));
        Body = page;
    }

    private UIElement TaskRow(OpenTask t, string today, bool showNote)
    {
        var g = new Grid { ColumnSpacing = 6, Padding = new Thickness(0, 2, 0, 2), BorderBrush = B("PBorder"), BorderThickness = new Thickness(0, 0, 0, 1) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.ColumnDefinitions.Add(new ColumnDefinition());
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var cb = new CheckBox { MinWidth = 0, IsEnabled = R.CanWrite, Margin = new Thickness(0, 0, 4, 0) };
        cb.Click += (_, _) => R.ToggleTask(t.NoteId, t.BlockId);
        g.Children.Add(cb);
        var text = V(0, T(Blocks.StripDue(t.Text), 15), showNote ? T(t.NoteTitle, 12, "PMuted") : null);
        var open = Flat(text, () => _main.OpenNote(t.NoteId), pad: 4);
        open.HorizontalAlignment = HorizontalAlignment.Stretch;
        open.HorizontalContentAlignment = HorizontalAlignment.Left;
        Grid.SetColumn(open, 1); g.Children.Add(open);
        if (t.Due != null)
        {
            var label = t.Due == today ? "Today" : DateTime.TryParse(t.Due, out var d) ? d.ToString("ddd, MMM d") : t.Due;
            var due = T(label, 13, string.CompareOrdinal(t.Due, today) < 0 ? "PRed" : t.Due == today ? "POrange" : "PMuted");
            Grid.SetColumn(due, 2); g.Children.Add(due);
        }
        return g;
    }
}

/// <summary>Ask AI: questions answered from your own notes, with sources.</summary>
public sealed class AskView : ScrollPage
{
    private Repo R => App.Repo;
    private readonly MainWindow _main;
    private readonly StackPanel _answers = new() { Spacing = 18 };

    public AskView(MainWindow main)
    {
        _main = main;
        var box = new TextBox { PlaceholderText = "Ask anything about your notes…  e.g. “What did we decide about pricing?”", FontSize = 16, Padding = new Thickness(14, 10, 14, 10), CornerRadius = new CornerRadius(10) };
        var page = new StackPanel { MaxWidth = 820, Padding = new Thickness(56, 36, 56, 64), Spacing = 14 };
        page.Children.Add(V(2, T("✨", 40), T("Ask AI", 32, bold: true), T("Answers come from your workspace, with links to the notes they used.", 14, "PMuted")));
        page.Children.Add(box);
        page.Children.Add(_answers);
        Body = page;
        OnEnter(box, () => { var q = box.Text.Trim(); if (q.Length == 0) return; box.Text = ""; _ = Ask(q); });
        Loaded += (_, _) => box.Focus(FocusState.Programmatic);
    }

    private async Task Ask(string q)
    {
        var answer = T("Thinking…", 15, "PMuted");
        answer.TextWrapping = TextWrapping.Wrap;
        answer.TextTrimming = TextTrimming.None;
        answer.IsTextSelectionEnabled = true;
        var sources = H(6);
        var card = V(8, T(q, 16, semibold: true), answer, sources);
        _answers.Children.Insert(0, card);
        try
        {
            await R.SyncNow();
            var r = await R.Api.Ask(R.WsId, q);
            answer.Text = r.Answer;
            answer.Foreground = B("PText");
            foreach (var s in r.Sources)
            {
                var b = Flat(T($"[{s.N}] {s.Title}", 12, "PAccent"), () => _main.OpenNote(s.Id), pad: 4);
                b.Background = B("PCallout");
                sources.Children.Add(b);
            }
        }
        catch (Exception e) { answer.Text = e is HttpRequestException ? "You're offline. Ask AI needs a connection." : e.Message; answer.Foreground = B("PRed"); }
    }
}

/// <summary>Sign in (or create an account) to PlioPad.</summary>
public sealed class SignInView : Grid
{
    public SignInView(Action done)
    {
        Background = B("PBg");
        var R = App.Repo;
        var name = new TextBox { Header = "Your name", Visibility = Visibility.Collapsed };
        var email = new TextBox { Header = "Email", PlaceholderText = "you@company.com" };
        var pass = new PasswordBox { Header = "Password" };
        var code = new TextBox { Header = "Authenticator code", Visibility = Visibility.Collapsed, MaxLength = 8 };
        var error = T("", 13, "PRed");
        error.TextWrapping = TextWrapping.Wrap;
        error.TextTrimming = TextTrimming.None;
        var go = new Button { Content = "Sign in", Style = (Style)Application.Current.Resources["AccentButtonStyle"], HorizontalAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(0, 8, 0, 8) };
        var busy = new ProgressRing { IsActive = false, Width = 20, Height = 20 };
        var signup = false;
        var switchMode = Flat(T("New to PlioPad? Create an account", 13, "PAccent"), null, pad: 4);
        switchMode.HorizontalAlignment = HorizontalAlignment.Center;
        switchMode.Click += (_, _) =>
        {
            signup = !signup;
            name.Visibility = signup ? Visibility.Visible : Visibility.Collapsed;
            go.Content = signup ? "Create account" : "Sign in";
            ((TextBlock)switchMode.Content).Text = signup ? "Already have an account? Sign in" : "New to PlioPad? Create an account";
        };

        async Task Submit()
        {
            error.Text = "";
            go.IsEnabled = false; busy.IsActive = true;
            try
            {
                if (signup) await R.SignUp(Repo.DefaultServer, name.Text, email.Text, pass.Password);
                else await R.SignIn(Repo.DefaultServer, email.Text, pass.Password, code.Visibility == Visibility.Visible ? code.Text : null);
                done();
            }
            catch (ApiException e) when (e.Code == "mfa")
            {
                code.Visibility = Visibility.Visible;
                error.Text = e.Message;
                code.Focus(FocusState.Programmatic);
            }
            catch (HttpRequestException) { error.Text = "Can't reach PlioPad. Check your internet connection."; }
            catch (Exception e) { error.Text = e.Message; }
            finally { go.IsEnabled = true; busy.IsActive = false; }
        }
        go.Click += (_, _) => _ = Submit();
        pass.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) _ = Submit(); };
        code.KeyDown += (_, e) => { if (e.Key == Windows.System.VirtualKey.Enter) _ = Submit(); };

        var logo = new Image { Source = new Microsoft.UI.Xaml.Media.Imaging.BitmapImage(new Uri(Path.Combine(AppContext.BaseDirectory, "Assets", "Pliopad-256.png"))), Width = 64, Height = 64, HorizontalAlignment = HorizontalAlignment.Left };
        var form = V(14, logo, V(4, T("Welcome to PlioPad", 28, bold: true), T("Your notes, docs and databases — on this PC, even offline.", 14, "PMuted")),
            name, email, pass, code, error, go, H(8, busy), switchMode);
        form.Width = 380;
        form.HorizontalAlignment = HorizontalAlignment.Center;
        form.VerticalAlignment = VerticalAlignment.Center;
        Children.Add(new ScrollViewer { Content = form, VerticalAlignment = VerticalAlignment.Center });
        Loaded += (_, _) => email.Focus(FocusState.Programmatic);
    }
}

public static class Pickers
{
    /// <summary>"[[" link picker: search notes by title, or create a new page with that name.</summary>
    public static async Task<string?> PickNote(XamlRoot root, string? excludeId)
    {
        var R = App.Repo;
        var box = new TextBox { PlaceholderText = "Link to a page…", Width = 420 };
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, IsItemClickEnabled = true, MaxHeight = 320 };
        string? result = null;
        ContentDialog? dlg = null;
        void Fill()
        {
            list.Items.Clear();
            var q = box.Text.Trim();
            var notes = (q.Length == 0 ? R.Notes().Take(12) : R.Search(q).Take(12)).Where(n => n.Id != excludeId);
            foreach (var n in notes) list.Items.Add(new TextBlock { Text = $"{n.DisplayIcon}  {n.DisplayTitle}", Tag = n.Id, FontSize = 14 });
            if (q.Length > 0 && R.CanWrite) list.Items.Add(new TextBlock { Text = $"＋  New page “{q}”", Tag = "new:" + q, FontSize = 14, Foreground = B("PAccent") });
            if (list.Items.Count > 0) list.SelectedIndex = 0;
        }
        void Pick(object? item)
        {
            if (item is not TextBlock t || t.Tag is not string tag) return;
            result = tag.StartsWith("new:") ? R.CreateNote(tag[4..]) : tag;
            dlg?.Hide();
        }
        box.TextChanged += (_, _) => Fill();
        box.KeyDown += (_, e) =>
        {
            if (e.Key == Windows.System.VirtualKey.Down) { list.SelectedIndex = Math.Min(list.Items.Count - 1, list.SelectedIndex + 1); e.Handled = true; }
            else if (e.Key == Windows.System.VirtualKey.Up) { list.SelectedIndex = Math.Max(0, list.SelectedIndex - 1); e.Handled = true; }
            else if (e.Key == Windows.System.VirtualKey.Enter) { e.Handled = true; Pick(list.SelectedItem); }
        };
        list.ItemClick += (_, e) => Pick(e.ClickedItem);
        Fill();
        dlg = new ContentDialog { XamlRoot = root, Title = "Link to page", Content = V(8, box, list), CloseButtonText = "Cancel" };
        dlg.Opened += (_, _) => box.Focus(FocusState.Programmatic);
        await dlg.ShowAsync();
        return result;
    }
}
