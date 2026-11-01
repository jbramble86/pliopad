using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Pliopad.Core;
using static Pliopad.Ui;

namespace Pliopad;

/// <summary>
/// Help center: the same articles as the web and Android (from the server), "Contact support", and your requests,
/// which platform admins answer from the admin console. Needs an internet connection.
/// </summary>
public sealed class HelpView : ScrollPage
{
    private Repo R => App.Repo;
    private readonly MainWindow _main;
    private HelpData? _help;
    private static readonly (string Key, string Label)[] Kinds = [("question", "A question"), ("problem", "Something isn't working"), ("billing", "Billing or my plan"), ("idea", "A feature idea")];
    private static string AppVersion => typeof(HelpView).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "";

    public HelpView(MainWindow main)
    {
        _main = main;
        Body = Page(T("Loading…", 14, "PMuted"));
        _ = Load();
    }

    private async Task Load()
    {
        try { _help = await R.Api.Help(); ShowFront(); }
        catch { Body = Page(T("The Help center needs an internet connection.", 14, "PMuted")); }
    }

    private static StackPanel Page(params UIElement?[] kids)
    {
        var p = V(10, kids);
        p.MaxWidth = 820;
        p.Padding = new Thickness(56, 36, 56, 64);
        return p;
    }

    private static TextBlock Wrap(TextBlock t) { t.TextWrapping = TextWrapping.Wrap; t.TextTrimming = TextTrimming.None; return t; }
    private Button Back() => Flat(H(6, I("", 12), T("Help center", 13, "PMuted")), ShowFront, pad: 6);

    private Button ArticleRow(HelpArticle a)
    {
        var b = Row("", a.Title, () => ShowArticle(a.Id), glyph: true);
        b.Margin = new Thickness(-8, 0, -8, 0);
        return b;
    }

    private Border ContactCard(string title, string sub, string? articleId = null)
    {
        var go = new Button { Content = H(8, I("", 14, "PText"), T("Contact support", 14)), Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
        go.Click += (_, _) => ShowContact(articleId);
        var g = new Grid { ColumnSpacing = 14 };
        g.ColumnDefinitions.Add(new ColumnDefinition());
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        g.Children.Add(V(2, T(title, 16, semibold: true), Wrap(T(sub, 13, "PMuted"))));
        go.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(go, 1); g.Children.Add(go);
        return new Border { Background = B("PSelected"), CornerRadius = new CornerRadius(14), Padding = new Thickness(18, 14, 18, 14), Margin = new Thickness(0, 12, 0, 0), Child = g };
    }

    // ---- Front page: search, articles by category, contact, your requests ----

    private void ShowFront()
    {
        var help = _help!;
        var results = new StackPanel();
        var cats = new StackPanel { Spacing = 12 };
        var search = new TextBox { PlaceholderText = "Search help articles", FontSize = 15, Padding = new Thickness(14, 10, 14, 10), CornerRadius = new CornerRadius(20) };
        search.TextChanged += (_, _) =>
        {
            var q = search.Text.Trim();
            results.Children.Clear();
            cats.Visibility = q.Length > 0 ? Visibility.Collapsed : Visibility.Visible;
            if (q.Length == 0) return;
            var hits = help.Articles.Where(a => (a.Title + " " + a.Body).Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();
            foreach (var a in hits) results.Children.Add(ArticleRow(a));
            if (hits.Count == 0) results.Children.Add(T("No articles match. Ask us instead.", 13, "PMuted"));
        };
        foreach (var c in help.Categories)
        {
            var list = V(0, H(10, new Border { Width = 30, Height = 30, CornerRadius = new CornerRadius(9), Background = B("PSelected"),
                Child = new TextBlock { Text = c.Icon, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } }, T(c.Name, 15, semibold: true)));
            foreach (var a in help.Articles.Where(a => a.Category == c.Id)) list.Children.Add(ArticleRow(a));
            var card = Card(list, 14);
            card.CornerRadius = new CornerRadius(14);
            cats.Children.Add(card);
        }
        var requests = new StackPanel { Spacing = 6 };
        requests.Children.Add(T("Loading your requests…", 13, "PMuted"));
        Body = Page(T("How can we help?", 30, bold: true), search, results, cats,
            ContactCard("Still need help?", "Send us a message. We reply by email and here in the Help center, on every device."),
            T("Your requests", 15, semibold: true), requests);
        _ = LoadRequests(requests);
    }

    private async Task LoadRequests(StackPanel into)
    {
        try
        {
            var mine = await R.Api.Tickets();
            into.Children.Clear();
            if (mine.Count == 0) into.Children.Add(T("You haven't contacted support yet.", 13, "PMuted"));
            foreach (var t in mine)
            {
                var g = new Grid { ColumnSpacing = 10 };
                g.ColumnDefinitions.Add(new ColumnDefinition());
                g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                g.Children.Add(V(1, T(t.Subject, 14, semibold: true), T($"#{t.Id} · {t.StatusName}", 12, "PMuted")));
                if (t.Unread)
                {
                    var badge = new Border { Background = B("PAccent"), CornerRadius = new CornerRadius(10), Padding = new Thickness(8, 2, 8, 2), VerticalAlignment = VerticalAlignment.Center,
                        Child = new TextBlock { Text = "New reply", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Microsoft.UI.Colors.White) } };
                    Grid.SetColumn(badge, 1); g.Children.Add(badge);
                }
                var b = new Button { Content = g, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(12, 10, 12, 10),
                    CornerRadius = new CornerRadius(12), BorderBrush = t.Unread ? B("PAccent") : B("PBorder"), BorderThickness = new Thickness(1), Background = B("PBg") };
                b.Click += (_, _) => _ = ShowRequest(t.Id);
                into.Children.Add(b);
            }
        }
        catch (Exception e) { into.Children.Clear(); into.Children.Add(T(e.Message, 13, "PMuted")); }
    }

    // ---- An article ----

    private void ShowArticle(string id)
    {
        var a = _help!.Articles.FirstOrDefault(x => x.Id == id);
        if (a == null) { ShowFront(); return; }
        var cat = _help.Categories.FirstOrDefault(c => c.Id == a.Category);
        var page = Page(Back(), T($"{cat?.Icon} {cat?.Name}", 13, "PMuted"), Wrap(T(a.Title, 28, bold: true)));
        foreach (var para in a.Body.Split("\n\n"))
            foreach (var line in para.Split('\n'))
            {
                var m = System.Text.RegularExpressions.Regex.Match(line, @"^(- |\d+\. )");
                var t = Wrap(T(m.Success ? (m.Value == "- " ? "•  " : m.Value) + line[m.Length..] : line, 15));
                t.LineHeight = 24;
                if (m.Success) t.Margin = new Thickness(8, 0, 0, 0);
                page.Children.Add(t);
            }
        var related = _help.Articles.Where(x => x.Category == a.Category && x.Id != a.Id).ToList();
        if (related.Count > 0) { page.Children.Add(T("Related", 15, semibold: true)); foreach (var r in related) page.Children.Add(ArticleRow(r)); }
        var contact = ContactCard("Didn't answer your question?", "Tell us what you need and we'll get back to you.", a.Id);
        page.Children.Add(Feedback(a, contact));
        page.Children.Add(contact);
        Body = page;
    }

    /// <summary>"Did this help?" Yes thanks them; No offers to ask support with this article attached (and hides the duplicate contact card).</summary>
    private Border Feedback(HelpArticle a, Border contact)
    {
        var box = new Border { BorderBrush = B("PBorder"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(12), Padding = new Thickness(14, 8, 10, 8), Margin = new Thickness(0, 12, 0, 0) };
        var key = "help.vote." + a.Id;
        void Draw()
        {
            var vote = R.Pref(key);
            contact.Visibility = vote == "no" ? Visibility.Collapsed : Visibility.Visible;
            var g = new Grid { ColumnSpacing = 8 };
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            UIElement text, actions;
            if (vote == null)
            {
                text = T("Did this help?", 14, semibold: true);
                actions = H(6, Flat(T("👍 Yes", 13), () => Answer(true), pad: 8), Flat(T("👎 No", 13), () => Answer(false), pad: 8));
            }
            else if (vote == "yes")
            {
                text = T("🎉 Glad it helped. Thanks for letting us know!", 14);
                actions = Flat(T("Change", 12, "PMuted"), () => { R.SetPref(key, null); Draw(); }, pad: 6);
            }
            else
            {
                text = Wrap(T("Sorry it didn't help. Tell us what you need and we'll get back to you.", 14));
                var ask = new Button { Content = "Ask support", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
                ask.Click += (_, _) => ShowContact(a.Id);
                actions = H(6, ask, Flat(T("Change", 12, "PMuted"), () => { R.SetPref(key, null); Draw(); }, pad: 6));
            }
            ((FrameworkElement)text).VerticalAlignment = VerticalAlignment.Center;
            g.Children.Add(text);
            Grid.SetColumn((FrameworkElement)actions, 1); g.Children.Add(actions);
            box.Child = g;
        }
        void Answer(bool helpful)
        {
            R.SetPref(key, helpful ? "yes" : "no");
            Draw();
            _ = R.Api.HelpFeedback(a.Id, helpful).ContinueWith(_ => { }); // the answer is kept here either way
        }
        Draw();
        return box;
    }

    // ---- Attachments (screenshots and files) ----

    private sealed class Attachments
    {
        public readonly List<SupportFile> Files = [];
        public int Uploading;
        public readonly StackPanel Chips = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    }

    private Button AttachButton(Attachments att)
    {
        var b = Flat(H(6, I("", 13, "PText"), T("Attach screenshots or files", 13)), null, "Up to 5, 10 MB each", 8);
        b.BorderBrush = B("PBorder"); b.BorderThickness = new Thickness(1);
        b.Click += async (_, _) =>
        {
            var picker = new Windows.Storage.Pickers.FileOpenPicker();
            picker.FileTypeFilter.Add("*");
            WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(_main));
            var files = await picker.PickMultipleFilesAsync();
            foreach (var f in files.Take(5 - att.Files.Count))
            {
                att.Uploading++;
                try { att.Files.Add(await R.Api.UploadSupportFile(f.Path)); }
                catch (Exception e) { await Alert(_main.Root, "Couldn't attach " + f.Name, T(e.Message, 14)); }
                att.Uploading--;
                DrawChips(att);
            }
        };
        return b;
    }

    private static void DrawChips(Attachments att)
    {
        att.Chips.Children.Clear();
        foreach (var f in att.Files)
        {
            var chip = Flat(H(6, I("", 12), T(f.Name, 12), I("", 10)), () => { att.Files.Remove(f); DrawChips(att); }, "Remove", 6);
            chip.Background = B("PSelected");
            att.Chips.Children.Add(chip);
        }
    }

    // ---- Contact support ----

    private void ShowContact(string? articleId = null)
    {
        var about = _help?.Articles.FirstOrDefault(x => x.Id == articleId);
        var aboutBar = new Border { Background = B("PSelected"), CornerRadius = new CornerRadius(10), Padding = new Thickness(12, 6, 6, 6), Visibility = about == null ? Visibility.Collapsed : Visibility.Visible };
        if (about != null)
        {
            var g = new Grid { ColumnSpacing = 8 };
            g.ColumnDefinitions.Add(new ColumnDefinition());
            g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            g.Children.Add(Wrap(T($"📄 About the article “{about.Title}”. We'll see you've already read it.", 13)));
            var remove = IconButton("\uE711", () => { about = null; aboutBar.Visibility = Visibility.Collapsed; }, "Not about this article", 11);
            Grid.SetColumn(remove, 1); g.Children.Add(remove);
            aboutBar.Child = g;
        }
        var kind = new ComboBox { MinWidth = 260 };
        foreach (var (_, label) in Kinds) kind.Items.Add(label);
        kind.SelectedIndex = 0;
        var subject = new TextBox { PlaceholderText = "A short summary", MaxLength = 200 };
        var body = new TextBox { PlaceholderText = "What happened, what you expected, and any steps to reproduce it.", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 180 };
        var att = new Attachments();
        var error = Wrap(T("", 13, "PRed"));
        var send = new Button { Content = "Send to support", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
        send.Click += async (_, _) =>
        {
            if (subject.Text.Trim().Length == 0 || body.Text.Trim().Length == 0) { error.Text = "Add a subject and a description."; return; }
            if (att.Uploading > 0) { error.Text = "Wait for the attachments to finish uploading."; return; }
            send.IsEnabled = false;
            try
            {
                var t = await R.Api.OpenTicket(subject.Text.Trim(), body.Text.Trim(), Kinds[Math.Max(0, kind.SelectedIndex)].Key, R.WsId == 0 ? null : R.WsId, AppVersion, att.Files.Select(f => f.Id), about?.Id);
                await ShowRequest(t.Id);
            }
            catch (Exception e) { error.Text = e.Message; send.IsEnabled = true; }
        };
        Body = Page(Back(), T("Contact support", 28, bold: true),
            Wrap(T("We reply by email and in the Help center. Your app and version are included automatically.", 14, "PMuted")),
            aboutBar,
            T("What's it about?", 13, "PMuted"), kind, T("Subject", 13, "PMuted"), subject, T("Details", 13, "PMuted"), body,
            H(8, AttachButton(att)), att.Chips, error, send);
    }

    // ---- One of your requests ----

    private async Task ShowRequest(long id)
    {
        Body = Page(Back(), T("Loading…", 14, "PMuted"));
        Ticket t;
        try { t = await R.Api.Ticket(id); } catch (Exception e) { Body = Page(Back(), T(e.Message, 14, "PMuted")); return; }
        var page = Page(Back(), Wrap(T(t.Subject, 26, bold: true)), T($"#{t.Id} · {t.StatusName}" + (t.Article != null ? $" · about “{t.Article.Title}”" : ""), 13, "PMuted"));
        foreach (var m in t.Messages ?? [])
        {
            var who = m.Staff ? $"{m.Author ?? "Support"} · PlioPad support" : "You";
            var msg = V(4, T($"{who} · {DateTimeOffset.FromUnixTimeMilliseconds(m.CreatedAt).LocalDateTime:g}", 12, "PMuted"), Wrap(T(m.Body, 14)));
            foreach (var f in m.Files ?? [])
            {
                var link = new HyperlinkButton { Content = "📎 " + f.Name, NavigateUri = new Uri(f.Url), Padding = new Thickness(0) };
                msg.Children.Add(link);
            }
            page.Children.Add(new Border { Background = m.Staff ? B("PSelected") : B("PHover"), CornerRadius = new CornerRadius(12), Padding = new Thickness(14, 10, 14, 12),
                Margin = m.Staff ? new Thickness(40, 0, 0, 0) : new Thickness(0, 0, 40, 0), Child = msg });
        }
        if (t.Status == "closed" && t.Rating == null)
        {
            var good = Flat(T("👍 Good", 13), async () => { await R.Api.RateTicket(id, "good"); await ShowRequest(id); }, pad: 8);
            var bad = Flat(T("👎 Not great", 13), async () => { await R.Api.RateTicket(id, "bad"); await ShowRequest(id); }, pad: 8);
            page.Children.Add(Card(H(8, T("How did we do?", 14, semibold: true), good, bad), 10));
        }
        if (t.Rating != null) page.Children.Add(T($"You rated this {(t.Rating == "good" ? "👍 good" : "👎 not great")}. Thanks!", 13, "PMuted"));
        var reply = new TextBox { PlaceholderText = t.Status == "closed" ? "Write to reopen this request…" : "Write a reply…", AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 110 };
        var att = new Attachments();
        var send = new Button { Content = t.Status == "closed" ? "Reopen and send" : "Send reply", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
        send.Click += async (_, _) =>
        {
            if (reply.Text.Trim().Length == 0 || att.Uploading > 0) return;
            send.IsEnabled = false;
            try { await R.Api.ReplyTicket(id, reply.Text.Trim(), att.Files.Select(f => f.Id)); await ShowRequest(id); }
            catch (Exception e) { send.IsEnabled = true; await Alert(_main.Root, "Couldn't send", T(e.Message, 14)); }
        };
        var actions = H(8, send, AttachButton(att));
        if (t.Status != "closed") actions.Children.Add(Flat(T("Mark as solved", 13), async () => { await R.Api.CloseTicket(id); await ShowRequest(id); }, pad: 8));
        page.Children.Add(reply);
        page.Children.Add(att.Chips);
        page.Children.Add(actions);
        Body = page;
    }
}
