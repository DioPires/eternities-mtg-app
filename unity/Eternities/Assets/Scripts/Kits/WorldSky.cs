using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.Kits
{
    // A world's sky and lighting rig from its theme row (PRD v4 5.7.1): HDRP's physically based
    // sky, its volumetric clouds and its volumetric fog. The scene holds the sky, the fog and each
    // quality level's clouds (`Generate.LevelProfiles`: volumetric clouds at high and medium, a
    // cloud layer at low); a world lays its own volume over them while the visitor is in it, and
    // the sun is set to the row's (`App.Sunlight`). Dominaria's row: a cumulus sky, which is the
    // clouds' own preset, a warm sun at 35°, and the haze of a wide temperate land. The clouds
    // drift with the wind (PRD v4 5.1.3); reduced motion stills them (5.11.2).
    public sealed class WorldSky : MonoBehaviour
    {
        // The air: light goes this far on average before the haze scatters it, and the haze lies
        // under this height, in metres. Its colour is the low sun's, a little warm.
        public const float MeanFreePath = 900, HazeHeight = 140;
        public static readonly Color HazeAlbedo = new Color(1f, 0.95f, 0.88f);
        // The wind the clouds drift on, in km/h, and from where, in degrees.
        public const float Wind = 22, WindFrom = 250;
        // The view reaches this far in a world: across it, and over the sea to the horizon.
        public const float FarClip = 4000;

        Volume volume;
        VisualEnvironment environment;

        public static WorldSky Create(Transform parent, System.Collections.Generic.List<Object> owned)
        {
            var holder = new GameObject("Sky");
            holder.transform.SetParent(parent, false);
            var sky = holder.AddComponent<WorldSky>();
            sky.volume = holder.AddComponent<Volume>();
            sky.volume.isGlobal = true;
            sky.volume.priority = 5;
            sky.volume.weight = 0;
            VolumeProfile profile = ScriptableObject.CreateInstance<VolumeProfile>();
            owned.Add(profile);
            sky.volume.profile = profile;

            sky.environment = profile.Add<VisualEnvironment>();
            sky.environment.windSpeed.Override(Wind);
            sky.environment.windOrientation.Override(WindFrom);

            var fog = profile.Add<Fog>();
            fog.enabled.Override(true);
            fog.meanFreePath.Override(MeanFreePath);
            fog.baseHeight.Override(0);
            fog.maximumHeight.Override(HazeHeight);
            fog.maxFogDistance.Override(FarClip * 1.5f);
            fog.albedo.Override(HazeAlbedo);
            fog.enableVolumetricFog.Override(true);
            fog.anisotropy.Override(0.7f);
            return sky;
        }

        // On while the visitor is in the world.
        public bool Shown
        {
            set => volume.weight = value ? 1 : 0;
        }

        // Reduced motion: the clouds stand still.
        public bool Still
        {
            set
            {
                if (value != still)
                {
                    still = value;
                    environment.windSpeed.Override(value ? 0 : Wind);
                }
            }
        }

        bool still;
    }
}
