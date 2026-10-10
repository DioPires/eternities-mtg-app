using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Eternities.Data
{
    public sealed class PackSet
    {
        public int Id;          // the global set id of search.json
        public string Code, Name;
        public int Year;
    }

    public sealed class PackPlane
    {
        public int Index;
        public string Slug, DisplayName;
        public int CardCount, StarOffset, ShardCount;
        public PackSet[] Sets;  // the sets with a card first printed on this plane, in release order
    }

    public sealed class PackPrinting
    {
        public string Id;
        public int SetId;
        public char Rarity;     // c, u, r or m
        public long ImageTs;
        public string CollectorNumber, Artist;
    }

    public sealed class PackFace
    {
        public string Name, ManaCost, TypeLine, OracleText;
        public string Id;       // a meld back only: the meld result's own printing
        public long ImageTs;
    }

    public sealed class PackCard
    {
        public int Star;                // the global star index: the join key of every pack file
        public string OracleId, Name, ManaCost, TypeLine, OracleText;
        public PackFace Back;           // a second face, or null. Not the same as a back image.
        public string ColourIdentity;   // letters of WUBRG, "" for colourless
        public int Rarity;              // 0 common, 1 uncommon, 2 rare, 3 mythic
        public string Layout;
        public PackPrinting[] Printings;    // in release order: the first is the card's first printing

        // docs/data-contract.md, section 9: the layouts whose back is an image of the same printing.
        // A meld card's back is the meld result, a printing of its own (Back.Id).
        public bool HasBackImage =>
            Layout == "transform" || Layout == "modal_dfc" || Layout == "double_faced_token" || Layout == "reversible_card" || Layout == "art_series"
            || (Layout == "meld" && Back != null && Back.Id != null);
    }

    // The contract v3 pack as the slice reads it (PRD v4 9.5): `manifest.json`, `planes.json`, one
    // plane's shards and `swatches.bin`, from one directory named by the pack's hash.
    public sealed class Pack
    {
        public const int SwatchHeader = 16, SwatchRecord = 8;

        public readonly string Directory;
        public readonly string Hash;
        public readonly PackPlane[] Planes;
        readonly Dictionary<string, (long Bytes, string Sha256)> files = new Dictionary<string, (long, string)>();

        public Pack(string directory)
        {
            Directory = directory;
            var manifest = Json.Object(Json.Parse(File.ReadAllText(Path.Combine(directory, "manifest.json"))));
            Hash = Json.Text(manifest["dataHash"]);
            foreach (object entry in Json.Array(manifest["files"]))
            {
                var file = Json.Object(entry);
                files[Json.Text(file["path"])] = (Json.Long(file["bytes"]), Json.Text(file["sha256"]));
            }

            var planes = new List<PackPlane>();
            foreach (object entry in Json.Array(Json.Object(Json.Parse(ReadText("planes.json")))["planes"]))
            {
                var plane = Json.Object(entry);
                var sets = new List<PackSet>();
                foreach (object setEntry in Json.Array(plane["sets"]))
                {
                    var set = Json.Object(setEntry);
                    sets.Add(new PackSet { Id = Json.Int(set["id"]), Code = Json.Text(set["code"]), Name = Json.Text(set["name"]), Year = Json.Int(set["year"]) });
                }
                planes.Add(new PackPlane
                {
                    Index = Json.Int(plane["index"]), Slug = Json.Text(plane["slug"]), DisplayName = Json.Text(plane["displayName"]),
                    CardCount = Json.Int(plane["cardCount"]), StarOffset = Json.Int(plane["starOffset"]), ShardCount = Json.Int(plane["shardCount"]),
                    Sets = sets.ToArray(),
                });
            }
            Planes = planes.ToArray();
        }

        public PackPlane Plane(string slug)
        {
            foreach (PackPlane plane in Planes)
            {
                if (plane.Slug == slug)
                {
                    return plane;
                }
            }
            throw new ArgumentException($"the pack {Hash} has no plane '{slug}'");
        }

        // The pack's files this plane's world reads, as paths inside the pack's directory.
        public static IEnumerable<string> FilesOf(PackPlane plane)
        {
            yield return "planes.json";
            for (int shard = 0; shard < plane.ShardCount; shard++)
            {
                yield return $"planes/{plane.Slug}.{shard}.json";
            }
            yield return "swatches.bin";
        }

        // A file of the pack, checked against the size and the SHA-256 the manifest lists for it.
        public byte[] Read(string path)
        {
            if (!files.TryGetValue(path, out var listed))
            {
                throw new InvalidDataException($"the manifest of pack {Hash} does not list {path}");
            }
            byte[] bytes = File.ReadAllBytes(Path.Combine(Directory, path));
            if (bytes.Length != listed.Bytes)
            {
                throw new InvalidDataException($"{path} of pack {Hash} is {bytes.Length} bytes, and the manifest lists {listed.Bytes}");
            }
            using (SHA256 sha = SHA256.Create())
            {
                var hex = new StringBuilder(64);
                foreach (byte b in sha.ComputeHash(bytes))
                {
                    hex.Append(b.ToString("x2"));
                }
                if (hex.ToString() != listed.Sha256)
                {
                    throw new InvalidDataException($"{path} of pack {Hash} does not have the SHA-256 the manifest lists");
                }
            }
            return bytes;
        }

        public string ReadText(string path) => new UTF8Encoding(false).GetString(Read(path));

        // Every card of the plane, in star order: card i is star `plane.StarOffset + i`.
        public PackCard[] Cards(PackPlane plane)
        {
            var cards = new List<PackCard>(plane.CardCount);
            for (int shard = 0; shard < plane.ShardCount; shard++)
            {
                var file = Json.Object(Json.Parse(ReadText($"planes/{plane.Slug}.{shard}.json")));
                foreach (object entry in Json.Array(file["cards"]))
                {
                    var card = Json.Object(entry);
                    var printings = new List<PackPrinting>();
                    foreach (object printingEntry in Json.Array(card["p"]))
                    {
                        List<object> p = Json.Array(printingEntry);
                        printings.Add(new PackPrinting
                        {
                            Id = Json.Text(p[0]), SetId = Json.Int(p[1]), Rarity = Json.Text(p[2])[0], ImageTs = Json.Long(p[3]),
                            CollectorNumber = Json.Text(p[4]), Artist = Json.Text(p[5]),
                        });
                    }
                    PackFace back = null;
                    if (card["b"] != null)
                    {
                        var b = Json.Object(card["b"]);
                        back = new PackFace { Name = Json.Text(b["n"]), ManaCost = Json.Text(b["m"]), TypeLine = Json.Text(b["t"]), OracleText = Json.Text(b["o"]) };
                        if (b.TryGetValue("id", out object id) && id != null)
                        {
                            back.Id = Json.Text(id);
                            back.ImageTs = Json.Long(b["ts"]);
                        }
                    }
                    cards.Add(new PackCard
                    {
                        Star = plane.StarOffset + cards.Count,
                        OracleId = Json.Text(card["u"]), Name = Json.Text(card["n"]), ManaCost = Json.Text(card["m"]), TypeLine = Json.Text(card["t"]),
                        OracleText = Json.Text(card["o"]), Back = back, ColourIdentity = Json.Text(card["ci"]), Rarity = Json.Int(card["r"]),
                        Layout = Json.Text(card["l"]), Printings = printings.ToArray(),
                    });
                }
            }
            if (cards.Count != plane.CardCount)
            {
                throw new InvalidDataException($"the shards of {plane.Slug} hold {cards.Count} cards, and planes.json lists {plane.CardCount}");
            }
            return cards.ToArray();
        }

        // `swatches.bin` whole (docs/data-contract.md, section 5.1): a 16-byte header, then four
        // RGB565 samples a card in star order, the card's art at 2 x 2.
        public byte[] Swatches()
        {
            byte[] bytes = Read("swatches.bin");
            if (bytes.Length < SwatchHeader || bytes[0] != 'E' || bytes[1] != 'T' || bytes[2] != 'R' || bytes[3] != 'N' || bytes[4] != 3)
            {
                throw new InvalidDataException($"swatches.bin of pack {Hash} does not start with the swatch header");
            }
            long records = BitConverter.ToUInt32(bytes, 8);
            if (bytes.Length != SwatchHeader + records * SwatchRecord)
            {
                throw new InvalidDataException($"swatches.bin of pack {Hash} is {bytes.Length} bytes for {records} records");
            }
            return bytes;
        }
    }
}
