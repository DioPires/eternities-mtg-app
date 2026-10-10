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
    //   batchmode.sh -executeMethod Eternities.EditorTools.Bench.Run -bench warm -benchSize 3456x2234 -benchOut <path> [-benchCaptures <directory>]
    //
    // A figure from this host never fills a row of the acceptance matrix: it renders off screen.
    public static class Bench
    {
        const string StartedKey = "Eternities.Bench.Started";
        const double Watchdog = 900;

        public static void Run()
        {
            SessionState.SetString(StartedKey, EditorApplication.timeSinceStartup.ToString("R", System.Globalization.CultureInfo.InvariantCulture));
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
        // else would: this ends a bench's editor with exit code 1 after fifteen minutes. Entering
        // play mode reloads the scripts, so the watch is set again from the session's state.
        [InitializeOnLoadMethod]
        static void Watch()
        {
            string started = SessionState.GetString(StartedKey, "");
            if (started.Length == 0)
            {
                return;
            }
            double since = double.Parse(started, System.Globalization.CultureInfo.InvariantCulture);
            EditorApplication.update += () =>
            {
                if (EditorApplication.timeSinceStartup - since > Watchdog)
                {
                    Debug.LogError($"Bench: no result after {Watchdog} s; ending the editor");
                    EditorApplication.Exit(1);
                }
            };
        }
    }
}
