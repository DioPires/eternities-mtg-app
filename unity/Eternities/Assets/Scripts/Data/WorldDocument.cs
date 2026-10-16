using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Layout;

namespace Eternities.Data
{
    // A pose of the pack: a position in millimetres and a yaw in micro-degrees, counter-clockwise
    // from +x (docs/data-contract-v4.md section 2).
    public readonly struct Pose
    {
        public readonly long X, Z, Yaw;

        public Pose(long x, long z, long yaw)
        {
            X = x;
            Z = z;
            Yaw = yaw;
        }

        public P2 Position => new P2(X, Z);
    }

    public sealed class WorldPad
    {
        public string Owner;    // `return` or a site key
        public P2 Centre;
        public long Radius;
    }

    public sealed class WorldVolume
    {
        public string Id;
        public P2[] Polygon;
    }

    public sealed class WorldRegion
    {
        public string Id, Name, Kit, Variant, Water;    // all null in a kit world's one region
        public P2[] Cell;
        public int? FirstSite;
    }

    public sealed class SiteCluster
    {
        public P2 Centre;
        public long Arc;        // the slot's arc length along the site's path
        public int Stands;
    }

    public sealed class SiteChapter
    {
        public int SetId, FirstStand, FirstCluster;
        public Pose? Stone;     // null for a site's first chapter
        public Pose Destination;
    }

    public sealed class WorldSite
    {
        public string Key, Kind;            // `era:<id>`, `region:<id>` or `set:<code>`; era, region or set
        public string RegionId, EraId;
        public int[] SetIds;
        public P2 Centre;
        public long Radius, BoundingRadius;
        public P2[] Blob, Path;
        public long[] PathArcs;             // the integer arc length to each path vertex (5.4.18 (5))
        public Pose Pad;
        public P2 ApproachPoint;
        public string StoneKind;            // reading, way or marker (5.4.16)
        public Pose Stone;
        public SiteCluster[] Clusters;
        public SiteChapter[] Chapters;
    }

    public sealed class TrailLeg
    {
        public int Id;
        public string Kind, From, To;       // trail or spur; plaza, a site key or trail; a site key
        public P2[] Polyline, StartAttachment, EndAttachment;
        public long Length;                 // the polyline's integer arc length
    }

    public sealed class TrailJunction
    {
        public P2 Point;
        public string Owner;
        public int[] Legs;
    }

    // `worlds/<slug>.json` of contract v4 (PRD v4 4.13.5, docs/data-contract-v4.md section 4): one
    // world's geometry in integer millimetres, read into typed rows. A document that is not in the
    // emitted form throws an InvalidDataException naming the key.
    public sealed class WorldDocument
    {
        public int ContractVersion;
        public string Slug, DataHash, Law;
        public int PlaneIndex, StandCount;
        public long Radius;
        public Pose Arrival, ReturnPortal;
        public long PlazaRadius, PlazaEdgeRadius;
        public P2[] PlazaApproach;          // its two ends, or null for a world with no site
        public WorldPad[] Pads;
        public WorldVolume[] HeroVolumes;
        public WorldRegion[] Regions;
        public WorldSite[] Sites;
        public TrailLeg[] Legs;
        public TrailJunction[] Junctions;
        public int[] StandVertex;           // by stand index: the corridor's vertex on its site's path
        public long[] StandArc;             // by stand index: that vertex's arc length

        public bool Hero => Law == "hero";

        public static WorldDocument Parse(string text) => Read(Json.Parse(text));

        public static WorldDocument Read(object value)
        {
            Dictionary<string, object> world = Json.Object(value);
            Dictionary<string, object> plaza = Json.Object(Member(world, "plaza"));
            object approach = Member(plaza, "approach");
            Dictionary<string, object> stands = Json.Object(Member(world, "stands"));
            Dictionary<string, object> trail = Json.Object(Member(world, "trail"));
            var document = new WorldDocument
            {
                ContractVersion = Json.Int(Member(world, "contractVersion")),
                Slug = Json.Text(Member(world, "slug")),
                DataHash = Json.Text(Member(world, "dataHash")),
                Law = Json.Text(Member(world, "law")),
                PlaneIndex = Json.Int(Member(world, "planeIndex")),
                StandCount = Json.Int(Member(world, "standCount")),
                Radius = Json.Long(Member(world, "radius")),
                Arrival = PoseOf(Member(world, "arrival")),
                ReturnPortal = PoseOf(Member(world, "returnPortal")),
                PlazaRadius = Json.Long(Member(plaza, "radius")),
                PlazaEdgeRadius = Json.Long(Member(plaza, "edgeRadius")),
                PlazaApproach = approach == null ? null : Points(approach),
                Pads = Json.Array(Member(world, "pads")).Select(Json.Object).Select(row => new WorldPad
                {
                    Owner = Json.Text(Member(row, "owner")), Centre = new P2(Json.Long(Member(row, "x")), Json.Long(Member(row, "z"))), Radius = Json.Long(Member(row, "radius")),
                }).ToArray(),
                HeroVolumes = Json.Array(Member(world, "heroVolumes")).Select(Json.Object).Select(row => new WorldVolume
                {
                    Id = Json.Text(Member(row, "id")), Polygon = Points(Member(row, "polygon")),
                }).ToArray(),
                Regions = Json.Array(Member(world, "regions")).Select(Json.Object).Select(row => new WorldRegion
                {
                    Id = TextOrNull(Member(row, "id")), Name = TextOrNull(Member(row, "name")), Kit = TextOrNull(Member(row, "kit")),
                    Variant = TextOrNull(Member(row, "variant")), Water = TextOrNull(Member(row, "water")), Cell = Points(Member(row, "cell")),
                    FirstSite = Member(row, "firstSite") == null ? (int?)null : Json.Int(row["firstSite"]),
                }).ToArray(),
                Sites = Json.Array(Member(world, "sites")).Select(Json.Object).Select(ReadSite).ToArray(),
                Legs = Json.Array(Member(trail, "legs")).Select(Json.Object).Select(row =>
                {
                    P2[] polyline = Points(Member(row, "polyline"));
                    long[] arcs = Predicates.ArcLengths(polyline);
                    return new TrailLeg
                    {
                        Id = Json.Int(Member(row, "id")), Kind = Json.Text(Member(row, "kind")), From = Json.Text(Member(row, "from")), To = Json.Text(Member(row, "to")),
                        Polyline = polyline, StartAttachment = Points(Member(row, "startAttachment")), EndAttachment = Points(Member(row, "endAttachment")),
                        Length = arcs.Length == 0 ? 0 : arcs[arcs.Length - 1],
                    };
                }).ToArray(),
                Junctions = Json.Array(Member(trail, "junctions")).Select(Json.Object).Select(row => new TrailJunction
                {
                    Point = Point(Member(row, "point")), Owner = TextOrNull(Member(row, "owner")), Legs = Json.Array(Member(row, "legs")).Select(Json.Int).ToArray(),
                }).ToArray(),
                StandVertex = Json.Array(Member(stands, "vertex")).Select(Json.Int).ToArray(),
                StandArc = Json.Array(Member(stands, "arc")).Select(Json.Long).ToArray(),
            };
            if (document.ContractVersion != 4)
            {
                throw new InvalidDataException($"worlds/{document.Slug}.json is of contract version {document.ContractVersion}, not 4");
            }
            return document;
        }

        static WorldSite ReadSite(Dictionary<string, object> row)
        {
            P2[] path = Points(Member(row, "path"));
            Dictionary<string, object> stone = Json.Object(Member(row, "stone"));
            return new WorldSite
            {
                Key = Json.Text(Member(row, "key")),
                Kind = Json.Text(Member(row, "kind")),
                RegionId = TextOrNull(Member(row, "regionId")),
                EraId = TextOrNull(Member(row, "eraId")),
                SetIds = Json.Array(Member(row, "setIds")).Select(Json.Int).ToArray(),
                Centre = Point(Member(row, "centre")),
                Radius = Json.Long(Member(row, "radius")),
                BoundingRadius = Json.Long(Member(row, "boundingRadius")),
                Blob = Points(Member(row, "blob")),
                Path = path,
                PathArcs = Predicates.ArcLengths(path),
                Pad = PoseOf(Member(row, "pad")),
                ApproachPoint = Point(Member(row, "approachPoint")),
                StoneKind = Json.Text(Member(stone, "kind")),
                Stone = PoseOf(stone),
                Clusters = Json.Array(Member(row, "clusters")).Select(Json.Object).Select(item => new SiteCluster
                {
                    Centre = Point(Member(item, "centre")), Arc = Json.Long(Member(item, "arc")), Stands = Json.Int(Member(item, "stands")),
                }).ToArray(),
                Chapters = Json.Array(Member(row, "chapters")).Select(Json.Object).Select(item => new SiteChapter
                {
                    SetId = Json.Int(Member(item, "setId")), FirstStand = Json.Int(Member(item, "firstStand")), FirstCluster = Json.Int(Member(item, "firstCluster")),
                    Stone = Member(item, "stone") == null ? (Pose?)null : PoseOf(item["stone"]), Destination = PoseOf(Member(item, "destination")),
                }).ToArray(),
            };
        }

        internal static object Member(Dictionary<string, object> row, string key)
        {
            if (!row.TryGetValue(key, out object value))
            {
                throw new InvalidDataException($"a world document's object has no `{key}`");
            }
            return value;
        }

        static string TextOrNull(object value) => value == null ? null : Json.Text(value);

        public static P2 Point(object value)
        {
            List<object> pair = Json.Array(value);
            if (pair.Count != 2)
            {
                throw new InvalidDataException($"a point holds {pair.Count} numbers, not 2");
            }
            return new P2(Json.Long(pair[0]), Json.Long(pair[1]));
        }

        static P2[] Points(object value) => Json.Array(value).Select(Point).ToArray();

        static Pose PoseOf(object value)
        {
            Dictionary<string, object> pose = Json.Object(value);
            return new Pose(Json.Long(Member(pose, "x")), Json.Long(Member(pose, "z")), Json.Long(Member(pose, "yaw")));
        }
    }

    public sealed class LoreSentence
    {
        public string Text, Source;
    }

    public sealed class LoreRegion
    {
        public string Id, Name;
        public LoreSentence Sentence;
        public string[] Sources;
    }

    public sealed class LoreEra
    {
        public string Id, Name, Years, Region;
        public string[] Sets;
        public int[] SetIds;
        public LoreSentence[][] Paragraphs;
        public string[] Sources;
        public int[] Headline;      // stand indices (5.13.2)
    }

    // `lore/<slug>.json` of contract v4 (PRD v4 4.16.3, docs/data-contract-v4.md section 5): a hero
    // world's resolved lore tables.
    public sealed class LoreDocument
    {
        public int ContractVersion;
        public string Slug, Kind, Digest;
        public LoreRegion[] Regions;
        public LoreEra[] Eras;
        public Keywords.Row[] Keywords;

        public static LoreDocument Parse(string text) => Read(Json.Parse(text));

        public static LoreDocument Read(object value)
        {
            Dictionary<string, object> lore = Json.Object(value);
            LoreSentence Sentence(object item) => new LoreSentence
            {
                Text = Json.Text(WorldDocument.Member(Json.Object(item), "text")), Source = Json.Text(WorldDocument.Member(Json.Object(item), "source")),
            };
            string[] Texts(object item) => Json.Array(item).Select(Json.Text).ToArray();
            var document = new LoreDocument
            {
                ContractVersion = Json.Int(WorldDocument.Member(lore, "contractVersion")),
                Slug = Json.Text(WorldDocument.Member(lore, "slug")),
                Kind = Json.Text(WorldDocument.Member(lore, "kind")),
                Digest = Json.Text(WorldDocument.Member(lore, "digest")),
                Regions = Json.Array(WorldDocument.Member(lore, "regions")).Select(Json.Object).Select(row => new LoreRegion
                {
                    Id = Json.Text(WorldDocument.Member(row, "id")), Name = Json.Text(WorldDocument.Member(row, "name")),
                    Sentence = Sentence(WorldDocument.Member(row, "sentence")), Sources = Texts(WorldDocument.Member(row, "sources")),
                }).ToArray(),
                Eras = Json.Array(WorldDocument.Member(lore, "eras")).Select(Json.Object).Select(row => new LoreEra
                {
                    Id = Json.Text(WorldDocument.Member(row, "id")), Name = Json.Text(WorldDocument.Member(row, "name")), Years = Json.Text(WorldDocument.Member(row, "years")),
                    Region = Json.Text(WorldDocument.Member(row, "region")), Sets = Texts(WorldDocument.Member(row, "sets")),
                    SetIds = Json.Array(WorldDocument.Member(row, "setIds")).Select(Json.Int).ToArray(),
                    Paragraphs = Json.Array(WorldDocument.Member(row, "paragraphs")).Select(paragraph => Json.Array(paragraph).Select(Sentence).ToArray()).ToArray(),
                    Sources = Texts(WorldDocument.Member(row, "sources")),
                    Headline = Json.Array(WorldDocument.Member(row, "headline")).Select(Json.Int).ToArray(),
                }).ToArray(),
                Keywords = Json.Array(WorldDocument.Member(lore, "keywords")).Select(Json.Object)
                    .Select(row => new Keywords.Row(Json.Text(WorldDocument.Member(row, "word")), Json.Text(WorldDocument.Member(row, "region")))).ToArray(),
            };
            if (document.ContractVersion != 4)
            {
                throw new InvalidDataException($"lore/{document.Slug}.json is of contract version {document.ContractVersion}, not 4");
            }
            return document;
        }
    }
}
