using System;
using System.Collections.Generic;
using Eternities.Layout;
using UnityEngine;

namespace Eternities.Kits
{
    // The water each region row names (PRD v4 5.6.3, 8.4.2, Appendix F.1), in the world's water
    // zones: away from every site's ground and 3 m clear of everything reserved, crossing the
    // trail only at a ford. A river runs across its region between two ponds; a lake lies where its
    // region has the most open ground; the sea comes in from the world's edge; a marsh's pools lie
    // in its hollows; a lava flow runs as a river does, and never across the trail.
    public sealed partial class DressPlan
    {
        // The route's grid, in metres a cell: four texels or so.
        const float RouteCell = 4;
        // What a cell of the route near the trail costs, against 1 to 4 for a cell of open ground.
        const float TrailCost = 400;

        float[] fromSite;       // metres from anything reserved that is not the trail

        void WaterOf()
        {
            int count = Grid.Count;
            Heights = (float[])land.Clone();
            Wet = new byte[count];
            FlowX = new float[count];
            FlowZ = new float[count];
            var siteGround = new bool[count];
            for (int i = 0; i < count; i++)
            {
                siteGround[i] = Reserved[i] && FromTrail[i] > 0;
            }
            fromSite = Grid.Distance(siteGround);

            for (int r = 0; r < Regions.Length; r++)
            {
                switch (Regions[r].Water)
                {
                    case WaterBody.Sea:
                        Sea(r);
                        break;
                    case WaterBody.Lake:
                        Lake(r);
                        break;
                    case WaterBody.River:
                        Flow(r, WaterBody.River, RiverHalfWidth, RiverBank, crossTrail: true);
                        break;
                    case WaterBody.Lava:
                        Flow(r, WaterBody.Lava, LavaHalfWidth, LavaBank, crossTrail: false);
                        break;
                }
            }
            // The sea carved its own bed and beach; every other body carves its bed here.
            foreach (WaterBody body in Water)
            {
                if (body.Kind != WaterBody.Sea)
                {
                    Carve(body);
                }
            }
            FordsOf();
            // A marsh's pools: its hollows under the water's level.
            for (int row = 0; row < N; row++)
            {
                for (int column = 0; column < N; column++)
                {
                    int i = row * N + column;
                    if (Wet[i] == Dry && HeightAt(Grid.X(column), Grid.Z(row)) < WaterLevel)
                    {
                        Wet[i] = WetMarsh;
                    }
                }
            }
        }

        // How far a texel lies from the ground a body of water keeps clear of: every site's blob and
        // everything reserved, the trail too unless the water may cross it.
        float Open(int texel, bool crossTrail) => Mathf.Min(FromBlob[texel], crossTrail ? fromSite[texel] : FromReserved[texel]);

        // The sea (PRD v4 5.1.5: a natural edge): in a region whose row names it, from past the
        // world's edge inward over a band that the noise widens and narrows, and never nearer
        // anything reserved or any site than the water buffer and a beach.
        void Sea(int region)
        {
            uint seed = Seed($"sea-{Regions[region].Id}");
            var sea = new bool[Grid.Count];
            bool any = false;
            for (int row = 0; row < N; row++)
            {
                for (int column = 0; column < N; column++)
                {
                    int i = row * N + column;
                    if (Region[i] != region)
                    {
                        continue;
                    }
                    float x = Grid.X(column), z = Grid.Z(row);
                    float inward = Radius - Mathf.Sqrt(x * x + z * z);
                    float angle = Mathf.Atan2(z, x);
                    float band = SeaBand * (0.45f + 1.1f * Raster.Noise(Mathf.Cos(angle) * 4 + 11, Mathf.Sin(angle) * 4 + 11, seed));
                    if (inward < band && Open(i, crossTrail: false) > WaterBuffer + Beach + 6 * Raster.Noise(x / 25, z / 25, seed + 1))
                    {
                        sea[i] = any = true;
                    }
                }
            }
            if (!any)
            {
                return;
            }
            Water.Add(new WaterBody { Kind = WaterBody.Sea, Region = region, Seed = seed });
            float[] fromSea = Grid.Distance(sea);
            var land = new bool[Grid.Count];
            for (int i = 0; i < land.Length; i++)
            {
                land[i] = !sea[i];
            }
            float[] intoSea = Grid.Distance(land);
            for (int row = 0; row < Samples; row++)
            {
                for (int column = 0; column < Samples; column++)
                {
                    int texel = Math.Min(row, N - 1) * N + Math.Min(column, N - 1);
                    int s = row * Samples + column;
                    if (sea[texel])
                    {
                        Heights[s] = Mathf.Min(Heights[s], WaterLevel - 0.25f - Mathf.Min(9, 0.11f * intoSea[texel]));
                    }
                    else if (fromSea[texel] < 30)
                    {
                        // The beach: up from the water's edge at about five degrees.
                        Heights[s] = Mathf.Min(Heights[s], WaterLevel + 0.1f + 0.09f * fromSea[texel]);
                    }
                }
            }
            for (int i = 0; i < sea.Length; i++)
            {
                if (sea[i])
                {
                    Wet[i] = WetSea;
                }
            }
        }

        // A lake where the region has the most open ground, as large as that ground holds it.
        void Lake(int region)
        {
            int best = -1;
            float most = 0;
            for (int i = 0; i < Grid.Count; i++)
            {
                if (Region[i] == region && FromBoundary[i] > 20 && Inside(i, 40))
                {
                    float open = Open(i, crossTrail: false);
                    if (open > most)
                    {
                        most = open;
                        best = i;
                    }
                }
            }
            const float Bank = 8;
            float radius = Mathf.Min(75, (most - WaterBuffer - Bank) / 1.18f);
            if (best < 0 || radius < 12)
            {
                return;
            }
            Water.Add(new WaterBody
            {
                Kind = WaterBody.Lake, Region = region, Centre = new Vector2(Grid.X(best % N), Grid.Z(best / N)), Radius = radius, Seed = Seed($"lake-{Regions[region].Id}"),
            });
        }

        bool Inside(int texel, float by)
        {
            float x = Grid.X(texel % N), z = Grid.Z(texel / N);
            return x * x + z * z < (Radius - by) * (Radius - by);
        }

        // A river or a lava flow across its region: the longest way the open ground gives between
        // two of its ends, found on a grid of `RouteCell`, round about the trail and over it only
        // where it must. A river has a pond at each end; a lava flow a pool at its head.
        void Flow(int region, string kind, float half, float bank, bool crossTrail)
        {
            float clearance = half + Mathf.Max(bank + FlatApron, WaterBuffer) + 1.5f;
            int cells = Mathf.CeilToInt(Grid.Side / RouteCell);
            float CellX(int c) => Grid.Min + (c + 0.5f) * RouteCell;
            int TexelOf(int cell) => Grid.At(CellX(cell % cells), CellX(cell / cells));
            uint seed = Seed($"{kind}-{Regions[region].Id}");
            // The cost of each cell, or infinity where the water may not go.
            var cost = new float[cells * cells];
            int open = 0;
            for (int cell = 0; cell < cost.Length; cell++)
            {
                int t = TexelOf(cell);
                bool allowed = Region[t] == region && FromBoundary[t] > half + bank && Inside(t, half + bank + 25)
                    && FromBlob[t] >= clearance && (crossTrail ? fromSite[t] : FromReserved[t]) >= clearance;
                if (!allowed)
                {
                    cost[cell] = float.PositiveInfinity;
                    continue;
                }
                float x = CellX(cell % cells), z = CellX(cell / cells);
                // Near the trail a cell costs as much as a long way round, so a river crosses the
                // trail square on, at one ford, or keeps away from it.
                cost[cell] = 1 + 3 * Raster.Noise(x / 60, z / 60, seed) + (FromTrail[t] < clearance ? TrailCost : 0);
                open++;
            }
            if (open < 50)
            {
                return;
            }
            // The two ends: the open cell farthest from where the region's open ground starts, and
            // the one farthest from that, each by way of the open ground.
            int start = -1;
            float roomiest = -1;
            for (int cell = 0; cell < cost.Length; cell++)
            {
                if (!float.IsInfinity(cost[cell]) && FromBlob[TexelOf(cell)] > roomiest)
                {
                    roomiest = FromBlob[TexelOf(cell)];
                    start = cell;
                }
            }
            int a = Farthest(cost, cells, start), b = Farthest(cost, cells, a);
            List<int> route = Route(cost, cells, a, b);
            if (route == null || route.Count < 12)
            {
                return;
            }
            var points = new List<Vector2>(route.Count);
            foreach (int cell in route)
            {
                points.Add(new Vector2(CellX(cell % cells), CellX(cell / cells)));
            }
            for (int pass = 0; pass < 3; pass++)
            {
                points = Chaikin(points);
            }
            var body = new WaterBody { Kind = kind, Region = region, HalfWidth = half, Seed = seed, Line = Resample(points, 2) };
            Water.Add(body);
            // The ponds: as large as the open ground about each end holds them.
            foreach ((Vector2 end, bool head) in new[] { (body.Line[0], true), (body.Line[body.Line.Count - 1], false) })
            {
                if (kind == WaterBody.Lava && !head)
                {
                    continue;
                }
                float room = Open(Grid.At(end.x, end.y), crossTrail: false) - WaterBuffer - bank;
                float radius = Mathf.Min(kind == WaterBody.Lava ? 7 : 13, room / 1.18f);
                if (radius > half + 1)
                {
                    Water.Add(new WaterBody { Kind = kind == WaterBody.Lava ? WaterBody.Lava : WaterBody.Pond, Region = region, Centre = end, Radius = radius, Seed = seed + (head ? 1u : 2u) });
                }
            }
        }

        // The open cell whose way from `from` is the longest, by a flood over the open cells.
        static int Farthest(float[] cost, int cells, int from)
        {
            var reach = new float[cost.Length];
            for (int i = 0; i < reach.Length; i++)
            {
                reach[i] = float.PositiveInfinity;
            }
            var queue = new Queue<int>();
            reach[from] = 0;
            queue.Enqueue(from);
            int far = from;
            while (queue.Count > 0)
            {
                int cell = queue.Dequeue();
                if (reach[cell] > reach[far])
                {
                    far = cell;
                }
                int cx = cell % cells, cz = cell / cells;
                for (int dz = -1; dz <= 1; dz++)
                {
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        int x = cx + dx, z = cz + dz;
                        if ((dx == 0 && dz == 0) || x < 0 || z < 0 || x >= cells || z >= cells)
                        {
                            continue;
                        }
                        int next = z * cells + x;
                        if (!float.IsInfinity(cost[next]) && float.IsInfinity(reach[next]))
                        {
                            reach[next] = reach[cell] + (dx != 0 && dz != 0 ? 1.4142f : 1);
                            queue.Enqueue(next);
                        }
                    }
                }
            }
            return far;
        }

        // The cheapest way between two cells, by A* over eight neighbours, or null.
        static List<int> Route(float[] cost, int cells, int from, int to)
        {
            var g = new Dictionary<int, float> { [from] = 0 };
            var came = new Dictionary<int, int>();
            var open = new SortedSet<(float F, int Cell)>();
            float H(int cell) => Vector2.Distance(new Vector2(cell % cells, cell / cells), new Vector2(to % cells, to / cells));
            open.Add((H(from), from));
            var closed = new HashSet<int>();
            while (open.Count > 0)
            {
                (float _, int cell) = open.Min;
                open.Remove(open.Min);
                if (cell == to)
                {
                    var path = new List<int> { to };
                    while (came.TryGetValue(path[path.Count - 1], out int before))
                    {
                        path.Add(before);
                    }
                    path.Reverse();
                    return path;
                }
                if (!closed.Add(cell))
                {
                    continue;
                }
                int cx = cell % cells, cz = cell / cells;
                for (int dz = -1; dz <= 1; dz++)
                {
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        int x = cx + dx, z = cz + dz;
                        if ((dx == 0 && dz == 0) || x < 0 || z < 0 || x >= cells || z >= cells)
                        {
                            continue;
                        }
                        int next = z * cells + x;
                        if (float.IsInfinity(cost[next]) || closed.Contains(next))
                        {
                            continue;
                        }
                        float step = (dx != 0 && dz != 0 ? 1.4142f : 1) * (cost[cell] + cost[next]) / 2;
                        float tentative = g[cell] + step;
                        if (!g.TryGetValue(next, out float known) || tentative < known)
                        {
                            g[next] = tentative;
                            came[next] = cell;
                            open.Add((tentative + H(next), next));
                        }
                    }
                }
            }
            return null;
        }

        // Chaikin's corner cutting: the line, rounded once.
        static List<Vector2> Chaikin(List<Vector2> points)
        {
            var round = new List<Vector2>(points.Count * 2) { points[0] };
            for (int i = 0; i + 1 < points.Count; i++)
            {
                round.Add(Vector2.Lerp(points[i], points[i + 1], 0.25f));
                round.Add(Vector2.Lerp(points[i], points[i + 1], 0.75f));
            }
            round.Add(points[points.Count - 1]);
            return round;
        }

        // The line, a point every `step` metres along it and at its end.
        static List<Vector2> Resample(List<Vector2> points, float step)
        {
            var even = new List<Vector2> { points[0] };
            float carried = 0;
            for (int i = 0; i + 1 < points.Count; i++)
            {
                Vector2 a = points[i], b = points[i + 1];
                float length = Vector2.Distance(a, b), at = step - carried;
                while (at <= length)
                {
                    even.Add(Vector2.Lerp(a, b, at / length));
                    at += step;
                }
                carried = length - (at - step);
            }
            if (Vector2.Distance(even[even.Count - 1], points[points.Count - 1]) > step * 0.25f)
            {
                even.Add(points[points.Count - 1]);
            }
            return even;
        }

        // A body's bed into the heights, under its banks, and its water onto the texels.
        void Carve(WaterBody body)
        {
            bool line = body.Line.Count > 1;
            bool lava = body.Kind == WaterBody.Lava;
            float half = line ? body.HalfWidth : 0;
            float bank = lava ? LavaBank : body.Kind == WaterBody.Lake ? 8 : RiverBank;
            float edge = lava ? LavaLevel - 0.15f : WaterLevel - 0.1f;
            float floor = lava ? LavaLevel - 0.5f : body.Kind == WaterBody.Lake ? WaterLevel - 3.5f : body.Kind == WaterBody.Pond ? WaterLevel - 1.4f : WaterLevel - RiverDepth;
            byte wet = lava ? WetLava : body.Kind == WaterBody.Lake ? WetStill : WetRiver;
            float reach = (line ? half : body.Radius * 1.2f) + bank + 1;
            float x0 = float.MaxValue, z0 = float.MaxValue, x1 = float.MinValue, z1 = float.MinValue;
            if (line)
            {
                foreach (Vector2 p in body.Line)
                {
                    x0 = Mathf.Min(x0, p.x);
                    z0 = Mathf.Min(z0, p.y);
                    x1 = Mathf.Max(x1, p.x);
                    z1 = Mathf.Max(z1, p.y);
                }
            }
            else
            {
                x0 = x1 = body.Centre.x;
                z0 = z1 = body.Centre.y;
            }
            x0 -= reach;
            z0 -= reach;
            x1 += reach;
            z1 += reach;
            int c0 = Mathf.Max(0, Mathf.FloorToInt((x0 - Grid.Min) / Grid.Texel)), c1 = Mathf.Min(N, Mathf.CeilToInt((x1 - Grid.Min) / Grid.Texel));
            int r0 = Mathf.Max(0, Mathf.FloorToInt((z0 - Grid.Min) / Grid.Texel)), r1 = Mathf.Min(N, Mathf.CeilToInt((z1 - Grid.Min) / Grid.Texel));
            // Line bodies: the segments near each cell, so a point does not test the whole line.
            var segments = line ? new SegmentIndex(body.Line, reach) : null;
            for (int row = r0; row <= r1; row++)
            {
                for (int column = c0; column <= c1; column++)
                {
                    // A height sample at the corner, and the texel whose lower corner it is.
                    float x = Grid.Min + column * Grid.Texel, z = Grid.Min + row * Grid.Texel;
                    float inward = Inward(body, segments, new Vector2(x, z), out Vector2 _);
                    float h = inward >= 0
                        ? Mathf.Lerp(edge, floor, Mathf.SmoothStep(0, 1, inward / (line ? half : Mathf.Max(4, body.Radius * 0.35f))))
                        : Mathf.Lerp(edge, Heights[row * Samples + column], Mathf.SmoothStep(0, 1, -inward / bank));
                    int s = row * Samples + column;
                    Heights[s] = Mathf.Min(Heights[s], h);
                }
            }
            // The water lies on every texel of the bed and the bank that is under its level.
            float level = lava ? LavaLevel : WaterLevel;
            for (int row = r0; row < Mathf.Min(r1, N); row++)
            {
                for (int column = c0; column < Mathf.Min(c1, N); column++)
                {
                    float tx = Grid.X(column), tz = Grid.Z(row);
                    float into = Inward(body, segments, new Vector2(tx, tz), out Vector2 along);
                    int t = row * N + column;
                    if (into >= -bank && HeightAt(tx, tz) < level && (Wet[t] == Dry || wet == WetRiver))
                    {
                        Wet[t] = wet;
                        if (wet == WetRiver && line)
                        {
                            FlowX[t] = along.x;
                            FlowZ[t] = along.y;
                        }
                    }
                }
            }
        }

        // How far a point lies inside a body's water: positive inside, negative outside. For a line
        // body, its half width less the distance to its middle, and the line's way there.
        static float Inward(WaterBody body, SegmentIndex segments, Vector2 point, out Vector2 along)
        {
            along = Vector2.zero;
            if (segments != null)
            {
                float best = float.MaxValue;
                foreach (int i in segments.Near(point))
                {
                    Vector2 a = body.Line[i], b = body.Line[i + 1];
                    float d2 = Raster.SquaredToSegment(point, a, b);
                    if (d2 < best)
                    {
                        best = d2;
                        along = (b - a).normalized;
                    }
                }
                return best == float.MaxValue ? float.MinValue / 2 : body.HalfWidth - Mathf.Sqrt(best);
            }
            return body.ShoreAt(point) - Vector2.Distance(point, body.Centre);
        }

        // A line's segments by the cells of a coarse grid that each one's reach touches.
        sealed class SegmentIndex
        {
            const float Cell = 16;
            readonly Dictionary<long, List<int>> cells = new Dictionary<long, List<int>>();
            static readonly List<int> None = new List<int>();

            public SegmentIndex(List<Vector2> line, float reach)
            {
                for (int i = 0; i + 1 < line.Count; i++)
                {
                    Vector2 a = line[i], b = line[i + 1];
                    int x0 = Mathf.FloorToInt((Mathf.Min(a.x, b.x) - reach) / Cell), x1 = Mathf.FloorToInt((Mathf.Max(a.x, b.x) + reach) / Cell);
                    int z0 = Mathf.FloorToInt((Mathf.Min(a.y, b.y) - reach) / Cell), z1 = Mathf.FloorToInt((Mathf.Max(a.y, b.y) + reach) / Cell);
                    for (int z = z0; z <= z1; z++)
                    {
                        for (int x = x0; x <= x1; x++)
                        {
                            long key = ((long)z << 32) ^ (uint)x;
                            if (!cells.TryGetValue(key, out List<int> list))
                            {
                                cells[key] = list = new List<int>();
                            }
                            list.Add(i);
                        }
                    }
                }
            }

            public List<int> Near(Vector2 point)
            {
                long key = ((long)Mathf.FloorToInt(point.y / Cell) << 32) ^ (uint)Mathf.FloorToInt(point.x / Cell);
                return cells.TryGetValue(key, out List<int> list) ? list : None;
            }
        }

        // Where a river crosses the trail: a ford, its bed raised under the trail to `FordDepth`
        // below the water so that the trail goes through the water and not under it.
        void FordsOf()
        {
            for (int index = 0; index < Water.Count; index++)
            {
                WaterBody river = Water[index];
                if (river.Kind != WaterBody.River)
                {
                    continue;
                }
                int crossing = -1;
                float nearest = float.MaxValue;
                for (int i = 0; i <= river.Line.Count; i++)
                {
                    float onTrail = i < river.Line.Count ? FromTrail[Grid.At(river.Line[i].x, river.Line[i].y)] : float.MaxValue;
                    if (onTrail <= LayoutConstants.PathHalfWidth / 1000f + river.HalfWidth)
                    {
                        if (onTrail < nearest)
                        {
                            nearest = onTrail;
                            crossing = i;
                        }
                    }
                    else if (crossing >= 0)
                    {
                        Vector2 at = river.Line[crossing];
                        Vector2 along = river.Line[Mathf.Min(crossing + 1, river.Line.Count - 1)] - river.Line[Mathf.Max(crossing - 1, 0)];
                        Fords.Add(new Ford { At = at, Along = along.normalized, River = index });
                        crossing = -1;
                        nearest = float.MaxValue;
                    }
                }
            }
            // The ford is wherever the river's bed or banks reach the trail about its crossing: there
            // the trail goes into the water, its bed held at `FordDepth` under the water's level.
            foreach (Ford ford in Fords)
            {
                WaterBody river = Water[ford.River];
                float bankReach = river.HalfWidth + RiverBank + 1;
                var near = new List<int>();
                for (int i = 0; i + 1 < river.Line.Count; i++)
                {
                    if (Vector2.Distance(river.Line[i], ford.At) < 60)
                    {
                        near.Add(i);
                    }
                }
                float box = 60 + bankReach;
                int c0 = Mathf.Max(0, Mathf.FloorToInt((ford.At.x - box - Grid.Min) / Grid.Texel)), c1 = Mathf.Min(N, Mathf.CeilToInt((ford.At.x + box - Grid.Min) / Grid.Texel));
                int r0 = Mathf.Max(0, Mathf.FloorToInt((ford.At.y - box - Grid.Min) / Grid.Texel)), r1 = Mathf.Min(N, Mathf.CeilToInt((ford.At.y + box - Grid.Min) / Grid.Texel));
                float radius = 0;
                for (int row = r0; row <= r1; row++)
                {
                    for (int column = c0; column <= c1; column++)
                    {
                        int texel = Math.Min(row, N - 1) * N + Math.Min(column, N - 1);
                        // The trail and a step of its verge each side.
                        if (FromTrail[texel] > 2.5f)
                        {
                            continue;
                        }
                        var corner = new Vector2(Grid.Min + column * Grid.Texel, Grid.Min + row * Grid.Texel);
                        float nearest = float.MaxValue;
                        foreach (int i in near)
                        {
                            nearest = Mathf.Min(nearest, Raster.SquaredToSegment(corner, river.Line[i], river.Line[i + 1]));
                        }
                        if (nearest > bankReach * bankReach)
                        {
                            continue;
                        }
                        int s = row * Samples + column;
                        Heights[s] = Mathf.Max(Heights[s], WaterLevel - FordDepth);
                        radius = Mathf.Max(radius, Vector2.Distance(corner, ford.At));
                    }
                }
                ford.Radius = radius + Grid.Texel;
            }
        }
    }
}
