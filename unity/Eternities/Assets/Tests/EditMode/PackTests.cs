using System.Collections.Generic;
using System.IO;
using System.Numerics;
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

        // DEC-1186 N3: the reader keeps the grammar of RFC 8259, as Python's `json` does. A leading
        // `+`, a leading zero, a point with no digit after it or before it, a raw control character
        // in a string (U+0001 and U+001F, in the plain run and after an escape) and a `\u` escape
        // that is not four hexadecimal digits are refused, alone and inside an object.
        [Test]
        public void TheJsonReaderRefusesWhatRfc8259Refuses()
        {
            string[] escapes = { "\"\\u 041\"", "\"\\u0 41\"", "\"\\u00 1\"", "\"\\u004 \"" };
            var refused = new List<string> { "+5", "05", "-05", "00", "5.", ".5", "\"a\u0001b\"", "\"\\n\u0001\"", "\"a\u001fb\"", "\"\\n\u001f\"" };
            refused.AddRange(escapes);
            foreach (string text in refused)
            {
                Assert.Throws<System.FormatException>(() => Json.Parse(text), text);
                Assert.Throws<System.FormatException>(() => Json.Parse($"{{\"a\": [{text}]}}"), text);
            }
            // A leading zero is named where it stands, not as the text after a `0`.
            foreach (string text in new[] { "05", "-05", "00" })
            {
                StringAssert.Contains("a number has a leading zero, at character 1 ", Assert.Throws<System.FormatException>(() => Json.Parse($"[{text}]")).Message);
            }
            // A white space at any of the four places of a `\u` escape is named as such (DEC-1203 N2).
            foreach (string text in escapes)
            {
                StringAssert.Contains("a \\u escape needs four hexadecimal digits", Assert.Throws<System.FormatException>(() => Json.Parse(text)).Message, text);
            }
        }

        // DEC-1203 B1: an integer token of more than 4,300 digits, the sign not counted, is refused,
        // as Python's `json` refuses it; 4,300 digits read as a BigInteger.
        [Test]
        public void TheJsonReaderRefusesAnIntegerOfMoreThan4300Digits()
        {
            string most = new string('9', 4_300);
            foreach (string sign in new[] { "", "-" })
            {
                object read = Json.Parse(sign + most);
                Assert.That(read, Is.TypeOf<BigInteger>());
                Assert.That(((BigInteger)read).ToString(System.Globalization.CultureInfo.InvariantCulture), Is.EqualTo(sign + most));
                StringAssert.Contains("an integer has more than 4300 digits", Assert.Throws<System.FormatException>(() => Json.Parse(sign + most + "9")).Message, sign);
            }
        }

        // What RFC 8259 allows reads the same value as before: an integer token as a long, any other
        // number as a double, and a string as its text. An integer token that a long cannot hold is
        // a BigInteger, as Python's `json` reads it as an int (DEC-1203 B1). A number beyond a
        // double is infinity with its sign, as in Python and .NET Core 3.0 and later (DEC-1203 N5).
        [Test]
        public void TheJsonReaderReadsWhatRfc8259AllowsAsBefore()
        {
            Assert.That(Json.Parse("0"), Is.EqualTo(0L).And.TypeOf<long>());
            Assert.That(Json.Parse("-0"), Is.EqualTo(0L).And.TypeOf<long>());
            Assert.That(Json.Parse("5"), Is.EqualTo(5L).And.TypeOf<long>());
            Assert.That(Json.Parse("-5"), Is.EqualTo(-5L).And.TypeOf<long>());
            Assert.That(Json.Parse("5.5"), Is.EqualTo(5.5).And.TypeOf<double>());
            Assert.That(Json.Parse("5e3"), Is.EqualTo(5000.0).And.TypeOf<double>());
            Assert.That(Json.Parse("\"A\""), Is.EqualTo("A"));
            Assert.That(Json.Parse("\"\\u0041\""), Is.EqualTo("A"));
            Assert.That(Json.Parse("\"\\u00C9\""), Is.EqualTo("\u00c9"));
            Assert.That(Json.Parse("\"\\n \u007f\""), Is.EqualTo("\n \u007f"));
            Assert.That(Json.Parse("-9223372036854775808"), Is.EqualTo(long.MinValue).And.TypeOf<long>());
            Assert.That(Json.Parse("9223372036854775808"), Is.EqualTo(BigInteger.Parse("9223372036854775808")).And.TypeOf<BigInteger>());
            Assert.That(Json.Parse("1E400"), Is.EqualTo(double.PositiveInfinity));
            Assert.That(Json.Parse("-1E400"), Is.EqualTo(double.NegativeInfinity));
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

            // The colour classes of 4.13.3 (one colour, gold for two or more, colourless for none):
            // 753 gold cards and 564 colourless.
            var byClass = new int[7];
            foreach (PackCard card in cards)
            {
                int mask = 0;
                foreach (char colour in card.ColourIdentity)
                {
                    mask |= 1 << "WUBRG".IndexOf(colour);
                }
                byClass[Checker.ClassOf(mask)]++;
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
