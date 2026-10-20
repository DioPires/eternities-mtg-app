using System;
using System.Collections.Generic;
using System.Linq;
using Eternities.Data;
using Eternities.EditorTools;
using Eternities.Kits;
using Eternities.Layout;
using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Eternities.Tests
{
    // A world's stones and what they say and offer (PRD v4 5.4.16, 5.13, 6.1.3, 6.6; DEC-1005, pull
    // request 3), on the committed `dominaria` fixture. Every figure is the fixture's.
    public class StoneTests
    {
        WorldData world;
        KitDressing kit;

        static float Radius => LayoutConstants.StoneRadius / 1000f;

        [OneTimeSetUp]
        public void Load()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("dominaria");
            var pack = new Pack(fixture.Pack);
            PackPlane plane = pack.Plane("dominaria");
            world = WorldData.Decode(pack.Planes, plane, pack.Cards(plane), fixture.Stands, WorldDocument.Read(fixture.World), LoreDocument.Read(fixture.Lore));
            world.Sets = pack.Sets();
            Generate.KitDressings();
            kit = Generate.Dressing("temperate");
        }

        [OneTimeTearDown]
        public void Done()
        {
            world?.Dispose();
            world = null;
        }

        static IEnumerable<Vector2> Corners(float left, float right, float near, float far)
        {
            yield return new Vector2(left, near);
            yield return new Vector2(left, far);
            yield return new Vector2(right, near);
            yield return new Vector2(right, far);
        }

        // 5.4.8: a stone is a disc of 0.5 m, and the layout keeps its clearances from that disc. The
        // stone's rock and its collider stay inside it at every turn, so their corners do.
        [Test]
        public void EachStoneStandsInsideItsDisc()
        {
            foreach (GameObject prefab in new[] { kit.ReadingStone, kit.Waystone, kit.ChapterStone })
            {
                GameObject made = Object.Instantiate(prefab);
                try
                {
                    Bounds drawn = made.GetComponentInChildren<MeshRenderer>().bounds;
                    foreach (Vector2 corner in Corners(drawn.min.x, drawn.max.x, drawn.min.z, drawn.max.z))
                    {
                        Assert.That(corner.magnitude, Is.LessThanOrEqualTo(Radius), $"{prefab.name}'s rock at {corner}");
                    }
                    Collider[] colliders = made.GetComponentsInChildren<Collider>();
                    Assert.That(colliders.Length, Is.EqualTo(1), $"{prefab.name} has one collider");
                    var box = (BoxCollider)colliders[0];
                    foreach (Vector2 corner in Corners(box.center.x - box.size.x / 2, box.center.x + box.size.x / 2, box.center.z - box.size.z / 2, box.center.z + box.size.z / 2))
                    {
                        Assert.That(corner.magnitude, Is.LessThanOrEqualTo(Radius), $"{prefab.name}'s collider at {corner}");
                    }
                    Assert.That(box.center.y - box.size.y / 2, Is.EqualTo(0).Within(1e-4f), $"{prefab.name}'s collider stands on the ground");
                    Assert.That(drawn.min.y, Is.LessThan(0), $"{prefab.name}'s base is under the ground");
                    Assert.That(drawn.max.y, Is.EqualTo(StoneField.HeightOf(prefab)).Within(0.01f), $"{prefab.name}'s top is its collider's");
                }
                finally
                {
                    Object.DestroyImmediate(made);
                }
            }
        }

        // 5.13.1: a reading stone is about 2 m with an inscription face, on its front, which its pose
        // turns to the pad. A waystone is lower, and a chapter stone lower still.
        [Test]
        public void AReadingStoneStandsAboutTwoMetresWithAFaceAndTheOthersAreLower()
        {
            float reading = StoneField.HeightOf(kit.ReadingStone), way = StoneField.HeightOf(kit.Waystone), chapter = StoneField.HeightOf(kit.ChapterStone);
            Assert.That(reading, Is.InRange(1.8f, 2.2f));
            Assert.That(way, Is.LessThan(reading));
            Assert.That(chapter, Is.LessThan(way));
            Transform face = kit.ReadingStone.transform.Find(StoneField.FaceName);
            Assert.That(face, Is.Not.Null, "the reading stone's face");
            var box = kit.ReadingStone.GetComponent<BoxCollider>();
            Assert.That(face.localScale.x, Is.LessThan(box.size.x));
            Assert.That(face.localPosition.y + face.localScale.y / 2, Is.LessThan(reading));
            Assert.That(face.localPosition.y - face.localScale.y / 2, Is.GreaterThan(0.5f), "read standing, not stooping");
            Assert.That(face.localPosition.z, Is.GreaterThanOrEqualTo(box.size.z / 2), "on the stone's front");
            Assert.That(kit.Waystone.transform.Find(StoneField.FaceName), Is.Null);
            Assert.That(kit.ChapterStone.transform.Find(StoneField.FaceName), Is.Null);
            Assert.That(kit.Tablet, Is.Not.Null);
            Assert.That(kit.Inscription, Is.Not.Null);
        }

        // 5.4.16: a stone at each site, of the kind the pack names, and one at each chapter after an
        // era's first; each where its pose says, turned as it faces, with its label (5.13.1, the
        // glossary's "Stone"). A site's stone faces its pad's centre (docs/data-contract-v4.md).
        [Test]
        public void EveryStoneStandsAtItsPoseWithItsLabel()
        {
            var root = new GameObject("stones test");
            StoneField stones = StoneField.Create(root.transform);
            try
            {
                Greybox.RunAtOnce(stones.Fill(world, kit, float.PositiveInfinity));
                WorldDocument layout = world.Layout;
                Assert.That(stones.Count, Is.EqualTo(layout.Sites.Length + layout.Sites.Sum(site => site.Chapters.Count(chapter => chapter.Stone != null))));
                Assert.That(stones.Inscriptions, Is.EqualTo(layout.Sites.Count(site => site.StoneKind == Reading.ReadingStone)).And.GreaterThan(0));
                foreach (StoneField.Stone stone in stones.All)
                {
                    WorldSite site = layout.Sites[stone.Site];
                    Data.Pose pose = stone.Chapter < 0 ? site.Stone : site.Chapters[stone.Chapter].Stone.Value;
                    Assert.That(Vector3.Distance(stone.Shown.transform.position, StandField.Ground(pose.Position)), Is.LessThan(1e-3f), stone.Shown.name);
                    Assert.That(Quaternion.Angle(stone.Shown.transform.rotation, StandField.Facing(pose.Yaw)), Is.LessThan(0.01f), stone.Shown.name);
                    Assert.That(stone.Kind, Is.EqualTo(stone.Chapter < 0 ? site.StoneKind : StoneField.Chapter));
                    if (stone.Chapter >= 0)
                    {
                        PackSet set = world.Sets[site.Chapters[stone.Chapter].SetId];
                        Assert.That(stone.Label, Is.EqualTo($"{set.Name}, {set.Year}"));
                    }
                    else if (stone.Kind == Reading.ReadingStone)
                    {
                        LoreEra era = world.Lore.Eras.Single(row => row.Id == site.EraId);
                        Assert.That(stone.Label, Is.EqualTo($"{era.Name} · {era.Years}"));
                        Vector3 toPad = StandField.Ground(site.Pad.Position) - stone.Foot;
                        Assert.That(Vector3.Angle(stone.Facing * Vector3.forward, toPad), Is.LessThan(1), $"{site.Key}'s stone faces its pad");
                    }
                    else
                    {
                        // A waystone: its site's name, the first and last year of its stands, and their count.
                        int[] stands = Enumerable.Range(0, world.StandCount).Where(stand => world.Site(stand) == stone.Site).ToArray();
                        int[] years = stands.Select(stand => world.Sets[world.CardAt(stand).Printings[0].SetId].Year).ToArray();
                        string span = years.Min() == years.Max() ? $"{years.Min()}" : $"{years.Min()}–{years.Max()}";
                        Assert.That(stone.Label, Is.EqualTo($"{Whereabouts.SiteTitle(world, site)} · {span} · {stands.Length:N0} cards"));
                    }
                }
            }
            finally
            {
                if (stones.Inscribed != null)
                {
                    Object.DestroyImmediate(stones.Inscribed);
                }
                Object.DestroyImmediate(root);
            }
        }

        // 6.1.3: E or a click uses the nearer of the stand and the stone within reach, and on a tie
        // the stand. A reading stone and a waystone are used; a chapter stone and a marker stone
        // only say what they are.
        [Test]
        public void TheNearerThingIsUsedAndATieGoesToTheStand()
        {
            Assert.That(StoneField.StoneWins(-1, float.MaxValue, -1, float.MaxValue), Is.False, "nothing in reach");
            Assert.That(StoneField.StoneWins(-1, float.MaxValue, 3, 4), Is.True, "a stone alone");
            Assert.That(StoneField.StoneWins(5, 1, -1, float.MaxValue), Is.False, "a stand alone");
            Assert.That(StoneField.StoneWins(5, 1, 3, 4), Is.False, "the stand is nearer");
            Assert.That(StoneField.StoneWins(5, 4, 3, 1), Is.True, "the stone is nearer");
            Assert.That(StoneField.StoneWins(5, 2.25f, 3, 2.25f), Is.False, "a tie goes to the stand");
            Assert.That(StoneField.Usable(Reading.ReadingStone) && StoneField.Usable(Reading.Waystone));
            Assert.That(StoneField.Usable(StoneField.Chapter) || StoneField.Usable(Reading.MarkerStone), Is.False);
        }

        // Where travel to a stand arrives, and where the bench presses E (8.8.4, step 6), is the
        // stand's apron: there, no stone is nearer than the stand, so E enters its card view.
        [Test]
        public void OnEveryStandsApronNoStoneIsNearerThanItsStand()
        {
            var stones = new List<Vector3>();
            foreach (WorldSite site in world.Layout.Sites)
            {
                stones.Add(StandField.Ground(site.Stone.Position));
                stones.AddRange(site.Chapters.Where(chapter => chapter.Stone != null).Select(chapter => StandField.Ground(chapter.Stone.Value.Position)));
            }
            float ahead = (LayoutConstants.FootprintDepth / 2 + LayoutConstants.ApronDepth / 2) / 1000f, closest = float.MaxValue;
            for (int stand = 0; stand < world.StandCount; stand++)
            {
                Vector3 at = StandField.Ground(world.Position(stand));
                Vector3 apron = at + StandField.Facing(world, stand) * Vector3.forward * ahead;
                float standSquared = (at - apron).sqrMagnitude;
                for (int s = 0; s < stones.Count; s++)
                {
                    float stoneSquared = (stones[s] - apron).sqrMagnitude;
                    closest = Mathf.Min(closest, Mathf.Sqrt(stoneSquared));
                    Assert.That(StoneField.StoneWins(stand, standSquared, s, stoneSquared), Is.False, $"on stand {stand}'s apron, a stone {Mathf.Sqrt(stoneSquared):F2} m away");
                }
            }
            Debug.Log($"StoneTests: on {world.StandCount} aprons the nearest stone is {closest:F2} m away; each stand is {ahead:F2} m away");
        }

        // 5.13.1: the overlay holds the era's name, years and place, its paragraphs, its sets (each
        // to its chapter), its headline cards (each to its stand), every source of the era's and of
        // its region's sentences once, and the stone's travel.
        [Test]
        public void TheReadingOverlayHoldsItsErasWordsLinksAndSources()
        {
            WorldDocument layout = world.Layout;
            var where = new Whereabouts(layout);
            int empty = 0, eras = 0;
            for (int s = 0; s < layout.Sites.Length; s++)
            {
                WorldSite site = layout.Sites[s];
                if (site.Kind != "era")
                {
                    continue;
                }
                eras++;
                LoreEra era = world.Lore.Eras.Single(row => row.Id == site.EraId);
                LoreRegion place = world.Lore.Regions.Single(row => row.Id == era.Region);
                int region = where.Region(site.Stone.Position);
                ReadingText text = Reading.Overlay(world, s, region);
                Assert.That(text.Name, Is.EqualTo(era.Name));
                Assert.That(text.Years, Is.EqualTo(era.Years));
                Assert.That(text.Place, Is.EqualTo(place.Name));
                Assert.That(text.Paragraphs, Is.EqualTo(era.Paragraphs.Select(paragraph => string.Join(" ", paragraph.Select(sentence => sentence.Text)))));
                Assert.That(text.Sets.Count, Is.EqualTo(era.SetIds.Length));
                for (int i = 0; i < era.SetIds.Length; i++)
                {
                    PackSet set = world.Sets[era.SetIds[i]];
                    int chapter = Array.FindIndex(site.Chapters, row => row.SetId == era.SetIds[i]);
                    Assert.That(text.Sets[i].Text, Is.EqualTo($"{set.Name}, {set.Year}"));
                    Assert.That(text.Sets[i].Way, Is.EqualTo(chapter >= 0 ? Way.ToChapter(s, chapter) : (Way?)null), $"{site.Key}'s {set.Code}");
                    empty += chapter < 0 ? 1 : 0;
                }
                Assert.That(text.Headlines.Select(choice => choice.Way), Is.EqualTo(era.Headline.Select(stand => (Way?)Way.Stand(stand))));
                for (int i = 0; i < era.Headline.Length; i++)
                {
                    Assert.That(text.Headlines[i].Text, Does.StartWith(world.CardAt(era.Headline[i]).Name));
                }
                string[] sources = era.Sources.Concat(place.Sources).Distinct().ToArray();
                Assert.That(text.Sources.Count, Is.EqualTo(sources.Length), $"{site.Key}: each source once");
                Assert.That(text.Sources, Is.EqualTo(sources.Select(source => Reading.Source(world, source))));
                Assert.That(text.Sources.Any(source => source.StartsWith("printing:", StringComparison.Ordinal) || source.StartsWith("card:", StringComparison.Ordinal)), Is.False,
                    "a card or a printing is named, not given as its locator");
                Assert.That(text.Travel.Select(choice => choice.Way), Is.EqualTo(Reading.StoneTravel(world, s, region).Select(choice => choice.Way)));
            }
            Debug.Log($"StoneTests: {eras} eras; {empty} of their sets have an empty chapter and no link");
        }

        // The glossary's "Chapter": a set whose cards all stand at regional sites has an empty
        // chapter, which the pack does not list. The overlay names the set with no link, and the
        // travel menu does not list it. Dominaria has none, so one era here loses its first chapter.
        [Test]
        public void ASetWhoseChapterIsEmptyIsNamedWithNoLink()
        {
            WorldDocument layout = world.Layout;
            int s = Array.FindIndex(layout.Sites, site => site.Kind == "era" && site.Chapters.Length > 1);
            WorldSite site = layout.Sites[s];
            SiteChapter[] chapters = site.Chapters;
            try
            {
                site.Chapters = chapters.Skip(1).ToArray();
                ReadingText text = Reading.Overlay(world, s, -1);
                Assert.That(text.Sets[0].Way, Is.Null, "the set of the empty chapter");
                Assert.That(text.Sets[1].Way, Is.EqualTo((Way?)Way.ToChapter(s, 0)));
                string first = Reading.SetLine(world, chapters[0].SetId);
                Assert.That(Reading.TrailSection(world).Count(row => row.Depth == 1 && row.Text == first && row.Way is Way way && way.Index == s), Is.Zero);
            }
            finally
            {
                site.Chapters = chapters;
            }
        }

        // 6.6.2: a reading stone and a waystone offer the previous and the next site on the trail,
        // the plaza, and the regional site of the region the walker stands in; never an absent
        // neighbour, nor the site the walker stands at.
        [Test]
        public void AStoneOffersTheTrailsNeighboursThePlazaAndItsRegionsSite()
        {
            WorldDocument layout = world.Layout;
            var where = new Whereabouts(layout);
            int n = layout.Sites.Length;
            for (int s = 0; s < n; s++)
            {
                int region = where.Region(layout.Sites[s].Stone.Position);
                List<Choice> choices = Reading.StoneTravel(world, s, region);
                var wanted = new List<Way>();
                if (s > 0)
                {
                    wanted.Add(Way.Pad(s - 1));
                }
                if (s + 1 < n)
                {
                    wanted.Add(Way.Pad(s + 1));
                }
                wanted.Add(Way.Plaza);
                int regional = Array.FindIndex(layout.Sites, site => site.Kind == "region" && region >= 0 && site.RegionId == layout.Regions[region].Id);
                if (regional >= 0 && Math.Abs(regional - s) > 1)
                {
                    wanted.Add(Way.Pad(regional));
                }
                Assert.That(choices.Select(choice => choice.Way.Value), Is.EqualTo(wanted), layout.Sites[s].Key);
                Assert.That(choices.Any(choice => choice.Way.Value.Equals(Way.Pad(s))), Is.False, $"{layout.Sites[s].Key} offers itself");
            }
            Assert.That(Reading.StoneTravel(world, 0, -1).First().Text, Does.StartWith("Next site"));
            Assert.That(Reading.StoneTravel(world, n - 1, -1).First().Text, Does.StartWith("Previous site"));
        }

        // 6.6.1: the menu's trail is the sites in trail order, each era with its chapters under it
        // (each to its stone, a first chapter to its site's pad); then the regions, each to its
        // first site's pad, and a region with no site named with no travel.
        [Test]
        public void TheTravelMenuListsTheTrailThenTheRegions()
        {
            WorldDocument layout = world.Layout;
            var wanted = new List<(Way Way, int Depth, int Site)>();
            for (int s = 0; s < layout.Sites.Length; s++)
            {
                wanted.Add((Way.Pad(s), 0, s));
                if (layout.Sites[s].Kind == "era")
                {
                    wanted.AddRange(layout.Sites[s].Chapters.Select((chapter, c) => (Way.ToChapter(s, c), 1, -1)));
                }
            }
            List<Choice> trail = Reading.TrailSection(world);
            Assert.That(trail.Select(row => (row.Way.Value, row.Depth, row.Site)), Is.EqualTo(wanted));
            string[] kinds = layout.Sites.Select(site => site.Kind).ToArray();
            Assert.That(kinds.SkipWhile(kind => kind == "era").All(kind => kind == "region"), "the eras, then the regional sites");

            List<Choice> regions = Reading.RegionSection(world);
            Assert.That(regions.Select(row => row.Way), Is.EqualTo(layout.Regions.Select(region => region.FirstSite is int first ? Way.Pad(first) : (Way?)null)));
            Assert.That(regions.Select(row => row.Text), Is.EqualTo(layout.Regions.Select(region => region.Name)));
            WorldRegion named = layout.Regions[0];
            int? held = named.FirstSite;
            try
            {
                named.FirstSite = null;
                Choice none = Reading.RegionSection(world)[0];
                Assert.That(none.Way, Is.Null);
                Assert.That(none.Text, Does.StartWith(named.Name));
            }
            finally
            {
                named.FirstSite = held;
            }
        }

        // Travel to a chapter arrives on its site's path, at the point nearest its stone, facing it;
        // to a first chapter, on its site's pad.
        [Test]
        public void TravelToAChapterArrivesOnItsSitesPathFacingItsStone()
        {
            float clear = Radius + LayoutConstants.PathHalfWidth / 1000f;
            foreach (WorldSite site in world.Layout.Sites.Where(site => site.Kind == "era"))
            {
                for (int c = 0; c < site.Chapters.Length; c++)
                {
                    Vector3 arrival = StoneField.ChapterArrival(site, c, out Quaternion heading);
                    Data.Pose? stone = site.Chapters[c].Stone;
                    if (stone == null)
                    {
                        Assert.That(arrival, Is.EqualTo(StandField.Ground(site.Pad.Position)));
                        continue;
                    }
                    Vector3 at = StandField.Ground(stone.Value.Position);
                    Assert.That(Vector3.Angle(heading * Vector3.forward, at - arrival), Is.LessThan(0.5f), $"{site.Key}'s chapter {c} faces its stone");
                    Assert.That(Vector3.Distance(arrival, at), Is.GreaterThanOrEqualTo(clear - 0.01f), $"{site.Key}'s chapter {c} arrives clear of its stone");
                    Assert.That(Vector3.Distance(arrival, at), Is.LessThan(15), $"{site.Key}'s chapter {c} arrives by its stone");
                    float onPath = float.MaxValue;
                    for (int i = 0; i + 1 < site.Path.Length; i++)
                    {
                        Vector3 a = StandField.Ground(site.Path[i]), b = StandField.Ground(site.Path[i + 1]);
                        float t = Mathf.Clamp01(Vector3.Dot(arrival - a, b - a) / Mathf.Max((b - a).sqrMagnitude, 1e-9f));
                        onPath = Mathf.Min(onPath, Vector3.Distance(arrival, a + (b - a) * t));
                    }
                    Assert.That(onPath, Is.LessThan(1e-3f), $"{site.Key}'s chapter {c} arrives on its path");
                }
            }
        }
    }
}
