using System;
using System.Collections.Generic;
using System.Linq;

namespace Eternities.Data
{
    // Where a choice of the travel menu, of a stone or of the reading overlay leads (PRD v4 5.9.4,
    // 6.6): a site's pad, a chapter's stone (a first chapter's is its site's pad), a stand's apron,
    // or the plaza's arrival point.
    public readonly struct Way : IEquatable<Way>
    {
        public enum To
        {
            Pad,
            Chapter,
            Stand,
            Plaza,
        }

        public readonly To Kind;
        public readonly int Index;      // the site, or the stand
        public readonly int Chapter;    // the chapter's place in its site's list

        Way(To kind, int index, int chapter)
        {
            Kind = kind;
            Index = index;
            Chapter = chapter;
        }

        public static Way Pad(int site) => new Way(To.Pad, site, -1);
        public static Way ToChapter(int site, int chapter) => new Way(To.Chapter, site, chapter);
        public static Way Stand(int stand) => new Way(To.Stand, stand, -1);
        public static Way Plaza => new Way(To.Plaza, -1, -1);

        public bool Equals(Way other) => Kind == other.Kind && Index == other.Index && Chapter == other.Chapter;
        public override bool Equals(object other) => other is Way way && Equals(way);
        public override int GetHashCode() => ((int)Kind * 397 ^ Index) * 397 ^ Chapter;
        public override string ToString() => $"{Kind} {Index} {Chapter}";
    }

    // One line of a list that may lead somewhere: its words, and where it leads, or nowhere.
    public sealed class Choice
    {
        public string Text;
        public Way? Way;            // null: named, and no travel
        public int Depth;           // in the travel menu: 0 a site or a region, 1 an era's chapter
        public int Site = -1;       // in the travel menu: the site whose cards the row can list
    }

    // What the reading overlay shows (PRD v4 5.13.1): the era's name, its years, its place, its
    // paragraphs, its sets and its headline cards as travel links, every source of its sentences
    // and of its region's sentence, and the stone's travel (6.6.2).
    public sealed class ReadingText
    {
        public string Name, Years, Place;
        public readonly List<string> Paragraphs = new List<string>();
        public readonly List<Choice> Sets = new List<Choice>(), Headlines = new List<Choice>();
        public readonly List<string> Sources = new List<string>();
        public readonly List<Choice> Travel = new List<Choice>();
    }

    // The words a world's stones and its travel menu show, and where their choices lead (PRD v4
    // 5.4.16, 5.13, 6.6), from the pack and the lore document alone.
    public static class Reading
    {
        public const string ReadingStone = "reading", Waystone = "way", MarkerStone = "marker";

        // A site stone's hover label (PRD v4 5.13.1; the glossary's "Stone"): a reading stone the
        // era's name and years; a waystone a name, the first and last year of the site's stands,
        // and its stand count; a marker stone its set's name and year.
        public static string Label(WorldData world, int site)
        {
            WorldSite row = world.Layout.Sites[site];
            if (row.StoneKind == ReadingStone)
            {
                LoreEra era = EraOf(world, row);
                return era == null ? Whereabouts.SiteTitle(world, row) : $"{era.Name} · {era.Years}";
            }
            if (row.StoneKind == MarkerStone)
            {
                return SetLine(world, row.SetIds.Length > 0 ? row.SetIds[0] : -1) ?? Whereabouts.SiteTitle(world, row);
            }
            (int first, int last, int count) = YearsOf(world, site);
            string name = row.Kind == "set" && row.SetIds.Length == 1 && world.Sets != null && world.Sets.TryGetValue(row.SetIds[0], out PackSet set)
                ? set.Name
                : Whereabouts.SiteTitle(world, row);
            string years = count == 0 ? null : first == last ? $"{first}" : $"{first}–{last}";
            return years == null ? $"{name} · {Cards(count)}" : $"{name} · {years} · {Cards(count)}";
        }

        // A chapter stone's hover label: its set's name and year.
        public static string ChapterLabel(WorldData world, int site, int chapter) =>
            SetLine(world, world.Layout.Sites[site].Chapters[chapter].SetId) ?? world.Layout.Sites[site].Key;

        static string Cards(int count) => count == 1 ? "1 card" : $"{count:N0} cards";

        // A set's name and year, or null for a set the pack does not name.
        public static string SetLine(WorldData world, int setId) =>
            world.Sets != null && world.Sets.TryGetValue(setId, out PackSet set) ? $"{set.Name}, {set.Year}" : null;

        // The first and last year of a site's stands, by the year of each card's first printing's
        // set, which is the printing the stand shows (PRD v4 5.5.1); and how many stands it has.
        public static (int First, int Last, int Count) YearsOf(WorldData world, int site)
        {
            int first = int.MaxValue, last = int.MinValue, count = 0;
            for (int stand = 0; stand < world.StandCount; stand++)
            {
                if (world.Site(stand) != site)
                {
                    continue;
                }
                count++;
                PackCard card = world.CardAt(stand);
                if (card.Printings.Length > 0 && world.Sets != null && world.Sets.TryGetValue(card.Printings[0].SetId, out PackSet set))
                {
                    first = Math.Min(first, set.Year);
                    last = Math.Max(last, set.Year);
                }
            }
            return first > last ? (0, 0, count) : (first, last, count);
        }

        public static LoreEra EraOf(WorldData world, WorldSite site) =>
            site.Kind == "era" && world.Lore != null ? Array.Find(world.Lore.Eras, row => row.Id == site.EraId) : null;

        // The reading overlay of an era site's stone, for a walker in the region `region`.
        public static ReadingText Overlay(WorldData world, int site, int region)
        {
            WorldSite row = world.Layout.Sites[site];
            LoreEra era = EraOf(world, row);
            var text = new ReadingText { Name = era?.Name ?? Whereabouts.SiteTitle(world, row), Years = era?.Years };
            if (era == null)
            {
                text.Travel.AddRange(StoneTravel(world, site, region));
                return text;
            }
            LoreRegion place = Array.Find(world.Lore.Regions, candidate => candidate.Id == era.Region);
            text.Place = place?.Name;
            foreach (LoreSentence[] paragraph in era.Paragraphs)
            {
                text.Paragraphs.Add(string.Join(" ", paragraph.Select(sentence => sentence.Text)));
            }
            // Each set to its chapter; a set whose cards all stand at regional sites has an empty
            // chapter, which has no stone and no link (the glossary's "Chapter").
            foreach (int setId in era.SetIds)
            {
                int chapter = Array.FindIndex(row.Chapters, candidate => candidate.SetId == setId);
                text.Sets.Add(new Choice { Text = SetLine(world, setId) ?? $"set {setId}", Way = chapter >= 0 ? Way.ToChapter(site, chapter) : (Way?)null });
            }
            foreach (int stand in era.Headline)
            {
                if (stand < 0 || stand >= world.StandCount)
                {
                    continue;
                }
                PackCard card = world.CardAt(stand);
                string set = card.Printings.Length > 0 && world.Sets != null && world.Sets.TryGetValue(card.Printings[0].SetId, out PackSet first) ? first.Name : null;
                text.Headlines.Add(new Choice { Text = set == null ? card.Name : $"{card.Name} · {set}", Way = Way.Stand(stand) });
            }
            // Every source of the era's sentences and of its region's sentence, each once, in the
            // order they are first named (Appendix F.4).
            foreach (string source in era.Sources.Concat(place?.Sources ?? new string[0]))
            {
                string shown = Source(world, source);
                if (!text.Sources.Contains(shown))
                {
                    text.Sources.Add(shown);
                }
            }
            text.Travel.AddRange(StoneTravel(world, site, region));
            return text;
        }

        // A source as the visitor reads it (Appendix F.4): an address as it is; a card by its name;
        // a printing's flavour text by the card's name, its set and the face.
        public static string Source(WorldData world, string locator)
        {
            if (locator.StartsWith("card:", StringComparison.Ordinal))
            {
                string id = locator.Substring("card:".Length);
                PackCard card = world.Cards.FirstOrDefault(candidate => candidate.OracleId == id);
                return card == null ? locator : $"{card.Name} (the card's name and type line)";
            }
            if (locator.StartsWith("printing:", StringComparison.Ordinal))
            {
                string rest = locator.Substring("printing:".Length);
                int hash = rest.IndexOf('#');
                string id = hash < 0 ? rest : rest.Substring(0, hash), face = hash < 0 ? "front" : rest.Substring(hash + 1);
                foreach (PackCard card in world.Cards)
                {
                    PackPrinting printing = Array.Find(card.Printings, candidate => candidate.Id == id);
                    if (printing != null)
                    {
                        string set = world.Sets != null && world.Sets.TryGetValue(printing.SetId, out PackSet named) ? $", {named.Name}" : "";
                        return $"{card.Name}{set} (the flavour text of its {face} face)";
                    }
                }
            }
            return locator;
        }

        // A reading stone's and a waystone's travel (PRD v4 6.6.2): the previous and the next site
        // on the trail, the plaza, and on a hero world the regional site of the region the walker
        // stands in. An absent neighbour is not listed, nor the site the walker stands at.
        public static List<Choice> StoneTravel(WorldData world, int site, int region)
        {
            WorldSite[] sites = world.Layout.Sites;
            var choices = new List<Choice>();
            if (site > 0)
            {
                choices.Add(new Choice { Text = $"Previous site: {Whereabouts.SiteTitle(world, sites[site - 1])}", Way = Way.Pad(site - 1) });
            }
            if (site + 1 < sites.Length)
            {
                choices.Add(new Choice { Text = $"Next site: {Whereabouts.SiteTitle(world, sites[site + 1])}", Way = Way.Pad(site + 1) });
            }
            choices.Add(new Choice { Text = "The plaza", Way = Way.Plaza });
            int regional = RegionalSite(world, region);
            if (world.Layout.Hero && regional >= 0 && regional != site && regional != site - 1 && regional != site + 1)
            {
                choices.Add(new Choice { Text = $"This region's site: {Whereabouts.SiteTitle(world, sites[regional])}", Way = Way.Pad(regional) });
            }
            return choices;
        }

        // The regional site of a region (PRD v4 5.4.2), or -1.
        public static int RegionalSite(WorldData world, int region)
        {
            if (region < 0)
            {
                return -1;
            }
            string id = world.Layout.Regions[region].Id;
            return id == null ? -1 : Array.FindIndex(world.Layout.Sites, candidate => candidate.Kind == "region" && candidate.RegionId == id);
        }

        // The travel menu's sites in trail order (PRD v4 6.6.1): on a hero world the eras, each with
        // its chapters, then the regional sites; on a kit world the sets. A site leads to its pad, a
        // chapter to its stone, a first chapter to its site's pad; an empty chapter is not listed.
        public static List<Choice> TrailSection(WorldData world)
        {
            var rows = new List<Choice>();
            WorldSite[] sites = world.Layout.Sites;
            for (int s = 0; s < sites.Length; s++)
            {
                int count = 0;
                foreach (SiteCluster cluster in sites[s].Clusters)
                {
                    count += cluster.Stands;
                }
                rows.Add(new Choice { Text = $"{Whereabouts.SiteTitle(world, sites[s])} · {Cards(count)}", Way = Way.Pad(s), Site = s });
                if (sites[s].Kind != "era")
                {
                    continue;
                }
                for (int c = 0; c < sites[s].Chapters.Length; c++)
                {
                    rows.Add(new Choice { Text = SetLine(world, sites[s].Chapters[c].SetId) ?? $"set {sites[s].Chapters[c].SetId}", Way = Way.ToChapter(s, c), Depth = 1 });
                }
            }
            return rows;
        }

        // The travel menu's regions (PRD v4 6.6.1), on a hero world: each leads to its first
        // site's pad, and a region with no site is named and offers no travel.
        public static List<Choice> RegionSection(WorldData world)
        {
            var rows = new List<Choice>();
            if (!world.Layout.Hero)
            {
                return rows;
            }
            foreach (WorldRegion region in world.Layout.Regions)
            {
                rows.Add(region.FirstSite is int first
                    ? new Choice { Text = region.Name, Way = Way.Pad(first) }
                    : new Choice { Text = $"{region.Name} · no site" });
            }
            return rows;
        }
    }
}
