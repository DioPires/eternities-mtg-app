using UnityEngine;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.Kits
{
    // In the editor, a world's water follows its prefab while the game plays (DEC-953). The owner
    // tunes the river and the lake by eye from the bank, which means in play mode, and what is
    // tuned has to end up in the kit's two prefab files. An object made from a prefab at run time
    // is a copy that no longer knows its prefab: a change made to the prefab in the Inspector
    // would show at the next arrival, and a change made to the copy would be lost when play
    // stops. With this on the copy, the prefab is the one place to change, and the water shows it
    // within a quarter of a second. A player's prefabs never change, and none is made there.
    public sealed class WaterTuning : MonoBehaviour
    {
        const float Interval = 0.25f;

        WaterSurface prefab, surface;
        string held;
        float next;

        public static void Follow(GameObject instance, GameObject prefab)
        {
            if (!Application.isEditor)
            {
                return;
            }
            var tuning = instance.AddComponent<WaterTuning>();
            tuning.prefab = prefab.GetComponent<WaterSurface>();
            tuning.surface = instance.GetComponent<WaterSurface>();
            tuning.held = JsonUtility.ToJson(tuning.prefab);
        }

        void Update()
        {
            if (Time.unscaledTime < next)
            {
                return;
            }
            next = Time.unscaledTime + Interval;
            string now = JsonUtility.ToJson(prefab);
            if (now != held)
            {
                held = now;
                JsonUtility.FromJsonOverwrite(now, surface);
            }
        }
    }
}
