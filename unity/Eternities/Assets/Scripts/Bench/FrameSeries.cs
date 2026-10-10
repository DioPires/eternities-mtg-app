using System;
using System.Collections.Generic;

namespace Eternities.Bench
{
    // One block of frame times of a bench run (the bench design on DEC-953, section 5): one sample
    // a frame, the wall-clock time between the starts of two frames in milliseconds, held in a
    // buffer allocated before the run. Percentiles are by nearest rank, each frame counted once.
    public sealed class FrameSeries
    {
        readonly float[] samples;
        float[] sorted;

        public int Count { get; private set; }
        public int Dropped { get; private set; }    // frames that came after the buffer was full
        public double Seconds { get; private set; }
        public float LongestMs { get; private set; }
        public double LongestAtSeconds { get; private set; }
        public string LongestSegment { get; private set; }

        public FrameSeries(int capacity)
        {
            samples = new float[capacity];
        }

        public void Add(float milliseconds, double atSeconds, string segment)
        {
            if (Count == samples.Length)
            {
                Dropped++;
                return;
            }
            samples[Count++] = milliseconds;
            sorted = null;
            Seconds += milliseconds / 1000.0;
            if (milliseconds > LongestMs)
            {
                LongestMs = milliseconds;
                LongestAtSeconds = atSeconds;
                LongestSegment = segment;
            }
        }

        // The value at rank ceil(percent / 100 x count) of the sorted samples; 0 for an empty block.
        public float Percentile(int percent)
        {
            if (Count == 0)
            {
                return 0;
            }
            if (sorted == null)
            {
                sorted = new float[Count];
                Array.Copy(samples, sorted, Count);
                Array.Sort(sorted);
            }
            int rank = (int)((long)percent * Count + 99) / 100;
            return sorted[Math.Max(rank, 1) - 1];
        }

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["count"] = Count, ["seconds"] = Math.Round(Seconds, 3),
                ["p50Ms"] = Percentile(50), ["p90Ms"] = Percentile(90), ["p99Ms"] = Percentile(99), ["longestMs"] = LongestMs,
            };
        }
    }
}
