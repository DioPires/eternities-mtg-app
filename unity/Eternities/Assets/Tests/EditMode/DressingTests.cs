using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Eternities.Data;
using Eternities.EditorTools;
using Eternities.Kits;
using Eternities.Layout;
using NUnit.Framework;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace Eternities.Tests
{
    // Dominaria dressed (PRD v4 5.6.3, 8.4.2, 8.4.5; 9.6 leg 2): its plan, worked out from the
    // committed fixture as the world's load works it out from the pack. Every figure the tests
    // read is the fixture's or the plan's: none is today's layout written down.
    public class DressingTests
    {
        static WorldData world;
        static DressPlan plan;
        static Scatter scatter;

        [OneTimeSetUp]
        public void Plan()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("dominaria");
            var pack = new Pack(fixture.Pack);
            PackPlane plane = pack.Plane("dominaria");
            world = WorldData.Decode(pack.Planes, plane, pack.Cards(plane), fixture.Stands, WorldDocument.Read(fixture.World), LoreDocument.Read(fixture.Lore));
            var clock = Stopwatch.StartNew();
            plan = DressPlan.Compute(world);
            long planned = clock.ElapsedMilliseconds;
            Generate.KitDressings();
            KitDressing temperate = Generate.Dressing("temperate");
            Scatter.Kind[] kinds = Scatter.KindsOf(Variants.Temperate, (v, g) => temperate.Variant(Variants.Temperate[v].Name).Props[g].Shape());
            scatter = new Scatter(plan, kinds, Temperate.Density("medium"));
            clock.Restart();
            scatter.PlaceAll();
            Debug.Log($"DressingTests: Dominaria planned in {planned} ms on {plan.N} x {plan.N} texels and {plan.Tiles} x {plan.Tiles} tiles; "
                + $"{scatter.Matrices.Length} static props placed in {clock.ElapsedMilliseconds} ms; water: "
                + string.Join(", ", plan.Water.GroupBy(body => body.Kind).Select(group => $"{group.Count()} {group.Key}")) + $"; {plan.Fords.Count} fords; props by kind: "
                + string.Join(", ", kinds.Select((kind, k) => (kind.Prefab, scatter.ByKind[k])).Where(one => one.Item2 > 0).OrderByDescending(one => one.Item2).Select(one => $"{one.Prefab} {one.Item2}")));
        }

        [OneTimeTearDown]
        public void Done()
        {
            world?.Dispose();
            world = null;
            plan = null;
            scatter = null;
        }

        // 5.6.3: each region is dressed by the variant its row names, or, where its row names a
        // kit the temperate kit stands in for, by the variant that departure names.
        [Test]
        public void EveryRegionIsDressedByItsRowOrItsNamedDeparture()
        {
            for (int r = 0; r < plan.Regions.Length; r++)
            {
                WorldRegion row = plan.Layout.Regions[r];
                RegionDress dress = plan.Regions[r];
                if (row.Kit == "temperate")
                {
                    Assert.That(dress.Variant.Name, Is.EqualTo(row.Variant), row.Id);
                    Assert.That(dress.Departure, Is.Null, row.Id);
                }
                else
                {
                    Assert.That(dress.Departure, Is.Not.Null.And.Contains(row.Kit), row.Id);
                }
                Assert.That(dress.Water, Is.EqualTo(row.Water ?? "none"), row.Id);
                Assert.That(KitLoops.KitOf(dress.Ambient), Is.Not.Null, $"{row.Id}: {dress.Ambient}");
            }
        }

        // 5.6.3: a region's ground runs into its neighbour's over 20 m, 10 m each side of the
        // boundary, and nowhere else: the other region's share is a half on the boundary and none
        // from 10 m on.
        [Test]
        public void TheBlendRunsTwentyMetresAcrossEachBoundary()
        {
            int blended = 0;
            for (int i = 0; i < plan.Grid.Count; i++)
            {
                float share = plan.Share(i);
                Assert.That(share, Is.InRange(0f, 0.5f));
                if (plan.FromBoundary[i] >= DressPlan.Blend)
                {
                    Assert.That(share, Is.Zero, $"texel {i}, {plan.FromBoundary[i]} m from its boundary");
                }
                else if (plan.Other[i] != plan.Region[i] && plan.FromBoundary[i] <= plan.Grid.Texel)
                {
                    Assert.That(share, Is.GreaterThan(0.45f), $"texel {i} on its boundary");
                    blended++;
                }
            }
            Assert.That(blended, Is.GreaterThan(0));
        }

        // Everything the allocator placed stands on flat ground at its level and stays dry (PRD v4
        // 8.4.5), but the trail where it goes through a ford; and the water keeps its 3 m buffer
        // from it (5.4.1), but at a ford.
        [Test]
        public void ReservedGroundIsFlatAndDryAndWaterKeepsItsBuffer()
        {
            int wet = 0;
            for (int row = 0; row < plan.N; row++)
            {
                for (int column = 0; column < plan.N; column++)
                {
                    int i = row * plan.N + column;
                    float x = plan.Grid.X(column), z = plan.Grid.Z(row);
                    bool ford = AtAFord(x, z);
                    if (plan.Reserved[i] && !ford)
                    {
                        Assert.That(plan.HeightAt(x, z), Is.EqualTo(0).Within(0.01f), $"reserved ground at {x:F1}, {z:F1}; {Near(x, z)}");
                    }
                    if (plan.Wet[i] != DressPlan.Dry && plan.Wet[i] != DressPlan.WetLava)
                    {
                        wet++;
                        if (!ford)
                        {
                            Assert.That(plan.FromReserved[i], Is.GreaterThanOrEqualTo(DressPlan.WaterBuffer), $"water at {x:F1}, {z:F1} is {plan.FromReserved[i]:F2} m from reserved ground");
                        }
                    }
                    if (plan.Wet[i] == DressPlan.WetLava)
                    {
                        Assert.That(plan.FromReserved[i], Is.GreaterThanOrEqualTo(DressPlan.WaterBuffer), $"lava at {x:F1}, {z:F1}");
                    }
                }
            }
            Assert.That(wet, Is.GreaterThan(0));
        }

        // The water near a point, for a failure's message.
        static string Near(float x, float z)
        {
            var at = new Vector2(x, z);
            return "water within 40 m: " + string.Join(", ", plan.Water.Where(body => body.Kind != WaterBody.Sea).Select(body => (body, d: body.Line.Count > 1
                ? body.Line.Min(p => Vector2.Distance(p, at)) - body.HalfWidth : Vector2.Distance(body.Centre, at) - body.Radius))
                .Where(one => one.d < 40).Select(one => $"{one.body.Kind} of {plan.Regions[one.body.Region].Id} at {one.d:F1} m"))
                + $"; fords: {string.Join(", ", plan.Fords.Select(ford => $"{Vector2.Distance(ford.At, at):F0} m, holding {ford.Radius:F0} m"))}; region {plan.RegionAt(x, z).Id}";
        }

        // Within a ford: as far from its crossing as the river's banks reach the trail, and the
        // ramp of the trail down to it.
        static bool AtAFord(float x, float z) => plan.Fords.Any(ford => Vector2.Distance(ford.At, new Vector2(x, z)) < ford.Radius + DressPlan.FordRamp);

        // Water crosses the trail only at a ford (PRD v4 5.4.11, 8.4.2), where the trail goes into
        // the water no deeper than the ford's depth, and lava never crosses it.
        [Test]
        public void WaterCrossesTheTrailOnlyAtAFord()
        {
            for (int row = 0; row < plan.N; row++)
            {
                for (int column = 0; column < plan.N; column++)
                {
                    int i = row * plan.N + column;
                    if (plan.Wet[i] == DressPlan.Dry || plan.FromTrail[i] > 0)
                    {
                        continue;
                    }
                    float x = plan.Grid.X(column), z = plan.Grid.Z(row);
                    Assert.That(plan.Wet[i], Is.EqualTo(DressPlan.WetRiver), $"{plan.Wet[i]} on the trail at {x:F1}, {z:F1}");
                    Assert.That(AtAFord(x, z), $"a river on the trail at {x:F1}, {z:F1} and no ford");
                    Assert.That(plan.DepthAt(x, z), Is.LessThanOrEqualTo(DressPlan.FordDepth + 0.01f), $"the ford at {x:F1}, {z:F1}");
                }
            }
        }

        // The water each region row names is there (Appendix F.1): a river in a river region, a
        // lake in a lake region, the sea in a sea region, pools in a marsh and lava in lava's.
        [Test]
        public void EveryRowsWaterIsThere()
        {
            var counts = new int[plan.Regions.Length, 6];
            for (int i = 0; i < plan.Grid.Count; i++)
            {
                counts[plan.Region[i], plan.Wet[i]]++;
            }
            for (int r = 0; r < plan.Regions.Length; r++)
            {
                string water = plan.Regions[r].Water, id = plan.Regions[r].Id;
                switch (water)
                {
                    case WaterBody.River:
                        Assert.That(plan.Water.Count(body => body.Region == r && body.Kind == WaterBody.River), Is.GreaterThanOrEqualTo(1), id);
                        break;
                    case WaterBody.Lake:
                        Assert.That(plan.Water.Count(body => body.Region == r && body.Kind == WaterBody.Lake), Is.EqualTo(1), id);
                        break;
                    case WaterBody.Sea:
                        Assert.That(counts[r, DressPlan.WetSea], Is.GreaterThan(0), id);
                        break;
                    case WaterBody.Marsh:
                        Assert.That(counts[r, DressPlan.WetMarsh], Is.GreaterThan(0), id);
                        break;
                    case WaterBody.Lava:
                        Assert.That(counts[r, DressPlan.WetLava], Is.GreaterThan(0), id);
                        break;
                    default:
                        Assert.That(counts[r, DressPlan.WetRiver] + counts[r, DressPlan.WetStill] + counts[r, DressPlan.WetSea] + counts[r, DressPlan.WetLava], Is.Zero, id);
                        break;
                }
            }
        }

        // Unity Terrain draws at most eight layers on a tile in HDRP: the plan gives none more, and
        // each texel's weights sum to one.
        [Test]
        public void EveryTilePaintsAtMostEightLayers()
        {
            int dropped = 0;
            foreach (TileLayers tile in plan.TileLayers)
            {
                Assert.That(tile.Layers.Length, Is.InRange(1, DressPlan.TileLayersMost));
                dropped += tile.Dropped;
                for (int r = 0; r < DressPlan.TileTexels; r += 17)
                {
                    for (int c = 0; c < DressPlan.TileTexels; c += 13)
                    {
                        float sum = 0;
                        for (int k = 0; k < tile.Layers.Length; k++)
                        {
                            sum += tile.Alphas[r, c, k];
                        }
                        Assert.That(sum, Is.EqualTo(1).Within(1e-4f));
                    }
                }
            }
            Debug.Log($"DressingTests: {plan.TileLayers.Sum(tile => tile.Layers.Length) / (float)plan.TileLayers.Length:F2} layers a tile; {dropped} dropped");
        }

        // PRD v4 8.4.2, 5.4.1: no prop stands within 1 m and its own footprint of a stand's
        // footprint, apron or corridor, a path, the trail, a pad, the plaza or a stone, tested on
        // the shapes themselves and not on the grid; none stands in water; and no tree stands in a
        // cluster's disc.
        [Test]
        public void EveryPropKeepsItsClearance()
        {
            var shapes = new Shapes();
            WorldDocument layout = plan.Layout;
            float half = LayoutConstants.PathHalfWidth / 1000f;
            shapes.Disc(Vector2.zero, layout.PlazaEdgeRadius / 1000f);
            if (layout.PlazaApproach != null)
            {
                shapes.Line(layout.PlazaApproach.Select(DressPlan.Metres).ToList(), half);
            }
            foreach (TrailLeg leg in layout.Legs)
            {
                shapes.Line(leg.Polyline.Select(DressPlan.Metres).ToList(), half);
                shapes.Line(leg.StartAttachment.Select(DressPlan.Metres).ToList(), half);
                shapes.Line(leg.EndAttachment.Select(DressPlan.Metres).ToList(), half);
            }
            foreach (WorldPad pad in layout.Pads)
            {
                shapes.Disc(DressPlan.Metres(pad.Centre), pad.Radius / 1000f);
            }
            foreach (WorldSite site in layout.Sites)
            {
                shapes.Line(site.Path.Select(DressPlan.Metres).ToList(), half);
                shapes.Line(new List<Vector2> { DressPlan.Metres(site.Pad.Position), DressPlan.Metres(site.ApproachPoint) }, half);
                shapes.Disc(DressPlan.Metres(site.Stone.Position), LayoutConstants.StoneRadius / 1000f);
                foreach (SiteChapter chapter in site.Chapters)
                {
                    if (chapter.Stone != null)
                    {
                        shapes.Disc(DressPlan.Metres(chapter.Stone.Value.Position), LayoutConstants.StoneRadius / 1000f);
                    }
                }
            }
            for (int stand = 0; stand < world.StandCount; stand++)
            {
                Vector2 at = DressPlan.Metres(world.Position(stand));
                float yaw = world.Yaw(stand) / 1e6f * Mathf.Deg2Rad;
                Vector2 ahead = new Vector2(Mathf.Cos(yaw), Mathf.Sin(yaw)), side = new Vector2(-ahead.y, ahead.x);
                float back = LayoutConstants.FootprintDepth / 2000f, front = back + LayoutConstants.ApronDepth / 1000f;
                float foot = LayoutConstants.FootprintWidth / 2000f, apron = LayoutConstants.ApronWidth / 2000f;
                shapes.Polygon(new[] { at - ahead * back - side * foot, at - ahead * back + side * foot, at + ahead * back + side * foot, at + ahead * back - side * foot });
                shapes.Polygon(new[] { at + ahead * back - side * apron, at + ahead * back + side * apron, at + ahead * front + side * apron, at + ahead * front - side * apron });
                Vector2 end = DressPlan.Metres(layout.Sites[world.Site(stand)].Path[layout.StandVertex[stand]]);
                shapes.Line(new List<Vector2> { at + ahead * front, end }, LayoutConstants.CorridorHalfWidth / 1000f);
            }
            // And the props made about the walker, in every cell along the first site's path and
            // the first leg of the trail, where the 1 m means most.
            var cells = new HashSet<(int, int, bool)>();
            foreach (Vector2 point in layout.Sites[0].Path.Select(DressPlan.Metres).Concat(layout.Legs[0].Polyline.Select(DressPlan.Metres)))
            {
                cells.Add((Mathf.FloorToInt((point.x - plan.Grid.Min) / Scatter.CoverCell), Mathf.FloorToInt((point.y - plan.Grid.Min) / Scatter.CoverCell), true));
                cells.Add((Mathf.FloorToInt((point.x - plan.Grid.Min) / Scatter.FarCell), Mathf.FloorToInt((point.y - plan.Grid.Min) / Scatter.FarCell), false));
            }
            int near = 0;
            foreach ((int cx, int cz, bool low) in cells)
            {
                void Check(int kindIndex, Scatter.Instance prop)
                {
                    Scatter.Kind kind = scatter.Kinds[kindIndex];
                    var at = new Vector2(prop.Position.x, prop.Position.z);
                    float needed = DressPlan.PropClearance + kind.Shape.Footprint * prop.Scale;
                    Assert.That(shapes.Clearance(at, needed + 0.5f), Is.GreaterThanOrEqualTo(needed), $"{kind.Prefab} at {at.x:F2}, {at.y:F2}");
                    near++;
                }
                if (low)
                {
                    scatter.CoverIn(cx, cz, Check);
                }
                else
                {
                    scatter.FarIn(cx, cz, Check);
                }
            }
            Assert.That(near, Is.GreaterThan(0), "cover and grass by the paths");

            var kindOf = new int[scatter.Instances.Length];
            for (int key = 0; key < scatter.RunStart.Length; key++)
            {
                for (int i = scatter.RunStart[key]; i < scatter.RunStart[key] + scatter.RunCount[key]; i++)
                {
                    kindOf[i] = key % scatter.Kinds.Length;
                }
            }
            int checkedProps = 0;
            for (int i = 0; i < scatter.Instances.Length; i++)
            {
                Scatter.Instance prop = scatter.Instances[i];
                Scatter.Kind kind = scatter.Kinds[kindOf[i]];
                var at = new Vector2(prop.Position.x, prop.Position.z);
                float clear = shapes.Clearance(at, DressPlan.PropClearance + kind.Shape.Footprint * prop.Scale + 0.5f);
                Assert.That(clear, Is.GreaterThanOrEqualTo(DressPlan.PropClearance + kind.Shape.Footprint * prop.Scale),
                    $"{kind.Prefab} at {at.x:F2}, {at.y:F2} is {clear:F2} m from reserved ground");
                Assert.That(plan.HeightAt(at.x, at.y), Is.GreaterThan(DressPlan.WaterLevel), $"{kind.Prefab} at {at.x:F2}, {at.y:F2} in water");
                if (kind.Category == "Trees")
                {
                    Assert.That(plan.Cluster[plan.Grid.At(at.x, at.y)], Is.False, $"a tree in a cluster's disc at {at.x:F2}, {at.y:F2}");
                }
                checkedProps++;
            }
            Assert.That(checkedProps, Is.GreaterThan(0));
        }

        // DEC-1055, N17: ground cover and the growth seen across a field have their places on the
        // ground, whoever looks at them. A cell's are the same however often and from wherever they
        // are asked for, and a lower density's are among a higher density's.
        [Test]
        public void GroundCoverStaysOnTheGround()
        {
            KitDressing temperate = Generate.Dressing("temperate");
            Scatter.Kind[] kinds = Scatter.KindsOf(Variants.Temperate, (v, g) => temperate.Variant(Variants.Temperate[v].Name).Props[g].Shape());
            var low = new Scatter(plan, kinds, Temperate.Density("low"));
            int cells = Mathf.CeilToInt(plan.Grid.Side / Scatter.CoverCell), tried = 0, found = 0;
            for (int cz = cells / 2 - 30; cz < cells / 2 + 30; cz += 7)
            {
                for (int cx = cells / 2 - 30; cx < cells / 2 + 30; cx += 7)
                {
                    var once = new List<(int, Vector3)>();
                    var again = new List<(int, Vector3)>();
                    var fewer = new List<(int, Vector3)>();
                    scatter.CoverIn(cx, cz, (kind, prop) => once.Add((kind, prop.Position)));
                    scatter.CoverIn(cx, cz, (kind, prop) => again.Add((kind, prop.Position)));
                    low.CoverIn(cx, cz, (kind, prop) => fewer.Add((kind, prop.Position)));
                    CollectionAssert.AreEqual(once, again);
                    CollectionAssert.IsSubsetOf(fewer, once);
                    once.Clear();
                    again.Clear();
                    fewer.Clear();
                    scatter.FarIn(cx / 4, cz / 4, (kind, prop) => once.Add((kind, prop.Position)));
                    scatter.FarIn(cx / 4, cz / 4, (kind, prop) => again.Add((kind, prop.Position)));
                    low.FarIn(cx / 4, cz / 4, (kind, prop) => fewer.Add((kind, prop.Position)));
                    CollectionAssert.AreEqual(once, again);
                    CollectionAssert.IsSubsetOf(fewer, once);
                    tried++;
                    found += once.Count;
                }
            }
            Assert.That(found, Is.GreaterThan(0), $"{tried} cells");
        }

        // DEC-1055, N14: the field's tall grass stands at its density over every cell of open
        // meadow, to the edge of the meadow and not only about a viewer. On every cell of 16 m that
        // lies in one meadow region, away from its boundary, from water and from anything reserved,
        // the count is the growth's density over the cell's area, within the noise of its draws.
        [Test]
        public void TheFieldsGrassStandsAtItsDensityOverAllOpenMeadow()
        {
            Variant meadow = Dressing.VariantNamed("meadow");
            Growth[] far = meadow.Grows.Where(growth => growth.Far).ToArray();
            float expected = far.Sum(growth => growth.PerAre) / 100 * Scatter.FarCell * Scatter.FarCell * scatter.Density;
            int cells = Mathf.CeilToInt(plan.Grid.Side / Scatter.FarCell), tested = 0;
            for (int cz = 0; cz < cells; cz++)
            {
                for (int cx = 0; cx < cells; cx++)
                {
                    float x = plan.Grid.Min + (cx + 0.5f) * Scatter.FarCell, z = plan.Grid.Min + (cz + 0.5f) * Scatter.FarCell;
                    if (!Open(x, z, Scatter.FarCell))
                    {
                        continue;
                    }
                    int count = 0;
                    scatter.FarIn(cx, cz, (kind, prop) => count++);
                    Assert.That(count, Is.InRange(expected * 0.6f, expected * 1.4f), $"the cell at {x:F0}, {z:F0}");
                    tested++;
                }
            }
            Assert.That(tested, Is.GreaterThan(100), "open meadow cells");
        }

        // Is a square of ground of one meadow region, every texel of it away from its boundary's
        // blend, from water and from anything reserved?
        static bool Open(float x, float z, float size)
        {
            RegionDress here = plan.RegionAt(x, z);
            if (here.Variant.Name != "meadow" || here.Growth != 1)
            {
                return false;
            }
            int steps = Mathf.CeilToInt(size / plan.Grid.Texel);
            for (int step = 0; step <= steps * steps + 2 * steps; step++)
            {
                float px = x - size / 2 + step % (steps + 1) * size / steps, pz = z - size / 2 + step / (steps + 1) * size / steps;
                int texel = plan.Grid.At(px, pz);
                if (plan.RegionAt(px, pz) != here || plan.FromBoundary[texel] < DressPlan.Blend + 1 || plan.FromReserved[texel] < 4 || plan.Wet[texel] != DressPlan.Dry
                    || plan.HeightAt(px, pz) < DressPlan.WaterLevel + 0.3f || px * px + pz * pz > plan.Radius * plan.Radius)
                {
                    return false;
                }
            }
            return true;
        }

        // The shapes of the allocator's placed ground, by cells of a few metres, for the clearance test.
        sealed class Shapes
        {
            const float Cell = 8;
            readonly Dictionary<long, List<int>> cells = new Dictionary<long, List<int>>();
            readonly List<(Vector2 A, Vector2 B, float Half)> segments = new List<(Vector2, Vector2, float)>();
            readonly List<Vector2[]> polygons = new List<Vector2[]>();

            void Index(int shape, Vector2 min, Vector2 max)
            {
                for (int z = Mathf.FloorToInt(min.y / Cell) - 1; z <= Mathf.FloorToInt(max.y / Cell) + 1; z++)
                {
                    for (int x = Mathf.FloorToInt(min.x / Cell) - 1; x <= Mathf.FloorToInt(max.x / Cell) + 1; x++)
                    {
                        long key = ((long)z << 32) ^ (uint)x;
                        if (!cells.TryGetValue(key, out List<int> list))
                        {
                            cells[key] = list = new List<int>();
                        }
                        list.Add(shape);
                    }
                }
            }

            public void Line(List<Vector2> points, float half)
            {
                for (int i = 0; i + 1 < points.Count || (points.Count == 1 && i == 0); i++)
                {
                    Vector2 a = points[i], b = points[Mathf.Min(i + 1, points.Count - 1)];
                    segments.Add((a, b, half));
                    Index(segments.Count - 1, Vector2.Min(a, b) - Vector2.one * half, Vector2.Max(a, b) + Vector2.one * half);
                }
            }

            public void Disc(Vector2 centre, float radius)
            {
                segments.Add((centre, centre, radius));
                Index(segments.Count - 1, centre - Vector2.one * radius, centre + Vector2.one * radius);
            }

            public void Polygon(Vector2[] corners)
            {
                polygons.Add(corners);
                Vector2 min = corners.Aggregate(Vector2.Min), max = corners.Aggregate(Vector2.Max);
                Index(-polygons.Count, min, max);
            }

            // How far a point is from the nearest shape, up to `reach`.
            public float Clearance(Vector2 point, float reach)
            {
                long key = ((long)Mathf.FloorToInt(point.y / Cell) << 32) ^ (uint)Mathf.FloorToInt(point.x / Cell);
                float best = reach;
                if (!cells.TryGetValue(key, out List<int> list))
                {
                    return best;
                }
                foreach (int shape in list)
                {
                    float d;
                    if (shape >= 0)
                    {
                        (Vector2 a, Vector2 b, float half) = segments[shape];
                        d = Mathf.Sqrt(Raster.SquaredToSegment(point, a, b)) - half;
                    }
                    else
                    {
                        Vector2[] corners = polygons[-shape - 1];
                        d = Inside(point, corners) ? 0 : float.MaxValue;
                        for (int i = 0; i < corners.Length; i++)
                        {
                            d = Mathf.Min(d, Mathf.Sqrt(Raster.SquaredToSegment(point, corners[i], corners[(i + 1) % corners.Length])));
                        }
                    }
                    best = Mathf.Min(best, Mathf.Max(0, d));
                }
                return best;
            }

            static bool Inside(Vector2 p, Vector2[] polygon)
            {
                bool inside = false;
                for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
                {
                    if ((polygon[i].y > p.y) != (polygon[j].y > p.y) && p.x < (polygon[j].x - polygon[i].x) * (p.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)
                    {
                        inside = !inside;
                    }
                }
                return inside;
            }
        }
    }
}
