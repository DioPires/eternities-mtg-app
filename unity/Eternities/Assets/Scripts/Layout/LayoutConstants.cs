namespace Eternities.Layout
{
    // The figures of PRD v4 5.4.1 that a reader of the pack needs, in the units of 5.4.18 (1):
    // lengths in millimetres, angles in micro-degrees. They are the pipeline's
    // `eternities.layout.constants`, the nominal figures against which both checkers test the
    // emitted geometry (8.3.3). The engine computes no position from them (5.4): it draws what the
    // pack holds.
    public static class LayoutConstants
    {
        public const long MicroPerTurn = 360_000_000;
        public const long MicroPerCount = 1_000;
        public const int CountsPerTurn = 360_000;

        // Rounding moves a point by at most 0.71 mm; a point that 5.4 puts on a circle is tested
        // within this (5.4.18 (4)).
        public const long Margin = 2;

        // The hexagonal lattice of 5.4.18 (8).
        public const long LatticePitch = 3_000;
        public const long LatticeHalfPitch = 1_500;
        public const long LatticeRow = 2_599;
        public const long JitterRadius = 248;
        public const long MinStandSpacing = 2_500;

        // A stand (5.4.1).
        public const long FootprintWidth = 700;
        public const long FootprintDepth = 300;
        public const long ApronWidth = 1_000;
        public const long ApronDepth = 1_500;
        public const long CorridorHalfWidth = 750;

        // Paths, pads and stones (5.4.1, 5.4.8, 5.4.16).
        public const long PathHalfWidth = 1_500;
        public const long PadRadius = 1_500;
        public const long StoneRadius = 500;
        public const long StoneAlong = 4_000;
        public const long StoneAcross = 3_000;
        public const long ApproachLength = 10_000;

        // The plaza (5.4.11).
        public const long PlazaRadius = 12_000;
        public const long PlazaEdgeRadius = 15_000;
        public const long ReturnPortalSouth = 8_000;

        // Clusters and the gap bounds (5.4.9, 5.4.10).
        public const long ClusterRadius = 4_500;
        public const int CapMax = 8;
        public const int MinCluster = 3;
        public const long CorridorArcWindow = 6_000;
        public const long GapToFirst = 18_000;
        public const long GapBetween = 18_000;
        public const long GapToEnd = 10_000;

        // A disc is the 72-gon of the table's directions of every 5 degrees (5.4.18 (13)).
        public const int DiscVertices = 72;
        public const int DiscStepCounts = 5_000;

        // How far a stand's yaw may turn from its path vertex: 0.1 degree in counts (invariant 9).
        public const int FacingCounts = 100;
    }
}
