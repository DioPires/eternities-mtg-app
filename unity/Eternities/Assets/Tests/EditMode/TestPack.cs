using System.IO;
using System.Text.RegularExpressions;
using UnityEngine;

namespace Eternities.Tests
{
    // The pinned pack as the repository holds it, `web/public/data/<hash>/`, with the hash that
    // `StreamingAssets/data/manifest.json` names. Tests read it in place: the copy under
    // StreamingAssets is made by the generation entry point and is not committed.
    public static class TestPack
    {
        public static string Hash
        {
            get
            {
                string manifest = File.ReadAllText(Path.Combine(Application.streamingAssetsPath, "data", "manifest.json"));
                return Regex.Match(manifest, "\"hash\"\\s*:\\s*\"([0-9a-f]{16})\"").Groups[1].Value;
            }
        }

        public static string Directory => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", Hash));
    }
}
