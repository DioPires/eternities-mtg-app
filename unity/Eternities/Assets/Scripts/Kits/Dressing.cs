using System;
using Eternities.Data;

namespace Eternities.Kits
{
    // The lie of the land under a variant: how high its hills stand over its hollows, in metres,
    // how far apart they are, and how much of the ground under its shapes is broken by a finer
    // relief of rock.
    public sealed class Relief
    {
        public float Height, Width, Rough, RoughWidth;
        // Below this share of the height the ground lies under the water's level: the marsh's pools.
        public float Sunken;
    }

    // How the temperate kit dresses one region of a hero world (PRD v4 5.6.3, Appendix F.1): the
    // variant that grows there and how much of it, the region's water, its ambient family (5.12.1)
    // and its relief. Where the row names a kit or a variant the kit has not, the dressing that
    // stands in for it says why in `Departure`.
    public sealed class RegionDress
    {
        public string Id, Name;
        public Variant Variant;
        public float Growth = 1;        // the share of the variant's density
        public string Water;            // river, lake, sea, marsh, lava or none
        public string Ambient;          // the ambient family (PRD v4 Appendix C, 4.12.2)
        public Relief Relief;
        public string Departure;

        public override string ToString() => $"{Id}: {Variant.Name} × {Growth}, {Water}, {Ambient}";
    }

    public static class Dressing
    {
        // Dominaria's theme row (PRD v4 Appendix C.1): kit `temperate`, sky `cumulus`, light 35°
        // warm, water river and lake, ambient `meadow`. The pack carries no theme table yet (4.12.4),
        // so the row is written here, as the first slice wrote its sun (`Temperate.SunElevation`).
        public const string ThemeAmbient = "meadow";

        // A variant's lie of the land. The meadow rolls, the wood is broken, the marsh is nearly
        // flat with its hollows under water, the highland stands high and stony.
        public static readonly Relief Meadow = new Relief { Height = 3.5f, Width = 70, Rough = 0.25f, RoughWidth = 9 };
        public static readonly Relief Wood = new Relief { Height = 4.5f, Width = 55, Rough = 0.4f, RoughWidth = 8 };
        public static readonly Relief Marsh = new Relief { Height = 2.4f, Width = 26, Rough = 0.15f, RoughWidth = 6, Sunken = 0.6f };
        public static readonly Relief Highland = new Relief { Height = 10, Width = 90, Rough = 1.4f, RoughWidth = 14 };
        public static readonly Relief Volcanic = new Relief { Height = 13, Width = 110, Rough = 1.8f, RoughWidth = 11 };

        public static Variant VariantNamed(string name) => Array.Find(Variants.Temperate, variant => variant.Name == name)
            ?? throw new ArgumentException($"the temperate kit has no variant {name}");

        // A region's dressing from its row. The temperate kit dresses every region of Dominaria
        // (PRD v4 9.6): `volcanic` (Shiv) takes the highland with its dark rock for basalt, sparser
        // and higher, until the volcanic kit exists, and a `coast` row takes the meadow with the sea
        // as its water. Its ambient family is the one its row names (4.13.5), or the theme row's
        // where the row names none (5.12.1).
        public static RegionDress Of(WorldRegion region)
        {
            var dress = new RegionDress { Id = region.Id, Name = region.Name, Water = region.Water ?? "none", Ambient = region.Ambient ?? ThemeAmbient };
            switch (region.Kit)
            {
                case "temperate" when region.Variant != null:
                    dress.Variant = VariantNamed(region.Variant);
                    dress.Relief = region.Variant == "wood" ? Wood : region.Variant == "marsh" ? Marsh : region.Variant == "highland" ? Highland : Meadow;
                    break;
                case "volcanic":
                    dress.Variant = VariantNamed("highland");
                    dress.Growth = 0.35f;
                    dress.Relief = Volcanic;
                    dress.Departure = "the volcanic kit does not exist: the temperate kit's highland, on its dark rock for basalt, at a third of its growth (PRD v4 9.6)";
                    break;
                case "coast":
                    dress.Variant = VariantNamed("meadow");
                    dress.Growth = 0.8f;
                    dress.Relief = Meadow;
                    dress.Departure = "the coast kit does not exist: the temperate kit's meadow, the nearest variant to a grassy shore, with the sea as the row's water";
                    break;
                default:
                    // A kit world's one region, or a row of a kit this leg does not dress.
                    dress.Variant = VariantNamed("meadow");
                    dress.Relief = Meadow;
                    dress.Departure = region.Kit == null ? null : $"the {region.Kit} kit does not exist: the temperate kit's meadow";
                    break;
            }
            return dress;
        }
    }
}
