using System;
using System.Collections.Generic;
using UnityEngine;

namespace Eternities.Kits
{
    // The reserved ground as its shapes, for what the grid cannot decide (PRD v4 8.4.2): the
    // distance from a point to the nearest path, leg, approach or corridor as a strip of its half
    // width, pad, stone or the plaza as a disc, and stand footprint or apron as a rectangle, by
    // cells of a few metres.
    public sealed partial class DressPlan
    {
        sealed class ShapeIndex
        {
            const float Cell = 8;
            readonly Dictionary<long, List<int>> cells = new Dictionary<long, List<int>>();
            readonly List<(Vector2 A, Vector2 B, float Half)> strips = new List<(Vector2, Vector2, float)>();
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

            public void Strip(IReadOnlyList<Vector2> points, float half)
            {
                for (int i = 0; i < Mathf.Max(1, points.Count - 1); i++)
                {
                    Vector2 a = points[i], b = points[Mathf.Min(i + 1, points.Count - 1)];
                    strips.Add((a, b, half));
                    Index(strips.Count - 1, Vector2.Min(a, b) - Vector2.one * half, Vector2.Max(a, b) + Vector2.one * half);
                }
            }

            public void Disc(Vector2 centre, float radius) => Strip(new[] { centre }, radius);

            public void Polygon(Vector2[] corners)
            {
                polygons.Add(corners);
                Vector2 min = corners[0], max = corners[0];
                foreach (Vector2 corner in corners)
                {
                    min = Vector2.Min(min, corner);
                    max = Vector2.Max(max, corner);
                }
                Index(-polygons.Count, min, max);
            }

            // How far a point is from the nearest shape, up to a few metres; no farther than `reach`.
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
                        (Vector2 a, Vector2 b, float half) = strips[shape];
                        d = Mathf.Sqrt(Raster.SquaredToSegment(point, a, b)) - half;
                    }
                    else
                    {
                        Vector2[] corners = polygons[-shape - 1];
                        d = float.MaxValue;
                        bool inside = false;
                        for (int i = 0, j = corners.Length - 1; i < corners.Length; j = i++)
                        {
                            d = Mathf.Min(d, Mathf.Sqrt(Raster.SquaredToSegment(point, corners[j], corners[i])));
                            if ((corners[i].y > point.y) != (corners[j].y > point.y)
                                && point.x < (corners[j].x - corners[i].x) * (point.y - corners[i].y) / (corners[j].y - corners[i].y) + corners[i].x)
                            {
                                inside = !inside;
                            }
                        }
                        d = inside ? 0 : d;
                    }
                    best = Mathf.Min(best, Mathf.Max(0, d));
                }
                return best;
            }
        }

        ShapeIndex shapes;

        // How far a point lies from the nearest reserved shape, on the shapes themselves, up to `reach`.
        public float ClearanceAt(Vector2 point, float reach) => shapes.Clearance(point, reach);
    }
}
