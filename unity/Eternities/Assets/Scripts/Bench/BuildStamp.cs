using System;

namespace Eternities.Bench
{
    // What a built player knows of its own build: the commit it was built from, and whether the
    // tree held changes that no commit holds. The build writes it into the player's
    // StreamingAssets as `build.txt`, so a run names its commit on a machine with no checkout
    // (the light Mac of PRD v4 9.5, row L), and a run of record cannot name another commit than
    // the one it runs.
    public static class BuildStamp
    {
        public const string FileName = "build.txt";

        public static string Text(string commit, bool dirty) => $"commit {commit}\ndirty {(dirty ? "true" : "false")}\n";

        public static bool TryRead(string text, out string commit, out bool dirty)
        {
            commit = null;
            dirty = false;
            bool dirtySeen = false;
            foreach (string line in (text ?? "").Split('\n'))
            {
                string[] words = line.Split(new[] { ' ' }, 2);
                if (words.Length == 2 && words[0] == "commit" && words[1].Trim().Length > 0)
                {
                    commit = words[1].Trim();
                }
                else if (words.Length == 2 && words[0] == "dirty" && bool.TryParse(words[1].Trim(), out bool value))
                {
                    dirty = value;
                    dirtySeen = true;
                }
            }
            return commit != null && dirtySeen;
        }
    }
}
