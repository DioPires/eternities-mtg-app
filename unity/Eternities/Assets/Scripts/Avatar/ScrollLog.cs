using System;
using System.Globalization;
using System.IO;
using UnityEngine;

namespace Eternities.Avatar
{
    // An instrument, not a feature (DEC-978). Nobody who set the zoom's numbers had a hand on a
    // trackpad, so the player writes down every scroll part it reads, and the owner's check of
    // the zoom yields what a trackpad and a wheel really send: the parts' sizes, how many come in
    // a second, and the tail after the fingers lift. The zoom's numbers are from its file. It
    // also writes down what the visitor was doing and where the frame left the camera, for the
    // owner's wheel, which did not zoom while they moved. It comes out when that is settled.
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
        static string part;     // the line of this frame's part, until the camera is placed
        static bool failed;

        // A part's line waits for the camera's half of it.
        public static bool Waiting => part != null;

        // What the mouse's scroll read in this frame, across as well as along: the zoom reads the
        // one, and holding Shift, which is running, is known to turn a wheel's scroll into the
        // other on a Mac. And what the visitor was doing: moving, running, and whether the camera
        // held the pointer.
        public static void Part(Vector2 scroll, bool moving, bool running, bool held)
        {
            string path = PathForTests ?? (Application.isBatchMode ? null : Path.Combine(Application.persistentDataPath, FileName));
            if (path == null || failed)
            {
                return;
            }
            try
            {
                Write();
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
                        "# run: build {0}; started {1:yyyy-MM-ddTHH:mm:ssZ} at {2:F4} s; quality {3}; a line a part: seconds, frame, the frame's unscaled seconds, the part, the scroll across, moving, running, the pointer held, the orbit's metres, the camera's metres",
                        build, DateTime.UtcNow, Time.unscaledTime, level));
                }
                part = string.Format(CultureInfo.InvariantCulture, "{0:F4}\t{1}\t{2:F4}\t{3:R}\t{4:R}\t{5}\t{6}\t{7}",
                    Time.unscaledTime, Time.frameCount, Time.unscaledDeltaTime, scroll.y, scroll.x, moving ? 1 : 0, running ? 1 : 0, held ? 1 : 0);
            }
            catch (Exception exception) when (exception is IOException || exception is UnauthorizedAccessException)
            {
                Fail(path, exception);
            }
        }

        // Where the frame left the camera, once it is placed (`FollowCamera`): the metres its
        // orbit asks for after the frame's zoom, and the metres it really is from the point it
        // orbits. They are fewer where something stands between and the camera is held in front
        // of it.
        public static void Camera(float orbit, float real)
        {
            if (part == null)
            {
                return;
            }
            part += string.Format(CultureInfo.InvariantCulture, "\t{0:F3}\t{1:F3}", orbit, real);
            try
            {
                Write();
            }
            catch (Exception exception) when (exception is IOException || exception is UnauthorizedAccessException)
            {
                Fail(open, exception);
            }
        }

        public static void Close()
        {
            Write();
            file?.Dispose();
            file = null;
            open = null;
        }

        // The line that waits, with the camera's half or, where no camera was placed, without.
        static void Write()
        {
            string line = part;
            part = null;
            if (line != null)
            {
                file.WriteLine(line);
            }
        }

        // The zoom does not depend on its instrument.
        static void Fail(string path, Exception exception)
        {
            failed = true;
            part = null;
            Debug.LogWarning($"ScrollLog: {path} cannot be written, so the scroll's parts are not logged: {exception.Message}");
        }
    }
}
