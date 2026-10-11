using System;
using System.Collections;
using System.Collections.Generic;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

namespace Eternities.CardView
{
    // Where an image comes from. `Request` asks for the image at one of `ImageUrls`' addresses;
    // `done` is called on the main thread, once, with a texture the caller then owns, or with null
    // when there is none to show. The nearest is served first: `distance` is how far its view is.
    public interface IImageSource
    {
        void Request(string url, float distance, Action<Texture2D> done);
        void Cancel(string url);
        // An image that was asked for and has not come: is it failing to load? `done` is told
        // nothing while the source still means to try again, and with the network down it always
        // does, so a view that wants to say so asks here (PRD v4 7.4.3).
        bool Failing(string url);
    }

    // A world's stand images (PRD v4 5.5, 8.4.3): every image surface as a quad, one mesh a site,
    // and one texture array of 384 slots at 244 x 340, RGBA8 with a full mip chain.
    //
    // The main camera draws a surface in its stand's swatch, the card's art at 2 x 2 (PRD v4 8.4.4).
    // The nearest stands within 25 m of the avatar get a slot each and their image, half-size, with
    // its mips made on the GPU; at most two images are uploaded a frame. The slot count is the hard
    // bound: when a nearer stand needs a slot, the one whose stand is farthest gives its up.
    public sealed class StandImages : MonoBehaviour
    {
        public const int Slots = 384, Width = 244, Height = 340;
        public const float ImageRadius = 25, FadeSeconds = 0.2f;
        public const int UploadsPerFrame = 2;
        // The surface takes the image's pixel aspect (PRD v4 4.15.5): 488 x 680, 0.88 m tall.
        public const float SurfaceHeight = StandField.SurfaceHeight, SurfaceWidth = SurfaceHeight * 488 / 680, Proud = 0.002f;
        public const int AtlasBlocks = 256;     // the swatch texture holds this many stands a row, 2 x 2 texels each
        const float Cell = 25;

        sealed class Site
        {
            public Mesh Mesh;
            public readonly List<Vector2> Slot = new List<Vector2>();      // x the slot or -1, y the coverage
            public readonly List<Vector2> Swatch = new List<Vector2>();    // where the main camera reads the surface's colour
            public bool Dirty, SwatchDirty;
        }

        WorldData world;
        Site[] sites;
        int[] siteOfStand, firstVertexOfStand;
        Vector3[] positions;
        readonly Dictionary<long, List<int>> grid = new Dictionary<long, List<int>>();
        Texture2D atlas;
        Material placeholder;
        Texture2DArray array;
        RenderTexture half;

        int[] slotOfStand, standOfSlot;
        float[] coverage;           // per stand: how much of its image shows, 0 to 1
        bool[] requested, isWanted, swatchHidden;
        Vector3 wantedFrom = new Vector3(float.NaN, 0, 0);
        float wantedAt;
        readonly List<int> wanted = new List<int>(), fading = new List<int>();
        readonly List<(int Stand, Texture2D Image)> arrived = new List<(int, Texture2D)>();
        readonly List<(float Distance, int Stand)> near = new List<(float, int)>();
        float[] distanceOfStand;

        public IImageSource Source;
        public Transform Viewer;
        public Texture2DArray Array => array;
        public Material SurfaceMaterial => placeholder;     // what the main camera draws the surfaces with
        public int SlotsInUse { get; private set; }
        public int Uploads { get; private set; }
        public int Evictions { get; private set; }
        public double LongestUpdateMs { get; private set; }
        public int Hitches { get; private set; }        // frames in which this streaming took over 4 ms (PRD v4 7.3.3)
        public int SlotsInUsePeak { get; private set; }
        public const double HitchMs = 4;
        public int SlotOf(int stand) => slotOfStand[stand];
        public float CoverageOf(int stand) => coverage[stand];
        public bool Idle => arrived.Count == 0 && fading.Count == 0;

        public static StandImages Create(Transform parent)
        {
            var holder = new GameObject("Stand images");
            holder.transform.SetParent(parent, false);
            return holder.AddComponent<StandImages>();
        }

        // Builds the surfaces site by site, yielding when a frame has spent `budget` milliseconds.
        public IEnumerator Fill(WorldData data, Material surface, float budget)
        {
            world = data;
            int count = world.Layout.Stands.Count;
            slotOfStand = new int[count];
            coverage = new float[count];
            requested = new bool[count];
            isWanted = new bool[count];
            swatchHidden = new bool[count];
            distanceOfStand = new float[count];
            siteOfStand = new int[count];
            firstVertexOfStand = new int[count];
            positions = new Vector3[count];
            standOfSlot = new int[Slots];
            for (int i = 0; i < count; i++)
            {
                slotOfStand[i] = -1;
            }
            for (int i = 0; i < Slots; i++)
            {
                standOfSlot[i] = -1;
            }

            // The swatches: each stand's four samples as a 2 x 2 block of one texture, which the
            // main camera's material reads between the block's texel centres.
            // One block more than there are stands, the last, is transparent: a surface that reads it
            // is cut out of the main camera's frame (see Shown).
            int rows = (count + 1 + AtlasBlocks - 1) / AtlasBlocks;
            atlas = new Texture2D(2 * AtlasBlocks, 2 * rows, TextureFormat.RGBA32, mipChain: false) { name = "swatches", filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
            var pixels = new Color32[atlas.width * atlas.height];
            for (int stand = 0; stand < count; stand++)
            {
                int x = 2 * (stand % AtlasBlocks), y = 2 * (stand / AtlasBlocks);
                for (int sample = 0; sample < 4; sample++)
                {
                    world.Swatch(world.Layout.Stands[stand].Card, sample, out byte r, out byte g, out byte b);
                    // Samples are in reading order and a texture's first row is its bottom one.
                    pixels[(y + (sample < 2 ? 1 : 0)) * atlas.width + x + (sample & 1)] = new Color32(r, g, b, 255);
                }
            }
            atlas.SetPixels32(pixels);
            atlas.Apply(false, makeNoLongerReadable: true);
            placeholder = new Material(surface) { name = "image surfaces" };
            placeholder.SetTexture("_UnlitColorMap", atlas);

            array = new Texture2DArray(Width, Height, Slots, TextureFormat.RGBA32, mipChain: true, linear: false) { name = "stand images", filterMode = FilterMode.Trilinear, wrapMode = TextureWrapMode.Clamp, anisoLevel = 4 };
            array.Apply(false, makeNoLongerReadable: true);
            half = new RenderTexture(Width, Height, 0, GraphicsFormat.R8G8B8A8_SRGB) { name = "stand image, half size", useMipMap = true, autoGenerateMips = false, filterMode = FilterMode.Bilinear };
            half.Create();

            var bySite = new List<int>[world.Layout.Sites.Count];
            for (int stand = 0; stand < count; stand++)
            {
                LayoutStand placed = world.Layout.Stands[stand];
                (bySite[placed.Site] ??= new List<int>()).Add(stand);
                positions[stand] = StandField.Ground(placed.Position);
                long key = Key(positions[stand]);
                if (!grid.TryGetValue(key, out List<int> cell))
                {
                    grid[key] = cell = new List<int>();
                }
                cell.Add(stand);
            }
            sites = new Site[bySite.Length];
            var vertices = new List<Vector3>();
            var image = new List<Vector2>();
            var triangles = new List<int>();
            double sliceStarted = Time.realtimeSinceStartupAsDouble;
            foreach (LayoutSite layoutSite in world.Layout.Sites)
            {
                if (bySite[layoutSite.Index] == null)
                {
                    continue;
                }
                var site = sites[layoutSite.Index] = new Site();
                vertices.Clear();
                image.Clear();
                triangles.Clear();
                Vector3 origin = StandField.Ground(layoutSite.Centre);
                foreach (int stand in bySite[layoutSite.Index])
                {
                    LayoutStand placed = world.Layout.Stands[stand];
                    Quaternion facing = StandField.Facing(placed);
                    Vector3 centre = positions[stand] - origin + new Vector3(0, StandField.PlinthHeight + SurfaceHeight / 2, 0) + facing * new Vector3(0, 0, StandField.SlabDepth / 2 + Proud);
                    Vector3 right = facing * Vector3.right * (SurfaceWidth / 2), up = Vector3.up * (SurfaceHeight / 2);
                    siteOfStand[stand] = layoutSite.Index;
                    firstVertexOfStand[stand] = vertices.Count;
                    int first = vertices.Count;
                    SwatchOf(stand, out float u, out float v, out float du, out float dv);
                    // Seen from the apron: bottom left, top left, top right, bottom right. The
                    // viewer's left is the stand's right.
                    vertices.Add(centre + right - up);
                    vertices.Add(centre + right + up);
                    vertices.Add(centre - right + up);
                    vertices.Add(centre - right - up);
                    site.Swatch.Add(new Vector2(u, v));
                    site.Swatch.Add(new Vector2(u, v + dv));
                    site.Swatch.Add(new Vector2(u + du, v + dv));
                    site.Swatch.Add(new Vector2(u + du, v));
                    image.Add(new Vector2(0, 0));
                    image.Add(new Vector2(0, 1));
                    image.Add(new Vector2(1, 1));
                    image.Add(new Vector2(1, 0));
                    for (int corner = 0; corner < 4; corner++)
                    {
                        site.Slot.Add(new Vector2(-1, 0));
                    }
                    triangles.Add(first);
                    triangles.Add(first + 1);
                    triangles.Add(first + 2);
                    triangles.Add(first);
                    triangles.Add(first + 2);
                    triangles.Add(first + 3);
                }
                site.Mesh = new Mesh { name = $"image surfaces {world.Layout.Input.SetCodes[layoutSite.Set]} {ColourClasses.SeedNames[(int)layoutSite.Class]}" };
                site.Mesh.MarkDynamic();
                site.Mesh.SetVertices(vertices);
                site.Mesh.SetUVs(0, site.Swatch);
                site.Mesh.SetUVs(1, image);
                site.Mesh.SetUVs(2, site.Slot);
                site.Mesh.SetTriangles(triangles, 0);
                site.Mesh.RecalculateBounds();

                var siteObject = new GameObject(site.Mesh.name) { layer = Exhibit.Layer };
                siteObject.transform.SetParent(transform, false);
                siteObject.transform.localPosition = origin;
                siteObject.AddComponent<MeshFilter>().sharedMesh = site.Mesh;
                var renderer = siteObject.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = placeholder;
                renderer.shadowCastingMode = ShadowCastingMode.Off;     // the surface receives no shadow and casts none: the slab behind it does
                renderer.receiveShadows = false;

                if ((Time.realtimeSinceStartupAsDouble - sliceStarted) * 1000 > budget)
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
        }

        // The corner of a stand's block of the swatch texture, at its first texel's centre, and the
        // step to the centre of the next: between them the four samples blend and no neighbour does.
        void SwatchOf(int block, out float u, out float v, out float du, out float dv)
        {
            u = (2 * (block % AtlasBlocks) + 0.5f) / atlas.width;
            v = (2 * (block / AtlasBlocks) + 0.5f) / atlas.height;
            du = 1f / atlas.width;
            dv = 1f / atlas.height;
        }

        // Whether the main camera draws a stand's surface in its swatch. Under an image that is
        // wholly shown it does not: the surface is cut out of the main camera's frame and the slab
        // behind it, 2 mm away and a centimetre larger all round, is the solid thing that the
        // world's depth, fog and depth of field see. Otherwise the swatch's edge, softened by
        // anti-aliasing and spread by a resolution scale under 1, shows as a rim around the
        // composited card: at scale 0.75 it was 903 pixels around a card of 244 x 340 (PRD v4
        // 8.4.4, test f).
        void Shown(int stand, bool swatchShown)
        {
            if (swatchHidden[stand] == !swatchShown)
            {
                return;
            }
            swatchHidden[stand] = !swatchShown;
            Site site = sites[siteOfStand[stand]];
            SwatchOf(swatchShown ? stand : world.Layout.Stands.Count, out float u, out float v, out float du, out float dv);
            int first = firstVertexOfStand[stand];
            site.Swatch[first] = new Vector2(u, v);
            site.Swatch[first + 1] = new Vector2(u, v + dv);
            site.Swatch[first + 2] = new Vector2(u + du, v + dv);
            site.Swatch[first + 3] = new Vector2(u + du, v);
            site.SwatchDirty = true;
        }

        // The `normal` image of the first printing of a stand's card (PRD v4 5.5.1).
        public string UrlOf(int stand) => ImageUrls.Front(world.Cards[world.Layout.Stands[stand].Card], ImageSize.Normal);

        // The stand nearest a point on the ground and no farther than `within` metres, or -1.
        public int Nearest(Vector3 position, float within)
        {
            int best = -1;
            float bestDistance = within * within;
            int cx = Mathf.FloorToInt(position.x / Cell), cz = Mathf.FloorToInt(position.z / Cell);
            for (int x = cx - 1; x <= cx + 1; x++)
            {
                for (int z = cz - 1; z <= cz + 1; z++)
                {
                    if (!grid.TryGetValue((long)x * 1_000_003 + z, out List<int> cell))
                    {
                        continue;
                    }
                    foreach (int stand in cell)
                    {
                        float dx = positions[stand].x - position.x, dz = positions[stand].z - position.z;
                        if (dx * dx + dz * dz <= bestDistance)
                        {
                            bestDistance = dx * dx + dz * dz;
                            best = stand;
                        }
                    }
                }
            }
            return best;
        }

        // A corner of a stand's swatch block, in the order a surface's corners are made: bottom
        // left, top left, top right, bottom right.
        public Vector2 SwatchCorner(int stand, int corner)
        {
            SwatchOf(stand, out float u, out float v, out float du, out float dv);
            return new Vector2(u + (corner >= 2 ? du : 0), v + (corner == 1 || corner == 2 ? dv : 0));
        }

        // Where the main camera's material reads nothing: a surface with these coordinates is cut out.
        public Vector2 CutOut
        {
            get
            {
                SwatchOf(world.Layout.Stands.Count, out float u, out float v, out _, out _);
                return new Vector2(u, v);
            }
        }

        static long Key(Vector3 position) => (long)Mathf.FloorToInt(position.x / Cell) * 1_000_003 + Mathf.FloorToInt(position.z / Cell);

        void Update()
        {
            if (sites == null || Viewer == null)
            {
                return;
            }
            double began = Time.realtimeSinceStartupAsDouble;
            // Which stands are wanted changes with where the viewer stands, not with every frame.
            if (!((Viewer.position - wantedFrom).sqrMagnitude < 0.25f) || Time.time - wantedAt > 0.5f)
            {
                wantedFrom = Viewer.position;
                wantedAt = Time.time;
                Want();
            }
            Upload();
            Fade();
            foreach (Site site in sites)
            {
                if (site != null && site.Dirty)
                {
                    site.Mesh.SetUVs(2, site.Slot);
                    site.Dirty = false;
                }
                if (site != null && site.SwatchDirty)
                {
                    site.Mesh.SetUVs(0, site.Swatch);
                    site.SwatchDirty = false;
                }
            }
            double spent = (Time.realtimeSinceStartupAsDouble - began) * 1000;
            LongestUpdateMs = Math.Max(LongestUpdateMs, spent);
            Hitches += spent > HitchMs ? 1 : 0;
            SlotsInUsePeak = Math.Max(SlotsInUsePeak, SlotsInUse);
        }

        // The stands within 25 m, nearest first, as many as there are slots. The loader never asks
        // for more images than it has slots (PRD v4 5.5.5).
        void Want()
        {
            Vector3 viewer = Viewer.position;
            near.Clear();
            int cx = Mathf.FloorToInt(viewer.x / Cell), cz = Mathf.FloorToInt(viewer.z / Cell);
            for (int x = cx - 1; x <= cx + 1; x++)
            {
                for (int z = cz - 1; z <= cz + 1; z++)
                {
                    if (!grid.TryGetValue((long)x * 1_000_003 + z, out List<int> cell))
                    {
                        continue;
                    }
                    foreach (int stand in cell)
                    {
                        float dx = positions[stand].x - viewer.x, dz = positions[stand].z - viewer.z;
                        float distance = Mathf.Sqrt(dx * dx + dz * dz);
                        if (distance <= ImageRadius)
                        {
                            near.Add((distance, stand));
                        }
                    }
                }
            }
            near.Sort((a, b) => a.Distance.CompareTo(b.Distance));
            if (near.Count > Slots)
            {
                near.RemoveRange(Slots, near.Count - Slots);
            }

            // What was wanted and no longer is: its request is withdrawn and its image fades to the
            // swatch (PRD v4 5.5.1). Its slot stays until a nearer stand needs one.
            foreach (int stand in wanted)
            {
                distanceOfStand[stand] = float.PositiveInfinity;
                isWanted[stand] = false;
            }
            foreach ((float distance, int stand) in near)
            {
                distanceOfStand[stand] = distance;
                isWanted[stand] = true;
            }
            foreach (int stand in wanted)
            {
                if (isWanted[stand])
                {
                    continue;
                }
                if (requested[stand])
                {
                    requested[stand] = false;
                    Source?.Cancel(UrlOf(stand));
                }
                if (slotOfStand[stand] >= 0 && !fading.Contains(stand))
                {
                    fading.Add(stand);
                }
            }
            wanted.Clear();
            foreach ((float distance, int stand) in near)
            {
                wanted.Add(stand);
                if (slotOfStand[stand] >= 0 && coverage[stand] < 1 && !fading.Contains(stand))
                {
                    fading.Add(stand);
                }
                if (slotOfStand[stand] < 0 && !requested[stand] && Source != null)
                {
                    requested[stand] = true;
                    int asked = stand;
                    Source.Request(UrlOf(stand), distance, texture => Arrived(asked, texture));
                }
            }
        }

        void Arrived(int stand, Texture2D texture)
        {
            if (this == null || !requested[stand] || texture == null)
            {
                if (this != null)
                {
                    requested[stand] = false;
                }
                Destroy(texture);
                return;
            }
            arrived.Add((stand, texture));
        }

        void Upload()
        {
            for (int n = 0; n < UploadsPerFrame && arrived.Count > 0; n++)
            {
                (int stand, Texture2D texture) = arrived[0];
                arrived.RemoveAt(0);
                requested[stand] = false;
                int slot = slotOfStand[stand] >= 0 ? slotOfStand[stand] : FreeSlot(stand);
                if (slot >= 0)
                {
                    // Exactly half: a bilinear tap at the centre of each 2 x 2 block, in linear light.
                    Graphics.Blit(texture, half);
                    half.GenerateMips();
                    for (int mip = 0; mip < half.mipmapCount; mip++)
                    {
                        Graphics.CopyTexture(half, 0, mip, array, slot, mip);
                    }
                    slotOfStand[stand] = slot;
                    standOfSlot[slot] = stand;
                    coverage[stand] = 0;
                    if (!fading.Contains(stand))
                    {
                        fading.Add(stand);
                    }
                    Uploads++;
                }
                Destroy(texture);
            }
        }

        // A slot for a stand: a free one, or the slot of the stand farthest from the viewer if that
        // stand is farther than this one. -1 when every slot holds a nearer stand.
        int FreeSlot(int stand)
        {
            int farthest = -1;
            for (int slot = 0; slot < Slots; slot++)
            {
                if (standOfSlot[slot] < 0)
                {
                    SlotsInUse++;
                    return slot;
                }
                if (farthest < 0 || distanceOfStand[standOfSlot[slot]] > distanceOfStand[standOfSlot[farthest]])
                {
                    farthest = slot;
                }
            }
            int evicted = standOfSlot[farthest];
            if (distanceOfStand[evicted] <= distanceOfStand[stand])
            {
                return -1;
            }
            slotOfStand[evicted] = -1;
            coverage[evicted] = 0;
            Mark(evicted, -1, 0);
            Shown(evicted, true);
            Evictions++;
            return farthest;
        }

        // An image fades in over 200 ms (PRD v4 5.5.5), and out the same way when its stand leaves
        // the 25 m: its coverage in the exhibit buffer moves, and the composite shows the swatch
        // through it. Nothing pops (PRD v4 7.3.4).
        void Fade()
        {
            float step = Time.deltaTime / FadeSeconds;
            for (int i = fading.Count - 1; i >= 0; i--)
            {
                int stand = fading[i];
                if (slotOfStand[stand] < 0)
                {
                    fading.RemoveAt(i);
                    continue;
                }
                float target = isWanted[stand] ? 1 : 0;
                coverage[stand] = Mathf.MoveTowards(coverage[stand], target, step);
                Mark(stand, slotOfStand[stand], coverage[stand]);
                Shown(stand, coverage[stand] < 1);
                if (coverage[stand] == target)
                {
                    fading.RemoveAt(i);
                }
            }
        }

        void Mark(int stand, int slot, float shown)
        {
            Site site = sites[siteOfStand[stand]];
            for (int corner = 0; corner < 4; corner++)
            {
                site.Slot[firstVertexOfStand[stand] + corner] = new Vector2(slot, shown);
            }
            site.Dirty = true;
        }

        void OnDestroy()
        {
            if (sites != null)
            {
                foreach (Site site in sites)
                {
                    if (site != null)
                    {
                        Destroy(site.Mesh);
                    }
                }
            }
            foreach ((int _, Texture2D texture) in arrived)
            {
                Destroy(texture);
            }
            Destroy(atlas);
            Destroy(placeholder);
            Destroy(array);
            if (half != null)
            {
                half.Release();
                Destroy(half);
            }
        }
    }
}
