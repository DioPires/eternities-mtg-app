using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;

namespace Eternities.Kits
{
    // The ground's layers (PRD v4 5.6.3, 8.4.5): every path, approach, pad and the plaza in the
    // kit's path layer, the trail with a worn verge so that it reads as a road, and each stand's
    // apron and corridor worn into the region's own ground; gravel in a river's bed, on its banks,
    // at a lake's shore and on the sea's beach; and everywhere else each region's variant, its
    // layers mixed by noise a few metres across, running into its neighbour's over 20 m. The
    // weights are baked here, once, into each tile's alphamap.
    public sealed partial class DressPlan
    {
        public const string PathLayer = "path", GravelLayer = "gravel";
        // Unity Terrain draws at most eight layers on one tile in HDRP.
        public const int TileLayersMost = 8;

        // A variant's layers by noise: the noise's own value below which each layer's share of
        // the ground lies, as `Variants.Paint` finds it on a patch.
        sealed class Mix
        {
            public int[] Layers;
            public float[] Steps;
        }

        Mix[] mixes;            // by region
        Distances fromShore;    // metres from water that has a gravel shore

        void Paint()
        {
            var names = new List<string> { PathLayer, GravelLayer };
            foreach (RegionDress dress in Regions)
            {
                foreach ((string layer, float _) in dress.Variant.Ground)
                {
                    if (!names.Contains(layer))
                    {
                        names.Add(layer);
                    }
                }
            }
            LayerNames = names.ToArray();

            // The noise's spread, from a fixed sample of the ground.
            uint seed = Seed("layers");
            var sample = new float[16384];
            for (int i = 0; i < sample.Length; i++)
            {
                sample[i] = MixNoise(Raster.Hash(i, 1, seed) * Grid.Side, Raster.Hash(i, 2, seed) * Grid.Side, seed);
            }
            Array.Sort(sample);
            mixes = new Mix[Regions.Length];
            for (int r = 0; r < Regions.Length; r++)
            {
                (string Layer, float Share)[] ground = Regions[r].Variant.Ground;
                var mix = new Mix { Layers = new int[ground.Length], Steps = new float[ground.Length - 1] };
                float below = 0;
                for (int k = 0; k < ground.Length; k++)
                {
                    mix.Layers[k] = names.IndexOf(ground[k].Layer);
                    if (k < mix.Steps.Length)
                    {
                        below += ground[k].Share;
                        mix.Steps[k] = sample[Mathf.Clamp(Mathf.RoundToInt(below * (sample.Length - 1)), 0, sample.Length - 1)];
                    }
                }
                mixes[r] = mix;
            }

            var shore = new bool[Grid.Count];
            for (int i = 0; i < shore.Length; i++)
            {
                shore[i] = Wet[i] == WetRiver || Wet[i] == WetSea || Wet[i] == WetStill;
            }
            fromShore = DistanceTo(shore);

            // Each worker weighs its tiles in one scratch grid of every layer's weight.
            TileLayers = new TileLayers[Tiles * Tiles];
            Parallel.For(0, Tiles * Tiles, () => new float[TileTexels * TileTexels * LayerNames.Length], (tile, _, all) =>
            {
                TileLayers[tile] = PaintTile(tile % Tiles, tile / Tiles, seed, all);
                return all;
            }, _ => { });
            fromShore = null;
            mixes = null;
        }

        static float MixNoise(float x, float z, uint seed) => 0.65f * Raster.Noise(x / 9, z / 9, seed) + 0.35f * Raster.Noise(x / 2.5f, z / 2.5f, seed + 1);

        // Every layer's weight on one texel, into `weights`.
        void Weigh(int row, int column, uint seed, float[] weights)
        {
            Array.Clear(weights, 0, weights.Length);
            int texel = row * N + column;
            float x = Grid.X(column), z = Grid.Z(row);
            float above = HeightAt(x, z) - WaterLevel;
            float gravel = fromShore[texel] > 9 ? 0 : (1 - Mathf.SmoothStep(0, 1, (above - 0.15f) / 0.65f)) * (1 - Mathf.SmoothStep(0, 1, (fromShore[texel] - 4) / 5));
            float path = 1 - Mathf.SmoothStep(0, 1, FromPath[texel] / 1.1f);
            path = Mathf.Max(path, 0.3f * (1 - Mathf.SmoothStep(0, 1, (FromTrail[texel] - 0.8f) / 1.8f)));
            // A stand's apron and corridor are walked on: the ground there is worn, not a path.
            path = Mathf.Max(path, 0.35f * (1 - Mathf.SmoothStep(0, 1, FromWorn[texel] / 0.8f)));
            weights[1] = gravel;
            weights[0] = (1 - gravel) * path;
            float rest = (1 - gravel) * (1 - path);
            if (rest <= 0)
            {
                return;
            }
            float noise = MixNoise(x, z, seed), share = Share(texel);
            Spread(mixes[Region[texel]], noise, rest * (1 - share), weights);
            if (share > 0)
            {
                Spread(mixes[Other[texel]], noise, rest * share, weights);
            }
        }

        static void Spread(Mix mix, float noise, float amount, float[] weights)
        {
            const float Soft = 0.07f;
            float left = 1;
            for (int k = 0; k < mix.Layers.Length; k++)
            {
                float here = k < mix.Steps.Length ? left * (1 - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(mix.Steps[k] - Soft, mix.Steps[k] + Soft, noise))) : left;
                weights[mix.Layers[k]] += amount * here;
                left -= here;
            }
        }

        // One tile's alphamap: the layers it uses, at most eight, the least of them dropped if it
        // uses more, and every texel's weights over them summing to one. `all` is scratch, every
        // layer's weight on every texel of the tile.
        TileLayers PaintTile(int tileX, int tileZ, uint seed, float[] all)
        {
            int side = TileTexels, layers = LayerNames.Length;
            var weights = new float[layers];
            var total = new double[layers];
            var most = new float[layers];
            for (int r = 0; r < side; r++)
            {
                for (int c = 0; c < side; c++)
                {
                    Weigh(tileZ * side + r, tileX * side + c, seed, weights);
                    int at = (r * side + c) * layers;
                    for (int k = 0; k < layers; k++)
                    {
                        all[at + k] = weights[k];
                        total[k] += weights[k];
                        most[k] = Mathf.Max(most[k], weights[k]);
                    }
                }
            }
            var used = new List<int>();
            for (int k = 0; k < layers; k++)
            {
                if (most[k] > 0.02f)
                {
                    used.Add(k);
                }
            }
            if (used.Count == 0)
            {
                used.Add(0);
            }
            int dropped = 0;
            if (used.Count > TileLayersMost)
            {
                used.Sort((a, b) => total[b].CompareTo(total[a]));
                dropped = used.Count - TileLayersMost;
                used.RemoveRange(TileLayersMost, dropped);
                used.Sort();
            }
            int count = used.Count;
            var tile = new TileLayers { Layers = used.ToArray(), Weights = new byte[side * side * count], Dropped = dropped };
            var rest = new float[count];
            for (int r = 0; r < side; r++)
            {
                for (int c = 0; c < side; c++)
                {
                    int at = (r * side + c) * layers, to = (r * side + c) * count;
                    float sum = 0;
                    foreach (int k in used)
                    {
                        sum += all[at + k];
                    }
                    // In 255ths, each rounded down, and what that leaves to the largest remainders.
                    int given = 0;
                    for (int u = 0; u < count; u++)
                    {
                        float share = 255 * (sum > 0 ? all[at + used[u]] / sum : (u == 0 ? 1 : 0));
                        int whole = (int)share;
                        tile.Weights[to + u] = (byte)whole;
                        rest[u] = share - whole;
                        given += whole;
                    }
                    for (; given < 255; given++)
                    {
                        int largest = 0;
                        for (int u = 1; u < count; u++)
                        {
                            largest = rest[u] > rest[largest] ? u : largest;
                        }
                        tile.Weights[to + largest]++;
                        rest[largest] = -1;
                    }
                }
            }
            return tile;
        }
    }
}
