using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Eternities.Kits
{
    // A world's ground (PRD v4 8.4.5): Unity Terrain in square tiles of `DressPlan.TileTexels`
    // texels, each with the plan's heights and the layers that its part of the world uses, at
    // most eight, as `DressPlan.Paint` weighed them. The tiles meet sample for sample and texel for
    // texel, so no seam shows. A tile of more than four layers takes the terrain shader's
    // eight-layer variant.
    public static class WorldGround
    {
        // The terrain's floor and its height, in metres from the ground level: the sea's bed is
        // above the floor and the hills past the world's edge are under the ceiling.
        public const float Floor = -15, Height = 70;

        // The scene's own materials, with HDRP's terrain shader, are ones a build can draw. The
        // pipeline's default terrain material is the editor's and is not in a build: a ground given
        // that one is drawn in the editor and is not there at all in a player.
        public static bool Drawable(Material material) => material != null && material.shader != null && material.shader.isSupported;

        // Heights handed to a tile in one step, in rows.
        public const int HeightRows = 64;

        // Builds the tiles one after another, and yields whenever a frame has spent `budget`
        // milliseconds on them (PRD v4 7.3.3). `layers` are the plan's layers by name;
        // `fourLayers` and `eightLayers` the ground's materials for a tile of up to four layers and
        // of more. `owned` takes each tile's data at once: it belongs to no object, and a load that
        // is stopped half-way must not leave it behind. `done` takes the tiles.
        public static IEnumerator Build(DressPlan plan, Func<string, TerrainLayer> layers, Material fourLayers, Material eightLayers, string name,
            Transform parent, float budget, List<UnityEngine.Object> owned, Action<Terrain[]> done)
        {
            double sliceStarted = Time.realtimeSinceStartupAsDouble;
            bool Spent() => (Time.realtimeSinceStartupAsDouble - sliceStarted) * 1000 > budget;
            int tiles = plan.Tiles, side = DressPlan.TileTexels, samples = side + 1, all = plan.Samples;
            float metres = side * plan.Grid.Texel;
            var made = new Terrain[tiles * tiles];
            var heights = new float[HeightRows, samples];
            var root = new GameObject("Ground");
            root.transform.SetParent(parent, false);
            for (int tz = 0; tz < tiles; tz++)
            {
                for (int tx = 0; tx < tiles; tx++)
                {
                    TileLayers paint = plan.TileLayers[tz * tiles + tx];
                    var data = new TerrainData { name = $"{name} {tx},{tz}", heightmapResolution = samples };
                    owned.Add(data);
                    data.alphamapResolution = side;
                    data.baseMapResolution = 256;
                    data.size = new Vector3(metres, Height, metres);       // after the resolutions, which reset it
                    var tileLayers = new TerrainLayer[paint.Layers.Length];
                    for (int k = 0; k < tileLayers.Length; k++)
                    {
                        tileLayers[k] = layers(plan.LayerNames[paint.Layers[k]]);
                    }
                    data.terrainLayers = tileLayers;
                    for (int row = 0; row < samples; row += HeightRows)
                    {
                        int count = Math.Min(HeightRows, samples - row);
                        float[,] strip = count == HeightRows ? heights : new float[count, samples];
                        for (int r = 0; r < count; r++)
                        {
                            int from = (tz * side + row + r) * all + tx * side;
                            for (int c = 0; c < samples; c++)
                            {
                                strip[r, c] = Mathf.Clamp01((plan.Heights[from + c] - Floor) / Height);
                            }
                        }
                        // Without the levels of detail: worked out after every strip, they cost 9 ms a call.
                        data.SetHeightsDelayLOD(0, row, strip);
                        if (Spent())
                        {
                            yield return null;
                            sliceStarted = Time.realtimeSinceStartupAsDouble;
                        }
                    }
                    data.SyncHeightmap();
                    data.SetAlphamaps(0, 0, paint.Alphas);
                    paint.Alphas = null;    // the terrain holds them now
                    GameObject tile = Terrain.CreateTerrainGameObject(data);
                    tile.name = $"Ground {tx},{tz}";
                    tile.transform.SetParent(root.transform, false);
                    tile.transform.localPosition = new Vector3(plan.Grid.Min + tx * metres, Floor, plan.Grid.Min + tz * metres);
                    var terrain = tile.GetComponent<Terrain>();
                    terrain.materialTemplate = tileLayers.Length > 4 ? eightLayers : fourLayers;
                    terrain.drawInstanced = true;       // the ground's materials ask a build for the variants (`Generate.Ground`)
                    terrain.drawTreesAndFoliage = false;
                    terrain.heightmapPixelError = 4;
                    terrain.basemapDistance = 400;
                    terrain.groupingID = 1;
                    terrain.allowAutoConnect = true;
                    made[tz * tiles + tx] = terrain;
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
            Terrain.SetConnectivityDirty();
            done(made);
        }
    }

    // The ground's switch: a renderer that draws nothing, whose `enabled` the world's terrain
    // tiles follow. Whatever turns the ground off and on through a renderer (the bench's prices,
    // `BenchPrices`) turns the terrain with it.
    public sealed class GroundSwitch : MonoBehaviour
    {
        public Terrain[] Tiles = new Terrain[0];
        Renderer own;
        bool shown = true;

        public static Renderer Create(Transform parent, Terrain[] tiles)
        {
            var holder = new GameObject("Ground switch");
            holder.transform.SetParent(parent, false);
            var renderer = holder.AddComponent<MeshRenderer>();
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            var ground = holder.AddComponent<GroundSwitch>();
            ground.Tiles = tiles;
            ground.own = renderer;
            return renderer;
        }

        void LateUpdate()
        {
            if (own.enabled == shown)
            {
                return;
            }
            shown = own.enabled;
            foreach (Terrain tile in Tiles)
            {
                tile.drawHeightmap = shown;
            }
        }
    }
}
