using System.IO;
using Eternities.Data;
using Eternities.EditorTools;
using Eternities.Layout;
using NUnit.Framework;

namespace Eternities.Tests
{
    public class GenerateTests
    {
        // PRD v4 8.8.2: the scene generation entry point produces a world with the expected stand
        // count. What it writes is what the engine reads, so the test reads it back from disk.
        [Test]
        public void TheEntryPointWritesDominariaWithEveryStand()
        {
            Generate.World world = Generate.Build(TestPack.Hash, "dominaria");
            Assert.That(world.Check.Passed);
            StringAssert.Contains("checker: passed", world.Report);

            string text = File.ReadAllText(world.LayoutPath);
            Assert.That(LayoutFile.Digest(text), Is.EqualTo(LayoutTests.DominariaDigest));
            WorldLayout layout = LayoutFile.Read(text);
            Assert.That(layout.Stands.Count, Is.EqualTo(6271));
            Assert.That(layout.WorldRadius, Is.EqualTo(LayoutTests.DominariaRadius));

            // The copied part of the pack opens by itself and holds the same cards.
            var copy = new Pack(Generate.ProjectPack(TestPack.Hash));
            PackCard[] cards = copy.Cards(copy.Plane("dominaria"));
            Assert.That(cards.Length, Is.EqualTo(6271));
            Assert.That(cards[layout.Stands[0].Card].OracleId, Is.EqualTo(layout.Input.Cards[layout.Stands[0].Card].OracleId));
            Assert.That(copy.Swatches().Length, Is.EqualTo(Pack.SwatchHeader + 28603 * Pack.SwatchRecord));
        }
    }
}
