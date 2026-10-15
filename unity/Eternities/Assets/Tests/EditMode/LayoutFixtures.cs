using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Layout;
#if UNITY_EDITOR
using UnityEngine;
#endif

namespace Eternities.Tests
{
    // The fixtures of PRD v4 5.4.14 as the repository holds them, `contract/test-vectors/v4/layout/`:
    // each directory's manifest names its pack and its slug, and its outputs stand beside it
    // (docs/data-contract-v4.md section 6). Tests read them in place.
    public static class LayoutFixtures
    {
        public sealed class Fixture
        {
            public string Name, Slug, Pack, Expect;
            public string Directory;

            public byte[] Stands => File.ReadAllBytes(Path.Combine(Directory, "stands.bin"));
            public string WorldPath => Path.Combine(Directory, "worlds", Slug + ".json");
            public string LorePath => Path.Combine(Directory, "lore", Slug + ".json");
            public bool Hero => File.Exists(LorePath);
            public object World => Json.Parse(File.ReadAllText(WorldPath));
            public object Lore => Hero ? Json.Parse(File.ReadAllText(LorePath)) : null;
            public Dictionary<string, object> CheckDocument => Json.Object(Json.Parse(File.ReadAllText(Path.Combine(Directory, "check.json"))));
            public string Report => File.ReadAllText(Path.Combine(Directory, "report.md"));

            public override string ToString() => Name;
        }

        public static string Repository
        {
            get
            {
#if UNITY_EDITOR
                return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
#else
                return Environment.GetEnvironmentVariable("ETERNITIES_REPOSITORY");
#endif
            }
        }

        public static string Root => Path.Combine(Repository, "contract", "test-vectors", "v4", "layout");

        static Trig trig;

        public static Trig Trig => trig ?? (trig = Trig.Load(Path.Combine(Root, "trig.bin")));

        // Every fixture, by name.
        public static List<Fixture> All()
        {
            var found = new List<Fixture>();
            foreach (string directory in System.IO.Directory.GetDirectories(Root).OrderBy(path => path, StringComparer.Ordinal))
            {
                string manifestPath = Path.Combine(directory, "fixture.json");
                if (!File.Exists(manifestPath))
                {
                    continue;
                }
                Dictionary<string, object> manifest = Json.Object(Json.Parse(File.ReadAllText(manifestPath)));
                found.Add(new Fixture
                {
                    Name = Path.GetFileName(directory),
                    Directory = directory,
                    Slug = Json.Text(manifest["slug"]),
                    Expect = Json.Text(manifest["expect"]),
                    Pack = manifest.ContainsKey("productionPack")
                        ? Path.Combine(Repository, "web", "public", "data", Json.Text(manifest["productionPack"]))
                        : Path.Combine(directory, manifest.ContainsKey("pack") ? Json.Text(manifest["pack"]) : "pack"),
                });
            }
            return found;
        }

        // The fixtures that lay a world out, by name.
        public static IEnumerable<string> LayoutNames() => All().Where(fixture => fixture.Expect == "layout").Select(fixture => fixture.Name);

        public static Fixture Named(string name) => All().Single(fixture => fixture.Name == name);

        // The plane's cards as the checker reads them, from the fixture's v3 pack: a synthetic pack
        // has no manifest, so the shards are read directly.
        public static List<Checker.CheckedCard> Cards(Fixture fixture)
        {
            Dictionary<string, object> planes = Json.Object(Json.Parse(File.ReadAllText(Path.Combine(fixture.Pack, "planes.json"))));
            Dictionary<string, object> plane = Json.Array(planes["planes"]).Select(Json.Object).Single(row => Json.Text(row["slug"]) == fixture.Slug);
            var cards = new List<Checker.CheckedCard>();
            for (int shard = 0; shard < Json.Int(plane["shardCount"]); shard++)
            {
                Dictionary<string, object> file = Json.Object(Json.Parse(File.ReadAllText(Path.Combine(fixture.Pack, "planes", $"{fixture.Slug}.{shard}.json"))));
                foreach (Dictionary<string, object> row in Json.Array(file["cards"]).Select(Json.Object))
                {
                    var names = new List<string> { Json.Text(row["n"]) };
                    if (row["b"] != null)
                    {
                        names.Add(Json.Text(Json.Object(row["b"])["n"]));
                    }
                    int set = Json.Int(Json.Array(Json.Array(row["p"])[0])[1]);
                    cards.Add(new Checker.CheckedCard(Json.Text(row["u"]), set, names.ToArray()));
                }
            }
            return cards;
        }

        public static Checker.Result Check(Fixture fixture) => Checker.Check(fixture.Stands, fixture.World, fixture.Lore, Cards(fixture), Trig);
    }

    // The records of a `stands.bin`, to change in a test and write again: a field by its offset of
    // PRD v4 4.13.3, and the order of 4.13.3 restored with the world document's per-stand arrays.
    public sealed class StandRecords
    {
        public const int Header = 16, Size = 48;
        public const int PlaneAt = 16, SiteAt = 22, SetAt = 24, XAt = 28, ZAt = 32, YawAt = 36, ShardAt = 42, ShardIndexAt = 44, ClusterAt = 46;

        readonly byte[] header;
        public readonly List<byte[]> Rows;

        public StandRecords(byte[] file)
        {
            header = file.Take(Header).ToArray();
            Rows = Enumerable.Range(0, (file.Length - Header) / Size).Select(i => file.Skip(Header + i * Size).Take(Size).ToArray()).ToList();
        }

        public int Get16(int row, int at) => Rows[row][at] | Rows[row][at + 1] << 8;

        public void Set16(int row, int at, int value)
        {
            Rows[row][at] = (byte)value;
            Rows[row][at + 1] = (byte)(value >> 8);
        }

        public int Get32(int row, int at) => BitConverter.ToInt32(Rows[row], at);

        public void Set32(int row, int at, int value)
        {
            for (int i = 0; i < 4; i++)
            {
                Rows[row][at + i] = (byte)(value >> (8 * i));
            }
        }

        public byte[] Bytes()
        {
            byte[] counted = (byte[])header.Clone();
            for (int i = 0; i < 4; i++)
            {
                counted[8 + i] = (byte)(Rows.Count >> (8 * i));
            }
            return counted.Concat(Rows.SelectMany(row => row)).ToArray();
        }

        // Sort the rows by site, cluster and oracle id again, and move the world document's
        // per-stand arrays and stand counts with them (4.13.3, 4.13.5). Chapters' first stands are
        // left as they are.
        public void InOrder(object world)
        {
            Dictionary<string, object> stands = Json.Object(Json.Object(world)["stands"]);
            List<object> vertex = Json.Array(stands["vertex"]), arc = Json.Array(stands["arc"]);
            var order = Enumerable.Range(0, Rows.Count)
                .OrderBy(i => Get16(i, SiteAt)).ThenBy(i => Get16(i, ClusterAt)).ThenBy(i => BitConverter.ToString(Rows[i], 0, 16), StringComparer.Ordinal).ToList();
            var rows = order.Select(i => Rows[i]).ToList();
            var vertices = order.Select(i => vertex[i]).ToList();
            var arcs = order.Select(i => arc[i]).ToList();
            Rows.Clear();
            Rows.AddRange(rows);
            vertex.Clear();
            vertex.AddRange(vertices);
            arc.Clear();
            arc.AddRange(arcs);
            Json.Object(world)["standCount"] = (double)Rows.Count;
            List<object> sites = Json.Array(Json.Object(world)["sites"]);
            for (int site = 0; site < sites.Count; site++)
            {
                List<object> clusters = Json.Array(Json.Object(sites[site])["clusters"]);
                for (int number = 0; number < clusters.Count; number++)
                {
                    Json.Object(clusters[number])["stands"] = (double)Enumerable.Range(0, Rows.Count).Count(i => Get16(i, SiteAt) == site && Get16(i, ClusterAt) == number);
                }
            }
        }
    }
}
