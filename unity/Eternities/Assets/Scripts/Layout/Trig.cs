using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Eternities.Layout
{
    // The committed trig table of PRD v4 5.4.18 (6), read with its SHA-256 asserted first:
    // `contract/test-vectors/v4/layout/trig.bin` holds, for every count k of thousandths of a degree
    // in [0, 360,000), sin and cos of k as little-endian int32 scaled by 2^30, sin then cos, eight
    // bytes a record and no header. The C# checker reads directions from it and computes none
    // (5.4.18 (12)); a table value over 2^30 is an exact rational.
    public sealed class Trig
    {
        public const int Counts = 360_000;
        public const int Shift = 30;
        public const long Scale = 1L << Shift;
        public const int RecordBytes = 8;
        public const string Sha256 = "fa33d5685b879e0f63d26d684e0e39585ce1b6e291b7f1f3543c82949f7bf777";

        readonly int[] values;

        Trig(int[] values)
        {
            this.values = values;
        }

        // The table at `path`. A file that is not the committed table is refused before any value
        // is read from it.
        public static Trig Load(string path)
        {
            byte[] bytes = File.ReadAllBytes(path);
            string digest;
            using (SHA256 sha = SHA256.Create())
            {
                var hex = new StringBuilder(64);
                foreach (byte b in sha.ComputeHash(bytes))
                {
                    hex.Append(b.ToString("x2"));
                }
                digest = hex.ToString();
            }
            if (digest != Sha256)
            {
                throw new InvalidDataException($"{path} has the SHA-256 {digest}; the trig table of PRD v4 5.4.18 (6) has {Sha256}");
            }
            if (bytes.Length != Counts * RecordBytes)
            {
                throw new InvalidDataException($"{path} is {bytes.Length} bytes; the trig table is {Counts * RecordBytes}");
            }
            var values = new int[2 * Counts];
            for (int i = 0; i < values.Length; i++)
            {
                int at = 4 * i;
                values[i] = bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24;
            }
            return new Trig(values);
        }

        // A count outside the table is the caller's defect: 5.4.18 (6) reduces an angle first.
        public long Sin(int count) => values[2 * Index(count)];

        public long Cos(int count) => values[2 * Index(count) + 1];

        static int Index(int count)
        {
            if (count < 0 || count >= Counts)
            {
                throw new ArgumentOutOfRangeException(nameof(count), $"trig count {count} is outside [0, {Counts})");
            }
            return count;
        }

        // The count of an angle in micro-degrees: reduced to one turn, then truncated (5.4.18 (6)).
        public static int CountOf(long micro)
        {
            long reduced = micro % LayoutConstants.MicroPerTurn;
            if (reduced < 0)
            {
                reduced += LayoutConstants.MicroPerTurn;
            }
            return (int)(reduced / LayoutConstants.MicroPerCount);
        }
    }
}
