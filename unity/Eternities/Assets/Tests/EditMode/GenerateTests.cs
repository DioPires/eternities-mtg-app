using System.IO;
using Eternities.Data;
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
            Assert.That(world.Stands, Is.EqualTo(6271));
            Assert.That(world.Sites, Is.EqualTo(26));
            StringAssert.Contains("Stands: 6,271. Sites: 26 (15 era, 11 regional, 0 set).", world.Report);

            string target = Generate.ProjectPack(TestPack.Hash);
            string fixture = WorldFiles.FixtureOf(Generate.RepositoryPack(TestPack.Hash), "dominaria");
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
                Assert.That(loaded.Layout.Radius, Is.EqualTo(838_394));
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
        // and a mask map. A build holds a shader, and a variant of it, only if a material in it
        // says so, and the first built players had no terrain shader at all: their world had no
        // ground.
        [Test]
        public void TheGroundHasMaterialsOfItsOwnThatABuildCarries()
        {
            string scene = File.ReadAllText("Assets/Scenes/Hub.unity");
            (string name, string[] keywords)[] wanted =
            {
                ("ground", new string[0]), ("ground-normal", new[] { "_NORMALMAP" }), ("ground-normal-mask", new[] { "_NORMALMAP", "_MASKMAP" }),
            };
            foreach ((string name, string[] keywords) in wanted)
            {
                string path = $"Assets/Kits/core/Materials/{name}.mat";
                var material = AssetDatabase.LoadAssetAtPath<Material>(path);
                Assert.That(material, Is.Not.Null, path);
                Assert.That(material.shader.name, Is.EqualTo("HDRP/TerrainLit"), path);
                foreach (string keyword in new[] { "_NORMALMAP", "_MASKMAP" })
                {
                    Assert.That(material.IsKeywordEnabled(keyword), Is.EqualTo(System.Array.IndexOf(keywords, keyword) >= 0), $"{path}: {keyword}");
                }
                StringAssert.Contains(AssetDatabase.AssetPathToGUID(path), scene, $"the persistent scene names {path}");
            }
        }

        // The ground's three layers are the kit's (PRD v4 8.4.5): each has its texture's colour,
        // normal and mask maps, and the persistent scene names the three in the order the ground is
        // painted in. A ground without them is plain colours, which is what the owner first saw.
        [Test]
        public void TheGroundHasTheKitsThreeLayers()
        {
            string scene = File.ReadAllText("Assets/Scenes/Hub.unity");
            (string name, string texture)[] wanted = { ("meadow", "leafy_grass"), ("path", "dirt_floor"), ("gravel", "ganges_river_pebbles") };
            int last = -1;
            foreach ((string name, string texture) in wanted)
            {
                string path = $"{Generate.LayerFolder}/{name}.terrainlayer";
                var layer = AssetDatabase.LoadAssetAtPath<TerrainLayer>(path);
                Assert.That(layer, Is.Not.Null, path);
                Assert.That(AssetDatabase.GetAssetPath(layer.diffuseTexture), Is.EqualTo($"Assets/Kits/temperate/Terrain/{texture}_diff_2k.jpg"), path);
                Assert.That(AssetDatabase.GetAssetPath(layer.normalMapTexture), Is.EqualTo($"Assets/Kits/temperate/Terrain/{texture}_nor_gl_2k.jpg"), path);
                Assert.That(AssetDatabase.GetAssetPath(layer.maskMapTexture), Is.EqualTo($"Assets/Kits/temperate/Terrain/{texture}_arm_2k.jpg"), path);
                Assert.That(layer.tileSize.x, Is.InRange(0.5f, 20f), $"{path}: a tile is some metres wide");
                Assert.That(layer.tileSize.y, Is.EqualTo(layer.tileSize.x), $"{path}: a tile is square");
                int at = scene.IndexOf(AssetDatabase.AssetPathToGUID(path), System.StringComparison.Ordinal);
                Assert.That(at, Is.GreaterThan(last), $"the persistent scene names {path}, after the layer painted before it");
                last = at;
            }
        }

        // PRD v4 7.3.3: loads are time-sliced. A loop's data is read and decompressed when it is
        // first played, and that is as a session's first world is built behind the hub. On the
        // main thread it was one frame of 73 ms in a built player (DEC-953). The kit's loops are
        // imported to load in the background, and a source plays its loop once it is there.
        [TestCase("meadow_songbirds_loop")]
        [TestCase("river_splashy_loop")]
        public void AKitLoopLoadsAwayFromTheMainThread(string file)
        {
            var importer = AssetImporter.GetAtPath($"Assets/Kits/temperate/Audio/{file}.ogg") as AudioImporter;
            Assert.That(importer, Is.Not.Null, "the kit's loop is in the project");
            Assert.That(importer.loadInBackground, Is.True);
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
