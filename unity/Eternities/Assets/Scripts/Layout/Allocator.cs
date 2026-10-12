using System;
using System.Collections.Generic;
using System.Numerics;
using static Eternities.Layout.LayoutConstants;

namespace Eternities.Layout
{
    // The world layout allocator of PRD v4 5.4, for one plane: colour is the wedge, time is the
    // radius, each set is a site. Everything is integer arithmetic on millimetres and micro-degrees
    // (Fixed, Shapes), and the only random draws are a site's candidate shuffle and its jitter.
    //
    // Where 5.4 leaves a choice open, the choice made here is marked "Reading:" at the place it is
    // made, because the pipeline's implementation has to make the same one.
    public sealed class Allocator
    {
        // Radial paths are tested as strips this long; no world comes near it.
        const long Far = 2_000_000;
        const long Cell = 8000;
        // Every shape a candidate is tested with is grown by this much on every side (5.4.9).
        const long Inflate = Jitter + Slack;
        // No point of a footprint or an apron, grown, is farther than this from its stand.
        const long Near = 3000;

        readonly LayoutInput input;
        readonly int sets;
        readonly int[,] counts;                 // [set, class]
        readonly List<int>[,] cards;            // [set, class] -> card indices, sorted by oracle id
        readonly long[] wedgeFrom = new long[ColourClasses.WedgeCount];
        readonly long[] wedgeSpan = new long[ColourClasses.WedgeCount];
        readonly List<long> boundaries = new List<long>();      // radial path angles, clockwise
        readonly List<P2> boundaryDirs = new List<P2>();

        // One pass's state. Everything a band adds is appended, so a widening undoes it by length.
        long plaza;
        P2[][] strips;
        readonly List<LayoutPath> ringPaths = new List<LayoutPath>();
        readonly List<int> ringPathPads = new List<int>();      // where each ring path's waystone pads start
        readonly List<LayoutPath> spurs = new List<LayoutPath>();
        readonly List<LayoutPad> pads = new List<LayoutPad>();
        readonly List<LayoutSite> sites = new List<LayoutSite>();
        readonly List<Placed> placed = new List<Placed>();
        readonly List<LayoutBand> bands = new List<LayoutBand>();
        readonly Dictionary<long, List<int>> standCells = new Dictionary<long, List<int>>();
        readonly List<long> standJournal = new List<long>();
        long ringInner, ringWidth;
        int ringWidenings;
        // The band or the ring being settled: the pads and the spurs its stands can reach start here.
        int groupPads, groupSpurs;

        // An accepted stand, with the shapes later candidates are tested against. The shapes are the
        // ones before the jitter, inflated by the jitter radius.
        sealed class Placed
        {
            public int Site;
            public P2 Lattice, Forward, PathPoint, Final;
            public long Length;
            public int PathKind, PathIndex;
            public P2[] Footprint, Apron, Corridor;
            public int Card;
        }

        sealed class Region
        {
            public int Set;
            public ColourClass Class;
            public long Inner, Outer;
            public long From, Span;
            public P2 FromDir, EndDir;
            public int InnerPath, OuterPath;    // indices into ringPaths; -1: none
            public LayoutSite Site;
            public List<P2> Lattice;
        }

        Allocator(LayoutInput input)
        {
            this.input = input;
            sets = input.SetCodes.Length;
            counts = new int[sets, 7];
            cards = new List<int>[sets, 7];
            for (int i = 0; i < input.Cards.Length; i++)
            {
                LayoutCard card = input.Cards[i];
                counts[card.Set, (int)card.Class]++;
                (cards[card.Set, (int)card.Class] ??= new List<int>()).Add(i);
            }
            foreach (List<int> list in cards)
            {
                list?.Sort((a, b) => string.CompareOrdinal(Canonical(input.Cards[a].OracleId), Canonical(input.Cards[b].OracleId)));
            }
        }

        // Sorting by the id's bytes is sorting by its lower-case hexadecimal text.
        static string Canonical(string oracleId) => oracleId.Replace("-", "").ToLowerInvariant();

        public static WorldLayout Run(LayoutInput input)
        {
            var allocator = new Allocator(input);
            allocator.Wedges();

            // 5.4.3 and 5.4.11: start from the area estimate, then feed each pass's radius to the
            // next until it moves by a tenth of a metre or less, at most twenty passes.
            long radius = (long)Fixed.ISqrt(AreaPerStand * (BigInteger)input.Cards.Length * Fixed.PiDen / Fixed.PiNum) + MinPlaza;
            int passes = 0;
            long result;
            do
            {
                passes++;
                result = allocator.Pass(radius);
                bool settled = Math.Abs(result - radius) <= PassTolerance;
                radius = result;
                if (settled)
                {
                    break;
                }
            }
            while (passes < MaxPasses);
            return allocator.Emit(result, passes);
        }

        // 5.4.4. With n wedge classes present, the angles are clamp(lambda x count, lo, hi) for the
        // largest lambda whose sum does not pass the full turn.
        void Wedges()
        {
            var present = new List<int>();
            var classCounts = new List<long>();
            for (int c = 0; c < ColourClasses.WedgeCount; c++)
            {
                long total = 0;
                for (int k = 0; k < sets; k++)
                {
                    total += counts[k, c];
                }
                if (total > 0)
                {
                    present.Add(c);
                    classCounts.Add(total);
                }
            }
            int n = present.Count;
            if (n == 0)
            {
                return;
            }
            long[] angles = n == 1
                ? new[] { Fixed.FullTurn }
                : Proportional(classCounts.ToArray(), Math.Min(30_000_000, Fixed.FullTurn / n), Math.Max(120_000_000, Fixed.FullTurn / n));
            long from = 0;
            for (int i = 0; i < n; i++)
            {
                wedgeFrom[present[i]] = from;
                wedgeSpan[present[i]] = angles[i];
                // Reading: a single wedge of a full turn still has one boundary, at north, and so
                // one radial path. Without it nothing would join the ring paths (invariant 10).
                boundaries.Add(from);
                boundaryDirs.Add(Fixed.Direction(from));
                from += angles[i];
            }
        }

        // The solver of 5.4.4, also used for the ring's arcs (5.4.7). Lambda is a fixed-point number
        // of micro-degrees per card with 32 fractional bits; its largest value sends one card to hi.
        public static long[] Proportional(long[] counts, long lo, long hi)
        {
            int n = counts.Length;
            BigInteger one = BigInteger.One << 32;
            BigInteger low = 0, high = hi * one, full = Fixed.FullTurn * one;
            BigInteger[] Clamped(BigInteger lambda)
            {
                var values = new BigInteger[n];
                for (int i = 0; i < n; i++)
                {
                    values[i] = BigInteger.Min(BigInteger.Max(lambda * counts[i], lo * one), hi * one);
                }
                return values;
            }
            BigInteger Sum(BigInteger[] values)
            {
                BigInteger sum = 0;
                foreach (BigInteger v in values)
                {
                    sum += v;
                }
                return sum;
            }
            for (int step = 0; step < 64; step++)
            {
                BigInteger middle = (low + high + 1) >> 1;
                if (Sum(Clamped(middle)) <= full)
                {
                    low = middle;
                }
                else
                {
                    high = middle - 1;
                }
            }

            BigInteger[] exact = Clamped(low);
            var angles = new long[n];
            var fractions = new BigInteger[n];
            long given = 0;
            for (int i = 0; i < n; i++)
            {
                angles[i] = (long)(exact[i] >> 32);
                fractions[i] = exact[i] & (one - 1);
                given += angles[i];
            }
            // The shortfall, a micro-degree at a time, to the classes below hi in descending order of
            // the fraction they lost, ties by class order.
            var order = new List<int>();
            for (int i = 0; i < n; i++)
            {
                if (angles[i] < hi)
                {
                    order.Add(i);
                }
            }
            order.Sort((a, b) => fractions[a] != fractions[b] ? fractions[b].CompareTo(fractions[a]) : a.CompareTo(b));
            for (int next = 0; given < Fixed.FullTurn; next++)
            {
                if (order.Count == 0)
                {
                    throw new LayoutException("the angles cannot reach a full turn: every class is at its upper bound");
                }
                int i = order[next % order.Count];
                if (angles[i] < hi)
                {
                    angles[i]++;
                    given++;
                }
            }
            return angles;
        }

        // One pass of 5.4.5 to 5.4.10 with the plaza sized from `radius`. Returns the world radius.
        long Pass(long radius)
        {
            ringPaths.Clear();
            ringPathPads.Clear();
            pendingWidenings.Clear();
            spurs.Clear();
            pads.Clear();
            sites.Clear();
            placed.Clear();
            bands.Clear();
            standCells.Clear();
            standJournal.Clear();
            ringInner = ringWidth = 0;
            ringWidenings = 0;

            // 5.4.5.
            plaza = Math.Max(MinPlaza, radius / 20);
            strips = new P2[boundaries.Count][];
            for (int b = 0; b < boundaries.Count; b++)
            {
                strips[b] = Shapes.Rect(default, boundaryDirs[b], Fixed.Unit, plaza, Far, PathWidth / 2);
            }
            // Reading: the return portal stands 8 m south of the centre and its pad is the 3 m disc
            // in front of it, on the side of the centre.
            pads.Add(new LayoutPad { Kind = PadKind.Return, Centre = new P2(0, -ReturnPortalSouth + PadRadius), Radius = PadRadius });
            foreach (HeroVolume volume in input.HeroVolumes)
            {
                if (Covers(volume, default, 0) || Covers(volume, pads[0].Centre, PadRadius))
                {
                    throw new LayoutException($"hero volume {volume.Id} covers the arrival point or the return pad");
                }
            }
            AddRingPath(plaza);
            long r = plaza + PathWidth;

            // 5.4.6, 5.4.8 to 5.4.10, band by band. A band's sites depend on nothing outside it, so
            // "recompute this band and every band outside it" is: settle this band, then go on.
            for (int k = 0; k < sets; k++)
            {
                long width = BandWidth(k, r);
                var band = new LayoutBand { Set = k, Inner = r, Width = width };
                bands.Add(band);
                if (width == 0)
                {
                    continue;
                }
                while (true)
                {
                    Mark mark = Marked();
                    AddRingPath(r + band.Width);
                    var regions = new List<Region>();
                    for (int c = 0; c < ColourClasses.WedgeCount; c++)
                    {
                        if (counts[k, c] > 0)
                        {
                            regions.Add(new Region
                            {
                                Set = k, Class = (ColourClass)c, Inner = r, Outer = r + band.Width,
                                From = wedgeFrom[c], Span = wedgeSpan[c],
                                InnerPath = ringPaths.Count - 2, OuterPath = ringPaths.Count - 1,
                            });
                        }
                    }
                    LayoutSite failed = Settle(regions, mark);
                    if (failed == null)
                    {
                        break;
                    }
                    Widen(mark, failed, ref band.Widenings);
                    band.Width += band.Width / 10;
                }
                r += band.Width + PathWidth;
            }

            // 5.4.7. The ring's arcs run clockwise from north in release order.
            var arcSets = new List<int>();
            var arcCounts = new List<long>();
            long colourless = 0;
            for (int k = 0; k < sets; k++)
            {
                if (counts[k, (int)ColourClass.Colourless] > 0)
                {
                    arcSets.Add(k);
                    arcCounts.Add(counts[k, (int)ColourClass.Colourless]);
                    colourless += counts[k, (int)ColourClass.Colourless];
                }
            }
            if (colourless == 0)
            {
                CheckVolumesAgainstPaths(r);
                return r;
            }
            ringWidth = Math.Max(MinRing, SmallestWidth(r, w => Fixed.PiNum * Annulus(r, w) >= AreaPerStand * (BigInteger)colourless * Fixed.PiDen));
            while (true)
            {
                Mark mark = Marked();
                // The least arc is 6 m at the ring's mid radius. If the arcs do not fit at r, the
                // ring moves out to the smallest radius where they do, and gets a path of its own
                // at its inner edge; the ground between is the kit's.
                long LeastArc(long inner) => Fixed.CeilDiv(Fixed.FullTurn * (BigInteger)MinArc * Fixed.PiDen, 2 * Fixed.PiNum * (inner + ringWidth / 2));
                ringInner = r;
                if (arcSets.Count * LeastArc(r) > Fixed.FullTurn)
                {
                    if (boundaries.Count == 0)
                    {
                        // 5.4 leaves this case open: with no wedge there is no radial path, so the
                        // path at a ring that begins away from the plaza would join nothing
                        // (invariant 10). No plane of the roster is colourless with this many sets.
                        throw new LayoutException(
                            $"{input.PlaneSlug} has no wedge and {arcSets.Count} arcs, which do not fit around the plaza: " +
                            "PRD v4 5.4 names no path that would join the ring to the plaza");
                    }
                    long low = r + PathWidth, high = Far;
                    while (low < high)
                    {
                        long middle = (low + high) / 2;
                        if (arcSets.Count * LeastArc(middle) <= Fixed.FullTurn)
                        {
                            high = middle;
                        }
                        else
                        {
                            low = middle + 1;
                        }
                    }
                    ringInner = low;
                    AddRingPath(ringInner - PathWidth);
                }
                long[] arcs = Proportional(arcCounts.ToArray(), LeastArc(ringInner), Fixed.FullTurn);
                var regions = new List<Region>();
                long from = 0;
                for (int a = 0; a < arcSets.Count; a++)
                {
                    regions.Add(new Region
                    {
                        Set = arcSets[a], Class = ColourClass.Colourless,
                        Inner = ringInner, Outer = ringInner + ringWidth, From = from, Span = arcs[a],
                        InnerPath = ringPaths.Count - 1, OuterPath = -1,
                    });
                    from += arcs[a];
                }
                LayoutSite failed = Settle(regions, mark);
                if (failed == null)
                {
                    break;
                }
                Widen(mark, failed, ref ringWidenings);
                ringWidth += ringWidth / 10;
            }
            CheckVolumesAgainstPaths(ringInner + ringWidth);
            return ringInner + ringWidth;
        }

        // 5.4.6: the larger of 6 m and the least width that gives every class of the set 10 square
        // metres a card across its wedge. Zero when no wedge class has a card of the set.
        long BandWidth(int set, long inner)
        {
            long width = 0;
            for (int c = 0; c < ColourClasses.WedgeCount; c++)
            {
                int n = counts[set, c];
                if (n == 0)
                {
                    continue;
                }
                long span = wedgeSpan[c];
                long needed = SmallestWidth(inner, w => span * Fixed.PiNum * Annulus(inner, w) >= AreaPerStand * (BigInteger)n * Fixed.FullTurn * Fixed.PiDen);
                width = Math.Max(width, Math.Max(MinBand, needed));
            }
            return width;
        }

        static BigInteger Annulus(long inner, long width) => (BigInteger)(inner + width) * (inner + width) - (BigInteger)inner * inner;

        static long SmallestWidth(long inner, Func<long, bool> enough)
        {
            long low = 0, high = Far;
            while (low < high)
            {
                long middle = (low + high) / 2;
                if (enough(middle))
                {
                    high = middle;
                }
                else
                {
                    low = middle + 1;
                }
            }
            return low;
        }

        // A ring path whose inner edge is at `inner`, and a waystone pad where each radial path
        // crosses its centre line (5.4.8).
        void AddRingPath(long inner)
        {
            ringPaths.Add(new LayoutPath { Kind = PathKind.Ring, Inner = inner, Outer = inner + PathWidth });
            ringPathPads.Add(pads.Count);
            foreach (P2 dir in boundaryDirs)
            {
                long at = inner + PathWidth / 2;
                pads.Add(new LayoutPad
                {
                    Kind = PadKind.Waystone,
                    Centre = new P2(Fixed.RoundDiv(dir.X * at, Fixed.Unit), Fixed.RoundDiv(dir.Z * at, Fixed.Unit)),
                    Radius = PadRadius,
                });
            }
        }

        struct Mark
        {
            public int RingPaths, Spurs, Pads, Sites, Placed, Journal;
        }

        Mark Marked() => new Mark
        {
            RingPaths = ringPaths.Count, Spurs = spurs.Count, Pads = pads.Count,
            Sites = sites.Count, Placed = placed.Count, Journal = standJournal.Count,
        };

        // 5.4.9 and 5.4.10: the band or the ring grows by a tenth of its width, at most twenty times,
        // and everything it placed is placed again.
        void Widen(Mark mark, LayoutSite failed, ref int widenings)
        {
            if (widenings == MaxWidenings)
            {
                throw new LayoutException(
                    $"site {input.PlaneSlug}/{input.SetCodes[failed.Set]}/{ColourClasses.SeedNames[(int)failed.Class]} " +
                    $"cannot hold its {failed.Stands} stands after {MaxWidenings} widenings (capacity {failed.Capacity})");
            }
            widenings++;
            ringPaths.RemoveRange(mark.RingPaths, ringPaths.Count - mark.RingPaths);
            ringPathPads.RemoveRange(mark.RingPaths, ringPathPads.Count - mark.RingPaths);
            spurs.RemoveRange(mark.Spurs, spurs.Count - mark.Spurs);
            pads.RemoveRange(mark.Pads, pads.Count - mark.Pads);
            sites.RemoveRange(mark.Sites, sites.Count - mark.Sites);
            for (int i = standJournal.Count - 1; i >= mark.Journal; i--)
            {
                List<int> cell = standCells[standJournal[i]];
                cell.RemoveAt(cell.Count - 1);
            }
            standJournal.RemoveRange(mark.Journal, standJournal.Count - mark.Journal);
            placed.RemoveRange(mark.Placed, placed.Count - mark.Placed);
            // The widenings a site asked for are kept across its band's retries.
            pendingWidenings[(failed.Set, failed.Class)] = pendingWidenings.TryGetValue((failed.Set, failed.Class), out int asked) ? asked + 1 : 1;
        }

        readonly Dictionary<(int, ColourClass), int> pendingWidenings = new Dictionary<(int, ColourClass), int>();

        // One band's sites, or the ring's. 5.4.8 reserves every pad and spur before any stand is
        // placed, so the sites are reserved first and filled after. The site that could not be
        // settled, or null.
        LayoutSite Settle(List<Region> regions, Mark mark)
        {
            groupPads = ringPathPads[regions[0].InnerPath];
            groupSpurs = mark.Spurs;
            foreach (Region region in regions)
            {
                if (!Reserve(region))
                {
                    return region.Site;
                }
            }
            foreach (Region region in regions)
            {
                if (!Fill(region))
                {
                    return region.Site;
                }
            }
            return null;
        }

        // 5.4.8 for one site: its centre, its pad and its spur. False when the region holds no
        // lattice point a pad can stand on.
        bool Reserve(Region region)
        {
            region.FromDir = Fixed.Direction(region.From);
            region.EndDir = Fixed.Direction(region.From + region.Span);
            region.Site = new LayoutSite
            {
                Index = sites.Count, Set = region.Set, Class = region.Class, Inner = region.Inner, Outer = region.Outer,
                AngleFrom = region.From, AngleSpan = region.Span, Stands = counts[region.Set, (int)region.Class],
            };
            sites.Add(region.Site);
            region.Lattice = Lattice(region);
            if (!Centre(region, out P2 centre))
            {
                return false;
            }
            region.Site.Centre = centre;
            pads.Add(new LayoutPad { Kind = PadKind.Site, Centre = centre, Radius = PadRadius, Site = region.Site.Index });
            Spur(region);
            return true;
        }

        // 5.4.9 and 5.4.10 for one site: its candidates, its capacity and its placement. False when
        // the band or the ring has to be widened.
        bool Fill(Region region)
        {
            LayoutSite site = region.Site;
            // 5.4.9, in lattice order: by row, then by column.
            var candidates = new List<Placed>();
            foreach (P2 point in region.Lattice)
            {
                Placed candidate = Candidate(region, point);
                if (candidate != null)
                {
                    candidates.Add(candidate);
                }
            }
            site.Capacity = candidates.Count;
            if (candidates.Count < site.Stands)
            {
                return false;
            }

            // 5.4.10. One generator per site: the shuffle first, then the jitter.
            var random = new SplitMix64($"eternities-v4|{input.PlaneSlug}|{input.SetCodes[region.Set]}|{ColourClasses.SeedNames[(int)region.Class]}");
            for (int i = candidates.Count - 1; i > 0; i--)
            {
                int j = random.Below(i + 1);
                (candidates[i], candidates[j]) = (candidates[j], candidates[i]);
            }
            int first = placed.Count;
            foreach (Placed candidate in candidates)
            {
                if (placed.Count - first == site.Stands)
                {
                    break;
                }
                if (Accepts(candidate))
                {
                    Register(candidate);
                }
            }
            if (placed.Count - first < site.Stands)
            {
                return false;
            }

            // The jitter, in the order the stands were accepted: a point of the square of side 2j
            // about the lattice point, drawn again while it falls outside the disc of radius j.
            var finals = new List<Placed>();
            for (int i = first; i < placed.Count; i++)
            {
                long dx, dz;
                do
                {
                    dx = random.Below(2 * (int)Jitter + 1) - Jitter;
                    dz = random.Below(2 * (int)Jitter + 1) - Jitter;
                }
                while (dx * dx + dz * dz > Jitter * Jitter);
                placed[i].Final = placed[i].Lattice + new P2(dx, dz);
                finals.Add(placed[i]);
            }
            // Reading: the site's cards, sorted by oracle id, go to its positions sorted by (x, z)
            // after the jitter.
            finals.Sort((a, b) => a.Final.X != b.Final.X ? a.Final.X.CompareTo(b.Final.X) : a.Final.Z.CompareTo(b.Final.Z));
            List<int> siteCards = cards[region.Set, (int)region.Class];
            for (int i = 0; i < finals.Count; i++)
            {
                finals[i].Card = siteCards[i];
            }
            return true;
        }

        // The global lattice (5.4.9), one axis along +x, anchored at the origin: the points strictly
        // inside the region, by row and then by column.
        List<P2> Lattice(Region region)
        {
            var points = new List<P2>();
            long rows = region.Outer / RowPitch + 1;
            for (long row = -rows; row <= rows; row++)
            {
                long z = row * RowPitch;
                long offset = (row & 1) == 0 ? 0 : Pitch / 2;
                long reach2 = region.Outer * region.Outer - z * z;
                if (reach2 <= 0)
                {
                    continue;
                }
                long columns = Fixed.ISqrt(reach2) / Pitch + 1;
                for (long column = -columns; column <= columns; column++)
                {
                    var p = new P2(column * Pitch + offset, z);
                    long d2 = p.LengthSquared;
                    if (d2 > region.Inner * region.Inner && d2 < region.Outer * region.Outer && InSector(region, p))
                    {
                        points.Add(p);
                    }
                }
            }
            return points;
        }

        // Is the point in the region's sector, and at least `margin` from both of its edges?
        static bool InSector(Region region, P2 p, long margin = 0)
        {
            if (region.Span >= Fixed.FullTurn)
            {
                return true;
            }
            bool afterFrom = P2.Clockwise(region.FromDir, p) >= margin * Fixed.Unit;
            bool beforeEnd = P2.Clockwise(region.EndDir, p) <= -margin * Fixed.Unit;
            return region.Span <= Fixed.FullTurn / 2 ? afterFrom && beforeEnd : afterFrom || beforeEnd;
        }

        // 5.4.8: the lattice point of the region nearest to its centroid that lies on no path and
        // whose pad meets no other pad and no hero volume. Of two points equally near, the first in
        // lattice order.
        bool Centre(Region region, out P2 centre)
        {
            long middle = region.From + region.Span / 2;
            P2 dir = Fixed.Direction(middle);
            long at;
            if (region.Span > Fixed.FullTurn / 2)
            {
                // Reading: the mid-angle point at the mid radius, which 5.4.8 gives for an arc wider
                // than a half turn, is used for a wedge that wide too.
                at = (region.Inner + region.Outer) / 2;
            }
            else
            {
                // The centroid of an annular sector lies on its mid-angle at
                // (2/3) (R^3 - r^3) / (R^2 - r^2) x sin(a) / a, with a the half angle in radians.
                long half = region.Span / 2;
                BigInteger outer = region.Outer, inner = region.Inner;
                BigInteger numerator = 2 * (outer * outer * outer - inner * inner * inner) * Fixed.Direction(half).X * 180_000_000 * Fixed.PiDen;
                BigInteger denominator = 3 * (outer * outer - inner * inner) * Fixed.Unit * half * Fixed.PiNum;
                at = half == 0 ? (region.Inner + region.Outer) / 2 : (long)(numerator / denominator);
            }
            var centroid = new P2(Fixed.RoundDiv(dir.X * at, Fixed.Unit), Fixed.RoundDiv(dir.Z * at, Fixed.Unit));

            centre = default;
            long best = long.MaxValue;
            foreach (P2 p in region.Lattice)
            {
                long d2 = (p - centroid).LengthSquared;
                if (d2 >= best || OnPath(p) || PadBlocked(p))
                {
                    continue;
                }
                best = d2;
                centre = p;
            }
            return best != long.MaxValue;
        }

        // On a radial path, or on a spur of this band or ring. The lattice points of a region are
        // already off the ring paths.
        bool OnPath(P2 p)
        {
            foreach (P2[] strip in strips)
            {
                if (Shapes.Contains(strip, p))
                {
                    return true;
                }
            }
            for (int i = groupSpurs; i < spurs.Count; i++)
            {
                if (Shapes.Contains(spurs[i].Quad, p))
                {
                    return true;
                }
            }
            return false;
        }

        bool PadBlocked(P2 centre)
        {
            for (int i = groupPads; i < pads.Count; i++)
            {
                long reach = pads[i].Radius + PadRadius + Slack;
                if ((pads[i].Centre - centre).LengthSquared <= reach * reach)
                {
                    return true;
                }
            }
            foreach (HeroVolume volume in input.HeroVolumes)
            {
                if (Covers(volume, centre, PadRadius + Slack))
                {
                    return true;
                }
            }
            return false;
        }

        // Does the volume reach within `radius` of the point?
        static bool Covers(HeroVolume volume, P2 point, long radius)
        {
            if (volume.Radius > 0)
            {
                long reach = volume.Radius + radius;
                return (volume.Centre - point).LengthSquared <= reach * reach;
            }
            return Shapes.IntersectsDisc(volume.Box, point, radius);
        }

        static bool Meets(HeroVolume volume, P2[] shape)
        {
            return volume.Radius > 0 ? Shapes.IntersectsDisc(shape, volume.Centre, volume.Radius) : Shapes.Intersect(shape, volume.Box);
        }

        // 5.4.8: a 3 m spur from the pad's edge to the nearest point of the nearest bounding path. A
        // hero volume on the straight route sends it to the next nearest path; with none left the
        // build fails. The strip is drawn SpurOverlap into the pad and into the path, so that the
        // three still touch after its corners are rounded to the millimetre.
        void Spur(Region region)
        {
            LayoutSite site = region.Site;
            var tried = new HashSet<(int, int)>();
            while (true)
            {
                if (!Nearest(region, site.Centre, tried, false, out P2 point, out int kind, out int index))
                {
                    throw new LayoutException(
                        $"the spur of site {input.PlaneSlug}/{input.SetCodes[site.Set]}/{ColourClasses.SeedNames[(int)site.Class]} cannot reach a path: " +
                        "a hero volume blocks every straight route");
                }
                P2 forward = point - site.Centre;
                long length = Fixed.ISqrt(forward.LengthSquared);
                if (length <= PadRadius - SpurOverlap)
                {
                    return;     // the pad already lies on the path
                }
                P2[] quad = Shapes.Rect(site.Centre, forward, length, PadRadius - SpurOverlap, length + SpurOverlap, PathWidth / 2);
                bool blocked = false;
                foreach (HeroVolume volume in input.HeroVolumes)
                {
                    blocked |= Meets(volume, quad);
                }
                if (!blocked)
                {
                    site.Spur = spurs.Count;
                    spurs.Add(new LayoutPath { Kind = PathKind.Spur, Quad = quad, Site = site.Index });
                    return;
                }
                tried.Add((kind, index));
            }
        }

        // The nearest point of the path network to `p`: of the ring paths that bound the region, of
        // the radial paths and, when `withSpurs`, of the spurs of this band or ring. Ties go to the
        // lower path id: ring paths first, then radial paths, then spurs.
        bool Nearest(Region region, P2 p, HashSet<(int, int)> skip, bool withSpurs, out P2 nearest, out int kind, out int index)
        {
            nearest = default;
            kind = index = -1;
            long best = long.MaxValue;
            void Offer(P2 q, int k, int i, ref P2 n, ref int nk, ref int ni)
            {
                if (skip != null && skip.Contains((k, i)))
                {
                    return;
                }
                long d2 = (q - p).LengthSquared;
                if (d2 < best)
                {
                    best = d2;
                    n = q;
                    nk = k;
                    ni = i;
                }
            }

            long distance = Fixed.ISqrt(p.LengthSquared);
            if (distance > 0)
            {
                if (region.InnerPath >= 0)
                {
                    Offer(new P2(Fixed.RoundDiv(p.X * region.Inner, distance), Fixed.RoundDiv(p.Z * region.Inner, distance)), 0, region.InnerPath, ref nearest, ref kind, ref index);
                }
                if (region.OuterPath >= 0)
                {
                    Offer(new P2(Fixed.RoundDiv(p.X * region.Outer, distance), Fixed.RoundDiv(p.Z * region.Outer, distance)), 0, region.OuterPath, ref nearest, ref kind, ref index);
                }
            }
            for (int b = 0; b < boundaryDirs.Count; b++)
            {
                P2 dir = boundaryDirs[b];
                long along = Fixed.RoundDiv(P2.Dot(dir, p), Fixed.Unit);
                long side = P2.Clockwise(dir, p);
                if (along < plaza || Math.Abs(side) <= (PathWidth / 2) * Fixed.Unit)
                {
                    continue;
                }
                long edge = side > 0 ? PathWidth / 2 : -(PathWidth / 2);
                // The foot on the strip's near edge: `along` up the ray, `edge` to its clockwise side.
                Offer(new P2(Fixed.RoundDiv(dir.X * along + dir.Z * edge, Fixed.Unit), Fixed.RoundDiv(dir.Z * along - dir.X * edge, Fixed.Unit)), 1, b, ref nearest, ref kind, ref index);
            }
            for (int s = groupSpurs; withSpurs && s < spurs.Count; s++)
            {
                P2[] quad = spurs[s].Quad;
                for (int e = 0; e < 4; e++)
                {
                    Offer(Shapes.NearestOnSegment(quad[e], quad[(e + 1) % 4], p), 2, s, ref nearest, ref kind, ref index);
                }
            }
            return kind >= 0;
        }

        // 5.4.9 (a) to (d) for one lattice point of the region. Null when it is not a candidate.
        Placed Candidate(Region region, P2 p)
        {
            if (!Nearest(region, p, null, true, out P2 point, out int kind, out int index))
            {
                return null;
            }
            P2 forward = point - p;
            long length = Fixed.ISqrt(forward.LengthSquared);
            long front = FootprintHalfDepth + ApronDepth;
            if (length <= front + Inflate)
            {
                return null;    // the apron would lie on the path
            }
            // Reading: (a) is tested with the jitter radius as a margin, so that the stand is still
            // inside its site after it is displaced (invariant 7). Only the ring needs it: between
            // two arcs, and at the world's edge, no path keeps a stand away from the boundary.
            long distance = Fixed.ISqrt(p.LengthSquared);
            if (distance < region.Inner + Inflate || distance > region.Outer - Inflate || !InSector(region, p, Inflate))
            {
                return null;
            }
            // The corridor is drawn CorridorReach past its path point (see Emit), and is tested so.
            var c = new Placed
            {
                Site = region.Site.Index, Lattice = p, Forward = forward, Length = length, PathPoint = point, PathKind = kind, PathIndex = index,
                Footprint = Shapes.Rect(p, forward, length, -FootprintHalfDepth - Inflate, FootprintHalfDepth + Inflate, FootprintHalfWidth + Inflate),
                Apron = Shapes.Rect(p, forward, length, FootprintHalfDepth - Inflate, front + Inflate, ApronHalfWidth + Inflate),
                Corridor = Shapes.Rect(p, forward, length, front - Inflate, length + CorridorReach + Inflate, CorridorHalfWidth + Inflate),
            };

            // (b) and (c): the footprint and the apron stay off the plaza, the paths, the pads and
            // the hero volumes. Only what lies within reach of the point is tested.
            bool nearPlaza = distance <= plaza + Near;
            foreach (P2[] shape in new[] { c.Footprint, c.Apron })
            {
                if (nearPlaza && Shapes.IntersectsDisc(shape, default, plaza))
                {
                    return null;
                }
                foreach (int ringPath in new[] { region.InnerPath, region.OuterPath })
                {
                    if (ringPath < 0)
                    {
                        continue;
                    }
                    LayoutPath ring = ringPaths[ringPath];
                    if (distance + Near >= ring.Inner && distance - Near <= ring.Outer && Shapes.IntersectsAnnulus(shape, ring.Inner, ring.Outer))
                    {
                        return null;
                    }
                }
                for (int b = 0; b < strips.Length; b++)
                {
                    if (Math.Abs(P2.Clockwise(boundaryDirs[b], p)) <= (PathWidth / 2 + Near) * Fixed.Unit && Shapes.Intersect(shape, strips[b]))
                    {
                        return null;
                    }
                }
                for (int s = groupSpurs; s < spurs.Count; s++)
                {
                    if (Shapes.Intersect(shape, spurs[s].Quad))
                    {
                        return null;
                    }
                }
                for (int i = groupPads; i < pads.Count; i++)
                {
                    long reach = pads[i].Radius + Near;
                    if ((pads[i].Centre - p).LengthSquared <= reach * reach && Shapes.IntersectsDisc(shape, pads[i].Centre, pads[i].Radius))
                    {
                        return null;
                    }
                }
                foreach (HeroVolume volume in input.HeroVolumes)
                {
                    if (Meets(volume, shape))
                    {
                        return null;
                    }
                }
            }

            // (d): the corridor stays inside the site and off the plaza and the hero volumes.
            if (!InsideRegion(c.Corridor, region) || Shapes.IntersectsDisc(c.Corridor, default, plaza))
            {
                return null;
            }
            foreach (HeroVolume volume in input.HeroVolumes)
            {
                if (Meets(volume, c.Corridor))
                {
                    return null;
                }
            }
            return c;
        }

        // Reading: "inside the site's region" (5.4.9 d) is tested on the region together with the
        // ring paths that bound it, because the corridor ends on a path and, grown, reaches into it.
        static bool InsideRegion(P2[] quad, Region region)
        {
            long inner = region.Inner - PathWidth, outer = region.Outer + (region.OuterPath >= 0 ? PathWidth : 0);
            foreach (P2 corner in quad)
            {
                if (corner.LengthSquared > outer * outer || !InSector(region, corner))
                {
                    return false;
                }
            }
            // The quad's nearest point to the origin may lie on an edge, not at a corner.
            if (Shapes.IntersectsDisc(quad, default, inner - 1))
            {
                return false;
            }
            // A sector wider than a half turn is not convex: an edge can cut across the part left out
            // with both its ends inside.
            if (region.Span > Fixed.FullTurn / 2 && region.Span < Fixed.FullTurn)
            {
                for (int e = 0; e < quad.Length; e++)
                {
                    P2 a = quad[e], b = quad[(e + 1) % quad.Length];
                    if (CrossesRay(a, b, region.FromDir) || CrossesRay(a, b, region.EndDir))
                    {
                        return false;
                    }
                }
            }
            return true;
        }

        // Does the segment a-b cross the ray from the origin along `dir`?
        static bool CrossesRay(P2 a, P2 b, P2 dir)
        {
            BigInteger sideA = P2.Clockwise(dir, a), sideB = P2.Clockwise(dir, b);
            if (sideA.Sign * sideB.Sign >= 0)
            {
                return false;
            }
            // The crossing point's distance along the ray has the sign of this quotient.
            BigInteger along = sideA * P2.Dot(dir, b) - sideB * P2.Dot(dir, a);
            return along.Sign * (sideA - sideB).Sign > 0;
        }

        // 5.4.10: a candidate is taken unless it would stand on, or run its corridor through, a stand
        // already taken, or cross another corridor at under 30 degrees.
        // Reading: the text tests the candidate's shapes against the taken stands' footprints and
        // aprons. Invariant 9 also forbids a footprint or an apron in another stand's corridor, so
        // the candidate's footprint and apron are tested against the taken corridors as well.
        bool Accepts(Placed c)
        {
            foreach (int id in Neighbours(c))
            {
                Placed other = placed[id];
                if (Shapes.Intersect(c.Footprint, other.Footprint) || Shapes.Intersect(c.Footprint, other.Apron)
                    || Shapes.Intersect(c.Apron, other.Footprint) || Shapes.Intersect(c.Apron, other.Apron)
                    || Shapes.Intersect(c.Corridor, other.Footprint) || Shapes.Intersect(c.Corridor, other.Apron)
                    || Shapes.Intersect(c.Footprint, other.Corridor) || Shapes.Intersect(c.Apron, other.Corridor))
                {
                    return false;
                }
                if (Shapes.Intersect(c.Corridor, other.Corridor))
                {
                    // Under 30 degrees between the two lines: sin squared under a quarter.
                    decimal cross = P2.Clockwise(c.Forward, other.Forward);
                    if (4 * cross * cross < (decimal)c.Forward.LengthSquared * other.Forward.LengthSquared)
                    {
                        return false;
                    }
                }
            }
            return true;
        }

        readonly HashSet<int> seen = new HashSet<int>();

        IEnumerable<int> Neighbours(Placed c)
        {
            seen.Clear();
            Bounds(c, out long x0, out long z0, out long x1, out long z1);
            for (long cx = x0; cx <= x1; cx++)
            {
                for (long cz = z0; cz <= z1; cz++)
                {
                    if (standCells.TryGetValue(Key(cx, cz), out List<int> cell))
                    {
                        foreach (int id in cell)
                        {
                            if (seen.Add(id))
                            {
                                yield return id;
                            }
                        }
                    }
                }
            }
        }

        void Register(Placed c)
        {
            int id = placed.Count;
            placed.Add(c);
            Bounds(c, out long x0, out long z0, out long x1, out long z1);
            for (long cx = x0; cx <= x1; cx++)
            {
                for (long cz = z0; cz <= z1; cz++)
                {
                    long key = Key(cx, cz);
                    if (!standCells.TryGetValue(key, out List<int> cell))
                    {
                        standCells[key] = cell = new List<int>();
                    }
                    cell.Add(id);
                    standJournal.Add(key);
                }
            }
        }

        static long Key(long cx, long cz) => cx * 1_000_003 + cz;

        static void Bounds(Placed c, out long x0, out long z0, out long x1, out long z1)
        {
            long minX = long.MaxValue, minZ = long.MaxValue, maxX = long.MinValue, maxZ = long.MinValue;
            foreach (P2[] shape in new[] { c.Footprint, c.Apron, c.Corridor })
            {
                foreach (P2 p in shape)
                {
                    minX = Math.Min(minX, p.X);
                    maxX = Math.Max(maxX, p.X);
                    minZ = Math.Min(minZ, p.Z);
                    maxZ = Math.Max(maxZ, p.Z);
                }
            }
            x0 = Math.DivRem(minX, Cell, out long rest) - (rest < 0 ? 1 : 0);
            z0 = Math.DivRem(minZ, Cell, out rest) - (rest < 0 ? 1 : 0);
            x1 = Math.DivRem(maxX, Cell, out rest) - (rest < 0 ? 1 : 0);
            z1 = Math.DivRem(maxZ, Cell, out rest) - (rest < 0 ? 1 : 0);
        }

        // 5.4.8: a hero volume on a path fails the build with the volume named.
        void CheckVolumesAgainstPaths(long worldRadius)
        {
            foreach (HeroVolume volume in input.HeroVolumes)
            {
                bool onPath = false;
                P2[] shape = volume.Radius > 0 ? null : volume.Box;
                foreach (LayoutPath ring in ringPaths)
                {
                    onPath |= shape != null
                        ? Shapes.IntersectsAnnulus(shape, ring.Inner, ring.Outer)
                        : DiscMeetsAnnulus(volume.Centre, volume.Radius, ring.Inner, ring.Outer);
                }
                for (int b = 0; b < strips.Length; b++)
                {
                    P2[] strip = Shapes.Rect(default, boundaryDirs[b], Fixed.Unit, plaza, worldRadius, PathWidth / 2);
                    onPath |= Meets(volume, strip);
                }
                if (onPath)
                {
                    throw new LayoutException($"hero volume {volume.Id} covers a path");
                }
            }
        }

        static bool DiscMeetsAnnulus(P2 centre, long radius, long inner, long outer)
        {
            long distance = Fixed.ISqrt(centre.LengthSquared);
            return distance - radius <= outer && distance + radius >= inner;
        }

        WorldLayout Emit(long worldRadius, int passes)
        {
            var layout = new WorldLayout
            {
                Input = input, PlazaRadius = plaza, WorldRadius = worldRadius, OuterPasses = passes,
                Arrival = default, ReturnPortal = new P2(0, -ReturnPortalSouth),
                RingInner = ringInner, RingWidth = ringWidth, RingWidenings = ringWidenings,
            };
            Array.Copy(wedgeFrom, layout.WedgeFrom, wedgeFrom.Length);
            Array.Copy(wedgeSpan, layout.WedgeSpan, wedgeSpan.Length);
            layout.Bands.AddRange(bands);
            layout.Pads.AddRange(pads);
            foreach (LayoutSite site in sites)
            {
                pendingWidenings.TryGetValue((site.Set, site.Class), out site.Widenings);
                site.Spur = site.Spur < 0 ? -1 : ringPaths.Count + boundaries.Count + site.Spur;
                layout.Sites.Add(site);
            }

            // Path ids: ring paths from the plaza outward, radial paths clockwise from north, spurs in
            // site order.
            foreach (LayoutPath ring in ringPaths)
            {
                ring.Id = layout.Paths.Count;
                layout.Paths.Add(ring);
            }
            int firstRadial = layout.Paths.Count;
            foreach (long angle in boundaries)
            {
                layout.Paths.Add(new LayoutPath { Id = layout.Paths.Count, Kind = PathKind.Radial, Angle = angle, Inner = plaza, Outer = worldRadius });
            }
            int firstSpur = layout.Paths.Count;
            foreach (LayoutPath spur in spurs)
            {
                spur.Id = layout.Paths.Count;
                layout.Paths.Add(spur);
            }

            foreach (Placed stand in placed)
            {
                P2 offset = stand.Final - stand.Lattice;
                // The corridor keeps its direction and is drawn a little past its path point, so it
                // still ends on the path wherever the jitter moved the stand.
                P2 reach = new P2(Fixed.RoundDiv(stand.Forward.X * CorridorReach, stand.Length), Fixed.RoundDiv(stand.Forward.Z * CorridorReach, stand.Length));
                layout.Stands.Add(new LayoutStand
                {
                    Card = stand.Card, Site = stand.Site, Position = stand.Final,
                    Lattice = stand.Lattice,
                    Yaw = Fixed.Angle(stand.Forward.X, stand.Forward.Z),
                    PathPoint = stand.PathPoint + offset + reach,
                    Path = stand.PathKind == 0 ? stand.PathIndex : stand.PathKind == 1 ? firstRadial + stand.PathIndex : firstSpur + stand.PathIndex,
                });
            }
            return layout;
        }
    }
}
