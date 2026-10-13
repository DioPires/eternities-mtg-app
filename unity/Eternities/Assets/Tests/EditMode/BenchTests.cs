using System.IO;
using System.Text.RegularExpressions;
using Eternities.Bench;
using Eternities.EditorTools;
using NUnit.Framework;
using UnityEngine;

namespace Eternities.Tests
{
    public class BenchTests
    {
        // The bench design on DEC-953, section 5: nearest rank, each frame counted once.
        [Test]
        public void PercentilesAreByNearestRank()
        {
            var frames = new FrameSeries(16);
            Assert.That(frames.Percentile(90), Is.EqualTo(0));
            for (int i = 10; i >= 1; i--)
            {
                frames.Add(i, atSeconds: 10 - i, segment: i == 10 ? "first" : "rest");
            }
            Assert.That(frames.Count, Is.EqualTo(10));
            Assert.That(frames.Percentile(50), Is.EqualTo(5));      // rank ceil(0.5 x 10) = 5
            Assert.That(frames.Percentile(90), Is.EqualTo(9));
            Assert.That(frames.Percentile(99), Is.EqualTo(10));     // rank ceil(9.9) = 10
            Assert.That(frames.LongestMs, Is.EqualTo(10));
            Assert.That(frames.LongestSegment, Is.EqualTo("first"));
            Assert.That(frames.Seconds, Is.EqualTo(0.055).Within(1e-9));
            frames.Add(100, 11, "late");
            Assert.That(frames.Percentile(90), Is.EqualTo(10));     // rank ceil(0.9 x 11) = 10
        }

        // A built player names its own commit (DEC-953): what the build writes, a run reads back.
        [Test]
        public void ABuildsStampIsReadBack()
        {
            const string head = "00089afbe8a16be423fa83e409024ca99eb72f96";
            Assert.That(BuildStamp.TryRead(BuildStamp.Text(head, dirty: false), out string commit, out bool dirty));
            Assert.That(commit, Is.EqualTo(head));
            Assert.That(dirty, Is.False);
            Assert.That(BuildStamp.TryRead(BuildStamp.Text(head, dirty: true), out _, out dirty));
            Assert.That(dirty, Is.True);
            Assert.That(BuildStamp.TryRead("", out _, out _), Is.False);
            Assert.That(BuildStamp.TryRead($"commit {head}\n", out _, out _), Is.False, "a stamp that does not say whether the tree was clean is no stamp");
            Assert.That(BuildStamp.TryRead("dirty false\n", out _, out _), Is.False);
        }

        // The stamp's `dirty` is the project's, `unity/Eternities/`, and not the repository's
        // (DEC-976, N5): a file at the repository's root, as the layout report the README's own
        // command writes there, is no change to the player. A change in the project still is one.
        [Test]
        public void ABuildsStampReadsTheProjectAndNotTheRepository()
        {
            string repository = Path.Combine(Path.GetTempPath(), "eternities-stamp-" + System.Guid.NewGuid().ToString("N"));
            string project = Path.Combine(repository, "unity", "Eternities");
            Directory.CreateDirectory(project);
            try
            {
                File.WriteAllText(Path.Combine(project, "committed.txt"), "as committed\n");
                Git(repository, "init --quiet");
                Git(repository, "add unity");
                Git(repository, "-c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false commit --quiet --no-verify -m scratch");
                Assert.That(Build.Dirty(project), Is.False, "nothing has changed");

                File.WriteAllText(Path.Combine(repository, "dominaria-layout.txt"), "a report\n");
                Assert.That(Build.Dirty(project), Is.False, "an untracked file at the repository's root");

                File.WriteAllText(Path.Combine(project, "untracked.txt"), "new\n");
                Assert.That(Build.Dirty(project), Is.True, "an untracked file in the project");
                File.Delete(Path.Combine(project, "untracked.txt"));
                Assert.That(Build.Dirty(project), Is.False, "the untracked file is gone");

                File.WriteAllText(Path.Combine(project, "committed.txt"), "changed\n");
                Assert.That(Build.Dirty(project), Is.True, "a changed file in the project");
            }
            finally
            {
                // Git's object files are read-only, and Windows does not delete one that is.
                foreach (string file in Directory.GetFiles(repository, "*", SearchOption.AllDirectories))
                {
                    File.SetAttributes(file, FileAttributes.Normal);
                }
                Directory.Delete(repository, recursive: true);
            }
        }

        static void Git(string repository, string arguments)
        {
            var git = new System.Diagnostics.ProcessStartInfo("git", $"-C \"{repository}\" {arguments}") { UseShellExecute = false };
            using (System.Diagnostics.Process process = System.Diagnostics.Process.Start(git))
            {
                process.WaitForExit();
                Assert.That(process.ExitCode, Is.EqualTo(0), $"git {arguments}");
            }
        }

        [Test]
        public void AFullBufferDropsFramesAndSaysSo()
        {
            var frames = new FrameSeries(2);
            frames.Add(1, 0, "a");
            frames.Add(2, 0, "a");
            frames.Add(50, 0, "a");
            Assert.That(frames.Count, Is.EqualTo(2));
            Assert.That(frames.Dropped, Is.EqualTo(1));
            Assert.That(frames.LongestMs, Is.EqualTo(2));
        }

        [Test]
        public void TheCommandLineIsRead()
        {
            BenchArgs none = BenchArgs.Parse(new[] { "Unity", "-batchmode" });
            Assert.That(none.Present, Is.False);
            BenchArgs args = BenchArgs.Parse(new[] { "Eternities", "-bench", "cold", "-benchQuality", "low", "-benchScale", "0.75", "-benchOut", "/tmp/b.json", "-benchSize", "3456x2234" });
            Assert.That(args.Mode, Is.EqualTo("cold"));
            Assert.That(args.Quality, Is.EqualTo("low"));
            Assert.That(args.Scale, Is.EqualTo(0.75f));
            Assert.That((args.Width, args.Height), Is.EqualTo((3456, 2234)));
            Assert.That(args.Captures, Is.Null);
            Assert.Throws<System.ArgumentException>(() => BenchArgs.Parse(new[] { "-bench", "tepid", "-benchOut", "x" }));
            Assert.That(BenchArgs.Parse(new[] { "-bench", "prices", "-benchOut", "x" }).Mode, Is.EqualTo("prices"));
            Assert.Throws<System.ArgumentException>(() => BenchArgs.Parse(new[] { "-bench", "warm" }));
        }

        [Test]
        public void AFootprintIsItsTotalAndItsGraphicsCategories()
        {
            const string output =
                "======================================================================\n" +
                "Eternities [761]: 64-bit    Footprint: 3.5 GB (16384 bytes per page)\n" +
                "======================================================================\n\n" +
                "  Dirty      Clean  Reclaimable    Regions    Category\n" +
                "    ---        ---          ---        ---    ---\n" +
                " 127 MB        0 B          0 B        171    MALLOC_SMALL\n" +
                "2928 KB        0 B          0 B         33    Owned physical footprint (unmapped) (graphics)\n" +
                " 1.5 GB        0 B          0 B         48    IOAccelerator (graphics)\n" +
                " 464 KB        0 B          0 B         35    IOSurface\n" +
                "  64 KB        0 B          0 B          2    IOAccelerator\n";
            (long total, long graphics) = BenchArgs.ParseFootprint(output);
            Assert.That(total, Is.EqualTo((long)(3.5 * 1024 * 1024 * 1024)));
            Assert.That(graphics, Is.EqualTo(2928L * 1024 + (long)(1.5 * 1024 * 1024 * 1024) + 464L * 1024));
        }

        // The JSON names the HDRP version; the lock is where it is pinned.
        [Test]
        public void TheHdrpVersionInTheJsonIsTheLocks()
        {
            string packages = File.ReadAllText(Path.Combine(Application.dataPath, "..", "Packages", "packages-lock.json"));
            Match hdrp = Regex.Match(packages, "\"com\\.unity\\.render-pipelines\\.high-definition\"\\s*:\\s*\\{\\s*\"version\"\\s*:\\s*\"([^\"]+)\"");
            Assert.That(hdrp.Groups[1].Value, Is.EqualTo(BenchRunner.HdrpVersion));
        }
    }
}
