using System.IO;
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
    public static class Build
    {
        public static void Run()
        {
            string output = CommandLine.Require("-buildOut");
            Generate.Everything(Generate.ManifestHash());

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
