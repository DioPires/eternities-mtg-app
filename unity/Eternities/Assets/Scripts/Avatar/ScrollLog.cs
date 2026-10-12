using System;
using System.Globalization;
using System.IO;
using UnityEngine;

namespace Eternities.Avatar
{
    // An instrument, not a feature (DEC-978). Nobody who set the zoom's numbers had a hand on a
    // trackpad, so the player writes down every scroll part it reads, and the owner's check of
    // the zoom yields what a trackpad really sends: the parts' sizes, how many come in a second,
    // and the tail after the fingers lift. It comes out when the numbers are final.
    //
    // It writes `scroll-parts.txt` under `Application.persistentDataPath`, and only ever adds to
    // it: a line for each run that scrolled, naming the build, the start and the quality level,
    // and under it a line for each part. A bench run reads no scroll and a batchmode editor is
    // nobody's hand, so neither writes anything; a test names a file of its own.
    public static class ScrollLog
    {
        public const string FileName = "scroll-parts.txt";

        public static string PathForTests;

        static StreamWriter file;
        static string open;     // the path `file` writes to
        static bool failed;

        public static void Part(float part)
        {
            string path = PathForTests ?? (Application.isBatchMode ? null : Path.Combine(Application.persistentDataPath, FileName));
            if (path == null || failed)
            {
                return;
            }
            try
            {
                if (path != open)
                {
                    Close();
                    file = new StreamWriter(path, true) { AutoFlush = true };
                    open = path;
                    // The build's stamp, as `Build` writes it into the player (`BuildStamp`).
                    string stamp = Path.Combine(Application.streamingAssetsPath, "build.txt");
                    string build = File.Exists(stamp) ? File.ReadAllText(stamp).Trim().Replace('\n', ' ') : "none, the editor";
                    string level = QualitySettings.names[QualitySettings.GetQualityLevel()];
                    file.WriteLine(string.Format(CultureInfo.InvariantCulture,
                        "# run: build {0}; started {1:yyyy-MM-ddTHH:mm:ssZ} at {2:F4} s; quality {3}; a line a part: seconds, frame, the frame's unscaled seconds, the part",
                        build, DateTime.UtcNow, Time.unscaledTime, level));
                }
                file.WriteLine(string.Format(CultureInfo.InvariantCulture, "{0:F4}\t{1}\t{2:F4}\t{3:R}", Time.unscaledTime, Time.frameCount, Time.unscaledDeltaTime, part));
            }
            catch (Exception exception) when (exception is IOException || exception is UnauthorizedAccessException)
            {
                // The zoom does not depend on its instrument.
                failed = true;
                Debug.LogWarning($"ScrollLog: {path} cannot be written, so the scroll's parts are not logged: {exception.Message}");
            }
        }

        public static void Close()
        {
            file?.Dispose();
            file = null;
            open = null;
        }
    }
}
