using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text;
using static Eternities.Layout.LayoutConstants;

namespace Eternities.Layout
{
    // The C# checker of PRD v4 3.2 (invariants 7 to 11) and 5.4.10, as an EditMode test runs it on
    // every fixture (8.3.3, 8.8.2). It reads what a reader of the pack reads, the bytes of
    // `stands.bin` (4.13.3), the world document (4.13.5) and, on a hero world, the lore document
    // (4.16.3), rebuilds every shape from those integers and asserts the invariants on them against
    // the nominal figures of 5.4.1, with no margin (5.4.18 (4)). Its predicates are
    // `Predicates`, exact; it computes no position (5.4.18 (12)).
    //
    // The rules are the pipeline checker's (`pipeline/src/eternities/layout/check.py`), with the
    // same names, the same readings and the same order, so that its document on a fixture is the
    // fixture's `check.json`: the result, the violation count, the tests made under each rule and
    // the figures. The readings, in short (that module's docstring has them in full):
    //
    // - A shape stands over the trig table's 2^30: a millimetre is shifted left by 30 bits, and a
    //   table direction is used as stored. A disc is the 72-gon of 5.4.18 (13).
    // - A corridor ends on the path vertex the world document names, whose arc length lies within
    //   6 m of its cluster's slot (CEO rulings 1 and 2 on DEC-1004).
    // - No cluster has fewer than three stands, except a site's last and a site of fewer than three
    //   stands; a cluster holds at most eight (invariant 9).
    // - A polygon lies inside a polygon by the exact rule of 5.4.18 (10).
    // - The site stone stands 2,500 mm from the pad's centre towards the approach point and 3,000 mm
    //   across, each within the margin; a point that 5.4 puts on a circle lies within the margin.
    // - A stand's yaw and the count that 5.4.18 (7) finds for the vector to its path vertex differ
    //   by at most 100 counts, the short way round (invariant 9).
    // - The trail's legs end at the era or set sites in site order and the spurs at the regional
    //   sites in site order (invariant 10).
    // - A chapter stone lies in the disc of the cluster that holds the chapter's first stand or of
    //   the cluster before it (invariant 11). The path of a site with no stand has two vertices
    //   (5.4.10).
    // - A keyword is matched by `Keywords`, whose case mapping is the runtime's (see there).
    //
    // A count under a rule is the number of tests made: for a rule on pairs of shapes, the pairs
    // whose bounding boxes do not prove them apart, a figure of the geometry.
    public static class Checker
    {
        public const int ViolationLimit = 200;

        // Every rule's name, in the order the checker applies them.
        public static readonly string[] Rules =
        {
            // The files as records (4.13.3, 4.13.5).
            "header", "record-count", "world-format", "stand-count", "record-order", "record-class", "record-yaw", "record-site",
            "record-cluster", "record-vertex", "site-list", "pad-list", "plaza-figures",
            // Invariant 7.
            "card-plane", "card-stand", "card-set", "card-site",
            // Invariant 9.
            "stand-spacing", "footprint-footprint", "footprint-apron", "apron-apron", "footprint-path", "apron-path", "footprint-corridor",
            "apron-corridor", "footprint-pad", "apron-pad", "footprint-stone", "apron-stone", "footprint-plaza", "apron-plaza",
            "footprint-volume", "apron-volume", "corridor-stone", "corridor-plaza", "corridor-volume", "corridor-end", "pad-head",
            "stone-place", "pad-plaza", "pad-pad", "pad-volume", "stone-path", "stone-pad", "stone-stone", "stone-plaza", "stone-volume",
            "volume-arrival", "volume-path", "volume-site", "footprint-blob", "footprint-cluster", "site-bounds", "cluster-cap", "stand-yaw",
            // Invariant 10.
            "plaza-approach", "trail-leg", "spur", "trail-order", "leg-attachment", "approach-length", "site-reached",
            // Invariant 11.
            "chapter-list", "chapter-order", "chapter-first", "chapter-stone", "chapter-cluster", "site-region", "stand-region",
            // The rulings on DEC-1004 and the gap bounds of 5.4.10.
            "corridor-window", "cluster-count", "cluster-size", "cluster-arcs", "gap-first", "gap-between", "gap-end", "path-empty",
        };

        // One card of the plane as the checker needs it (5.4.3), read from the pack and not from
        // the layout.
        public sealed class CheckedCard
        {
            public string OracleId;     // canonical UUID text
            public int SetId;           // the set id of the first printing
            public string[] Names;      // every face's name

            public CheckedCard(string oracleId, int setId, params string[] names)
            {
                OracleId = oracleId;
                SetId = setId;
                Names = names;
            }
        }

        public sealed class SiteFigures
        {
            public string Key;
            public long ToFirst, Between, ToEnd, PathLength;
        }

        public sealed class Result
        {
            public readonly List<string> Violations = new List<string>();   // the first `ViolationLimit`
            public int ViolationCount;
            public readonly Dictionary<string, long> Assertions = new Dictionary<string, long>();
            public long? MinimumStandSpacing;
            public bool Connected;
            public readonly List<SiteFigures> Sites = new List<SiteFigures>();

            public bool Passed => ViolationCount == 0;

            // The rule names of the violations kept, each once.
            public HashSet<string> RulesBroken()
            {
                var found = new HashSet<string>();
                foreach (string line in Violations)
                {
                    found.Add(line.Substring(0, line.IndexOf(':')));
                }
                return found;
            }

            internal void Tested(string rule, long count = 1) => Assertions[rule] += count;

            internal void Fail(string rule, string message)
            {
                ViolationCount++;
                if (Violations.Count < ViolationLimit)
                {
                    Violations.Add($"{rule}: {message}");
                }
            }
        }

        // Check one world's emitted files against invariants 7 to 11. `world` and `lore` are the
        // parsed documents (an object is a string-keyed dictionary, an array a list, an integer
        // token a long and any other number a double, as `Json.Parse` reads them); `lore` is null
        // on a kit world. `cards` is the plane's card list from the pack.
        public static Result Check(byte[] standsBin, object world, object lore, IReadOnlyList<CheckedCard> cards, Trig table)
        {
            var report = new Result();
            foreach (string rule in Rules)
            {
                report.Assertions[rule] = 0;
            }
            List<Record> records = Decode(standsBin, report);
            if (records == null)
            {
                return report;
            }
            report.Tested("world-format");
            (string Place, long Value)? outside = OutsideInt32(world);
            if (outside != null)
            {
                report.Fail("world-format", $"the world document holds {outside.Value.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)} at "
                    + $"{(outside.Value.Place.Length == 0 ? "its top" : outside.Value.Place)}, outside the int32 range of 4.13.5, {int.MinValue} to {int.MaxValue}");
                return report;
            }
            foreach ((string name, object document) in new[] { ("world", world), ("lore", lore) })
            {
                (string Place, double Value)? token = FirstDouble(document);
                if (token != null)
                {
                    report.Fail("world-format", $"the {name} document holds {token.Value.Value.ToString("R", System.Globalization.CultureInfo.InvariantCulture)} at "
                        + $"{(token.Value.Place.Length == 0 ? "its top" : token.Value.Place)}, a number token with a '.', an 'e' or an 'E', which 4.13.5 refuses");
                    return report;
                }
            }
            World read;
            Lore tables;
            try
            {
                read = World.Read(world);
                tables = lore == null ? null : Lore.Read(lore);
            }
            catch (Exception error) when (error is KeyNotFoundException || error is InvalidCastException || error is InvalidDataException
                || error is ArgumentException || error is NullReferenceException || error is OverflowException)
            {
                report.Fail("world-format", $"the world or lore document is not in the emitted form: {error.GetType().Name}: {error.Message}");
                return report;
            }
            var checker = new Run(report, read, tables, cards, table, records);
            checker.Records();
            checker.Lists();
            checker.CardsAndSites();
            report.Sites.AddRange(checker.Sites());
            checker.StandsAgainstStands();
            checker.StandsAgainstStrips();
            checker.CorridorsAgainstStands();
            checker.PadsStonesPlazaVolumes();
            checker.Network();
            BigInteger? least = LeastSquared(checker.Stands.Select(stand => stand.Centre).ToList());
            report.MinimumStandSpacing = least == null ? (long?)null : Predicates.Isqrt(least.Value);
            report.Connected = checker.Connected;
            return report;
        }

        // The files, read into records. A document that is not in the emitted form throws, and
        // `Check` reports it as one violation.

        const int HeaderBytes = 16, RecordBytes = 48, StandsKind = 1, ContractVersion = 4;

        sealed class Record
        {
            public int Index;
            public byte[] Oracle;
            public int Plane, Mask, ColourClass, Site, SetId, Cluster;
            public long X, Z, Yaw;
        }

        static int U16(byte[] data, int at) => data[at] | data[at + 1] << 8;
        static uint U32(byte[] data, int at) => (uint)(data[at] | data[at + 1] << 8 | data[at + 2] << 16 | data[at + 3] << 24);

        static List<Record> Decode(byte[] data, Result report)
        {
            report.Tested("header");
            if (data.Length < HeaderBytes)
            {
                report.Fail("header", $"stands.bin holds {data.Length} bytes, fewer than its {HeaderBytes}-byte header");
                return null;
            }
            string magic = Encoding.ASCII.GetString(data, 0, 4);
            int kind = data[4], version = data[5], reserved = U16(data, 6);
            uint count = U32(data, 8), tail = U32(data, 12);
            if (magic != "ETRN" || kind != StandsKind || version != ContractVersion || reserved != 0 || tail != 0)
            {
                report.Fail("header", $"the header of stands.bin reads magic '{magic}', kind {kind}, version {version}, reserved {reserved} and {tail}; "
                    + $"a stands file is 'ETRN', kind {StandsKind}, version {ContractVersion}, with both reserved fields 0");
            }
            report.Tested("record-count");
            long body = data.Length - HeaderBytes;
            if (body != (long)count * RecordBytes)
            {
                report.Fail("record-count", $"the header of stands.bin counts {count} records of {RecordBytes} bytes and the file holds {body} bytes after its header");
                return null;
            }
            var records = new List<Record>((int)count);
            for (int index = 0; index < count; index++)
            {
                int at = HeaderBytes + index * RecordBytes;
                var oracle = new byte[16];
                Buffer.BlockCopy(data, at, oracle, 0, 16);
                records.Add(new Record
                {
                    Index = index, Oracle = oracle, Plane = data[at + 16], Mask = data[at + 17], ColourClass = data[at + 18],
                    Site = U16(data, at + 22), SetId = U16(data, at + 24),
                    X = (int)U32(data, at + 28), Z = (int)U32(data, at + 32), Yaw = (int)U32(data, at + 36),
                    Cluster = U16(data, at + 46),
                });
            }
            return records;
        }

        // An `oracle_id` as canonical UUID text: the 16 bytes in network order, lower-case hex.
        public static string OracleText(byte[] oracle)
        {
            var text = new StringBuilder(36);
            for (int i = 0; i < 16; i++)
            {
                if (i == 4 || i == 6 || i == 8 || i == 10)
                {
                    text.Append('-');
                }
                text.Append(oracle[i].ToString("x2"));
            }
            return text.ToString();
        }

        static int CompareBytes(byte[] a, byte[] b)
        {
            for (int i = 0; i < a.Length; i++)
            {
                if (a[i] != b[i])
                {
                    return a[i] < b[i] ? -1 : 1;
                }
            }
            return 0;
        }

        // The class a colour identity mask gives (4.13.3), or -1 when the mask has a stray bit.
        public static int ClassOf(int mask)
        {
            if (mask >> 5 != 0)
            {
                return -1;
            }
            if (mask == 0)
            {
                return 6;
            }
            if ((mask & (mask - 1)) != 0)
            {
                return 5;
            }
            int bit = 0;
            while ((mask >> (bit + 1)) != 0)
            {
                bit++;
            }
            return bit;
        }

        sealed class Cluster
        {
            public P2 Centre;
            public long Arc;
            public long Stands;
        }

        sealed class Chapter
        {
            public long SetId, FirstStand, FirstCluster;
            public P2? Stone;
        }

        sealed class Site
        {
            public int Index;
            public string Key, Kind, Region, Era;
            public long[] SetIds;
            public P2 Centre;
            public long Bounding;
            public P2[] Blob, Path;
            public long[] Arcs;
            public P2 Pad, Approach, Stone;
            public Cluster[] Clusters;
            public Chapter[] Chapters;
        }

        sealed class Pad
        {
            public string Owner;
            public P2 Centre;
            public long Radius;
        }

        sealed class Leg
        {
            public long Id;
            public string Kind, Start, End;
            public P2[] Polyline, StartAttachment, EndAttachment;
        }

        sealed class World
        {
            public long PlaneIndex, StandCount, PlazaRadius, PlazaEdge;
            public P2[] PlazaApproach;   // the two ends, or null
            public Pad[] Pads;
            public (string Name, P2[] Outline)[] Volumes;
            public (string Name, P2[] Cell)[] Regions;
            public Site[] Sites;
            public Leg[] Legs;
            public long[] Vertex, Arc;

            public static World Read(object value)
            {
                Dictionary<string, object> world = ObjectOf(value);
                Dictionary<string, object> plaza = ObjectOf(world["plaza"]);
                object approach = plaza["approach"];
                Dictionary<string, object> stands = ObjectOf(world["stands"]);
                var sites = new List<Site>();
                foreach (object row in ListOf(world["sites"]))
                {
                    sites.Add(ReadSite(sites.Count, ObjectOf(row)));
                }
                return new World
                {
                    PlaneIndex = Whole(world["planeIndex"]),
                    StandCount = Whole(world["standCount"]),
                    PlazaRadius = Whole(plaza["radius"]),
                    PlazaEdge = Whole(plaza["edgeRadius"]),
                    PlazaApproach = approach == null ? null : new[] { Point(ListOf(approach)[0]), Point(ListOf(approach)[1]) },
                    Pads = ListOf(world["pads"]).Select(row => new Pad { Owner = Text(ObjectOf(row)["owner"]), Centre = Pose(row), Radius = Whole(ObjectOf(row)["radius"]) }).ToArray(),
                    Volumes = ListOf(world["heroVolumes"]).Select(row => (Text(ObjectOf(row)["id"]), Points(ObjectOf(row)["polygon"], 3, "the polygon of a hero volume"))).ToArray(),
                    Regions = ListOf(world["regions"]).Select(row => (TextOrNull(ObjectOf(row)["id"]), Points(ObjectOf(row)["cell"], 3, "the cell of a region"))).ToArray(),
                    Sites = sites.ToArray(),
                    Legs = ListOf(ObjectOf(world["trail"])["legs"]).Select(row => ReadLeg(ObjectOf(row))).ToArray(),
                    Vertex = ListOf(stands["vertex"]).Select(Whole).ToArray(),
                    Arc = ListOf(stands["arc"]).Select(Whole).ToArray(),
                };
            }

            static Site ReadSite(int index, Dictionary<string, object> row)
            {
                string key = Text(row["key"]);
                P2[] path = Points(row["path"], 1, $"the path of site {key}");
                return new Site
                {
                    Index = index,
                    Key = key,
                    Kind = Text(row["kind"]),
                    Region = TextOrNull(row["regionId"]),
                    Era = TextOrNull(row["eraId"]),
                    SetIds = ListOf(row["setIds"]).Select(Whole).ToArray(),
                    Centre = Point(row["centre"]),
                    Bounding = Whole(row["boundingRadius"]),
                    Blob = Points(row["blob"], 3, $"the blob of site {key}"),
                    Path = path,
                    Arcs = Predicates.ArcLengths(path),
                    Pad = Pose(row["pad"]),
                    Approach = Point(row["approachPoint"]),
                    Stone = Pose(row["stone"]),
                    Clusters = ListOf(row["clusters"]).Select(item => new Cluster
                    {
                        Centre = Point(ObjectOf(item)["centre"]), Arc = Whole(ObjectOf(item)["arc"]), Stands = Whole(ObjectOf(item)["stands"]),
                    }).ToArray(),
                    Chapters = ListOf(row["chapters"]).Select(item => new Chapter
                    {
                        SetId = Whole(ObjectOf(item)["setId"]), FirstStand = Whole(ObjectOf(item)["firstStand"]),
                        FirstCluster = Whole(ObjectOf(item)["firstCluster"]), Stone = ObjectOf(item)["stone"] == null ? (P2?)null : Pose(ObjectOf(item)["stone"]),
                    }).ToArray(),
                };
            }

            static Leg ReadLeg(Dictionary<string, object> row)
            {
                long number = Whole(row["id"]);
                return new Leg
                {
                    Id = number,
                    Kind = Text(row["kind"]),
                    Start = Text(row["from"]),
                    End = Text(row["to"]),
                    Polyline = Points(row["polyline"], 1, $"the polyline of leg {number}"),
                    StartAttachment = Points(row["startAttachment"], 0, "an attachment"),
                    EndAttachment = Points(row["endAttachment"], 0, "an attachment"),
                };
            }
        }

        sealed class Era
        {
            public string Id, Region;
            public long[] SetIds;
        }

        sealed class Lore
        {
            public Era[] Eras;
            public string[] Regions;
            public Keywords.Row[] Keywords;

            public static Lore Read(object value)
            {
                Dictionary<string, object> lore = ObjectOf(value);
                return new Lore
                {
                    Eras = ListOf(lore["eras"]).Select(row => new Era
                    {
                        Id = Text(ObjectOf(row)["id"]), Region = Text(ObjectOf(row)["region"]), SetIds = ListOf(ObjectOf(row)["setIds"]).Select(SetId).ToArray(),
                    }).ToArray(),
                    Regions = ListOf(lore["regions"]).Select(row => Text(ObjectOf(row)["id"])).ToArray(),
                    Keywords = ListOf(lore["keywords"]).Select(row => new Keywords.Row(Text(ObjectOf(row)["word"]), Text(ObjectOf(row)["region"]))).ToArray(),
                };
            }
        }

        static Dictionary<string, object> ObjectOf(object value) => (Dictionary<string, object>)value;
        static List<object> ListOf(object value) => (List<object>)value;

        // Erratum 7 (4.13.5): every integer of a world document lies in the int32 range, read or
        // not. `Whole` takes any long and the checker computes in `long`, which wraps from about
        // 2^32 mm, so without this the two checkers could read one document two ways. An integer
        // token is a long here, and any other number a double, which `FirstDouble` refuses; the
        // first long outside the range is returned with its place in the document, as
        // `sites[0].centre[1]`, which is written only then.
        static (string Place, long Value)? OutsideInt32(object value)
        {
            switch (value)
            {
                case long l:
                    return l < int.MinValue || l > int.MaxValue ? ("", l) : ((string, long)?)null;
                case Dictionary<string, object> members:
                    foreach (KeyValuePair<string, object> member in members)
                    {
                        (string Place, long Value)? found = OutsideInt32(member.Value);
                        if (found != null)
                        {
                            return (member.Key + Joined(found.Value.Place), found.Value.Value);
                        }
                    }
                    return null;
                case List<object> items:
                    for (int i = 0; i < items.Count; i++)
                    {
                        (string Place, long Value)? found = OutsideInt32(items[i]);
                        if (found != null)
                        {
                            return ($"[{i}]" + Joined(found.Value.Place), found.Value.Value);
                        }
                    }
                    return null;
                default:
                    return null;
            }
        }

        // Erratum 8 (4.13.5): no number token of the world or lore document holds a `.`, an `e` or
        // an `E`, read or not. `Json.Parse` reads exactly those tokens as a double, and an integer
        // token as a long, so without this `Whole` would take `5.0` and `5e0` as 5 where the
        // pipeline's checker refuses them. An integer token that a long cannot hold is a double too,
        // and lies outside the int32 range of 4.13.5 in any case. The first double is returned with
        // its place in the document, as `sites[0].centre[1]`, which is written only then.
        static (string Place, double Value)? FirstDouble(object value)
        {
            switch (value)
            {
                case double d:
                    return ("", d);
                case Dictionary<string, object> members:
                    foreach (KeyValuePair<string, object> member in members)
                    {
                        (string Place, double Value)? found = FirstDouble(member.Value);
                        if (found != null)
                        {
                            return (member.Key + Joined(found.Value.Place), found.Value.Value);
                        }
                    }
                    return null;
                case List<object> items:
                    for (int i = 0; i < items.Count; i++)
                    {
                        (string Place, double Value)? found = FirstDouble(items[i]);
                        if (found != null)
                        {
                            return ($"[{i}]" + Joined(found.Value.Place), found.Value.Value);
                        }
                    }
                    return null;
                default:
                    return null;
            }
        }

        // What follows a key in a place: an index as it is, a member's name after a dot.
        static string Joined(string inner) => inner.Length == 0 || inner[0] == '[' ? inner : "." + inner;

        // An era's set id: a whole number in the uint16 range of a stand's set id (4.16.3, erratum
        // 8), since `Whole` takes any long.
        static long SetId(object value)
        {
            long number = Whole(value);
            if (number < 0 || number > ushort.MaxValue)
            {
                throw new InvalidDataException($"the set id {number} lies outside the uint16 range of 4.16.3, 0 to {ushort.MaxValue}");
            }
            return number;
        }

        // A whole number: a JSON number with no fraction, within the range a double holds exactly.
        static long Whole(object value)
        {
            switch (value)
            {
                case long l:
                    return l;
                case int i:
                    return i;
                case double d when d == Math.Floor(d) && Math.Abs(d) <= 9_007_199_254_740_992d:
                    return (long)d;
                default:
                    throw new InvalidDataException($"{value ?? "null"} is not a whole number");
            }
        }

        static string Text(object value) => value as string ?? throw new InvalidDataException($"{value ?? "null"} is not a string");
        static string TextOrNull(object value) => value == null ? null : Text(value);

        static P2 Point(object value)
        {
            List<object> pair = ListOf(value);
            if (pair.Count != 2)
            {
                throw new InvalidDataException($"a point holds {pair.Count} numbers, not 2");
            }
            return new P2(Whole(pair[0]), Whole(pair[1]));
        }

        static P2[] Points(object value, int least, string what)
        {
            P2[] found = ListOf(value).Select(Point).ToArray();
            if (found.Length < least)
            {
                throw new InvalidDataException($"{what} holds {found.Length} points, fewer than {least}");
            }
            return found;
        }

        static P2 Pose(object value) => new P2(Whole(ObjectOf(value)["x"]), Whole(ObjectOf(value)["z"]));

        // The world as shapes.

        static readonly long FootAlong = Half(FootprintDepth), FootAcross = Half(FootprintWidth), ApronAcross = Half(ApronWidth);
        static readonly long ApronFront = FootAlong + ApronDepth;   // from the stand's centre to the apron's front edge
        const long StoneAhead = StoneAlong - PadRadius;             // from the pad's centre to the site stone's, along the approach

        static long Half(long length)
        {
            if (length % 2 != 0)
            {
                throw new ArgumentException($"{length} mm has no whole half");
            }
            return length / 2;
        }

        static P2 Scaled(P2 p) => new P2(p.X << Trig.Shift, p.Z << Trig.Shift);
        static P2[] Scaled(IEnumerable<P2> points) => points.Select(Scaled).ToArray();
        static BigInteger ScaledSquare(long length) => (BigInteger)(length * length) << (2 * Trig.Shift);

        // The whole-millimetre box that holds scaled points: floors below, ceilings above.
        static Box ScaledBox(IReadOnlyList<P2> points)
        {
            Box plain = Box.Of(points);
            return new Box(plain.MinX >> Trig.Shift, plain.MinZ >> Trig.Shift, -(-plain.MaxX >> Trig.Shift), -(-plain.MaxZ >> Trig.Shift));
        }

        sealed class Stand
        {
            public Record Record;
            public int Index;
            public string Oracle, Name;
            public Site Site;
            public int Cluster = -1;            // when the site has that cluster
            public int Vertex = -1;             // the corridor's vertex on the site's path, when the path has it
            public P2 Centre;
            public P2[] Footprint, Apron;
            public P2 Front;                    // the middle of the apron's front edge, where the corridor starts
            public P2? End;                     // the corridor's end, the path vertex, scaled
            public Box Box, FootBox, ApronBox;  // Box: the footprint and the apron together
            public Box? CorridorBox;

            public (string Part, P2[] Polygon, Box Box)[] Parts => new[] { ("footprint", Footprint, FootBox), ("apron", Apron, ApronBox) };
        }

        sealed class Shape
        {
            public string Label;
            public P2[] Polygon;
            public Box Box;
        }

        sealed class Segment
        {
            public int Strip, Index;
            public P2 A, B;
            public Box Box;
        }

        // A stand's footprint, its apron and the start of its corridor, scaled: the footprint is
        // centred on (x, z) with its depth along the yaw, the apron starts at its front face and
        // runs forward, and the corridor starts at the middle of the apron's front edge. Both
        // polygons run counter-clockwise from the corner behind and to the right of the yaw.
        public static (P2[] Footprint, P2[] Apron, P2 Front) StandShapes(long x, long z, long yaw, Trig table)
        {
            int count = Trig.CountOf(yaw);
            long cos = table.Cos(count), sin = table.Sin(count);
            long cx = x << Trig.Shift, cz = z << Trig.Shift;
            P2 Corner(long along, long across) => new P2(cx + along * cos - across * sin, cz + along * sin + across * cos);
            P2[] footprint = { Corner(-FootAlong, -FootAcross), Corner(FootAlong, -FootAcross), Corner(FootAlong, FootAcross), Corner(-FootAlong, FootAcross) };
            P2[] apron = { Corner(FootAlong, -ApronAcross), Corner(ApronFront, -ApronAcross), Corner(ApronFront, ApronAcross), Corner(FootAlong, ApronAcross) };
            return (footprint, apron, Corner(ApronFront, 0));
        }

        // The count that 5.4.18 (7) picks: of the two counts that bracket the vector (vx, vz), the
        // one on the vector's side of their directions' sum, ties to the lower count. A binary
        // search over the quarter turn that holds the vector finds the last count whose direction
        // lies at or clockwise of it, by the sign of the exact cross product; that count and the
        // next bracket the vector.
        public static int CountOf(long vx, long vz, Trig table)
        {
            if (vx == 0 && vz == 0)
            {
                throw new ArgumentException("the zero vector has no direction");
            }
            const int quarter = CountsPerTurn / 4;
            int first;
            if (vx > 0 && vz >= 0)
            {
                first = 0;
            }
            else if (vx <= 0 && vz > 0)
            {
                first = quarter;
            }
            else if (vx < 0 && vz <= 0)
            {
                first = 2 * quarter;
            }
            else
            {
                first = 3 * quarter;
            }
            int low = first, high = first + quarter - 1;
            while (low < high)
            {
                int middle = (low + high + 1) / 2;
                int count = middle % CountsPerTurn;
                if (Predicates.CrossSign(table.Cos(count), vz, table.Sin(count), vx) >= 0)
                {
                    low = middle;
                }
                else
                {
                    high = middle - 1;
                }
            }
            int below = low % CountsPerTurn, above = (low + 1) % CountsPerTurn;
            int side = Predicates.CrossSign(table.Cos(below) + table.Cos(above), vz, table.Sin(below) + table.Sin(above), vx);
            if (side > 0)
            {
                return above;
            }
            if (side < 0)
            {
                return below;
            }
            return Math.Min(below, above);
        }

        // Whether a stand at `centre` with `yaw` faces `target` within 0.1 degree: the yaw's count
        // and the count of the vector to the target differ by at most `FacingCounts`, the short way
        // round the circle. A stand on its target faces nothing.
        public static bool Faces(long yaw, P2 centre, P2 target, Trig table)
        {
            long vx = target.X - centre.X, vz = target.Z - centre.Z;
            if (vx == 0 && vz == 0)
            {
                return false;
            }
            int apart = ((Trig.CountOf(yaw) - CountOf(vx, vz, table)) % CountsPerTurn + CountsPerTurn) % CountsPerTurn;
            return Math.Min(apart, CountsPerTurn - apart) <= FacingCounts;
        }

        // Whether a rounded point lies within the margin of a circle.
        static bool OnCircle(P2 point, P2 centre, long radius)
        {
            BigInteger apart = Predicates.Squared(point, centre);
            long low = Math.Max(radius - Margin, 0), high = radius + Margin;
            return (BigInteger)low * low <= apart && apart <= (BigInteger)high * high;
        }

        // Whether `product` / sqrt(`square`) lies within the margin of `figure`, compared squared;
        // `product` must not be negative.
        static bool NearFigure(BigInteger product, long figure, BigInteger square)
        {
            long low = Math.Max(figure - Margin, 0), high = figure + Margin;
            return product.Sign >= 0 && (BigInteger)low * low * square <= product * product && product * product <= (BigInteger)high * high * square;
        }

        // Whether a site stone stands where 5.4.8 puts it beside its pad's approach.
        static bool BesideApproach(P2 stone, P2 pad, P2 approach)
        {
            long dx = approach.X - pad.X, dz = approach.Z - pad.Z;
            BigInteger square = (BigInteger)dx * dx + (BigInteger)dz * dz;
            if (square.IsZero)
            {
                return false;
            }
            long wx = stone.X - pad.X, wz = stone.Z - pad.Z;
            BigInteger along = (BigInteger)wx * dx + (BigInteger)wz * dz;
            BigInteger across = BigInteger.Abs((BigInteger)dx * wz - (BigInteger)dz * wx);
            return NearFigure(along, StoneAhead, square) && NearFigure(across, StoneAcross, square);
        }

        // A uniform hash grid over boxes. A query returns every item whose box may meet the
        // query's; every pair it offers is tested again on its own boxes and then exactly.
        sealed class Grid
        {
            const int CellShift = 12;   // a cell is 2^12 mm, about 4.1 m
            const long Wide = 1_024;    // a box over more cells than this is offered to every query
            readonly Dictionary<(long, long), List<int>> cells = new Dictionary<(long, long), List<int>>();
            readonly List<int> wide = new List<int>();

            public void Add(int item, Box box)
            {
                long columns = (box.MaxX >> CellShift) - (box.MinX >> CellShift) + 1, rows = (box.MaxZ >> CellShift) - (box.MinZ >> CellShift) + 1;
                if (columns * rows > Wide)
                {
                    wide.Add(item);
                    return;
                }
                for (long column = box.MinX >> CellShift; column <= box.MaxX >> CellShift; column++)
                {
                    for (long row = box.MinZ >> CellShift; row <= box.MaxZ >> CellShift; row++)
                    {
                        if (!cells.TryGetValue((column, row), out List<int> items))
                        {
                            cells[(column, row)] = items = new List<int>();
                        }
                        items.Add(item);
                    }
                }
            }

            // The items whose cells the box touches, in ascending order.
            public List<int> Near(Box box)
            {
                var found = new HashSet<int>(wide);
                long c0 = box.MinX >> CellShift, c1 = box.MaxX >> CellShift, r0 = box.MinZ >> CellShift, r1 = box.MaxZ >> CellShift;
                if ((c1 - c0 + 1) * (r1 - r0 + 1) > cells.Count)
                {
                    foreach (KeyValuePair<(long, long), List<int>> cell in cells)
                    {
                        if (cell.Key.Item1 >= c0 && cell.Key.Item1 <= c1 && cell.Key.Item2 >= r0 && cell.Key.Item2 <= r1)
                        {
                            found.UnionWith(cell.Value);
                        }
                    }
                }
                else
                {
                    for (long column = c0; column <= c1; column++)
                    {
                        for (long row = r0; row <= r1; row++)
                        {
                            if (cells.TryGetValue((column, row), out List<int> items))
                            {
                                found.UnionWith(items);
                            }
                        }
                    }
                }
                var sorted = found.ToList();
                sorted.Sort();
                return sorted;
            }
        }

        // The least squared distance between two of the points, by a sweep along x.
        static BigInteger? LeastSquared(List<P2> points)
        {
            if (points.Count < 2)
            {
                return null;
            }
            var order = points.OrderBy(p => p.X).ThenBy(p => p.Z).ToList();
            BigInteger best = Predicates.Squared(order[0], order[1]);
            for (int i = 0; i < order.Count; i++)
            {
                for (int j = i + 1; j < order.Count; j++)
                {
                    long dx = order[j].X - order[i].X;
                    if ((BigInteger)dx * dx >= best)
                    {
                        break;
                    }
                    BigInteger apart = Predicates.Squared(order[i], order[j]);
                    if (apart < best)
                    {
                        best = apart;
                    }
                }
            }
            return best;
        }

        // Disjoint sets of the network's points.
        sealed class Sets
        {
            readonly Dictionary<(string, long, long), (string, long, long)> parent = new Dictionary<(string, long, long), (string, long, long)>();

            public (string, long, long) Find((string, long, long) node)
            {
                (string, long, long) root = node;
                while (true)
                {
                    if (!parent.TryGetValue(root, out (string, long, long) above))
                    {
                        parent[root] = root;
                        above = root;
                    }
                    if (above.Equals(root))
                    {
                        break;
                    }
                    root = above;
                }
                while (!node.Equals(root))
                {
                    (string, long, long) next = parent[node];
                    parent[node] = root;
                    node = next;
                }
                return root;
            }

            public void Join((string, long, long) a, (string, long, long) b) => parent[Find(a)] = Find(b);
        }

        // One world's shapes and the rules over them.
        sealed class Run
        {
            readonly Result report;
            readonly World world;
            readonly Lore lore;
            readonly IReadOnlyList<CheckedCard> cards;
            readonly Trig table;
            readonly P2[] ring;
            public readonly List<Stand> Stands;
            readonly List<Stand>[][] members;      // per site and cluster, the stands the records put there
            readonly List<Stand>[] residents;
            readonly Grid standGrid = new Grid(), corridorGrid = new Grid(), stripGrid = new Grid();
            readonly List<string> strips = new List<string>();
            readonly List<Segment> segments = new List<Segment>();
            readonly P2[][] blobs;
            readonly Shape[][] clusterDiscs;
            readonly List<Shape> pads = new List<Shape>(), stones = new List<Shape>(), volumes = new List<Shape>();
            readonly Dictionary<string, Site> sitesByKey = new Dictionary<string, Site>();
            readonly Dictionary<long, Site> setSites = new Dictionary<long, Site>();
            readonly Dictionary<string, Site> eraSites = new Dictionary<string, Site>(), regionSites = new Dictionary<string, Site>();
            readonly Dictionary<long, Era> eraOfSet = new Dictionary<long, Era>();
            readonly HashSet<int> headed = new HashSet<int>();     // the sites whose path begins on its pad's edge
            public bool Connected;

            public Run(Result report, World world, Lore lore, IReadOnlyList<CheckedCard> cards, Trig table, List<Record> records)
            {
                this.report = report;
                this.world = world;
                this.lore = lore;
                this.cards = cards;
                this.table = table;
                ring = Enumerable.Range(0, DiscVertices).Select(step => new P2(table.Cos(step * DiscStepCounts), table.Sin(step * DiscStepCounts))).ToArray();
                Stands = records.Select(MakeStand).ToList();
                members = world.Sites.Select(site => site.Clusters.Select(_ => new List<Stand>()).ToArray()).ToArray();
                residents = world.Sites.Select(_ => new List<Stand>()).ToArray();
                foreach (Stand stand in Stands)
                {
                    if (stand.Site != null)
                    {
                        residents[stand.Site.Index].Add(stand);
                        if (stand.Cluster >= 0)
                        {
                            members[stand.Site.Index][stand.Cluster].Add(stand);
                        }
                    }
                }
                foreach (Stand stand in Stands)
                {
                    standGrid.Add(stand.Index, stand.Box);
                    if (stand.CorridorBox != null)
                    {
                        corridorGrid.Add(stand.Index, stand.CorridorBox.Value);
                    }
                }
                foreach (Site site in world.Sites)
                {
                    Strip($"the path of site {site.Key}", site.Path);
                    Strip($"the approach of site {site.Key}", new[] { site.Pad, site.Approach });
                }
                foreach (Leg leg in world.Legs)
                {
                    Strip($"trail leg {leg.Id} ({leg.Start} to {leg.End})", leg.Polyline);
                }
                if (world.PlazaApproach != null)
                {
                    Strip("the plaza approach", world.PlazaApproach);
                }
                blobs = world.Sites.Select(site => Scaled(site.Blob)).ToArray();
                clusterDiscs = world.Sites.Select(site => site.Clusters.Select((cluster, number) => Disc($"cluster {number} of site {site.Key}", cluster.Centre, ClusterRadius)).ToArray()).ToArray();
                if (world.Pads.Length > 0)
                {
                    Pad first = world.Pads[0];
                    pads.Add(Disc(first.Owner == "return" ? "the return pad" : $"the pad of site {first.Owner}", first.Centre, PadRadius));
                }
                foreach (Site site in world.Sites)
                {
                    pads.Add(Disc($"the pad of site {site.Key}", site.Pad, PadRadius));
                }
                foreach (Site site in world.Sites)
                {
                    stones.Add(Disc($"the stone of site {site.Key}", site.Stone, StoneRadius));
                    foreach (Chapter chapter in site.Chapters)
                    {
                        if (chapter.Stone != null)
                        {
                            stones.Add(Disc($"the chapter stone of set id {chapter.SetId} in site {site.Key}", chapter.Stone.Value, StoneRadius));
                        }
                    }
                }
                foreach ((string name, P2[] outline) in world.Volumes)
                {
                    volumes.Add(new Shape { Label = $"hero volume {name}", Polygon = Scaled(outline), Box = Box.Of(outline) });
                }
            }

            // The 72-gon of 5.4.18 (13) about an emitted centre.
            Shape Disc(string label, P2 centre, long radius)
            {
                long x = centre.X << Trig.Shift, z = centre.Z << Trig.Shift;
                return new Shape
                {
                    Label = label,
                    Polygon = ring.Select(d => new P2(x + radius * d.X, z + radius * d.Z)).ToArray(),
                    Box = new Box(centre.X - radius, centre.Z - radius, centre.X + radius, centre.Z + radius),
                };
            }

            void Strip(string label, IReadOnlyList<P2> polyline)
            {
                int strip = strips.Count;
                strips.Add(label);
                List<(P2 a, P2 b)> pieces = Predicates.Segments(polyline);
                for (int index = 0; index < pieces.Count; index++)
                {
                    (P2 a, P2 b) = pieces[index];
                    Box box = Box.Of(new[] { a, b });
                    stripGrid.Add(segments.Count, box);
                    segments.Add(new Segment { Strip = strip, Index = index, A = Scaled(a), B = Scaled(b), Box = box });
                }
            }

            Stand MakeStand(Record record)
            {
                Site site = record.Site < world.Sites.Length ? world.Sites[record.Site] : null;
                int cluster = -1, vertex = -1;
                P2? end = null;
                if (site != null)
                {
                    if (record.Cluster < site.Clusters.Length)
                    {
                        cluster = record.Cluster;
                    }
                    if (record.Index < world.Vertex.Length && world.Vertex[record.Index] >= 0 && world.Vertex[record.Index] < site.Path.Length)
                    {
                        vertex = (int)world.Vertex[record.Index];
                        end = Scaled(site.Path[vertex]);
                    }
                }
                (P2[] footprint, P2[] apron, P2 front) = StandShapes(record.X, record.Z, record.Yaw, table);
                string oracle = OracleText(record.Oracle);
                string where = site == null ? $"site {record.Site}, out of range" : $"site {site.Key}";
                return new Stand
                {
                    Record = record,
                    Index = record.Index,
                    Oracle = oracle,
                    Name = $"stand {record.Index} ({where}, cluster {record.Cluster}, oracle {oracle})",
                    Site = site,
                    Cluster = cluster,
                    Vertex = vertex,
                    Centre = new P2(record.X, record.Z),
                    Footprint = footprint,
                    Apron = apron,
                    Front = front,
                    End = end,
                    Box = ScaledBox(footprint.Concat(apron).ToArray()),
                    FootBox = ScaledBox(footprint),
                    ApronBox = ScaledBox(apron),
                    CorridorBox = end == null ? (Box?)null : ScaledBox(new[] { front, end.Value }),
                };
            }

            // The files as records.

            public void Records()
            {
                report.Tested("stand-count");
                if (!(world.StandCount == Stands.Count && Stands.Count == world.Vertex.Length && world.Vertex.Length == world.Arc.Length))
                {
                    report.Fail("stand-count", $"stands.bin holds {Stands.Count} records; the world file counts {world.StandCount} stands and lists "
                        + $"{world.Vertex.Length} corridor vertices and {world.Arc.Length} arc lengths");
                }
                Stand before = null;
                foreach (Stand stand in Stands)
                {
                    Record record = stand.Record;
                    if (before != null)
                    {
                        report.Tested("record-order");
                        Record earlier = before.Record;
                        int order = earlier.Site != record.Site ? earlier.Site.CompareTo(record.Site)
                            : earlier.Cluster != record.Cluster ? earlier.Cluster.CompareTo(record.Cluster) : CompareBytes(earlier.Oracle, record.Oracle);
                        if (order > 0)
                        {
                            report.Fail("record-order", $"{before.Name} stands before {stand.Name}; the records are sorted by site index, cluster index and oracle id");
                        }
                    }
                    before = stand;
                    report.Tested("record-class");
                    if (ClassOf(record.Mask) != record.ColourClass)
                    {
                        report.Fail("record-class", $"{stand.Name} records class {record.ColourClass} for the colour identity mask {record.Mask}");
                    }
                    report.Tested("record-yaw");
                    if (record.Yaw < 0 || record.Yaw >= MicroPerTurn || record.Yaw % MicroPerCount != 0)
                    {
                        report.Fail("record-yaw", $"{stand.Name} records the yaw {record.Yaw}, which is not a count of the trig table times {MicroPerCount} within one turn");
                    }
                    report.Tested("record-site");
                    if (stand.Site == null)
                    {
                        report.Fail("record-site", $"{stand.Name} records site index {record.Site}; the world file lists {world.Sites.Length} sites");
                        continue;
                    }
                    report.Tested("record-cluster");
                    if (stand.Cluster < 0)
                    {
                        report.Fail("record-cluster", $"{stand.Name} records cluster index {record.Cluster}; its site has {stand.Site.Clusters.Length} clusters");
                    }
                    report.Tested("record-vertex");
                    if (stand.Vertex < 0)
                    {
                        string given = stand.Index < world.Vertex.Length ? world.Vertex[stand.Index].ToString() : "None";
                        report.Fail("record-vertex", $"the corridor of {stand.Name} ends on vertex {given}; its site's path has {stand.Site.Path.Length} vertices");
                    }
                }
            }

            // The site list and the pad list agree with themselves and with each other.
            public void Lists()
            {
                string[] kinds = lore == null ? new[] { "set" } : new[] { "era", "region" };
                foreach (Site site in world.Sites)
                {
                    report.Tested("site-list");
                    if (sitesByKey.ContainsKey(site.Key))
                    {
                        report.Fail("site-list", $"two sites have the key {site.Key}");
                    }
                    else
                    {
                        sitesByKey[site.Key] = site;
                    }
                    if (!kinds.Contains(site.Kind))
                    {
                        string law = lore == null ? "kit" : "hero";
                        report.Fail("site-list", $"site {site.Key} is of kind {site.Kind}; a {law} world has sites of kind " + string.Join(" and ", kinds));
                    }
                    if (site.Kind == "set")
                    {
                        foreach (long setId in site.SetIds)
                        {
                            if (!setSites.TryGetValue(setId, out Site other))
                            {
                                setSites[setId] = site;
                            }
                            else if (other != site)
                            {
                                report.Fail("site-list", $"sites {other.Key} and {site.Key} both hold set id {setId}");
                            }
                        }
                    }
                    else if (site.Kind == "era" && site.Era != null)
                    {
                        if (!eraSites.TryGetValue(site.Era, out Site other))
                        {
                            eraSites[site.Era] = site;
                        }
                        else if (other != site)
                        {
                            report.Fail("site-list", $"sites {other.Key} and {site.Key} both hold era {site.Era}");
                        }
                    }
                    else if (site.Kind == "region" && site.Region != null)
                    {
                        if (!regionSites.TryGetValue(site.Region, out Site other))
                        {
                            regionSites[site.Region] = site;
                        }
                        else if (other != site)
                        {
                            report.Fail("site-list", $"sites {other.Key} and {site.Key} are both the regional site of {site.Region}");
                        }
                    }
                    else if (site.Kind == "era" || site.Kind == "region")
                    {
                        report.Fail("site-list", $"site {site.Key} of kind {site.Kind} names no {site.Kind}");
                    }
                }
                if (lore != null)
                {
                    foreach (Era era in lore.Eras)
                    {
                        foreach (long setId in era.SetIds)
                        {
                            report.Tested("site-list");
                            if (!eraOfSet.TryGetValue(setId, out Era other))
                            {
                                eraOfSet[setId] = era;
                            }
                            else if (other != era)
                            {
                                report.Fail("site-list", $"eras {other.Id} and {era.Id} of the lore document both hold set id {setId}");
                            }
                        }
                    }
                }
                report.Tested("pad-list", 1 + world.Sites.Length);
                var expected = new List<(string Owner, P2? Centre)> { ("return", null) };
                expected.AddRange(world.Sites.Select(site => (site.Key, (P2?)site.Pad)));
                if (world.Pads.Length != expected.Count)
                {
                    report.Fail("pad-list", $"the world file lists {world.Pads.Length} pads; the return pad and one pad a site make {expected.Count}");
                }
                for (int i = 0; i < Math.Min(world.Pads.Length, expected.Count); i++)
                {
                    Pad pad = world.Pads[i];
                    (string owner, P2? centre) = expected[i];
                    if (pad.Owner != owner || (centre != null && !pad.Centre.Equals(centre.Value)))
                    {
                        report.Fail("pad-list", $"the pad list holds the pad of {pad.Owner} at {pad.Centre} where the pad of {owner} stands" + (centre == null ? "" : $" at {centre}"));
                    }
                    if (pad.Radius != PadRadius)
                    {
                        report.Fail("pad-list", $"the pad of {pad.Owner} has radius {pad.Radius} mm; a pad's is {PadRadius}");
                    }
                }
                report.Tested("plaza-figures");
                if (world.PlazaRadius != PlazaRadius || world.PlazaEdge != PlazaEdgeRadius)
                {
                    report.Fail("plaza-figures", $"the plaza is emitted with radius {world.PlazaRadius} mm and edge radius {world.PlazaEdge} mm; the plaza's are {PlazaRadius} and {PlazaEdgeRadius}");
                }
                if (world.Pads.Length > 0)
                {
                    report.Tested("pad-plaza");
                    Shape plaza = Disc("the plaza", new P2(0, 0), PlazaRadius);
                    if (!Predicates.PolygonInsidePolygon(pads[0].Polygon, plaza.Polygon))
                    {
                        report.Fail("pad-plaza", $"{pads[0].Label} does not lie inside the plaza");
                    }
                }
            }

            // Invariant 7.

            // The site 5.4.3 assigns a card, and why; or null, and what is missing.
            (Site Site, string Why) Assigned(CheckedCard card)
            {
                string name = card.Names.Length > 0 ? card.Names[0] : card.OracleId;
                if (lore == null)
                {
                    return setSites.TryGetValue(card.SetId, out Site set)
                        ? (set, $"the site of set id {card.SetId}")
                        : (null, $"no set site holds set id {card.SetId}, the set of {name}");
                }
                if (!eraOfSet.TryGetValue(card.SetId, out Era era))
                {
                    return (null, $"no era of the lore document holds set id {card.SetId}, the set of {name}");
                }
                Keywords.Row? keyword = Keywords.Selected(card.Names, lore.Keywords);
                if (keyword != null && keyword.Value.Region != era.Region)
                {
                    string why = $"keyword '{keyword.Value.Word}' of region {keyword.Value.Region}; era {era.Id} of region {era.Region}";
                    return regionSites.TryGetValue(keyword.Value.Region, out Site regional)
                        ? (regional, why)
                        : (null, $"the world has no regional site of {keyword.Value.Region} for {name} ({why})");
                }
                if (!eraSites.TryGetValue(era.Id, out Site site))
                {
                    return (null, $"the world has no site of era {era.Id} for {name}");
                }
                return keyword == null ? (site, $"era {era.Id}, no keyword") : (site, $"era {era.Id}; keyword '{keyword.Value.Word}' is of the era's region");
            }

            public void CardsAndSites()
            {
                long plane = world.PlaneIndex;
                foreach (Stand stand in Stands)
                {
                    report.Tested("card-plane");
                    if (stand.Record.Plane != plane)
                    {
                        report.Fail("card-plane", $"{stand.Name} records plane index {stand.Record.Plane}; the world file is the world of plane index {plane}");
                    }
                }
                var held = new Dictionary<string, List<Stand>>();
                foreach (Stand stand in Stands)
                {
                    if (!held.TryGetValue(stand.Oracle, out List<Stand> list))
                    {
                        held[stand.Oracle] = list = new List<Stand>();
                    }
                    list.Add(stand);
                }
                var listed = new Dictionary<string, CheckedCard>();
                foreach (CheckedCard card in cards)
                {
                    string key = card.OracleId.ToLowerInvariant();
                    if (listed.ContainsKey(key))
                    {
                        continue;
                    }
                    listed[key] = card;
                    report.Tested("card-stand");
                    held.TryGetValue(key, out List<Stand> found);
                    string name = card.Names.Length > 0 ? card.Names[0] : "no name";
                    if (found == null)
                    {
                        report.Fail("card-stand", $"card {key} ({name}) has no stand");
                    }
                    else if (found.Count > 1)
                    {
                        report.Fail("card-stand", $"card {key} ({name}) has {found.Count} stands: {found[0].Name} and {found[1].Name}");
                    }
                }
                foreach (Stand stand in Stands)
                {
                    report.Tested("card-stand");
                    if (!listed.TryGetValue(stand.Oracle, out CheckedCard card))
                    {
                        report.Fail("card-stand", $"{stand.Name} holds no card of the plane's card list");
                        continue;
                    }
                    string name = card.Names.Length > 0 ? card.Names[0] : "no name";
                    report.Tested("card-set");
                    if (stand.Record.SetId != card.SetId)
                    {
                        report.Fail("card-set", $"{stand.Name} records set id {stand.Record.SetId}; the first printing of {name} is in set id {card.SetId}");
                    }
                    report.Tested("card-site");
                    (Site site, string why) = Assigned(card);
                    if (site == null)
                    {
                        report.Fail("card-site", $"{stand.Name}: {why}");
                    }
                    else if (site != stand.Site)
                    {
                        report.Fail("card-site", $"{stand.Name} holds {name}, which 5.4.3 assigns to site {site.Key} ({why})");
                    }
                }
            }

            // The rules of one site: 5.4.8 containment, the rulings, the gap bounds, invariant 11.

            public List<SiteFigures> Sites()
            {
                var figures = new List<SiteFigures>();
                var cells = new Dictionary<string, P2[]>();
                P2[] nullCell = null;
                foreach ((string name, P2[] cell) in world.Regions)
                {
                    if (name == null)
                    {
                        nullCell = nullCell ?? cell;
                    }
                    else if (!cells.ContainsKey(name))
                    {
                        cells[name] = cell;
                    }
                }
                var eras = lore == null ? new Dictionary<string, Era>() : lore.Eras.GroupBy(era => era.Id).ToDictionary(group => group.Key, group => group.Last());
                foreach (Site site in world.Sites)
                {
                    Bounds(site);
                    PadOf(site);
                    figures.Add(Gaps(site));
                    ClustersOf(site);
                    Chapters(site);
                    StandsOf(site, site.Region == null ? nullCell : cells.TryGetValue(site.Region, out P2[] cell) ? cell : null, eras);
                }
                return figures;
            }

            void Bounds(Site site)
            {
                void Held(string what, IReadOnlyList<P2> points, long less)
                {
                    long bound = site.Bounding - less;
                    for (int index = 0; index < points.Count; index++)
                    {
                        report.Tested("site-bounds");
                        BigInteger apart = Predicates.Squared(points[index], site.Centre);
                        if (bound < 0 || apart > (BigInteger)bound * bound)
                        {
                            string which = points.Count > 1 ? $" (vertex {index})" : "";
                            report.Fail("site-bounds", $"{what} of site {site.Key}{which} at {points[index]} lies {Predicates.Isqrt(apart)} mm from the site's centre; "
                                + $"its bounding radius {site.Bounding} mm less {less} mm is {bound} mm");
                            return;
                        }
                    }
                }

                Held("the blob", site.Blob, 0);
                Held("the path", site.Path, PathHalfWidth);
                Held("the pad", new[] { site.Pad }, PadRadius);
                Held("the approach point", new[] { site.Approach }, PathHalfWidth);
                Held("the stone", new[] { site.Stone }, StoneRadius);
                foreach (Chapter chapter in site.Chapters)
                {
                    if (chapter.Stone != null)
                    {
                        Held($"the chapter stone of set id {chapter.SetId}", new[] { chapter.Stone.Value }, StoneRadius);
                    }
                }
            }

            void PadOf(Site site)
            {
                report.Tested("pad-head");
                if (OnCircle(site.Path[0], site.Pad, PadRadius))
                {
                    headed.Add(site.Index);
                }
                else
                {
                    report.Fail("pad-head", $"the path of site {site.Key} begins at {site.Path[0]}, {Predicates.Isqrt(Predicates.Squared(site.Path[0], site.Pad))} mm "
                        + $"from its pad's centre {site.Pad}; a path begins on its pad's edge, {PadRadius} mm from the centre");
                }
                report.Tested("stone-place");
                if (!BesideApproach(site.Stone, site.Pad, site.Approach))
                {
                    report.Fail("stone-place", $"the stone of site {site.Key} at {site.Stone} does not stand {StoneAhead} mm from its pad's centre {site.Pad} "
                        + $"towards its approach point {site.Approach} and {StoneAcross} mm to one side");
                }
                report.Tested("approach-length");
                if (!OnCircle(site.Approach, site.Pad, ApproachLength))
                {
                    report.Fail("approach-length", $"the approach point of site {site.Key} at {site.Approach} lies {Predicates.Isqrt(Predicates.Squared(site.Approach, site.Pad))} mm "
                        + $"from its pad's centre {site.Pad}; an approach is {ApproachLength} mm long");
                }
            }

            SiteFigures Gaps(Site site)
            {
                long length = site.Arcs[site.Arcs.Length - 1];
                long[] arcs = site.Clusters.Select(cluster => cluster.Arc).ToArray();
                if (residents[site.Index].Count == 0)
                {
                    report.Tested("path-empty");
                    if (site.Path.Length != 2)
                    {
                        report.Fail("path-empty", $"site {site.Key} has no stand and its path has {site.Path.Length} vertices; the path of a site with no stand ends at its second vertex");
                    }
                }
                if (arcs.Length == 0)
                {
                    return new SiteFigures { Key = site.Key, ToFirst = length, Between = 0, ToEnd = length, PathLength = length };
                }
                report.Tested("gap-first");
                if (arcs[0] > GapToFirst)
                {
                    report.Fail("gap-first", $"the first cluster of site {site.Key} lies {arcs[0]} mm along the path from the pad, over {GapToFirst} mm");
                }
                long between = 0;
                for (int number = 1; number < arcs.Length; number++)
                {
                    long gap = arcs[number] - arcs[number - 1];
                    between = Math.Max(between, gap);
                    report.Tested("cluster-arcs");
                    if (gap <= 0)
                    {
                        report.Fail("cluster-arcs", $"cluster {number} of site {site.Key} lies at arc length {arcs[number]} mm, not past cluster {number - 1} at {arcs[number - 1]} mm");
                    }
                    report.Tested("gap-between");
                    if (gap > GapBetween)
                    {
                        report.Fail("gap-between", $"clusters {number - 1} and {number} of site {site.Key} lie {gap} mm apart along the path, over {GapBetween} mm");
                    }
                }
                long toEnd = length - arcs[arcs.Length - 1];
                report.Tested("gap-end");
                if (toEnd < 0 || toEnd > GapToEnd)
                {
                    report.Fail("gap-end", $"the path of site {site.Key} is {length} mm long and its last cluster lies at {arcs[arcs.Length - 1]} mm: "
                        + $"the tail of {toEnd} mm is not within 0 to {GapToEnd} mm");
                }
                return new SiteFigures { Key = site.Key, ToFirst = arcs[0], Between = between, ToEnd = toEnd, PathLength = length };
            }

            void ClustersOf(Site site)
            {
                List<Stand>[] held = members[site.Index];
                int total = residents[site.Index].Count;
                int last = held.Length - 1;
                for (int number = 0; number < site.Clusters.Length; number++)
                {
                    Cluster cluster = site.Clusters[number];
                    int count = held[number].Count;
                    report.Tested("cluster-count");
                    if (count == 0)
                    {
                        report.Fail("cluster-count", $"cluster {number} of site {site.Key} holds no stand");
                    }
                    else if (count != cluster.Stands)
                    {
                        report.Fail("cluster-count", $"the world file counts {cluster.Stands} stands in cluster {number} of site {site.Key} and stands.bin puts {count} there");
                    }
                    report.Tested("cluster-size");
                    if (count < MinCluster && number != last && total >= MinCluster)
                    {
                        report.Fail("cluster-size", $"cluster {number} of site {site.Key} holds {count} stands; a cluster under {MinCluster} is the site's last or does not exist");
                    }
                    report.Tested("cluster-cap");
                    if (count > CapMax)
                    {
                        report.Fail("cluster-cap", $"cluster {number} of site {site.Key} holds {count} stands; a cluster holds at most {CapMax}");
                    }
                }
            }

            static bool InsideAny(IEnumerable<Shape> discs, P2 stone)
            {
                var spot = new Box(stone.X, stone.Z, stone.X, stone.Z);
                P2 centre = Scaled(stone);
                return discs.Any(disc => !Box.Apart(disc.Box, spot, 1) && Predicates.PointInPolygon(centre, disc.Polygon));
            }

            void Chapters(Site site)
            {
                string key = site.Key;
                Chapter[] chapters = site.Chapters;
                if (site.Kind != "era")
                {
                    report.Tested("chapter-list");
                    if (chapters.Length > 0)
                    {
                        report.Fail("chapter-list", $"site {key} of kind {site.Kind} lists {chapters.Length} chapters; only an era site has chapters");
                    }
                    return;
                }
                var numberOf = new Dictionary<long, int>();
                for (int number = 0; number < chapters.Length; number++)
                {
                    Chapter chapter = chapters[number];
                    report.Tested("chapter-list");
                    if (numberOf.ContainsKey(chapter.SetId))
                    {
                        report.Fail("chapter-list", $"site {key} lists set id {chapter.SetId} twice");
                    }
                    else if (number > 0 && chapter.SetId <= chapters[number - 1].SetId)
                    {
                        report.Fail("chapter-list", $"site {key} lists the chapter of set id {chapter.SetId} after that of set id {chapters[number - 1].SetId}; chapters run in release order");
                    }
                    if (!site.SetIds.Contains(chapter.SetId))
                    {
                        report.Fail("chapter-list", $"site {key} lists a chapter of set id {chapter.SetId}, which is not a set of the site");
                    }
                    if (!numberOf.ContainsKey(chapter.SetId))
                    {
                        numberOf[chapter.SetId] = number;
                    }
                }
                List<Stand>[] held = chapters.Select(_ => new List<Stand>()).ToArray();
                foreach (Stand stand in residents[site.Index])
                {
                    report.Tested("chapter-list");
                    if (!numberOf.TryGetValue(stand.Record.SetId, out int number))
                    {
                        report.Fail("chapter-list", $"{stand.Name} records set id {stand.Record.SetId}, which site {key} lists no chapter for");
                    }
                    else
                    {
                        held[number].Add(stand);
                    }
                }
                // By cluster: the largest chapter of a cluster is at most the smallest of the next.
                (int Chapter, Stand Stand)? earlier = null;
                foreach (List<Stand> cluster in members[site.Index])
                {
                    var ranked = cluster.Where(stand => numberOf.ContainsKey(stand.Record.SetId)).Select(stand => (Chapter: numberOf[stand.Record.SetId], Stand: stand)).ToList();
                    if (ranked.Count == 0)
                    {
                        continue;
                    }
                    var lowest = ranked.OrderBy(item => item.Chapter).ThenBy(item => item.Stand.Index).First();
                    var highest = ranked.OrderByDescending(item => item.Chapter).ThenBy(item => item.Stand.Index).First();
                    if (earlier != null)
                    {
                        report.Tested("chapter-order");
                        if (earlier.Value.Chapter > lowest.Chapter)
                        {
                            report.Fail("chapter-order", $"{earlier.Value.Stand.Name} holds chapter {earlier.Value.Chapter} (set id {earlier.Value.Stand.Record.SetId}) and "
                                + $"{lowest.Stand.Name}, in a later cluster, holds chapter {lowest.Chapter} (set id {lowest.Stand.Record.SetId})");
                        }
                    }
                    earlier = highest;
                }
                Shape[] discs = clusterDiscs[site.Index];
                for (int number = 0; number < chapters.Length; number++)
                {
                    Chapter chapter = chapters[number];
                    string what = $"the chapter of set id {chapter.SetId} in site {key}";
                    report.Tested("chapter-list");
                    if (held[number].Count == 0)
                    {
                        report.Fail("chapter-list", $"{what} has no stand; an empty chapter is not listed");
                    }
                    else
                    {
                        report.Tested("chapter-first");
                        int first = held[number].Min(stand => stand.Record.Cluster);
                        if (chapter.FirstCluster != first)
                        {
                            report.Fail("chapter-first", $"{what} names cluster {chapter.FirstCluster} as its first; its stands begin in cluster {first}");
                        }
                        if (!held[number].Any(stand => stand.Index == chapter.FirstStand && stand.Record.Cluster == first))
                        {
                            report.Fail("chapter-first", $"{what} names stand {chapter.FirstStand} as its first; that is not a stand of the chapter in cluster {first}");
                        }
                    }
                    report.Tested("chapter-stone");
                    if (number == 0)
                    {
                        if (chapter.Stone != null)
                        {
                            report.Fail("chapter-stone", $"{what}, the site's first, has a chapter stone");
                        }
                        continue;
                    }
                    if (chapter.Stone == null)
                    {
                        report.Fail("chapter-stone", $"{what} has no chapter stone");
                        continue;
                    }
                    P2 stone = chapter.Stone.Value;
                    long row = FloorDiv(stone.Z, LatticeRow), offRow = stone.Z - row * LatticeRow;
                    if (offRow != 0 || Mod(stone.X - LatticeHalfPitch * row, LatticePitch) != 0)
                    {
                        report.Fail("chapter-stone", $"the stone of {what} at {stone} is not a point of the hexagonal lattice");
                    }
                    if (!InsideAny(discs, stone))
                    {
                        report.Fail("chapter-stone", $"the stone of {what} at {stone} lies inside no cluster disc of the site");
                    }
                    if (held[number].Count == 0)
                    {
                        continue;
                    }
                    report.Tested("chapter-cluster");
                    int firstCluster = held[number].Min(stand => stand.Record.Cluster);
                    var near = new[] { firstCluster - 1, firstCluster }.Where(other => other >= 0 && other < discs.Length).Select(other => discs[other]);
                    if (!InsideAny(near, stone))
                    {
                        report.Fail("chapter-cluster", $"the stone of {what} at {stone} lies inside neither the disc of cluster {firstCluster}, which holds the chapter's first stand, "
                            + "nor the disc of the cluster before it");
                    }
                }
            }

            static long FloorDiv(long a, long b) => a / b - ((a % b != 0) && ((a < 0) != (b < 0)) ? 1 : 0);
            static long Mod(long a, long b) => ((a % b) + b) % b;

            void StandsOf(Site site, P2[] cell, Dictionary<string, Era> eras)
            {
                string key = site.Key;
                report.Tested("site-region");
                if (cell == null)
                {
                    report.Fail("site-region", $"site {key} names region {site.Region ?? "None"}, which the world file lacks");
                }
                else if (world.Regions.Count(region => region.Name == site.Region) > 1)
                {
                    report.Fail("site-region", $"the world file lists region {site.Region ?? "None"} twice");
                }
                if (lore != null && site.Kind == "era")
                {
                    Era era = site.Era == null ? null : eras.TryGetValue(site.Era, out Era found) ? found : null;
                    if (era == null)
                    {
                        report.Fail("site-region", $"site {key} names era {site.Era ?? "None"}, which the lore lacks");
                    }
                    else if (era.Region != site.Region)
                    {
                        report.Fail("site-region", $"site {key} stands in region {site.Region}; its era {era.Id} is of region {era.Region}");
                    }
                }
                P2[] blob = blobs[site.Index];
                Shape[] discs = clusterDiscs[site.Index];
                foreach (Stand stand in residents[site.Index])
                {
                    int index = stand.Index;
                    if (stand.Vertex >= 0)
                    {
                        report.Tested("corridor-end");
                        long? arc = index < world.Arc.Length ? world.Arc[index] : (long?)null;
                        if (arc != site.Arcs[stand.Vertex])
                        {
                            report.Fail("corridor-end", $"the corridor of {stand.Name} ends on vertex {stand.Vertex} of its site's path, at arc length {site.Arcs[stand.Vertex]} mm; "
                                + $"the world file gives {arc?.ToString() ?? "None"} mm");
                        }
                        if (arc != null && stand.Cluster >= 0)
                        {
                            report.Tested("corridor-window");
                            long slot = site.Clusters[stand.Cluster].Arc;
                            if (arc.Value - slot < -CorridorArcWindow || arc.Value - slot > CorridorArcWindow)
                            {
                                report.Fail("corridor-window", $"the corridor of {stand.Name} ends at arc length {arc} mm and its cluster's slot lies at {slot} mm, over {CorridorArcWindow} mm away");
                            }
                        }
                        report.Tested("stand-yaw");
                        P2 target = site.Path[stand.Vertex];
                        if (!Faces(stand.Record.Yaw, stand.Centre, target, table))
                        {
                            report.Fail("stand-yaw", $"{stand.Name} at {stand.Centre} has the yaw {stand.Record.Yaw} and does not face its path vertex {stand.Vertex} at {target} "
                                + $"within {FacingCounts * MicroPerCount} micro-degrees");
                        }
                    }
                    report.Tested("footprint-blob");
                    if (!Predicates.PolygonInsidePolygon(stand.Footprint, blob))
                    {
                        report.Fail("footprint-blob", $"the footprint of {stand.Name} does not lie inside the blob of site {key}");
                    }
                    if (stand.Cluster >= 0)
                    {
                        report.Tested("footprint-cluster");
                        Shape disc = discs[stand.Cluster];
                        if (Box.Apart(stand.FootBox, disc.Box, 1) || !Predicates.PolygonInsidePolygon(stand.Footprint, disc.Polygon))
                        {
                            report.Fail("footprint-cluster", $"the footprint of {stand.Name} does not lie inside the disc of its cluster, centred at {site.Clusters[stand.Cluster].Centre}");
                        }
                    }
                    if (cell != null)
                    {
                        report.Tested("stand-region");
                        if (!Predicates.PointInPolygon(stand.Centre, cell))
                        {
                            report.Fail("stand-region", $"{stand.Name} at {stand.Centre} does not stand inside the cell of region {site.Region ?? "None"}");
                        }
                    }
                }
            }

            // Invariant 9: the exclusions by geometry type.

            public void StandsAgainstStands()
            {
                BigInteger least = (BigInteger)MinStandSpacing * MinStandSpacing;
                foreach (Stand stand in Stands)
                {
                    long x = stand.Centre.X, z = stand.Centre.Z;
                    Box box = stand.Box;
                    var reach = new Box(Math.Min(box.MinX, x - MinStandSpacing), Math.Min(box.MinZ, z - MinStandSpacing), Math.Max(box.MaxX, x + MinStandSpacing), Math.Max(box.MaxZ, z + MinStandSpacing));
                    foreach (int number in standGrid.Near(reach))
                    {
                        if (number <= stand.Index)
                        {
                            continue;
                        }
                        Stand other = Stands[number];
                        long dx = other.Centre.X - x, dz = other.Centre.Z - z;
                        if (-MinStandSpacing < dx && dx < MinStandSpacing && -MinStandSpacing < dz && dz < MinStandSpacing)
                        {
                            report.Tested("stand-spacing");
                            BigInteger apart = (BigInteger)dx * dx + (BigInteger)dz * dz;
                            if (apart < least)
                            {
                                report.Fail("stand-spacing", $"{stand.Name} and {other.Name} stand {Predicates.Isqrt(apart)} mm apart, under {MinStandSpacing} mm");
                            }
                        }
                        if (Box.Apart(box, other.Box, 1))
                        {
                            continue;
                        }
                        foreach ((string part, P2[] polygon, Box partBox) in stand.Parts)
                        {
                            foreach ((string otherPart, P2[] otherPolygon, Box otherBox) in other.Parts)
                            {
                                if (Box.Apart(partBox, otherBox, 1))
                                {
                                    continue;
                                }
                                string rule = part == otherPart ? $"{part}-{part}" : "footprint-apron";
                                report.Tested(rule);
                                if (Predicates.PolygonsIntersect(polygon, otherPolygon))
                                {
                                    report.Fail(rule, $"the {part} of {stand.Name} intersects the {otherPart} of {other.Name}");
                                }
                            }
                        }
                    }
                }
            }

            public void StandsAgainstStrips()
            {
                BigInteger limit = ScaledSquare(PathHalfWidth);
                foreach (Stand stand in Stands)
                {
                    var parts = stand.Parts;
                    var met = new HashSet<(string, int)>();
                    foreach (int number in stripGrid.Near(stand.Box.Grown(PathHalfWidth)))
                    {
                        Segment segment = segments[number];
                        foreach ((string part, P2[] polygon, Box box) in parts)
                        {
                            if (met.Contains((part, segment.Strip)) || Box.Apart(box, segment.Box, PathHalfWidth))
                            {
                                continue;
                            }
                            string rule = $"{part}-path";
                            report.Tested(rule);
                            if (Predicates.SegmentNearer(segment.A, segment.B, polygon, limit))
                            {
                                met.Add((part, segment.Strip));
                                report.Fail(rule, $"the {part} of {stand.Name} intersects {strips[segment.Strip]} at segment {segment.Index}");
                            }
                        }
                    }
                }
            }

            public void CorridorsAgainstStands()
            {
                BigInteger limit = ScaledSquare(CorridorHalfWidth);
                foreach (Stand stand in Stands)
                {
                    if (stand.End == null || stand.CorridorBox == null)
                    {
                        continue;
                    }
                    Box box = stand.CorridorBox.Value;
                    foreach (int number in standGrid.Near(box.Grown(CorridorHalfWidth)))
                    {
                        if (number == stand.Index)
                        {
                            continue;
                        }
                        Stand other = Stands[number];
                        foreach ((string part, P2[] polygon, Box partBox) in other.Parts)
                        {
                            if (Box.Apart(partBox, box, CorridorHalfWidth))
                            {
                                continue;
                            }
                            string rule = $"{part}-corridor";
                            report.Tested(rule);
                            if (Predicates.SegmentNearer(stand.Front, stand.End.Value, polygon, limit))
                            {
                                report.Fail(rule, $"the {part} of {other.Name} intersects the corridor of {stand.Name}");
                            }
                        }
                    }
                }
            }

            // A pad, a stone, the plaza or a hero volume against every footprint and apron.
            void AgainstStands(string kind, Shape shape)
            {
                foreach (int number in standGrid.Near(shape.Box))
                {
                    Stand stand = Stands[number];
                    foreach ((string part, P2[] polygon, Box box) in stand.Parts)
                    {
                        if (Box.Apart(box, shape.Box, 1))
                        {
                            continue;
                        }
                        string rule = $"{part}-{kind}";
                        report.Tested(rule);
                        if (Predicates.PolygonsIntersect(polygon, shape.Polygon))
                        {
                            report.Fail(rule, $"the {part} of {stand.Name} intersects {shape.Label}");
                        }
                    }
                }
            }

            // A stone, the plaza or a hero volume against every corridor.
            void AgainstCorridors(string kind, Shape shape)
            {
                string rule = $"corridor-{kind}";
                BigInteger limit = ScaledSquare(CorridorHalfWidth);
                foreach (int number in corridorGrid.Near(shape.Box.Grown(CorridorHalfWidth)))
                {
                    Stand stand = Stands[number];
                    if (stand.End == null || stand.CorridorBox == null || Box.Apart(stand.CorridorBox.Value, shape.Box, CorridorHalfWidth))
                    {
                        continue;
                    }
                    report.Tested(rule);
                    if (Predicates.SegmentNearer(stand.Front, stand.End.Value, shape.Polygon, limit))
                    {
                        report.Fail(rule, $"the corridor of {stand.Name} intersects {shape.Label}");
                    }
                }
            }

            // A stone or a hero volume against every path, approach and leg.
            void AgainstStrips(string rule, Shape shape)
            {
                BigInteger limit = ScaledSquare(PathHalfWidth);
                var met = new HashSet<int>();
                foreach (int number in stripGrid.Near(shape.Box.Grown(PathHalfWidth)))
                {
                    Segment segment = segments[number];
                    if (met.Contains(segment.Strip) || Box.Apart(segment.Box, shape.Box, PathHalfWidth))
                    {
                        continue;
                    }
                    report.Tested(rule);
                    if (Predicates.SegmentNearer(segment.A, segment.B, shape.Polygon, limit))
                    {
                        met.Add(segment.Strip);
                        report.Fail(rule, $"{shape.Label} intersects {strips[segment.Strip]} at segment {segment.Index}");
                    }
                }
            }

            // Every pair of two lists of shapes, or every pair within one list.
            void Pairs(string rule, IReadOnlyList<Shape> first, IReadOnlyList<Shape> second)
            {
                for (int position = 0; position < first.Count; position++)
                {
                    Shape shape = first[position];
                    IEnumerable<Shape> others = second ?? first.Skip(position + 1);
                    foreach (Shape other in others)
                    {
                        if (Box.Apart(shape.Box, other.Box, 1))
                        {
                            continue;
                        }
                        report.Tested(rule);
                        if (Predicates.PolygonsIntersect(shape.Polygon, other.Polygon))
                        {
                            report.Fail(rule, $"{shape.Label} intersects {other.Label}");
                        }
                    }
                }
            }

            public void PadsStonesPlazaVolumes()
            {
                Shape plaza = Disc("the plaza", new P2(0, 0), PlazaRadius);
                Shape edged = Disc("the plaza with its edge path", new P2(0, 0), PlazaEdgeRadius);
                foreach (Shape pad in pads)
                {
                    AgainstStands("pad", pad);
                }
                Pairs("pad-pad", pads, null);
                foreach (Shape stone in stones)
                {
                    AgainstStands("stone", stone);
                    AgainstCorridors("stone", stone);
                    AgainstStrips("stone-path", stone);
                }
                Pairs("stone-pad", stones, pads);
                Pairs("stone-stone", stones, null);
                Pairs("stone-plaza", stones, new[] { edged });
                AgainstStands("plaza", edged);
                AgainstCorridors("plaza", plaza);
                Shape[] bounds = world.Sites.Select(site => Disc($"the bounding disc of site {site.Key}", site.Centre, site.Bounding)).ToArray();
                foreach (Shape volume in volumes)
                {
                    report.Tested("volume-arrival");
                    if (Predicates.PointInPolygon(new P2(0, 0), volume.Polygon))
                    {
                        report.Fail("volume-arrival", $"{volume.Label} holds the arrival point");
                    }
                    AgainstStands("volume", volume);
                    AgainstCorridors("volume", volume);
                    AgainstStrips("volume-path", volume);
                }
                Pairs("pad-volume", pads, volumes);
                Pairs("stone-volume", stones, volumes);
                Pairs("volume-site", volumes, bounds);
            }

            // Invariant 10: the path network.

            static (string, long, long) At(P2 point) => ("point", point.X, point.Z);

            static bool SameSegment(IReadOnlyList<P2> attachment, P2 a, P2 b) => attachment.Count == 2 && attachment[0].Equals(a) && attachment[1].Equals(b);

            public void Network()
            {
                var sets = new Sets();
                var plaza = ("plaza", 0L, 0L);
                P2[] approach = world.PlazaApproach;
                if (world.Sites.Length > 0 || approach != null)
                {
                    report.Tested("plaza-approach");
                    if (approach == null)
                    {
                        report.Fail("plaza-approach", "the world has sites and no plaza approach");
                    }
                    else
                    {
                        sets.Join(At(approach[0]), At(approach[1]));
                        if (OnCircle(approach[0], new P2(0, 0), PlazaEdgeRadius))
                        {
                            sets.Join(plaza, At(approach[0]));
                        }
                        else
                        {
                            report.Fail("plaza-approach", $"the plaza approach starts at {approach[0]}, {Predicates.Isqrt(Predicates.Squared(approach[0], new P2(0, 0)))} mm from the origin; "
                                + $"the edge path's outer circle has radius {PlazaEdgeRadius} mm");
                        }
                    }
                }
                P2? before = approach?[1];
                string beforeName = "the far end of the plaza approach", beforeKey = "plaza";
                var seen = new HashSet<P2>();
                // The sites each kind of leg visits, in site order (invariant 10).
                var visits = new Dictionary<string, List<Site>>
                {
                    ["trail"] = world.Sites.Where(site => site.Kind == "era" || site.Kind == "set").ToList(),
                    ["spur"] = world.Sites.Where(site => site.Kind == "region").ToList(),
                };
                var visited = new Dictionary<string, int> { ["trail"] = 0, ["spur"] = 0 };
                foreach (Leg leg in world.Legs)
                {
                    string name = $"leg {leg.Id} ({leg.Kind}, {leg.Start} to {leg.End})";
                    P2 first = leg.Polyline[0], last = leg.Polyline[leg.Polyline.Length - 1];
                    foreach ((P2 a, P2 b) in Predicates.Segments(leg.Polyline))
                    {
                        sets.Join(At(a), At(b));
                    }
                    sitesByKey.TryGetValue(leg.End, out Site site);
                    if (visits.TryGetValue(leg.Kind, out List<Site> targets))
                    {
                        report.Tested("trail-order");
                        int order = visited[leg.Kind];
                        visited[leg.Kind] = order + 1;
                        if (order >= targets.Count)
                        {
                            report.Fail("trail-order", $"{name} is {leg.Kind} {order + 1}, and the world has {targets.Count} sites for its {leg.Kind}s to visit");
                        }
                        else if (leg.End != targets[order].Key)
                        {
                            report.Fail("trail-order", $"{name} ends at {leg.End}; {leg.Kind} {order + 1} visits {targets[order].Key}, the next such site in site order");
                        }
                    }
                    if (leg.Kind == "trail")
                    {
                        report.Tested("trail-leg");
                        if (leg.Start != beforeKey)
                        {
                            report.Fail("trail-leg", $"{name} is said to start from {leg.Start}, not {beforeKey}");
                        }
                        if (before == null || !first.Equals(before.Value))
                        {
                            report.Fail("trail-leg", $"{name} starts at {first}, not at {beforeName} {before?.ToString() ?? "None"}");
                        }
                        if (site == null)
                        {
                            report.Fail("trail-leg", $"{name} ends at a site the world file lacks");
                        }
                        else
                        {
                            if (!last.Equals(site.Approach))
                            {
                                report.Fail("trail-leg", $"{name} ends at {last}, not at the approach point {site.Approach} of site {site.Key}");
                            }
                            before = site.Approach;
                            beforeName = $"the approach point of site {site.Key}";
                            beforeKey = site.Key;
                        }
                    }
                    else if (leg.Kind == "spur")
                    {
                        report.Tested("spur");
                        if (!seen.Contains(first))
                        {
                            report.Fail("spur", $"{name} starts at {first}, a vertex of no earlier leg");
                        }
                        if (site == null)
                        {
                            report.Fail("spur", $"{name} ends at a site the world file lacks");
                        }
                        else if (!last.Equals(site.Approach))
                        {
                            report.Fail("spur", $"{name} ends at {last}, not at the approach point {site.Approach} of site {site.Key}");
                        }
                    }
                    else
                    {
                        report.Tested("trail-leg");
                        report.Fail("trail-leg", $"{name} is neither a trail leg nor a spur");
                    }
                    report.Tested("leg-attachment", 2);
                    // An attachment segment is the polyline's first or last segment, or has no length
                    // at the leg's end.
                    P2[] line = leg.Polyline;
                    bool startHeld = leg.StartAttachment.SequenceEqual(line.Take(2)) || SameSegment(leg.StartAttachment, first, first);
                    bool endHeld = leg.EndAttachment.SequenceEqual(line.Skip(Math.Max(0, line.Length - 2))) || SameSegment(leg.EndAttachment, last, last);
                    if (!startHeld)
                    {
                        report.Fail("leg-attachment", $"the start attachment of {name}, [{string.Join(", ", leg.StartAttachment)}], is not the polyline's first segment");
                    }
                    if (!endHeld)
                    {
                        report.Fail("leg-attachment", $"the end attachment of {name}, [{string.Join(", ", leg.EndAttachment)}], is not the polyline's last segment");
                    }
                    seen.UnionWith(leg.Polyline);
                }
                report.Tested("trail-order");
                foreach ((string kind, string what) in new[] { ("trail", "era or set sites"), ("spur", "regional sites") })
                {
                    if (visited[kind] < visits[kind].Count)
                    {
                        report.Fail("trail-order", $"the trail's {kind}s visit {visited[kind]} of the world's {visits[kind].Count} {what}; the first not visited is {visits[kind][visited[kind]].Key}");
                    }
                }
                bool reached = true;
                foreach (Site site in world.Sites)
                {
                    var pad = ("pad", (long)site.Index, 0L);
                    var head = ("head", (long)site.Index, 0L);
                    sets.Join(At(site.Approach), pad);
                    if (headed.Contains(site.Index))
                    {
                        sets.Join(pad, head);
                    }
                    report.Tested("site-reached");
                    if (!sets.Find(At(site.Approach)).Equals(sets.Find(plaza)))
                    {
                        reached = false;
                        report.Fail("site-reached", $"no leg joins the approach point {site.Approach} of site {site.Key} to the plaza's edge path");
                    }
                    else if (!sets.Find(head).Equals(sets.Find(plaza)))
                    {
                        reached = false;
                        report.Fail("site-reached", $"the path of site {site.Key} does not begin at its pad, so the trail does not reach it");
                    }
                }
                Connected = reached && Stands.All(stand => stand.End != null);
            }
        }

        // The predicate fixtures of 5.4.14: what a fixture states that these predicates find
        // otherwise. A fixture is one object: `predicate` names the rule; `polyline`, `halfWidth`
        // and `polygon` (a strip in a polygon) or `outer` and `inner` (two polygons) are the shapes,
        // in whole millimetres; `verticesInside` and `edgeCrossings` (the pairs of edges that share
        // a point, touching included) are the two facts that make it a trap; `expected` is the
        // predicate's verdict. The list is empty when all three hold.
        public const string StripInsidePolygonName = "strip-inside-polygon", PolygonsIntersectName = "polygons-intersect", PolygonInsidePolygonName = "polygon-inside-polygon";

        static int Crossings(List<(P2 a, P2 b)> first, List<(P2 a, P2 b)> second)
        {
            int count = 0;
            foreach ((P2 a, P2 b) in first)
            {
                foreach ((P2 c, P2 d) in second)
                {
                    if (Predicates.SegmentsIntersect(a, b, c, d))
                    {
                        count++;
                    }
                }
            }
            return count;
        }

        public static List<string> CheckPredicates(object value)
        {
            string predicate;
            bool inside, verdict;
            int crossings;
            object statedInside, statedCrossings, statedExpected;
            try
            {
                Dictionary<string, object> document = ObjectOf(value);
                predicate = Text(document["predicate"]);
                if (predicate == StripInsidePolygonName)
                {
                    P2[] polyline = Points(document["polyline"], 1, "the polyline");
                    P2[] polygon = Points(document["polygon"], 3, "the polygon");
                    inside = polyline.All(point => Predicates.PointInPolygon(point, polygon));
                    crossings = Crossings(Predicates.Segments(polyline), Predicates.Edges(polygon));
                    verdict = Predicates.StripInsidePolygon(polyline, Whole(document["halfWidth"]), polygon);
                }
                else if (predicate == PolygonsIntersectName || predicate == PolygonInsidePolygonName)
                {
                    P2[] outer = Points(document["outer"], 3, "the outer polygon");
                    P2[] inner = Points(document["inner"], 3, "the inner polygon");
                    inside = inner.All(point => Predicates.PointInPolygon(point, outer));
                    crossings = Crossings(Predicates.Edges(outer), Predicates.Edges(inner));
                    verdict = predicate == PolygonsIntersectName ? Predicates.PolygonsIntersect(outer, inner) : Predicates.PolygonInsidePolygon(inner, outer);
                }
                else
                {
                    return new List<string> { $"the predicate '{predicate}' is not one this checker has" };
                }
                statedInside = document["verticesInside"];
                statedCrossings = document["edgeCrossings"];
                statedExpected = document["expected"];
            }
            catch (Exception error) when (error is KeyNotFoundException || error is InvalidCastException || error is InvalidDataException || error is NullReferenceException)
            {
                return new List<string> { $"the fixture is not in the form of a predicate fixture: {error.Message}" };
            }
            var found = new List<string>();
            if (!(statedInside is bool si) || si != inside)
            {
                found.Add($"verticesInside is stated {statedInside ?? "null"} and is {inside}");
            }
            // An integer token, or a whole double as before (erratum 8).
            if (!(statedCrossings is long sc ? sc == crossings : statedCrossings is double dc && dc == crossings))
            {
                found.Add($"edgeCrossings is stated {statedCrossings ?? "null"} and is {crossings}");
            }
            if (!(statedExpected is bool se) || se != verdict)
            {
                found.Add($"{predicate} is expected {statedExpected ?? "null"} and is {verdict}");
            }
            return found;
        }
    }
}
