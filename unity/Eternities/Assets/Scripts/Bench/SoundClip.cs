using System;
using System.IO;
using System.Text;
using System.Threading;
using UnityEngine;

namespace Eternities.Bench
{
    // What the listener hears, kept: checkpoint 6 of PRD v4 9.3 is a water body with its sound, and
    // a run with captures writes the sound beside the picture. It sits on the listener's own
    // object, where the engine hands it the finished mix on the audio thread, and it changes none
    // of it.
    public sealed class SoundClip : MonoBehaviour
    {
        float[] samples;        // interleaved, as the engine hands them over
        int written;
        volatile bool taking;

        public int SampleRate { get; private set; }
        public int Channels { get; private set; }
        public int Frames => Volatile.Read(ref written) / Channels;
        public bool Taking { get => taking; set => taking = value; }

        public static SoundClip On(AudioListener listener, double seconds)
        {
            var clip = listener.gameObject.AddComponent<SoundClip>();
            clip.SampleRate = AudioSettings.outputSampleRate;
            AudioSpeakerMode mode = AudioSettings.speakerMode;
            clip.Channels = mode == AudioSpeakerMode.Mono ? 1 : mode == AudioSpeakerMode.Quad ? 4 : mode == AudioSpeakerMode.Surround ? 5
                : mode == AudioSpeakerMode.Mode5point1 ? 6 : mode == AudioSpeakerMode.Mode7point1 ? 8 : 2;
            clip.samples = new float[(int)(seconds * clip.SampleRate) * clip.Channels];
            return clip;
        }

        void OnAudioFilterRead(float[] data, int channels)
        {
            if (!taking || channels != Channels)
            {
                return;
            }
            int at = Volatile.Read(ref written);
            int count = Math.Min(data.Length, samples.Length - at);
            Array.Copy(data, 0, samples, at, count);
            Volatile.Write(ref written, at + count);
        }

        // The level of one channel over a stretch of frames, as a root mean square of full scale.
        public double Level(int fromFrame, int toFrame, int channel)
        {
            double sum = 0;
            for (int frame = fromFrame; frame < toFrame; frame++)
            {
                double sample = samples[frame * Channels + channel];
                sum += sample * sample;
            }
            return toFrame > fromFrame ? Math.Sqrt(sum / (toFrame - fromFrame)) : 0;
        }

        // A WAV file of what was kept, 16 bits a sample.
        public void Write(string file)
        {
            int count = Volatile.Read(ref written);
            using (var stream = new BinaryWriter(File.Create(file)))
            {
                stream.Write(Encoding.ASCII.GetBytes("RIFF"));
                stream.Write(36 + count * 2);
                stream.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
                stream.Write(16);
                stream.Write((short)1);
                stream.Write((short)Channels);
                stream.Write(SampleRate);
                stream.Write(SampleRate * Channels * 2);
                stream.Write((short)(Channels * 2));
                stream.Write((short)16);
                stream.Write(Encoding.ASCII.GetBytes("data"));
                stream.Write(count * 2);
                for (int i = 0; i < count; i++)
                {
                    stream.Write((short)Mathf.RoundToInt(Mathf.Clamp(samples[i], -1, 1) * short.MaxValue));
                }
            }
        }
    }
}
