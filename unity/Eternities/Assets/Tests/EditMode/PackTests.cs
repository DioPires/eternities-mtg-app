using System.Collections.Generic;
using System.IO;
using Eternities.Data;
using Eternities.Layout;
using NUnit.Framework;

namespace Eternities.Tests
{
    public class PackTests
    {
        [Test]
        public void TheJsonReaderReadsWhatThePackUses()
        {
            var value = Json.Object(Json.Parse(" {\"a\": [1, -2.5e1, \"x\\n\\u00e9\\\"\", true, false, null, {}, []], \"b\": {\"c\": \"\"}} "));
            List<object> a = Json.Array(value["a"]);
            Assert.That(Json.Int(a[0]), Is.EqualTo(1));
            Assert.That(a[1], Is.EqualTo(-25.0));
            Assert.That(a[2], Is.EqualTo("x\né\""));
            Assert.That(a[3], Is.EqualTo(true));
            Assert.That(a[4], Is.EqualTo(false));
            Assert.That(a[5], Is.Null);
            Assert.That(Json.Object(a[6]), Is.Empty);
            Assert.That(Json.Array(a[7]), Is.Empty);
            Assert.That(Json.Text(Json.Object(value["b"])["c"]), Is.EqualTo(""));
            // Written and read again, it is the same text.
            string written = Json.Write(value);
            Assert.That(Json.Write(Json.Parse(written)), Is.EqualTo(written));
            StringAssert.Contains("\"x\\n\u00e9\\\"\"", written);
            Assert.That(Json.Write(new Dictionary<string, object> { ["p90Ms"] = 16.5f, ["count"] = 3, ["bytes"] = 6_000_000_000L }),
                Is.EqualTo("{\n  \"p90Ms\": 16.5,\n  \"count\": 3,\n  \"bytes\": 6000000000\n}\n"));
            Assert.Throws<System.FormatException>(() => Json.Parse("{\"a\": 1,}"));
            Assert.Throws<System.FormatException>(() => Json.Parse("[1] 2"));
        }

        // PRD v4 9.5: the slice reads Dominaria through the v3 pack's files.
        [Test]
        public void DominariaReadsFromThePinnedPack()
        {
            var pack = new Pack(TestPack.Directory);
            Assert.That(pack.Hash, Is.EqualTo(TestPack.Hash));
            Assert.That(pack.Planes.Length, Is.EqualTo(88));
            PackPlane plane = pack.Plane("dominaria");
            Assert.That(plane.Sets.Length, Is.EqualTo(37));
            Assert.That(plane.Sets[0].Code, Is.EqualTo("lea"));
            PackCard[] cards = pack.Cards(plane);
            Assert.That(cards.Length, Is.EqualTo(6271));

            // The counts of PRD v4 5.4.14: 753 gold cards and 564 colourless.
            LayoutInput input = LayoutInputs.From(plane, cards);
            var byClass = new int[7];
            foreach (LayoutCard card in input.Cards)
            {
                byClass[(int)card.Class]++;
            }
            Assert.That(byClass, Is.EqualTo(new[] { 990, 992, 1000, 996, 976, 753, 564 }));

            // The bench travels to this card (the slice issue's bench design): one printing, a
            // transform layout, so a back image of its own.
            PackCard invasion = System.Array.Find(cards, card => card.Name == "Invasion of Dominaria");
            Assert.That(invasion.HasBackImage);
            Assert.That(invasion.Back.Name, Is.EqualTo("Serra Faithkeeper"));
            Assert.That(invasion.Printings.Length, Is.EqualTo(1));
            Assert.That(invasion.Printings[0].Artist, Is.Not.Empty);
            PackCard split = System.Array.Find(cards, card => card.Layout == "split");
            Assert.That(split.Back, Is.Not.Null);
            Assert.That(split.HasBackImage, Is.False);
        }

        [Test]
        public void AFileThatDoesNotMatchTheManifestIsRefused()
        {
            string copy = Path.Combine(Path.GetTempPath(), "eternities-pack-test-" + System.Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(copy);
            try
            {
                File.Copy(Path.Combine(TestPack.Directory, "manifest.json"), Path.Combine(copy, "manifest.json"));
                byte[] planes = File.ReadAllBytes(Path.Combine(TestPack.Directory, "planes.json"));
                planes[planes.Length / 2] ^= 1;
                File.WriteAllBytes(Path.Combine(copy, "planes.json"), planes);
                Assert.Throws<InvalidDataException>(() => new Pack(copy));
            }
            finally
            {
                Directory.Delete(copy, recursive: true);
            }
        }
    }
}
