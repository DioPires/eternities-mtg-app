using System;

namespace Eternities.Layout
{
    // Exact intersection tests on integer millimetres for the allocator (PRD v4 5.4.8 to 5.4.10).
    // Two shapes that only touch count as intersecting: the allocator tests shapes inflated by the
    // jitter radius, and a touch there is a real gap of zero after the jitter.
    public static class Shapes
    {
        // A rectangle in a stand's frame: `along` runs toward the path point, `across` to its right.
        // `origin` is the stand's position, `forward` the vector to the path point and `length` its
        // length. Corners are rounded to the millimetre.
        public static P2[] Rect(P2 origin, P2 forward, long length, long alongFrom, long alongTo, long halfAcross)
        {
            return new[]
            {
                Corner(origin, forward, length, alongFrom, -halfAcross),
                Corner(origin, forward, length, alongFrom, halfAcross),
                Corner(origin, forward, length, alongTo, halfAcross),
                Corner(origin, forward, length, alongTo, -halfAcross),
            };
        }

        public static P2 Corner(P2 origin, P2 forward, long length, long along, long across)
        {
            return new P2(
                origin.X + Fixed.RoundDiv(forward.X * along + forward.Z * across, length),
                origin.Z + Fixed.RoundDiv(forward.Z * along - forward.X * across, length));
        }

        // Convex polygons, by separating axes.
        public static bool Intersect(P2[] a, P2[] b)
        {
            return !Separated(a, b) && !Separated(b, a);
        }

        static bool Separated(P2[] edges, P2[] other)
        {
            for (int i = 0; i < edges.Length; i++)
            {
                P2 edge = edges[(i + 1) % edges.Length] - edges[i];
                var axis = new P2(edge.Z, -edge.X);
                Project(edges, axis, out long min1, out long max1);
                Project(other, axis, out long min2, out long max2);
                if (max1 < min2 || max2 < min1)
                {
                    return true;
                }
            }
            return false;
        }

        static void Project(P2[] polygon, P2 axis, out long min, out long max)
        {
            min = long.MaxValue;
            max = long.MinValue;
            foreach (P2 p in polygon)
            {
                long d = P2.Dot(p, axis);
                min = Math.Min(min, d);
                max = Math.Max(max, d);
            }
        }

        public static bool Contains(P2[] convex, P2 p)
        {
            bool positive = false, negative = false;
            for (int i = 0; i < convex.Length; i++)
            {
                long side = P2.Clockwise(convex[(i + 1) % convex.Length] - convex[i], p - convex[i]);
                positive |= side > 0;
                negative |= side < 0;
            }
            return !(positive && negative);
        }

        // Is the segment a-b within `radius` of `centre`?
        public static bool SegmentWithin(P2 a, P2 b, P2 centre, long radius)
        {
            P2 ab = b - a, ac = centre - a;
            long length2 = ab.LengthSquared;
            long along = P2.Dot(ac, ab);
            if (length2 == 0 || along <= 0)
            {
                return ac.LengthSquared <= radius * radius;
            }
            if (along >= length2)
            {
                return (centre - b).LengthSquared <= radius * radius;
            }
            // The foot of the perpendicular is inside the segment: distance squared is cross squared
            // over length squared. The products pass 64 bits, so they are taken in decimal, which is
            // exact for integers of this size.
            decimal cross = P2.Clockwise(ab, ac);
            return cross * cross <= (decimal)radius * radius * length2;
        }

        public static bool IntersectsDisc(P2[] convex, P2 centre, long radius)
        {
            if (Contains(convex, centre))
            {
                return true;
            }
            for (int i = 0; i < convex.Length; i++)
            {
                if (SegmentWithin(convex[i], convex[(i + 1) % convex.Length], centre, radius))
                {
                    return true;
                }
            }
            return false;
        }

        // An annulus about the origin. A convex polygon's distances from the origin fill the whole
        // range from its nearest point to its farthest corner, so it meets the annulus when the two
        // ranges overlap.
        public static bool IntersectsAnnulus(P2[] convex, long inner, long outer)
        {
            long farthest2 = 0;
            foreach (P2 p in convex)
            {
                farthest2 = Math.Max(farthest2, p.LengthSquared);
            }
            return farthest2 >= inner * inner && IntersectsDisc(convex, default, outer);
        }

        // The point of a segment nearest to p, rounded to the millimetre.
        public static P2 NearestOnSegment(P2 a, P2 b, P2 p)
        {
            P2 ab = b - a;
            long length2 = ab.LengthSquared;
            long along = P2.Dot(p - a, ab);
            if (length2 == 0 || along <= 0)
            {
                return a;
            }
            if (along >= length2)
            {
                return b;
            }
            // along is at most length2, which is at most the square of a spur's length: the products
            // stay far inside 64 bits.
            return new P2(a.X + Fixed.RoundDiv(ab.X * along, length2), a.Z + Fixed.RoundDiv(ab.Z * along, length2));
        }
    }
}
