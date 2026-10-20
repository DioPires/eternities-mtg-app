using System;
using Eternities.Layout;

namespace Eternities.Data
{
    // Where a walker stands in a world, as the HUD's line names it (PRD v4 6.3.1), from the pack's
    // own shapes (4.13.5) and no table: the region whose cell holds the point, and the site whose
    // bounding disc holds it. A site's bounding disc holds its blob, its path, its pad, its
    // approach and its stone, and lies 10 m clear of every other site (5.4.6), so a walker on a
    // site's pad or at its stone is at that site.
    //
    // It is asked once a frame and allocates nothing: the last region is tested first, since a
    // walker stays in one for many frames, and a site's disc is a distance.
    public sealed class Whereabouts
    {
        readonly WorldDocument layout;
        int lastRegion = -1;

        public Whereabouts(WorldDocument layout)
        {
            this.layout = layout;
        }

        // A point of the engine's ground plane, in metres, as the pack's millimetres.
        public static P2 Millimetres(float x, float z) => new P2((long)Math.Round(x * 1000.0), (long)Math.Round(z * 1000.0));

        // The index of the region whose cell holds the point, or -1 where none does.
        public int Region(P2 at)
        {
            WorldRegion[] regions = layout.Regions;
            if (lastRegion >= 0 && Predicates.PointInPolygon(at, regions[lastRegion].Cell))
            {
                return lastRegion;
            }
            for (int r = 0; r < regions.Length; r++)
            {
                if (r != lastRegion && Predicates.PointInPolygon(at, regions[r].Cell))
                {
                    return lastRegion = r;
                }
            }
            return lastRegion = -1;
        }

        // The index of the site whose bounding disc holds the point, or -1.
        public int Site(P2 at)
        {
            WorldSite[] sites = layout.Sites;
            for (int s = 0; s < sites.Length; s++)
            {
                long dx = at.X - sites[s].Centre.X, dz = at.Z - sites[s].Centre.Z, radius = sites[s].BoundingRadius;
                if (dx * dx + dz * dz <= radius * radius)
                {
                    return s;
                }
            }
            return -1;
        }

        // The HUD's line (PRD v4 6.3.1): the plane, the region on a hero world, and the site, as
        // "Dominaria · Shiv · The First Ages". A kit world's one region has no name, and a regional
        // site is named for its region, so neither is said twice.
        public static string Line(WorldData world, int region, int site)
        {
            string line = world.Plane.DisplayName;
            string regionName = region >= 0 ? world.Layout.Regions[region].Name : null;
            if (regionName != null)
            {
                line += " · " + regionName;
            }
            string siteName = site >= 0 ? SiteTitle(world, world.Layout.Sites[site]) : null;
            if (siteName != null && siteName != regionName)
            {
                line += " · " + siteName;
            }
            return line;
        }

        // A site's name in the HUD's line: an era's name, a region's name, or a set's name and year
        // (4.13.5, 4.16.3).
        public static string SiteTitle(WorldData world, WorldSite site)
        {
            if (site.Kind == "era" && world.Lore != null)
            {
                LoreEra era = Array.Find(world.Lore.Eras, row => row.Id == site.EraId);
                return era == null ? site.Key : era.Name;
            }
            if (site.Kind == "region")
            {
                WorldRegion region = Array.Find(world.Layout.Regions, row => row.Id == site.RegionId);
                return region?.Name ?? site.Key;
            }
            return site.SetIds.Length == 1 && world.Sets != null && world.Sets.TryGetValue(site.SetIds[0], out PackSet set) ? $"{set.Name}, {set.Year}" : site.Key;
        }

        // A region's one sourced sentence (PRD v4 5.13.7), from the lore document, or null on a kit
        // world and for a region the lore does not name.
        public static string Sentence(WorldData world, int region)
        {
            if (region < 0 || world.Lore == null)
            {
                return null;
            }
            string id = world.Layout.Regions[region].Id;
            LoreRegion row = Array.Find(world.Lore.Regions, candidate => candidate.Id == id);
            return row?.Sentence?.Text;
        }
    }
}
