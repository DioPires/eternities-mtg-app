using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
        static Scatter scatter, high;

        // The scatter at HDRP high, as the app makes it: its far share is medium's.
        static Scatter High()
        {
            if (high == null)
            {
                high = new Scatter(plan, scatter.Kinds, Temperate.Density("high"), Temperate.FarDensity("high"));
                high.PlaceAll();
            }
            return high;
        }

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
            // As the app builds medium's (`App.Load`): with its far density (DEC-1214 N1).
            scatter = new Scatter(plan, kinds, Temperate.Density("medium"), Temperate.FarDensity("medium"));
            clock.Restart();
            scatter.PlaceAll();
            Debug.Log($"DressingTests: Dominaria planned in {planned} ms on {plan.N} x {plan.N} texels and {plan.Tiles} x {plan.Tiles} tiles; "
                + $"{scatter.Matrices.Length} static props placed in {clock.ElapsedMilliseconds} ms; water: "
                + string.Join(", ", plan.Water.GroupBy(body => body.Kind).Select(group => $"{group.Count()} {group.Key}")) + $"; {plan.Fords.Count} fords; props by kind: "
                + string.Join(", ", kinds.Select((kind, k) => (kind.Prefab, scatter.ByKind[k])).Where(one => one.Item2 > 0).OrderByDescending(one => one.Item2).Select(one => $"{one.Prefab} {one.Item2}")));
        }

        // DEC-1214 N1: below high a far cell draws the level's own props, so medium and low draw
        // all of theirs at every distance; at high a far cell draws medium's (the props' lever).
        [Test]
        public void BelowHighAFarCellDrawsTheLevelsOwnDensity()
        {
            foreach (string level in new[] { "medium", "low" })
            {
                Assert.That(Temperate.FarDensity(level), Is.EqualTo(Temperate.Density(level)), level);
            }
            Assert.That(Temperate.FarDensity("high"), Is.EqualTo(Temperate.Density("medium")));
        }

        [OneTimeTearDown]
        public void Done()
        {
            world?.Dispose();
            world = null;
            plan = null;
            scatter = null;
            high = null;
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

        // 5.12.1: each region's ambient family is the one its row in the lore names, or the theme
        // row's where the row names none. The family reaches the dressing through the pack's world
        // document (4.13.5); this holds what arrives to the rows (DEC-1194 N10, DEC-1202).
        [Test]
        public void EveryRegionsFamilyIsItsLoreRows()
        {
            string path = Path.Combine(LayoutFixtures.Repository, "pipeline", "data", "lore", "dominaria", "regions.json");
            List<object> rows = Json.Array(Json.Object(Json.Parse(File.ReadAllText(path)))["regions"]);
            var named = new Dictionary<string, string>();
            foreach (object row in rows)
            {
                Dictionary<string, object> fields = Json.Object(row);
                named[Json.Text(fields["id"])] = fields.TryGetValue("ambient", out object family) ? Json.Text(family) : Dressing.ThemeAmbient;
            }
            Assert.That(plan.Regions.Select(region => region.Id), Is.EquivalentTo(named.Keys));
            foreach (RegionDress region in plan.Regions)
            {
                Assert.That(region.Ambient, Is.EqualTo(named[region.Id]), region.Id);
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
        // 8.4.5), but the trail where it goes through a ford. And every point of the water keeps
        // its 3 m buffer from it (5.4.1), measured from the shapes themselves and not between
        // texels' middles (DEC-1194 N8 b): from all of it, and at a ford a river from all of it but
        // the trail, as the water's own rule does (N8 a).
        [Test]
        public void ReservedGroundIsFlatAndDryAndWaterKeepsItsBuffer()
        {
            Shapes all = ReservedShapes(trail: true), offTrail = ReservedShapes(trail: false);
            float needed = DressPlan.WaterBuffer + plan.Grid.Texel * 0.7072f;    // and a texel's middle to its corner
            int wet = 0, atFords = 0;
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
                    if (plan.Wet[i] == DressPlan.Dry)
                    {
                        continue;
                    }
                    wet++;
                    bool crossing = ford && plan.Wet[i] == DressPlan.WetRiver;
                    atFords += crossing ? 1 : 0;
                    float clear = (crossing ? offTrail : all).Clearance(new Vector2(x, z), needed + 0.5f);
                    Assert.That(clear, Is.GreaterThanOrEqualTo(needed), $"water ({plan.Wet[i]}) at {x:F1}, {z:F1} is {clear:F2} m from reserved ground{(crossing ? " other than the trail" : "")}; {Near(x, z)}");
                }
            }
            Assert.That(wet, Is.GreaterThan(0));
            // A layout whose rivers cross no path has no ford, and nothing to find at one
            // (DEC-1194 N22).
            if (plan.Fords.Count > 0)
            {
                Assert.That(atFords, Is.GreaterThan(0), "a river crosses the trail at each ford");
            }
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
        // lake in a lake region, the sea in a sea region, pools in a marsh and lava in lava's. And
        // it is there only (8.4.2 item 2): every wet texel lies in a region whose row names its
        // water, a ford's in its river's.
        [Test]
        public void EveryRowsWaterIsThere()
        {
            string[] named = { null, WaterBody.River, WaterBody.Lake, WaterBody.Sea, WaterBody.Lava, WaterBody.Marsh };
            var counts = new int[plan.Regions.Length, 6];
            for (int i = 0; i < plan.Grid.Count; i++)
            {
                byte wet = plan.Wet[i];
                counts[plan.Region[i], wet]++;
                if (wet != DressPlan.Dry && plan.Regions[plan.Region[i]].Water != named[wet])
                {
                    Assert.Fail($"{named[wet]} at {plan.Grid.X(i % plan.N):F1}, {plan.Grid.Z(i / plan.N):F1} in {plan.Regions[plan.Region[i]].Id}, whose row names {plan.Regions[plan.Region[i]].Water}");
                }
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

        // Each sea's sound rides its own shore (DEC-1194 N9, N23): every point a sea's source can
        // stand on lies in that sea's region, on its water beside dry ground, and no two seas'
        // sources share a point, so the surf never plays twice at one place.
        [Test]
        public void EachSeasSoundRidesItsOwnShore()
        {
            var taken = new Dictionary<Vector3, int>();
            int seas = 0;
            foreach (WaterBody body in plan.Water.Where(body => body.Kind == WaterBody.Sea))
            {
                seas++;
                List<Vector3> shore = plan.Shore(DressPlan.WetSea, body.Region);
                Assert.That(shore, Is.Not.Empty, plan.Regions[body.Region].Id);
                foreach (Vector3 point in shore)
                {
                    int texel = plan.Grid.At(point.x, point.z);
                    Assert.That(plan.Region[texel], Is.EqualTo(body.Region), $"a shore point of {plan.Regions[body.Region].Id}'s sea at {point.x:F1}, {point.z:F1}");
                    Assert.That(plan.Wet[texel], Is.EqualTo(DressPlan.WetSea));
                    Assert.That(taken.TryAdd(point, body.Region), $"{point.x:F1}, {point.z:F1} is a shore point of {plan.Regions[taken.GetValueOrDefault(point)].Id}'s sea and of {plan.Regions[body.Region].Id}'s");
                }
            }
            Assert.That(seas, Is.EqualTo(plan.Regions.Count(region => region.Water == WaterBody.Sea)), "a sea a sea region");
        }

        // The map's picture of the ground (PRD v4 6.3.4) shows the water where the plan lays it and
        // nowhere else: the sea in its colour, the lava in its, the fresh water in its, and the
        // land in none of them; and it is dimmed past the world's edge.
        [Test]
        public void TheMapsGroundShowsTheWaterWhereItLies()
        {
            const int Side = 256;
            float half = plan.Radius + 40;
            Color32[] pixels = MapGround.Pixels(plan, Vector2.zero, half, Side);
            Color32 sea = MapGround.Sea, lava = MapGround.Lava, fresh = MapGround.Fresh;
            var seen = new int[6];
            for (int row = 0; row < Side; row++)
            {
                for (int column = 0; column < Side; column++)
                {
                    float x = -half + (column + 0.5f) * 2 * half / Side, z = -half + (row + 0.5f) * 2 * half / Side;
                    if (x * x + z * z > plan.Radius * plan.Radius)
                    {
                        continue;
                    }
                    byte wet = plan.Wet[plan.Grid.At(x, z)];
                    Color32 pixel = pixels[row * Side + column];
                    seen[wet]++;
                    Color32 wanted = wet switch
                    {
                        DressPlan.WetSea => sea,
                        DressPlan.WetLava => lava,
                        DressPlan.Dry => pixel,
                        _ => fresh,
                    };
                    Assert.That(pixel, Is.EqualTo(wanted), $"the map at {x:F0}, {z:F0}, where the water is {wet}");
                    if (wet == DressPlan.Dry)
                    {
                        Assert.That(pixel, Is.Not.EqualTo(sea).And.Not.EqualTo(lava).And.Not.EqualTo(fresh), $"dry land at {x:F0}, {z:F0}");
                    }
                }
            }
            Assert.That(seen[DressPlan.WetSea] > 0 && seen[DressPlan.WetLava] > 0 && seen[DressPlan.Dry] > 0, $"the map shows sea, lava and land: {string.Join(", ", seen)}");
            Color32 corner = pixels[0];
            Assert.That(corner.r + corner.g + corner.b, Is.LessThan(255 * 3 * MapGround.PastTheEdge), "past the edge the map is dim");
        }

        // Unity Terrain draws at most eight layers on a tile in HDRP: the plan gives none more, and
        // each texel's weights sum to one, in 255ths.
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
                        int sum = 0;
                        for (int k = 0; k < tile.Layers.Length; k++)
                        {
                            sum += tile.Weights[(r * DressPlan.TileTexels + c) * tile.Layers.Length + k];
                        }
                        Assert.That(sum, Is.EqualTo(255));
                    }
                }
            }
            Debug.Log($"DressingTests: {plan.TileLayers.Sum(tile => tile.Layers.Length) / (float)plan.TileLayers.Length:F2} layers a tile; {dropped} dropped");
        }

        // The plan's distances (DEC-1005, the memory cut): the transform is exact on the grid, in
        // a fresh grid or in one it reuses, and a grid held in 16 bits reads no more than that and
        // less by under a 32nd of a metre, and `float.MaxValue` where nothing is marked.
        [Test]
        public void TheDistancesAreExactAndHeldRoundedDown()
        {
            var grid = new Raster(96, 64);
            var mask = new bool[grid.Count];
            var marked = new List<int>();
            for (int i = 0; i < grid.Count; i++)
            {
                if (Raster.Hash(i, 7, 11) < 0.01f)
                {
                    mask[i] = true;
                    marked.Add(i);
                }
            }
            var reused = new float[grid.Count];
            grid.Distance(new bool[grid.Count], reused);
            float[] metres = grid.Distance(mask), again = grid.Distance(mask, reused);
            var held = new Distances(metres);
            for (int i = 0; i < grid.Count; i++)
            {
                int nearest = marked.Min(m => (m / grid.N - i / grid.N) * (m / grid.N - i / grid.N) + (m % grid.N - i % grid.N) * (m % grid.N - i % grid.N));
                Assert.That(metres[i], Is.EqualTo((float)(Math.Sqrt(nearest) * grid.Texel)), $"texel {i}");
                Assert.That(again[i], Is.EqualTo(metres[i]), $"texel {i}, in a grid reused");
                Assert.That(held[i], Is.LessThanOrEqualTo(metres[i]).And.GreaterThan(metres[i] - Distances.Step), $"texel {i}, held");
            }
            Assert.That(new Distances(grid.Distance(new bool[grid.Count]))[0], Is.EqualTo(float.MaxValue));
        }

        // The ground the allocator reserved, as its shapes: the plaza, the trail (or not), every
        // pad, site path, approach and stone, and every stand's footprint, apron and corridor.
        static Shapes ReservedShapes(bool trail)
        {
            var shapes = new Shapes();
            WorldDocument layout = plan.Layout;
            float half = LayoutConstants.PathHalfWidth / 1000f;
            shapes.Disc(Vector2.zero, layout.PlazaEdgeRadius / 1000f);
            if (layout.PlazaApproach != null && trail)
            {
                shapes.Line(layout.PlazaApproach.Select(DressPlan.Metres).ToList(), half);
            }
            foreach (TrailLeg leg in trail ? layout.Legs : new TrailLeg[0])
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
            return shapes;
        }

        // PRD v4 8.4.2, 5.4.1: no prop stands within 1 m and its own footprint of a stand's
        // footprint, apron or corridor, a path, the trail, a pad, the plaza or a stone, tested on
        // the shapes themselves and not on the grid; none stands in water; and no tree stands in a
        // cluster's disc.
        [Test]
        public void EveryPropKeepsItsClearance()
        {
            Shapes shapes = ReservedShapes(trail: true);
            WorldDocument layout = plan.Layout;
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

        // 8.4.2: the avatar walks round the trees and the large rocks nearest it. Where more trees
        // stand within the colliders' reach than there are capsules, as at high density in a wood,
        // the capsules and the boxes go on the nearest, not on the first in the cells' order
        // (DEC-1194 N7).
        [Test]
        public void TheCollidersGoOnTheNearestTreesAndRocks()
        {
            Scatter dense = High();
            var kindOf = new int[dense.Instances.Length];
            for (int key = 0; key < dense.RunStart.Length; key++)
            {
                for (int i = dense.RunStart[key]; i < dense.RunStart[key] + dense.RunCount[key]; i++)
                {
                    kindOf[i] = key % dense.Kinds.Length;
                }
            }
            var trees = new List<(float Distance, int Prop, int Kind)>();
            var rocks = new List<(float Distance, int Prop, int Kind)>();
            // The place, at a tree, with the most trees within the reach.
            Vector3 best = Vector3.zero;
            int most = -1;
            for (int i = 0; i < dense.Instances.Length; i += 7)
            {
                if (dense.Kinds[kindOf[i]].Category != "Trees")
                {
                    continue;
                }
                PropField.Nearest(dense, dense.Instances[i].Position, PropField.ColliderReach, trees, rocks);
                if (trees.Count > most)
                {
                    most = trees.Count;
                    best = dense.Instances[i].Position;
                }
            }
            Assert.That(most, Is.GreaterThan(PropField.Trunks), "somewhere more trees stand within the reach than there are capsules");

            PropField.Nearest(dense, best, PropField.ColliderReach, trees, rocks);
            int treesWithin = 0, rocksWithin = 0;
            for (int i = 0; i < dense.Instances.Length; i++)
            {
                Scatter.Kind kind = dense.Kinds[kindOf[i]];
                if ((dense.Instances[i].Position - best).sqrMagnitude > PropField.ColliderReach * PropField.ColliderReach)
                {
                    continue;
                }
                treesWithin += kind.Category == "Trees" ? 1 : 0;
                rocksWithin += kind.Category == "Rocks" && kind.Shape.Height > 0.6f ? 1 : 0;
            }
            Assert.That(trees.Count, Is.EqualTo(treesWithin), "every tree within the reach");
            Assert.That(rocks.Count, Is.EqualTo(rocksWithin), "every large rock within the reach");
            Assert.That(trees.Select(tree => tree.Distance), Is.Ordered, "the trees nearest first");
            Assert.That(rocks.Select(rock => rock.Distance), Is.Ordered, "the rocks nearest first");
            Debug.Log($"DressingTests: at high density, {most} trees and {rocks.Count} large rocks within {PropField.ColliderReach} m at the densest place; {PropField.Trunks} capsules and {PropField.Blocks} boxes");
        }

        // The props' lever at HDRP high (DEC-1005): past a kind's near radius a cell at high draws
        // the props that stand at medium's density, the first by rank, and within it all its own.
        // So at no distance does high draw fewer of a cell's props than medium, nor others in their
        // place: medium's are the first of high's. Medium draws all its props at every distance.
        [Test]
        public void HighDrawsMediumsPropsAndNoFewerAtEveryDistance()
        {
            Scatter dense = High();
            int kinds = scatter.Kinds.Length;
            float[] distances = { 0, 5, 10, 20, 30, 40, 48, 60, 80, 120, 170, 260, 400, 520 };
            var drawn = new SortedDictionary<string, long[]>();
            string CategoryOf(Scatter.Kind kind) => kind.Low ? "cover" : kind.Far ? "field" : kind.Category;
            void Tally(Scatter.Kind kind, int at, int medium, int highs)
            {
                Assert.That(highs, Is.GreaterThanOrEqualTo(medium), $"{kind.Prefab} at {distances[at]} m");
                if (!drawn.TryGetValue(CategoryOf(kind), out long[] sums))
                {
                    drawn[CategoryOf(kind)] = sums = new long[distances.Length * 2];
                }
                sums[at * 2] += medium;
                sums[at * 2 + 1] += highs;
            }

            // The props placed once: by cell and kind, medium's run is the first `RunFar` of high's.
            var mediums = new HashSet<Vector3>();
            for (int key = 0; key < scatter.RunStart.Length; key++)
            {
                Scatter.Kind of = scatter.Kinds[key % kinds];
                int count = scatter.RunCount[key], highs = dense.RunCount[key], far = dense.RunFar[key];
                Assert.That(scatter.RunFar[key], Is.EqualTo(count), "medium draws all its props");
                Assert.That(far, Is.EqualTo(count), $"{of.Prefab}: high's props at medium's density are medium's");
                mediums.Clear();
                for (int i = scatter.RunStart[key]; i < scatter.RunStart[key] + count; i++)
                {
                    mediums.Add(scatter.Instances[i].Position);
                }
                for (int i = dense.RunStart[key]; i < dense.RunStart[key] + far; i++)
                {
                    Assert.That(mediums.Contains(dense.Instances[i].Position), $"{of.Prefab} at {dense.Instances[i].Position} is not medium's");
                }
                for (int at = 0; at < distances.Length; at++)
                {
                    if (distances[at] <= PropField.Reach(of) && highs > 0)
                    {
                        Tally(of, at, PropField.Share(of, count, scatter.RunFar[key], distances[at]), PropField.Share(of, highs, far, distances[at]));
                    }
                }
            }

            // Ground cover and the field's growth, made about the walker: a lazy cell's props by
            // kind in the order the field draws them, medium's the first of high's.
            var ofMedium = new List<(int Kind, Scatter.Instance Prop)>();
            var ofHigh = new List<(int Kind, Scatter.Instance Prop)>();
            int cells = Mathf.CeilToInt(plan.Grid.Side / Scatter.CoverCell), tried = 0;
            for (int cz = 3; cz < cells; cz += 37)
            {
                for (int cx = 3; cx < cells; cx += 37)
                {
                    for (int lazy = 0; lazy < 2; lazy++)
                    {
                        ofMedium.Clear();
                        ofHigh.Clear();
                        if (lazy == 0)
                        {
                            scatter.CoverIn(cx, cz, (kind, prop) => ofMedium.Add((kind, prop)));
                            dense.CoverIn(cx, cz, (kind, prop) => ofHigh.Add((kind, prop)));
                        }
                        else
                        {
                            scatter.FarIn(cx / 4, cz / 4, (kind, prop) => ofMedium.Add((kind, prop)));
                            dense.FarIn(cx / 4, cz / 4, (kind, prop) => ofHigh.Add((kind, prop)));
                        }
                        ofMedium.Sort(PropField.InRunOrder);
                        ofHigh.Sort(PropField.InRunOrder);
                        for (int kind = 0; kind < kinds; kind++)
                        {
                            Scatter.Kind of = scatter.Kinds[kind];
                            List<Vector3> medium = ofMedium.Where(one => one.Kind == kind).Select(one => one.Prop.Position).ToList();
                            List<(int Kind, Scatter.Instance Prop)> highs = ofHigh.Where(one => one.Kind == kind).ToList();
                            int far = highs.Count(one => one.Prop.Rank < 1);
                            if (highs.Count == 0)
                            {
                                Assert.That(medium, Is.Empty, $"{of.Prefab}: medium's props are among high's");
                                continue;
                            }
                            CollectionAssert.AreEqual(medium, highs.Take(far).Select(one => one.Prop.Position).ToList(), $"{of.Prefab}: high's first props are medium's, in order");
                            for (int at = 0; at < distances.Length; at++)
                            {
                                float d = distances[at];
                                if (!of.Low && d > PropField.Reach(of))
                                {
                                    continue;
                                }
                                float keep = of.Low ? 1 - Mathf.InverseLerp(Variants.CoverNear, Variants.CoverFar, d) : Mathf.Min(1, Variants.FieldNear / Mathf.Max(d, 1));
                                Tally(of, at, Mathf.RoundToInt(PropField.Share(of, medium.Count, medium.Count, d) * keep), Mathf.RoundToInt(PropField.Share(of, highs.Count, far, d) * keep));
                            }
                        }
                        tried++;
                    }
                }
            }
            Assert.That(drawn.Keys, Is.SupersetOf(new[] { "Trees", "Rocks", "Bushes", "field", "cover" }), $"{tried} lazy cells");
            Debug.Log("DressingTests: props drawn of the cells by distance, medium against high: " + string.Join("; ", drawn.Select(category =>
                $"{category.Key} " + string.Join(", ", distances.Select((d, at) => (d, at)).Where(one => category.Value[one.at * 2 + 1] > 0)
                    .Select(one => $"{one.d} m {category.Value[one.at * 2]}/{category.Value[one.at * 2 + 1]}")))));
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
