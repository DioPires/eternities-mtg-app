using System;
using System.Linq;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using NUnit.Framework;
using UnityEngine;

namespace Eternities.Tests
{
    // Pull request 2 of leg 2 (PRD v4 9.6): the HUD's place line and the region's sentence (6.3.1,
    // 5.13.7), and the stands' rims (5.5.1), from the committed Dominaria fixture. Every figure is
    // the fixture's: none is today's layout written down.
    public class PlaceTests
    {
        static WorldData world;

        [OneTimeSetUp]
        public void Load()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("dominaria");
            var pack = new Pack(fixture.Pack);
            PackPlane plane = pack.Plane("dominaria");
            world = WorldData.Decode(pack.Planes, plane, pack.Cards(plane), fixture.Stands, WorldDocument.Read(fixture.World), LoreDocument.Read(fixture.Lore));
            world.Sets = pack.Sets();
        }

        [OneTimeTearDown]
        public void Done()
        {
            world?.Dispose();
            world = null;
        }

        // 6.3.1: the region under a point is the one whose cell holds it, and the site is the one
        // whose bounding disc holds it: its centre, its pad and its stone are at that site, in its
        // region.
        [Test]
        public void ThePlaceIsTheRegionsCellAndTheSitesDisc()
        {
            WorldDocument layout = world.Layout;
            var where = new Whereabouts(layout);
            for (int s = 0; s < layout.Sites.Length; s++)
            {
                WorldSite site = layout.Sites[s];
                int region = Array.FindIndex(layout.Regions, row => row.Id == site.RegionId);
                foreach ((string what, P2 point) in new[] { ("centre", site.Centre), ("pad", site.Pad.Position), ("stone", site.Stone.Position) })
                {
                    Assert.That(where.Site(point), Is.EqualTo(s), $"{site.Key}'s {what}");
                    Assert.That(where.Region(point), Is.EqualTo(region), $"{site.Key}'s {what} lies in {site.RegionId}");
                }
            }
            // The arrival point, on the plaza, is at no site, and in the region whose cell holds it.
            P2 arrival = layout.Arrival.Position;
            Assert.That(where.Site(arrival), Is.EqualTo(-1));
            int plaza = where.Region(arrival);
            Assert.That(plaza, Is.GreaterThanOrEqualTo(0));
            Assert.That(Predicates.PointInPolygon(arrival, layout.Regions[plaza].Cell));
            // Past the world's edge and beyond every cell, no region.
            Assert.That(where.Region(new P2(100 * layout.Radius, 0)), Is.EqualTo(-1));
        }

        // A point of the engine's ground in metres is the pack's millimetres, rounded.
        [Test]
        public void MetresBecomeTheMillimetresOfThePack()
        {
            Assert.That(Whereabouts.Millimetres(1.2346f, -0.0004f), Is.EqualTo(new P2(1235, 0)));
            Assert.That(Whereabouts.Millimetres(-838.394f, 12.5f), Is.EqualTo(new P2(-838394, 12500)));
        }

        // The line names the plane, the region and the site: an era site by its era's name, a
        // regional site once, by its region, and the plaza by its region alone. Each region's
        // sentence is the lore's.
        [Test]
        public void TheLineNamesThePlaneTheRegionAndTheSite()
        {
            WorldDocument layout = world.Layout;
            Assert.That(world.Plane.DisplayName, Is.EqualTo("Dominaria"));
            for (int s = 0; s < layout.Sites.Length; s++)
            {
                WorldSite site = layout.Sites[s];
                int region = Array.FindIndex(layout.Regions, row => row.Id == site.RegionId);
                string regionName = layout.Regions[region].Name;
                string line = Whereabouts.Line(world, region, s);
                if (site.Kind == "era")
                {
                    string era = world.Lore.Eras.Single(row => row.Id == site.EraId).Name;
                    Assert.That(line, Is.EqualTo($"Dominaria · {regionName} · {era}"));
                }
                else
                {
                    Assert.That(site.Kind, Is.EqualTo("region"));
                    Assert.That(line, Is.EqualTo($"Dominaria · {regionName}"), "a regional site is named for its region, once");
                }
            }
            Assert.That(Whereabouts.Line(world, 0, -1), Is.EqualTo($"Dominaria · {layout.Regions[0].Name}"));
            Assert.That(Whereabouts.Line(world, -1, -1), Is.EqualTo("Dominaria"));
            for (int r = 0; r < layout.Regions.Length; r++)
            {
                LoreRegion lore = world.Lore.Regions.Single(row => row.Id == layout.Regions[r].Id);
                Assert.That(Whereabouts.Sentence(world, r), Is.EqualTo(lore.Sentence.Text).And.Not.Empty);
            }
            Assert.That(Whereabouts.Sentence(world, -1), Is.Null);
            // The example of 6.3.1 is an era of this world.
            int shiv = Array.FindIndex(layout.Regions, row => row.Id == "shiv");
            int firstAges = Array.FindIndex(layout.Sites, row => row.Key == "era:first-ages");
            Assert.That(Whereabouts.Line(world, shiv, firstAges), Is.EqualTo("Dominaria · Shiv · The First Ages"));
        }

        // 5.5.1: every plinth has a thin rim of its class's colour round its top edge: the cap's top
        // band on four sides and a frame round its top face, in the submesh of the stand's class,
        // and nothing of the rim lower than the band.
        [Test]
        public void EveryPlinthHasARimOfItsClasssColour()
        {
            var root = new GameObject("stand field test");
            Material[] materials = Enumerable.Range(0, StandField.Rarities + 1).Select(_ => new Material(Shader.Find("HDRP/Lit"))).ToArray();
            Material[] rims = Enumerable.Range(0, StandField.Classes).Select(_ => new Material(Shader.Find("HDRP/Lit"))).ToArray();
            try
            {
                StandField field = StandField.Build(world, materials, rims, root.transform);
                Assert.That(field.Stands, Is.EqualTo(world.StandCount));
                // Four sides of the band and four sides of the frame: eight quads, 48 indices a stand.
                const int RimIndices = 8 * 6;
                var byClass = new int[StandField.Classes];
                int classes = 0;
                foreach (Transform site in field.transform)
                {
                    Mesh mesh = site.GetComponent<MeshFilter>().sharedMesh;
                    Material[] drawn = site.GetComponent<MeshRenderer>().sharedMaterials;
                    Assert.That(mesh.subMeshCount, Is.EqualTo(materials.Length + rims.Length));
                    Assert.That(mesh.vertexCount <= ushort.MaxValue || mesh.indexFormat == UnityEngine.Rendering.IndexFormat.UInt32,
                        $"{site.name}: {mesh.vertexCount} vertices need 32-bit indices");
                    Assert.That(drawn, Is.EqualTo(materials.Concat(rims).ToArray()));
                    Vector3[] vertices = mesh.vertices;
                    for (int c = 0; c < StandField.Classes; c++)
                    {
                        int[] indices = mesh.GetIndices(materials.Length + c);
                        Assert.That(indices.Length % RimIndices, Is.Zero);
                        byClass[c] += indices.Length / RimIndices;
                        foreach (int index in indices)
                        {
                            Assert.That(vertices[index].y, Is.InRange(StandField.PlinthHeight - StandField.RimHeight - 1e-4f, StandField.PlinthHeight + 1e-4f), $"a vertex of the rim of class {c} in {site.name}");
                        }
                    }
                }
                for (int c = 0; c < StandField.Classes; c++)
                {
                    int stands = Enumerable.Range(0, world.StandCount).Count(stand => world.Stands.Class[stand] == c);
                    Assert.That(byClass[c], Is.EqualTo(stands), $"rims of class {c}");
                    classes += stands > 0 ? 1 : 0;
                }
                Assert.That(classes, Is.GreaterThan(1), "the world holds more than one class");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
                foreach (Material material in materials.Concat(rims))
                {
                    UnityEngine.Object.DestroyImmediate(material);
                }
            }
        }

        // DEC-1130 N10: the composite spares a rectangle of the view, given in pixels from its
        // bottom left, in the buffer's coordinates, which run from the bottom left too; an empty
        // rectangle spares nothing.
        [Test]
        public void TheCompositeSparesTheLabelsRectangle()
        {
            Vector4 spared = Eternities.CardView.Exhibit.SparedInBuffer(new Rect(100, 50, 200, 30), 1000, 500);
            Assert.That(spared.x, Is.EqualTo(0.1f).Within(1e-6f));
            Assert.That(spared.y, Is.EqualTo(0.1f).Within(1e-6f));
            Assert.That(spared.z, Is.EqualTo(0.3f).Within(1e-6f));
            Assert.That(spared.w, Is.EqualTo(0.16f).Within(1e-6f));
            Vector4 none = Eternities.CardView.Exhibit.SparedInBuffer(Rect.zero, 1000, 500);
            Assert.That(none.x > 1 && none.z < 0, "no coordinate of the buffer lies in an empty rectangle");
        }

        // The rim's colours: one a class, gold for multicolour and grey for colourless (5.5.1), each
        // distinct from the others.
        [Test]
        public void TheClassColoursAreSevenAndDistinct()
        {
            Assert.That(StandField.ClassColours.Length, Is.EqualTo(StandField.Classes));
            for (int a = 0; a < StandField.Classes; a++)
            {
                for (int b = a + 1; b < StandField.Classes; b++)
                {
                    Color x = StandField.ClassColours[a], y = StandField.ClassColours[b];
                    Assert.That(Mathf.Abs(x.r - y.r) + Mathf.Abs(x.g - y.g) + Mathf.Abs(x.b - y.b), Is.GreaterThan(0.15f), $"classes {a} and {b}");
                }
            }
            // The image path's tests find their placeholder as magenta, red and blue each more than
            // 50 levels over green (PRD v4 8.4.4): no rim comes near it.
            foreach (Color c in StandField.ClassColours)
            {
                Assert.That(c.r - c.g < 0.15f || c.b - c.g < 0.15f, $"{c} reads as the tests' magenta");
            }
            Color.RGBToHSV(StandField.ClassColours[5], out float goldHue, out float goldSaturation, out _);
            Assert.That(goldHue * 360, Is.InRange(35f, 55f), "multicolour is gold");
            Assert.That(goldSaturation, Is.GreaterThan(0.5f));
            Color.RGBToHSV(StandField.ClassColours[6], out _, out float greySaturation, out _);
            Assert.That(greySaturation, Is.LessThan(0.15f), "colourless is grey");
        }
    }
}
