using System.Collections.Generic;
using System.Linq;
using Eternities.EditorTools;
using Eternities.Kits;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Eternities.Tests
{
    // The temperate kit's variants (PRD v4 5.6.3, 8.12.1; DEC-1003): what a region's row names.
    // Each is a ground layer mix, a prop set and a density, of the kit's photographs only.
    public class VariantTests
    {
        static IEnumerable<Variant> All() => Variants.Temperate;

        // A species is a source: the props of one file are plants or rocks of one kind, and so are
        // the props that are cut from one source, each into a file of its own. `sources.yaml` names
        // every model's source.
        static string Species(Growth growth)
        {
            string model = AssetDatabase.GetAssetPath(AssetDatabase.LoadAssetAtPath<GameObject>(KitPrefabs.Path("temperate", growth.Prefab)).GetComponentInChildren<MeshFilter>().sharedMesh);
            string[] lines = System.IO.File.ReadAllLines("Assets/Kits/temperate/sources.yaml");
            int entry = System.Array.IndexOf(lines, $"  - file: {model.Substring("Assets/Kits/temperate/".Length)}");
            Assert.That(entry, Is.GreaterThanOrEqualTo(0), $"sources.yaml has no entry for {model}");
            return lines.Skip(entry + 1).TakeWhile(line => !line.StartsWith("  - file: ")).First(line => line.StartsWith("    source: ")).Substring("    source: ".Length);
        }

        [Test]
        public void TheKitHasTheFourVariantsItsRegionRowsName()
        {
            CollectionAssert.AreEqual(new[] { "meadow", "wood", "marsh", "highland" }, Variants.Temperate.Select(variant => variant.Name));
        }

        // True colour: a variant's ground is its photograph, on a layer with no tint over it, with
        // the photograph's own normals and mask.
        [TestCaseSource(nameof(All))]
        public void AVariantsGroundIsAMixOfUntintedPhotographs(Variant variant)
        {
            Assert.That(variant.Ground.Length, Is.GreaterThanOrEqualTo(2), "a mix");
            Assert.That(variant.Ground.Sum(ground => ground.Share), Is.EqualTo(1).Within(1e-4f));
            foreach ((string name, float share) in variant.Ground)
            {
                Assert.That(share, Is.GreaterThan(0), name);
                var layer = AssetDatabase.LoadAssetAtPath<TerrainLayer>($"{Generate.LayerFolder}/{name}.terrainlayer");
                Assert.That(layer, Is.Not.Null, name);
                Assert.That(layer.diffuseRemapMax, Is.EqualTo(Vector4.one), $"{name} is tinted");
                Assert.That(layer.diffuseRemapMin, Is.EqualTo(Vector4.zero), $"{name} is tinted");
                foreach (Texture2D map in new[] { layer.diffuseTexture, layer.normalMapTexture, layer.maskMapTexture })
                {
                    Assert.That(map, Is.Not.Null, name);
                    StringAssert.StartsWith("Assets/Kits/temperate/Terrain/", AssetDatabase.GetAssetPath(map));
                }
                Assert.That(((TextureImporter)AssetImporter.GetAtPath(AssetDatabase.GetAssetPath(layer.normalMapTexture))).textureType, Is.EqualTo(TextureImporterType.NormalMap), name);
                Assert.That(KitMaskImport.IsMaskSource(AssetDatabase.GetAssetPath(layer.maskMapTexture)), name);
            }
        }

        // No paleness (DEC-1055, B1): a variant's ground does not shine. A layer's gloss is the
        // mean smoothness of its mask as the layer reads it, and the first meadow, with a mean of
        // 0.54 on seven tenths of its ground, lay toward the sun as one pale sheet.
        [TestCaseSource(nameof(All))]
        public void AVariantsGroundDoesNotShine(Variant variant)
        {
            foreach ((string name, float _) in variant.Ground)
            {
                var layer = AssetDatabase.LoadAssetAtPath<TerrainLayer>($"{Generate.LayerFolder}/{name}.terrainlayer");
                Assert.That(layer, Is.Not.Null, name);
                Assert.That(layer.metallic, Is.EqualTo(0), $"{name} is a metal");
                Assert.That(layer.maskMapRemapMin.w, Is.EqualTo(0), name);
                Assert.That(layer.maskMapRemapMax.w, Is.EqualTo(Generate.GlossRange(name)), $"{name}'s file has another range than the generation entry point gives it");
                Assert.That(Generate.Gloss(layer), Is.InRange(0f, Generate.GroundGloss), $"{variant.Name}'s ground {name} shines");
            }
        }

        // No flat model stands in a variant: every prop is one of the kit's photographic prefabs,
        // which `PropRuleTests` holds to the rule at the photographic standard.
        [TestCaseSource(nameof(All))]
        public void AVariantGrowsThePhotographedPropsOnly(Variant variant)
        {
            var photographed = new HashSet<string>(KitPrefabs.TemperatePhotographs.Select(source => source.Prefab));
            Assert.That(variant.Grows, Is.Not.Empty);
            foreach (Growth growth in variant.Grows)
            {
                Assert.That(photographed, Does.Contain(growth.Prefab), $"{variant.Name} grows {growth.Prefab}");
                Assert.That(PropRule.Folders.Keys, Does.Contain(growth.Category), growth.Prefab);
                Assert.That(growth.PerAre, Is.GreaterThan(0), growth.Prefab);
                Assert.That(growth.ScaleFrom, Is.GreaterThan(0).And.LessThanOrEqualTo(growth.ScaleTo), growth.Prefab);
                // An instance is its file's size times its prefab's share of it times the growth's
                // share of the prefab. The rule's 0.5 to 2 times holds the product: a sapling that
                // is half its file in its prefab is not grown smaller than the prefab.
                (float least, float most) = PropRule.Against(AssetDatabase.LoadAssetAtPath<GameObject>(KitPrefabs.Path("temperate", growth.Prefab)));
                Assert.That(least * growth.ScaleFrom, Is.GreaterThanOrEqualTo(PropRule.DrawnFrom - 1e-4f),
                    $"{variant.Name} grows {growth.Prefab} at {growth.ScaleFrom} of a prefab that is {least} of its file");
                Assert.That(most * growth.ScaleTo, Is.LessThanOrEqualTo(PropRule.DrawnTo + 1e-4f),
                    $"{variant.Name} grows {growth.Prefab} at {growth.ScaleTo} of a prefab that is {most} of its file");
            }
            Assert.That(variant.Grows.Select(growth => growth.Prefab).Distinct().Count(), Is.EqualTo(variant.Grows.Length), "a prop is named once");
        }

        // The owner's first correction (PRD v4 8.12.1): more than one species per vegetation type a
        // variant uses, and rocks in each.
        [TestCaseSource(nameof(All))]
        public void AVariantHasMoreThanOneSpeciesOfEachVegetationTypeItUses(Variant variant)
        {
            foreach (string type in new[] { "Trees", "Bushes", "GroundCover" })
            {
                string[] species = variant.Grows.Where(growth => growth.Category == type).Select(Species).Distinct().ToArray();
                Assert.That(species.Length, Is.Not.EqualTo(1), $"{variant.Name} has one species of {type}: {string.Join(", ", species)}");
            }
            Assert.That(variant.Grows.Count(growth => growth.Category == "GroundCover"), Is.GreaterThan(0), "ground cover");
            Assert.That(variant.Grows.Count(growth => growth.Category == "Rocks"), Is.GreaterThan(0), "rocks");
        }

        // The scene holds each variant's layers and props in the variant's own order, so a build
        // carries them.
        [Test]
        public void TheSceneHoldsEveryVariant()
        {
            KitVariant[] scene = Generate.SceneVariants();
            Assert.That(scene.Length, Is.EqualTo(Variants.Temperate.Length));
            for (int i = 0; i < Variants.Temperate.Length; i++)
            {
                Variant variant = Variants.Temperate[i];
                KitVariant held = scene[i];
                Assert.That(held.Name, Is.EqualTo(variant.Name));
                CollectionAssert.AreEqual(variant.Ground.Select(ground => ground.Layer), held.Layers.Select(layer => layer.name));
                Assert.That(held.Props.Length, Is.EqualTo(variant.Grows.Length));
                Assert.That(held.Props.All(prop => prop.Mesh != null && prop.Materials.All(material => material != null)));
            }
        }

        // A lower density's props are among a higher density's, as the scatter's are (PRD v4 8.1.1),
        // and the same patch has the same props whenever it is dressed.
        [TestCaseSource(nameof(All))]
        public void ALowerDensitysPropsAreAmongAHigherDensitys(Variant variant)
        {
            List<Prop> full = Variants.Scatter(variant, 120, 1, 7, Vector2.zero), again = Variants.Scatter(variant, 120, 1, 7, Vector2.zero);
            Assert.That(full.Select(At), Is.EqualTo(again.Select(At)));
            var stands = new HashSet<(int, float, float)>(full.Select(At));
            List<Prop> some = Variants.Scatter(variant, 120, 0.6f, 7, Vector2.zero);
            Assert.That(some.Count, Is.InRange(1, full.Count - 1));
            Assert.That(some.Select(At).All(stands.Contains));
            // Ground cover stands about the viewer only; the rest out to the patch's edge.
            foreach (Prop prop in full)
            {
                Growth growth = variant.Grows[prop.Kind];
                float away = new Vector2(prop.X, prop.Z).magnitude;
                Assert.That(away, Is.LessThanOrEqualTo(growth.Category == "GroundCover" ? Variants.CoverFar : 120), growth.Prefab);
                Assert.That(prop.Scale, Is.InRange(growth.ScaleFrom, growth.ScaleTo), growth.Prefab);
            }
        }

        static (int, float, float) At(Prop prop) => (prop.Kind, prop.X, prop.Z);

        // Each layer takes about its share of a painted patch, and the layers leave no ground bare.
        [TestCaseSource(nameof(All))]
        public void APaintedPatchHasEachLayerAtAboutItsShare(Variant variant)
        {
            const int Side = 128;
            var alphas = new float[Side, Side, variant.Ground.Length];
            Variants.Paint(variant, alphas, 60, 7);
            var shares = new double[variant.Ground.Length];
            for (int row = 0; row < Side; row++)
            {
                for (int column = 0; column < Side; column++)
                {
                    float sum = 0;
                    for (int layer = 0; layer < shares.Length; layer++)
                    {
                        shares[layer] += alphas[row, column, layer];
                        sum += alphas[row, column, layer];
                    }
                    Assert.That(sum, Is.EqualTo(1).Within(1e-4f));
                }
            }
            for (int layer = 0; layer < shares.Length; layer++)
            {
                Assert.That(shares[layer] / (Side * Side), Is.EqualTo(variant.Ground[layer].Share).Within(0.05), variant.Ground[layer].Layer);
            }
        }
    }
}
