using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Graphics.Imaging;

namespace Pliopad;

/// <summary>
/// Screenshot tour used in development: with PLIOPAD_SHOTS=&lt;folder&gt; the app walks through its main screens,
/// saves a PNG of each (rendered by XAML itself), then exits. Never active in normal use.
/// </summary>
public static class AutoTest
{
    public static string? Folder => Environment.GetEnvironmentVariable("PLIOPAD_SHOTS");

    public static async Task Run(MainWindow w, FrameworkElement root)
    {
        var dir = Path.GetFullPath(Folder!);
        Directory.CreateDirectory(dir);
        var R = App.Repo;
        async Task Shot(string name, int wait = 900)
        {
            await Task.Delay(wait);
            var rtb = new RenderTargetBitmap();
            await rtb.RenderAsync(root);
            var px = await rtb.GetPixelsAsync();
            var file = await Windows.Storage.StorageFolder.GetFolderFromPathAsync(dir);
            var f = await file.CreateFileAsync(name + ".png", Windows.Storage.CreationCollisionOption.ReplaceExisting);
            using var s = await f.OpenAsync(Windows.Storage.FileAccessMode.ReadWrite);
            var enc = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, s);
            var dpi = (float)(96 * root.XamlRoot.RasterizationScale);
            enc.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)rtb.PixelWidth, (uint)rtb.PixelHeight, dpi, dpi, px.ToArray());
            await enc.FlushAsync();
        }
        try
        {
            await Task.Delay(2500); // first sync
            w.AppWindow.Resize(new Windows.Graphics.SizeInt32(2300, 1350)); // wide enough for 3 widget columns
            w.Navigate(new Route("home"));
            await Shot("01-home", 1500);
            var work = R.Notebooks().FirstOrDefault(n => n.Name == "Work");
            var plan = R.Notes().FirstOrDefault(n => n.Title == "Q4 launch plan");
            if (work != null) { w.Navigate(new Route("notebook", work.Id), plan?.Id); await Shot("02-notebook-note"); }
            w.ShowPalette("launch");
            await Shot("03-palette");
            w.Navigate(new Route("tasks"));
            await Shot("04-tasks");
            var log = new System.Text.StringBuilder();
            void Dump(Microsoft.UI.Xaml.DependencyObject d, int depth)
            {
                if (depth > 16) return;
                if (d is FrameworkElement fe && fe.ActualWidth > 300) log.AppendLine($"{new string(' ', depth * 2)}{d.GetType().Name} w={fe.ActualWidth:0} x={fe.ActualOffset.X:0} abs={fe.TransformToVisual(null).TransformPoint(new Windows.Foundation.Point(0, 0)).X:0} rt={fe.RenderTransform?.GetType().Name} tr={fe.Translation.X}");
                for (int i = 0; i < Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChildrenCount(d); i++) Dump(Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChild(d, i), depth + 1);
            }
            Dump(root, 0);
            File.WriteAllText(Path.Combine(dir, "layout.txt"), log.ToString());
            var db = R.Notes().FirstOrDefault(n => n.Kind == "db");
            if (db != null) { w.Navigate(new Route("note"), db.Id); await Shot("05-database", 1500); }
            w.Navigate(new Route("search", "launch"));
            await Shot("06-search");
            if (Environment.GetEnvironmentVariable("PLIOPAD_SHOTS_STAY") == null) w.Close();
        }
        catch (Exception e) { File.WriteAllText(Path.Combine(dir, "error.txt"), e.ToString()); w.Close(); }
    }
}
