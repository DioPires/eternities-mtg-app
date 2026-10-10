using System;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Eternities.Layout
{
    // A layout as text: one record a line, integers only, in a fixed order, so that the same layout
    // is always the same bytes. The slice has no contract v4 pack (PRD v4 9.5), so the generation
    // entry point writes this file where the pack's positions will be, and the engine reads it.
    // Its SHA-256 is the layout's digest: what a test pins, and what the pipeline's allocator has
    // to reproduce (PRD v4 5.4.13).
    public static class LayoutFile
    {
        const string Magic = "eternities-layout 1";

        public static string Write(WorldLayout layout)
        {
            LayoutInput input = layout.Input;
            var text = new StringBuilder();
            void Line(params object[] fields)
            {
                for (int i = 0; i < fields.Length; i++)
                {
                    text.Append(i == 0 ? "" : " ").Append(Convert.ToString(fields[i], CultureInfo.InvariantCulture));
                }
                text.Append('\n');
            }

            Line(Magic);
            Line("plane", input.PlaneSlug);
            Line("sets", string.Join(" ", input.SetCodes));
            Line("world", layout.WorldRadius, layout.PlazaRadius, layout.OuterPasses);
            Line("arrival", layout.Arrival.X, layout.Arrival.Z);
            Line("return", layout.ReturnPortal.X, layout.ReturnPortal.Z);
            for (int c = 0; c < ColourClasses.WedgeCount; c++)
            {
                Line("wedge", ColourClasses.SeedNames[c], layout.WedgeFrom[c], layout.WedgeSpan[c]);
            }
            Line("ring", layout.RingInner, layout.RingWidth, layout.RingWidenings);
            foreach (LayoutBand band in layout.Bands)
            {
                Line("band", band.Set, band.Inner, band.Width, band.Widenings);
            }
            foreach (HeroVolume volume in input.HeroVolumes)
            {
                if (volume.Radius > 0)
                {
                    Line("volume", volume.Id, "cylinder", volume.Centre.X, volume.Centre.Z, volume.Radius);
                }
                else
                {
                    Line("volume", volume.Id, "box", Corners(volume.Box));
                }
            }
            foreach (LayoutPath path in layout.Paths)
            {
                switch (path.Kind)
                {
                    case PathKind.Ring: Line("path", path.Id, "ring", path.Inner, path.Outer); break;
                    case PathKind.Radial: Line("path", path.Id, "radial", path.Angle, path.Inner, path.Outer); break;
                    default: Line("path", path.Id, "spur", path.Site, Corners(path.Quad)); break;
                }
            }
            foreach (LayoutPad pad in layout.Pads)
            {
                Line("pad", pad.Kind.ToString().ToLowerInvariant(), pad.Centre.X, pad.Centre.Z, pad.Radius, pad.Site);
            }
            foreach (LayoutSite site in layout.Sites)
            {
                Line("site", site.Index, site.Set, ColourClasses.SeedNames[(int)site.Class], site.Inner, site.Outer, site.AngleFrom, site.AngleSpan,
                    site.Centre.X, site.Centre.Z, site.Spur, site.Stands, site.Capacity, site.Widenings);
            }
            // Stands by card, so the line number says which card of the plane it is.
            var byCard = new List<LayoutStand>(layout.Stands);
            byCard.Sort((a, b) => a.Card.CompareTo(b.Card));
            foreach (LayoutStand stand in byCard)
            {
                Line("stand", stand.Card, input.Cards[stand.Card].OracleId, stand.Site, stand.Position.X, stand.Position.Z, stand.Yaw,
                    stand.Lattice.X, stand.Lattice.Z, stand.PathPoint.X, stand.PathPoint.Z, stand.Path);
            }
            return text.ToString();
        }

        static string Corners(P2[] corners)
        {
            var parts = new List<string>();
            foreach (P2 corner in corners)
            {
                parts.Add(corner.X.ToString(CultureInfo.InvariantCulture));
                parts.Add(corner.Z.ToString(CultureInfo.InvariantCulture));
            }
            return string.Join(" ", parts);
        }

        public static string Digest(string text)
        {
            using (SHA256 sha = SHA256.Create())
            {
                var hex = new StringBuilder(64);
                foreach (byte b in sha.ComputeHash(new UTF8Encoding(false).GetBytes(text)))
                {
                    hex.Append(b.ToString("x2"));
                }
                return hex.ToString();
            }
        }

        public static WorldLayout Read(string text)
        {
            string[] lines = text.Split('\n');
            if (lines.Length == 0 || lines[0] != Magic)
            {
                throw new FormatException($"not a layout file: the first line is not '{Magic}'");
            }
            var input = new LayoutInput();
            var layout = new WorldLayout { Input = input };
            var cards = new List<LayoutCard>();
            var volumes = new List<HeroVolume>();
            for (int n = 1; n < lines.Length; n++)
            {
                if (lines[n].Length == 0)
                {
                    continue;
                }
                string[] f = lines[n].Split(' ');
                long L(int i) => long.Parse(f[i], CultureInfo.InvariantCulture);
                int I(int i) => int.Parse(f[i], CultureInfo.InvariantCulture);
                P2[] Quad(int i) => new[] { new P2(L(i), L(i + 1)), new P2(L(i + 2), L(i + 3)), new P2(L(i + 4), L(i + 5)), new P2(L(i + 6), L(i + 7)) };
                switch (f[0])
                {
                    case "plane":
                        input.PlaneSlug = f[1];
                        break;
                    case "sets":
                        input.SetCodes = new string[f.Length - 1];
                        Array.Copy(f, 1, input.SetCodes, 0, f.Length - 1);
                        break;
                    case "world":
                        layout.WorldRadius = L(1);
                        layout.PlazaRadius = L(2);
                        layout.OuterPasses = I(3);
                        break;
                    case "arrival":
                        layout.Arrival = new P2(L(1), L(2));
                        break;
                    case "return":
                        layout.ReturnPortal = new P2(L(1), L(2));
                        break;
                    case "wedge":
                    {
                        int c = Array.IndexOf(ColourClasses.SeedNames, f[1]);
                        layout.WedgeFrom[c] = L(2);
                        layout.WedgeSpan[c] = L(3);
                        break;
                    }
                    case "ring":
                        layout.RingInner = L(1);
                        layout.RingWidth = L(2);
                        layout.RingWidenings = I(3);
                        break;
                    case "band":
                        layout.Bands.Add(new LayoutBand { Set = I(1), Inner = L(2), Width = L(3), Widenings = I(4) });
                        break;
                    case "volume":
                        volumes.Add(f[2] == "cylinder"
                            ? new HeroVolume { Id = f[1], Centre = new P2(L(3), L(4)), Radius = L(5) }
                            : new HeroVolume { Id = f[1], Box = Quad(3) });
                        break;
                    case "path":
                        switch (f[2])
                        {
                            case "ring": layout.Paths.Add(new LayoutPath { Id = I(1), Kind = PathKind.Ring, Inner = L(3), Outer = L(4) }); break;
                            case "radial": layout.Paths.Add(new LayoutPath { Id = I(1), Kind = PathKind.Radial, Angle = L(3), Inner = L(4), Outer = L(5) }); break;
                            default: layout.Paths.Add(new LayoutPath { Id = I(1), Kind = PathKind.Spur, Site = I(3), Quad = Quad(4) }); break;
                        }
                        break;
                    case "pad":
                        layout.Pads.Add(new LayoutPad
                        {
                            Kind = f[1] == "waystone" ? PadKind.Waystone : f[1] == "site" ? PadKind.Site : PadKind.Return,
                            Centre = new P2(L(2), L(3)), Radius = L(4), Site = I(5),
                        });
                        break;
                    case "site":
                        layout.Sites.Add(new LayoutSite
                        {
                            Index = I(1), Set = I(2), Class = (ColourClass)Array.IndexOf(ColourClasses.SeedNames, f[3]), Inner = L(4), Outer = L(5),
                            AngleFrom = L(6), AngleSpan = L(7), Centre = new P2(L(8), L(9)), Spur = I(10), Stands = I(11), Capacity = I(12), Widenings = I(13),
                        });
                        break;
                    case "stand":
                    {
                        LayoutSite site = layout.Sites[I(3)];
                        if (I(1) != cards.Count)
                        {
                            throw new FormatException($"layout line {n + 1}: the stands are not in card order");
                        }
                        cards.Add(new LayoutCard { OracleId = f[2], Set = site.Set, Class = site.Class });
                        layout.Stands.Add(new LayoutStand
                        {
                            Card = I(1), Site = I(3), Position = new P2(L(4), L(5)), Yaw = L(6), Lattice = new P2(L(7), L(8)),
                            PathPoint = new P2(L(9), L(10)), Path = I(11),
                        });
                        break;
                    }
                    default:
                        throw new FormatException($"layout line {n + 1}: unknown record '{f[0]}'");
                }
            }
            input.Cards = cards.ToArray();
            input.HeroVolumes = volumes.ToArray();
            return layout;
        }
    }
}
