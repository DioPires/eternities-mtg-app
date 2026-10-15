using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Eternities.Data;
using NUnit.Framework;

namespace Eternities.Tests
{
    // The layout report read back from the pack (PRD v4 9.6): each figure of the pipeline's
    // `report.md` that the three files carry is the same figure read from them.
    public class LayoutReportTests
    {
        static IEnumerable<string> LayoutNames() => LayoutFixtures.LayoutNames();

        // The rows of the report's table whose header starts with `header`, as trimmed cells.
        static List<string[]> Table(string report, string header)
        {
            string[] lines = report.Split('\n');
            int start = System.Array.FindIndex(lines, line => line.StartsWith(header));
            Assert.That(start, Is.GreaterThanOrEqualTo(0), $"the report has a table that starts {header}");
            var rows = new List<string[]>();
            for (int i = start + 2; i < lines.Length && lines[i].StartsWith("| "); i++)
            {
                rows.Add(lines[i].Split('|').Skip(1).Select(cell => cell.Trim().Trim('`')).ToArray());
            }
            return rows;
        }

        static long Number(string text) => long.Parse(text.Replace(",", ""));

        static long Read(string report, string pattern) => Number(Regex.Match(report, pattern).Groups[1].Value);

        [TestCaseSource(nameof(LayoutNames))]
        public void ThePacksFiguresAreThoseOfThePipelinesReport(string name)
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named(name);
            string expected = fixture.Report;
            Pack pack = File.Exists(Path.Combine(fixture.Pack, "manifest.json")) ? new Pack(fixture.Pack) : Pack.OfFixture(fixture.Pack);
            PackPlane plane = pack.Plane(fixture.Slug);
            using (WorldData world = WorldData.Decode(pack.Planes, plane, pack.Cards(plane), fixture.Stands, WorldDocument.Read(fixture.World),
                fixture.Lore == null ? null : LoreDocument.Read(fixture.Lore)))
            {
                LayoutReport report = LayoutReport.Of(world);

                // The head: stands, sites by kind, regions, hero volumes, R and the world's width.
                Match head = Regex.Match(expected, @"- Stands: ([\d,]+)\. Sites: ([\d,]+) \((\d+) era, (\d+) regional, (\d+) set\)\. Regions: (\d+)\. Hero volumes: (\d+)\.");
                Assert.That(head.Success);
                Assert.That(new long[] { report.Stands, report.Sites.Count, report.EraSites, report.RegionalSites, report.SetSites, report.Regions, report.HeroVolumes },
                    Is.EqualTo(Enumerable.Range(1, 7).Select(group => Number(head.Groups[group].Value)).ToArray()));
                Assert.That(report.Radius, Is.EqualTo(Read(expected, @"R = ([\d,]+) mm after")));
                Assert.That(report.Across, Is.EqualTo(Read(expected, @"so the world is ([\d,]+) mm across")));
                Assert.That(report.PlaneIndex, Is.EqualTo(Read(expected, @"Plane index \(v3 `planes.json`\): (\d+)")));

                // Each site: its region, stands, clusters, chapter stones, final r_s, b_s and centre.
                List<string[]> sites = Table(expected, "| # | Site | Region | Stands | Clusters |");
                Assert.That(sites.Count, Is.EqualTo(report.Sites.Count));
                for (int i = 0; i < sites.Count; i++)
                {
                    string[] row = sites[i];
                    LayoutReport.SiteRow site = report.Sites[i];
                    Assert.That(new object[] { site.Index, site.Key, site.Region, (long)site.Stands, (long)site.Clusters, (long)site.ChapterStones, site.Radius, site.BoundingRadius },
                        Is.EqualTo(new object[] { (int)Number(row[0]), row[1], row[2], Number(row[3]), Number(row[4]), Number(row[5]), Number(row[7]), Number(row[8]) }), site.Key);
                    Assert.That($"{LayoutReport.Figure(site.CentreX)}, {LayoutReport.Figure(site.CentreZ)}", Is.EqualTo(row[row.Length - 2]), site.Key);
                }

                // Each site's path after the trim and its three gaps (5.4.10).
                List<string[]> paths = Table(expected, "| Site | Path as built |");
                Assert.That(paths.Select(row => new[] { row[0], row[4], row[5], row[6], row[7] }),
                    Is.EqualTo(report.Sites.Select(site => new[] { site.Key, LayoutReport.Figure(site.PathLength), LayoutReport.Figure(site.ToFirst), LayoutReport.Figure(site.Between), LayoutReport.Figure(site.ToEnd) })));

                // The clusters by size.
                List<string[]> sizes = Table(expected, "| Stands in the cluster | Clusters |");
                Assert.That(sizes.Select(row => (int)Number(row[0])), Is.EqualTo(report.ClustersBySize.Keys));
                Assert.That(sizes.Select(row => (int)Number(row[1])), Is.EqualTo(report.ClustersBySize.Values));

                // The trail: each leg's kind, ends and length, the two totals and the walk.
                List<string[]> legs = Table(expected, "| Leg | Kind | From | To | Length (mm) |");
                Assert.That(legs.Select(row => string.Join(" ", row.Take(5))),
                    Is.EqualTo(report.Legs.Select(leg => $"{leg.Id} {leg.Kind} {leg.From} {leg.To} {LayoutReport.Figure(leg.Length)}")));
                Assert.That(report.TrailLegs, Is.EqualTo(Read(expected, @"The trail's legs: ([\d,]+) mm\.")));
                Assert.That(report.Spurs, Is.EqualTo(Read(expected, @"The spurs: ([\d,]+) mm\.")));
                if (report.Legs.Count > 0)
                {
                    long walk = report.Walk(10_000, 10_000);
                    Assert.That(walk, Is.EqualTo(Read(expected, @"to the last site's pad on the trail: ([\d,]+) mm")));
                    StringAssert.Contains($"(3,000 mm/s): {LayoutReport.Time(walk, 3_000)}.", expected);
                    StringAssert.Contains($"(6,000 mm/s): {LayoutReport.Time(walk, 6_000)}.", expected);
                }

                // The headline cards of each era (5.13.2), by stand index into card names.
                if (report.Headlines.Count > 0)
                {
                    List<string[]> headlines = Table(expected, "| Era | Rule | Cards |");
                    Assert.That(headlines.Select(row => row[0] + ": " + row[2]),
                        Is.EqualTo(report.Headlines.Select(era => era.Era + ": " + (era.Cards.Length == 0 ? "none" : string.Join("; ", era.Cards)))));
                }
            }
        }
    }
}
