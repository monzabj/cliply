using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class ClipperInstaller
{
    private const string Repository = "monzabj/cliply";

    [STAThread]
    private static int Main(string[] args)
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        if (args.Length == 1 && args[0] == "--verify-download")
        {
            using (var client = CreateClient())
                return RunAsync(client, _ => { }, null, Console.Error.WriteLine).GetAwaiter().GetResult();
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var client = CreateClient())
        using (var window = new Form())
        using (var status = new Label())
        using (var progress = new ProgressBar())
        {
            window.Text = "Instalador de Clipper";
            window.ClientSize = new Size(420, 100);
            window.AutoScaleMode = AutoScaleMode.Font;
            window.FormBorderStyle = FormBorderStyle.FixedDialog;
            window.MaximizeBox = false;
            window.StartPosition = FormStartPosition.CenterScreen;
            window.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            status.SetBounds(16, 14, 388, 32);
            progress.SetBounds(16, 56, 388, 22);
            progress.Style = ProgressBarStyle.Marquee;
            window.Controls.AddRange(new Control[] { status, progress });

            bool finished = false;
            bool installing = false;
            bool cancelled = false;
            int result = 1;
            client.DownloadProgressChanged += (sender, update) =>
            {
                if (update.TotalBytesToReceive > 0)
                {
                    progress.Style = ProgressBarStyle.Continuous;
                    progress.Value = update.ProgressPercentage;
                }
            };
            window.FormClosing += (sender, closing) =>
            {
                if (finished || closing.CloseReason != CloseReason.UserClosing) return;
                closing.Cancel = true;
                if (!installing)
                {
                    cancelled = true;
                    status.Text = "Cancelando…";
                    client.CancelAsync();
                }
            };
            window.Shown += async (sender, shown) =>
            {
                result = await RunAsync(client, message => { if (!cancelled) status.Text = message; }, file =>
                {
                    if (cancelled) return Task.FromResult(1);
                    installing = true;
                    while (ClipperIsRunning())
                    {
                        DialogResult choice = MessageBox.Show(window,
                            "Terminá cualquier grabación y cerrá Clipper desde el ícono de la bandeja. Después elegí Reintentar.",
                            window.Text, MessageBoxButtons.RetryCancel, MessageBoxIcon.Information);
                        if (choice != DialogResult.Retry) return Task.FromResult(1);
                    }
                    progress.Style = ProgressBarStyle.Marquee;
                    return Task.Run(() =>
                    {
                        using (var setup = Process.Start(new ProcessStartInfo(file) { UseShellExecute = true }))
                        {
                            setup.WaitForExit();
                            if (setup.ExitCode != 0)
                                throw new InvalidOperationException("El instalador terminó con código " + setup.ExitCode + ".");
                        }
                        return 0;
                    });
                }, error =>
                {
                    if (!cancelled)
                        MessageBox.Show(window, error, window.Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                });
                finished = true;
                window.Close();
            };
            Application.Run(window);
            return result;
        }
    }

    private static WebClient CreateClient()
    {
        var client = new WebClient();
        client.Headers[HttpRequestHeader.UserAgent] = "Clipper-Installer";
        return client;
    }

    private static bool ClipperIsRunning()
    {
        Process[] instances = Process.GetProcessesByName("Clipper");
        foreach (Process instance in instances) instance.Dispose();
        return instances.Length > 0;
    }

    private static async Task<int> RunAsync(
        WebClient client, Action<string> status, Func<string, Task<int>> install, Action<string> error)
    {
        string temp = Path.Combine(Path.GetTempPath(), "ClipperInstaller-" + Guid.NewGuid().ToString("N"));
        try
        {
            if (!Environment.Is64BitOperatingSystem)
                throw new InvalidOperationException("Clipper requiere Windows de 64 bits.");

            status("Buscando la última versión de Clipper…");
            string json = await client.DownloadStringTaskAsync("https://api.github.com/repos/" + Repository + "/releases/latest");
            var release = new JavaScriptSerializer().Deserialize<Release>(json);
            string tag = release.tag_name ?? "";
            if (!Regex.IsMatch(tag, @"\Av[0-9]+\.[0-9]+\.[0-9]+\z"))
                throw new InvalidDataException("GitHub no devolvió una versión estable de Clipper.");

            string version = tag.Substring(1);
            string name = "Clipper-Setup-" + version + ".exe";
            Asset asset = release.assets.SingleOrDefault(item => item.name == name);
            if (asset == null || !Regex.IsMatch(asset.digest ?? "", @"\Asha256:[0-9a-f]{64}\z"))
                throw new InvalidDataException("El instalador de esta versión todavía no está disponible.");

            status("Descargando Clipper " + version + "…");
            Directory.CreateDirectory(temp);
            string file = Path.Combine(temp, name);
            await client.DownloadFileTaskAsync("https://github.com/" + Repository + "/releases/download/" + tag + "/" + name, file);

            status("Verificando la descarga…");
            string digest = await Task.Run(() =>
            {
                using (var sha256 = SHA256.Create())
                using (var stream = File.OpenRead(file))
                    return "sha256:" + BitConverter.ToString(sha256.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            });
            if (digest != asset.digest)
                throw new InvalidDataException("La descarga no pasó la verificación de integridad. Volvé a abrir el instalador.");

            if (install == null) return 0;
            status("Instalando Clipper " + version + "…");
            return await install(file);
        }
        catch (Exception failure)
        {
            error(failure.GetBaseException().Message);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(temp)) Directory.Delete(temp, true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    public sealed class Release
    {
        public string tag_name { get; set; }
        public Asset[] assets { get; set; }
    }

    public sealed class Asset
    {
        public string name { get; set; }
        public string digest { get; set; }
    }
}
