using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Layout;
using NUnit.Framework;

namespace Eternities.Tests
{
    // The C# checker of PRD v4 3.2 on every fixture of 5.4.14 (8.3.3, 8.8.2): its document is the
    // pipeline checker's `check.json`, and a fixture changed to break a rule is reported under it.
    public class CheckerTests
    {
        static IEnumerable<string> LayoutNames() => LayoutFixtures.LayoutNames();

        static IEnumerable<string> PredicateNames() =>
            Directory.GetFiles(Path.Combine(LayoutFixtures.Root, "predicates"), "*.json").Select(Path.GetFileNameWithoutExtension).OrderBy(name => name, System.StringComparer.Ordinal);

        static HashSet<string> Rules(Checker.Result result) => result.RulesBroken();

        static List<string> Under(Checker.Result result, string rule) => result.Violations.Where(line => line.StartsWith(rule + ": ")).ToList();

        // The result, the violation count, the tests made under every rule and the figures are the
        // pipeline's, on every fixture that lays a world out.
        [TestCaseSource(nameof(LayoutNames))]
        public void TheCheckerAgreesWithThePipelineOnEveryFixture(string name)
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named(name);
            Checker.Result result = LayoutFixtures.Check(fixture);
            Dictionary<string, object> expected = fixture.CheckDocument;
            Assert.That(result.Violations, Is.Empty);
            Assert.That(result.Passed ? "pass" : "fail", Is.EqualTo(Json.Text(expected["result"])));
            Assert.That(result.ViolationCount, Is.EqualTo(Json.Int(expected["violationCount"])));
            Dictionary<string, object> assertions = Json.Object(expected["assertions"]);
            Assert.That(result.Assertions.Keys, Is.EquivalentTo(assertions.Keys), "the rule names");
            foreach (KeyValuePair<string, object> rule in assertions)
            {
                Assert.That(result.Assertions[rule.Key], Is.EqualTo(Json.Long(rule.Value)), $"the tests under {rule.Key}");
            }
            Dictionary<string, object> figures = Json.Object(expected["figures"]);
            Assert.That(result.MinimumStandSpacing, Is.EqualTo(figures["minimumStandSpacing"] == null ? (long?)null : Json.Long(figures["minimumStandSpacing"])));
            Assert.That(result.Connected, Is.EqualTo((bool)figures["connected"]));
            List<object> sites = Json.Array(figures["sites"]);
            Assert.That(result.Sites.Count, Is.EqualTo(sites.Count));
            for (int i = 0; i < sites.Count; i++)
            {
                Dictionary<string, object> site = Json.Object(sites[i]);
                Checker.SiteFigures mine = result.Sites[i];
                Assert.That(new object[] { mine.Key, mine.ToFirst, mine.Between, mine.ToEnd, mine.PathLength },
                    Is.EqualTo(new object[] { Json.Text(site["key"]), Json.Long(site["toFirst"]), Json.Long(site["between"]), Json.Long(site["toEnd"]), Json.Long(site["pathLength"]) }));
            }
        }

        // PRD v4 5.4.14: the notch, the nested squares and the notch vertex are negative tests of
        // the strip rule, the intersection rule and the polygon rule in both checkers. Each holds as
        // stated, and the same shapes with the verdict turned are reported.
        [TestCaseSource(nameof(PredicateNames))]
        public void ThePredicateFixturesHoldAsTheyAreStated(string name)
        {
            object document = Json.Parse(File.ReadAllText(Path.Combine(LayoutFixtures.Root, "predicates", name + ".json")));
            Assert.That(Checker.CheckPredicates(document), Is.Empty);
            Dictionary<string, object> turned = Json.Object(document);
            turned["expected"] = !(bool)turned["expected"];
            List<string> found = Checker.CheckPredicates(turned);
            Assert.That(found.Count, Is.EqualTo(1));
            StringAssert.Contains("is expected", found[0]);
        }

        static readonly P2[] Square = { new P2(0, 0), new P2(10, 0), new P2(10, 10), new P2(0, 10) };

        // The polygon rule of 5.4.18 (10): an outer boundary that enters the square at a vertex on
        // its edge is seen, and a shared edge and a vertex on the boundary count inside.
        [Test]
        public void APolygonInsideAPolygonIsDecidedOnTheFilledShapes()
        {
            P2[] notch = { new P2(-5, -5), new P2(15, -5), new P2(15, 15), new P2(10, 15), new P2(10, 5), new P2(0, 5), new P2(0, 15), new P2(-5, 15) };
            Assert.That(Predicates.PolygonInsidePolygon(Square, notch), Is.False);
            P2[] sharesAnEdge = { new P2(0, 0), new P2(20, 0), new P2(20, 20), new P2(0, 20) };
            Assert.That(Predicates.PolygonInsidePolygon(Square, sharesAnEdge), Is.True);
            P2[] touchesAVertex = { new P2(-10, 0), new P2(10, -10), new P2(30, 10), new P2(10, 30), new P2(-10, 10) };
            Assert.That(Predicates.PolygonInsidePolygon(Square, touchesAVertex), Is.True);
            P2[] crossesAtItsVertices = { new P2(-5, -5), new P2(15, -5), new P2(15, 15), new P2(7, 15), new P2(7, 10), new P2(5, 8), new P2(3, 10), new P2(3, 15), new P2(-5, 15) };
            Assert.That(Predicates.PolygonInsidePolygon(Square, crossesAtItsVertices), Is.False);
            // Two polygons that share no point do not intersect; one inside the other does.
            Assert.That(Predicates.PolygonsIntersect(Square, sharesAnEdge), Is.True);
            Assert.That(Predicates.PolygonsIntersect(Square, Square.Select(p => new P2(p.X + 11, p.Z)).ToArray()), Is.False);
        }

        // The exact cross product of every orientation test: a sign of 128-bit products, here at
        // the size of a rebuilt shape's coordinates.
        [Test]
        public void TheCrossSignIsExactBeyondSixtyFourBits()
        {
            long big = 1L << 52;
            Assert.That(Predicates.CrossSign(big, big, big, big), Is.Zero);
            Assert.That(Predicates.CrossSign(big + 1, big, big, big), Is.EqualTo(1));
            Assert.That(Predicates.CrossSign(big, big, big + 1, big), Is.EqualTo(-1));
            Assert.That(Predicates.CrossSign(-big, big, big, -big), Is.Zero);
            Assert.That(Predicates.CrossSign(-big, big - 1, -big, big), Is.EqualTo(1));
            Assert.That(Predicates.CrossSign(0, 5, -3, 2), Is.EqualTo(1));
            // Products past 2^63, whose sign a product in `long` gets wrong (DEC-1130 N3): 2^80 − 1
            // reads 0 − 1 in 64 bits, 3 × 2^62 reads as negative, and 2^64 reads 0.
            Assert.That(Predicates.CrossSign(1L << 40, 1L << 40, 1, 1), Is.EqualTo(1));
            Assert.That(Predicates.CrossSign(1L << 62, 3, 0, 0), Is.EqualTo(1));
            Assert.That(Predicates.CrossSign(0, 0, 1L << 62, 4), Is.EqualTo(-1));
            Assert.That(Predicates.CrossSign(-(1L << 62), 3, 0, 0), Is.EqualTo(-1));
            Assert.That(Predicates.Isqrt(System.Numerics.BigInteger.Pow(10, 30) + 5), Is.EqualTo(1_000_000_000_000_000L));
        }

        // The check of PRD v4 9.6 and the brief: one stand moved 1 mm into a path is reported. The
        // stand is moved towards its path vertex along one axis, to a position where its footprint or
        // its apron meets a path strip (found by halving); one millimetre short of it, neither does.
        [Test]
        public void AStandMovedOneMillimetreIntoAPathIsReported()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("rabiah");
            List<Checker.CheckedCard> cards = LayoutFixtures.Cards(fixture);
            object world = fixture.World;
            var records = new StandRecords(fixture.Stands);
            const int stand = 0;
            int x = records.Get32(stand, StandRecords.XAt), z = records.Get32(stand, StandRecords.ZAt);
            WorldDocument read = WorldDocument.Read(world);
            P2 vertex = read.Sites[records.Get16(stand, StandRecords.SiteAt)].Path[read.StandVertex[stand]];
            // Along the axis on which the vertex lies further.
            bool alongX = System.Math.Abs(vertex.X - x) >= System.Math.Abs(vertex.Z - z);
            int at = alongX ? StandRecords.XAt : StandRecords.ZAt, from = alongX ? x : z;
            int step = (alongX ? vertex.X >= x : vertex.Z >= z) ? 1 : -1;

            bool OnAPath(int moved)
            {
                records.Set32(stand, at, from + step * moved);
                Checker.Result result = Checker.Check(records.Bytes(), world, null, cards, LayoutFixtures.Trig);
                return Rules(result).Any(rule => rule == "footprint-path" || rule == "apron-path");
            }

            int clear = 0, met = 64;
            Assert.That(OnAPath(clear), Is.False);
            while (!OnAPath(met))
            {
                clear = met;
                met *= 2;
                Assert.That(met, Is.LessThan(100_000), "no path met within 100 m");
            }
            while (met - clear > 1)
            {
                int middle = (clear + met) / 2;
                if (OnAPath(middle))
                {
                    met = middle;
                }
                else
                {
                    clear = middle;
                }
            }
            Assert.That(OnAPath(clear), Is.False);
            Assert.That(OnAPath(met), Is.True);
            records.Set32(stand, at, from + step * met);
            Checker.Result into = Checker.Check(records.Bytes(), world, null, cards, LayoutFixtures.Trig);
            string line = into.Violations.First(found => found.StartsWith("footprint-path") || found.StartsWith("apron-path"));
            StringAssert.Contains("of stand 0 ", line);
            StringAssert.Contains("intersects the path of site", line);
        }

        // Invariant 9 (erratum 5): a cluster holds at most eight stands.
        [Test]
        public void AClusterOfNineStandsIsReported()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("rabiah");
            List<Checker.CheckedCard> cards = LayoutFixtures.Cards(fixture);
            object world = fixture.World;
            var records = new StandRecords(fixture.Stands);
            List<object> clusters = Json.Array(Json.Object(Json.Array(Json.Object(world)["sites"])[0])["clusters"]);
            int target = Enumerable.Range(0, clusters.Count).OrderByDescending(number => Json.Int(Json.Object(clusters[number])["stands"])).First();
            var others = Enumerable.Range(0, records.Rows.Count).Where(row => records.Get16(row, StandRecords.ClusterAt) != target).Select(row => records.Rows[row]).ToList();

            int Members() => Enumerable.Range(0, records.Rows.Count).Count(row => records.Get16(row, StandRecords.ClusterAt) == target);

            void Move()
            {
                byte[] row = others[others.Count - 1];
                others.RemoveAt(others.Count - 1);
                row[StandRecords.ClusterAt] = (byte)target;
                row[StandRecords.ClusterAt + 1] = (byte)(target >> 8);
            }

            while (Members() < 8)
            {
                Move();
            }
            records.InOrder(world);
            Assert.That(Rules(Checker.Check(records.Bytes(), world, null, cards, LayoutFixtures.Trig)), Does.Not.Contain("cluster-cap"));
            Move();
            records.InOrder(world);
            Assert.That(Members(), Is.EqualTo(9));
            List<string> found = Under(Checker.Check(records.Bytes(), world, null, cards, LayoutFixtures.Trig), "cluster-cap");
            Assert.That(found.Count, Is.EqualTo(1));
            StringAssert.Contains($"cluster {target} of site set:", found[0]);
            StringAssert.Contains("holds 9 stands", found[0]);
        }

        // Invariant 9 (erratum 5): a stand's yaw and the direction to its path vertex, both as counts
        // of the trig table (5.4.18 (7)), differ by at most 100, the short way round.
        [Test]
        public void AStandFacesItsPathVertexWithinATenthOfADegree()
        {
            Trig table = LayoutFixtures.Trig;
            P2 Along(int count) => new P2(table.Cos(count), table.Sin(count));
            foreach (int turn in new[] { -100, 100 })
            {
                Assert.That(Checker.Faces(7_000_000, new P2(0, 0), Along(7_000 + turn), table), Is.True);
            }
            foreach (int turn in new[] { -101, 101, 180_000 })
            {
                Assert.That(Checker.Faces(7_000_000, new P2(0, 0), Along((7_000 + turn) % 360_000), table), Is.False);
            }
            // The short way round: a yaw of 50 counts faces 359,960 and 359,950, not 359,949.
            Assert.That(Checker.Faces(50_000, new P2(0, 0), Along(359_960), table), Is.True);
            Assert.That(Checker.Faces(50_000, new P2(0, 0), Along(359_950), table), Is.True);
            Assert.That(Checker.Faces(50_000, new P2(0, 0), Along(359_949), table), Is.False);
            // A table direction is its own count, the axes are exact, and a vector half way between
            // two counts takes the lower.
            foreach (int count in new[] { 0, 1, 44_999, 90_000, 179_999, 270_000, 359_999 })
            {
                Assert.That(Checker.CountOf(table.Cos(count), table.Sin(count), table), Is.EqualTo(count));
            }
            Assert.That(new[] { Checker.CountOf(3, 0, table), Checker.CountOf(0, 3, table), Checker.CountOf(-3, 0, table), Checker.CountOf(0, -3, table) },
                Is.EqualTo(new[] { 0, 90_000, 180_000, 270_000 }));
            Assert.That(Checker.CountOf(table.Cos(10) + table.Cos(11), table.Sin(10) + table.Sin(11), table), Is.EqualTo(10));
            Assert.That(Checker.Faces(7_000_000, new P2(5, 5), new P2(5, 5), table), Is.False);

            // Stand 0 of Rabiah, turned a count at a time until it no longer faces its vertex.
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("rabiah");
            List<Checker.CheckedCard> cards = LayoutFixtures.Cards(fixture);
            object world = fixture.World;
            var records = new StandRecords(fixture.Stands);
            Assert.That(Checker.Check(records.Bytes(), world, null, cards, table).Assertions["stand-yaw"], Is.EqualTo(records.Rows.Count));
            int turned = 0;
            while (Under(Checker.Check(records.Bytes(), world, null, cards, table), "stand-yaw").Count == 0)
            {
                records.Set32(0, StandRecords.YawAt, (records.Get32(0, StandRecords.YawAt) + 1_000) % 360_000_000);
                turned++;
            }
            Assert.That(turned, Is.InRange(1, 101));
            string line = Under(Checker.Check(records.Bytes(), world, null, cards, table), "stand-yaw").Single();
            StringAssert.StartsWith("stand-yaw: stand 0 ", line);
            StringAssert.Contains("does not face its path vertex", line);
        }

        // Invariant 10 (erratum 5): the trail visits the sites in site order. Dominaria's first two
        // spurs swapped break that rule and no other.
        [Test]
        public void ATrailThatVisitsASiteOutOfOrderIsReported()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("dominaria");
            object world = fixture.World;
            List<object> legs = Json.Array(Json.Object(Json.Object(world)["trail"])["legs"]);
            List<int> spurs = Enumerable.Range(0, legs.Count).Where(number => Json.Text(Json.Object(legs[number])["kind"]) == "spur").ToList();
            Assert.That(spurs.Count, Is.EqualTo(11));
            (legs[spurs[0]], legs[spurs[1]]) = (legs[spurs[1]], legs[spurs[0]]);
            Checker.Result result = Checker.Check(fixture.Stands, world, fixture.Lore, LayoutFixtures.Cards(fixture), LayoutFixtures.Trig);
            Assert.That(Rules(result), Is.EquivalentTo(new[] { "trail-order" }));
            List<string> found = Under(result, "trail-order");
            Assert.That(found.Count, Is.EqualTo(2));
            StringAssert.Contains("spur 1 visits region:benalia", found[0]);
        }

        // Invariant 11 (erratum 5): a chapter's stone lies in the disc of the cluster that holds
        // the chapter's first stand or of the cluster before it. Moved to a free lattice point of a
        // later cluster's disc, it breaks that rule and no other.
        [Test]
        public void AChapterStoneFarFromItsChaptersFirstClusterIsReported() => StoneMoved(2, reported: true);

        // The rule's upper edge: the disc of the cluster after the chapter's first is not one of
        // its two discs (DEC-1130 B1, mutant C4).
        [Test]
        public void AChapterStoneInTheDiscOfTheClusterAfterItsFirstIsReported() => StoneMoved(1, reported: true);

        // The rule's lower edge: nor is the disc of the cluster two before the chapter's first.
        [Test]
        public void AChapterStoneTwoClustersBeforeItsFirstIsReported() => StoneMoved(-2, reported: true);

        // The accepted side: a free point in the disc of the cluster before the chapter's first,
        // clear of the first cluster's disc, passes.
        [Test]
        public void AChapterStoneInTheDiscOfTheClusterBeforeItsFirstPasses() => StoneMoved(-1, reported: false);

        // Moves a Dominaria chapter's stone, in site and chapter order, to the lattice points of
        // the disc of the cluster `offset` clusters from the chapter's first, one at a time. A point
        // that a disc of the rule might hold is passed over: the first cluster's disc, and on the
        // reported side the disc of the cluster before it. Every point tried is reported under
        // `chapter-cluster`, or none is. A point where a stand or a path stands is not free; the
        // search ends at the first free one, which breaks that rule and no other, or no rule at all.
        static void StoneMoved(int offset, bool reported)
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("dominaria");
            byte[] stands = fixture.Stands;
            object world = fixture.World, lore = fixture.Lore;
            List<Checker.CheckedCard> cards = LayoutFixtures.Cards(fixture);
            Assert.That(Checker.Check(stands, world, lore, cards, LayoutFixtures.Trig).Assertions["chapter-cluster"], Is.GreaterThan(0));
            foreach (Dictionary<string, object> site in Json.Array(Json.Object(world)["sites"]).Select(Json.Object))
            {
                List<object> clusters = Json.Array(site["clusters"]);
                P2 Centre(int number) => WorldDocument.Point(Json.Object(clusters[number])["centre"]);
                foreach (Dictionary<string, object> chapter in Json.Array(site["chapters"]).Skip(1).Select(Json.Object).Where(item => item["stone"] != null))
                {
                    int first = Json.Int(chapter["firstCluster"]), number = first + offset;
                    if (number < 0 || number >= clusters.Count)
                    {
                        continue;
                    }
                    int[] passedOver = reported ? new[] { first - 1, first } : new[] { first };
                    bool Near(P2 point) => passedOver.Where(other => other >= 0)
                        .Any(other => (point - Centre(other)).LengthSquared <= (LayoutConstants.ClusterRadius + 10) * (LayoutConstants.ClusterRadius + 10));
                    object stone = chapter["stone"];
                    foreach (P2 point in LatticePoints(Centre(number), LayoutConstants.ClusterRadius - LayoutConstants.JitterRadius).Where(point => !Near(point)))
                    {
                        chapter["stone"] = new Dictionary<string, object> { ["x"] = (double)point.X, ["z"] = (double)point.Z, ["yaw"] = 0d };
                        Checker.Result result = Checker.Check(stands, world, lore, cards, LayoutFixtures.Trig);
                        HashSet<string> broken = Rules(result);
                        string where = $"the stone of set id {Json.Int(chapter["setId"])} in {Json.Text(site["key"])} at {point}, in the disc of cluster {number}; the chapter's first stand is in cluster {first}";
                        Assert.That(broken.Contains("chapter-cluster"), Is.EqualTo(reported), where);
                        if (reported ? broken.SetEquals(new[] { "chapter-cluster" }) : broken.Count == 0)
                        {
                            if (reported)
                            {
                                StringAssert.Contains($"the disc of cluster {first},", Under(result, "chapter-cluster").Single());
                            }
                            TestContext.Out.WriteLine(where);
                            return;
                        }
                    }
                    chapter["stone"] = stone;
                }
            }
            Assert.Fail($"no free lattice point of a cluster {offset} from a chapter's first was found");
        }

        // The points of the hexagonal lattice of 5.4.18 (8) within `radius` of `centre`.
        static IEnumerable<P2> LatticePoints(P2 centre, long radius)
        {
            long rows = radius / LayoutConstants.LatticeRow + 1;
            long k0 = centre.Z / LayoutConstants.LatticeRow;
            for (long k = k0 - rows; k <= k0 + rows; k++)
            {
                long z = LayoutConstants.LatticeRow * k;
                long i0 = (centre.X - LayoutConstants.LatticeHalfPitch * k) / LayoutConstants.LatticePitch;
                for (long i = i0 - radius / LayoutConstants.LatticePitch - 2; i <= i0 + radius / LayoutConstants.LatticePitch + 2; i++)
                {
                    var point = new P2(LayoutConstants.LatticePitch * i + LayoutConstants.LatticeHalfPitch * k, z);
                    if ((point - centre).LengthSquared <= radius * radius)
                    {
                        yield return point;
                    }
                }
            }
        }

        // 5.4.10 (erratum 5): the path of a site with no stand has two vertices. Shandalar with its
        // one stand taken away is such a site, its path cut to its first segment; a third vertex
        // on that segment breaks the rule and no other.
        [Test]
        public void ThePathOfASiteWithNoStandHasTwoVertices()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("shandalar");
            object world = fixture.World;
            var records = new StandRecords(fixture.Stands);
            records.Rows.Clear();
            Dictionary<string, object> stands = Json.Object(Json.Object(world)["stands"]);
            stands["vertex"] = new List<object>();
            stands["arc"] = new List<object>();
            Json.Object(world)["standCount"] = 0d;
            Dictionary<string, object> site = Json.Object(Json.Array(Json.Object(world)["sites"])[0]);
            site["clusters"] = new List<object>();
            List<object> path = Json.Array(site["path"]);
            site["path"] = path.Take(2).ToList();
            var none = new List<Checker.CheckedCard>();
            Checker.Result result = Checker.Check(records.Bytes(), world, null, none, LayoutFixtures.Trig);
            Assert.That(result.Violations, Is.Empty);
            Assert.That(result.Assertions["path-empty"], Is.EqualTo(1));
            P2 a = WorldDocument.Point(path[0]), b = WorldDocument.Point(path[1]);
            site["path"] = new List<object> { path[0], new List<object> { (double)((a.X + b.X) / 2), (double)((a.Z + b.Z) / 2) }, path[1] };
            result = Checker.Check(records.Bytes(), world, null, none, LayoutFixtures.Trig);
            Assert.That(Rules(result), Is.EquivalentTo(new[] { "path-empty" }));
            StringAssert.Contains("has no stand and its path has 3 vertices", Under(result, "path-empty").Single());
        }

        // Invariant 7: a record of another plane is reported (`card-plane`).
        [Test]
        public void ARecordOfAnotherPlaneIsReported()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("rabiah");
            var records = new StandRecords(fixture.Stands);
            records.Rows[0][StandRecords.PlaneAt]++;
            Checker.Result result = Checker.Check(records.Bytes(), fixture.World, null, LayoutFixtures.Cards(fixture), LayoutFixtures.Trig);
            Assert.That(Rules(result), Is.EquivalentTo(new[] { "card-plane" }));
        }

        // 5.4.8: the site stone stands 2,500 mm from the pad's centre towards the approach point and
        // 3,000 mm to one side (`stone-place`). Moved 5 m north it is reported; mirrored across the
        // approach it is in its place.
        [Test]
        public void ASiteStoneOffItsPlaceIsReportedAndOneMirroredIsNot()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("shandalar");
            List<Checker.CheckedCard> cards = LayoutFixtures.Cards(fixture);
            object world = fixture.World;
            Dictionary<string, object> site = Json.Object(Json.Array(Json.Object(world)["sites"])[0]);
            Dictionary<string, object> stone = Json.Object(site["stone"]);
            Assert.That(new[] { Json.Long(stone["x"]), Json.Long(stone["z"]) }, Is.EqualTo(new[] { -24_274L, -44_981L }));
            stone["z"] = -39_981d;
            Assert.That(Rules(Checker.Check(fixture.Stands, world, null, cards, LayoutFixtures.Trig)), Does.Contain("stone-place"));
            // Mirrored across the line from the pad's centre to the approach point.
            P2 pad = new P2(Json.Long(Json.Object(site["pad"])["x"]), Json.Long(Json.Object(site["pad"])["z"]));
            P2 approach = WorldDocument.Point(site["approachPoint"]);
            P2 at = new P2(-24_274, -44_981);
            double dx = approach.X - pad.X, dz = approach.Z - pad.Z, wx = at.X - pad.X, wz = at.Z - pad.Z;
            double along = (wx * dx + wz * dz) / (dx * dx + dz * dz);
            stone["x"] = System.Math.Round(2 * (pad.X + along * dx) - at.X);
            stone["z"] = System.Math.Round(2 * (pad.Z + along * dz) - at.Z);
            Assert.That(Rules(Checker.Check(fixture.Stands, world, null, cards, LayoutFixtures.Trig)), Does.Not.Contain("stone-place"));
        }

        // 4.13.3: a file that is not a stands file is one violation, and nothing else is tested.
        [Test]
        public void AStandsFileOfAnotherVersionIsReported()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("vryn");
            byte[] stands = fixture.Stands;
            stands[5] = 3;
            Checker.Result result = Checker.Check(stands, fixture.World, null, LayoutFixtures.Cards(fixture), LayoutFixtures.Trig);
            Assert.That(Rules(result), Is.EquivalentTo(new[] { "header" }));
            Checker.Result cut = Checker.Check(fixture.Stands.Take(40).ToArray(), fixture.World, null, LayoutFixtures.Cards(fixture), LayoutFixtures.Trig);
            Assert.That(Rules(cut), Is.EquivalentTo(new[] { "record-count" }));
        }
    }
}
