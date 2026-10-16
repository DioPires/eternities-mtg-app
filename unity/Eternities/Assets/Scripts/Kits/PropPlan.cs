using System;
using System.Collections.Generic;
using Eternities.Layout;
using UnityEngine;

namespace Eternities.Kits
{
    // One of a kit's props as the scatter knows it. Lengths are in metres, of the prop's prefab as
    // it stands at scale 1 (the prop conditioning rule, `unity/Eternities/README.md`); an instance
    // is its prefab at a scale of its own.
    public sealed class PropKind
    {
        public string Prefab;               // under the kit's `Prefabs/`, without its extension: its category's folder and its name
        public float ScaleFrom, ScaleTo;
        // The radius it takes on the ground. A tree's is its trunk and roots: its crown begins above
        // a stand's top and may reach over a path.
        public float Footprint;
        public float Trunk, TrunkHeight;    // a tree: the capsule the avatar and the camera stop at
        public float Sink;                  // how far it stands into the ground, for a slope
        public bool Block;                  // a rock: a box of its own size stops them
        public bool Shadow;

        public string Name => Prefab.Substring(Prefab.LastIndexOf('/') + 1);
    }

    public struct Prop
    {
        public int Kind;
        public float X, Y, Z;   // metres; Y is the ground's height there
        public float Yaw;       // degrees
        public float Scale;
    }

    // What grows in one zone of a world: how much of its ground asks for a prop, which props, and
    // what stands in a line along a radial path at its edge.
    public sealed class Dressing
    {
        public float Cover;     // the share of the scatter's cells that ask for a prop, at full density
        public int[] Mix;       // a kind as often as it should come up
        public int[] Avenue;
    }

    // The temperate kit as the first slice draws it (PRD v4 5.6.1, 9.5; `Assets/Kits/temperate/CREDITS.md`):
    // its props, and the kit's fixed table of what grows in which wedge (PRD v4 5.6.3), so the ground
    // says which colour a visitor is among. The numbers are a first setting for the owner's eye.
    public static class Temperate
    {
        // Dominaria's sun, from its row of Appendix C: "35° warm". The slice has one world and no
        // theme table (PRD v4 9.5), so the row is written here. Where the sun stands is not in the
        // row: the south-west, so the visitor who arrives facing north is lit from the side and
        // the stands and trees throw their shadows across the paths.
        public const float SunElevation = 35, SunAzimuth = 240, SunKelvin = 5000;

        // A sun at an elevation above the horizon and an azimuth clockwise from north, both in
        // degrees, as the rotation of a directional light, which looks the way its light travels.
        public static Quaternion Sun(float elevation, float azimuth) => Quaternion.Euler(elevation, azimuth + 180, 0);

        public const int Oak = 0, Birch = 1, Pine = 2, Bush = 3, BushLarge = 4, Boulder = 5, Rock = 6, FlatStone = 7, StandingStone = 8, Reeds = 9;

        public static readonly PropKind[] Kinds =
        {
            Kenney("Trees/tree_oak", 5.5f, 7.5f, footprint: 0.21f, trunk: 0.1f, trunkHeight: 0.55f, shadow: true),
            Kenney("Trees/tree_thin", 5, 6.5f, footprint: 0.16f, trunk: 0.05f, trunkHeight: 0.5f, shadow: true),
            Kenney("Trees/tree_pineTallA", 5.5f, 7.5f, footprint: 0.07f, trunk: 0.066f, trunkHeight: 0.65f, shadow: true),
            Kenney("Bushes/plant_bush", 3.5f, 5, footprint: 0.2f),
            Kenney("Bushes/plant_bushLarge", 5, 7, footprint: 0.19f, shadow: true),
            Kenney("Rocks/rock_largeA", 2, 3, footprint: 0.59f, block: true, shadow: true),
            Kenney("Rocks/stone_largeB", 2, 3, footprint: 0.6f, block: true, shadow: true),
            Kenney("Rocks/stone_smallFlatA", 2, 3.5f, footprint: 0.26f),
            Kenney("Rocks/stone_tallD", 2.5f, 3.5f, footprint: 0.27f, block: true, shadow: true),
            Kenney("GroundCover/crops_wheatStageB", 2.2f, 3, footprint: 0.32f),
        };

        // Kenney's models have no real unit, and the first slice drew each at so many metres a unit,
        // from `from` to `to`. A prop's prefab is its model at the middle of that range, in metres
        // (`KitPrefabs`), and an instance is the prefab a little smaller or larger: every size on
        // the ground is the first slice's. The other lengths are given in the model's units, as
        // the first slice had them.
        static PropKind Kenney(string prefab, float from, float to, float footprint, float trunk = 0, float trunkHeight = 0, bool block = false, bool shadow = false)
        {
            float metres = (from + to) / 2;
            return new PropKind
            {
                Prefab = prefab, ScaleFrom = from / metres, ScaleTo = to / metres, Footprint = footprint * metres,
                Trunk = trunk * metres, TrunkHeight = trunkHeight * metres, Sink = 0.03f * metres, Block = block, Shadow = shadow,
            };
        }

        // Beyond the rim: a mixed wood that thickens away from the world, so the world ends in trees
        // and not at a line (PRD v4 5.1.5).
        public static readonly Dressing Margin = new Dressing { Mix = new[] { Oak, Oak, Oak, Birch, Birch, Pine, Pine, BushLarge, Rock } };

        public static float MarginCover(float beyondRim) =>
            beyondRim < MarginWood ? 0.04f + 0.14f * Mathf.SmoothStep(0, 1, beyondRim / 40) : 0.05f;

        public const float MarginWood = 70;
        // Behind the lake, on the side away from the world, a wood this deep and this thick stands
        // along the shore. Across the water the first build showed the terrain's own edge.
        public const float LakesideWood = 24, LakesideCover = 0.5f;
        // Reeds stand where the water's bed is this far below the ground: from the bank's foot to
        // ankle deep.
        public const float ReedsFrom = 0.3f, ReedsTo = 0.95f, ReedsCover = 0.5f;
        public const float AvenueCover = 1;

        // The share of the scatter a quality level draws (PRD v4 8.1.1: vegetation density is one of
        // the things a level changes). A lower level's props are among a higher level's.
        public static float Density(string qualityLevel) => qualityLevel == "low" ? 0.35f : qualityLevel == "medium" ? 0.6f : 1;
    }

    // A world's prop scatter (PRD v4 8.4.2): the props a world stands, each with its kind, place
    // and scale, for `PropField` to draw. The first slice planned it on the wheel law's layout; that
    // plan retired with the law (PRD v4 9.6, leg 1), and leg 2 plans the journey law's dressing.
    // The greybox has no props.
    public sealed class PropPlan
    {
        // A kit's props keep this far from paths, corridors, aprons and pads.
        public const float PropClearance = 1;

        public readonly List<Prop> Props = new List<Prop>();
        public readonly int[] ByKind = new int[Temperate.Kinds.Length];

        public static float Clearance(Prop prop) => PropClearance + Temperate.Kinds[prop.Kind].Footprint * prop.Scale;
    }
}
