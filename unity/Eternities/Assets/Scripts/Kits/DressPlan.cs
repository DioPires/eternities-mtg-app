using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Eternities.Data;
using Eternities.Layout;
using UnityEngine;

namespace Eternities.Kits
{
    // One body of water of a world (PRD v4 5.6.3, 8.4.2): a river or a lava flow along a line, or
    // a pond, a lake or the sea as an area. Positions are metres on the ground, x east and z north.
    public sealed class WaterBody
    {
        public const string River = "river", Pond = "pond", Lake = "lake", Sea = "sea", Marsh = "marsh", Lava = "lava";

        public string Kind;
        public int Region;
        public List<Vector2> Line = new List<Vector2>();    // a river's or a lava flow's middle, from its head to its end
        public float HalfWidth;
        public Vector2 Centre;                              // a pond's or a lake's
        public float Radius;
        public uint Seed;

        // A pond's or a lake's shore is a circle that the noise of its seed pushes in and out.
        public float ShoreAt(Vector2 point)
        {
            Vector2 d = point - Centre;
            float angle = Mathf.Atan2(d.y, d.x);
            return Radius * (0.82f + 0.36f * Raster.Noise(Mathf.Cos(angle) * 2.2f + 7, Mathf.Sin(angle) * 2.2f + 7, Seed));
        }
    }

    // Where water crosses the trail: the trail goes down into it and out again over a bed of
    // gravel, as a ford (PRD v4 5.4.11, 8.4.2). `Along` is the crossing river's way there.
    public sealed class Ford
    {
        public Vector2 At, Along;
        public int River;
        public float Radius;    // the farthest of the trail it holds from `At`, in metres
    }

    // The layers one terrain tile paints, out of the plan's, and their weights there.
    public sealed class TileLayers
    {
        public int[] Layers;            // indices into `DressPlan.LayerNames`
        // [row, column, layer] in 255ths, each texel's summing to 255. Unity Terrain keeps 8 bits a
        // layer, so a byte holds all it keeps, at a quarter of a float (DEC-1005, the memory cut).
        public byte[] Weights;
        public int Dropped;             // layers the tile had and Unity Terrain's eight could not hold

        // The weights as Unity Terrain takes them, into `alphas` [row, column, layer].
        public void Alphas(float[,,] alphas)
        {
            int side = alphas.GetLength(0), layers = Layers.Length, at = 0;
            for (int r = 0; r < side; r++)
            {
                for (int c = 0; c < side; c++)
                {
                    for (int k = 0; k < layers; k++)
                    {
                        alphas[r, c, k] = Weights[at++] / 255f;
                    }
                }
            }
        }
    }

    // A dressed world's ground, worked out from its pack on a worker thread before anything of it
    // is drawn (PRD v4 5.6.3, 8.4.2, 8.4.5): which region and variant lies under every texel, with
    // the 20 m blend across each boundary; the ground everything the allocator placed stands on,
    // kept flat and dry; the heights; the water the region rows name; and the terrain layers of
    // each tile. Every figure of the world comes from its pack; the plan only dresses it.
    public sealed partial class DressPlan
    {
        // The ground reaches this far past the world's radius, where hills, trees or the sea close
        // the view (PRD v4 5.1.5). The avatar stops at the radius.
        public const float Margin = 160;
        // A terrain tile is this many texels a side: one Unity Terrain a tile (`WorldGround`).
        public const int TileTexels = 256;
        // The water's level, under the ground level of everything the allocator placed, which is 0.
        public const float WaterLevel = -0.6f;
        // PRD v4 5.6.3: a region's ground runs into its neighbour's over 20 m, 10 m each side of
        // the boundary. Its relief runs into its neighbour's more slowly, so no boundary is a step.
        public const float Blend = 10, HeightBlend = 45;
        // PRD v4 5.4.1: water keeps 3 m from paths, corridors, aprons, pads and stones; props 1 m.
        public const float WaterBuffer = 3, PropClearance = 1;
        // The relief keeps this far from anything flat, then rises to its full height over the falloff.
        public const float FlatApron = 1.5f, Falloff = 10;
        // A river: its half width, the bank from its edge up to the ground, and the depth of its water.
        public const float RiverHalfWidth = 3.5f, RiverBank = 5, RiverDepth = 1.0f;
        public const float LavaHalfWidth = 2.2f, LavaBank = 3, LavaLevel = -0.45f;
        // A ford: the water over the trail where it crosses, and how far up and down each bank the
        // trail goes into it.
        public const float FordDepth = 0.2f, FordRamp = 7;
        // The sea comes in from the world's edge by its band, and stays this far from land: the
        // water buffer, and a beach.
        public const float SeaBand = 80, Beach = 14;

        public WorldDocument Layout;
        public Raster Grid;
        public int Tiles;
        public float Radius;                // the world's, in metres
        public RegionDress[] Regions;       // by region index
        public byte[] Region, Other;        // by texel: its region, and the region across the nearest boundary
        public Distances FromBoundary;      // metres to that boundary
        public bool[] Reserved, Cluster;
        public Distances FromPath, FromWorn, FromReserved, FromBlob, FromTrail;
        public float[] Heights;             // (N + 1)², metres from the ground level, row by row from the south-west corner
        public byte[] Wet;                  // by texel: `Dry`, or the kind of water that lies there
        // The rivers' current map, `CurrentSide` a side, as `WorldWater` draws it: red and green the
        // way the water runs, from −1 to 1, and blue where a river runs.
        public Color32[] Current;
        public const int CurrentSide = 1024;
        public readonly List<WaterBody> Water = new List<WaterBody>();
        public readonly List<Ford> Fords = new List<Ford>();
        public string[] LayerNames;
        public TileLayers[] TileLayers;
        public int Layers => LayerNames.Length;

        public const byte Dry = 0, WetRiver = 1, WetStill = 2, WetSea = 3, WetLava = 4, WetMarsh = 5;

        public int N => Grid.N;
        public int Samples => Grid.N + 1;

        // 8.4.5: the heightmap is 513 samples a side for a world under 100 m of radius, 1,025 to
        // 260 m and 2,049 beyond, over the world and its margin.
        public static int HeightmapResolution(float worldRadius) => worldRadius < 100 ? 513 : worldRadius <= 260 ? 1025 : 2049;

        public static int Texels(float worldRadius) => HeightmapResolution(worldRadius) - 1;

        public static Vector2 Metres(P2 millimetres) => new Vector2(millimetres.X / 1000f, millimetres.Z / 1000f);

        static List<Vector2> Metres(IReadOnlyList<P2> millimetres)
        {
            var points = new List<Vector2>(millimetres.Count);
            foreach (P2 point in millimetres)
            {
                points.Add(Metres(point));
            }
            return points;
        }

        // The region under each texel: the cell that holds its middle (4.13.5), and beyond the world
        // the nearest cell's. And for each texel the region across the nearest boundary and how far
        // that is, from which the blend takes its shares.
        void RegionsOnGrid()
        {
            int count = Grid.Count;
            Region = new byte[count];
            var assigned = new bool[count];
            for (int r = 0; r < Layout.Regions.Length; r++)
            {
                byte index = (byte)r;
                Grid.Fill(Metres(Layout.Regions[r].Cell), (row, from, to) =>
                {
                    for (int column = from; column <= to; column++)
                    {
                        Region[row * N + column] = index;
                        assigned[row * N + column] = true;
                    }
                });
            }
            var nearest = new int[count];
            Grid.Distance(assigned, nearest, scratch ??= new float[count]);
            for (int i = 0; i < count; i++)
            {
                if (!assigned[i] && nearest[i] >= 0)
                {
                    Region[i] = Region[nearest[i]];
                }
            }

            // A texel beside one of another region is on a boundary; it remembers that region.
            var edge = new bool[count];
            var across = new byte[count];
            for (int row = 0; row < N; row++)
            {
                for (int column = 0; column < N; column++)
                {
                    int i = row * N + column;
                    foreach (int j in new[] { column + 1 < N ? i + 1 : -1, row + 1 < N ? i + N : -1 })
                    {
                        if (j >= 0 && Region[j] != Region[i])
                        {
                            edge[i] = edge[j] = true;
                            across[i] = Region[j];
                            across[j] = Region[i];
                        }
                    }
                }
            }
            float[] fromEdge = Grid.Distance(edge, nearest, scratch);
            Other = new byte[count];
            for (int i = 0; i < count; i++)
            {
                int b = nearest[i];
                if (b < 0)
                {
                    Other[i] = Region[i];
                    fromEdge[i] = float.MaxValue;
                    continue;
                }
                Other[i] = Region[b] != Region[i] ? Region[b] : across[b];
                // A boundary texel's middle is half a texel from the boundary itself.
                fromEdge[i] += Grid.Texel / 2;
            }
            FromBoundary = new Distances(fromEdge);
        }

        // A mask's distances, worked out in the plan's scratch grid while the plan is made.
        float[] scratch;

        Distances DistanceTo(bool[] mask) => new Distances(Grid.Distance(mask, scratch ??= new float[Grid.Count]));

        // The other region's share of a texel's ground, under the 20 m blend, from 0 to a half.
        public float Share(int texel) => Other[texel] == Region[texel] ? 0 : 0.5f * (1 - Mathf.SmoothStep(0, 1, FromBoundary[texel] / Blend));

        float HeightShare(int texel) => Other[texel] == Region[texel] ? 0 : 0.5f * (1 - Mathf.SmoothStep(0, 1, FromBoundary[texel] / HeightBlend));

        // Everything the allocator placed, on the grid: the paths, the trail, the approaches, the
        // plaza, the pads, the stones and every stand's footprint, apron and corridor are reserved
        // ground, flat at the ground level, dry and clear of props. Each site's blob is the site's
        // ground, and each cluster's disc stands open of trees. A shape marks every texel it
        // touches: its middle within the shape and half a texel's diagonal.
        void Shapes(long[] standX, long[] standZ, long[] standYaw)
        {
            int count = Grid.Count;
            float slack = Grid.Texel * 0.7072f;
            float half = LayoutConstants.PathHalfWidth / 1000f + slack;
            float pathHalf = LayoutConstants.PathHalfWidth / 1000f;
            shapes = new ShapeIndex();
            var path = new bool[count];
            var trail = new bool[count];
            Grid.Disc(path, Vector2.zero, Layout.PlazaEdgeRadius / 1000f + slack);
            shapes.Disc(Vector2.zero, Layout.PlazaEdgeRadius / 1000f);
            if (Layout.PlazaApproach != null)
            {
                Grid.Strip(trail, Metres(Layout.PlazaApproach), half);
                shapes.Strip(Metres(Layout.PlazaApproach), pathHalf);
            }
            foreach (TrailLeg leg in Layout.Legs)
            {
                foreach (P2[] part in new[] { leg.Polyline, leg.StartAttachment, leg.EndAttachment })
                {
                    if (part.Length > 0)
                    {
                        Grid.Strip(trail, Metres(part), half);
                        shapes.Strip(Metres(part), pathHalf);
                    }
                }
            }
            foreach (WorldPad pad in Layout.Pads)
            {
                Grid.Disc(path, Metres(pad.Centre), pad.Radius / 1000f + slack);
                shapes.Disc(Metres(pad.Centre), pad.Radius / 1000f);
            }
            var blob = new bool[count];
            Cluster = new bool[count];
            foreach (WorldSite site in Layout.Sites)
            {
                Grid.Strip(path, Metres(site.Path), half);
                Grid.Strip(path, new[] { Metres(site.Pad.Position), Metres(site.ApproachPoint) }, half);
                shapes.Strip(Metres(site.Path), pathHalf);
                shapes.Strip(new[] { Metres(site.Pad.Position), Metres(site.ApproachPoint) }, pathHalf);
                Grid.Polygon(blob, Metres(site.Blob));
                foreach (SiteCluster cluster in site.Clusters)
                {
                    if (cluster.Stands > 0)
                    {
                        Grid.Disc(Cluster, Metres(cluster.Centre), LayoutConstants.ClusterRadius / 1000f + PropClearance);
                    }
                }
            }
            // Each stand: its footprint, its apron in front of it and its corridor to its path vertex,
            // ground that is walked on and kept, but not a path.
            var worn = new bool[count];
            for (int stand = 0; stand < standX.Length; stand++)
            {
                Vector2 at = new Vector2(standX[stand] / 1000f, standZ[stand] / 1000f);
                float yaw = standYaw[stand] / 1e6f * Mathf.Deg2Rad;
                Vector2 ahead = new Vector2(Mathf.Cos(yaw), Mathf.Sin(yaw)), side = new Vector2(-ahead.y, ahead.x);
                float back = LayoutConstants.FootprintDepth / 2000f, front = back + LayoutConstants.ApronDepth / 1000f;
                float wide = LayoutConstants.ApronWidth / 2000f;
                Grid.Polygon(worn, new[]
                {
                    at - ahead * back - side * wide - (ahead + side) * slack, at - ahead * back + side * wide + (side - ahead) * slack,
                    at + ahead * front + side * wide + (ahead + side) * slack, at + ahead * front - side * wide + (ahead - side) * slack,
                });
                float foot = LayoutConstants.FootprintWidth / 2000f;
                shapes.Polygon(new[] { at - ahead * back - side * foot, at - ahead * back + side * foot, at + ahead * back + side * foot, at + ahead * back - side * foot });
                shapes.Polygon(new[] { at + ahead * back - side * wide, at + ahead * back + side * wide, at + ahead * front + side * wide, at + ahead * front - side * wide });
            }
            for (int stand = 0; stand < standX.Length; stand++)
            {
                Vector2 at = new Vector2(standX[stand] / 1000f, standZ[stand] / 1000f);
                float yaw = standYaw[stand] / 1e6f * Mathf.Deg2Rad;
                Vector2 ahead = new Vector2(Mathf.Cos(yaw), Mathf.Sin(yaw));
                Vector2 start = at + ahead * (LayoutConstants.FootprintDepth / 2000f + LayoutConstants.ApronDepth / 1000f);
                Grid.Segment(worn, start, corridorEnds[stand], LayoutConstants.CorridorHalfWidth / 1000f + slack);
                shapes.Strip(new[] { start, corridorEnds[stand] }, LayoutConstants.CorridorHalfWidth / 1000f);
            }
            for (int i = 0; i < count; i++)
            {
                path[i] |= trail[i];
            }
            Reserved = new bool[count];
            for (int i = 0; i < count; i++)
            {
                Reserved[i] = path[i] || worn[i];
            }
            foreach (WorldSite site in Layout.Sites)
            {
                Grid.Disc(Reserved, Metres(site.Stone.Position), LayoutConstants.StoneRadius / 1000f + slack);
                shapes.Disc(Metres(site.Stone.Position), LayoutConstants.StoneRadius / 1000f);
                foreach (SiteChapter chapter in site.Chapters)
                {
                    if (chapter.Stone != null)
                    {
                        Grid.Disc(Reserved, Metres(chapter.Stone.Value.Position), LayoutConstants.StoneRadius / 1000f + slack);
                        shapes.Disc(Metres(chapter.Stone.Value.Position), LayoutConstants.StoneRadius / 1000f);
                    }
                }
            }
            foreach (WorldVolume volume in Layout.HeroVolumes)
            {
                Grid.Polygon(Reserved, Metres(volume.Polygon));
                shapes.Polygon(Metres(volume.Polygon).ToArray());
            }
            FromPath = DistanceTo(path);
            FromWorn = DistanceTo(worn);
            FromReserved = DistanceTo(Reserved);
            FromBlob = DistanceTo(blob);
            FromTrail = DistanceTo(trail);
        }

        Vector2[] corridorEnds;     // by stand: the end of its corridor, its path vertex (4.13.5)

        // The plan of a world, from its pack. Runs on any thread.
        public static DressPlan Compute(WorldData world)
        {
            WorldDocument layout = world.Layout;
            int count = world.StandCount;
            var x = new long[count];
            var z = new long[count];
            var yaw = new long[count];
            var ends = new Vector2[count];
            for (int stand = 0; stand < count; stand++)
            {
                P2 at = world.Position(stand);
                x[stand] = at.X;
                z[stand] = at.Z;
                yaw[stand] = world.Yaw(stand);
                ends[stand] = Metres(layout.Sites[world.Site(stand)].Path[layout.StandVertex[stand]]);
            }
            return Compute(layout, x, z, yaw, ends);
        }

        // The same from the parts of it the plan reads: each stand's position and yaw in the pack's
        // millimetres and micro-degrees, and the end of its corridor in metres.
        public static DressPlan Compute(WorldDocument layout, long[] standX, long[] standZ, long[] standYaw, Vector2[] corridorEnds)
        {
            var plan = new DressPlan { Layout = layout, Radius = layout.Radius / 1000f, corridorEnds = corridorEnds };
            int n = Texels(plan.Radius);
            plan.Grid = new Raster(2 * (plan.Radius + Margin), n);
            plan.Tiles = n / TileTexels;
            plan.Regions = new RegionDress[layout.Regions.Length];
            for (int r = 0; r < layout.Regions.Length; r++)
            {
                plan.Regions[r] = Dressing.Of(layout.Slug, layout.Regions[r]);
            }
            plan.RegionsOnGrid();
            plan.Shapes(standX, standZ, standYaw);
            plan.Relief();
            plan.WaterOf();
            plan.Paint();
            plan.corridorEnds = null;
            plan.scratch = null;
            return plan;
        }

        // A world's load lets the plan's grids go as soon as nothing more reads them, so that the
        // grids of one stage are not in the heap beside the next stage's (DEC-1005, the memory cut).
        // Once the plan is made: the reserved ground's mask, and the distances only the plan read.
        public void ForTheBuild()
        {
            Reserved = null;
            FromPath = FromWorn = FromBlob = FromTrail = null;
        }

        // Once the world is built: the tiles' layers and the rivers' current map. The walk reads
        // the rest: the regions and their blend, the heights, the water, the reserved ground's
        // distance and shapes, and the clusters (`Scatter`, `App`).
        public void ForTheWalk()
        {
            ForTheBuild();
            TileLayers = null;
            Current = null;
        }

        // Everything, when the world is left: whatever still holds the plan then holds none of
        // its grids, and the next visit's plan is not built beside them.
        public void Release()
        {
            ForTheWalk();
            Region = Other = Wet = null;
            FromBoundary = FromReserved = null;
            Heights = null;
            Cluster = null;
            shapes = null;
            Layout = null;
        }

        // The seed of everything the dressing draws for a world: FNV-1a 64 of its own string, as
        // the allocator seeds its draws (5.4.1), so the same world is dressed alike on every machine.
        uint Seed(string what) => (uint)SplitMix64.Fnv1a64($"eternities-v4|{Layout.Slug}|dressing|{what}");

        // The heights of the land: each region's relief, blended over `HeightBlend` across each
        // boundary, held at the ground level on and about everything reserved, and rising into
        // hills past the world's edge where no sea lies. The water carves its beds into them.
        void Relief()
        {
            int samples = Samples;
            Heights = new float[samples * samples];
            uint hills = Seed("hills"), rough = Seed("rough"), edge = Seed("edge");
            Parallel.For(0, samples, row =>
            {
                float z = Grid.Min + row * Grid.Texel;
                for (int column = 0; column < samples; column++)
                {
                    float x = Grid.Min + column * Grid.Texel;
                    int texel = Math.Min(row, N - 1) * N + Math.Min(column, N - 1);
                    float share = HeightShare(texel);
                    float h = (1 - share) * ReliefOf(Regions[Region[texel]].Relief, x, z, hills, rough);
                    if (share > 0)
                    {
                        h += share * ReliefOf(Regions[Other[texel]].Relief, x, z, hills, rough);
                        // A marsh's sunken relief blends into its neighbour's, and stays over the
                        // water's level there: no pool lies outside the marsh (8.4.2 item 2).
                        if (Regions[Region[texel]].Water != WaterBody.Marsh)
                        {
                            h = Mathf.Max(h, WaterLevel + 0.2f);
                        }
                    }
                    float near = AtCorner(FromReserved, row, column);
                    h *= Mathf.SmoothStep(0, 1, (near - FlatApron) / Falloff);
                    float beyond = Mathf.Sqrt(x * x + z * z) - Radius;
                    if (beyond > -20 && Regions[Region[texel]].Water != WaterBody.Sea)
                    {
                        h += Mathf.SmoothStep(0, 1, (beyond + 20) / 90) * (10 + 22 * Raster.Fractal(x / 70, z / 70, edge, 3));
                    }
                    Heights[row * samples + column] = h;
                }
            });
        }

        static float ReliefOf(Relief relief, float x, float z, uint hills, uint rough)
        {
            float h = relief.Height * (Raster.Fractal(x / relief.Width, z / relief.Width, hills, 3) - relief.Sunken);
            // The rough ground stands on the hills and never sinks below them: only a relief that
            // is sunken (the marsh's) lies under the water's level anywhere.
            return h + relief.Rough * Raster.Fractal(x / relief.RoughWidth, z / relief.RoughWidth, rough, 2);
        }

        // A height sample is a corner of up to four texels, and is as near to anything as the
        // nearest of them.
        float AtCorner(Distances distance, int row, int column)
        {
            float near = float.MaxValue;
            for (int r = Math.Max(row - 1, 0); r <= Math.Min(row, N - 1); r++)
            {
                for (int c = Math.Max(column - 1, 0); c <= Math.Min(column, N - 1); c++)
                {
                    near = Math.Min(near, distance[r * N + c]);
                }
            }
            return near;
        }

        // The ground's height at a point, the water carved, between samples.
        public float HeightAt(float x, float z) => Sample(Heights, x, z);

        float Sample(float[] heights, float x, float z)
        {
            float u = (x - Grid.Min) / Grid.Texel, v = (z - Grid.Min) / Grid.Texel;
            int c = Mathf.Clamp(Mathf.FloorToInt(u), 0, Samples - 2), r = Mathf.Clamp(Mathf.FloorToInt(v), 0, Samples - 2);
            float fu = Mathf.Clamp01(u - c), fv = Mathf.Clamp01(v - r);
            int i = r * Samples + c;
            return Mathf.Lerp(Mathf.Lerp(heights[i], heights[i + 1], fu), Mathf.Lerp(heights[i + Samples], heights[i + Samples + 1], fu), fv);
        }

        // How deep the water stands at a point: 0 on dry ground.
        public float DepthAt(float x, float z)
        {
            int texel = Grid.At(x, z);
            return Wet[texel] == Dry || Wet[texel] == WetLava ? 0 : Mathf.Max(0, WaterLevel - HeightAt(x, z));
        }

        public bool LavaAt(float x, float z) => Wet[Grid.At(x, z)] == WetLava && HeightAt(x, z) < LavaLevel;

        public RegionDress RegionAt(float x, float z) => Regions[Region[Grid.At(x, z)]];
    }
}
