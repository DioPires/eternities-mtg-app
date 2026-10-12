using System;
using System.Collections.Generic;
using Eternities.Layout;
using UnityEngine;

namespace Eternities.Kits
{
    // One of a kit's props as the scatter knows it. Lengths are in the model's own units; an
    // instance's scale turns them into metres.
    public sealed class PropKind
    {
        public string Model;                // the file under the kit's `Props/`, without its extension
        public float ScaleFrom, ScaleTo;
        // The radius it takes on the ground. A tree's is its trunk and roots: its crown begins above
        // a stand's top and may reach over a path.
        public float Footprint;
        public float Trunk, TrunkHeight;    // a tree: the capsule the avatar and the camera stop at
        public bool Block;                  // a rock: a box of its own size stops them
        public bool Shadow;
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

    // The temperate kit's slice subset (PRD v4 5.6.1, 9.5; `Assets/Kits/temperate/CREDITS.md`): its
    // props, and the kit's fixed table of what grows in which wedge (PRD v4 5.6.3), so the ground
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
            new PropKind { Model = "tree_oak", ScaleFrom = 5.5f, ScaleTo = 7.5f, Footprint = 0.21f, Trunk = 0.1f, TrunkHeight = 0.55f, Shadow = true },
            new PropKind { Model = "tree_thin", ScaleFrom = 5, ScaleTo = 6.5f, Footprint = 0.16f, Trunk = 0.05f, TrunkHeight = 0.5f, Shadow = true },
            new PropKind { Model = "tree_pineTallA", ScaleFrom = 5.5f, ScaleTo = 7.5f, Footprint = 0.07f, Trunk = 0.066f, TrunkHeight = 0.65f, Shadow = true },
            new PropKind { Model = "plant_bush", ScaleFrom = 3.5f, ScaleTo = 5, Footprint = 0.2f },
            new PropKind { Model = "plant_bushLarge", ScaleFrom = 5, ScaleTo = 7, Footprint = 0.19f, Shadow = true },
            new PropKind { Model = "rock_largeA", ScaleFrom = 2, ScaleTo = 3, Footprint = 0.59f, Block = true, Shadow = true },
            new PropKind { Model = "stone_largeB", ScaleFrom = 2, ScaleTo = 3, Footprint = 0.6f, Block = true, Shadow = true },
            new PropKind { Model = "stone_smallFlatA", ScaleFrom = 2, ScaleTo = 3.5f, Footprint = 0.26f },
            new PropKind { Model = "stone_tallD", ScaleFrom = 2.5f, ScaleTo = 3.5f, Footprint = 0.27f, Block = true, Shadow = true },
            new PropKind { Model = "crops_wheatStageB", ScaleFrom = 2.2f, ScaleTo = 3, Footprint = 0.32f },
        };

        // By colour class, in the order of the wedges: white highlands, a blue birch wood, black
        // pines, red badlands, the green forest, gold between the two woods; then the colourless
        // ring, bare stone.
        public static readonly Dressing[] Wedges =
        {
            new Dressing { Cover = 0.3f, Mix = new[] { FlatStone, FlatStone, FlatStone, StandingStone, BushLarge, BushLarge, Oak }, Avenue = new[] { StandingStone } },
            new Dressing { Cover = 0.4f, Mix = new[] { Birch, Birch, Birch, Bush, Bush, Bush, FlatStone }, Avenue = new[] { Birch } },
            new Dressing { Cover = 0.35f, Mix = new[] { Pine, Pine, Pine, Rock, Rock, Bush }, Avenue = new[] { Pine } },
            new Dressing { Cover = 0.35f, Mix = new[] { Boulder, Boulder, Boulder, Rock, Rock, Rock, FlatStone, FlatStone, StandingStone }, Avenue = new[] { Boulder } },
            new Dressing { Cover = 0.6f, Mix = new[] { Oak, Oak, Oak, Oak, BushLarge, BushLarge, BushLarge, Bush, Bush }, Avenue = new[] { Oak } },
            new Dressing { Cover = 0.4f, Mix = new[] { Oak, Oak, Birch, Birch, BushLarge, BushLarge, FlatStone }, Avenue = new[] { Oak, Birch } },
            new Dressing { Cover = 0.25f, Mix = new[] { FlatStone, FlatStone, FlatStone, StandingStone, StandingStone, Rock }, Avenue = new[] { StandingStone } },
        };

        // The tone of each class's ground, in the order of the wedges, then the ring's (PRD v4 5.6.3;
        // `GroundPlan.ToneShare`): pale highland grass, a cool sea green, the marsh's dark olive, the
        // badlands' rust, the forest's deep green, gold; slate on the ring. A first setting for the
        // owner's eye, as the props are.
        public static readonly Color32[] GroundTones =
        {
            new Color32(200, 200, 170, 0), new Color32(48, 116, 140, 0), new Color32(46, 56, 34, 0), new Color32(112, 44, 28, 0),
            new Color32(40, 112, 30, 0), new Color32(220, 172, 44, 0), new Color32(118, 120, 126, 0),
        };

        // The kit's layer under each class's tone, in the same order (PRD v4 5.6.3: the kit varies its
        // ground layer by wedge class): the meadow, and bare stone in the badlands and on the ring.
        public static readonly int[] GroundBase =
        {
            GroundPlan.Meadow, GroundPlan.Meadow, GroundPlan.Meadow, GroundPlan.Gravel, GroundPlan.Meadow, GroundPlan.Meadow, GroundPlan.Gravel,
        };

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

    // A world's prop scatter, worked out away from the main thread (PRD v4 8.4.2): seeded by the
    // plane, run after the layout is read, and clear by the prop clearance of every path, pad,
    // corridor, apron and stand, of the plaza and of any hero volume. It needs the layout and the
    // ground plan and nothing of the engine.
    //
    // The ground is cut into cells of 3 m. A cell asks for at most one prop, at a point, of a kind
    // and at a scale that its own hash gives, so the same plane has the same props on every machine
    // and at every density. The lines along the radial paths are planted first, band by band.
    public sealed class PropPlan
    {
        public const float Cell = 3;
        // A cell's point keeps this share of the cell from its edge, so two trunks are never one.
        public const float Inset = 0.17f;
        // An avenue's props stand this far from a radial path's centre line, so that their crowns
        // stay off the middle of the path, where the camera follows; and one in every band, or one
        // every so many metres of a wide band.
        public const float AvenueFrom = 4, AvenueTo = 6, AvenueEvery = 10;
        public const float Sink = 0.03f;    // of its scale: a prop stands a little into the ground, for a slope

        public readonly List<Prop> Props = new List<Prop>();
        public readonly int[] ByKind = new int[Temperate.Kinds.Length];
        // Props that found room among what is reserved and then gave way to another prop.
        public int GaveWay { get; private set; }

        // Every prop that found room, in the order found, with the density from which it stands.
        readonly List<(Prop Prop, float From)> found = new List<(Prop, float)>();

        public static float Clearance(Prop prop) => LayoutConstants.PropClearance / 1000f + Temperate.Kinds[prop.Kind].Footprint * prop.Scale;

        public static PropPlan Compute(WorldLayout layout, GroundPlan ground, float density = 1)
        {
            var plan = new PropPlan();
            var reserved = new Reserved(layout);
            uint seed = (uint)SplitMix64.Fnv1a64($"eternities-v4|props|{layout.Input.PlaneSlug}");
            float world = layout.WorldRadius / 1000f, plaza = layout.PlazaRadius / 1000f;
            float ring = layout.RingWidth > 0 ? layout.RingInner / 1000f : world;
            float reach = world + GroundPlan.Margin;
            var radials = layout.Paths.FindAll(p => p.Kind == PathKind.Radial);
            plan.Avenues(layout, ground, reserved, radials, ring, seed, density);

            int cells = Mathf.CeilToInt(2 * reach / Cell);
            for (int row = 0; row < cells; row++)
            {
                for (int column = 0; column < cells; column++)
                {
                    float x = -reach + (column + Inset + (1 - 2 * Inset) * GroundPlan.Hash(column, row, seed)) * Cell;
                    float z = -reach + (row + Inset + (1 - 2 * Inset) * GroundPlan.Hash(column, row, seed + 1)) * Cell;
                    float r = Mathf.Sqrt(x * x + z * z);
                    // The lake's far shore: beyond the water, on the side away from the world.
                    Vector2 fromLake = new Vector2(x, z) - ground.LakeCentre;
                    float shore = fromLake.magnitude - GroundPlan.LakeRadius - GroundPlan.Bank;
                    bool lakeside = shore > 0 && shore < Temperate.LakesideWood && Vector2.Dot(fromLake, ground.LakeCentre) > 0;
                    if (r <= plaza || (r >= reach - Cell && !lakeside) || Mathf.Max(Mathf.Abs(x), Mathf.Abs(z)) >= reach - Cell)
                    {
                        // The plaza is the hero scene's. The terrain's corners are out of sight,
                        // but for the one the lake lies toward; its last cell is left bare.
                        continue;
                    }

                    Dressing dressing;
                    float cover;
                    int[] mix;
                    float bed = ground.Bed(x, z);
                    if (bed > 0)
                    {
                        // The water's edge has reeds and nothing else: the bed and the banks are clear.
                        if (bed < Temperate.ReedsFrom || bed > Temperate.ReedsTo || r < world + LayoutConstants.PropClearance / 1000f + 1)
                        {
                            continue;
                        }
                        cover = Temperate.ReedsCover;
                        mix = ReedsOnly;
                    }
                    else if (r > world)
                    {
                        dressing = Temperate.Margin;
                        cover = lakeside ? Temperate.LakesideCover : Temperate.MarginCover(r - world);
                        mix = dressing.Mix;
                    }
                    else
                    {
                        if (BesideARadialPath(radials, x, z))
                        {
                            continue;       // the avenue's ground, and the avenue has been planted
                        }
                        dressing = Temperate.Wedges[(int)ClassAt(layout, x, z, r > ring)];
                        cover = dressing.Cover;
                        mix = dressing.Mix;
                    }
                    float asked = GroundPlan.Hash(column, row, seed + 2);
                    if (asked >= cover * density)
                    {
                        continue;
                    }
                    plan.Place(ground, bed > 0 ? null : reserved, mix, x, z, column, row, seed, asked / cover);
                }
            }
            plan.Settle();
            return plan;
        }

        // A tree does not grow out of a rock (DEC-953): where a trunk stands inside a rock's
        // footprint, one of the two gives way. It is the one that stands only from a higher
        // density, so a lower level's props are still among a higher level's: whether a prop
        // stays depends only on props that are drawn whenever it is. Trees may stand close to
        // trees and rocks lie against rocks, as in a wood and on a scree.
        void Settle()
        {
            const float Bucket = 4;     // no rock and trunk together reach further than this
            var order = new int[found.Count];
            for (int i = 0; i < order.Length; i++)
            {
                order[i] = i;
            }
            Array.Sort(order, (a, b) =>
            {
                int by = found[a].From.CompareTo(found[b].From);
                return by != 0 ? by : a.CompareTo(b);
            });
            var kept = new bool[found.Count];
            var buckets = new Dictionary<(int, int), List<int>>();
            foreach (int index in order)
            {
                Prop prop = found[index].Prop;
                PropKind kind = Temperate.Kinds[prop.Kind];
                (int column, int row) = (Mathf.FloorToInt(prop.X / Bucket), Mathf.FloorToInt(prop.Z / Bucket));
                bool room = true;
                if (kind.Block || kind.Trunk > 0)
                {
                    for (int r = row - 1; r <= row + 1 && room; r++)
                    {
                        for (int c = column - 1; c <= column + 1 && room; c++)
                        {
                            if (!buckets.TryGetValue((c, r), out List<int> near))
                            {
                                continue;
                            }
                            foreach (int other in near)
                            {
                                Prop there = found[other].Prop;
                                PropKind its = Temperate.Kinds[there.Kind];
                                float apart = kind.Block && its.Trunk > 0 ? kind.Footprint * prop.Scale + its.Trunk * there.Scale
                                    : kind.Trunk > 0 && its.Block ? kind.Trunk * prop.Scale + its.Footprint * there.Scale : 0;
                                if ((prop.X - there.X) * (prop.X - there.X) + (prop.Z - there.Z) * (prop.Z - there.Z) < apart * apart)
                                {
                                    room = false;
                                    break;
                                }
                            }
                        }
                    }
                }
                if (!room)
                {
                    GaveWay++;
                    continue;
                }
                kept[index] = true;
                if (kind.Block || kind.Trunk > 0)
                {
                    if (!buckets.TryGetValue((column, row), out List<int> here))
                    {
                        buckets[(column, row)] = here = new List<int>();
                    }
                    here.Add(index);
                }
            }
            for (int i = 0; i < found.Count; i++)
            {
                if (kept[i])
                {
                    Props.Add(found[i].Prop);
                    ByKind[found[i].Prop.Kind]++;
                }
            }
        }

        // One prop at a point, of the kind, the scale and the turn that the hash of (a, b) gives,
        // if what is reserved leaves it room. `from` is the density from which it stands.
        void Place(GroundPlan ground, Reserved reserved, int[] mix, float x, float z, int a, int b, uint seed, float from)
        {
            var prop = new Prop
            {
                Kind = mix[Mathf.Min((int)(GroundPlan.Hash(a, b, seed + 3) * mix.Length), mix.Length - 1)],
                X = x, Z = z, Yaw = GroundPlan.Hash(a, b, seed + 5) * 360,
            };
            PropKind kind = Temperate.Kinds[prop.Kind];
            prop.Scale = Mathf.Lerp(kind.ScaleFrom, kind.ScaleTo, GroundPlan.Hash(a, b, seed + 4));
            if (reserved != null && !reserved.Clear(x, z, Clearance(prop)))
            {
                return;
            }
            prop.Y = ground.HeightAt(x, z);
            found.Add((prop, from));
        }

        // PRD v4 5.4.16: a wedge boundary is made natural by a line of what grows on each side of
        // it. On both sides of every radial path, each band between two ring paths has one avenue
        // prop at its middle, where a 6 m band leaves it room, and a wide band one every 10 m.
        void Avenues(WorldLayout layout, GroundPlan ground, Reserved reserved, List<LayoutPath> radials, float ring, uint seed, float density)
        {
            var rings = layout.Paths.FindAll(p => p.Kind == PathKind.Ring);     // listed from the plaza outward
            for (int path = 0; path < radials.Count; path++)
            {
                double angle = radials[path].Angle / 1e6 * Math.PI / 180, sine = Math.Sin(angle), cosine = Math.Cos(angle);
                for (int band = 0; band + 1 < rings.Count; band++)
                {
                    float from = rings[band].Outer / 1000f, to = rings[band + 1].Inner / 1000f;
                    int count = Mathf.Max(1, Mathf.FloorToInt((to - from) / AvenueEvery));
                    for (int i = 0; i < count; i++)
                    {
                        for (int side = 0; side < 2; side++)
                        {
                            // The hash is of the path and its side, and of the band and the place in it.
                            int a = -1 - (2 * path + side), b = 64 * band + i;
                            float asked = GroundPlan.Hash(a, b, seed + 2);
                            if (asked >= Temperate.AvenueCover * density)
                            {
                                continue;
                            }
                            float along = from + (to - from) * (i + 0.5f) / count;
                            if (along < radials[path].Inner / 1000f || along > radials[path].Outer / 1000f)
                            {
                                continue;       // the path does not run through this band
                            }
                            float across = (side == 0 ? -1 : 1) * Mathf.Lerp(AvenueFrom, AvenueTo, GroundPlan.Hash(a, b, seed));
                            float x = (float)(along * sine + across * cosine), z = (float)(along * cosine - across * sine);
                            Dressing dressing = Temperate.Wedges[(int)ClassAt(layout, x, z, Mathf.Sqrt(x * x + z * z) > ring)];
                            Place(ground, reserved, dressing.Avenue, x, z, a, b, seed, asked / Temperate.AvenueCover);
                        }
                    }
                }
            }
        }

        static readonly int[] ReedsOnly = { Temperate.Reeds };

        // The colour class whose ground a point is: the ring's beyond the ring's inner edge, else
        // the wedge its bearing lies in.
        public static ColourClass ClassAt(WorldLayout layout, float x, float z, bool inRing)
        {
            if (inRing)
            {
                return ColourClass.Colourless;
            }
            double bearing = Math.Atan2(x, z) * 180 / Math.PI * 1e6;     // clockwise from north
            for (int c = 0; c < ColourClasses.WedgeCount; c++)
            {
                if (layout.WedgeSpan[c] > 0 && Repeat(bearing - layout.WedgeFrom[c]) < layout.WedgeSpan[c])
                {
                    return (ColourClass)c;
                }
            }
            return ColourClass.Colourless;      // a world with no wedge is all ring
        }

        static double Repeat(double microDegrees) => microDegrees - Math.Floor(microDegrees / 360e6) * 360e6;

        // Within the avenue's reach of a radial path, where the scatter leaves the ground to it.
        static bool BesideARadialPath(List<LayoutPath> radials, float x, float z)
        {
            foreach (LayoutPath radial in radials)
            {
                double angle = radial.Angle / 1e6 * Math.PI / 180, sine = Math.Sin(angle), cosine = Math.Cos(angle);
                double along = x * sine + z * cosine, across = Math.Abs(x * cosine - z * sine);
                if (along >= radial.Inner / 1000.0 && along <= radial.Outer / 1000.0 && across <= AvenueTo + 1)
                {
                    return true;
                }
            }
            return false;
        }

        // Everything a prop keeps clear of, with the exact distance to each: the plaza, the ring and
        // radial paths by their own geometry, and the spurs, the pads, the hero volumes and every
        // stand's footprint, apron and corridor from buckets of 8 m.
        sealed class Reserved
        {
            const float Bucket = 8;
            // No prop asks for more room than this, so a shape is filed in every bucket it is
            // within this far of.
            const float Reach = 4;

            readonly float plaza, half, side;
            readonly float[] ringInner, ringOuter;
            readonly List<(double sine, double cosine, double from, double to, double half)> radials = new List<(double, double, double, double, double)>();
            readonly List<Vector2[]> quads = new List<Vector2[]>();
            readonly List<(Vector2 centre, float radius)> discs = new List<(Vector2, float)>();
            readonly List<int>[,] buckets;      // a quad's index, or a disc's as its complement

            public Reserved(WorldLayout layout)
            {
                plaza = layout.PlazaRadius / 1000f;
                half = layout.WorldRadius / 1000f + Reach;
                side = 2 * half;
                int n = Mathf.CeilToInt(side / Bucket);
                buckets = new List<int>[n, n];

                var rings = layout.Paths.FindAll(p => p.Kind == PathKind.Ring);     // listed from the plaza outward
                ringInner = new float[rings.Count];
                ringOuter = new float[rings.Count];
                for (int i = 0; i < rings.Count; i++)
                {
                    ringInner[i] = rings[i].Inner / 1000f;
                    ringOuter[i] = rings[i].Outer / 1000f;
                }
                foreach (LayoutPath path in layout.Paths)
                {
                    if (path.Kind == PathKind.Radial)
                    {
                        double angle = path.Angle / 1e6 * Math.PI / 180;
                        radials.Add((Math.Sin(angle), Math.Cos(angle), path.Inner / 1000.0, path.Outer / 1000.0, LayoutConstants.PathWidth / 2000.0));
                    }
                    else if (path.Kind == PathKind.Spur)
                    {
                        Quad(Array.ConvertAll(path.Quad, Metres));
                    }
                }
                foreach (LayoutPad pad in layout.Pads)
                {
                    Disc(Metres(pad.Centre), pad.Radius / 1000f);
                }
                foreach (HeroVolume volume in layout.Input.HeroVolumes ?? Array.Empty<HeroVolume>())
                {
                    if (volume.Radius > 0)
                    {
                        Disc(Metres(volume.Centre), volume.Radius / 1000f);
                    }
                    else
                    {
                        Quad(Array.ConvertAll(volume.Box, Metres));
                    }
                }
                foreach (LayoutStand stand in layout.Stands)
                {
                    // From the back of the footprint to the end of the corridor, as wide as the
                    // corridor, which is wider than the apron and the footprint.
                    double yaw = stand.Yaw / 1e6 * Math.PI / 180;
                    var ahead = new Vector2((float)Math.Sin(yaw), (float)Math.Cos(yaw));
                    var right = new Vector2(ahead.y, -ahead.x);
                    Vector2 at = Metres(stand.Position);
                    float length = Vector2.Dot(Metres(stand.PathPoint) - at, ahead) + LayoutConstants.CorridorReach / 1000f;
                    float back = -LayoutConstants.FootprintHalfDepth / 1000f, across = LayoutConstants.CorridorHalfWidth / 1000f;
                    Quad(new[] { at + ahead * back - right * across, at + ahead * back + right * across, at + ahead * length + right * across, at + ahead * length - right * across });
                }
            }

            static Vector2 Metres(P2 p) => new Vector2(p.X / 1000f, p.Z / 1000f);

            void Quad(Vector2[] corners)
            {
                Vector2 min = corners[0], max = corners[0];
                foreach (Vector2 corner in corners)
                {
                    min = Vector2.Min(min, corner);
                    max = Vector2.Max(max, corner);
                }
                quads.Add(corners);
                File(quads.Count - 1, min, max);
            }

            void Disc(Vector2 centre, float radius)
            {
                discs.Add((centre, radius));
                File(~(discs.Count - 1), centre - Vector2.one * radius, centre + Vector2.one * radius);
            }

            void File(int shape, Vector2 min, Vector2 max)
            {
                int n = buckets.GetLength(0);
                int At(float v) => Mathf.Clamp(Mathf.FloorToInt((v + half) / Bucket), 0, n - 1);
                for (int row = At(min.y - Reach); row <= At(max.y + Reach); row++)
                {
                    for (int column = At(min.x - Reach); column <= At(max.x + Reach); column++)
                    {
                        (buckets[row, column] ??= new List<int>()).Add(shape);
                    }
                }
            }

            // Is everything reserved at least `room` from the point?
            public bool Clear(float x, float z, float room)
            {
                if (room > Reach)
                {
                    throw new ArgumentOutOfRangeException(nameof(room), $"a prop asks for {room} m of room, and shapes are filed for {Reach} m");
                }
                float r = Mathf.Sqrt(x * x + z * z);
                if (r - plaza < room)
                {
                    return false;
                }
                for (int i = 0; i < ringInner.Length; i++)
                {
                    if (r > ringInner[i] - room && r < ringOuter[i] + room)
                    {
                        return false;
                    }
                }
                foreach ((double sine, double cosine, double from, double to, double halfWidth) in radials)
                {
                    double along = x * sine + z * cosine, across = Math.Abs(x * cosine - z * sine);
                    double beyond = Math.Max(Math.Max(from - along, along - to), 0), aside = Math.Max(across - halfWidth, 0);
                    if (beyond * beyond + aside * aside < room * room)
                    {
                        return false;
                    }
                }
                int n = buckets.GetLength(0);
                int row = Mathf.FloorToInt((z + half) / Bucket), column = Mathf.FloorToInt((x + half) / Bucket);
                if (row < 0 || row >= n || column < 0 || column >= n || buckets[row, column] == null)
                {
                    return true;        // beyond the world and what was filed around it
                }
                var p = new Vector2(x, z);
                foreach (int shape in buckets[row, column])
                {
                    if (shape < 0 ? Vector2.Distance(p, discs[~shape].centre) - discs[~shape].radius < room : Distance(quads[shape], p) < room)
                    {
                        return false;
                    }
                }
                return true;
            }

            // From a point to a convex quad: 0 inside it.
            static float Distance(Vector2[] quad, Vector2 p)
            {
                bool positive = false, negative = false;
                float nearest = float.MaxValue;
                for (int i = 0; i < quad.Length; i++)
                {
                    Vector2 a = quad[i], edge = quad[(i + 1) % quad.Length] - a;
                    float side = edge.x * (p.y - a.y) - edge.y * (p.x - a.x);
                    positive |= side > 0;
                    negative |= side < 0;
                    float t = Mathf.Clamp01(Vector2.Dot(p - a, edge) / edge.sqrMagnitude);
                    nearest = Mathf.Min(nearest, Vector2.Distance(p, a + edge * t));
                }
                return positive && negative ? nearest : 0;
            }
        }
    }
}
