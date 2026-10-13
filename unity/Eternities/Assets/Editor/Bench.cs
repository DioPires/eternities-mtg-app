using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Eternities.Bench;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Eternities.EditorTools
{
    // The bench's editor host (PRD v4 8.8.4; the bench design on DEC-953, section 1): what CI runs.
    // It makes the world's files, opens the persistent scene and enters play mode. `BenchRunner`
    // then starts itself from the same command line, writes the JSON and ends the editor with the
    // run's exit code. So this command is started without `-quit`:
    //
    //   batchmode.sh -executeMethod Eternities.EditorTools.Bench.Run -bench warm -benchSize 3456x2234 -benchOut <path> [-benchCaptures <directory>] [-benchStartWait <seconds>]
    //
    // A figure from this host never fills a row of the acceptance matrix: it renders off screen.
    public static class Bench
    {
        const string StartedKey = "Eternities.Bench.Started";
        const string PlayKey = "Eternities.Bench.Play";
        const double Watchdog = 900;
        const double StartWait = 300;
        const double Grace = 10;

        static double playAt = -1;      // seconds from the command to the first play-mode frame; negative before it
        static Timer secondThread;
        static int ending;

        public static void Run()
        {
            SessionState.SetString(StartedKey, EditorApplication.timeSinceStartup.ToString("R", CultureInfo.InvariantCulture));
            Watch();
            BenchArgs args = BenchArgs.Parse(System.Environment.GetCommandLineArgs());
            if (!args.Present)
            {
                throw new System.ArgumentException("-bench warm|cold is required");
            }
            Generate.Everything(CommandLine.Optional("-packHash") ?? Generate.ManifestHash());
            EditorSceneManager.OpenScene(Generate.HubScene, OpenSceneMode.Single);
            Debug.Log($"Bench: entering play mode for a {args.Mode} run");
            EditorApplication.EnterPlaymode();
        }

        // The runner ends the editor itself. If it never starts, or stops without ending it, nothing
        // else would. So a bench's editor ends itself, with exit code 1 and the reason in its log:
        //
        // - when the first play-mode frame has not come five minutes after the command. On the
        //   reference machine it comes after about half a minute. `-benchStartWait <seconds>` sets
        //   another wait;
        // - fifteen minutes after the command, whatever the run is doing.
        //
        // `Run` sets the watch as it starts, before anything that may not return. It used to be set
        // only on a script reload, and entering play mode makes none in this project
        // (`m_EnterPlayModeOptions` in ProjectSettings/EditorSettings.asset): it was never set, and
        // a job that hung ran to its timeout (DEC-976, N7). A script reload still sets it again,
        // from the session's state, which also holds when play mode started.
        //
        // The editor's main thread may be what hangs, and then nothing on it runs. So a second
        // thread holds the same two limits ten seconds later, and ends the process itself.
        [InitializeOnLoadMethod]
        static void Watch()
        {
            string started = SessionState.GetString(StartedKey, "");
            if (started.Length == 0)
            {
                return;
            }
            double since = double.Parse(started, CultureInfo.InvariantCulture);
            playAt = double.Parse(SessionState.GetString(PlayKey, "-1"), CultureInfo.InvariantCulture);
            string asked = CommandLine.Optional("-benchStartWait");
            double startWait = System.Math.Min(Watchdog, asked == null ? StartWait : double.Parse(asked, CultureInfo.InvariantCulture));
            Debug.Log($"Bench: the editor ends itself if play mode has not started {startWait} s after the command, or if no result has come after {Watchdog} s");
            EditorApplication.update += () =>
            {
                double elapsed = EditorApplication.timeSinceStartup - since;
                if (playAt < 0 && EditorApplication.isPlaying)
                {
                    Volatile.Write(ref playAt, elapsed);
                    SessionState.SetString(PlayKey, elapsed.ToString("R", CultureInfo.InvariantCulture));
                    Debug.Log($"Bench: play mode started {elapsed:F0} s after the command");
                }
                string why = Overdue(elapsed, playAt, startWait);
                if (why != null)
                {
                    Debug.LogError($"Bench: {why}; ending the editor");
                    EditorApplication.Exit(1);
                }
            };
            double armed = EditorApplication.timeSinceStartup - since;
            var clock = System.Diagnostics.Stopwatch.StartNew();
            secondThread = new Timer(_ =>
            {
                string why = Overdue(armed + clock.Elapsed.TotalSeconds - Grace, Volatile.Read(ref playAt), startWait);
                if (why != null && Interlocked.Exchange(ref ending, 1) == 0)
                {
                    EndTheProcess($"Bench: {why}, and the editor's main thread did not end it within {Grace} s; ending the process");
                }
            }, null, 1000, 1000);
        }

        // Why a bench's editor has to end `elapsed` seconds after its command, or null. `firstFrame`
        // is when the first play-mode frame came, negative while none has. A frame that came after
        // the wait counts as none, so the limit is the same whichever thread reads the clock first.
        static string Overdue(double elapsed, double firstFrame, double startWait)
        {
            bool inTime = firstFrame >= 0 && firstFrame <= startWait;
            if (elapsed <= (inTime ? Watchdog : startWait))
            {
                return null;
            }
            return inTime ? $"no result after {Watchdog} s" : $"play mode did not start within {startWait} s";
        }

        // Ends the editor from a thread that is not its main one, with exit code 1. Nothing here
        // waits for the main thread: `EditorApplication.Exit` belongs to it, and the C library's
        // `exit` runs handlers that may. The reason is logged from a task and given two seconds,
        // so a log that blocks does not hold the exit.
        static void EndTheProcess(string reason)
        {
            Task.Run(() => Debug.LogError(reason));
            Thread.Sleep(2000);
            try
            {
                _exit(1);
            }
            catch (System.Exception)
            {
                System.Environment.Exit(1);     // no `libc` by that name: not macOS
            }
        }

        [DllImport("libc")]
        static extern void _exit(int status);
    }
}
