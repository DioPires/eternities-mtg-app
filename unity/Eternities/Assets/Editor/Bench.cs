using System.IO;
using UnityEngine;

namespace Eternities.EditorTools
{
    // The batchmode bench runner (PRD v4 8.8.4). The JSON schema and the path script are agreed in
    // the slice issue (PRD v4 9.5), so the skeleton writes an empty result: enough for the CI job to
    // prove that the runner starts, writes where it is told and has its output archived.
    public static class Bench
    {
        public static void Run()
        {
            string outPath = CommandLine.Require("-benchOut");
            File.WriteAllText(outPath, "{}\n");
            Debug.Log($"Bench: wrote {outPath}");
        }
    }
}
