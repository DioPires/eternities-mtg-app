using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;
using Object = UnityEngine.Object;

namespace Eternities.Kits
{
    // A world's water (PRD v4 5.6.3, 8.4.2) as HDRP's water system draws it: three surfaces, each
    // an instance of a kit prefab so that what the owner tunes by eye (flow, ripples, foam, colour)
    // lives in a file and nowhere in code. The rivers and their ponds are one river surface, which
    // flows along each river by a current map that the plan's rivers make; the lakes and a marsh's
    // pools are one still surface; the sea is the third, and reaches past the ground to the
    // horizon. Each surface is a mesh of squares over the texels its water lies on, at the water's
    // level: where the ground is above it, the ground hides it. Lava is no water: it is a mesh of
    // its own, in a glowing material whose crust drifts along the flow.
    public static class WorldWater
    {
        // Water is one of the switches of the HDRP asset in force. With it off the pipeline draws no
        // water surface, and none is made.
        public static bool Supported => GraphicsSettings.currentRenderPipeline is HDRenderPipelineAsset asset && asset.currentPlatformRenderPipelineSettings.supportWater;

        // A square of the meshes, in texels a side.
        public const int Block = 8;
        // The sea reaches this far past the ground, in metres.
        public const float Horizon = 6000;
        // The current map's side, in texels.
        public const int CurrentSide = DressPlan.CurrentSide;

        // The world's water shows only while the visitor is in the world, as its sky does
        // (`WorldSky.Shown`). A world is built while the visitor still stands in the hub, and the
        // hub stands on the sea's reach past the ground: with the water on, the hub's horizon was
        // the world's sea after every visit (DEC-1203 N4). The world's volume turns the water
        // system off in the hub, over HDRP's default profile, which turns it on everywhere;
        // nothing is built or let go.
        public static void Show(GameObject water, bool shown)
        {
            if (water.GetComponent<Volume>().profile.TryGet(out WaterRendering rendering))
            {
                rendering.enable.value = shown;
            }
        }

        public static bool Shown(GameObject water) => water.GetComponent<Volume>().profile.TryGet(out WaterRendering rendering) && rendering.enable.value;

        // The first draw of a kind of water in a session stalls frames for a few hundred
        // milliseconds while HDRP's water passes start. Before DEC-1203 N4 that was the hub's view
        // of the sea; then it was the first river on the trail (370 ms in CI's warm run 39314207746).
        // So the first entry, behind the veil, turns the water on and a camera high over the world
        // draws every surface once into a small texture, while the main camera, still in the hub,
        // draws the sea's reach under it. `EndWarmUp` takes it all away again.
        public static GameObject WarmUp(GameObject water, float radius)
        {
            Show(water, true);
            var holder = new GameObject("Water warm-up");
            holder.transform.SetParent(water.transform, false);
            float height = 2 * radius + 50;
            holder.transform.SetPositionAndRotation(new Vector3(0, height, 0), Quaternion.Euler(90, 0, 0));
            var camera = holder.AddComponent<Camera>();
            camera.fieldOfView = 2 * Mathf.Atan((radius + 50) / height) * Mathf.Rad2Deg;
            camera.nearClipPlane = 1;
            camera.farClipPlane = height + 100;
            camera.targetTexture = new RenderTexture(WarmUpSide, WarmUpSide, 24) { name = "water warm-up" };
            return holder;
        }

        public const int WarmUpSide = 256;

        public static void EndWarmUp(GameObject water, GameObject warmUp)
        {
            if (warmUp == null)
            {
                return;     // the world went, and the warm-up with it
            }
            var camera = warmUp.GetComponent<Camera>();
            RenderTexture target = camera.targetTexture;
            camera.targetTexture = null;
            Object.Destroy(warmUp);
            target.Release();
            Object.Destroy(target);
            if (water != null)
            {
                Show(water, false);
            }
        }

        // `owned` takes what is made here and belongs to no object: it leaves with the world.
        public static GameObject Build(DressPlan plan, GameObject riverPrefab, GameObject lakePrefab, GameObject seaPrefab, Material lava, Transform parent, List<Object> owned)
        {
            var root = new GameObject("Water");
            root.transform.SetParent(parent, false);

            // The water system renders where the volumes say so. HDRP's default profile turns it on
            // everywhere; this one turns it off until the visitor is in the world (`Show`).
            var volume = root.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 1;
            volume.profile = ScriptableObject.CreateInstance<VolumeProfile>();
            volume.profile.Add<WaterRendering>().enable.Override(false);
            owned.Add(volume.profile);

            if (riverPrefab != null)
            {
                Mesh rivers = Blocks(plan, wet => wet == DressPlan.WetRiver, DressPlan.WaterLevel, "rivers", skirt: false, owned);
                if (rivers != null)
                {
                    Texture2D current = CurrentMap(plan);
                    owned.Add(current);
                    Surface("Rivers", riverPrefab, rivers, root.transform, surface =>
                    {
                        surface.largeOrientationValue = 0;
                        surface.largeCurrentMap = current;
                        surface.largeCurrentRegionExtent = new Vector2(plan.Grid.Side, plan.Grid.Side);
                        surface.largeCurrentRegionOffset = Vector2.zero;
                        surface.largeCurrentMapInfluence = 1;
                    });
                }
            }
            if (lakePrefab != null)
            {
                Mesh still = Blocks(plan, wet => wet == DressPlan.WetStill || wet == DressPlan.WetMarsh, DressPlan.WaterLevel, "lakes and pools", skirt: false, owned);
                if (still != null)
                {
                    Surface("Lakes and pools", lakePrefab, still, root.transform, null);
                }
            }
            if (seaPrefab != null)
            {
                Mesh sea = Blocks(plan, wet => wet == DressPlan.WetSea, DressPlan.WaterLevel, "sea", skirt: true, owned);
                if (sea != null)
                {
                    Surface("Sea", seaPrefab, sea, root.transform, null);
                }
            }
            if (lava != null)
            {
                Mesh flow = Blocks(plan, wet => wet == DressPlan.WetLava, DressPlan.LavaLevel, "lava", skirt: false, owned);
                if (flow != null)
                {
                    var holder = new GameObject("Lava");
                    holder.transform.SetParent(root.transform, false);
                    holder.AddComponent<MeshFilter>().sharedMesh = flow;
                    var renderer = holder.AddComponent<MeshRenderer>();
                    renderer.sharedMaterial = lava;
                    renderer.shadowCastingMode = ShadowCastingMode.Off;
                    holder.AddComponent<LavaFlow>().Bind(renderer, plan, owned);
                }
            }
            return root;
        }

        // One surface from its prefab, its geometry the mesh, everything at the world's origin so
        // that the surface's own space is the world's. `keep` sets what the world gives it, again
        // after the owner tunes the prefab (`WaterTuning`).
        static void Surface(string name, GameObject prefab, Mesh mesh, Transform parent, Action<WaterSurface> keep)
        {
            GameObject instance = Object.Instantiate(prefab, parent);
            instance.name = name;
            instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            instance.transform.localScale = Vector3.one;
            var holder = new GameObject($"{name} mesh");
            holder.transform.SetParent(instance.transform, false);
            holder.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = holder.AddComponent<MeshRenderer>();
            renderer.enabled = false;           // the water system draws the mesh, with its own material
            var surface = instance.GetComponent<WaterSurface>();
            void Own(WaterSurface water)
            {
                water.geometryType = WaterGeometryType.Custom;
                water.meshRenderers = new List<MeshRenderer> { renderer };
                keep?.Invoke(water);
            }
            Own(surface);
            WaterTuning.Follow(instance, prefab, Own);
        }

        // Squares of `Block` texels over every texel whose water `kind` takes, and two squares more
        // round them, at a level: one grid whose squares share their corners, so the water's
        // displaced vertices leave no crack between two squares. With `skirt`, four quads reach
        // from the ground's edge to the horizon.
        static Mesh Blocks(DressPlan plan, Func<byte, bool> kind, float level, string name, bool skirt, List<Object> owned)
        {
            const int Margin = 2;
            int blocks = plan.N / Block;
            var wet = new bool[blocks * blocks];
            bool any = false;
            for (int row = 0; row < plan.N; row++)
            {
                for (int column = 0; column < plan.N; column++)
                {
                    if (kind(plan.Wet[row * plan.N + column]))
                    {
                        wet[(row / Block) * blocks + column / Block] = any = true;
                    }
                }
            }
            if (!any)
            {
                return null;
            }
            var grown = new bool[wet.Length];
            for (int bz = 0; bz < blocks; bz++)
            {
                for (int bx = 0; bx < blocks; bx++)
                {
                    for (int dz = -Margin; dz <= Margin && !grown[bz * blocks + bx]; dz++)
                    {
                        for (int dx = -Margin; dx <= Margin; dx++)
                        {
                            int x = bx + dx, z = bz + dz;
                            if (x >= 0 && z >= 0 && x < blocks && z < blocks && wet[z * blocks + x])
                            {
                                grown[bz * blocks + bx] = true;
                                break;
                            }
                        }
                    }
                }
            }
            var vertices = new List<Vector3>();
            var uvs = new List<Vector2>();
            var triangles = new List<int>();
            float size = Block * plan.Grid.Texel, min = plan.Grid.Min;
            // A corner's vertex, made once.
            var corner = new Dictionary<int, int>();
            int Corner(int cx, int cz)
            {
                int key = cz * (blocks + 1) + cx;
                if (!corner.TryGetValue(key, out int index))
                {
                    index = vertices.Count;
                    vertices.Add(new Vector3(min + cx * size, level, min + cz * size));
                    uvs.Add(new Vector2(min + cx * size, min + cz * size));     // in metres: lava's crust is laid in world space
                    corner[key] = index;
                }
                return index;
            }
            for (int bz = 0; bz < blocks; bz++)
            {
                for (int bx = 0; bx < blocks; bx++)
                {
                    if (grown[bz * blocks + bx])
                    {
                        int a = Corner(bx, bz), b = Corner(bx, bz + 1), c = Corner(bx + 1, bz + 1), d = Corner(bx + 1, bz);
                        triangles.AddRange(new[] { a, b, c, a, c, d });
                    }
                }
            }
            if (skirt)
            {
                float edge = -min, far = edge + Horizon;
                void Quad(float x0, float z0, float x1, float z1)
                {
                    int first = vertices.Count;
                    vertices.Add(new Vector3(x0, level, z0));
                    vertices.Add(new Vector3(x0, level, z1));
                    vertices.Add(new Vector3(x1, level, z1));
                    vertices.Add(new Vector3(x1, level, z0));
                    uvs.Add(new Vector2(x0, z0));
                    uvs.Add(new Vector2(x0, z1));
                    uvs.Add(new Vector2(x1, z1));
                    uvs.Add(new Vector2(x1, z0));
                    triangles.AddRange(new[] { first, first + 1, first + 2, first, first + 2, first + 3 });
                }
                Quad(-far, -far, far, -edge);
                Quad(-far, edge, far, far);
                Quad(-far, -edge, -edge, edge);
                Quad(edge, -edge, far, edge);
            }
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            var normals = new Vector3[vertices.Count];
            for (int i = 0; i < normals.Length; i++)
            {
                normals[i] = Vector3.up;
            }
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            owned.Add(mesh);
            return mesh;
        }

        // The rivers' current map (HDRP's legacy current maps), as the plan made it: red and green
        // the way the water runs, from −1 to 1, and blue how much the map holds against the
        // surface's own current. A pond is still.
        static Texture2D CurrentMap(DressPlan plan)
        {
            int side = CurrentSide;
            var map = new Texture2D(side, side, TextureFormat.RGBA32, mipChain: false, linear: true) { name = "rivers' current", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            map.SetPixels32(plan.Current);
            map.Apply(updateMipmaps: false, makeNoLongerReadable: true);
            return map;
        }
    }

    // Lava's crust, drifting along the flow: a texture of dark crust with glowing cracks, made once
    // from noise, and moved a little every frame. The kit's lava material glows by its colour, so
    // the cracks glow and the crust is dark. Reduced motion stops it (PRD v4 5.11.2).
    public sealed class LavaFlow : MonoBehaviour
    {
        const int Side = 256;
        const float Drift = 0.004f;     // tiles a second
        const float Tiling = 0.04f;     // tiles a metre: the crust's pattern repeats every 25 m

        Material material;
        Vector2 offset;
        public bool Still;

        static readonly int Map = Shader.PropertyToID("_BaseColorMap");

        // The kit's material, copied for this world with the crust in it: a property block is not
        // read by the pipeline's GPU-driven drawing of the renderer.
        public void Bind(Renderer renderer, DressPlan plan, List<Object> owned)
        {
            Texture2D crust = Crust(plan);
            owned.Add(crust);
            material = new Material(renderer.sharedMaterial) { name = "lava of this world" };
            owned.Add(material);
            material.SetTexture(Map, crust);
            material.SetTextureScale(Map, Vector2.one * Tiling);
            renderer.sharedMaterial = material;
        }

        // Cracks where two layers of noise cross a middle value, bright in the alpha and the
        // colour; crust elsewhere, near black.
        static Texture2D Crust(DressPlan plan)
        {
            var pixels = new Color32[Side * Side];
            uint seed = (uint)SplitMixSeed(plan.Layout.Slug);
            for (int y = 0; y < Side; y++)
            {
                for (int x = 0; x < Side; x++)
                {
                    float u = x / (float)Side * 8, v = y / (float)Side * 8;
                    float a = Mathf.Abs(Raster.Noise(u, v, seed) - 0.5f) * 2, b = Mathf.Abs(Raster.Noise(u * 2.3f + 5, v * 2.3f + 5, seed + 1) - 0.5f) * 2;
                    float crack = Mathf.Pow(1 - Mathf.Min(a, b * 1.4f), 6);
                    float glow = Mathf.Clamp01(crack * 1.4f);
                    pixels[y * Side + x] = new Color32((byte)(20 + 235 * glow), (byte)(12 + 120 * glow * glow), (byte)(8 + 20 * glow * glow * glow), 255);
                }
            }
            var crust = new Texture2D(Side, Side, TextureFormat.RGBA32, mipChain: true) { name = "lava crust", wrapMode = TextureWrapMode.Repeat };
            crust.SetPixels32(pixels);
            crust.Apply(updateMipmaps: true, makeNoLongerReadable: true);
            return crust;
        }

        static ulong SplitMixSeed(string slug) => Eternities.Layout.SplitMix64.Fnv1a64($"eternities-v4|{slug}|lava");

        void Update()
        {
            if (material == null || Still)
            {
                return;
            }
            offset += new Vector2(Drift, Drift * 0.4f) * Time.deltaTime;
            material.SetTextureOffset(Map, offset);
        }
    }
}
