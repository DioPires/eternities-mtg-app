using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Layout;
using NUnit.Framework;

namespace Eternities.Tests
{
    // The keyword rule of PRD v4 5.4.3 as the decoder recomputes it (4.13.3).
    public class KeywordTests
    {
        static readonly Keywords.Row[] Benalia = { new Keywords.Row("Benalia", "benalia") };

        static bool Holds(string name) => Keywords.Selected(new[] { name }, Benalia) != null;

        // A word boundary is the string's start or end, or a code point of category Z* or P*; a
        // letter, a combining mark and a symbol are not (CEO ruling 1 on DEC-1004, B3). The
        // category is read per code point: a punctuation mark outside the Basic Multilingual Plane
        // is a boundary, and a symbol there is not (DEC-1091 N5).
        [Test]
        public void AKeywordMatchesAWholeWordWhateverTheCase()
        {
            Assert.That(Holds("Benalia Knight"), Is.True);
            Assert.That(Holds("BENALIA knight"), Is.True);
            Assert.That(Holds("Knight of benalia"), Is.True);
            Assert.That(Holds("Benalia's Knight"), Is.True);
            Assert.That(Holds("Benalia—Knight"), Is.True, "an em dash");
            Assert.That(Holds("Benalia Knight"), Is.True, "a no-break space");
            Assert.That(Holds("Benalia\U00010100Knight"), Is.True, "U+10100 Aegean word separator line, punctuation outside the BMP");
            Assert.That(Holds("Knight\U00010100Benalia"), Is.True, "the same before the word");
            Assert.That(Holds("Benalia\U0001F300Knight"), Is.False, "U+1F300, a symbol outside the BMP");
            Assert.That(Holds("Benalián Knight"), Is.False, "a combining acute");
            Assert.That(Holds("Benalia+n Knight"), Is.False, "a symbol");
            Assert.That(Holds("Benalian Knight"), Is.False);
            Assert.That(Holds("Benali"), Is.False);
            // The first keyword in table order wins, over any face's name.
            Keywords.Row[] two = { new Keywords.Row("Shivan", "shiv"), new Keywords.Row("Benalish", "benalia") };
            Assert.That(Keywords.Selected(new[] { "Benalish Hero", "Shivan Dragon" }, two)?.Region, Is.EqualTo("shiv"));
            Assert.That(Keywords.Selected(new[] { "Mox Pearl" }, two), Is.Null);
        }

        // 5.4.3 (erratum 5): where the runtime lacks the pipeline's Unicode tables (full case
        // folding, the categories of Unicode 15.1), a test compares the decoder's selected keyword
        // with the pack's for every stand of every hero world the player ships. The pack's choice
        // is the pipeline's report of Dominaria: every card with a selected keyword, by name.
        [Test]
        public void TheDecoderSelectsThePipelinesKeywordForEveryDominariaStand()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("dominaria");
            var pack = new Pack(fixture.Pack);
            PackPlane plane = pack.Plane("dominaria");
            PackCard[] cards = pack.Cards(plane);
            LoreDocument lore = LoreDocument.Read(fixture.Lore);
            WorldDocument layout = WorldDocument.Read(fixture.World);
            // The report's table: | Card | Keyword | Region | Era | Stands at |.
            string[] lines = fixture.Report.Split('\n');
            int start = System.Array.FindIndex(lines, line => line.StartsWith("| Card | Keyword | Region | Era | Stands at |"));
            Assert.That(start, Is.GreaterThan(0));
            var expected = new List<(string Card, string Keyword, string Site)>();
            for (int i = start + 2; i < lines.Length && lines[i].StartsWith("| "); i++)
            {
                string[] cells = lines[i].Split('|').Select(cell => cell.Trim()).ToArray();
                expected.Add((cells[1], cells[2], cells[5].Trim('`')));
            }
            Assert.That(expected.Count, Is.EqualTo(304));

            using (WorldData world = WorldData.Decode(pack.Planes, plane, cards, fixture.Stands, layout, lore))
            {
                var found = new List<(string Card, string Keyword, string Site)>();
                for (int stand = 0; stand < world.StandCount; stand++)
                {
                    PackCard card = world.CardAt(stand);
                    string[] names = card.Back == null ? new[] { card.Name } : new[] { card.Name, card.Back.Name };
                    Keywords.Row? keyword = Keywords.Selected(names, lore.Keywords);
                    if (keyword != null)
                    {
                        found.Add((card.Name, keyword.Value.Word, layout.Sites[world.Site(stand)].Key));
                    }
                }
                Assert.That(found, Is.EquivalentTo(expected));
                Assert.That(found.Count(row => row.Site.StartsWith("region:")), Is.EqualTo(165));
            }
        }
    }
}
