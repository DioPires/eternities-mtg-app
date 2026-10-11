using System;
using System.Collections.Generic;

namespace Eternities.Layout
{
    // The colour classes of PRD v4 5.4.2, in the order the wedges run clockwise from north. The
    // colourless class has no wedge: its cards stand in the ring.
    public enum ColourClass
    {
        White = 0,
        Blue = 1,
        Black = 2,
        Red = 3,
        Green = 4,
        Gold = 5,
        Colourless = 6,
    }

    public static class ColourClasses
    {
        public const int WedgeCount = 6;

        // The class's name in a site's seed string, `eternities-v4|<plane>|<set>|<class>`. The PRD
        // gives the string's shape and not the class names; these are the slice's choice.
        public static readonly string[] SeedNames = { "W", "U", "B", "R", "G", "gold", "colourless" };
    }

    public sealed class LayoutCard
    {
        public string OracleId;
        public int Set;             // index into LayoutInput.SetCodes
        public ColourClass Class;
    }

    // A hero volume (PRD v4 3.1): a box given by its corners in order, or a cylinder when Radius is
    // positive.
    public sealed class HeroVolume
    {
        public string Id;
        public P2[] Box;
        public P2 Centre;
        public long Radius;
    }

    public sealed class LayoutInput
    {
        public string PlaneSlug;
        public string[] SetCodes;   // release order
        public LayoutCard[] Cards;
        public HeroVolume[] HeroVolumes = Array.Empty<HeroVolume>();
    }

    public enum PathKind
    {
        Ring = 0,
        Radial = 1,
        Spur = 2,
    }

    // One piece of the path network. A ring path is the annulus Inner to Outer about the origin. A
    // radial path is the strip of HalfWidth each side of the ray at Angle, from Inner to Outer along
    // it. A spur is the strip Quad. Ids run ring paths from the plaza outward, then radial paths
    // clockwise from north, then spurs in site order; a tie between two nearest paths goes to the
    // lower id.
    public sealed class LayoutPath
    {
        public int Id;
        public PathKind Kind;
        public long Inner, Outer;
        public long Angle;
        public P2[] Quad;
        public int Site = -1;
    }

    public enum PadKind
    {
        Waystone,
        Site,
        Return,
    }

    public sealed class LayoutPad
    {
        public PadKind Kind;
        public P2 Centre;
        public long Radius;
        public int Site = -1;
    }

    public sealed class LayoutBand
    {
        public int Set;
        public long Inner, Width;   // Width 0: no wedge class has a card of this set
        public int Widenings;
    }

    public sealed class LayoutSite
    {
        public int Index;
        public int Set;
        public ColourClass Class;
        public long Inner, Outer;           // radii
        public long AngleFrom, AngleSpan;   // clockwise from north
        public P2 Centre;                   // its pad
        public int Spur = -1;               // the id of its spur; -1 when its pad lies on a path
        public int Stands, Capacity;
        public int Widenings;               // widenings of its band or ring that this site asked for
    }

    public sealed class LayoutStand
    {
        public int Card;        // index into LayoutInput.Cards
        public int Site;
        public P2 Position;
        public P2 Lattice;      // the lattice point it was displaced from
        public long Yaw;        // the way the image surface faces, clockwise from north
        public P2 PathPoint;    // where its corridor ends, on or just inside the path it reaches
        public int Path;        // that path's id
    }

    public sealed class WorldLayout
    {
        public LayoutInput Input;
        public long PlazaRadius, WorldRadius;
        public P2 Arrival, ReturnPortal;
        public long[] WedgeFrom = new long[ColourClasses.WedgeCount];
        public long[] WedgeSpan = new long[ColourClasses.WedgeCount];   // 0: the class is absent
        public long RingInner, RingWidth;                               // RingWidth 0: no ring
        public int RingWidenings;
        public int OuterPasses;
        public readonly List<LayoutBand> Bands = new List<LayoutBand>();
        public readonly List<LayoutPath> Paths = new List<LayoutPath>();
        public readonly List<LayoutPad> Pads = new List<LayoutPad>();
        public readonly List<LayoutSite> Sites = new List<LayoutSite>();
        public readonly List<LayoutStand> Stands = new List<LayoutStand>();
    }

    // A named failure of PRD v4 5.4.11. The build fails with the site or the volume in the message.
    public sealed class LayoutException : Exception
    {
        public LayoutException(string message) : base(message)
        {
        }
    }

    // The fixed numbers of PRD v4 5.4.1, in millimetres.
    public static class LayoutConstants
    {
        public const long AreaPerStand = 10_000_000;    // square millimetres
        public const long Pitch = 3000;
        // The lattice's row spacing: pitch times half the root of three is 2598.08, rounded up so
        // that no two lattice points are closer than the pitch.
        public const long RowPitch = 2599;
        public const long Jitter = 250;
        public const long MinSpacing = Pitch - 2 * Jitter;
        // Shapes are tested on corners rounded to the millimetre, so two of them can be nearer than
        // the test saw by a millimetre and a half. Every inflation by the jitter radius is this much
        // larger, which keeps the emitted geometry strictly apart.
        public const long Slack = 2;
        // How far a spur is drawn into its pad and into its path, for the same reason.
        public const long SpurOverlap = 10;
        public const long FootprintHalfWidth = 350, FootprintHalfDepth = 150;
        public const long ApronHalfWidth = 500, ApronDepth = 1500;
        public const long CorridorHalfWidth = 750;
        public const long PathWidth = 3000;
        public const long PadRadius = 1500;
        // A kit's props keep this far from paths, corridors, aprons and pads.
        public const long PropClearance = 1000;
        public const long MinPlaza = 12_000;
        public const long MinBand = 6000, MinRing = 6000, MinArc = 6000;
        public const int MaxWidenings = 20, MaxPasses = 20;
        public const long PassTolerance = 100;
        public const long ReturnPortalSouth = 8000;
        // How far past its path point a corridor is drawn, so that it still ends on the path after
        // the stand's jitter moved it.
        public const long CorridorReach = Jitter + 10;
    }
}
