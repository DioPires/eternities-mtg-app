using System;
using System.Collections.Generic;
using UnityEngine;

namespace Eternities.Audio
{
    // A world's sound (PRD v4 5.12.1, 5.12.3, 8.6): the ambient bed, one loop per ambient family,
    // crossfaded at region boundaries as the listener crosses them; and every body of water as a
    // positional source with distance attenuation, so that a river is heard before it is seen. A
    // body of water is long and a source is a point, so each source rides its water: each frame it
    // sits at the point of the water nearest the listener.
    //
    // The attenuation is the inverse-distance law, faded to silence before the source's far
    // distance (`Level`). It fell linearly at first, and a river 70 m away and out of sight still
    // played at half its level: the owner's walk heard water where none could be seen (DEC-1005).
    //
    // A loop is played into itself with a crossfade of `Overlap` seconds (as 5.12.2 loops music),
    // on two sources a loop, so a recording that does not end where it begins has no seam.
    public sealed class WorldSound : MonoBehaviour
    {
        public const float BedVolume = 0.55f;
        // A family's share of the bed follows the listener's region at this pace: the 20 m blend of
        // the ground is crossed in a few seconds at a walk.
        public const float FadeSeconds = 1.5f;
        public const float Overlap = 3;
        // The last share of the way to a source's far distance, over which its level fades to none.
        public const float FadeShare = 0.4f;
        public const int RolloffKeys = 32;

        // One loop on two sources, crossfading into itself.
        sealed class Loop
        {
            public AudioSource A, B;
            public float Volume;            // what the loop plays at, before its own crossfade
            bool onB;
            double switched;

            public bool Playing => A.isPlaying || B.isPlaying;

            public void Start()
            {
                A.time = 0;
                A.Play();
                onB = false;
                switched = AudioSettings.dspTime;
            }

            public void Stop()
            {
                A.Stop();
                B.Stop();
            }

            public void Step()
            {
                AudioClip clip = A.clip;
                AudioSource now = onB ? B : A, before = onB ? A : B;
                float length = clip.length, fade = Mathf.Min(Overlap, length / 4);
                if (now.isPlaying && now.time >= length - fade && !before.isPlaying)
                {
                    before.time = 0;
                    before.Play();
                    onB = !onB;
                    switched = AudioSettings.dspTime;
                    (now, before) = (before, now);
                }
                float into = Mathf.Clamp01((float)(AudioSettings.dspTime - switched) / fade);
                now.volume = Volume * Mathf.Sin(into * Mathf.PI / 2);
                if (before.isPlaying)
                {
                    before.volume = Volume * Mathf.Cos(into * Mathf.PI / 2);
                    if (into >= 1)
                    {
                        before.Stop();
                    }
                }
            }
        }

        // A positional source on a body of water.
        sealed class Emitter
        {
            public Loop Sound;
            public Func<Vector3, Vector3> Nearest;
        }

        readonly Dictionary<string, Loop> beds = new Dictionary<string, Loop>();
        readonly Dictionary<string, float> levels = new Dictionary<string, float>();
        readonly List<Emitter> emitters = new List<Emitter>();
        Func<Vector3, (string Here, string Across, float Share)> families;
        Transform listener;
        bool started, riverFound;

        // The first river's source, or the first water's where there is no river.
        public AudioSource River { get; private set; }
        public int Beds => beds.Count;
        public int Emitters => emitters.Count;

        // `families` gives, at a place, the ambient family of its region, that of the region
        // across the nearest boundary and that one's share, from 0 to a half.
        public static WorldSound Create(Transform parent, Transform listener, Func<Vector3, (string, string, float)> families)
        {
            var holder = new GameObject("Sound");
            holder.transform.SetParent(parent, false);
            var sound = holder.AddComponent<WorldSound>();
            sound.listener = listener;
            sound.families = families;
            return sound;
        }

        AudioSource Source(string name, AudioClip clip, Transform parent)
        {
            var holder = new GameObject(name);
            holder.transform.SetParent(parent, false);
            var source = holder.AddComponent<AudioSource>();
            source.clip = clip;
            source.loop = false;
            source.playOnAwake = false;
            source.dopplerLevel = 0;
            source.volume = 0;
            return source;
        }

        // A family's bed, at `level` of the bed's volume (`KitLoop.Level`).
        public void Bed(string family, AudioClip clip, float level = 1)
        {
            if (clip == null || beds.ContainsKey(family))
            {
                return;
            }
            levels[family] = level;
            var loop = new Loop { A = Source($"{family} bed", clip, transform), B = Source($"{family} bed", clip, transform) };
            loop.A.spatialBlend = loop.B.spatialBlend = 0;
            beds[family] = loop;
        }

        // A body of water's source: at full level within `near` metres of the water, and silent past `far`.
        public void Water(string name, AudioClip clip, Func<Vector3, Vector3> nearest, float near, float far, float volume, float spread)
        {
            if (clip == null)
            {
                return;
            }
            var holder = new GameObject($"{name} sound");
            holder.transform.SetParent(transform, false);
            var loop = new Loop { A = Source(name, clip, holder.transform), B = Source(name, clip, holder.transform), Volume = volume };
            AnimationCurve rolloff = Rolloff(near, far);
            foreach (AudioSource source in new[] { loop.A, loop.B })
            {
                source.spatialBlend = 1;
                source.rolloffMode = AudioRolloffMode.Custom;
                source.minDistance = near;
                source.maxDistance = far;
                source.SetCustomCurve(AudioSourceCurveType.CustomRolloff, rolloff);
                source.spread = spread;
            }
            emitters.Add(new Emitter { Sound = loop, Nearest = nearest });
            if (name.StartsWith("river", StringComparison.Ordinal) && !riverFound)
            {
                River = loop.A;
                riverFound = true;
            }
            else if (River == null)
            {
                River = loop.A;
            }
        }

        // A water source's level at a distance, from 0 to 1: full within `near`, then `near` over
        // the distance (the inverse-distance law), faded to none over the last `FadeShare` of the
        // way to `far`.
        public static float Level(float distance, float near, float far)
        {
            if (distance <= near)
            {
                return 1;
            }
            if (distance >= far)
            {
                return 0;
            }
            float fadeFrom = far * (1 - FadeShare);
            float fade = distance <= fadeFrom ? 1 : 1 - Mathf.SmoothStep(0, 1, (distance - fadeFrom) / (far - fadeFrom));
            return near / distance * fade;
        }

        // `Level` as the engine's custom roll-off, whose curve runs over the distance as a share of
        // `far`: keys spaced evenly in the logarithm of the distance from `near` on, where the law
        // bends most, each with its slope, so the curve does not step between them.
        public static AnimationCurve Rolloff(float near, float far)
        {
            var keys = new Keyframe[RolloffKeys + 1];
            keys[0] = new Keyframe(0, 1, 0, 0);
            float start = Mathf.Log(near), span = Mathf.Log(far) - start;
            for (int k = 1; k <= RolloffKeys; k++)
            {
                float distance = Mathf.Exp(start + span * (k - 1) / (RolloffKeys - 1));
                float h = Mathf.Max(1e-3f, distance * 1e-3f);
                float slope = (Level(Mathf.Min(far, distance + h), near, far) - Level(Mathf.Max(near, distance - h), near, far)) / (Mathf.Min(far, distance + h) - Mathf.Max(near, distance - h)) * far;
                keys[k] = new Keyframe(distance / far, Level(distance, near, far), slope, slope);
            }
            keys[1].inTangent = 0;
            return new AnimationCurve(keys);
        }

        // The beds' shares at the listener now, at once: on arrival, where the bed starts as it is.
        public void Settle()
        {
            Follow(snap: true);
        }

        void Follow(bool snap)
        {
            if (listener == null || families == null)
            {
                return;
            }
            (string here, string across, float share) = families(listener.position);
            float k = snap ? 1 : 1 - Mathf.Exp(-Time.unscaledDeltaTime / FadeSeconds);
            foreach (KeyValuePair<string, Loop> bed in beds)
            {
                float wanted = BedVolume * levels[bed.Key] * ((bed.Key == here ? 1 - share : 0) + (bed.Key == across ? share : 0));
                bed.Value.Volume = Mathf.Lerp(bed.Value.Volume, wanted, k);
                if (bed.Value.Volume > 0.002f && !bed.Value.Playing)
                {
                    bed.Value.Start();
                }
                else if (bed.Value.Volume <= 0.002f && bed.Value.Playing && wanted == 0)
                {
                    bed.Value.Stop();
                }
            }
            foreach (Emitter emitter in emitters)
            {
                Vector3 at = emitter.Nearest(listener.position);
                emitter.Sound.A.transform.parent.position = at;
                float far = emitter.Sound.A.maxDistance;
                bool heard = (at - listener.position).sqrMagnitude < far * far;
                if (heard && !emitter.Sound.Playing)
                {
                    emitter.Sound.Start();
                }
                else if (!heard && emitter.Sound.Playing)
                {
                    emitter.Sound.Stop();
                }
            }
        }

        void LateUpdate()
        {
            if (!started)
            {
                started = true;
                Follow(snap: true);
            }
            Follow(snap: false);
            foreach (Loop bed in beds.Values)
            {
                if (bed.Playing)
                {
                    bed.Step();
                }
            }
            foreach (Emitter emitter in emitters)
            {
                if (emitter.Sound.Playing)
                {
                    emitter.Sound.Step();
                }
            }
        }

        // The point of a line nearest a position, on the ground's plane at the line's height.
        public static Vector3 NearestOnLine(IReadOnlyList<Vector3> line, Vector3 position)
        {
            Vector3 best = line[0];
            float bestDistance = float.MaxValue;
            for (int i = 0; i + 1 < line.Count; i++)
            {
                Vector3 a = line[i], along = line[i + 1] - a;
                float t = along.sqrMagnitude > 0 ? Mathf.Clamp01(Vector3.Dot(position - a, along) / along.sqrMagnitude) : 0;
                Vector3 point = a + along * t;
                float d = (point - position).sqrMagnitude;
                if (d < bestDistance)
                {
                    bestDistance = d;
                    best = point;
                }
            }
            return best;
        }
    }
}
