using UnityEngine;

namespace Eternities.Kits
{
    // One prop of a patch of ground, as `Variants.Scatter` places it for the kit's pictures.
    public struct Prop
    {
        public int Kind;
        public float X, Y, Z;   // metres; Y is the ground's height there
        public float Yaw;       // degrees
        public float Scale;
    }

    // The temperate kit's sun and its density by quality level (PRD v4 5.6.1, 5.7, 8.1.1).
    public static class Temperate
    {
        // Dominaria's sun, from its row of Appendix C: "35° warm". The pack has no theme table yet
        // (PRD v4 4.12.4), so the row is written here. Where the sun stands is not in the row: the
        // south-west, so the visitor who arrives facing north is lit from the side and the stands
        // and trees throw their shadows across the paths.
        public const float SunElevation = 35, SunAzimuth = 240, SunKelvin = 5000;

        // A sun at an elevation above the horizon and an azimuth clockwise from north, both in
        // degrees, as the rotation of a directional light, which looks the way its light travels.
        public static Quaternion Sun(float elevation, float azimuth) => Quaternion.Euler(elevation, azimuth + 180, 0);

        // The share of the scatter a quality level draws (PRD v4 8.1.1: vegetation density is one of
        // the things a level changes). A lower level's props are among a higher level's.
        public static float Density(string qualityLevel) => qualityLevel == "low" ? 0.35f : qualityLevel == "medium" ? 0.6f : 1;

        // The share a cell far from the walker draws at a quality level: at high, medium's; below
        // it, the level's own (DEC-1005, the props' lever). Past `PropField.Near` a cell at high so
        // shows medium's props, and never fewer.
        public static float FarDensity(string qualityLevel) => Mathf.Min(Density(qualityLevel), Density("medium"));
    }
}
