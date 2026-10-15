using System;
using System.Collections;
using Eternities.Layout;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // What a world's ground is made from: its heights, which of the kit's layers lies where, its
    // tones and its water. The first slice worked it out from the wheel law's layout; that plan
    // retired with the law (PRD v4 9.6, leg 1), and leg 2 makes a plan of the journey law's
    // regions. The greybox draws no terrain (`Greybox`).
    public sealed class GroundPlan
    {
        // The kit's three layers, and after them the world's own: its tones.
        public const int Meadow = 0, Path = 1, Gravel = 2, KitLayers = 3, Tone = 3, Layers = 4;
        // PRD v4 5.6.3: the kit varies its ground by wedge, so the ground under a wedge reads as its
        // colour (9.3). One layer more holds a picture of the whole world, each wedge in its tone,
        // and this share of the ground between the paths is that picture; the rest is the kit's own
        // layer for the wedge, the meadow or bare stone. A layer for each wedge would be nine, and
        // the pipeline's terrain shader draws four in its lighter variant.
        public const float ToneShare = 0.45f;
        // The picture's side in texels: about 2 m of Dominaria to a texel.
        public const int ToneResolution = 512;
        // Two wedges' tones run into each other within this many degrees of their boundary. Inside
        // the world a radial path lies on it; beyond the rim nothing does.
        public const double ToneBlend = 1.5;
        public const float Margin = 120;
        // The ground level of everything the allocator placed is 0. The terrain's own floor lies
        // this far below it, so the kit can carve a river bed, and its ceiling as far above.
        public const float Floor = 50, Height = 100;
        // The relief keeps this far from anything flat, then rises to full height over the falloff.
        public const float FlatApron = 1.5f, Falloff = 10;
        // The bed is at its full depth within the half width or the radius, and rises to the ground
        // level over the bank beyond it.
        public const float WaterLevel = -0.6f, RiverDepth = 1.6f, RiverHalfWidth = 3.5f, LakeDepth = 3.5f, LakeRadius = 45, Bank = 5;

        public float Radius, Side;      // metres
        public int HeightResolution, AlphaResolution;
        public float[,] Heights;        // [z, x], metres above the ground level
        public float[,] Normalised;     // the same as Unity Terrain takes them: 0 at its floor, 1 at its ceiling
        public float[,,] Alphas;        // [z, x, layer], as Unity Terrain takes them
        public Color32[] Tones;         // [z * ToneResolution + x]: the tone layer's texture, with no alpha, so no gloss
        // The slice's water (PRD v4 9.5): one river and one lake, in the margin beyond the ring,
        // because inside the world the 3 m water buffer around paths, aprons and corridors leaves
        // no zone (PRD v4 8.4.2). The river runs west to east past the end of the north radial path
        // and into the lake. The lake lies as near the rim as the buffer lets it, so that ground
        // is left behind its far shore for the wood that closes the view across it.
        public Vector2 RiverFrom, RiverTo, LakeCentre;

        // How deep below the ground level the water's bed is at a point: 0 away from the water.
        public float Bed(float x, float z)
        {
            Vector2 p = new Vector2(x, z), along = RiverTo - RiverFrom;
            float t = Mathf.Clamp01(Vector2.Dot(p - RiverFrom, along) / along.sqrMagnitude);
            float river = RiverDepth * Mathf.SmoothStep(1, 0, (Vector2.Distance(p, RiverFrom + along * t) - RiverHalfWidth) / Bank);
            float lake = LakeDepth * Mathf.SmoothStep(1, 0, (Vector2.Distance(p, LakeCentre) - LakeRadius) / Bank);
            return Mathf.Max(river, lake);
        }

        // The height of the ground at a point, from the nearest sample.
        public float HeightAt(float x, float z)
        {
            float texel = Side / AlphaResolution;
            int column = Mathf.Clamp(Mathf.RoundToInt((x + Side / 2) / texel), 0, HeightResolution - 1);
            int row = Mathf.Clamp(Mathf.RoundToInt((z + Side / 2) / texel), 0, HeightResolution - 1);
            return Heights[row, column];
        }

        // Is a point in the water or on its bank? The avatar is kept out of it.
        public bool Wet(float x, float z) => Bed(x, z) > -WaterLevel * 0.5f;

        // PRD v4 8.4.5: 513 for worlds under 100 m of radius, 1,025 to 260 m, 2,049 beyond.
        public static int HeightmapResolution(float worldRadius) => worldRadius < 100 ? 513 : worldRadius <= 260 ? 1025 : 2049;

        // An integer hash of a cell, from 0 to 1, the same on every machine: the kit's variants draw
        // their value noise from it.
        internal static float Hash(int x, int z, uint seed)
        {
            unchecked
            {
                uint h = (uint)x * 0x85EBCA6Bu ^ (uint)z * 0xC2B2AE35u ^ seed * 0x27D4EB2Fu;
                h ^= h >> 15;
                h *= 0x2C1B3C6Du;
                h ^= h >> 12;
                h *= 0x297A2D39u;
                h ^= h >> 15;
                return (h & 0xFFFFFF) / (float)0x1000000;
            }
        }
    }

    // A world's ground: one Unity Terrain (PRD v4 8.4.5), square, centred on the arrival point, as
    // wide as the world and a margin, with the plan's heights and the kit's layers painted from it.
    public static class WorldGround
    {

        // The ground's layers: the kit's three, or plain colours in their place while the kit has
        // none, and the world's tones (PRD v4 5.6.3) as a fourth, one picture laid once over the
        // whole terrain. `owned` takes what is made here, which leaves with the world.
        public static TerrainLayer[] Layers(TerrainLayer[] kit, GroundPlan plan, System.Collections.Generic.List<UnityEngine.Object> owned)
        {
            var layers = new TerrainLayer[GroundPlan.Layers];
            if (kit != null && kit.Length == GroundPlan.KitLayers && Array.TrueForAll(kit, layer => layer != null))
            {
                Array.Copy(kit, layers, GroundPlan.KitLayers);
            }
            else
            {
                // Without a mask map the terrain shader reads a layer's smoothness from its alpha:
                // zero, or the ground mirrors the sky.
                Color[] colours = { new Color(0.24f, 0.36f, 0.16f, 0), new Color(0.52f, 0.44f, 0.32f, 0), new Color(0.45f, 0.45f, 0.44f, 0) };
                for (int i = 0; i < GroundPlan.KitLayers; i++)
                {
                    var texture = new Texture2D(2, 2, TextureFormat.RGBA32, mipChain: false) { name = "plain layer" };
                    texture.SetPixels(new[] { colours[i], colours[i], colours[i], colours[i] });
                    texture.Apply();
                    layers[i] = new TerrainLayer { diffuseTexture = texture, tileSize = new Vector2(4, 4), smoothness = 0, metallic = 0 };
                    owned.Add(texture);
                    owned.Add(layers[i]);
                }
            }
            var tones = new Texture2D(GroundPlan.ToneResolution, GroundPlan.ToneResolution, TextureFormat.RGBA32, mipChain: true) { name = "ground tones", wrapMode = TextureWrapMode.Clamp };
            tones.SetPixels32(plan.Tones);
            tones.Apply(updateMipmaps: true, makeNoLongerReadable: true);
            layers[GroundPlan.Tone] = new TerrainLayer { diffuseTexture = tones, tileSize = new Vector2(plan.Side, plan.Side), smoothness = 0, metallic = 0 };
            owned.Add(tones);
            owned.Add(layers[GroundPlan.Tone]);
            return layers;
        }

        // The scene's own material, with HDRP's terrain shader, is one a build can draw. The
        // pipeline's default terrain material is the editor's and is not in a build: a ground given
        // that one is drawn in the editor and is not there at all in a player.
        public static bool Drawable(Material material) => material != null && material.shader != null && material.shader.isSupported;

        // Rows of the plan handed to the terrain in one step.
        public const int HeightRows = 64, AlphaRows = 512;

        // Builds the ground in steps, and yields whenever a frame has spent `budget` milliseconds
        // on it, as the stands do (PRD v4 7.3.3). `done` takes the terrain. Handed to the terrain
        // in one call, a heightmap of 2,049 took 110 ms, and the visitor walking up to the portal
        // saw one frame of 150 ms (DEC-953). The heights and the layers go in by strips of rows,
        // and the terrain's object is made last, so nothing draws or collides with a ground that
        // is half there. Four steps cannot be cut smaller and are longer than a strip: making the
        // heightmap, making the alphamap, the one pass that works out the terrain's levels of
        // detail from all the heights, and any call that paints layers, however few rows it holds.
        // `owned` takes the terrain's data at once: it belongs to no object, and a load that is
        // stopped half-way must not leave it behind.
        public static IEnumerator Build(GroundPlan plan, TerrainLayer[] layers, Material material, string name, Transform parent, float budget,
            System.Collections.Generic.List<UnityEngine.Object> owned, Action<Terrain> done)
        {
            double sliceStarted = Time.realtimeSinceStartupAsDouble;
            bool Spent() => (Time.realtimeSinceStartupAsDouble - sliceStarted) * 1000 > budget;

            var data = new TerrainData { name = name, heightmapResolution = plan.HeightResolution };
            owned.Add(data);
            if (Spent())
            {
                yield return null;
                sliceStarted = Time.realtimeSinceStartupAsDouble;
            }
            data.alphamapResolution = plan.AlphaResolution;
            data.size = new Vector3(plan.Side, GroundPlan.Height, plan.Side);      // after the resolutions, which reset it
            data.terrainLayers = layers;
            if (Spent())
            {
                yield return null;
                sliceStarted = Time.realtimeSinceStartupAsDouble;
            }

            // A strip is copied out of the plan, because the terrain takes an array's own size.
            int size = plan.HeightResolution;
            float[,] heights = null;
            for (int row = 0; row < size; row += HeightRows)
            {
                int count = Math.Min(HeightRows, size - row);
                if (heights == null || heights.GetLength(0) != count)
                {
                    heights = new float[count, size];
                }
                Buffer.BlockCopy(plan.Normalised, row * size * sizeof(float), heights, 0, count * size * sizeof(float));
                // Without the levels of detail: worked out after every strip, they cost 9 ms a call.
                data.SetHeightsDelayLOD(0, row, heights);
                if (Spent())
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
            data.SyncHeightmap();
            if (Spent())
            {
                yield return null;
                sliceStarted = Time.realtimeSinceStartupAsDouble;
            }

            int n = plan.AlphaResolution;
            float[,,] alphas = null;
            for (int row = 0; row < n; row += AlphaRows)
            {
                int count = Math.Min(AlphaRows, n - row);
                if (alphas == null || alphas.GetLength(0) != count)
                {
                    alphas = new float[count, n, GroundPlan.Layers];
                }
                Buffer.BlockCopy(plan.Alphas, row * n * GroundPlan.Layers * sizeof(float), alphas, 0, count * n * GroundPlan.Layers * sizeof(float));
                data.SetAlphamaps(0, row, alphas);
                if (Spent())
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }

            GameObject ground = Terrain.CreateTerrainGameObject(data);
            ground.name = "Ground";
            ground.transform.SetParent(parent, false);
            ground.transform.localPosition = new Vector3(-plan.Side / 2, -GroundPlan.Floor, -plan.Side / 2);
            var terrain = ground.GetComponent<Terrain>();
            terrain.materialTemplate = material;
            done(terrain);
        }
    }
}
