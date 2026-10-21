using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Kits;
using Eternities.EditorTools;
using Eternities.Layout;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Eternities.Tests
{
    public class GenerateTests
    {
        // PRD v4 8.8.2: the scene generation entry point produces a world with the expected stand
        // count. What it writes is what the engine reads, so the test reads it back from disk: the
        // three files of contract v4 are the committed Dominaria fixture's, byte for byte, and the
        // engine's own loader decodes them beside the copied part of the pack.
        [Test]
        public void TheEntryPointWritesDominariaWithEveryStand()
        {
            WorldFiles.Result world = Generate.Build(TestPack.Hash, "dominaria");
            string target = Generate.ProjectPack(TestPack.Hash);
            string fixture = WorldFiles.FixtureOf(Generate.RepositoryPack(TestPack.Hash), "dominaria");
            // The sites and the radius are the fixture's, not today's layout written down
            // (DEC-1194 B2).
            WorldDocument expected = WorldDocument.Read(Json.Parse(File.ReadAllText(WorldFiles.WorldPath(fixture, "dominaria"))));
            int era = expected.Sites.Count(site => site.Kind == "era"), regional = expected.Sites.Count(site => site.Kind == "region"), set = expected.Sites.Count(site => site.Kind == "set");
            Assert.That(world.Stands, Is.EqualTo(6271));
            Assert.That(world.Sites, Is.EqualTo(expected.Sites.Length).And.GreaterThan(0));
            StringAssert.Contains($"Stands: 6,271. Sites: {expected.Sites.Length} ({era} era, {regional} regional, {set} set).", world.Report);

            Assert.That(File.ReadAllBytes(WorldFiles.StandsPath(target)), Is.EqualTo(File.ReadAllBytes(WorldFiles.StandsPath(fixture))));
            Assert.That(File.ReadAllBytes(WorldFiles.WorldPath(target, "dominaria")), Is.EqualTo(File.ReadAllBytes(WorldFiles.WorldPath(fixture, "dominaria"))));
            Assert.That(File.ReadAllBytes(WorldFiles.LorePath(target, "dominaria")), Is.EqualTo(File.ReadAllBytes(WorldFiles.LorePath(fixture, "dominaria"))));
            Assert.That(Directory.Exists(Path.Combine(target, "layout")), Is.False, "the first slice's layout file is gone");

            // The copied part of the pack opens by itself and holds the same cards.
            var copy = new Pack(target);
            PackCard[] cards = copy.Cards(copy.Plane("dominaria"));
            Assert.That(cards.Length, Is.EqualTo(6271));
            Assert.That(copy.Swatches().Length, Is.EqualTo(Pack.SwatchHeader + 28603 * Pack.SwatchRecord));

            // And the engine's own loader takes them together.
            using (WorldData loaded = WorldData.Load(target, "dominaria"))
            {
                Assert.That(loaded.StandCount, Is.EqualTo(6271));
                Assert.That(loaded.Layout.Radius, Is.EqualTo(expected.Radius).And.GreaterThan(0));
                Assert.That(loaded.CardAt(0).OracleId, Is.EqualTo(loaded.Stands.OracleId(0)).IgnoreCase);
                loaded.Swatch(loaded.CardOf[0], 0, out byte r, out byte g, out byte b);
                Assert.That(r + g + b, Is.GreaterThan(0));
            }
        }

        // World entry in the player (`App.Load`) uses the records that the launch read and asserted
        // (`App.Start`), as PRD v4 8.3.2 reads `stands.bin` once at launch: it reads no
        // `stands.bin`, and the world's disposal leaves the records to the app, which disposes
        // them when it ends (DEC-1130 B2).
        [Test]
        public void WorldEntryUsesTheLaunchsRecordsAndLeavesThemToTheApp()
        {
            string target = Path.Combine(Path.GetTempPath(), "eternities-world-entry-" + System.Guid.NewGuid().ToString("N"));
            try
            {
                WorldFiles.Generate(Generate.RepositoryPack(TestPack.Hash), target, "dominaria");
                using (StandsFile launched = StandsFile.Read(File.ReadAllBytes(WorldFiles.StandsPath(target))))
                {
                    WorldData.AssertAtLaunch(launched, new Pack(target).Planes.Length);
                    int yaw = launched.Yaw[6270];
                    File.Delete(WorldFiles.StandsPath(target));
                    Assert.Throws<FileNotFoundException>(() => WorldData.Load(target, "dominaria").Dispose(), "without the launch's records the file is read");
                    using (WorldData world = WorldData.Load(target, "dominaria", launched))
                    {
                        Assert.That(world.Stands, Is.SameAs(launched));
                        Assert.That(world.StandCount, Is.EqualTo(6271));
                        Assert.That(world.CardAt(6270).OracleId, Is.EqualTo(launched.OracleId(6270)).IgnoreCase);
                    }
                    Assert.That(launched.X.IsCreated && launched.Oracle.IsCreated, Is.True, "the world's disposal leaves the launch's records");
                    Assert.That(launched.Yaw[6270], Is.EqualTo(yaw));
                }
            }
            finally
            {
                if (Directory.Exists(target))
                {
                    Directory.Delete(target, recursive: true);
                }
            }
        }

        // The ground's materials are the scene's own, with HDRP's terrain shader, and between them
        // they name the variants a ground asks for at run time: none, a normal map, a normal map
        // and a mask map, and those two on a tile of five to eight layers (`WorldGround`). A build
        // holds a shader, and a variant of it, only if a material in it says so, and the first
        // built players had no terrain shader at all: their world had no ground. The ground draws
        // instanced, so each material asks for the instancing variants too: without them a player
        // of leg 2 drew the terrain flat and without its layers (DEC-1005).
        [Test]
        public void TheGroundHasMaterialsOfItsOwnThatABuildCarries()
        {
            string scene = File.ReadAllText("Assets/Scenes/Hub.unity");
            (string name, string[] keywords)[] wanted =
            {
                ("ground", new string[0]), ("ground-normal", new[] { "_NORMALMAP" }), ("ground-normal-mask", new[] { "_NORMALMAP", "_MASKMAP" }),
                ("ground-8-normal-mask", new[] { "_TERRAIN_8_LAYERS", "_NORMALMAP", "_MASKMAP" }),
            };
            foreach ((string name, string[] keywords) in wanted)
            {
                string path = $"Assets/Kits/core/Materials/{name}.mat";
                var material = AssetDatabase.LoadAssetAtPath<Material>(path);
                Assert.That(material, Is.Not.Null, path);
                Assert.That(material.shader.name, Is.EqualTo("HDRP/TerrainLit"), path);
                Assert.That(material.enableInstancing, Is.True, $"{path}: the instancing variants");
                foreach (string keyword in new[] { "_TERRAIN_8_LAYERS", "_NORMALMAP", "_MASKMAP" })
                {
                    Assert.That(material.IsKeywordEnabled(keyword), Is.EqualTo(System.Array.IndexOf(keywords, keyword) >= 0), $"{path}: {keyword}");
                }
                StringAssert.Contains(AssetDatabase.AssetPathToGUID(path), scene, $"the persistent scene names {path}");
            }
        }

        // The plinths' rims (PRD v4 5.5.1): a material a colour class, which the persistent scene
        // names in class order. Each is its class's colour and glows by that colour at
        // `Generate.RimGlow`, with an exposure weight of 0, so the exposure does not dim it at noon
        // nor brighten it at dusk: the cue shows in every kit and at every time of day.
        [Test]
        public void EachClassHasARimThatShowsAtEveryTimeOfDay()
        {
            string scene = File.ReadAllText("Assets/Scenes/Hub.unity");
            string[] classes = { "white", "blue", "black", "red", "green", "multicolour", "colourless" };
            for (int c = 0; c < classes.Length; c++)
            {
                string path = $"Assets/Kits/core/Materials/rim-{classes[c]}.mat";
                var material = AssetDatabase.LoadAssetAtPath<Material>(path);
                Assert.That(material, Is.Not.Null, path);
                Assert.That(material.shader.name, Is.EqualTo("HDRP/Lit"), path);
                Color colour = StandField.ClassColours[c];
                Assert.That((Vector4)material.GetColor("_BaseColor"), Is.EqualTo((Vector4)colour).Using(new ColourWithin(1e-3f)), $"{path}: its colour");
                Assert.That((Vector4)material.GetColor("_EmissiveColor"), Is.EqualTo((Vector4)(colour.linear * Generate.RimGlow)).Using(new ColourWithin(1e-3f)), $"{path}: its glow");
                Assert.That(material.GetFloat("_EmissiveExposureWeight"), Is.Zero, $"{path}: the exposure does not scale its glow");
                StringAssert.Contains(AssetDatabase.AssetPathToGUID(path), scene, $"the persistent scene names {path}");
            }
        }

        // Two colours are the same within a share in each channel but alpha.
        sealed class ColourWithin : System.Collections.Generic.IEqualityComparer<Vector4>
        {
            readonly float within;

            public ColourWithin(float within)
            {
                this.within = within;
            }

            public bool Equals(Vector4 a, Vector4 b) => Mathf.Abs(a.x - b.x) <= within && Mathf.Abs(a.y - b.y) <= within && Mathf.Abs(a.z - b.z) <= within;

            public int GetHashCode(Vector4 value) => 0;
        }

        // The kit's path and gravel layers (PRD v4 8.4.5) are in its dressing: each has its
        // texture's colour, normal and mask maps. The first slice's meadow layer is retired
        // (DEC-1055, N13), and the persistent scene names no layer of the kit: the world loads
        // them with the kit (N20).
        [Test]
        public void TheKitsDressingHoldsItsPathAndGravelLayers()
        {
            string scene = File.ReadAllText("Assets/Scenes/Hub.unity");
            KitDressing dressing = Generate.Dressing("temperate");
            Assert.That(dressing, Is.Not.Null, "run the generation entry point");
            (string name, string texture)[] wanted = { ("path", "dirt_floor"), ("gravel", "ganges_river_pebbles") };
            CollectionAssert.AreEqual(wanted.Select(one => one.name), dressing.Layers.Select(layer => layer.name));
            foreach ((string name, string texture) in wanted)
            {
                string path = $"{Generate.LayerFolder}/{name}.terrainlayer";
                TerrainLayer layer = dressing.Layer(name);
                Assert.That(AssetDatabase.GetAssetPath(layer), Is.EqualTo(path));
                Assert.That(AssetDatabase.GetAssetPath(layer.diffuseTexture), Is.EqualTo($"Assets/Kits/temperate/Terrain/{texture}_diff_2k.jpg"), path);
                Assert.That(AssetDatabase.GetAssetPath(layer.normalMapTexture), Is.EqualTo($"Assets/Kits/temperate/Terrain/{texture}_nor_gl_2k.jpg"), path);
                Assert.That(AssetDatabase.GetAssetPath(layer.maskMapTexture), Is.EqualTo($"Assets/Kits/temperate/Terrain/{texture}_arm_2k.jpg"), path);
                Assert.That(layer.tileSize.x, Is.InRange(0.5f, 20f), $"{path}: a tile is some metres wide");
                Assert.That(layer.tileSize.y, Is.EqualTo(layer.tileSize.x), $"{path}: a tile is square");
            }
            Assert.That(AssetDatabase.LoadAssetAtPath<TerrainLayer>($"{Generate.LayerFolder}/meadow.terrainlayer"), Is.Null, "the first slice's meadow layer is retired");
            foreach (string guid in AssetDatabase.FindAssets("t:TerrainLayer", new[] { "Assets/Kits" }))
            {
                StringAssert.DoesNotContain(guid, scene, $"the persistent scene names {AssetDatabase.GUIDToAssetPath(guid)}");
            }
            foreach ((string kit, _) in Generate.Kits)
            {
                StringAssert.DoesNotContain(AssetDatabase.AssetPathToGUID(Generate.DressingPath(kit)), scene, $"the persistent scene names {kit}'s dressing");
            }
        }

        // PRD v4 7.3.3: loads are time-sliced. A loop's data is read and decompressed when it is
        // first played, and that is as a session's first world is built behind the hub. On the
        // main thread it was one frame of 73 ms in a built player (DEC-953). The kit's loops are
        // imported to load in the background, and a source plays its loop once it is there.
        static IEnumerable<string> Loops() => Generate.Kits.SelectMany(kit => kit.Loops.Select(loop => $"{kit.Kit}/Audio/{loop.File}"));

        [TestCaseSource(nameof(Loops))]
        public void AKitLoopLoadsAwayFromTheMainThread(string file)
        {
            var importer = AssetImporter.GetAtPath($"Assets/Kits/{file}.ogg") as AudioImporter;
            Assert.That(importer, Is.Not.Null, "the kit's loop is in the project");
            Assert.That(importer.loadInBackground, Is.True);
            Assert.That(importer.defaultSampleSettings.loadType, Is.EqualTo(AudioClipLoadType.CompressedInMemory));
        }

        // Every kit's dressing names its loops (PRD v4 5.12), and every ambient family that
        // Dominaria's regions name has its bed in the kit that owns the family (8.12.5).
        [Test]
        public void EveryFamilyHasItsBedInItsKit()
        {
            foreach ((string kit, (string Name, string File, float Level)[] loops) in Generate.Kits)
            {
                KitDressing dressing = Generate.Dressing(kit);
                Assert.That(dressing, Is.Not.Null, kit);
                foreach ((string name, string file, float level) in loops)
                {
                    Assert.That(AssetDatabase.GetAssetPath(dressing.Loop(name)), Is.EqualTo($"Assets/Kits/{kit}/Audio/{file}.ogg"), $"{kit}: {name}");
                    Assert.That(dressing.LoopLevel(name), Is.EqualTo(level).And.InRange(0.1f, 1f), $"{kit}: {name}'s level");
                }
            }
            foreach (string family in new[] { Dressing.ThemeAmbient, "forest", "surf", "marsh", "alpine-wind", "volcanic" })
            {
                string kit = KitLoops.KitOf(family);
                Assert.That(kit, Is.Not.Null, family);
                Assert.That(Generate.Dressing(kit).Loop(family), Is.Not.Null, family);
            }
        }

        // The pipeline's default materials are the editor's: in a player each is null. What draws
        // with one is there in the editor and in every test, and is not there in a build.
        [Test]
        public void NoRuntimeScriptAsksThePipelineForAnEditorDefault()
        {
            foreach (string file in Directory.GetFiles("Assets/Scripts", "*.cs", SearchOption.AllDirectories))
            {
                StringAssert.DoesNotContain("RenderPipeline.default", File.ReadAllText(file), file);
            }
        }
    }
}
