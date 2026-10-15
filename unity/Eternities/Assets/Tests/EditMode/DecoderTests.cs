using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Layout;
using NUnit.Framework;

namespace Eternities.Tests
{
    // The C# decoder of contract v4 (PRD v4 4.13.3, 8.8.2): every fixture of 5.4.14 decodes with the
    // assertions at launch, at world entry and at the shard load, and a file changed to break one of
    // them is refused with the stand named.
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
            Json.Object(inputs.World)["planeIndex"] = (double)wrong;
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

            Refused(Changed(records => records.Rows[0][17] = 32), "for the colour identity mask 32");
            Refused(Changed(records => records.Rows[0][StandRecords.PlaneAt] = 200), "records plane index 200");
            Refused(Changed(records => records.Set16(0, StandRecords.SiteAt, 5)), "records site index 5; the world has 1 sites");
            Refused(Changed(records => records.Set16(0, StandRecords.SetAt, 999)), "records set id 999, which site set:");
            Refused(Changed(records => records.Set16(0, StandRecords.ClusterAt, 500)), "records cluster index 500");
            Inputs vertex = Fresh();
            Json.Array(Json.Object(Json.Object(vertex.World)["stands"])["vertex"])[0] = 1_000_000d;
            Refused(vertex, "ends on vertex 1000000");
            Inputs counted = Fresh();
            Json.Object(counted.World)["standCount"] = 74d;
            Refused(counted, "stands.bin holds 75 records");
            Inputs header = Fresh();
            header.Stands[5] = 3;
            Assert.Throws<InvalidDataException>(() => header.Decode().Dispose());
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
