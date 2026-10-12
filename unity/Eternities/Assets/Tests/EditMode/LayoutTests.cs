using System;
using System.Collections.Generic;
using System.IO;
using Eternities.Data;
using Eternities.Layout;
using NUnit.Framework;

namespace Eternities.Tests
{
    // The allocator of PRD v4 5.4 and its independent checker (3.2), on the pinned pack. The pipeline
    // has no allocator yet, so 5.4.13's fixture files do not exist: the worlds that section lists are
    // allocated here from the pack, checked, and pinned by the digest of their layout file.
    public class LayoutTests
    {
        static Pack pack;

        static Pack Pack => pack ??= new Pack(TestPack.Directory);

        static WorldLayout Allocate(string slug)
        {
            PackPlane plane = Pack.Plane(slug);
            return Allocator.Run(LayoutInputs.From(plane, Pack.Cards(plane)));
        }

        static void AssertPasses(WorldLayout layout)
        {
            Checker.Result check = Checker.Check(layout);
            Assert.That(check.Violations, Is.Empty, $"{layout.Input.PlaneSlug}: {check.ViolationCount} violations");
            Assert.That(layout.Stands.Count, Is.EqualTo(layout.Input.Cards.Length));
        }

        // Cards of one set and class, with oracle ids that sort in the order they are made.
        static void Add(List<LayoutCard> cards, int set, ColourClass colour, int count)
        {
            for (int i = 0; i < count; i++)
            {
                cards.Add(new LayoutCard { OracleId = $"00000000-0000-4000-8000-{cards.Count:x12}", Set = set, Class = colour });
            }
        }

        static LayoutInput Synthetic(string slug, int sets, Action<List<LayoutCard>> fill)
        {
            var cards = new List<LayoutCard>();
            fill(cards);
            var codes = new string[sets];
            for (int i = 0; i < sets; i++)
            {
                codes[i] = $"s{i:00}";
            }
            return new LayoutInput { PlaneSlug = slug, SetCodes = codes, Cards = cards.ToArray() };
        }

        [Test]
        public void TheGeneratorIsSplitMix64SeededByFnv1a64()
        {
            // FNV-1a 64 of "", "a" and "foobar", from the reference vectors.
            Assert.That(SplitMix64.Fnv1a64(""), Is.EqualTo(0xcbf29ce484222325UL));
            Assert.That(SplitMix64.Fnv1a64("a"), Is.EqualTo(0xaf63dc4c8601ec8cUL));
            Assert.That(SplitMix64.Fnv1a64("foobar"), Is.EqualTo(0x85944171f73967e8UL));
            // splitmix64 from the seed 1234567, the reference implementation's first outputs.
            var random = new SplitMix64(1234567UL);
            Assert.That(random.Next(), Is.EqualTo(6457827717110365317UL));
            Assert.That(random.Next(), Is.EqualTo(3203168211198807973UL));
            Assert.That(random.Next(), Is.EqualTo(9817491932198370423UL));
        }

        [Test]
        public void DirectionsAreSineAndCosineToTheLastDigit()
        {
            Assert.That(Fixed.Direction(0), Is.EqualTo(new P2(0, Fixed.Unit)));
            Assert.That(Fixed.Direction(90_000_000), Is.EqualTo(new P2(Fixed.Unit, 0)));
            Assert.That(Fixed.Direction(180_000_000), Is.EqualTo(new P2(0, -Fixed.Unit)));
            Assert.That(Fixed.Direction(270_000_000), Is.EqualTo(new P2(-Fixed.Unit, 0)));
            Assert.That(Fixed.Direction(30_000_000).X, Is.EqualTo(Fixed.Unit / 2));
            for (long angle = -400_000_000; angle < 800_000_000; angle += 7_654_321)
            {
                P2 d = Fixed.Direction(angle);
                double radians = angle / 1e6 * Math.PI / 180;
                Assert.That(d.X, Is.EqualTo(Math.Sin(radians) * Fixed.Unit).Within(1.5), $"sine of {angle}");
                Assert.That(d.Z, Is.EqualTo(Math.Cos(radians) * Fixed.Unit).Within(1.5), $"cosine of {angle}");
                // A direction's angle is the angle again, to the micro-degree its rounding allows.
                long back = Fixed.Angle(d.X, d.Z);
                long turned = ((angle % Fixed.FullTurn) + Fixed.FullTurn) % Fixed.FullTurn;
                long apart = Math.Abs(back - turned);
                Assert.That(Math.Min(apart, Fixed.FullTurn - apart), Is.LessThanOrEqualTo(1), $"angle of the direction of {angle}");
            }
            Assert.That(Fixed.Angle(0, 5), Is.EqualTo(0));
            Assert.That(Fixed.Angle(5, 0), Is.EqualTo(90_000_000));
            Assert.That(Fixed.Angle(0, -5), Is.EqualTo(180_000_000));
            Assert.That(Fixed.Angle(-5, 0), Is.EqualTo(270_000_000));
            Assert.That(Fixed.Angle(-1, 1_000_000_000), Is.EqualTo(359_999_999));
        }

        // PRD v4 5.4.4, the worked check, then n = 2 and n = 6 (8.8.1).
        [TestCase(new long[] { 100, 1, 1 }, new long[] { 120_000_000, 120_000_000, 120_000_000 })]
        [TestCase(new long[] { 1, 1 }, new long[] { 180_000_000, 180_000_000 })]
        [TestCase(new long[] { 1000, 1 }, new long[] { 180_000_000, 180_000_000 })]     // with two classes hi is a half turn, and both reach it
        [TestCase(new long[] { 5, 5, 5, 5, 5, 5 }, new long[] { 60_000_000, 60_000_000, 60_000_000, 60_000_000, 60_000_000, 60_000_000 })]
        [TestCase(new long[] { 1, 1, 1, 1, 1, 1000 }, new long[] { 48_000_000, 48_000_000, 48_000_000, 48_000_000, 48_000_000, 120_000_000 })]
        public void WedgeAnglesAreBoundedAndProportional(long[] counts, long[] expected)
        {
            int n = counts.Length;
            long[] angles = Allocator.Proportional(counts, Math.Min(30_000_000, Fixed.FullTurn / n), Math.Max(120_000_000, Fixed.FullTurn / n));
            Assert.That(angles, Is.EqualTo(expected));
        }

        [Test]
        public void WedgeAnglesAlwaysSumToAFullTurn()
        {
            var random = new SplitMix64(7UL);
            for (int round = 0; round < 500; round++)
            {
                int n = 2 + random.Below(5);
                var counts = new long[n];
                for (int i = 0; i < n; i++)
                {
                    counts[i] = 1 + random.Below(random.Below(2) == 0 ? 10 : 7000);
                }
                long lo = Math.Min(30_000_000, Fixed.FullTurn / n), hi = Math.Max(120_000_000, Fixed.FullTurn / n);
                long[] angles = Allocator.Proportional(counts, lo, hi);
                long sum = 0;
                for (int i = 0; i < n; i++)
                {
                    Assert.That(angles[i], Is.InRange(lo, hi));
                    sum += angles[i];
                    for (int j = 0; j < n; j++)
                    {
                        // More cards never means a smaller wedge, give or take the apportioned micro-degree.
                        Assert.That(counts[i] <= counts[j] || angles[i] >= angles[j] - 1, $"round {round}");
                    }
                }
                Assert.That(sum, Is.EqualTo(Fixed.FullTurn), $"round {round}");
            }
        }

        // PRD v4 5.4.14: the slice reports Dominaria's actual figures. They are pinned here with the
        // layout's digest, so a change to the allocator that moves a stand is a change to this test.
        [Test]
        public void DominariaIsAllocatedAndPassesTheChecker()
        {
            WorldLayout layout = Allocate("dominaria");
            AssertPasses(layout);
            Assert.That(layout.Stands.Count, Is.EqualTo(6271));
            Assert.That(layout.Sites.Count, Is.EqualTo(233));
            Assert.That(layout.Sites.FindAll(site => site.Stands < 5).Count, Is.EqualTo(27));
            Assert.That(layout.Sites.FindAll(site => site.Class == ColourClass.Colourless).Count, Is.EqualTo(31));
            Assert.That(Checker.Check(layout).MinSpacing, Is.GreaterThanOrEqualTo(2500));
            Assert.That(layout.WorldRadius, Is.EqualTo(DominariaRadius));
            Assert.That(LayoutFile.Digest(LayoutFile.Write(layout)), Is.EqualTo(DominariaDigest));
        }

        public const long DominariaRadius = 412_088;
        public const string DominariaDigest = "80ce6026c109185c40e27ca62d9988907274e891cb4189272f40023e7510d4a0";

        // The other worlds of PRD v4 5.4.13 that the pack holds, by slug, with the digest of each.
        [TestCase("blind-eternities", 4204, "ea5080ea125a2ffb8ef25d685ab465d89dc6789bac978862910818f2be8f6d64")]
        [TestCase("alara", 510, "00fa89a8b2d748282f0782509d3649bcb924ace69eac94acfe11ff5d5a0c7809")]
        [TestCase("new-phyrexia", 1405, "76797dc7b327829f5d10ee830e76b97f9e3a785432cc8094bba5013c3509027d")]
        [TestCase("rabiah", 75, "aea4a7441ebaefd0f75931d0ecfc33b062b065d27ebced551b6b816864d353b4")]
        [TestCase("zhalfir", 4, "046c78415378ca7b5a02641bcb5ad83cc849e3a0977b5e414fe35122b1b0356a")]
        [TestCase("vryn", 2, "57f20a24085532fbc4f80f9d2e4e65e40f5909d80a34b8c664f2d37515547ce8")]
        [TestCase("shandalar", 1, "58fed28f28cb4dd568a53da71434bdb42b72578dd77124c09ee923ecabb4b6d4")]
        public void TheFixtureWorldsAreAllocatedAndPassTheChecker(string slug, int cards, string digest)
        {
            WorldLayout layout = Allocate(slug);
            AssertPasses(layout);
            Assert.That(layout.Stands.Count, Is.EqualTo(cards));
            Assert.That(LayoutFile.Digest(LayoutFile.Write(layout)), Is.EqualTo(digest));
        }

        [Test]
        public void EveryWorldOfThePackPassesTheChecker()
        {
            int worlds = 0;
            foreach (PackPlane plane in Pack.Planes)
            {
                if (plane.CardCount > 0)
                {
                    AssertPasses(Allocate(plane.Slug));
                    worlds++;
                }
            }
            Assert.That(worlds, Is.EqualTo(46));
        }

        // PRD v4 5.4.12: a small world is a 12 m plaza, its path, one 6 m band and that band's path.
        [Test]
        public void ASmallWorldIsAPlazaAndOneBand()
        {
            WorldLayout vryn = Allocate("vryn");
            Assert.That(vryn.PlazaRadius, Is.EqualTo(12_000));
            Assert.That(vryn.WorldRadius, Is.EqualTo(24_000));
            Assert.That(vryn.Sites.Count, Is.EqualTo(1));
            Assert.That(vryn.WedgeSpan[(int)ColourClass.Blue], Is.EqualTo(Fixed.FullTurn));
            Assert.That(vryn.Bands[0].Width, Is.EqualTo(6000));
        }

        // PRD v4 5.4.13's two synthetic planes without a wedge.
        [Test]
        public void AnAllColourlessPlaneIsARingAroundThePlaza()
        {
            WorldLayout layout = Allocator.Run(Synthetic("synthetic-colourless", 3, cards =>
            {
                Add(cards, 0, ColourClass.Colourless, 5);
                Add(cards, 1, ColourClass.Colourless, 2);
                Add(cards, 2, ColourClass.Colourless, 8);
            }));
            AssertPasses(layout);
            Assert.That(layout.Sites.Count, Is.EqualTo(3));
            Assert.That(layout.Bands.FindAll(band => band.Width > 0), Is.Empty);
            Assert.That(layout.RingInner, Is.EqualTo(layout.PlazaRadius + 3000));
            Assert.That(layout.Paths.FindAll(path => path.Kind == PathKind.Radial), Is.Empty);
        }

        // A finding of the slice, held as a test: with no wedge the only path is the one around the
        // plaza, every corridor has to reach it, and a wider ring adds no length to it. So a plane
        // of colourless cards alone stops fitting at a few dozen cards, and fails as 5.4.9 names.
        [Test]
        public void AnAllColourlessPlaneOfManyCardsFailsNamingTheSite()
        {
            var failure = Assert.Throws<LayoutException>(() => Allocator.Run(Synthetic("synthetic-colourless", 3, cards =>
            {
                Add(cards, 0, ColourClass.Colourless, 40);
                Add(cards, 1, ColourClass.Colourless, 3);
                Add(cards, 2, ColourClass.Colourless, 120);
            })));
            StringAssert.Contains("synthetic-colourless/s", failure.Message);
            StringAssert.Contains("after 20 widenings", failure.Message);
        }

        [Test]
        public void ASetWithOnlyColourlessCardsHasABandOfNoWidthAndAnArc()
        {
            WorldLayout layout = Allocator.Run(Synthetic("synthetic-one-set", 1, cards => Add(cards, 0, ColourClass.Colourless, 12)));
            AssertPasses(layout);
            Assert.That(layout.Bands[0].Width, Is.EqualTo(0));
            Assert.That(layout.Sites.Count, Is.EqualTo(1));
            Assert.That(layout.Sites[0].AngleSpan, Is.EqualTo(Fixed.FullTurn));
            Assert.That(layout.Stands.Count, Is.EqualTo(12));
        }

        // PRD v4 5.4.8 and 5.4.11: a hero volume keeps stands out, and one on a path fails the build
        // with its name.
        [Test]
        public void AHeroVolumeKeepsStandsOutAndMayNotCoverAPath()
        {
            LayoutInput Rabiah(HeroVolume volume)
            {
                PackPlane plane = Pack.Plane("rabiah");
                LayoutInput input = LayoutInputs.From(plane, Pack.Cards(plane));
                input.HeroVolumes = new[] { volume };
                return input;
            }

            WorldLayout plain = Allocate("rabiah");
            LayoutSite site = plain.Sites[0];
            WorldLayout layout = Allocator.Run(Rabiah(new HeroVolume { Id = "obelisk", Centre = site.Centre, Radius = 2000 }));
            AssertPasses(layout);
            foreach (LayoutStand stand in layout.Stands)
            {
                Assert.That((stand.Position - site.Centre).LengthSquared, Is.GreaterThan(2000L * 2000L));
            }
            Assert.That(LayoutFile.Write(layout), Is.Not.EqualTo(LayoutFile.Write(plain)));

            var onPath = new HeroVolume { Id = "gate", Centre = new P2(0, plain.PlazaRadius + 1500), Radius = 1000 };
            var failure = Assert.Throws<LayoutException>(() => Allocator.Run(Rabiah(onPath)));
            StringAssert.Contains("gate", failure.Message);
            var onArrival = new HeroVolume { Id = "statue", Box = new[] { new P2(-1000, -1000), new P2(-1000, 1000), new P2(1000, 1000), new P2(1000, -1000) } };
            failure = Assert.Throws<LayoutException>(() => Allocator.Run(Rabiah(onArrival)));
            StringAssert.Contains("statue", failure.Message);
        }

        [Test]
        public void ALayoutFileReadsBackAsTheSameLayout()
        {
            WorldLayout layout = Allocate("alara");
            string text = LayoutFile.Write(layout);
            WorldLayout back = LayoutFile.Read(text);
            Assert.That(LayoutFile.Write(back), Is.EqualTo(text));
            AssertPasses(back);
            Assert.That(back.Input.Cards[17].OracleId, Is.EqualTo(layout.Input.Cards[17].OracleId));
        }

        // The checker is only worth its pass if it fails on a broken layout. Each case breaks one
        // rule of invariants 7, 9 or 10 on a layout that passes.
        [Test]
        public void TheCheckerFailsABrokenLayout()
        {
            string text = LayoutFile.Write(Allocate("rabiah"));
            Checker.Result Broken(Action<WorldLayout> breakIt)
            {
                WorldLayout layout = LayoutFile.Read(text);
                breakIt(layout);
                return Checker.Check(layout);
            }
            void Moved(LayoutStand stand, P2 by)
            {
                stand.Position += by;
                stand.Lattice += by;
                stand.PathPoint += by;
            }

            Assert.That(Broken(layout => { }).Passed, "the layout passes before it is broken");

            // Invariant 9: two stands under 2.5 m apart.
            Checker.Result close = Broken(layout => Moved(layout.Stands[1], layout.Stands[0].Position - layout.Stands[1].Position + new P2(2400, 0)));
            Assert.That(close.Violations, Has.Some.Contains("m apart"));

            // Invariant 9: a stand on a path. The first ring path runs around the plaza.
            Checker.Result onPath = Broken(layout => Moved(layout.Stands[0], new P2(0, layout.PlazaRadius + 1500) - layout.Stands[0].Position));
            Assert.That(onPath.Violations, Has.Some.Contains("is on path 0"));

            // Invariant 9: a corridor that stops short of its path.
            Checker.Result shortCorridor = Broken(layout =>
            {
                LayoutStand stand = layout.Stands[0];
                P2 half = stand.PathPoint - stand.Position;
                stand.PathPoint = stand.Position + new P2(half.X * 3 / 4, half.Z * 3 / 4);
            });
            Assert.That(shortCorridor.Violations, Has.Some.Contains("does not end on its path"));

            // Invariant 7: a card in another site's place, and a card with no stand.
            Checker.Result swapped = Broken(layout =>
            {
                LayoutStand a = layout.Stands[0];
                LayoutStand b = layout.Stands.Find(stand => stand.Site != a.Site);
                (a.Card, b.Card) = (b.Card, a.Card);
            });
            Assert.That(swapped.Violations, Has.Some.Contains("not its set and class"));
            Checker.Result missing = Broken(layout => layout.Stands.RemoveAt(0));
            Assert.That(missing.Violations, Has.Some.Contains("has 0 stands"));

            // Invariant 10: a path that joins nothing, and a site pad off the network.
            Checker.Result apart = Broken(layout =>
            {
                LayoutPath ring = layout.Paths.Find(path => path.Kind == PathKind.Ring && path.Id > 0);
                ring.Inner += 500_000;
                ring.Outer += 500_000;
            });
            Assert.That(apart.Violations, Has.Some.Contains("is not joined"));
            Checker.Result padOff = Broken(layout =>
            {
                LayoutPad pad = layout.Pads.Find(p => p.Kind == PadKind.Site);
                pad.Centre += new P2(900_000, 0);
            });
            Assert.That(padOff.Violations, Has.Some.Contains("does not touch the path network"));
        }
    }
}
