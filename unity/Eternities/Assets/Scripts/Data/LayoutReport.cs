using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Eternities.Data
{
    // The layout report's figures of PRD v4 9.6, read back from the pack: what the engine can see of
    // a laid-out world in its three files, beside the pipeline's `report.md`, which also holds the
    // allocator's own figures (passes, widenings, redraws). Every figure is printed from its integer
    // millimetres (DEC-976 N8).
    public sealed class LayoutReport
    {
        public sealed class SiteRow
        {
            public int Index;
            public string Key, Region;      // a region's id, or "the world" in a kit world
            public int Stands, Clusters, ChapterStones;
            public long Radius, BoundingRadius, PathLength, ToFirst, Between, ToEnd;
            public long CentreX, CentreZ;
        }

        public sealed class LegRow
        {
            public int Id;
            public string Kind, From, To;
            public long Length;
        }

        public string Slug, Name, DataHash, Law;
        public int PlaneIndex, Stands, Regions, HeroVolumes, EraSites, RegionalSites, SetSites;
        public long Radius;
        public readonly List<SiteRow> Sites = new List<SiteRow>();
        public readonly SortedDictionary<int, int> ClustersBySize = new SortedDictionary<int, int>();
        public readonly List<LegRow> Legs = new List<LegRow>();
        public readonly List<(string Era, string[] Cards)> Headlines = new List<(string, string[])>();

        public long Across => 2 * Radius;
        public long TrailLegs => Legs.Where(leg => leg.Kind == "trail").Sum(leg => leg.Length);
        public long Spurs => Legs.Where(leg => leg.Kind == "spur").Sum(leg => leg.Length);

        // From the plaza's edge path to the last site's pad on the trail: the plaza approach, the
        // trail's legs and the last approach (9.6). No site path is counted.
        public long Walk(long plazaApproach, long approach) => plazaApproach + TrailLegs + approach;

        public static LayoutReport Of(WorldData world)
        {
            WorldDocument layout = world.Layout;
            var report = new LayoutReport
            {
                Slug = layout.Slug, Name = world.Plane.DisplayName, DataHash = layout.DataHash, Law = layout.Law, PlaneIndex = layout.PlaneIndex,
                Stands = world.StandCount, Regions = layout.Regions.Length, HeroVolumes = layout.HeroVolumes.Length, Radius = layout.Radius,
                EraSites = layout.Sites.Count(site => site.Kind == "era"), RegionalSites = layout.Sites.Count(site => site.Kind == "region"),
                SetSites = layout.Sites.Count(site => site.Kind == "set"),
            };
            var standsAt = new int[layout.Sites.Length];
            for (int stand = 0; stand < world.StandCount; stand++)
            {
                standsAt[world.Site(stand)]++;
            }
            for (int index = 0; index < layout.Sites.Length; index++)
            {
                WorldSite site = layout.Sites[index];
                long length = site.PathArcs[site.PathArcs.Length - 1];
                long[] arcs = site.Clusters.Select(cluster => cluster.Arc).ToArray();
                long between = 0;
                for (int number = 1; number < arcs.Length; number++)
                {
                    between = System.Math.Max(between, arcs[number] - arcs[number - 1]);
                }
                report.Sites.Add(new SiteRow
                {
                    Index = index, Key = site.Key, Region = site.RegionId ?? "the world", Stands = standsAt[index], Clusters = site.Clusters.Length,
                    ChapterStones = site.Chapters.Count(chapter => chapter.Stone != null), Radius = site.Radius, BoundingRadius = site.BoundingRadius,
                    PathLength = length, ToFirst = arcs.Length == 0 ? length : arcs[0], Between = between, ToEnd = arcs.Length == 0 ? length : length - arcs[arcs.Length - 1],
                    CentreX = site.Centre.X, CentreZ = site.Centre.Z,
                });
                foreach (SiteCluster cluster in site.Clusters)
                {
                    report.ClustersBySize.TryGetValue(cluster.Stands, out int count);
                    report.ClustersBySize[cluster.Stands] = count + 1;
                }
            }
            foreach (TrailLeg leg in layout.Legs)
            {
                report.Legs.Add(new LegRow { Id = leg.Id, Kind = leg.Kind, From = leg.From, To = leg.To, Length = leg.Length });
            }
            if (world.Lore != null)
            {
                foreach (LoreEra era in world.Lore.Eras)
                {
                    report.Headlines.Add((era.Id, era.Headline.Select(stand => world.CardAt(stand).Name).ToArray()));
                }
            }
            return report;
        }

        // A whole number with thousands separators, as the pipeline's report prints it.
        public static string Figure(long value) => value.ToString("#,0", CultureInfo.InvariantCulture);

        // The time to cover a length at a speed in millimetres a second, to the second, rounded half
        // up, as the pipeline's report prints it.
        public static string Time(long millimetres, long speed)
        {
            long seconds = (2 * millimetres + speed) / (2 * speed);
            return $"{seconds / 60} min {seconds % 60:00} s";
        }

        public string Write()
        {
            var text = new StringBuilder();
            text.Append($"# The pack's figures: {Name} (`{Slug}`)\n\n");
            text.Append($"- Dataset: `{DataHash}`. Plane index: {PlaneIndex}. Law: {Law}.\n");
            text.Append($"- Stands: {Figure(Stands)}. Sites: {Figure(Sites.Count)} ({EraSites} era, {RegionalSites} regional, {SetSites} set). Regions: {Regions}. Hero volumes: {HeroVolumes}.\n");
            text.Append($"- R = {Figure(Radius)} mm, so the world is {Figure(Across)} mm across.\n\n");
            text.Append("| # | Site | Region | Stands | Clusters | Chapter stones | Final r_s (mm) | b_s (mm) | Path (mm) | Pad to first cluster | Largest gap between clusters | Last cluster to the path's end | Centre (mm) |\n");
            text.Append("|---|---|---|---|---|---|---|---|---|---|---|---|---|\n");
            foreach (SiteRow site in Sites)
            {
                text.Append($"| {site.Index} | `{site.Key}` | {site.Region} | {Figure(site.Stands)} | {Figure(site.Clusters)} | {site.ChapterStones} | {Figure(site.Radius)} | {Figure(site.BoundingRadius)} | "
                    + $"{Figure(site.PathLength)} | {Figure(site.ToFirst)} | {Figure(site.Between)} | {Figure(site.ToEnd)} | {Figure(site.CentreX)}, {Figure(site.CentreZ)} |\n");
            }
            text.Append("\n| Stands in the cluster | Clusters |\n|---|---|\n");
            foreach (KeyValuePair<int, int> size in ClustersBySize)
            {
                text.Append($"| {size.Key} | {Figure(size.Value)} |\n");
            }
            text.Append("\n| Leg | Kind | From | To | Length (mm) |\n|---|---|---|---|---|\n");
            foreach (LegRow leg in Legs)
            {
                text.Append($"| {leg.Id} | {leg.Kind} | {leg.From} | `{leg.To}` | {Figure(leg.Length)} |\n");
            }
            text.Append($"\n- The trail's legs: {Figure(TrailLegs)} mm. The spurs: {Figure(Spurs)} mm.\n");
            if (Headlines.Count > 0)
            {
                text.Append("\n| Era | Headline cards |\n|---|---|\n");
                foreach ((string era, string[] cards) in Headlines)
                {
                    text.Append($"| `{era}` | {string.Join("; ", cards)} |\n");
                }
            }
            return text.ToString();
        }
    }
}
