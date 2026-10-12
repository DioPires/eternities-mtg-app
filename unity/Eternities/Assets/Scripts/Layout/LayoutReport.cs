using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Eternities.Layout
{
    // The figures PRD v4 5.4.14 asks the slice to report for a world, as text.
    public static class LayoutReport
    {
        public static string Write(WorldLayout layout, Checker.Result check, string digest)
        {
            LayoutInput input = layout.Input;
            var text = new StringBuilder();
            string M(double millimetres) => (millimetres / 1000).ToString("F2", CultureInfo.InvariantCulture);
            string Deg(long microDegrees) => (microDegrees / 1e6).ToString("F3", CultureInfo.InvariantCulture);

            int cards = input.Cards.Length;
            text.Append($"plane {input.PlaneSlug}: {cards} cards, {input.SetCodes.Length} sets\n");
            text.Append($"diameter {M(2.0 * layout.WorldRadius)} m (world radius {M(layout.WorldRadius)} m), plaza radius {M(layout.PlazaRadius)} m, {layout.OuterPasses} outer passes\n");
            double ground = Math.PI * layout.WorldRadius * layout.WorldRadius / 1e6 / Math.Max(1, cards);
            text.Append($"mean ground per stand {ground.ToString("F1", CultureInfo.InvariantCulture)} m2\n");

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
                text.Append($"bands: {bands} with a width, mean {M((double)widthSum / bands)} m, from {M(narrowest)} m to {M(widest)} m; {bandWidenings} widenings in all, at most {widestWidenings} on one band\n");
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
                text.Append($"checker: {(check.Passed ? "passed" : $"FAILED with {check.ViolationCount} violations")}; minimum spacing {M(check.MinSpacing)} m; {check.PairsTested} stand pairs tested\n");
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
