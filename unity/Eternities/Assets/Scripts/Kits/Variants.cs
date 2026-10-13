using System;
using System.Collections.Generic;
using Eternities.Layout;
using UnityEngine;

namespace Eternities.Kits
{
    // One thing that grows or lies in a variant: one of the kit's props, how many of it stand on a
    // hundred square metres at full density, and how large an instance is against its prefab.
    public sealed class Growth
    {
        public string Prefab;       // under the kit's `Prefabs/`, without its extension
        public float PerAre;
        public float ScaleFrom = 0.85f, ScaleTo = 1.2f;

        public string Category => Prefab.Substring(0, Prefab.IndexOf('/'));
        public string Name => Prefab.Substring(Prefab.LastIndexOf('/') + 1);
    }

    // One of a kit's variants (PRD v4 5.6.3, 8.12.1): what a region's row names. It is a ground
    // layer mix, a prop set and a density, and nothing of where a region lies: the dressing of a
    // region with its variant is the layout's (PRD v4 9.6, leg 2).
    public sealed class Variant
    {
        public string Name;
        // The kit's terrain layers under `TerrainLayers/`, each with the share of the ground it
        // takes. The shares sum to 1.
        public (string Layer, float Share)[] Ground;
        public Growth[] Grows;

        public override string ToString() => Name;
    }

    // A variant as the scene holds it, assigned by the generation entry point: its layers in the
    // order of `Variant.Ground` and its props in the order of `Variant.Grows`. A build carries
    // what the scene names, so the kit's cooked size counts every variant's assets.
    [Serializable]
    public sealed class KitVariant
    {
        public string Name;
        public TerrainLayer[] Layers;
        public KitProp[] Props;
    }

    public static class Variants
    {
        // Ground cover is drawn about the viewer and not across a world: it thins out from
        // `CoverNear` and is gone at `CoverFar`, in metres. A tuft a hand high is a few pixels
        // there.
        public const float CoverNear = 12, CoverFar = 26;

        // The temperate kit's four (PRD v4 9.6; DEC-1003): a field, a wood, wet ground and bare
        // dark rock. The densities are a first setting for the owner's eye. At 24 tufts a square
        // metre, which is the meadow at the medium level, the ground still shows between them.
        // The trees and bushes are their sources cut to levels by the kit's `Derive/` scripts (PRD
        // v4 7.6.4; the owner's answer of 2026-10-13 on DEC-1003): a mixed wood of firs and
        // broadleaves over young trees, a few trees standing alone in the meadow, and low bushes and
        // stunted trees on the highland. The marsh's tall plants are clumps of sedge set from
        // scanned stems; no CC0 source has a whole reed.
        public static readonly Variant[] Temperate =
        {
            new Variant
            {
                Name = "meadow",
                Ground = new[] { ("ground037", 0.7f), ("forrest_ground_01", 0.3f) },
                Grows = Some(
                    Each("GroundCover/grass_medium_01_", 2400, 1.4f, 2, "mid_a", "mid_b", "mid_c", "small_a", "small_b", "tall_a", "tall_b", "tall_c"),
                    Each("GroundCover/grass_medium_02_", 1500, 1.3f, 2, "a", "b", "c", "d", "e"),
                    Each("GroundCover/dandelion_01_", 60, 1, 1.6f, "a", "b", "c", "d", "e"),
                    Each("GroundCover/celandine_01_", 60, 1, 1.6f, "a", "b", "e"),
                    Each("GroundCover/weed_plant_02_", 20, 1, 1.6f, "a", "b", "c", "d", "e"),
                    Each("Rocks/rock_moss_set_02_", 0.25f, 0.8f, 1.1f, "rock08", "rock09", "rock12"),
                    Each("Trees/jacaranda_tree", 0.012f, 0.8f, 1.1f, ""),
                    Each("Trees/tree_small_02", 0.04f, 1.2f, 2, "")),
            },
            new Variant
            {
                Name = "wood",
                Ground = new[] { ("forest_leaves_03", 0.65f), ("brown_mud_leaves_01", 0.35f) },
                Grows = Some(
                    Each("GroundCover/fern_02_", 220, 1, 1.8f, "a", "b", "c", "d"),
                    Each("GroundCover/grass_medium_01_", 300, 1.2f, 1.8f, "small_a", "small_b", "mid_c"),
                    Each("GroundCover/shrub_sorrel_01_", 500, 1.4f, 2, "a", "b", "d", "e"),
                    Each("GroundCover/nettle_plant_", 120, 1.4f, 2, "medium_a", "medium_b", "tall_a", "tall_b"),
                    Each("GroundCover/dry_branches_medium_01_", 4, 0.8f, 1.2f, "a", "b", "c"),
                    Each("GroundCover/shrub_02_", 8, 0.9f, 1.3f, "a", "b", "c", "d"),
                    Each("Rocks/rock_moss_set_01_", 0.5f, 0.85f, 1.25f, "rock01", "rock02", "rock03", "rock04", "rock05", "rock06"),
                    Each("Rocks/rock_moss_set_02_", 1.2f, 0.85f, 1.25f, "rock07", "rock08", "rock09", "rock10", "rock11", "rock12", "rock13"),
                    // Tall firs and a few jacarandas are the roof, 14 to 22 m; young firs and two
                    // small broadleaves stand under them, and saplings of the slender tree and the
                    // gnarled one drawn as a shrub close the height between. The leafy bush of a
                    // dry land, `searsia_lucida`, is not of a wood: it grows on the highland.
                    Each("Trees/fir_tree_01_", 0.5f, 0.85f, 1.15f, "a", "b"),
                    Each("Trees/jacaranda_tree", 0.1f, 0.7f, 1.1f, ""),
                    Each("Trees/fir_sapling_medium_", 0.9f, 0.8f, 1.3f, "a", "b", "c"),
                    Each("Trees/tree_small_02", 1, 1.2f, 2, ""),
                    Each("Trees/island_tree_01", 0.5f, 1, 1.8f, ""),
                    Each("Bushes/tree_small_02_sapling", 3, 1, 1.3f, ""),
                    Each("Bushes/island_tree_02", 2, 0.85f, 1.2f, "")),
            },
            new Variant
            {
                Name = "marsh",
                Ground = new[] { ("mud_forest", 0.6f), ("brown_mud_leaves_01", 0.4f) },
                Grows = Some(
                    Each("GroundCover/grass_medium_02_", 800, 1.4f, 2, "c", "d", "e"),
                    Each("GroundCover/shrub_03_", 250, 1.3f, 2, "a", "b", "c", "d"),
                    Each("GroundCover/weed_plant_02_", 80, 1.2f, 2, "a", "b", "c"),
                    Each("GroundCover/nettle_plant_", 80, 1.4f, 2, "tall_a", "tall_b"),
                    Each("GroundCover/fern_02_", 15, 1, 1.5f, "a", "d"),
                    Each("Bushes/carex_dispalata", 20, 1.3f, 2, ""),
                    Each("Bushes/carex_maximowiczii", 20, 1.4f, 2, ""),
                    Each("Rocks/rock_moss_set_02_", 0.4f, 0.85f, 1.2f, "rock07", "rock10", "rock12")),
            },
            new Variant
            {
                Name = "highland",
                Ground = new[] { ("dark_rock_02", 0.6f), ("dark_rock", 0.4f) },
                Grows = Some(
                    Each("GroundCover/grass_medium_02_", 80, 0.8f, 1.4f, "a", "b", "c"),
                    Each("GroundCover/shrub_03_", 25, 1, 1.6f, "c", "d"),
                    Each("GroundCover/dry_branches_medium_01_", 2, 0.8f, 1.2f, "a", "b", "c"),
                    Each("Rocks/boulder_01", 1.2f, 0.6f, 1.8f, ""),
                    Each("Rocks/rock_07", 8, 1, 2, ""),
                    Each("Trees/island_tree_01", 0.04f, 0.6f, 1, ""),
                    Each("Trees/fir_sapling_medium_c", 0.04f, 0.5f, 0.9f, ""),
                    Each("Bushes/searsia_lucida_", 0.6f, 0.7f, 1.1f, "f", "g"),
                    Each("Bushes/island_tree_02", 0.08f, 0.85f, 1, "")),
            },
        };

        static Growth[] Some(params Growth[][] sets)
        {
            var all = new List<Growth>();
            foreach (Growth[] set in sets)
            {
                all.AddRange(set);
            }
            return all.ToArray();
        }

        // Several props of one source, `perAre` of them in all on a hundred square metres.
        static Growth[] Each(string prefix, float perAre, float from, float to, params string[] names)
        {
            var grows = new Growth[names.Length];
            for (int i = 0; i < names.Length; i++)
            {
                grows[i] = new Growth { Prefab = prefix + names[i], PerAre = perAre / names.Length, ScaleFrom = from, ScaleTo = to };
            }
            return grows;
        }

        // A variant's props on a square patch of ground `side` metres wide about the origin, at a
        // share of its full density: which of its growths, where, turned how and how large. Ground
        // cover stands about `viewer` only. The same patch has the same props on every machine,
        // and a lower density's props are among a higher density's: each growth has its own run
        // of draws, five a prop, and a density takes the first so many of them.
        public static List<Prop> Scatter(Variant variant, float side, float density, uint seed, Vector2 viewer)
        {
            var props = new List<Prop>();
            for (int kind = 0; kind < variant.Grows.Length; kind++)
            {
                Growth growth = variant.Grows[kind];
                bool cover = growth.Category == "GroundCover";
                float reach = cover ? Mathf.Min(side, 2 * CoverFar) : side;
                int count = Mathf.RoundToInt(growth.PerAre * reach * reach / 100 * density);
                var draws = new SplitMix64(((ulong)seed << 20) + (ulong)kind);
                float Draw() => (draws.Next() >> 40) / (float)(1 << 24);
                for (int i = 0; i < count; i++)
                {
                    float x = (Draw() - 0.5f) * reach, z = (Draw() - 0.5f) * reach, thinned = Draw(), yaw = Draw() * 360, scale = Draw();
                    if (cover)
                    {
                        x += viewer.x;
                        z += viewer.y;
                        if (thinned < Mathf.InverseLerp(CoverNear, CoverFar, Vector2.Distance(new Vector2(x, z), viewer)))
                        {
                            continue;
                        }
                    }
                    props.Add(new Prop { Kind = kind, X = x, Z = z, Yaw = yaw, Scale = Mathf.Lerp(growth.ScaleFrom, growth.ScaleTo, scale) });
                }
            }
            return props;
        }

        // How much of a patch each of a variant's layers takes at a point, from noise a few metres
        // across: the first layer where the noise is low, the last where it is high, with the
        // steps between them where each layer's share of the ground puts them.
        public static void Paint(Variant variant, float[,,] alphas, float side, uint seed)
        {
            int n = alphas.GetLength(0);
            var noise = new float[n * n];
            for (int row = 0; row < n; row++)
            {
                for (int column = 0; column < n; column++)
                {
                    float x = column * side / n, z = row * side / n;
                    noise[row * n + column] = 0.65f * Smooth(x / 9, z / 9, seed) + 0.35f * Smooth(x / 2.5f, z / 2.5f, seed + 1);
                }
            }
            var sorted = (float[])noise.Clone();
            Array.Sort(sorted);
            // The noise's own value below which each layer's share of the patch lies.
            var steps = new float[variant.Ground.Length - 1];
            float below = 0;
            for (int layer = 0; layer < steps.Length; layer++)
            {
                below += variant.Ground[layer].Share;
                steps[layer] = sorted[Mathf.Clamp(Mathf.RoundToInt(below * (sorted.Length - 1)), 0, sorted.Length - 1)];
            }
            const float Soft = 0.07f;
            for (int row = 0; row < n; row++)
            {
                for (int column = 0; column < n; column++)
                {
                    float value = noise[row * n + column], left = 1;
                    for (int layer = 0; layer < variant.Ground.Length; layer++)
                    {
                        float here = layer < steps.Length ? left * (1 - Mathf.SmoothStep(0, 1, Mathf.InverseLerp(steps[layer] - Soft, steps[layer] + Soft, value))) : left;
                        alphas[row, column, layer] = here;
                        left -= here;
                    }
                }
            }
        }

        // Value noise between lattice points one unit apart.
        static float Smooth(float x, float z, uint seed)
        {
            int x0 = Mathf.FloorToInt(x), z0 = Mathf.FloorToInt(z);
            float u = Mathf.SmoothStep(0, 1, x - x0), v = Mathf.SmoothStep(0, 1, z - z0);
            return Mathf.Lerp(Mathf.Lerp(GroundPlan.Hash(x0, z0, seed), GroundPlan.Hash(x0 + 1, z0, seed), u),
                Mathf.Lerp(GroundPlan.Hash(x0, z0 + 1, seed), GroundPlan.Hash(x0 + 1, z0 + 1, seed), u), v);
        }
    }
}
