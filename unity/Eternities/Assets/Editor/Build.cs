using System.IO;
using Eternities.Bench;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Eternities.EditorTools
{
    // The batchmode build (PRD v4 8.9.1): the macOS player for Apple Silicon, IL2CPP, not a
    // development build, with the pinned pack and the world's files inside it. It is the host of
    // the bench's figures of record (DEC-953, the bench design, section 1):
    //
    //   batchmode.sh -quit -executeMethod Eternities.EditorTools.Build.Run -buildOut <directory>
    //   <directory>/Eternities.app/Contents/MacOS/Eternities -bench warm -benchQuality high -benchOut <path>
    //
    // The player's identity (company, product, bundle identifier, minimum macOS) is in
    // ProjectSettings. The architecture is not a committed setting; it is chosen here.
    //
    // The player carries the commit it was built from and whether the tree held uncommitted
    // changes (`BuildStamp`), read from git before anything here writes: the stamp is in
    // StreamingAssets for the length of the build and is not committed.
    public static class Build
    {
        public static void Run()
        {
            string output = CommandLine.Require("-buildOut");
            string repository = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
            string commit = Git(repository, "rev-parse HEAD").Trim();
            bool dirty = Git(repository, "status --porcelain").Trim().Length > 0;
            if (commit.Length != 40)
            {
                throw new BuildFailedException($"git names no commit for {repository}: '{commit}'");
            }
            Generate.Everything(Generate.ManifestHash());
            string stamp = Path.Combine(Application.streamingAssetsPath, BuildStamp.FileName);
            File.WriteAllText(stamp, BuildStamp.Text(commit, dirty));
            try
            {
                Player(output);
            }
            finally
            {
                File.Delete(stamp);
                File.Delete(stamp + ".meta");
            }
            Debug.Log($"Build: from {commit}{(dirty ? ", with uncommitted changes" : "")}");
        }

        static string Git(string repository, string arguments)
        {
            var git = new System.Diagnostics.ProcessStartInfo("git", $"-C \"{repository}\" {arguments}") { RedirectStandardOutput = true, UseShellExecute = false };
            using (System.Diagnostics.Process process = System.Diagnostics.Process.Start(git))
            {
                string output = process.StandardOutput.ReadToEnd();
                process.WaitForExit();
                return process.ExitCode == 0 ? output : "";
            }
        }

        static void Player(string output)
        {

            UnityEditor.OSXStandalone.UserBuildSettings.architecture = OSArchitecture.ARM64;
            var options = new BuildPlayerOptions
            {
                scenes = new[] { Generate.HubScene },
                locationPathName = Path.Combine(output, "Eternities.app"),
                target = BuildTarget.StandaloneOSX,
                options = BuildOptions.None,
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            BuildSummary summary = report.summary;
            Debug.Log($"Build: {summary.result}, {summary.totalSize / (1024 * 1024)} MB, {summary.totalTime.TotalSeconds:F0} s, {summary.totalErrors} errors, {summary.outputPath}");
            if (summary.result != BuildResult.Succeeded)
            {
                throw new BuildFailedException($"the build ended as {summary.result} with {summary.totalErrors} errors");
            }
        }
    }
}
