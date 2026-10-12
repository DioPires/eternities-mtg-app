using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Eternities.Layout
{
    // The figures PRD v4 5.4.14 asks the slice to report for a world, as text.
    //
    // The text is the same on every runtime, so only whole numbers are formatted here. How a double
    // is rounded as it is printed is the runtime's own choice: a radius of 102,895 mm was 102.90
    // from the editor and 102.89 under .NET 8 (DEC-976, N8). A length is printed from its
    // millimetres and an angle from its micro-degrees, and a half goes up.
    public static class LayoutReport
    {
        // `numerator / denominator` to the nearest whole number. Neither is negative.
        static long Nearest(long numerator, long denominator) => (2 * numerator + denominator) / (2 * denominator);

        static long Nearest(double value) => (long)Math.Floor(value + 0.5);

        // A whole number with the point before its last `places` digits: 10290 with two is "102.90".
        static string Places(long value, int places)
        {
            string digits = value.ToString(CultureInfo.InvariantCulture).PadLeft(places + 1, '0');
            return digits.Insert(digits.Length - places, ".");
        }

        public static string Write(WorldLayout layout, Checker.Result check, string digest)
        {
            LayoutInput input = layout.Input;
            var text = new StringBuilder();
            string M(long millimetres) => Places(Nearest(millimetres, 10), 2);
            string Deg(long microDegrees) => Places(Nearest(microDegrees, 1000), 3);

            int cards = input.Cards.Length;
            text.Append($"plane {input.PlaneSlug}: {cards} cards, {input.SetCodes.Length} sets\n");
            text.Append($"diameter {M(2 * layout.WorldRadius)} m (world radius {M(layout.WorldRadius)} m), plaza radius {M(layout.PlazaRadius)} m, {layout.OuterPasses} outer passes\n");
            double ground = Math.PI * layout.WorldRadius * layout.WorldRadius / 1e6 / Math.Max(1, cards);
            text.Append($"mean ground per stand {Places(Nearest(ground * 10), 1)} m2\n");

            text.Append("wedges:");
            for (int c = 0; c < ColourClasses.WedgeCount; c++)
            {
                text.Append(layout.WedgeSpan[c] > 0 ? $" {ColourClasses.SeedNames[c]} {Deg(layout.WedgeSpan[c])}" : "");
            }
            text.Append('\n');

            int bands = 0, bandWidenings = 0, widestWidenings = 0;
            long widthSum = 0, widest = 0, narrowest = long.MaxValue;
            foreach (LayoutBand band in layout.Bands)
            {
                if (band.Width == 0)
                {
                    continue;
                }
                bands++;
                widthSum += band.Width;
                widest = Math.Max(widest, band.Width);
                narrowest = Math.Min(narrowest, band.Width);
                bandWidenings += band.Widenings;
                widestWidenings = Math.Max(widestWidenings, band.Widenings);
            }
            if (bands > 0)
            {
                text.Append($"bands: {bands} with a width, mean {Places(Nearest(widthSum, 10L * bands), 2)} m, from {M(narrowest)} m to {M(widest)} m; {bandWidenings} widenings in all, at most {widestWidenings} on one band\n");
            }
            if (layout.RingWidth > 0)
            {
                text.Append($"ring: from {M(layout.RingInner)} m, {M(layout.RingWidth)} m wide, {layout.RingWidenings} widenings\n");
            }

            int wedgeSites = 0, ringSites = 0, small = 0, capacity = 0;
            foreach (LayoutSite site in layout.Sites)
            {
                if (site.Class == ColourClass.Colourless)
                {
                    ringSites++;
                }
                else
                {
                    wedgeSites++;
                }
                small += site.Stands < 5 ? 1 : 0;
                capacity += site.Capacity;
            }
            text.Append($"sites: {layout.Sites.Count} ({wedgeSites} wedge sites, {ringSites} ring arcs), {small} under five stands; {layout.Stands.Count} stands on {capacity} candidates\n");
            int ringPaths = 0, radialPaths = 0, spurs = 0;
            foreach (LayoutPath path in layout.Paths)
            {
                ringPaths += path.Kind == PathKind.Ring ? 1 : 0;
                radialPaths += path.Kind == PathKind.Radial ? 1 : 0;
                spurs += path.Kind == PathKind.Spur ? 1 : 0;
            }
            text.Append($"paths: {ringPaths} ring paths, {radialPaths} radial paths, {spurs} spurs; {layout.Pads.Count} pads\n");

            text.Append("widenings a band or the ring made, by the site that asked:\n");
            var asked = new List<LayoutSite>();
            foreach (LayoutSite site in layout.Sites)
            {
                if (site.Widenings > 0)
                {
                    asked.Add(site);
                }
            }
            asked.Sort((a, b) => a.Widenings != b.Widenings ? b.Widenings.CompareTo(a.Widenings) : a.Index.CompareTo(b.Index));
            foreach (LayoutSite site in asked)
            {
                text.Append($"  {input.SetCodes[site.Set]}/{ColourClasses.SeedNames[(int)site.Class]}: {site.Widenings} (stands {site.Stands}, capacity {site.Capacity})\n");
            }
            if (asked.Count == 0)
            {
                text.Append("  none\n");
            }
            text.Append("bands (set, inner radius m, width m, widenings):\n");
            foreach (LayoutBand band in layout.Bands)
            {
                text.Append($"  {input.SetCodes[band.Set]} {M(band.Inner)} {M(band.Width)} {band.Widenings}\n");
            }

            if (check != null)
            {
                // The spacing is a distance, so it is no whole number of millimetres, and no pair was
                // tested in a world of one stand.
                string spacing = double.IsInfinity(check.MinSpacing) ? "Infinity" : Places(Nearest(check.MinSpacing / 10), 2);
                text.Append($"checker: {(check.Passed ? "passed" : $"FAILED with {check.ViolationCount} violations")}; minimum spacing {spacing} m; {check.PairsTested} stand pairs tested\n");
                foreach (string violation in check.Violations)
                {
                    text.Append($"  {violation}\n");
                }
            }
            if (digest != null)
            {
                text.Append($"digest {digest}\n");
            }
            return text.ToString();
        }
    }
}
