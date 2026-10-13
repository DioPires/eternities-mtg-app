using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Eternities.EditorTools;
using Eternities.Kits;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace Eternities.Tests
{
    // The prop conditioning rule (DEC-1003; `PropRule`, `unity/Eternities/README.md`): a merge gate
    // for every kit prop, beside PRD v4 8.12.2. The first test holds the kits to the rule; the rest
    // show that the rule refuses what it says it refuses. Three of them are the three defects of
    // the photographic trial of 2026-10-11 (DEC-953): stones of 7 to 30 cm drawn at 2 to 3 m, a
    // leaf's photograph written out again too dark, and far trees pale against the sun.
    public class PropRuleTests
    {
        const string Kit = "Assets/Kits/temperate";
        const string Fixtures = "Assets/Tests/EditMode/Fixtures/PropRule";
        // One of the kit's photographs, for a prop made here to be coloured by.
        const string Photograph = Kit + "/Terrain/ganges_river_pebbles_diff_2k.jpg";

        readonly List<Object> made = new List<Object>();

        [TearDown]
        public void Clear()
        {
            made.ForEach(Object.DestroyImmediate);
            made.Clear();
        }

        [Test]
        public void EveryPropOfEveryKitKeepsTheRule()
        {
            var broken = new List<string>();
            int props = 0;
            foreach ((string kit, string path) in PropRule.Props())
            {
                props++;
                PropCategory? category = PropRule.Category(path);
                if (category == null)
                {
                    broken.Add($"{path}: it is not in a category's folder under `Prefabs/`: {string.Join(", ", PropRule.Folders.Keys)}");
                    continue;
                }
                broken.AddRange(PropRule.Violations(AssetDatabase.LoadAssetAtPath<GameObject>(path), category.Value, PropRule.Standard(kit, path), kit).Select(what => $"{path}: {what}"));
            }
            Assert.That(broken, Is.Empty, string.Join("\n", broken));
            Assert.That(props, Is.GreaterThanOrEqualTo(Temperate.Kinds.Length), "the kits' prefabs were found");
        }

        // The kit's photographic props keep what the rule asks at the photographic standard, each
        // named: a prop missing from the kit fails here and not only in the scan of its folders.
        // The first slice's flat models, which its scatter of Dominaria still draws, are held at
        // the basic standard (`PropRule.Standard`).
        [Test]
        public void EveryPhotographicPropKeepsThePhotographicRule()
        {
            var broken = new List<string>();
            foreach (KitPrefabs.Source source in KitPrefabs.TemperatePhotographs)
            {
                string path = KitPrefabs.Path("temperate", source.Prefab);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
                Assert.That(prefab, Is.Not.Null, path);
                broken.AddRange(PropRule.Violations(prefab, PropRule.Category(path).Value, PropRule.Photographic, Kit).Select(what => $"{path}: {what}"));
            }
            Assert.That(broken, Is.Empty, string.Join("\n", broken));
            Assert.That(KitPrefabs.TemperatePhotographs, Is.Not.Empty);
        }

        // One prefab a prop: every kind of the scatter has its prefab, and every model under a
        // kit's `Props/` is drawn by a prefab of that kit. And the generation entry point reads
        // prefabs: no model file is named in it.
        [Test]
        public void AModelReachesTheWorldThroughItsPrefabOnly()
        {
            foreach (PropKind kind in Temperate.Kinds)
            {
                Assert.That(AssetDatabase.LoadAssetAtPath<GameObject>(KitPrefabs.Path("temperate", kind.Prefab)), Is.Not.Null, kind.Prefab);
            }
            var drawn = new HashSet<string>(PropRule.Props().SelectMany(prop => AssetDatabase.GetDependencies(prop.Path, false)));
            foreach (string guid in AssetDatabase.FindAssets("t:Model", new[] { "Assets/Kits" }))
            {
                string model = AssetDatabase.GUIDToAssetPath(guid);
                Assert.That(drawn, Does.Contain(model), $"{model} is in a kit and no prefab draws it");
            }
            string entryPoint = File.ReadAllText("Assets/Editor/Generate.cs");
            Assert.That(Regex.Matches(entryPoint, @"\.(fbx|glb|gltf|obj|blend)\b", RegexOptions.IgnoreCase).Cast<Match>().Select(named => named.Value), Is.Empty,
                "the generation entry point reads prefabs and names no model file");
        }

        // The violating fixture: a pebble of 15 cm, coloured by the kit's own photograph of pebbles,
        // drawn 2.25 m long. In everything else it is a well-made rock, so the one thing the rule
        // says of it is the trial's first defect. At the basic standard, where a model has no real
        // unit, the rule says nothing of it.
        [Test]
        public void APebbleDrawnAsABoulderBreaksTheRule()
        {
            var fixture = AssetDatabase.LoadAssetAtPath<GameObject>($"{Fixtures}/pebble_drawn_as_boulder.prefab");
            Assert.That(fixture, Is.Not.Null);
            Assert.That(PropRule.Of(fixture).Bounds.size.x, Is.EqualTo(2.25f).Within(0.01f));
            List<string> broken = PropRule.Violations(fixture, PropCategory.Rock, PropRule.Photographic, Kit);
            Assert.That(broken, Has.Count.EqualTo(1), string.Join("\n", broken));
            StringAssert.Contains("is drawn at 15.0 times the size its file gives it", broken[0]);
            Assert.That(PropRule.Violations(fixture, PropCategory.Rock, PropRule.Basic, Kit), Is.Empty);
        }

        // The trial's second defect: the leaf's photograph was converted and written out again,
        // several times too dark. A photographic prop's colour is a file of the kit as downloaded,
        // which `fetch.sh` checks against its source, read as a colour and not tinted.
        [Test]
        public void AColourThatIsNotThePhotographsBreaksTheRule()
        {
            var photograph = AssetDatabase.LoadAssetAtPath<Texture2D>(Photograph);
            Assert.That(photograph, Is.Not.Null, Photograph);
            Assert.That(Broken(Rock(Lit(photograph, Color.white))), Is.Empty);

            var written = new Texture2D(4, 4) { name = "a texture made here" };
            made.Add(written);
            StringAssert.Contains("has no photograph for its colour", Single(Broken(Rock(Lit(written, Color.white)))));
            StringAssert.Contains("has no photograph for its colour", Single(Broken(Rock(Lit(null, Color.white)))));
            StringAssert.Contains("tints its photograph", Single(Broken(Rock(Lit(photograph, new Color(0.3f, 0.3f, 0.3f))))));
            StringAssert.Contains("tints its photograph", Single(Broken(Rock(Lit(photograph, new Color(1, 1.4f, 1))))));
        }

        // The trial's third defect: its far trees stood pale against the sun, and its leaves let
        // light through a thickness of 0.25. A leaf is as thick far as near, because every level
        // of a prop has its nearest level's materials, and no thinner than the rule says.
        [Test]
        public void LeavesThatLetTooMuchLightThroughBreakTheRule()
        {
            var photograph = AssetDatabase.LoadAssetAtPath<Texture2D>(Photograph);
            Material Leaf(float thickness)
            {
                Material leaf = Lit(photograph, Color.white);
                leaf.SetFloat("_MaterialID", 5);
                leaf.SetFloat("_Thickness", thickness);
                return leaf;
            }
            Assert.That(Broken(Bush(Leaf(1))), Is.Empty);
            Assert.That(Broken(Bush(Leaf(PropRule.ThinnestLeaf))), Is.Empty);
            StringAssert.Contains("lets light through a thickness of 0.25", Single(Broken(Bush(Leaf(0.25f)))));

            // Two levels, the farther with a material of its own.
            GameObject bush = Bush(Leaf(1));
            GameObject far = Object.Instantiate(bush.transform.GetChild(0).gameObject, bush.transform);
            far.GetComponent<MeshRenderer>().sharedMaterial = Leaf(1);
            bush.AddComponent<LODGroup>().SetLODs(new[]
            {
                new LOD(0.3f, new Renderer[] { bush.transform.GetChild(0).GetComponent<MeshRenderer>() }),
                new LOD(0.01f, new Renderer[] { far.GetComponent<MeshRenderer>() }),
            });
            StringAssert.Contains("a farther level has a material its nearest level has not", Single(Broken(bush)));
        }

        // The same defect from a second cause, found on this kit's first wood (DEC-1003): a cut
        // tree's leaf cards carry the round crown's normal on both faces, and with the
        // photograph's gloss on them the crown shone silver against the sun.
        [Test]
        public void ACrownThatShinesAsOneMirrorBreaksTheRule()
        {
            var photograph = AssetDatabase.LoadAssetAtPath<Texture2D>(Photograph);
            Material Card(float normalMode, float gloss)
            {
                Material card = Lit(photograph, Color.white);
                card.SetFloat("_DoubleSidedEnable", 1);
                card.SetFloat("_DoubleSidedNormalMode", normalMode);
                card.SetFloat("_SmoothnessRemapMax", gloss);
                return card;
            }
            Assert.That(Broken(Bush(Card(2, PropRule.CrownGloss))), Is.Empty);
            // A leaf lit by its own normal, mirrored on its back, keeps its gloss.
            Assert.That(Broken(Bush(Card(1, 1))), Is.Empty);
            StringAssert.Contains("is lit by its crown's normal on both faces with a gloss of up to 1", Single(Broken(Bush(Card(2, 1)))));
        }

        // A cut model is what its report says (`Derive/<file>.json`, written by the script that
        // cut it): each level's mesh has the triangles the report counts, in the report's order.
        [Test]
        public void ACutModelHasTheLevelsItsReportCounts()
        {
            string[] reports = Directory.GetFiles($"{Kit}/Derive", "*_cut.json");
            Assert.That(reports, Is.Not.Empty);
            foreach (string report in reports)
            {
                string text = File.ReadAllText(report);
                string tree = Regex.Match(text, "^ \"tree\": \"(\\w+)\"", RegexOptions.Multiline).Groups[1].Value;
                int[] counted = Regex.Matches(text, "^   \"triangles\": (\\d+)", RegexOptions.Multiline).Cast<Match>().Select(match => int.Parse(match.Groups[1].Value)).ToArray();
                string file = $"{Kit}/Props/{Path.GetFileNameWithoutExtension(report)}.fbx";
                Dictionary<string, Mesh> meshes = AssetDatabase.LoadAllAssetsAtPath(file).OfType<Mesh>().ToDictionary(mesh => mesh.name);
                Assert.That(counted.Length, Is.EqualTo(meshes.Count), $"{file} holds {string.Join(", ", meshes.Keys)}");
                for (int level = 0; level < counted.Length; level++)
                {
                    Assert.That(meshes, Does.ContainKey($"{tree}_LOD{level}"), file);
                    Assert.That(meshes[$"{tree}_LOD{level}"].triangles.Length / 3, Is.EqualTo(counted[level]), $"{tree}_LOD{level} in {file}");
                }
            }
        }

        [Test]
        public void APropOutsideItsCategorysCapsBreaksTheRule()
        {
            var photograph = AssetDatabase.LoadAssetAtPath<Texture2D>(Photograph);
            Material stone = Lit(photograph, Color.white);
            PropRule.Cap rock = PropRule.Caps[PropCategory.Rock];

            // Triangles, and the levels a heavy prop carries.
            Mesh heavy = Mound(2, 1, 2, rock.Triangles + 2000);
            StringAssert.Contains($"its nearest level has {heavy.triangles.Length / 3} triangles", string.Join("\n", Broken(Prop(heavy, stone))));
            Mesh bare = Mound(2, 1, 2, PropRule.LevelsFrom + 1000);
            StringAssert.Contains("a prop over 2000 carries levels down to 10", Single(Broken(Prop(bare, stone))));
            Mesh levelled = Mound(2, 1, 2, PropRule.LevelsFrom + 1000);
            MeshLodUtility.GenerateMeshLods(levelled, -1);
            Assert.That(levelled.lodCount, Is.GreaterThan(3));
            Assert.That(Broken(Prop(levelled, stone)), Is.Empty);
            // A heavy mesh drawn from its second level on: the cap is on what is drawn.
            Mesh drawnLighter = Mound(2, 1, 2, rock.Triangles + 2000);
            MeshLodUtility.GenerateMeshLods(drawnLighter, -1);
            GameObject lighter = Prop(drawnLighter, stone);
            Assert.That(Broken(lighter), Is.Not.Empty);
            lighter.GetComponentInChildren<MeshRenderer>().meshLodSelectionBias = 1;
            Assert.That(Broken(lighter), Is.Empty);
            Assert.That(PropRule.Of(lighter).Nearest, Is.LessThanOrEqualTo(rock.Triangles));

            // Materials: a photographed rock has one. At the basic standard it may have three.
            Mesh twoParts = Mound(2, 1, 2, 200);
            twoParts.subMeshCount = 2;
            int[] all = twoParts.triangles;
            twoParts.SetTriangles(all.Take(300).ToArray(), 0);
            twoParts.SetTriangles(all.Skip(300).ToArray(), 1);
            GameObject two = Prop(twoParts, stone, Lit(photograph, Color.white));
            StringAssert.Contains("it has 2 materials: a Rock at the photographic standard has at most 1", Single(Broken(two)));
            Assert.That(PropRule.Violations(two, PropCategory.Rock, PropRule.Basic, Kit), Is.Empty);

            // Metres: a rock is 5 cm to 5 m tall.
            StringAssert.Contains("it is 7.00 m tall", Single(Broken(Prop(Mound(3, 7, 3, 200), stone))));
            StringAssert.Contains("it is 0.01 m tall", Single(Broken(Prop(Mound(0.1f, 0.01f, 0.1f, 200), stone))));

            // The base: at the origin, under the prop, with its root as it is in the world.
            GameObject lifted = Prop(Mound(2, 1, 2, 200), stone);
            lifted.transform.GetChild(0).localPosition = new Vector3(0, 0.5f, 0);
            StringAssert.Contains("it stands 0.50 m over its base", Single(Broken(lifted)));
            GameObject buried = Prop(Mound(2, 1, 2, 200), stone);
            buried.transform.GetChild(0).localPosition = new Vector3(0, -0.5f, 0);
            StringAssert.Contains("0.50 m of its 1.00 m are under its base", Single(Broken(buried)));
            GameObject aside = Prop(Mound(2, 1, 2, 200), stone);
            aside.transform.GetChild(0).localPosition = new Vector3(3, 0, 0);
            StringAssert.Contains("its base is not under it", Single(Broken(aside)));
            GameObject scaled = Prop(Mound(2, 1, 2, 200), stone);
            scaled.transform.localScale = Vector3.one * 2;
            StringAssert.Contains("its root is scaled", string.Join("\n", Broken(scaled)));
            GameObject squashed = Prop(Mound(2, 1, 2, 200), stone);
            squashed.transform.GetChild(0).localScale = new Vector3(1, 0.5f, 1);
            StringAssert.Contains("not the same along every axis", string.Join("\n", Broken(squashed)));
        }

        // The kit's `CREDITS.md` lists every prop as it is drawn, with the height and the triangles
        // that `PropRule` measures: a row for each prefab, and no row without one.
        [Test]
        public void TheCreditsListEveryPropAsItIsDrawn()
        {
            foreach (string kit in PropRule.Props().Select(prop => prop.Kit).Distinct())
            {
                string credits = File.ReadAllText($"{kit}/CREDITS.md");
                int heading = credits.IndexOf("\n## Props as drawn", System.StringComparison.Ordinal);
                Assert.That(heading, Is.GreaterThan(0), $"{kit}/CREDITS.md has a table \"Props as drawn\"");
                int next = credits.IndexOf("\n## ", heading + 1, System.StringComparison.Ordinal);
                string[] rows = credits.Substring(heading, (next < 0 ? credits.Length : next) - heading).Split('\n')
                    .Where(line => line.StartsWith("| ") && !line.StartsWith("| Prop ") && !line.StartsWith("|---")).ToArray();
                string[] wanted = PropRule.Props().Where(prop => prop.Kit == kit).Select(prop => PropRule.CreditsRow(prop.Path)).ToArray();
                Assert.That(rows, Is.EquivalentTo(wanted), $"{kit}/CREDITS.md, \"Props as drawn\", against the prefabs as measured:\n{string.Join("\n", wanted)}");
            }
        }

        List<string> Broken(GameObject prop) =>
            PropRule.Violations(prop, prop.name == "bush" ? PropCategory.Bush : PropCategory.Rock, PropRule.Photographic, Kit);

        static string Single(List<string> broken)
        {
            Assert.That(broken, Has.Count.EqualTo(1), string.Join("\n", broken));
            return broken[0];
        }

        GameObject Rock(Material material) => Prop(Mound(2, 1, 2, 200), material);

        GameObject Bush(Material material)
        {
            GameObject bush = Prop(Mound(1.5f, 1.2f, 1.5f, 200), material);
            bush.name = "bush";
            return bush;
        }

        // A prop as `KitPrefabs` makes one: a root, and under it the mesh with its materials.
        GameObject Prop(Mesh mesh, params Material[] materials)
        {
            var root = new GameObject("rock");
            made.Add(root);
            var model = new GameObject("Model");
            model.transform.SetParent(root.transform, false);
            model.AddComponent<MeshFilter>().sharedMesh = mesh;
            model.AddComponent<MeshRenderer>().sharedMaterials = materials;
            return root;
        }

        Material Lit(Texture colour, Color tint)
        {
            var material = new Material(Shader.Find("HDRP/Lit")) { name = "made here" };
            material.SetTexture("_BaseColorMap", colour);
            material.SetColor("_BaseColor", tint);
            made.Add(material);
            return material;
        }

        // A mound on its base: so wide, tall and deep, in metres, of at least so many triangles.
        Mesh Mound(float width, float height, float depth, int triangles)
        {
            int cells = Mathf.CeilToInt(Mathf.Sqrt(triangles / 2f));
            var vertices = new Vector3[(cells + 1) * (cells + 1)];
            var uv = new Vector2[vertices.Length];
            for (int row = 0; row <= cells; row++)
            {
                for (int column = 0; column <= cells; column++)
                {
                    float u = (float)column / cells, v = (float)row / cells;
                    float rise = 1 - Mathf.Max(Mathf.Abs(2 * u - 1), Mathf.Abs(2 * v - 1));
                    vertices[row * (cells + 1) + column] = new Vector3((u - 0.5f) * width, rise * height, (v - 0.5f) * depth);
                    uv[row * (cells + 1) + column] = new Vector2(u, v);
                }
            }
            var indices = new int[cells * cells * 6];
            for (int row = 0, next = 0; row < cells; row++)
            {
                for (int column = 0; column < cells; column++)
                {
                    int corner = row * (cells + 1) + column;
                    indices[next++] = corner; indices[next++] = corner + cells + 1; indices[next++] = corner + 1;
                    indices[next++] = corner + 1; indices[next++] = corner + cells + 1; indices[next++] = corner + cells + 2;
                }
            }
            var mesh = new Mesh { name = "mound", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32, vertices = vertices, uv = uv, triangles = indices };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            made.Add(mesh);
            return mesh;
        }
    }
}
