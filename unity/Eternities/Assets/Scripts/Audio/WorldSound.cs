using UnityEngine;

namespace Eternities.Audio
{
    // A world's sound in the slice (PRD v4 5.12, 8.6): one ambient bed, and the river as a positional
    // source with distance attenuation, so it is heard before it is seen. The river is long and a
    // source is a point, so the source rides the river: each frame it sits at the point of the
    // river nearest the listener.
    public sealed class WorldSound : MonoBehaviour
    {
        // The river is at full level within 6 m of the water and silent past 140 m.
        public const float RiverNear = 6, RiverFar = 140;
        public const float BedVolume = 0.5f, RiverVolume = 0.9f;

        Vector3 riverFrom, riverTo;
        AudioSource river;
        Transform listener;

        public AudioSource Bed { get; private set; }
        public AudioSource River => river;

        public static WorldSound Create(Transform parent, AudioClip bed, AudioClip riverLoop, Vector3 riverFrom, Vector3 riverTo, Transform listener)
        {
            var holder = new GameObject("Sound");
            holder.transform.SetParent(parent, false);
            var sound = holder.AddComponent<WorldSound>();
            sound.riverFrom = riverFrom;
            sound.riverTo = riverTo;
            sound.listener = listener;

            sound.Bed = holder.AddComponent<AudioSource>();
            sound.Bed.clip = bed;
            sound.Bed.loop = true;
            sound.Bed.spatialBlend = 0;
            sound.Bed.volume = BedVolume;
            sound.Bed.playOnAwake = false;

            var riverHolder = new GameObject("River sound");
            riverHolder.transform.SetParent(holder.transform, false);
            sound.river = riverHolder.AddComponent<AudioSource>();
            sound.river.clip = riverLoop;
            sound.river.loop = true;
            sound.river.spatialBlend = 1;
            sound.river.rolloffMode = AudioRolloffMode.Linear;
            sound.river.minDistance = RiverNear;
            sound.river.maxDistance = RiverFar;
            sound.river.dopplerLevel = 0;
            sound.river.spread = 60;    // a river is wider than a point
            sound.river.volume = RiverVolume;
            sound.river.playOnAwake = false;
            sound.Follow();
            if (bed != null)
            {
                sound.Bed.Play();
            }
            if (riverLoop != null)
            {
                sound.river.Play();
            }
            return sound;
        }

        // The point of the river nearest a position.
        public Vector3 NearestOnRiver(Vector3 position)
        {
            Vector3 along = riverTo - riverFrom;
            float t = Mathf.Clamp01(Vector3.Dot(position - riverFrom, along) / along.sqrMagnitude);
            return riverFrom + along * t;
        }

        void Follow()
        {
            if (listener != null)
            {
                river.transform.position = NearestOnRiver(listener.position);
            }
        }

        void LateUpdate()
        {
            Follow();
        }
    }
}
