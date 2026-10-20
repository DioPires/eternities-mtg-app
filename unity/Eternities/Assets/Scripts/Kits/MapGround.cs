using UnityEngine;

namespace Eternities.Kits
{
    // The map's picture of the ground (PRD v4 6.3.4): each region in a tone of its variant's
    // ground, its water as the plan lays it, the land shaded by its slopes as if lit from the north
    // west, and dimmed past the world's edge, where the walker cannot go. The map shows nothing
    // the world does not, so this is read from the world's own dressing plan.
    public static class MapGround
    {
        static readonly Color Meadow = new Color(0.47f, 0.49f, 0.28f), Wood = new Color(0.22f, 0.34f, 0.18f);
        static readonly Color Marsh = new Color(0.33f, 0.36f, 0.25f), Highland = new Color(0.38f, 0.35f, 0.31f);
        public static readonly Color Fresh = new Color(0.20f, 0.37f, 0.50f), Sea = new Color(0.12f, 0.27f, 0.42f), Lava = new Color(0.86f, 0.32f, 0.08f);
        public const float Shade = 0.12f, PastTheEdge = 0.45f;

        // `size` by `size` texels over the square of half side `halfSide` metres about `centre`,
        // row by row from the south-west corner. It reads the plan's regions, water and heights,
        // and runs on any thread.
        public static Color32[] Pixels(DressPlan plan, Vector2 centre, float halfSide, int size)
        {
            var pixels = new Color32[size * size];
            float step = 2 * halfSide / size;
            for (int row = 0; row < size; row++)
            {
                float z = centre.y - halfSide + (row + 0.5f) * step;
                for (int column = 0; column < size; column++)
                {
                    float x = centre.x - halfSide + (column + 0.5f) * step;
                    int texel = plan.Grid.At(x, z);
                    Color colour = plan.Wet[texel] switch
                    {
                        DressPlan.WetRiver or DressPlan.WetStill or DressPlan.WetMarsh => Fresh,
                        DressPlan.WetSea => Sea,
                        DressPlan.WetLava => Lava,
                        _ => Ground(plan.Regions[plan.Region[texel]]),
                    };
                    if (plan.Wet[texel] == DressPlan.Dry)
                    {
                        // The slope toward the north west, a step either way.
                        float rise = plan.HeightAt(x - step, z + step) - plan.HeightAt(x + step, z - step);
                        colour *= 1 + Mathf.Clamp(rise / (2 * step), -1, 1) * Shade * 4;
                    }
                    if (x * x + z * z > plan.Radius * plan.Radius)
                    {
                        colour *= PastTheEdge;
                    }
                    colour.a = 1;
                    pixels[row * size + column] = colour;
                }
            }
            return pixels;
        }

        static Color Ground(RegionDress region) => region.Variant?.Name switch
        {
            "wood" => Wood,
            "marsh" => Marsh,
            "highland" => Highland,
            _ => Meadow,
        };
    }
}
