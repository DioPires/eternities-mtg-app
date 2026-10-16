using System;
using System.Collections.Generic;
using UnityEngine;

namespace Eternities.Kits
{
    // A square grid of texels over a world's ground, centred on the arrival point: what the
    // dressing reads its shapes onto (PRD v4 8.4.5). Texel (row, column) covers the square whose
    // lower corner is (Min + column × Texel, Min + row × Texel) in metres, x east and z north, and
    // a height sample stands on each corner, so there is one more sample a side than texels.
    public sealed class Raster
    {
        public readonly int N;
        public readonly float Side, Texel, Min;

        public Raster(float side, int texels)
        {
            N = texels;
            Side = side;
            Texel = side / texels;
            Min = -side / 2;
        }

        public int Count => N * N;

        // The middle of a texel, in metres.
        public float X(int column) => Min + (column + 0.5f) * Texel;
        public float Z(int row) => Min + (row + 0.5f) * Texel;

        // The texel a point lies in, held to the grid.
        public int Column(float x) => Mathf.Clamp(Mathf.FloorToInt((x - Min) / Texel), 0, N - 1);
        public int Row(float z) => Mathf.Clamp(Mathf.FloorToInt((z - Min) / Texel), 0, N - 1);
        public int At(float x, float z) => Row(z) * N + Column(x);

        // Marks every texel whose middle lies within `radius` of a point.
        public void Disc(bool[] mask, Vector2 centre, float radius)
        {
            int c0 = Column(centre.x - radius), c1 = Column(centre.x + radius), r0 = Row(centre.y - radius), r1 = Row(centre.y + radius);
            float r2 = radius * radius;
            for (int row = r0; row <= r1; row++)
            {
                float dz = Z(row) - centre.y;
                for (int column = c0; column <= c1; column++)
                {
                    float dx = X(column) - centre.x;
                    if (dx * dx + dz * dz <= r2)
                    {
                        mask[row * N + column] = true;
                    }
                }
            }
        }

        // Marks every texel whose middle lies within `half` of a segment.
        public void Segment(bool[] mask, Vector2 a, Vector2 b, float half)
        {
            float x0 = Mathf.Min(a.x, b.x) - half, x1 = Mathf.Max(a.x, b.x) + half, z0 = Mathf.Min(a.y, b.y) - half, z1 = Mathf.Max(a.y, b.y) + half;
            int c0 = Column(x0), c1 = Column(x1), r0 = Row(z0), r1 = Row(z1);
            float h2 = half * half;
            for (int row = r0; row <= r1; row++)
            {
                for (int column = c0; column <= c1; column++)
                {
                    if (SquaredToSegment(new Vector2(X(column), Z(row)), a, b) <= h2)
                    {
                        mask[row * N + column] = true;
                    }
                }
            }
        }

        // The same along a polyline: a strip of `half` metres each side of it.
        public void Strip(bool[] mask, IReadOnlyList<Vector2> polyline, float half)
        {
            if (polyline.Count == 1)
            {
                Disc(mask, polyline[0], half);
            }
            for (int i = 0; i + 1 < polyline.Count; i++)
            {
                Segment(mask, polyline[i], polyline[i + 1], half);
            }
        }

        // Marks every texel whose middle lies inside a polygon, by the even-odd rule along each
        // row: a blob, a cell or a footprint.
        public void Polygon(bool[] mask, IReadOnlyList<Vector2> polygon)
        {
            Fill(polygon, (row, from, to) =>
            {
                for (int column = from; column <= to; column++)
                {
                    mask[row * N + column] = true;
                }
            });
        }

        // Calls `span(row, first column, last column)` for every run of texels whose middles lie
        // inside a polygon, by the even-odd rule.
        public void Fill(IReadOnlyList<Vector2> polygon, Action<int, int, int> span)
        {
            float zMin = float.MaxValue, zMax = float.MinValue;
            foreach (Vector2 p in polygon)
            {
                zMin = Mathf.Min(zMin, p.y);
                zMax = Mathf.Max(zMax, p.y);
            }
            var crossings = new List<float>();
            for (int row = Row(zMin); row <= Row(zMax); row++)
            {
                float z = Z(row);
                crossings.Clear();
                for (int i = 0; i < polygon.Count; i++)
                {
                    Vector2 a = polygon[i], b = polygon[(i + 1) % polygon.Count];
                    if ((a.y <= z && z < b.y) || (b.y <= z && z < a.y))
                    {
                        crossings.Add(a.x + (z - a.y) / (b.y - a.y) * (b.x - a.x));
                    }
                }
                crossings.Sort();
                for (int k = 0; k + 1 < crossings.Count; k += 2)
                {
                    int from = Mathf.CeilToInt((crossings[k] - Min) / Texel - 0.5f), to = Mathf.FloorToInt((crossings[k + 1] - Min) / Texel - 0.5f);
                    from = Mathf.Max(from, 0);
                    to = Mathf.Min(to, N - 1);
                    if (from <= to)
                    {
                        span(row, from, to);
                    }
                }
            }
        }

        public static float SquaredToSegment(Vector2 p, Vector2 a, Vector2 b)
        {
            Vector2 ab = b - a;
            float length = ab.sqrMagnitude;
            float t = length > 0 ? Mathf.Clamp01(Vector2.Dot(p - a, ab) / length) : 0;
            return (a + ab * t - p).sqrMagnitude;
        }

        // The distance in metres from every texel's middle to the middle of the nearest marked
        // texel, exact on the grid (Felzenszwalb and Huttenlocher's transform), and, when asked,
        // which texel that is. With no texel marked every distance is `float.MaxValue`.
        public float[] Distance(bool[] mask, int[] nearest = null)
        {
            const double Far = 1e20;
            int n = N;
            var squared = new double[n * n];
            int[] from = nearest ?? new int[n * n];
            var f = new double[n];
            var d = new double[n];
            var fi = new int[n];
            var di = new int[n];
            var v = new int[n];
            var z = new double[n + 1];
            // Along each row.
            for (int row = 0; row < n; row++)
            {
                for (int column = 0; column < n; column++)
                {
                    bool marked = mask[row * n + column];
                    f[column] = marked ? 0 : Far;
                    fi[column] = marked ? row * n + column : -1;
                }
                Pass(f, fi, d, di, v, z, n);
                for (int column = 0; column < n; column++)
                {
                    squared[row * n + column] = d[column];
                    from[row * n + column] = di[column];
                }
            }
            // Along each column, over the rows' results.
            for (int column = 0; column < n; column++)
            {
                for (int row = 0; row < n; row++)
                {
                    f[row] = squared[row * n + column];
                    fi[row] = from[row * n + column];
                }
                Pass(f, fi, d, di, v, z, n);
                for (int row = 0; row < n; row++)
                {
                    squared[row * n + column] = d[row];
                    from[row * n + column] = di[row];
                }
            }
            var metres = new float[n * n];
            for (int i = 0; i < metres.Length; i++)
            {
                metres[i] = squared[i] >= Far / 2 ? float.MaxValue : (float)(Math.Sqrt(squared[i]) * Texel);
            }
            return metres;
        }

        // The lower envelope of the parabolas (q − p)² + f(q), along one line.
        static void Pass(double[] f, int[] fi, double[] d, int[] di, int[] v, double[] z, int n)
        {
            int k = -1;
            for (int q = 0; q < n; q++)
            {
                if (f[q] >= 1e19)
                {
                    continue;
                }
                double s = double.NegativeInfinity;
                while (k >= 0)
                {
                    s = (f[q] + (double)q * q - (f[v[k]] + (double)v[k] * v[k])) / (2.0 * q - 2.0 * v[k]);
                    if (s > z[k])
                    {
                        break;
                    }
                    k--;
                }
                k++;
                v[k] = q;
                z[k] = k == 0 ? double.NegativeInfinity : s;
                z[k + 1] = double.PositiveInfinity;
            }
            if (k < 0)
            {
                for (int q = 0; q < n; q++)
                {
                    d[q] = 1e20;
                    di[q] = -1;
                }
                return;
            }
            int j = 0;
            for (int q = 0; q < n; q++)
            {
                while (z[j + 1] < q)
                {
                    j++;
                }
                double dq = q - v[j];
                d[q] = dq * dq + f[v[j]];
                di[q] = fi[v[j]];
            }
        }

        // Value noise from 0 to 1 between lattice points one unit apart, the same on every machine.
        public static float Noise(float x, float z, uint seed)
        {
            int x0 = Mathf.FloorToInt(x), z0 = Mathf.FloorToInt(z);
            float u = Smooth(x - x0), w = Smooth(z - z0);
            return Mathf.Lerp(Mathf.Lerp(Hash(x0, z0, seed), Hash(x0 + 1, z0, seed), u),
                Mathf.Lerp(Hash(x0, z0 + 1, seed), Hash(x0 + 1, z0 + 1, seed), u), w);
        }

        // An integer hash of a lattice point, from 0 to 1, the same on every machine.
        public static float Hash(int x, int z, uint seed)
        {
            unchecked
            {
                uint h = (uint)x * 0x85EBCA6Bu ^ (uint)z * 0xC2B2AE35u ^ seed * 0x27D4EB2Fu;
                h ^= h >> 15;
                h *= 0x2C1B3C6Du;
                h ^= h >> 12;
                h *= 0x297A2D39u;
                h ^= h >> 15;
                return (h & 0xFFFFFF) / (float)0x1000000;
            }
        }

        // Noise in octaves, from 0 to 1: `octaves` layers, each twice as fine and half as strong.
        public static float Fractal(float x, float z, uint seed, int octaves)
        {
            float sum = 0, weight = 1, total = 0;
            for (int o = 0; o < octaves; o++)
            {
                sum += Noise(x, z, seed + (uint)o * 7919u) * weight;
                total += weight;
                weight *= 0.5f;
                x *= 2.03f;
                z *= 2.03f;
            }
            return sum / total;
        }

        static float Smooth(float t) => t * t * (3 - 2 * t);
    }
}
