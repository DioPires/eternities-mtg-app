using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.Kits
{
    // The slice's water (PRD v4 9.5, 8.1.2): one river and one lake of the HDRP water system, laid
    // over the bed the ground plan carved. Each is an instance of a kit prefab, so what the owner
    // tunes by eye (flow, ripples, foam, colour) lives in two files and nowhere in code; this only
    // puts them where the plan says, at the plan's water level, as wide as the bed and its banks.
    public static class WorldWater
    {
        // Water is one of the switches of the HDRP asset in force. With it off the pipeline draws no
        // water surface, and none is made.
        public static bool Supported => GraphicsSettings.currentRenderPipeline is HDRenderPipelineAsset asset && asset.currentPlatformRenderPipelineSettings.supportWater;

        // `owned` takes what was made here and belongs to no object: it leaves with the world.
        public static GameObject Build(GroundPlan plan, GameObject riverPrefab, GameObject lakePrefab, Transform parent, System.Collections.Generic.List<Object> owned)
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

            // The river: a quad along the bed, its long side the way the water runs.
            Vector2 along = plan.RiverTo - plan.RiverFrom, middle = (plan.RiverFrom + plan.RiverTo) / 2;
            GameObject river = Object.Instantiate(riverPrefab, root.transform);
            river.name = "River";
            river.transform.SetPositionAndRotation(new Vector3(middle.x, GroundPlan.WaterLevel, middle.y), Quaternion.LookRotation(new Vector3(along.x, 0, along.y)));
            river.transform.localScale = new Vector3(2 * (GroundPlan.RiverHalfWidth + GroundPlan.Bank), 1, along.magnitude);

            // The lake: a quad over the basin. Outside the basin the ground is above it.
            GameObject lake = Object.Instantiate(lakePrefab, root.transform);
            lake.name = "Lake";
            float side = 2 * (GroundPlan.LakeRadius + GroundPlan.Bank);
            lake.transform.position = new Vector3(plan.LakeCentre.x, GroundPlan.WaterLevel, plan.LakeCentre.y);
            lake.transform.localScale = new Vector3(side, 1, side);
            return root;
        }
    }
}
