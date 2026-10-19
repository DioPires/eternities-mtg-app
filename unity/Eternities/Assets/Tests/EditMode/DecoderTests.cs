using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Layout;
using NUnit.Framework;

namespace Eternities.Tests
{
    // The C# decoder of contract v4 (PRD v4 4.13.3, 8.8.2). In the player the assertions at launch
    // (the plane index is in range; the class agrees with the mask) run in `App.Start`, through
    // `WorldData.AssertAtLaunch`. Those at world entry (the record is this world's plane; the site,
    // the set, the cluster and the corridor's vertex) and at the shard load, which is world entry
    // with the v3 shards (the join; the keyword), run in `App.Load`. `WorldData.Decode` runs all of
    // them in one call: every fixture of 5.4.14 decodes with them, and a file changed to break one
    // of them is refused with the stand named.
    public class DecoderTests
    {
        static IEnumerable<string> LayoutNames() => LayoutFixtures.LayoutNames();

        sealed class Inputs
        {
            public PackPlane[] Planes;
            public PackPlane Plane;
            public PackCard[] Cards;
            public byte[] Stands;
            public object World, Lore;

            public WorldData Decode() => WorldData.Decode(Planes, Plane, Cards, Stands, WorldDocument.Read(World), Lore == null ? null : LoreDocument.Read(Lore));
        }

        static Inputs Read(LayoutFixtures.Fixture fixture)
        {
            Pack pack = File.Exists(Path.Combine(fixture.Pack, "manifest.json")) ? new Pack(fixture.Pack) : Pack.OfFixture(fixture.Pack);
            PackPlane plane = pack.Plane(fixture.Slug);
            return new Inputs { Planes = pack.Planes, Plane = plane, Cards = pack.Cards(plane), Stands = fixture.Stands, World = fixture.World, Lore = fixture.Lore };
        }

        static void Refused(Inputs inputs, string words)
        {
            var refused = Assert.Throws<InvalidDataException>(() => inputs.Decode().Dispose());
            StringAssert.Contains(words, refused.Message);
        }

        [TestCaseSource(nameof(LayoutNames))]
        public void EveryFixtureDecodesWithTheAssertionsOf4133(string name)
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named(name);
            Inputs inputs = Read(fixture);
            using (WorldData world = inputs.Decode())
            {
                Assert.That(world.StandCount, Is.EqualTo(world.Layout.StandCount));
                Assert.That(world.StandCount, Is.EqualTo(inputs.Cards.Length), "a stand a card");
                Assert.That(world.CardOf.Distinct().Count(), Is.EqualTo(world.StandCount));
                for (int stand = 0; stand < world.StandCount; stand++)
                {
                    Assert.That(world.CardAt(stand).OracleId, Is.EqualTo(world.Stands.OracleId(stand)).IgnoreCase);
                    Assert.That(world.Stands.Plane[stand], Is.EqualTo(world.Layout.PlaneIndex));
                }
                Assert.That(world.Lore != null, Is.EqualTo(world.Layout.Hero));
            }
        }

        // A record whose shard index and index within the shard name another card is a malformed
        // join (4.13.3), refused at the shard load.
        [Test]
        public void AMalformedJoinIsRefused()
        {
            Inputs inputs = Read(LayoutFixtures.Named("rabiah"));
            var records = new StandRecords(inputs.Stands);
            records.Set16(0, StandRecords.ShardIndexAt, records.Get16(0, StandRecords.ShardIndexAt) == 0 ? 1 : 0);
            inputs.Stands = records.Bytes();
            Refused(inputs, "a malformed join");
            records.Set16(0, StandRecords.ShardAt, 7);
            inputs.Stands = records.Bytes();
            Refused(inputs, "which holds no card");
        }

        // DEC-1091 N6: `card-plane` compares each record with the world document's plane index, so a
        // world file and records that carry the same wrong index pass the checker. The decoder
        // reads planes.json and refuses them.
        [Test]
        public void AWrongPlaneIndexIsRefusedThoughTheCheckerPassesIt()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("rabiah");
            Inputs inputs = Read(fixture);
            var records = new StandRecords(inputs.Stands);
            int wrong = records.Rows[0][StandRecords.PlaneAt] + 1;
            foreach (byte[] row in records.Rows)
            {
                row[StandRecords.PlaneAt] = (byte)wrong;
            }
            inputs.Stands = records.Bytes();
            Json.Object(inputs.World)["planeIndex"] = (long)wrong;
            Checker.Result checker = Checker.Check(inputs.Stands, inputs.World, null, LayoutFixtures.Cards(fixture), LayoutFixtures.Trig);
            Assert.That(checker.Violations, Is.Empty, "the checker sees one index on both sides");
            Refused(inputs, $"names plane index {wrong}; rabiah is plane {wrong - 1} of planes.json");
        }

        // Each other assertion of 4.13.3 refuses its own case.
        [Test]
        public void EachAssertionOf4133RefusesItsCase()
        {
            Inputs Fresh() => Read(LayoutFixtures.Named("rabiah"));

            Inputs Changed(System.Action<StandRecords> change)
            {
                Inputs inputs = Fresh();
                var records = new StandRecords(inputs.Stands);
                change(records);
                inputs.Stands = records.Bytes();
                return inputs;
            }

            Refused(Changed(records => records.Rows[0][StandRecords.MaskAt] = 32), "for the colour identity mask 32");
            Refused(Changed(records => records.Rows[0][StandRecords.PlaneAt] = 200), "records plane index 200");
            Refused(Changed(records => records.Set16(0, StandRecords.SiteAt, 5)), "records site index 5; the world has 1 sites");
            Refused(Changed(records => records.Set16(0, StandRecords.SetAt, 999)), "records set id 999, which site set:");
            Refused(Changed(records => records.Set16(0, StandRecords.ClusterAt, 500)), "records cluster index 500");
            Inputs vertex = Fresh();
            Json.Array(Json.Object(Json.Object(vertex.World)["stands"])["vertex"])[0] = 1_000_000L;
            Refused(vertex, "ends on vertex 1000000");
            Inputs counted = Fresh();
            Json.Object(counted.World)["standCount"] = 74L;
            Refused(counted, "stands.bin holds 75 records");
            Inputs header = Fresh();
            header.Stands[5] = 3;
            Assert.Throws<InvalidDataException>(() => header.Decode().Dispose());
        }

        // The two assertions at launch, as `App.Start` runs them on `stands.bin` before it builds the
        // hub (PRD v4 4.13.3, 8.3.2, 7.4.1): a record whose plane index is outside the count of
        // planes.json, or whose class disagrees with its colour identity mask, is refused with the
        // stand named. Each is read on both sides of its edge, on Rabiah's last record.
        [Test]
        public void TheAssertionsAtLaunchRefuseAPlaneOutOfRangeAndAClassThatIsNotItsMasks()
        {
            Inputs inputs = Read(LayoutFixtures.Named("rabiah"));
            int planes = inputs.Planes.Length, last = new StandRecords(inputs.Stands).Rows.Count - 1;
            string named;
            using (StandsFile stands = StandsFile.Read(inputs.Stands))
            {
                named = $"stand {last} ({stands.OracleId(last)}) records";
            }

            void AtLaunch(System.Action<byte[]> change, string refused)
            {
                var records = new StandRecords(inputs.Stands);
                change(records.Rows[last]);
                using (StandsFile stands = StandsFile.Read(records.Bytes()))
                {
                    if (refused == null)
                    {
                        Assert.DoesNotThrow(() => WorldData.AssertAtLaunch(stands, planes));
                        return;
                    }
                    var thrown = Assert.Throws<InvalidDataException>(() => WorldData.AssertAtLaunch(stands, planes));
                    StringAssert.StartsWith(named, thrown.Message);
                    StringAssert.Contains(refused, thrown.Message);
                }
            }

            AtLaunch(row => { }, null);
            // The plane index: the last plane of planes.json passes at launch, and the count does not.
            AtLaunch(row => row[StandRecords.PlaneAt] = (byte)(planes - 1), null);
            AtLaunch(row => row[StandRecords.PlaneAt] = (byte)planes, $"records plane index {planes}; planes.json holds {planes} planes");
            AtLaunch(row => row[StandRecords.PlaneAt] = 255, $"records plane index 255; planes.json holds {planes} planes");
            // The class: each mask of one colour, of two, and of none against its own class and the
            // next one; and a mask outside the five colours, which has no class.
            foreach (int mask in new[] { 0, 1, 2, 4, 8, 16, 3, 31 })
            {
                int own = Checker.ClassOf(mask);
                AtLaunch(row => { row[StandRecords.MaskAt] = (byte)mask; row[StandRecords.ClassAt] = (byte)own; }, null);
                int other = (own + 1) % 7;
                AtLaunch(row => { row[StandRecords.MaskAt] = (byte)mask; row[StandRecords.ClassAt] = (byte)other; }, $"records class {other} for the colour identity mask {mask}");
            }
            AtLaunch(row => row[StandRecords.MaskAt] = 32, "for the colour identity mask 32");
            // `Decode` runs the same method: a record of a plane past planes.json is refused there
            // before any assertion at world entry.
            var past = new StandRecords(inputs.Stands);
            past.Rows[last][StandRecords.PlaneAt] = (byte)planes;
            inputs.Stands = past.Bytes();
            Refused(inputs, $"{named} plane index {planes}; planes.json holds {planes} planes");
        }

        // A number with a fraction is refused, not cut (PRD v4 7.4.1; DEC-1130 N4): `Json.Int` and
        // `Json.Long` take an integer token, or a whole number within the range a double holds
        // exactly, as the checker's `Whole` does. Rabiah's world document with half a plane added
        // to its plane index read as its own plane before.
        [Test]
        public void ANumberThatIsNotWholeIsRefused()
        {
            Assert.That(Json.Int(3d), Is.EqualTo(3));
            Assert.That(Json.Int(3L), Is.EqualTo(3));
            Assert.That(Json.Long(9_007_199_254_740_993L), Is.EqualTo(9_007_199_254_740_993L));
            Assert.Throws<System.OverflowException>(() => Json.Int(2_147_483_648L));
            Assert.That(Json.Int(-7d), Is.EqualTo(-7));
            Assert.That(Json.Long(9_007_199_254_740_992d), Is.EqualTo(9_007_199_254_740_992L));
            Assert.That(Json.Long(-9_007_199_254_740_992d), Is.EqualTo(-9_007_199_254_740_992L));
            StringAssert.Contains("JSON: 1.5 is not a whole number", Assert.Throws<InvalidDataException>(() => Json.Int(1.5)).Message);
            StringAssert.Contains("JSON: -0.25 is not a whole number", Assert.Throws<InvalidDataException>(() => Json.Long(-0.25)).Message);
            StringAssert.Contains("is not a whole number", Assert.Throws<InvalidDataException>(() => Json.Long(9_007_199_254_740_994d)).Message);
            StringAssert.Contains("JSON: '7' is not a whole number", Assert.Throws<InvalidDataException>(() => Json.Int("7")).Message);
            StringAssert.Contains("JSON: null is not a whole number", Assert.Throws<InvalidDataException>(() => Json.Long(null)).Message);
            StringAssert.Contains("JSON: 9223372036854775808 is not a whole number", Assert.Throws<InvalidDataException>(() => Json.Long(Json.Parse("9223372036854775808"))).Message);
            Inputs inputs = Read(LayoutFixtures.Named("rabiah"));
            double half = Json.Long(Json.Object(inputs.World)["planeIndex"]) + 0.5;
            Json.Object(inputs.World)["planeIndex"] = half;
            Refused(inputs, $"JSON: {half.ToString("R", CultureInfo.InvariantCulture)} is not a whole number");
        }

        // On a regional site the card's selected keyword names the site's region, and the region of
        // its era differs (4.13.3, 5.4.3). Without the keyword table's rows the card has no
        // selected keyword, and its stand is refused.
        [Test]
        public void AStandAtARegionalSiteWithoutItsKeywordIsRefused()
        {
            Inputs inputs = Read(LayoutFixtures.Named("keyword-moves-one-card"));
            using (inputs.Decode())
            {
            }
            Json.Object(inputs.Lore)["keywords"] = new List<object>();
            Refused(inputs, "stands at the regional site region:");
        }
    }
}
