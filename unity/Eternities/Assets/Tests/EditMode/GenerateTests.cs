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
        // count. What it writes is what the engine reads, so the test reads it back from disk.
        [Test]
        public void TheEntryPointWritesDominariaWithEveryStand()
        {
            WorldFiles.Result world = Generate.Build(TestPack.Hash, "dominaria");
            Assert.That(world.Check.Passed);
            StringAssert.Contains("checker: passed", world.Report);

            string text = File.ReadAllText(world.LayoutPath);
            Assert.That(LayoutFile.Digest(text), Is.EqualTo(LayoutTests.DominariaDigest));
            WorldLayout layout = LayoutFile.Read(text);
            Assert.That(layout.Stands.Count, Is.EqualTo(6271));
            Assert.That(layout.WorldRadius, Is.EqualTo(LayoutTests.DominariaRadius));

            // The copied part of the pack opens by itself and holds the same cards.
            var copy = new Pack(Generate.ProjectPack(TestPack.Hash));
            PackCard[] cards = copy.Cards(copy.Plane("dominaria"));
            Assert.That(cards.Length, Is.EqualTo(6271));
            Assert.That(cards[layout.Stands[0].Card].OracleId, Is.EqualTo(layout.Input.Cards[layout.Stands[0].Card].OracleId));
            Assert.That(copy.Swatches().Length, Is.EqualTo(Pack.SwatchHeader + 28603 * Pack.SwatchRecord));

            // And the engine's own loader takes the two together.
            WorldData loaded = WorldData.Load(Generate.ProjectPack(TestPack.Hash), "dominaria");
            Assert.That(loaded.Layout.Stands.Count, Is.EqualTo(6271));
            loaded.Swatch(0, 0, out byte r, out byte g, out byte b);
            Assert.That(r + g + b, Is.GreaterThan(0));
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
