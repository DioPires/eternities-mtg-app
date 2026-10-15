using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Layout;

namespace Eternities.Data
{
    // What a world reads at run time and git does not hold, under `StreamingAssets/data/<hash>/`:
    // the part of the v3 pack the slice uses and the world's three files of contract v4
    // (`stands.bin`, `worlds/<slug>.json`, `lore/<slug>.json`). The generation entry point writes
    // them (PRD v4 8.2.5), and so do the tests and the bench before they load a world.
    public static class WorldFiles
    {
        public sealed class Result
        {
            public string Slug, Report;
            public int Stands, Sites;
        }

        public static string StandsPath(string packDirectory) => Path.Combine(packDirectory, "stands.bin");
        public static string WorldPath(string packDirectory, string slug) => Path.Combine(packDirectory, "worlds", slug + ".json");
        public static string LorePath(string packDirectory, string slug) => Path.Combine(packDirectory, "lore", slug + ".json");

        // The world's committed fixture beside the repository's pack: a pack is
        // `<repository>/web/public/data/<hash>/`, and the fixture of a world laid out from it is
        // `<repository>/contract/test-vectors/v4/layout/<slug>/` (PRD v4 5.4.14).
        public static string FixtureOf(string repositoryPack, string slug) =>
            Path.GetFullPath(Path.Combine(repositoryPack, "..", "..", "..", "..", "contract", "test-vectors", "v4", "layout", slug));

        // Copies the plane's files from the pack at `source` to `target`, each checked against the
        // pack's manifest, then the world's three files from its committed fixture. The pipeline
        // lays a world out (PRD v4 5.4, 8.3.3) and its fixture is the committed copy of its output,
        // so the generation entry point needs no Python, and the engine reads positions and
        // computes none. The copy is decoded once with the assertions of 4.13.3 before this
        // returns, so a fixture of another pack, or a broken one, fails here.
        public static Result Generate(string source, string target, string slug)
        {
            string fixture = FixtureOf(source, slug);
            var pack = new Pack(source);
            PackPlane plane = pack.Plane(slug);
            Directory.CreateDirectory(Path.Combine(target, "planes"));
            File.Copy(Path.Combine(source, "manifest.json"), Path.Combine(target, "manifest.json"), overwrite: true);
            foreach (string file in Pack.FilesOf(plane))
            {
                File.WriteAllBytes(Path.Combine(target, file), pack.Read(file));
            }
            // The first slice's allocator wrote `layout/<slug>.txt` here; nothing reads it now.
            string retired = Path.Combine(target, "layout");
            if (Directory.Exists(retired))
            {
                Directory.Delete(retired, recursive: true);
            }
            Directory.CreateDirectory(Path.Combine(target, "worlds"));
            File.Copy(StandsPath(fixture), StandsPath(target), overwrite: true);
            File.Copy(WorldPath(fixture, slug), WorldPath(target, slug), overwrite: true);
            if (File.Exists(LorePath(fixture, slug)))
            {
                Directory.CreateDirectory(Path.Combine(target, "lore"));
                File.Copy(LorePath(fixture, slug), LorePath(target, slug), overwrite: true);
            }
            else if (File.Exists(LorePath(target, slug)))
            {
                File.Delete(LorePath(target, slug));
            }
            using (WorldData world = WorldData.Load(target, slug))
            {
                return new Result { Slug = slug, Stands = world.StandCount, Sites = world.Layout.Sites.Length, Report = LayoutReport.Of(world).Write() };
            }
        }
    }

    // One world as the engine holds it: the plane and its cards from the v3 pack, the stands of
    // `stands.bin` in structure-of-arrays native collections, and the world's geometry and lore,
    // read from a pack directory that `WorldFiles.Generate` filled. Loading runs the decoder's
    // assertions of PRD v4 4.13.3; a world that fails one is not loaded. Dispose it when the world
    // is unloaded.
    //
    // Where each assertion runs in the player: at launch, `App.Start` reads `stands.bin` once and
    // runs `AssertAtLaunch` (the plane index is in range; the class agrees with the mask). At world
    // entry, `App.Load` runs `AssertAtEntry` on those records: the world's documents against
    // planes.json and the lore file, the record's plane (departure 7), the site, the set, the
    // cluster and the corridor's vertex, and the shard-load assertions (the join and the keyword),
    // since the v3 shards load at world entry. `Load(packDirectory, slug)` and `Decode` read the
    // file themselves and run every assertion in one call, for the generation entry point and the
    // tests.
    public sealed class WorldData : IDisposable
    {
        public Pack Pack;
        public PackPlane Plane;
        public PackCard[] Cards;                // the plane's cards in v3 star order
        public Dictionary<int, PackSet> Sets;
        public StandsFile Stands;
        public WorldDocument Layout;
        public LoreDocument Lore;               // null on a kit world
        public int[] CardOf;                    // by stand index: the stand's card in `Cards`
        byte[] swatches;
        bool ownsStands;                        // false when the records are the launch's (App.Start)

        public int StandCount => Stands.Count;
        public P2 Position(int stand) => new P2(Stands.X[stand], Stands.Z[stand]);
        public long Yaw(int stand) => Stands.Yaw[stand];
        public int Site(int stand) => Stands.Site[stand];
        public PackCard CardAt(int stand) => Cards[CardOf[stand]];

        // The world with every assertion of 4.13.3, its `stands.bin` read here: for the generation
        // entry point and the tests.
        public static WorldData Load(string packDirectory, string slug) => Load(packDirectory, slug, null);

        // World entry. With `launched`, the records that the launch read and asserted (`App.Start`)
        // are used, `stands.bin` is not read again, and only the assertions at world entry and at the
        // shard load run; the world does not own those records, and its disposal leaves them. With
        // null, the file is read here and every assertion runs, as `Decode` runs them.
        public static WorldData Load(string packDirectory, string slug, StandsFile launched)
        {
            var pack = new Pack(packDirectory);
            PackPlane plane = pack.Plane(slug);
            WorldDocument layout = WorldDocument.Parse(File.ReadAllText(WorldFiles.WorldPath(packDirectory, slug)));
            if (layout.DataHash != pack.Hash)
            {
                throw new InvalidDataException($"worlds/{slug}.json was laid out from pack {layout.DataHash}, not from pack {pack.Hash}");
            }
            string lorePath = WorldFiles.LorePath(packDirectory, slug);
            LoreDocument lore = File.Exists(lorePath) ? LoreDocument.Parse(File.ReadAllText(lorePath)) : null;
            WorldData world;
            if (launched == null)
            {
                world = Decode(pack.Planes, plane, pack.Cards(plane), File.ReadAllBytes(WorldFiles.StandsPath(packDirectory)), layout, lore);
            }
            else
            {
                PackCard[] cards = pack.Cards(plane);
                world = new WorldData { Plane = plane, Cards = cards, Stands = launched, Layout = layout, Lore = lore };
                world.CardOf = AssertAtEntry(pack.Planes, plane, cards, launched, layout, lore);
            }
            world.Pack = pack;
            world.Sets = pack.Sets();
            world.swatches = pack.Swatches();
            return world;
        }

        // The world's records with every assertion of PRD v4 4.13.3, against the planes of
        // `planes.json`, the plane's cards in star order and the world's two documents: the
        // assertions at launch, then those at world entry and at the shard load.
        public static WorldData Decode(IReadOnlyList<PackPlane> planes, PackPlane plane, PackCard[] cards, byte[] standsBin, WorldDocument layout, LoreDocument lore)
        {
            StandsFile stands = StandsFile.Read(standsBin);
            try
            {
                AssertAtLaunch(stands, planes.Count);
                var world = new WorldData { Plane = plane, Cards = cards, Stands = stands, Layout = layout, Lore = lore, ownsStands = true };
                world.CardOf = AssertAtEntry(planes, plane, cards, stands, layout, lore);
                return world;
            }
            catch
            {
                stands.Dispose();
                throw;
            }
        }

        static string Named(StandsFile stands, int stand) => $"stand {stand} ({stands.OracleId(stand)})";

        // The assertions of 4.13.3 at launch, on every record of `stands.bin`: the plane index is
        // within the count of planes.json, and the class agrees with the colour identity mask. The
        // launch (`App.Start`) and `Decode` both call this.
        public static void AssertAtLaunch(StandsFile stands, int planeCount)
        {
            for (int stand = 0; stand < stands.Count; stand++)
            {
                if (stands.Plane[stand] >= planeCount)
                {
                    throw new InvalidDataException($"{Named(stands, stand)} records plane index {stands.Plane[stand]}; planes.json holds {planeCount} planes");
                }
                if (Checker.ClassOf(stands.Mask[stand]) != stands.Class[stand])
                {
                    throw new InvalidDataException($"{Named(stands, stand)} records class {stands.Class[stand]} for the colour identity mask {stands.Mask[stand]}");
                }
            }
        }

        // The assertions of 4.13.3 at world entry and at the shard load, on records that passed
        // `AssertAtLaunch`, and the world's documents against planes.json and the lore file.
        static int[] AssertAtEntry(IReadOnlyList<PackPlane> planes, PackPlane plane, PackCard[] cards, StandsFile stands, WorldDocument layout, LoreDocument lore)
        {
            if (layout.Slug != plane.Slug)
            {
                throw new InvalidDataException($"worlds/{layout.Slug}.json is not the world of {plane.Slug}");
            }
            if (layout.Hero != (lore != null))
            {
                throw new InvalidDataException(layout.Hero ? $"the hero world {plane.Slug} has no lore/{plane.Slug}.json" : $"the kit world {plane.Slug} has a lore file");
            }
            // The plane index is the plane's position in planes.json (docs/data-contract-v4.md
            // section 7, departure 1). The checker compares each record with the world document
            // (`card-plane`); only a reader of planes.json can say that both name this plane
            // (DEC-1091 N6).
            int position = -1;
            for (int i = 0; i < planes.Count; i++)
            {
                if (planes[i].Slug == plane.Slug)
                {
                    position = i;
                }
            }
            if (position != plane.Index || layout.PlaneIndex != position)
            {
                throw new InvalidDataException($"worlds/{plane.Slug}.json names plane index {layout.PlaneIndex}; {plane.Slug} is plane {position} of planes.json");
            }
            if (layout.StandCount != stands.Count || layout.StandVertex.Length != stands.Count || layout.StandArc.Length != stands.Count)
            {
                throw new InvalidDataException($"stands.bin holds {stands.Count} records; worlds/{plane.Slug}.json counts {layout.StandCount} stands and lists "
                    + $"{layout.StandVertex.Length} corridor vertices and {layout.StandArc.Length} arc lengths");
            }
            var eraOfSet = new Dictionary<int, LoreEra>();
            if (lore != null)
            {
                foreach (LoreEra era in lore.Eras)
                {
                    foreach (int set in era.SetIds)
                    {
                        eraOfSet[set] = era;
                    }
                }
            }
            var cardOf = new int[stands.Count];
            for (int stand = 0; stand < stands.Count; stand++)
            {
                // At world entry: the record is this world's plane, while `stands.bin` holds one
                // world (docs/data-contract-v4.md section 7, item 3; the pull request's departure 7).
                if (stands.Plane[stand] != layout.PlaneIndex)
                {
                    throw new InvalidDataException($"{Named(stands, stand)} records plane index {stands.Plane[stand]}; this is the world of plane {layout.PlaneIndex}");
                }
                // At world entry: the site, the set, the cluster and the corridor's vertex.
                int siteIndex = stands.Site[stand];
                if (siteIndex >= layout.Sites.Length)
                {
                    throw new InvalidDataException($"{Named(stands, stand)} records site index {siteIndex}; the world has {layout.Sites.Length} sites");
                }
                WorldSite site = layout.Sites[siteIndex];
                if (site.Kind != "region" && Array.IndexOf(site.SetIds, (int)stands.SetId[stand]) < 0)
                {
                    throw new InvalidDataException($"{Named(stands, stand)} records set id {stands.SetId[stand]}, which site {site.Key} does not list");
                }
                if (stands.Cluster[stand] >= site.Clusters.Length)
                {
                    throw new InvalidDataException($"{Named(stands, stand)} records cluster index {stands.Cluster[stand]}; site {site.Key} has {site.Clusters.Length} clusters");
                }
                if (layout.StandVertex[stand] < 0 || layout.StandVertex[stand] >= site.Path.Length)
                {
                    throw new InvalidDataException($"the corridor of {Named(stands, stand)} ends on vertex {layout.StandVertex[stand]}; the path of site {site.Key} has {site.Path.Length} vertices");
                }
                // At the shard load, which is world entry with the v3 shards: the shard and the
                // index resolve to the stand's own card.
                int card = stands.CardIndex(stand, Pack.ShardSize);
                if (card >= cards.Length || !string.Equals(cards[card].OracleId, stands.OracleId(stand), StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException($"{Named(stands, stand)} joins shard {stands.Shard[stand]}, index {stands.ShardIndex[stand]}, which holds "
                        + (card < cards.Length ? $"{cards[card].OracleId}" : "no card") + ": a malformed join");
                }
                cardOf[stand] = card;
                // On a regional site, the card's selected keyword names the site's region, and the
                // region of its era differs from it (5.4.3).
                if (site.Kind == "region")
                {
                    PackCard held = cards[card];
                    string[] names = held.Back == null ? new[] { held.Name } : new[] { held.Name, held.Back.Name };
                    Keywords.Row? keyword = lore == null ? null : Keywords.Selected(names, lore.Keywords);
                    eraOfSet.TryGetValue(stands.SetId[stand], out LoreEra era);
                    if (keyword == null || keyword.Value.Region != site.RegionId || era == null || era.Region == site.RegionId)
                    {
                        throw new InvalidDataException($"{Named(stands, stand)}, {held.Name}, stands at the regional site {site.Key}; its selected keyword is "
                            + (keyword == null ? "none" : $"'{keyword.Value.Word}' of region {keyword.Value.Region}") + $", and its era is {era?.Id ?? "none"} of region {era?.Region ?? "none"}");
                    }
                }
            }
            return cardOf;
        }

        // The card's swatch (docs/data-contract.md, section 5.1): sample 0 to 3 of its art at 2 x 2,
        // in reading order, as 8-bit sRGB.
        public void Swatch(int card, int sample, out byte r, out byte g, out byte b)
        {
            int at = Pack.SwatchHeader + (Plane.StarOffset + card) * Pack.SwatchRecord + 2 * sample;
            int rgb565 = swatches[at] | swatches[at + 1] << 8;
            int r5 = rgb565 >> 11, g6 = (rgb565 >> 5) & 63, b5 = rgb565 & 31;
            r = (byte)(r5 << 3 | r5 >> 2);
            g = (byte)(g6 << 2 | g6 >> 4);
            b = (byte)(b5 << 3 | b5 >> 2);
        }

        // The records go with the world only when it read them; the launch's are the app's.
        public void Dispose()
        {
            if (ownsStands)
            {
                Stands?.Dispose();
            }
        }
    }
}
