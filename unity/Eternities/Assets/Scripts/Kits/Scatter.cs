using System;
using System.Collections.Generic;
using UnityEngine;

namespace Eternities.Kits
{
    // What the scatter needs of a kit prop, read on the main thread before the plan runs on its
    // own: where the mesh stands in its prefab, and the radius it takes on the ground.
    public struct PropShape
    {
        public Vector3 Offset;
        public Quaternion Turn;
        public float Scale;
        public float Footprint;     // metres at the prefab's own size
        public float Height;        // metres at the prefab's own size
    }

    // A world's props (PRD v4 8.4.2): seeded, run after the pack is read, following each region's
    // variant, and keeping clear of stands, aprons, corridors, the trail, site paths, pads, stones
    // and hero volumes by the 1 m prop clearance and the prop's own footprint, and out of the
    // water. Every prop has its place on the ground, whoever looks at it: a cell of the ground
    // draws its props from its own coordinates, so the same ground holds the same props on every
    // machine and from every place the walker stands (DEC-1055, N17).
    //
    // The trees, bushes, rocks and the growth seen across a field are placed once for the whole
    // world, here. Ground cover is too many to place once: `PropField` asks for a cell's whenever
    // the walker comes near it, from the same rule.
    public sealed class Scatter
    {
        // One kind of prop: a growth of a variant, merged with the same prefab in another.
        public sealed class Kind
        {
            public string Prefab, Category;
            public bool Far, Low;
            public PropShape Shape;
            public int Variant, Growth;     // where the scene holds its `KitProp`
        }

        public struct Instance
        {
            public Vector3 Position;
            public float Yaw, Scale, Rank;
        }

        // The static props stand in cells of this many metres, each kind's in a run of its own,
        // nearest-first by rank: a cell draws the first so many of a run (`PropField`).
        public const float Cell = 32;
        // Ground cover is asked for by cells of this many metres.
        public const float CoverCell = 4;
        // The cells a growth's candidates are drawn in, in metres.
        const float DrawCell = 8;
        // Beyond the world's edge the wood thickens, so the world ends in trees (PRD v4 5.1.5).
        const float EdgeBoost = 1.5f;

        public readonly DressPlan Plan;
        public readonly Kind[] Kinds;
        public readonly float Density;
        public int Cells;                       // a side
        public Matrix4x4[] Matrices;            // every static prop, by cell, kind and rank
        public Instance[] Instances;            // the same, as places
        public int[] RunStart, RunCount;        // by `cell × Kinds.Length + kind`
        public readonly int[] ByKind;

        public Scatter(DressPlan plan, Kind[] kinds, float density)
        {
            Plan = plan;
            Kinds = kinds;
            Density = density;
            ByKind = new int[kinds.Length];
        }

        // The kinds of a set of variants: one for each prefab, in the order the variants first grow it.
        public static Kind[] KindsOf(Variant[] variants, Func<int, int, PropShape> shape)
        {
            var kinds = new List<Kind>();
            for (int v = 0; v < variants.Length; v++)
            {
                for (int g = 0; g < variants[v].Grows.Length; g++)
                {
                    Growth growth = variants[v].Grows[g];
                    if (kinds.Exists(kind => kind.Prefab == growth.Prefab))
                    {
                        continue;
                    }
                    kinds.Add(new Kind
                    {
                        Prefab = growth.Prefab, Category = growth.Category, Far = growth.Far, Low = growth.Category == "GroundCover" && !growth.Far,
                        Shape = shape(v, g), Variant = v, Growth = g,
                    });
                }
            }
            return kinds.ToArray();
        }

        int KindOf(string prefab) => Array.FindIndex(Kinds, kind => kind.Prefab == prefab);

        // Every static prop of the world. Runs on any thread.
        public void PlaceAll()
        {
            Cells = Mathf.CeilToInt(Plan.Grid.Side / Cell);
            var placed = new List<(int Key, Instance Prop)>();
            var variants = new List<Variant>();
            foreach (RegionDress dress in Plan.Regions)
            {
                if (!variants.Contains(dress.Variant))
                {
                    variants.Add(dress.Variant);
                }
            }
            int draws = Mathf.CeilToInt(Plan.Grid.Side / DrawCell);
            foreach (Variant variant in variants)
            {
                for (int g = 0; g < variant.Grows.Length; g++)
                {
                    Growth growth = variant.Grows[g];
                    int kind = KindOf(growth.Prefab);
                    if (Kinds[kind].Low)
                    {
                        continue;
                    }
                    for (int cz = 0; cz < draws; cz++)
                    {
                        for (int cx = 0; cx < draws; cx++)
                        {
                            Candidates(variant, growth, kind, cx, cz, DrawCell, (prop) =>
                            {
                                int cell = Mathf.Clamp(Mathf.FloorToInt((prop.Position.z - Plan.Grid.Min) / Cell), 0, Cells - 1) * Cells
                                    + Mathf.Clamp(Mathf.FloorToInt((prop.Position.x - Plan.Grid.Min) / Cell), 0, Cells - 1);
                                placed.Add((cell * Kinds.Length + kind, prop));
                            });
                        }
                    }
                }
            }
            placed.Sort((a, b) => a.Key != b.Key ? a.Key.CompareTo(b.Key) : a.Prop.Rank.CompareTo(b.Prop.Rank));
            RunStart = new int[Cells * Cells * Kinds.Length];
            RunCount = new int[RunStart.Length];
            Matrices = new Matrix4x4[placed.Count];
            Instances = new Instance[placed.Count];
            for (int i = 0; i < placed.Count; i++)
            {
                (int key, Instance prop) = placed[i];
                if (RunCount[key]++ == 0)
                {
                    RunStart[key] = i;
                }
                Instances[i] = prop;
                Matrices[i] = MatrixOf(Kinds[key % Kinds.Length].Shape, prop);
                ByKind[key % Kinds.Length]++;
            }
        }

        // A prop's place as the matrix that draws its prefab's mesh there: as `KitProp.Stand` places
        // an object, the base at the position, turned by its yaw, at its scale of the prefab.
        public static Matrix4x4 MatrixOf(PropShape shape, Instance prop)
        {
            Quaternion turn = Quaternion.Euler(0, prop.Yaw, 0);
            return Matrix4x4.TRS(prop.Position + turn * (shape.Offset * prop.Scale), turn * shape.Turn, Vector3.one * (prop.Scale * shape.Scale));
        }

        // A growth's props in one cell of `size` metres, each from the cell's own draws: how many
        // stand there at full density, and for each its place, whether it stands at this density,
        // its turn, its size and its rank. A lower density's props are among a higher density's.
        public void Candidates(Variant variant, Growth growth, int kind, int cx, int cz, float size, Action<Instance> found)
        {
            float boost = Kinds[kind].Category == "Trees" || Kinds[kind].Category == "Bushes" ? 1 + EdgeBoost : 1;
            float expected = growth.PerAre / 100 * size * size * boost;
            uint seed = (uint)kind * 0x9E3779B9u ^ 0x5bd1e995u;
            int count = Mathf.FloorToInt(expected + Raster.Hash(cx, cz, seed));
            float x0 = Plan.Grid.Min + cx * size, z0 = Plan.Grid.Min + cz * size;
            for (int i = 0; i < count; i++)
            {
                uint s = seed + (uint)i * 0x632BE5ABu;
                float x = x0 + Raster.Hash(cx, cz, s + 1) * size, z = z0 + Raster.Hash(cx, cz, s + 2) * size;
                float keep = Raster.Hash(cx, cz, s + 3), pick = Raster.Hash(cx, cz, s + 4);
                if (x <= Plan.Grid.Min || z <= Plan.Grid.Min || x >= -Plan.Grid.Min || z >= -Plan.Grid.Min)
                {
                    continue;
                }
                int texel = Plan.Grid.At(x, z);
                float share = Plan.Share(texel);
                RegionDress dress = Plan.Regions[pick < share ? Plan.Other[texel] : Plan.Region[texel]];
                if (dress.Variant != variant)
                {
                    continue;
                }
                float beyond = Mathf.Sqrt(x * x + z * z) - Plan.Radius;
                float here = boost > 1 ? 1 + EdgeBoost * Mathf.SmoothStep(0, 1, (beyond + 10) / 70) : 1;
                if (keep * boost >= Density * dress.Growth * here)
                {
                    continue;
                }
                float scale = Mathf.Lerp(growth.ScaleFrom, growth.ScaleTo, Raster.Hash(cx, cz, s + 5));
                if (!Allowed(Kinds[kind], texel, x, z, scale))
                {
                    continue;
                }
                found(new Instance
                {
                    Position = new Vector3(x, Plan.HeightAt(x, z) - 0.05f * Kinds[kind].Shape.Height * scale * 0.02f, z),
                    Yaw = Raster.Hash(cx, cz, s + 6) * 360, Scale = scale, Rank = Raster.Hash(cx, cz, s + 7),
                });
            }
        }

        // The rules of 8.4.2 for one prop: the clearance and its footprint from everything
        // reserved (with a texel's half diagonal, for the grid), dry ground, and the clusters' discs
        // open of anything that stands above a stand's plinth.
        public bool Allowed(Kind kind, int texel, float x, float z, float scale)
        {
            // The grid decides far from anything reserved: its distance is between texels' middles,
            // each up to half a diagonal from what it stands for. Nearer, the shapes decide.
            float needed = DressPlan.PropClearance + kind.Shape.Footprint * scale;
            if (Plan.FromReserved[texel] < needed + 2 * Plan.Grid.Texel * 0.7072f && Plan.ClearanceAt(new Vector2(x, z), needed + 0.01f) < needed)
            {
                return false;
            }
            if (Plan.Wet[texel] == DressPlan.WetLava || Plan.HeightAt(x, z) < DressPlan.WaterLevel + 0.06f)
            {
                return false;
            }
            bool tall = kind.Category == "Trees" || (kind.Category == "Bushes" && !kind.Far && kind.Shape.Height * scale > 1);
            return !(tall && Plan.Cluster[texel]);
        }

        // One cell's ground cover, about the walker (`PropField`): every low growth of the
        // variants that grow in the cell.
        public void CoverIn(int cx, int cz, Action<int, Instance> found)
        {
            float x = Plan.Grid.Min + (cx + 0.5f) * CoverCell, z = Plan.Grid.Min + (cz + 0.5f) * CoverCell;
            if (x <= Plan.Grid.Min || z <= Plan.Grid.Min || x >= -Plan.Grid.Min || z >= -Plan.Grid.Min)
            {
                return;
            }
            int texel = Plan.Grid.At(x, z);
            Variant a = Plan.Regions[Plan.Region[texel]].Variant, b = Plan.Regions[Plan.Other[texel]].Variant;
            foreach (Variant variant in a == b ? new[] { a } : new[] { a, b })
            {
                foreach (Growth growth in variant.Grows)
                {
                    int kind = KindOf(growth.Prefab);
                    if (Kinds[kind].Low)
                    {
                        Candidates(variant, growth, kind, cx, cz, CoverCell, prop => found(kind, prop));
                    }
                }
            }
        }
    }
}
