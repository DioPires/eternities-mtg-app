using System;
using System.Collections.Generic;
using System.Numerics;

namespace Eternities.Layout
{
    // The predicates of PRD v4 5.4.18 (10) on filled shapes, in exact integer arithmetic. They are
    // the C# checker's own, written from the text and from the pipeline checker's docstrings
    // (`pipeline/src/eternities/layout/check.py`), and they compute no position (5.4.18 (12)).
    //
    // A point's coordinates are integers in any one unit, a long each; a vertex of a rebuilt shape
    // is a millimetre times 2^30 plus a radius times a table value, about 2^51 at most. A product of
    // two coordinate differences can pass 2^63, and a product of two such products is compared, so
    // every product is a `BigInteger`.
    public static class Predicates
    {
        public const int Out = 0, On = 1, In = 2;

        static BigInteger Mul(long a, long b) => (BigInteger)a * b;

        // The sign of a × b − c × d, exact. Each factor is a long well inside its range (a
        // coordinate difference is under 2^53), so each product is formed in 128 bits from 32-bit
        // halves, with no allocation: this is the cross product of every orientation test.
        public static int CrossSign(long a, long b, long c, long d)
        {
            int first = Product(a, b, out ulong firstHigh, out ulong firstLow);
            int second = Product(c, d, out ulong secondHigh, out ulong secondLow);
            if (first != second)
            {
                return first > second ? 1 : -1;
            }
            if (first == 0)
            {
                return 0;
            }
            int magnitude = firstHigh != secondHigh ? (firstHigh > secondHigh ? 1 : -1) : firstLow != secondLow ? (firstLow > secondLow ? 1 : -1) : 0;
            return first > 0 ? magnitude : -magnitude;
        }

        // The sign of a × b, and its magnitude as 128 bits.
        static int Product(long a, long b, out ulong high, out ulong low)
        {
            if (a == 0 || b == 0)
            {
                high = low = 0;
                return 0;
            }
            int sign = (a < 0) == (b < 0) ? 1 : -1;
            ulong x = (ulong)(a < 0 ? -a : a), y = (ulong)(b < 0 ? -b : b);
            ulong x0 = x & 0xFFFFFFFFUL, x1 = x >> 32, y0 = y & 0xFFFFFFFFUL, y1 = y >> 32;
            ulong p00 = x0 * y0, p01 = x0 * y1, p10 = x1 * y0, p11 = x1 * y1;
            ulong middle = (p00 >> 32) + (p01 & 0xFFFFFFFFUL) + (p10 & 0xFFFFFFFFUL);
            low = (middle << 32) | (p00 & 0xFFFFFFFFUL);
            high = p11 + (p01 >> 32) + (p10 >> 32) + (middle >> 32);
            return sign;
        }

        // Where a point lies: outside, on the boundary, or strictly inside (the even-odd rule).
        public static int Locate(P2 point, IReadOnlyList<P2> polygon)
        {
            long px = point.X, pz = point.Z;
            P2 last = polygon[polygon.Count - 1];
            long ax = last.X, az = last.Z;
            bool inside = false;
            for (int i = 0; i < polygon.Count; i++)
            {
                long bx = polygon[i].X, bz = polygon[i].Z;
                if (bx == px && bz == pz)
                {
                    return On;
                }
                if ((az > pz) != (bz > pz))
                {
                    int cross = CrossSign(bx - ax, pz - az, bz - az, px - ax);
                    if (cross == 0)
                    {
                        return On;
                    }
                    if ((cross > 0) == (bz > az))
                    {
                        inside = !inside;
                    }
                }
                else if (az == pz && bz == pz && ((ax <= px && px <= bx) || (bx <= px && px <= ax)))
                {
                    return On;
                }
                ax = bx;
                az = bz;
            }
            return inside ? In : Out;
        }

        // The same for the point (px, pz) against the polygon scaled by `scale`, so that a point
        // over a denominator is tested without a division.
        public static int Locate(BigInteger px, BigInteger pz, IReadOnlyList<P2> polygon, BigInteger scale)
        {
            P2 last = polygon[polygon.Count - 1];
            BigInteger ax = last.X * scale, az = last.Z * scale;
            bool inside = false;
            for (int i = 0; i < polygon.Count; i++)
            {
                BigInteger bx = polygon[i].X * scale, bz = polygon[i].Z * scale;
                if (bx == px && bz == pz)
                {
                    return On;
                }
                if ((az > pz) != (bz > pz))
                {
                    BigInteger cross = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
                    if (cross.IsZero)
                    {
                        return On;
                    }
                    if ((cross.Sign > 0) == (bz > az))
                    {
                        inside = !inside;
                    }
                }
                else if (az == pz && bz == pz && ((ax <= px && px <= bx) || (bx <= px && px <= ax)))
                {
                    return On;
                }
                ax = bx;
                az = bz;
            }
            return inside ? In : Out;
        }

        // Even-odd, with the boundary counted inside.
        public static bool PointInPolygon(P2 point, IReadOnlyList<P2> polygon) => Locate(point, polygon) != Out;

        // Whether segments ab and cd share a point, by the signs of exact cross products. Touching
        // counts, and so do collinear segments that overlap or meet end to end.
        public static bool SegmentsIntersect(P2 a, P2 b, P2 c, P2 d)
        {
            if (Math.Max(a.X, b.X) < Math.Min(c.X, d.X) || Math.Max(c.X, d.X) < Math.Min(a.X, b.X)
                || Math.Max(a.Z, b.Z) < Math.Min(c.Z, d.Z) || Math.Max(c.Z, d.Z) < Math.Min(a.Z, b.Z))
            {
                return false;
            }
            long ex = d.X - c.X, ez = d.Z - c.Z;
            int sideA = CrossSign(ex, a.Z - c.Z, ez, a.X - c.X);
            int sideB = CrossSign(ex, b.Z - c.Z, ez, b.X - c.X);
            if ((sideA > 0 && sideB > 0) || (sideA < 0 && sideB < 0))
            {
                return false;
            }
            long fx = b.X - a.X, fz = b.Z - a.Z;
            int sideC = CrossSign(fx, c.Z - a.Z, fz, c.X - a.X);
            int sideD = CrossSign(fx, d.Z - a.Z, fz, d.X - a.X);
            // Neither segment lies strictly on one side of the other's line, and their boxes meet:
            // they cross, touch, or are collinear and overlap.
            return !((sideC > 0 && sideD > 0) || (sideC < 0 && sideD < 0));
        }

        // Whether a point lies nearer to segment ab than the distance whose square is `limit`.
        public static bool PointNearer(P2 point, P2 a, P2 b, BigInteger limit)
        {
            long dx = b.X - a.X, dz = b.Z - a.Z;
            long wx = point.X - a.X, wz = point.Z - a.Z;
            BigInteger along = Mul(dx, wx) + Mul(dz, wz);
            if (along.Sign <= 0)
            {
                return Mul(wx, wx) + Mul(wz, wz) < limit;
            }
            BigInteger length = Mul(dx, dx) + Mul(dz, dz);
            if (along >= length)
            {
                long ex = point.X - b.X, ez = point.Z - b.Z;
                return Mul(ex, ex) + Mul(ez, ez) < limit;
            }
            BigInteger across = Mul(dx, wz) - Mul(dz, wx);
            return across * across < limit * length;
        }

        // Whether two segments lie nearer than the distance whose square is `limit`: zero when they
        // intersect, otherwise the least of the four distances from an end of one to the other.
        public static bool SegmentsNearer(P2 a, P2 b, P2 c, P2 d, BigInteger limit)
        {
            if (SegmentsIntersect(a, b, c, d))
            {
                return limit.Sign > 0;
            }
            return PointNearer(a, c, d, limit) || PointNearer(b, c, d, limit) || PointNearer(c, a, b, limit) || PointNearer(d, a, b, limit);
        }

        // Whether segment ab lies nearer to a filled polygon than the distance whose square is
        // `limit`. The distance is zero when the segment crosses an edge or has an end inside the
        // polygon, and otherwise the least vertex-to-segment distance between the two boundaries.
        public static bool SegmentNearer(P2 a, P2 b, IReadOnlyList<P2> polygon, BigInteger limit)
        {
            if (limit.Sign <= 0)
            {
                return false;
            }
            long dx = b.X - a.X, dz = b.Z - a.Z;
            BigInteger length = Mul(dx, dx) + Mul(dz, dz);
            if (!length.IsZero)
            {
                // A polygon whose vertices all lie on one side of the segment's line, or all beyond
                // one of its ends, each by the distance or more, is provably that far away, as its
                // convex hull is.
                BigInteger bound = limit * length;
                int left = 0, right = 0, before = 0, after = 0;
                foreach (P2 v in polygon)
                {
                    long wx = v.X - a.X, wz = v.Z - a.Z;
                    BigInteger along = Mul(dx, wx) + Mul(dz, wz);
                    BigInteger across = Mul(dx, wz) - Mul(dz, wx);
                    if (along.Sign <= 0)
                    {
                        if (Mul(wx, wx) + Mul(wz, wz) < limit)
                        {
                            return true;
                        }
                        if (along * along >= bound)
                        {
                            before++;
                        }
                    }
                    else if (along >= length)
                    {
                        long ex = v.X - b.X, ez = v.Z - b.Z;
                        if (Mul(ex, ex) + Mul(ez, ez) < limit)
                        {
                            return true;
                        }
                        BigInteger past = along - length;
                        if (past * past >= bound)
                        {
                            after++;
                        }
                    }
                    else if (across * across < bound)
                    {
                        return true;
                    }
                    if (across * across >= bound)
                    {
                        if (across.Sign > 0)
                        {
                            left++;
                        }
                        else
                        {
                            right++;
                        }
                    }
                }
                int count = polygon.Count;
                if (count == left || count == right || count == before || count == after)
                {
                    return false;
                }
            }
            // The segment's ends against the polygon's edges, then the two cases of distance zero.
            P2 p = polygon[polygon.Count - 1];
            foreach (P2 q in polygon)
            {
                if (PointNearer(a, p, q, limit) || PointNearer(b, p, q, limit))
                {
                    return true;
                }
                p = q;
            }
            p = polygon[polygon.Count - 1];
            foreach (P2 q in polygon)
            {
                if (SegmentsIntersect(a, b, p, q))
                {
                    return true;
                }
                p = q;
            }
            return Locate(a, polygon) != Out || Locate(b, polygon) != Out;
        }

        // A polyline's segments. A polyline of one vertex is one segment of no length.
        public static List<(P2 a, P2 b)> Segments(IReadOnlyList<P2> polyline)
        {
            var found = new List<(P2, P2)>(Math.Max(1, polyline.Count - 1));
            if (polyline.Count == 1)
            {
                found.Add((polyline[0], polyline[0]));
                return found;
            }
            for (int i = 1; i < polyline.Count; i++)
            {
                found.Add((polyline[i - 1], polyline[i]));
            }
            return found;
        }

        // A polygon's edges, the closing edge first.
        public static List<(P2 a, P2 b)> Edges(IReadOnlyList<P2> polygon)
        {
            var found = new List<(P2, P2)>(polygon.Count);
            for (int i = 0; i < polygon.Count; i++)
            {
                found.Add((polygon[i == 0 ? polygon.Count - 1 : i - 1], polygon[i]));
            }
            return found;
        }

        // Two filled polygons intersect when an edge crosses an edge or a vertex of one lies inside
        // the other, so a polygon nested in another intersects it.
        public static bool PolygonsIntersect(IReadOnlyList<P2> a, IReadOnlyList<P2> b)
        {
            Box boxA = Box.Of(a), boxB = Box.Of(b);
            if (boxA.MaxX < boxB.MinX || boxB.MaxX < boxA.MinX || boxA.MaxZ < boxB.MinZ || boxB.MaxZ < boxA.MinZ)
            {
                return false;
            }
            P2 p = a[a.Count - 1];
            foreach (P2 q in a)
            {
                P2 r = b[b.Count - 1];
                foreach (P2 s in b)
                {
                    if (SegmentsIntersect(p, q, r, s))
                    {
                        return true;
                    }
                    r = s;
                }
                p = q;
            }
            foreach (P2 point in a)
            {
                if (Locate(point, b) != Out)
                {
                    return true;
                }
            }
            foreach (P2 point in b)
            {
                if (Locate(point, a) != Out)
                {
                    return true;
                }
            }
            return false;
        }

        // A strip intersects a filled polygon when its polyline's distance to the polygon is below
        // the half width. A strip that touches, at exactly the half width, does not.
        public static bool StripIntersectsPolygon(IReadOnlyList<P2> polyline, long halfWidth, IReadOnlyList<P2> polygon)
        {
            BigInteger limit = Mul(halfWidth, halfWidth);
            foreach ((P2 a, P2 b) in Segments(polyline))
            {
                if (SegmentNearer(a, b, polygon, limit))
                {
                    return true;
                }
            }
            return false;
        }

        // A strip lies inside a polygon when every vertex of its polyline lies inside the polygon
        // and every segment lies at least the half width from every edge: no segment can then cross
        // an edge, and a polyline that clears a notch while its width enters it is not inside.
        public static bool StripInsidePolygon(IReadOnlyList<P2> polyline, long halfWidth, IReadOnlyList<P2> polygon)
        {
            foreach (P2 point in polyline)
            {
                if (Locate(point, polygon) == Out)
                {
                    return false;
                }
            }
            BigInteger limit = Mul(halfWidth, halfWidth);
            foreach ((P2 a, P2 b) in Segments(polyline))
            {
                P2 p = polygon[polygon.Count - 1];
                foreach (P2 q in polygon)
                {
                    if (SegmentsNearer(a, b, p, q, limit))
                    {
                        return false;
                    }
                    p = q;
                }
            }
            return true;
        }

        // A fraction (numerator, denominator), the denominator above zero.
        struct Fraction
        {
            public BigInteger Num, Den;

            public Fraction(BigInteger num, BigInteger den)
            {
                Num = num;
                Den = den;
            }

            public static int Compare(Fraction first, Fraction second) => (first.Num * second.Den).CompareTo(second.Num * first.Den);
        }

        // Where segment cd meets the given edges, as fractions of the way from c to d. A crossing or
        // a touch is one point; a shared stretch of two collinear segments gives its two ends.
        static List<Fraction> Cuts(P2 c, P2 d, List<(P2 a, P2 b)> edges)
        {
            long ex = d.X - c.X, ez = d.Z - c.Z;
            BigInteger length = Mul(ex, ex) + Mul(ez, ez);
            var found = new List<Fraction>();
            foreach ((P2 a, P2 b) in edges)
            {
                if (!SegmentsIntersect(c, d, a, b))
                {
                    continue;
                }
                long fx = b.X - a.X, fz = b.Z - a.Z;
                BigInteger across = Mul(ex, fz) - Mul(ez, fx);
                if (!across.IsZero)
                {
                    BigInteger num = Mul(a.X - c.X, fz) - Mul(a.Z - c.Z, fx);
                    found.Add(across.Sign > 0 ? new Fraction(num, across) : new Fraction(-num, -across));
                }
                else
                {
                    foreach (P2 point in new[] { a, b })
                    {
                        BigInteger along = Mul(point.X - c.X, ex) + Mul(point.Z - c.Z, ez);
                        found.Add(new Fraction(BigInteger.Min(BigInteger.Max(along, BigInteger.Zero), length), length));
                    }
                }
            }
            return found;
        }

        // The filled polygon `inner` lies inside the filled polygon `outer` (5.4.18 (10)), with the
        // boundary counted inside: every vertex of the inner polygon lies inside the outer polygon;
        // each edge of the inner polygon is cut at every point where it meets the outer polygon's
        // boundary (an outer vertex on the edge, a crossing point, the two ends of a shared
        // stretch); and the midpoint of each piece lies inside the outer polygon. Each piece either
        // runs along the outer boundary, between the two ends of a shared stretch, or meets the
        // boundary at its ends at most and so lies wholly inside or wholly outside the outer
        // polygon; in both cases its midpoint tells which, the boundary counted inside. An edge that
        // meets the outer boundary nowhere lies inside, because its ends do, and an edge of zero
        // length is skipped: its point is a vertex, tested already. The cuts are exact fractions,
        // compared by cross-multiplication, and a midpoint is tested against the outer polygon
        // scaled by its denominator.
        public static bool PolygonInsidePolygon(IReadOnlyList<P2> inner, IReadOnlyList<P2> outer)
        {
            foreach (P2 point in inner)
            {
                if (Locate(point, outer) == Out)
                {
                    return false;
                }
            }
            Box box = Box.Of(inner);
            // An outer edge wholly to one side of the inner polygon's box meets none of its edges.
            var near = new List<(P2 a, P2 b)>();
            foreach ((P2 a, P2 b) in Edges(outer))
            {
                if (!((a.X < box.MinX && b.X < box.MinX) || (a.X > box.MaxX && b.X > box.MaxX) || (a.Z < box.MinZ && b.Z < box.MinZ) || (a.Z > box.MaxZ && b.Z > box.MaxZ)))
                {
                    near.Add((a, b));
                }
            }
            foreach ((P2 c, P2 d) in Edges(inner))
            {
                if (c.Equals(d))
                {
                    continue;
                }
                List<Fraction> cuts = Cuts(c, d, near);
                if (cuts.Count == 0)
                {
                    continue;
                }
                cuts.Add(new Fraction(BigInteger.Zero, BigInteger.One));
                cuts.Add(new Fraction(BigInteger.One, BigInteger.One));
                cuts.Sort(Fraction.Compare);
                long ex = d.X - c.X, ez = d.Z - c.Z;
                for (int i = 1; i < cuts.Count; i++)
                {
                    Fraction first = cuts[i - 1], second = cuts[i];
                    if (Fraction.Compare(first, second) == 0)
                    {
                        continue;
                    }
                    BigInteger num = first.Num * second.Den + second.Num * first.Den;
                    BigInteger den = 2 * first.Den * second.Den;
                    if (Locate(den * c.X + num * ex, den * c.Z + num * ez, outer, den) == Out)
                    {
                        return false;
                    }
                }
            }
            return true;
        }

        // The integer arc length to each vertex: the sum of the floors of the segments' lengths
        // (5.4.18 (5)).
        public static long[] ArcLengths(IReadOnlyList<P2> polyline)
        {
            var arcs = new long[polyline.Count];
            for (int i = 1; i < polyline.Count; i++)
            {
                long dx = polyline[i].X - polyline[i - 1].X, dz = polyline[i].Z - polyline[i - 1].Z;
                arcs[i] = arcs[i - 1] + Isqrt(Mul(dx, dx) + Mul(dz, dz));
            }
            return arcs;
        }

        // The floor of the square root of a whole number that is not negative.
        public static long Isqrt(BigInteger n)
        {
            if (n.Sign < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(n), "a negative number has no square root");
            }
            if (n.IsZero)
            {
                return 0;
            }
            // Newton's iteration from above, in whole numbers, from a power of two at or above the
            // root: n < 2^bits, so its root is below 2^((bits + 1) / 2).
            int bits = n.ToByteArray().Length * 8;
            BigInteger x = BigInteger.One << ((bits + 1) / 2);
            while (true)
            {
                BigInteger y = (x + n / x) >> 1;
                if (y >= x)
                {
                    return (long)x;
                }
                x = y;
            }
        }

        public static BigInteger Squared(P2 a, P2 b)
        {
            long dx = a.X - b.X, dz = a.Z - b.Z;
            return Mul(dx, dx) + Mul(dz, dz);
        }
    }

    // Least x, least z, greatest x, greatest z.
    public readonly struct Box
    {
        public readonly long MinX, MinZ, MaxX, MaxZ;

        public Box(long minX, long minZ, long maxX, long maxZ)
        {
            MinX = minX;
            MinZ = minZ;
            MaxX = maxX;
            MaxZ = maxZ;
        }

        public static Box Of(IReadOnlyList<P2> points)
        {
            long minX = long.MaxValue, minZ = long.MaxValue, maxX = long.MinValue, maxZ = long.MinValue;
            foreach (P2 p in points)
            {
                minX = Math.Min(minX, p.X);
                minZ = Math.Min(minZ, p.Z);
                maxX = Math.Max(maxX, p.X);
                maxZ = Math.Max(maxZ, p.Z);
            }
            return new Box(minX, minZ, maxX, maxZ);
        }

        public Box Grown(long by) => new Box(MinX - by, MinZ - by, MaxX + by, MaxZ + by);

        // Whether two boxes prove their shapes `gap` or more apart: they are along one axis.
        public static bool Apart(Box a, Box b, long gap) => a.MinX - b.MaxX >= gap || b.MinX - a.MaxX >= gap || a.MinZ - b.MaxZ >= gap || b.MinZ - a.MaxZ >= gap;
    }
}
