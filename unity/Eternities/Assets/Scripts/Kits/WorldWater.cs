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
        public const int CurrentSide = 1024;

        // `owned` takes what is made here and belongs to no object: it leaves with the world.
        public static GameObject Build(DressPlan plan, GameObject riverPrefab, GameObject lakePrefab, GameObject seaPrefab, Material lava, Transform parent, List<Object> owned)
        {
            var root = new GameObject("Water");
            root.transform.SetParent(parent, false);

            // The water system renders only where a volume says so.
            var volume = root.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 1;
            volume.profile = ScriptableObject.CreateInstance<VolumeProfile>();
            volume.profile.Add<WaterRendering>().enable.Override(true);
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

        // Squares of `Block` texels over every texel whose water `kind` takes, and one square more
        // round them, at a level: rows of squares joined into one quad. With `skirt`, four quads
        // reach from the ground's edge to the horizon.
        static Mesh Blocks(DressPlan plan, Func<byte, bool> kind, float level, string name, bool skirt, List<Object> owned)
        {
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
                    for (int dz = -1; dz <= 1 && !grown[bz * blocks + bx]; dz++)
                    {
                        for (int dx = -1; dx <= 1; dx++)
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
            var triangles = new List<int>();
            float size = Block * plan.Grid.Texel, min = plan.Grid.Min;
            void Quad(float x0, float z0, float x1, float z1)
            {
                int first = vertices.Count;
                vertices.Add(new Vector3(x0, level, z0));
                vertices.Add(new Vector3(x0, level, z1));
                vertices.Add(new Vector3(x1, level, z1));
                vertices.Add(new Vector3(x1, level, z0));
                triangles.AddRange(new[] { first, first + 1, first + 2, first, first + 2, first + 3 });
            }
            for (int bz = 0; bz < blocks; bz++)
            {
                for (int bx = 0; bx < blocks; bx++)
                {
                    if (!grown[bz * blocks + bx])
                    {
                        continue;
                    }
                    int end = bx;
                    while (end + 1 < blocks && grown[bz * blocks + end + 1])
                    {
                        end++;
                    }
                    // A long run is cut so that no quad is longer than four blocks: the water's
                    // vertices carry its waves.
                    for (int from = bx; from <= end; from += 4)
                    {
                        int to = Mathf.Min(end, from + 3);
                        Quad(min + from * size, min + bz * size, min + (to + 1) * size, min + (bz + 1) * size);
                    }
                    bx = end;
                }
            }
            if (skirt)
            {
                float edge = -min, far = edge + Horizon;
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
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            owned.Add(mesh);
            return mesh;
        }

        // The rivers' current map (HDRP's legacy current maps): red and green the way the water
        // runs, from −1 to 1, and blue how much the map holds against the surface's own current.
        // A pond is still.
        static Texture2D CurrentMap(DressPlan plan)
        {
            int side = CurrentSide, step = Mathf.Max(1, plan.N / side);
            var pixels = new Color32[side * side];
            for (int row = 0; row < side; row++)
            {
                for (int column = 0; column < side; column++)
                {
                    int texel = Mathf.Min(row * step, plan.N - 1) * plan.N + Mathf.Min(column * step, plan.N - 1);
                    float x = plan.FlowX[texel], z = plan.FlowZ[texel];
                    bool flows = x != 0 || z != 0;
                    pixels[row * side + column] = new Color32((byte)Mathf.RoundToInt((0.5f + 0.5f * x) * 255), (byte)Mathf.RoundToInt((0.5f + 0.5f * z) * 255), (byte)(flows ? 255 : 0), 255);
                }
            }
            var map = new Texture2D(side, side, TextureFormat.RGBA32, mipChain: false, linear: true) { name = "rivers' current", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            map.SetPixels32(pixels);
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
        const float Drift = 0.012f;     // tiles a second

        Renderer lava;
        MaterialPropertyBlock block;
        Vector2 offset;
        public bool Still;

        static readonly int Map = Shader.PropertyToID("_BaseColorMap"), MapST = Shader.PropertyToID("_BaseColorMap_ST");

        public void Bind(Renderer renderer, DressPlan plan, List<Object> owned)
        {
            lava = renderer;
            block = new MaterialPropertyBlock();
            Texture2D crust = Crust(plan);
            owned.Add(crust);
            block.SetTexture(Map, crust);
            lava.SetPropertyBlock(block);
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
            if (lava == null || Still)
            {
                return;
            }
            offset += new Vector2(Drift, Drift * 0.4f) * Time.deltaTime;
            var tiling = new Vector4(0.08f, 0.08f, offset.x, offset.y);
            block.SetVector(MapST, tiling);
            lava.SetPropertyBlock(block);
        }
    }
}
