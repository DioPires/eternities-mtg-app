using System;
using System.Collections.Generic;
using static Eternities.Layout.LayoutConstants;

namespace Eternities.Layout
{
    // The independent checker of PRD v4 3.2 (invariants 7, 9 and 10) and 5.4.10. It reads an emitted
    // layout and shares nothing with the allocator but the constants of 5.4.1: its geometry is its
    // own, in floating point, and every shape is rebuilt from a stand's emitted position, yaw and
    // path point. Lengths are millimetres. Two shapes that touch do not intersect.
    public static class Checker
    {
        const double Eps = 1e-6;
        const int Listed = 50;

        public sealed class Result
        {
            public readonly List<string> Violations = new List<string>();  // the first fifty
            public int ViolationCount;
            public double MinSpacing = double.PositiveInfinity;
            public int PairsTested;
            public bool Passed => ViolationCount == 0;

            internal void Add(string violation)
            {
                if (ViolationCount++ < Listed)
                {
                    Violations.Add(violation);
                }
            }
        }

        struct V
        {
            public double X, Z;
            public V(double x, double z) { X = x; Z = z; }
            public V(P2 p) { X = p.X; Z = p.Z; }
            public static V operator +(V a, V b) => new V(a.X + b.X, a.Z + b.Z);
            public static V operator -(V a, V b) => new V(a.X - b.X, a.Z - b.Z);
            public static V operator *(V a, double k) => new V(a.X * k, a.Z * k);
            public double Length => Math.Sqrt(X * X + Z * Z);
            public static double Dot(V a, V b) => a.X * b.X + a.Z * b.Z;
        }

        sealed class Stand
        {
            public LayoutStand Source;
            public string Name;
            public V Position, Forward;
            public V[] Footprint, Apron, Corridor, End;
        }

        sealed class Path
        {
            public LayoutPath Source;
            public V[] Quad;    // radial paths and spurs
            public double Inner, Outer;
        }

        public static Result Check(WorldLayout layout)
        {
            var result = new Result();
            LayoutInput input = layout.Input;
            string SiteName(LayoutSite site) => $"{input.SetCodes[site.Set]}/{ColourClasses.SeedNames[(int)site.Class]}";

            // The path network.
            var paths = new List<Path>();
            foreach (LayoutPath source in layout.Paths)
            {
                var path = new Path { Source = source, Inner = source.Inner, Outer = source.Outer };
                if (source.Kind == PathKind.Radial)
                {
                    path.Quad = Rect(default, Direction(source.Angle), source.Inner, source.Outer, PathWidth / 2.0);
                }
                else if (source.Kind == PathKind.Spur)
                {
                    path.Quad = Array.ConvertAll(source.Quad, p => new V(p));
                }
                if (source.Id != paths.Count)
                {
                    result.Add($"path {paths.Count} carries the id {source.Id}");
                }
                paths.Add(path);
            }

            // What does not depend on a stand comes first, so that one moved path is reported as a
            // path and not only as the fifty corridors that no longer reach it.
            Structure(layout, result, SiteName);
            Network(layout, paths, result);
            Pads(layout, paths, result);
            Volumes(layout, paths, result);

            // Invariant 7: one stand a card, in the site of its set and its class.
            var standOfCard = new int[input.Cards.Length];
            var standsOfSite = new int[layout.Sites.Count];
            var stands = new List<Stand>();
            foreach (LayoutStand source in layout.Stands)
            {
                LayoutCard card = input.Cards[source.Card];
                LayoutSite site = layout.Sites[source.Site];
                string name = $"stand {card.OracleId} ({SiteName(site)})";
                standOfCard[source.Card]++;
                standsOfSite[source.Site]++;
                if (card.Set != site.Set || card.Class != site.Class)
                {
                    result.Add($"{name} stands in a site that is not its set and class");
                }
                var position = new V(source.Position);
                double radius = position.Length;
                if (radius < site.Inner - Eps || radius > site.Outer + Eps || !InArc(position, site.AngleFrom, site.AngleSpan))
                {
                    result.Add($"{name} stands outside its site's region");
                }
                V offset = position - new V(source.Lattice);
                if (offset.Length > Jitter + Eps || source.Lattice.Z % RowPitch != 0
                    || (source.Lattice.X - (((source.Lattice.Z / RowPitch) & 1) == 0 ? 0 : Pitch / 2)) % Pitch != 0)
                {
                    result.Add($"{name} is not within the jitter radius of a lattice point");
                }

                V forward = Direction(source.Yaw);
                V toPath = new V(source.PathPoint) - position;
                double length = V.Dot(toPath, forward);
                if (Math.Abs(toPath.X * forward.Z - toPath.Z * forward.X) > 1.5 || length < FootprintHalfDepth + ApronDepth)
                {
                    result.Add($"{name} does not face its corridor's path point");
                }
                double front = FootprintHalfDepth + ApronDepth;
                stands.Add(new Stand
                {
                    Source = source, Name = name, Position = position, Forward = forward,
                    Footprint = Rect(position, forward, -FootprintHalfDepth, FootprintHalfDepth, FootprintHalfWidth),
                    Apron = Rect(position, forward, FootprintHalfDepth, front, ApronHalfWidth),
                    Corridor = Rect(position, forward, front, length, CorridorHalfWidth),
                    End = Rect(position, forward, length - 1, length, CorridorHalfWidth),
                });
            }
            for (int card = 0; card < standOfCard.Length; card++)
            {
                if (standOfCard[card] != 1)
                {
                    result.Add($"card {input.Cards[card].OracleId} has {standOfCard[card]} stands");
                }
            }
            for (int site = 0; site < standsOfSite.Length; site++)
            {
                if (standsOfSite[site] != layout.Sites[site].Stands)
                {
                    result.Add($"site {SiteName(layout.Sites[site])} holds {standsOfSite[site]} stands and lists {layout.Sites[site].Stands}");
                }
            }

            // Invariant 9, a stand against what does not move: the plaza, the paths, the pads and the
            // hero volumes. Its corridor against the plaza and the volumes, and its end on a path.
            foreach (Stand stand in stands)
            {
                double radius = stand.Position.Length;
                foreach (V[] shape in new[] { stand.Footprint, stand.Apron })
                {
                    string part = shape == stand.Footprint ? "footprint" : "apron";
                    if (MeetsDisc(shape, default, layout.PlazaRadius))
                    {
                        result.Add($"the {part} of {stand.Name} is on the plaza");
                    }
                    foreach (Path path in paths)
                    {
                        bool meets = path.Source.Kind == PathKind.Ring
                            ? radius + 3000 > path.Inner && radius - 3000 < path.Outer && MeetsAnnulus(shape, path.Inner, path.Outer)
                            : Meet(shape, path.Quad);
                        if (meets)
                        {
                            result.Add($"the {part} of {stand.Name} is on path {path.Source.Id}");
                        }
                    }
                    foreach (LayoutPad pad in layout.Pads)
                    {
                        if (MeetsDisc(shape, new V(pad.Centre), pad.Radius))
                        {
                            result.Add($"the {part} of {stand.Name} is on the pad at {pad.Centre}");
                        }
                    }
                    foreach (HeroVolume volume in input.HeroVolumes)
                    {
                        if (MeetsVolume(shape, volume))
                        {
                            result.Add($"the {part} of {stand.Name} is in hero volume {volume.Id}");
                        }
                    }
                }
                if (MeetsDisc(stand.Corridor, default, layout.PlazaRadius))
                {
                    result.Add($"the corridor of {stand.Name} crosses the plaza");
                }
                foreach (HeroVolume volume in input.HeroVolumes)
                {
                    if (MeetsVolume(stand.Corridor, volume))
                    {
                        result.Add($"the corridor of {stand.Name} crosses hero volume {volume.Id}");
                    }
                }
                Path reached = stand.Source.Path >= 0 && stand.Source.Path < paths.Count ? paths[stand.Source.Path] : null;
                if (reached == null || !(reached.Source.Kind == PathKind.Ring ? MeetsAnnulus(stand.End, reached.Inner, reached.Outer) : Meet(stand.End, reached.Quad)))
                {
                    result.Add($"the corridor of {stand.Name} does not end on its path");
                }
                if (radius > layout.WorldRadius + Eps)
                {
                    result.Add($"{stand.Name} stands outside the world");
                }
            }

            Spacing(stands, result);
            Pairs(stands, result);
            return result;
        }

        // What 5.4 fixes about the wedges, the bands, the ring and the sites' regions.
        static void Structure(WorldLayout layout, Result result, Func<LayoutSite, string> siteName)
        {
            LayoutInput input = layout.Input;
            long turn = 0;
            int wedges = 0;
            for (int c = 0; c < ColourClasses.WedgeCount; c++)
            {
                if (layout.WedgeSpan[c] > 0)
                {
                    if (layout.WedgeFrom[c] != turn)
                    {
                        result.Add($"wedge {ColourClasses.SeedNames[c]} does not start where the one before it ends");
                    }
                    turn += layout.WedgeSpan[c];
                    wedges++;
                }
            }
            if (wedges > 0 && turn != Fixed.FullTurn)
            {
                result.Add($"the wedges sum to {turn} micro-degrees");
            }
            for (int c = 0; c < ColourClasses.WedgeCount && wedges > 1; c++)
            {
                long lo = Math.Min(30_000_000, Fixed.FullTurn / wedges), hi = Math.Max(120_000_000, Fixed.FullTurn / wedges);
                if (layout.WedgeSpan[c] > 0 && (layout.WedgeSpan[c] < lo || layout.WedgeSpan[c] > hi))
                {
                    result.Add($"wedge {ColourClasses.SeedNames[c]} is outside its angle bounds");
                }
            }
            // The plaza is sized from the pass before (5.4.11), so only its floor is a condition.
            if (layout.PlazaRadius < MinPlaza)
            {
                result.Add("the plaza is under 12 m in radius");
            }

            // Time is the radius: the bands run outward in release order with a path between them.
            long edge = layout.PlazaRadius + PathWidth;
            for (int k = 0; k < layout.Bands.Count; k++)
            {
                LayoutBand band = layout.Bands[k];
                if (band.Set != k || band.Inner != edge || (band.Width != 0 && band.Width < MinBand))
                {
                    result.Add($"band {input.SetCodes[k]} is out of order, off its inner path or under 6 m wide");
                }
                edge += band.Width == 0 ? 0 : band.Width + PathWidth;
            }
            if (layout.RingWidth > 0 && (layout.RingInner < edge || layout.RingWidth < MinRing))
            {
                result.Add("the ring begins inside the last band or is under 6 m wide");
            }
            long world = layout.RingWidth > 0 ? layout.RingInner + layout.RingWidth : edge;
            if (layout.WorldRadius != world)
            {
                result.Add($"the world radius is {layout.WorldRadius} and its outermost band or ring ends at {world}");
            }

            var seen = new HashSet<(int, ColourClass)>();
            long arc = 0;
            int lastArcSet = -1;
            foreach (LayoutSite site in layout.Sites)
            {
                if (!seen.Add((site.Set, site.Class)))
                {
                    result.Add($"site {siteName(site)} is listed twice");
                }
                if (site.Class == ColourClass.Colourless)
                {
                    if (site.Inner != layout.RingInner || site.Outer != layout.RingInner + layout.RingWidth || site.AngleFrom != arc || site.Set <= lastArcSet)
                    {
                        result.Add($"ring site {siteName(site)} is off the ring or out of release order");
                    }
                    double mid = layout.RingInner + layout.RingWidth / 2.0;
                    if (site.AngleSpan / 360e6 * 2 * Math.PI * mid < MinArc - 1)
                    {
                        result.Add($"ring site {siteName(site)} has an arc under 6 m at the ring's mid radius");
                    }
                    arc += site.AngleSpan;
                    lastArcSet = site.Set;
                }
                else
                {
                    LayoutBand band = layout.Bands[site.Set];
                    if (site.Inner != band.Inner || site.Outer != band.Inner + band.Width
                        || site.AngleFrom != layout.WedgeFrom[(int)site.Class] || site.AngleSpan != layout.WedgeSpan[(int)site.Class])
                    {
                        result.Add($"site {siteName(site)} is not its wedge crossed with its band");
                    }
                }
            }
            if (lastArcSet >= 0 && arc != Fixed.FullTurn)
            {
                result.Add($"the ring's arcs sum to {arc} micro-degrees");
            }
            var needed = new HashSet<(int, ColourClass)>();
            foreach (LayoutCard card in input.Cards)
            {
                needed.Add((card.Set, card.Class));
            }
            if (!needed.SetEquals(seen))
            {
                result.Add($"the layout has {seen.Count} sites and the cards need {needed.Count}");
            }
        }

        // Invariant 9: no two stands closer than 2.5 m.
        static void Spacing(List<Stand> stands, Result result)
        {
            const double cell = 4000;
            var grid = new Dictionary<(long, long), List<int>>();
            for (int i = 0; i < stands.Count; i++)
            {
                var key = ((long)Math.Floor(stands[i].Position.X / cell), (long)Math.Floor(stands[i].Position.Z / cell));
                for (long dx = -1; dx <= 1; dx++)
                {
                    for (long dz = -1; dz <= 1; dz++)
                    {
                        if (!grid.TryGetValue((key.Item1 + dx, key.Item2 + dz), out List<int> near))
                        {
                            continue;
                        }
                        foreach (int j in near)
                        {
                            double distance = (stands[i].Position - stands[j].Position).Length;
                            result.MinSpacing = Math.Min(result.MinSpacing, distance);
                            if (distance < MinSpacing - Eps)
                            {
                                result.Add($"{stands[j].Name} and {stands[i].Name} are {distance / 1000:F3} m apart");
                            }
                        }
                    }
                }
                if (!grid.TryGetValue(key, out List<int> own))
                {
                    grid[key] = own = new List<int>();
                }
                own.Add(i);
            }
        }

        // Invariant 9, stand against stand: a footprint or an apron meets no footprint, apron or
        // corridor of another stand. Corridors may cross each other.
        static void Pairs(List<Stand> stands, Result result)
        {
            const double cell = 8000;
            var grid = new Dictionary<(long, long), List<int>>();
            var tested = new HashSet<long>();
            for (int i = 0; i < stands.Count; i++)
            {
                double minX = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxZ = double.MinValue;
                foreach (V[] shape in new[] { stands[i].Footprint, stands[i].Apron, stands[i].Corridor })
                {
                    foreach (V p in shape)
                    {
                        minX = Math.Min(minX, p.X);
                        maxX = Math.Max(maxX, p.X);
                        minZ = Math.Min(minZ, p.Z);
                        maxZ = Math.Max(maxZ, p.Z);
                    }
                }
                for (long cx = (long)Math.Floor(minX / cell); cx <= (long)Math.Floor(maxX / cell); cx++)
                {
                    for (long cz = (long)Math.Floor(minZ / cell); cz <= (long)Math.Floor(maxZ / cell); cz++)
                    {
                        if (!grid.TryGetValue((cx, cz), out List<int> list))
                        {
                            grid[(cx, cz)] = list = new List<int>();
                        }
                        foreach (int j in list)
                        {
                            if (tested.Add((long)j * stands.Count + i))
                            {
                                result.PairsTested++;
                                Pair(stands[j], stands[i], result);
                            }
                        }
                        list.Add(i);
                    }
                }
            }
        }

        static void Pair(Stand a, Stand b, Result result)
        {
            if (Meet(a.Footprint, b.Footprint) || Meet(a.Footprint, b.Apron) || Meet(a.Apron, b.Footprint) || Meet(a.Apron, b.Apron))
            {
                result.Add($"{a.Name} and {b.Name} stand on each other's footprint or apron");
            }
            if (Meet(a.Corridor, b.Footprint) || Meet(a.Corridor, b.Apron))
            {
                result.Add($"the corridor of {a.Name} crosses {b.Name}");
            }
            if (Meet(b.Corridor, a.Footprint) || Meet(b.Corridor, a.Apron))
            {
                result.Add($"the corridor of {b.Name} crosses {a.Name}");
            }
        }

        // Invariant 9 for pads: on the network or in the plaza, and clear of volumes and each other.
        static void Pads(WorldLayout layout, List<Path> paths, Result result)
        {
            for (int i = 0; i < layout.Pads.Count; i++)
            {
                LayoutPad pad = layout.Pads[i];
                var centre = new V(pad.Centre);
                string name = $"the {pad.Kind.ToString().ToLowerInvariant()} pad at {pad.Centre}";
                if (pad.Radius != PadRadius)
                {
                    result.Add($"{name} is not a 3 m disc");
                }
                switch (pad.Kind)
                {
                    case PadKind.Return:
                        if (centre.Length + pad.Radius > layout.PlazaRadius + Eps)
                        {
                            result.Add($"{name} is not inside the plaza");
                        }
                        break;
                    case PadKind.Waystone:
                    {
                        // At a junction: its centre on a ring path and on a radial path.
                        bool ring = false, radial = false;
                        foreach (Path path in paths)
                        {
                            ring |= path.Source.Kind == PathKind.Ring && centre.Length > path.Inner && centre.Length < path.Outer;
                            radial |= path.Source.Kind == PathKind.Radial && Inside(path.Quad, centre);
                        }
                        if (!ring || !radial)
                        {
                            result.Add($"{name} is not where a radial path crosses a ring path");
                        }
                        break;
                    }
                    default:
                    {
                        bool touches = false;
                        foreach (Path path in paths)
                        {
                            touches |= path.Source.Kind == PathKind.Ring
                                ? centre.Length + pad.Radius > path.Inner && centre.Length - pad.Radius < path.Outer
                                : Distance(path.Quad, centre) < pad.Radius;
                        }
                        if (!touches)
                        {
                            result.Add($"{name} does not touch the path network");
                        }
                        if (pad.Site < 0 || pad.Site >= layout.Sites.Count || !layout.Sites[pad.Site].Centre.Equals(pad.Centre))
                        {
                            result.Add($"{name} is not at its site's centre");
                        }
                        break;
                    }
                }
                for (int j = 0; j < i; j++)
                {
                    if ((centre - new V(layout.Pads[j].Centre)).Length < pad.Radius + layout.Pads[j].Radius - Eps)
                    {
                        result.Add($"{name} overlaps the pad at {layout.Pads[j].Centre}");
                    }
                }
                foreach (HeroVolume volume in layout.Input.HeroVolumes)
                {
                    if (VolumeNear(volume, centre, pad.Radius))
                    {
                        result.Add($"{name} is in hero volume {volume.Id}");
                    }
                }
            }
            int sitePads = 0;
            foreach (LayoutPad pad in layout.Pads)
            {
                sitePads += pad.Kind == PadKind.Site ? 1 : 0;
            }
            if (sitePads != layout.Sites.Count)
            {
                result.Add($"{layout.Sites.Count} sites have {sitePads} pads");
            }
        }

        // Invariant 9 for hero volumes: off the arrival point, the return pad and every path.
        static void Volumes(WorldLayout layout, List<Path> paths, Result result)
        {
            foreach (HeroVolume volume in layout.Input.HeroVolumes)
            {
                if (VolumeNear(volume, new V(layout.Arrival), 0))
                {
                    result.Add($"hero volume {volume.Id} covers the arrival point");
                }
                foreach (LayoutPad pad in layout.Pads)
                {
                    if (pad.Kind == PadKind.Return && VolumeNear(volume, new V(pad.Centre), pad.Radius))
                    {
                        result.Add($"hero volume {volume.Id} covers the return pad");
                    }
                }
                foreach (Path path in paths)
                {
                    bool covers;
                    if (path.Source.Kind == PathKind.Ring)
                    {
                        covers = volume.Radius > 0
                            ? new V(volume.Centre).Length + volume.Radius > path.Inner && new V(volume.Centre).Length - volume.Radius < path.Outer
                            : MeetsAnnulus(Array.ConvertAll(volume.Box, p => new V(p)), path.Inner, path.Outer);
                    }
                    else
                    {
                        covers = MeetsVolume(path.Quad, volume);
                    }
                    if (covers)
                    {
                        result.Add($"hero volume {volume.Id} covers path {path.Source.Id}");
                    }
                }
            }
        }

        // Invariant 10: the path network is one piece. A stand's corridor and a site's pad were
        // checked against it above.
        static void Network(WorldLayout layout, List<Path> paths, Result result)
        {
            if (paths.Count == 0)
            {
                result.Add("the world has no path");
                return;
            }
            var parent = new int[paths.Count];
            for (int i = 0; i < parent.Length; i++)
            {
                parent[i] = i;
            }
            int Find(int i)
            {
                while (parent[i] != i)
                {
                    i = parent[i] = parent[parent[i]];
                }
                return i;
            }
            for (int i = 0; i < paths.Count; i++)
            {
                for (int j = 0; j < i; j++)
                {
                    if (Joined(paths[i], paths[j]))
                    {
                        parent[Find(i)] = Find(j);
                    }
                }
            }
            for (int i = 1; i < paths.Count; i++)
            {
                if (Find(i) != Find(0))
                {
                    result.Add($"path {paths[i].Source.Id} is not joined to path {paths[0].Source.Id}");
                }
            }
        }

        static bool Joined(Path a, Path b)
        {
            if (a.Source.Kind == PathKind.Ring && b.Source.Kind == PathKind.Ring)
            {
                return a.Inner < b.Outer && b.Inner < a.Outer;
            }
            if (b.Source.Kind == PathKind.Ring)
            {
                (a, b) = (b, a);
            }
            if (a.Source.Kind == PathKind.Ring)
            {
                return b.Source.Kind == PathKind.Radial ? b.Inner < a.Outer && b.Outer > a.Inner : MeetsAnnulus(b.Quad, a.Inner, a.Outer);
            }
            return Meet(a.Quad, b.Quad);
        }

        // Geometry.

        static V Direction(long microDegrees)
        {
            double radians = microDegrees / 1e6 * Math.PI / 180;
            return new V(Math.Sin(radians), Math.Cos(radians));
        }

        // The rectangle from `from` to `to` along `forward` and `half` to each side of it.
        static V[] Rect(V origin, V forward, double from, double to, double half)
        {
            var right = new V(forward.Z, -forward.X);
            return new[]
            {
                origin + forward * from - right * half, origin + forward * from + right * half,
                origin + forward * to + right * half, origin + forward * to - right * half,
            };
        }

        static bool InArc(V p, long from, long span)
        {
            if (span >= Fixed.FullTurn)
            {
                return true;
            }
            double angle = Math.Atan2(p.X, p.Z) * 180e6 / Math.PI;
            double past = ((angle - from) % 360e6 + 360e6) % 360e6;
            return past <= span + 1 || past >= 360e6 - 1;
        }

        // Two convex polygons, by separating axes. An overlap of nothing is not an intersection.
        static bool Meet(V[] a, V[] b)
        {
            return !Separated(a, b) && !Separated(b, a);
        }

        static bool Separated(V[] edges, V[] other)
        {
            for (int i = 0; i < edges.Length; i++)
            {
                V edge = edges[(i + 1) % edges.Length] - edges[i];
                double length = edge.Length;
                if (length == 0)
                {
                    continue;
                }
                var axis = new V(edge.Z / length, -edge.X / length);
                double min1 = double.MaxValue, max1 = double.MinValue, min2 = double.MaxValue, max2 = double.MinValue;
                foreach (V p in edges)
                {
                    double d = V.Dot(p, axis);
                    min1 = Math.Min(min1, d);
                    max1 = Math.Max(max1, d);
                }
                foreach (V p in other)
                {
                    double d = V.Dot(p, axis);
                    min2 = Math.Min(min2, d);
                    max2 = Math.Max(max2, d);
                }
                if (max1 <= min2 + Eps || max2 <= min1 + Eps)
                {
                    return true;
                }
            }
            return false;
        }

        static bool Inside(V[] convex, V p)
        {
            bool positive = false, negative = false;
            for (int i = 0; i < convex.Length; i++)
            {
                V a = convex[i], b = convex[(i + 1) % convex.Length];
                double side = (b.X - a.X) * (p.Z - a.Z) - (b.Z - a.Z) * (p.X - a.X);
                positive |= side > 0;
                negative |= side < 0;
            }
            return !(positive && negative);
        }

        // From a point to a convex polygon: zero inside it.
        static double Distance(V[] convex, V p)
        {
            if (Inside(convex, p))
            {
                return 0;
            }
            double best = double.MaxValue;
            for (int i = 0; i < convex.Length; i++)
            {
                V a = convex[i], ab = convex[(i + 1) % convex.Length] - a;
                double length2 = V.Dot(ab, ab);
                double t = length2 == 0 ? 0 : Math.Max(0, Math.Min(1, V.Dot(p - a, ab) / length2));
                best = Math.Min(best, (a + ab * t - p).Length);
            }
            return best;
        }

        static bool MeetsDisc(V[] convex, V centre, double radius) => Distance(convex, centre) < radius - Eps;

        static bool MeetsAnnulus(V[] convex, double inner, double outer)
        {
            double farthest = 0;
            foreach (V p in convex)
            {
                farthest = Math.Max(farthest, p.Length);
            }
            return farthest > inner + Eps && MeetsDisc(convex, default, outer);
        }

        static bool MeetsVolume(V[] convex, HeroVolume volume)
        {
            return volume.Radius > 0 ? MeetsDisc(convex, new V(volume.Centre), volume.Radius) : Meet(convex, Array.ConvertAll(volume.Box, p => new V(p)));
        }

        static bool VolumeNear(HeroVolume volume, V point, double radius)
        {
            return volume.Radius > 0
                ? (new V(volume.Centre) - point).Length < volume.Radius + radius - Eps
                : Distance(Array.ConvertAll(volume.Box, p => new V(p)), point) < radius - Eps || (radius == 0 && Inside(Array.ConvertAll(volume.Box, p => new V(p)), point));
        }
    }
}
