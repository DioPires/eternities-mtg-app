using System;
using UnityEngine;

namespace Eternities.Kits
{
    // A variant as a kit holds it, assigned by the generation entry point: its layers in the order
    // of `Variant.Ground` and its props in the order of `Variant.Grows`.
    [Serializable]
    public sealed class KitVariant
    {
        public string Name;
        public TerrainLayer[] Layers;
        public KitProp[] Props;
    }

    // A loop of a kit (PRD v4 5.12): an ambient family's bed, or a body of water's.
    [Serializable]
    public sealed class KitLoop
    {
        public string Name;
        public AudioClip Clip;
    }

    // What a kit gives a world (PRD v4 5.6.1, 8.12.5): its variants with their layers and props,
    // its other terrain layers, its water, its loops and its stones. Each kit's is one asset under its
    // `Resources/`, which the generation entry point makes and nothing in the scene names, so a
    // build carries it and loads it with the world that uses it, not with the hub (DEC-1055, N20).
    public sealed class KitDressing : ScriptableObject
    {
        public string Kit;
        public KitVariant[] Variants = new KitVariant[0];
        public TerrainLayer[] Layers = new TerrainLayer[0];
        public GameObject River, Lake, Sea;
        public Material Lava;
        public KitLoop[] Loops = new KitLoop[0];
        // The kit's stones (PRD v4 5.4.16, 5.13.1): a reading stone, a waystone, and a low stone
        // for a chapter and a marker; and a reading stone's dressed face and the marks cut in it
        // (`StoneField`).
        public GameObject ReadingStone, Waystone, ChapterStone;
        public Material Tablet, Inscription;

        // The resource a kit's dressing is loaded by.
        public static string ResourceOf(string kit) => $"kit-{kit}";

        public TerrainLayer Layer(string name) => Array.Find(Layers, layer => layer != null && layer.name == name);

        public AudioClip Loop(string name) => Array.Find(Loops, loop => loop.Name == name)?.Clip;

        public KitVariant Variant(string name) => Array.Find(Variants, variant => variant.Name == name);
    }

    // Which kit owns each ambient family's loop (PRD v4 8.12.5), and the loops of water.
    public static class KitLoops
    {
        // A family's bed is the loop of its name in the kit that owns it.
        public static string KitOf(string family) => family switch
        {
            "meadow" => "temperate",
            "forest" => "forest",
            "surf" => "coast",
            "marsh" => "swamp",
            "alpine-wind" => "mountain",
            "volcanic" => "volcanic",
            _ => null,
        };

        // The loops of water, by the water's kind: the kit and the loop's name.
        public static (string Kit, string Loop) OfWater(string kind) => kind switch
        {
            WaterBody.River => ("temperate", "river"),
            WaterBody.Pond => ("temperate", "lake"),
            WaterBody.Lake => ("temperate", "lake"),
            WaterBody.Marsh => ("temperate", "lake"),       // a marsh's pools lap as a lake's edge
            WaterBody.Sea => ("coast", "surf"),
            WaterBody.Lava => ("volcanic", "lava"),
            _ => (null, null),
        };
    }
}
