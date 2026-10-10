using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Eternities.Tests
{
    public class PackManifestTests
    {
        // PRD v4 8.3.1: a build picks the pack from `StreamingAssets/data/manifest.json`.
        [Test]
        public void ManifestNamesAPackHash()
        {
            string manifest = File.ReadAllText(Path.Combine(Application.streamingAssetsPath, "data", "manifest.json"));
            StringAssert.IsMatch("\"hash\"\\s*:\\s*\"[0-9a-f]{16}\"", manifest);
        }
    }
}
