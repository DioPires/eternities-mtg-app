using System.IO;
using Eternities.CardView;
using NUnit.Framework;

namespace Eternities.Tests
{
    // PRD v4 4.15.3: the on-disk image cache.
    public class ImageCacheTests
    {
        string directory;

        [SetUp]
        public void MakeADirectory()
        {
            directory = Path.Combine(Path.GetTempPath(), "eternities-cache-test-" + System.Guid.NewGuid().ToString("N"));
        }

        [TearDown]
        public void RemoveIt()
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, recursive: true);
            }
        }

        const string A = "https://cards.scryfall.io/normal/front/f/a/fa5466cc-aa57-4a7f-8b21-d92b2fe02e13.jpg?1783948714";
        const string B = "https://cards.scryfall.io/normal/front/f/a/fa5466cc-aa57-4a7f-8b21-d92b2fe02e13.jpg?1783948715";
        const string C = "https://cards.scryfall.io/normal/front/0/d/0d71b157-09a0-4fd4-beb9-103117a784ad.jpg?1";

        [Test]
        public void AnEntryIsKeyedOnTheFullUrlAndIsAbsentPastItsMaxAge()
        {
            var cache = new ImageCache(directory);
            Assert.That(cache.Find(A, now: 100), Is.Null);
            cache.Store(A, new byte[] { 1, 2, 3 }, maxAge: 50, now: 100);
            string file = cache.Find(A, now: 149);
            Assert.That(File.ReadAllBytes(file), Is.EqualTo(new byte[] { 1, 2, 3 }));
            Assert.That(cache.Find(B, now: 149), Is.Null, "another query string is another image");
            Assert.That(cache.Find(A, now: 150), Is.Null, "an entry as old as the origin's max-age is absent");
            Assert.That(File.Exists(file), Is.False);
            Assert.That(cache.TotalBytes, Is.EqualTo(0));
        }

        [Test]
        public void TheLeastRecentlyUsedEntryLeavesFirstAtTheCap()
        {
            var cache = new ImageCache(directory) { Cap = 250 };
            cache.Store(A, new byte[100], 1000, 0);
            cache.Store(B, new byte[100], 1000, 0);
            Assert.That(cache.Find(A, 1), Is.Not.Null);        // A is now used after B
            cache.Store(C, new byte[100], 1000, 2);
            Assert.That(cache.Find(B, 3), Is.Null, "B was the least recently used");
            Assert.That(cache.Find(A, 3), Is.Not.Null);
            Assert.That(cache.Find(C, 3), Is.Not.Null);
            Assert.That(cache.TotalBytes, Is.EqualTo(200));
        }

        [Test]
        public void TheCacheOutlivesTheSessionAndClears()
        {
            new ImageCache(directory).Store(A, new byte[] { 9 }, 1000, 0);
            var later = new ImageCache(directory);
            Assert.That(later.Count, Is.EqualTo(1));
            Assert.That(File.ReadAllBytes(later.Find(A, 10)), Is.EqualTo(new byte[] { 9 }));
            later.Clear();
            Assert.That(later.Count, Is.EqualTo(0));
            Assert.That(Directory.GetFiles(directory), Is.Empty);
        }

        [Test]
        public void MaxAgeIsReadFromCacheControl()
        {
            Assert.That(ImageCache.MaxAge("public, max-age=31536000, immutable"), Is.EqualTo(31536000));
            Assert.That(ImageCache.MaxAge("no-store"), Is.EqualTo(0));
            Assert.That(ImageCache.MaxAge(null), Is.EqualTo(0));
        }
    }
}
