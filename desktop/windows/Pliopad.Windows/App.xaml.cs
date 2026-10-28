using Microsoft.UI.Xaml;
using Pliopad.Core;

namespace Pliopad;

public partial class App : Application
{
    public static Repo Repo { get; private set; } = null!;
    /// <summary>PLIOPAD_DATA lets a second profile run side by side (testing two devices on one PC).</summary>
    public static string DataDir { get; } = Environment.GetEnvironmentVariable("PLIOPAD_DATA")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pliopad");
    public static MainWindow? Main { get; private set; }

    public App()
    {
        InitializeComponent();
        Repo = new Repo(DataDir);
        // The theme can only be chosen before the first window exists.
        var theme = Repo.Pref("theme");
        if (theme == "light") RequestedTheme = ApplicationTheme.Light;
        else if (theme == "dark") RequestedTheme = ApplicationTheme.Dark;
        UnhandledException += (_, e) =>
        {
            try { File.AppendAllText(Path.Combine(DataDir, "crash.log"), $"{DateTime.Now:u} {e.Exception}\n"); } catch { }
            e.Handled = true;
        };
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        Main = new MainWindow();
        Main.Activate();
    }
}
