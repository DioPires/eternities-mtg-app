using Eternities.Data;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // A world's ground: one Unity Terrain (PRD v4 8.4.5), square, centred on the arrival point, as
    // wide as the world and a margin. Day 1 of the slice builds it flat; the kit's noise, the
    // flattening under paths and the layers come with the terrain generator.
    public static class WorldGround
    {
        public const float Margin = 60, Height = 100;

        // PRD v4 8.4.5: 513 for worlds under 100 m of radius, 1,025 to 260 m, 2,049 beyond.
        public static int HeightmapResolution(float worldRadius) => worldRadius < 100 ? 513 : worldRadius <= 260 ? 1025 : 2049;

        public static Terrain Build(WorldData world, Transform parent)
        {
            float radius = world.Layout.WorldRadius / 1000f;
            float side = 2 * (radius + Margin);
            var data = new TerrainData { name = world.Plane.Slug, heightmapResolution = HeightmapResolution(radius) };
            data.size = new Vector3(side, Height, side);    // after the resolution, which resets it

            GameObject ground = Terrain.CreateTerrainGameObject(data);
            ground.name = "Ground";
            ground.transform.SetParent(parent, false);
            ground.transform.localPosition = new Vector3(-side / 2, 0, -side / 2);
            var terrain = ground.GetComponent<Terrain>();
            terrain.materialTemplate = GraphicsSettings.currentRenderPipeline.defaultTerrainMaterial;
            return terrain;
        }
    }
}
