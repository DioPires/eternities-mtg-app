using System;
using System.Numerics;

namespace Eternities.Layout
{
    // The allocator's arithmetic (PRD v4 5.4.1): lengths in integer millimetres, angles in integer
    // micro-degrees clockwise from north, and nothing that depends on a platform's floating point.
    // Every function here is a fixed sequence of integer operations, so the Python implementation of
    // Wave 5 can reproduce each result bit for bit.
    public static class Fixed
    {
        public const long FullTurn = 360_000_000;

        // A direction is (sin, cos) of its angle times this, so north is (0, Unit) and east (Unit, 0).
        public const long Unit = 1_000_000_000;

        // Pi as a ratio, to sixteen digits.
        public static readonly BigInteger PiNum = 3_141_592_653_589_793;
        public static readonly BigInteger PiDen = 1_000_000_000_000_000;

        static readonly BigInteger Scale = BigInteger.Pow(10, 18);

        // The largest integer whose square is at most n.
        public static long ISqrt(long n)
        {
            if (n < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(n));
            }
            long root = (long)Math.Sqrt(n);
            while (root * root > n)
            {
                root--;
            }
            while ((root + 1) * (root + 1) <= n)
            {
                root++;
            }
            return root;
        }

        public static BigInteger ISqrt(BigInteger n)
        {
            if (n.Sign <= 0)
            {
                return BigInteger.Zero;
            }
            // Newton's iteration from above: a power of two that is at least the root.
            BigInteger root = BigInteger.One << (n.ToByteArray().Length * 4 + 1);
            while (true)
            {
                BigInteger next = (root + n / root) >> 1;
                if (next >= root)
                {
                    return root;
                }
                root = next;
            }
        }

        // a / b to the nearest integer, a half away from zero. b is positive.
        public static long RoundDiv(long a, long b)
        {
            return a >= 0 ? (a + b / 2) / b : -((-a + b / 2) / b);
        }

        public static long CeilDiv(BigInteger a, BigInteger b)
        {
            BigInteger quotient = BigInteger.DivRem(a, b, out BigInteger rest);
            return (long)(rest.Sign > 0 ? quotient + 1 : quotient);
        }

        // (sin, cos) of an angle in micro-degrees, times Unit. The angle is folded into the first
        // eighth of a turn and the two series are summed in 18-digit fixed point, every division
        // truncating.
        public static P2 Direction(long microDegrees)
        {
            long angle = ((microDegrees % FullTurn) + FullTurn) % FullTurn;
            int quarter = (int)(angle / 90_000_000);
            long within = angle % 90_000_000;
            bool swap = within > 45_000_000;
            long folded = swap ? 90_000_000 - within : within;

            BigInteger x = folded * PiNum * Scale / (PiDen * 180_000_000);
            BigInteger square = x * x / Scale;
            BigInteger sin = x, cos = Scale, sinTerm = x, cosTerm = Scale;
            for (int k = 1; !(sinTerm.IsZero && cosTerm.IsZero); k++)
            {
                cosTerm = -cosTerm * square / Scale / ((2 * k - 1) * (2 * k));
                sinTerm = -sinTerm * square / Scale / ((2 * k) * (2 * k + 1));
                cos += cosTerm;
                sin += sinTerm;
            }

            BigInteger toUnit = Scale / Unit;
            long s = (long)((sin + toUnit / 2) / toUnit);
            long c = (long)((cos + toUnit / 2) / toUnit);
            if (swap)
            {
                (s, c) = (c, s);
            }
            switch (quarter)
            {
                case 0: return new P2(s, c);
                case 1: return new P2(c, -s);
                case 2: return new P2(-s, -c);
                default: return new P2(-c, s);
            }
        }

        // The angle of a vector, clockwise from north, rounded down to a micro-degree: the largest
        // angle whose direction the vector is on or clockwise of. Floating point only supplies the
        // first guess; the answer is the one the integer test settles on, whatever the guess was.
        public static long Angle(long x, long z)
        {
            if (x == 0 && z == 0)
            {
                throw new ArgumentException("the zero vector has no angle");
            }
            long guess = (long)Math.Floor(Math.Atan2(x, z) * (180_000_000 / Math.PI));
            guess = ((guess % FullTurn) + FullTurn) % FullTurn;
            while (!AtOrPast(guess, x, z))
            {
                guess = (guess + FullTurn - 1) % FullTurn;
            }
            while (AtOrPast((guess + 1) % FullTurn, x, z))
            {
                guess = (guess + 1) % FullTurn;
            }
            return guess;
        }

        // Is the vector on the direction of `angle` or clockwise of it, by less than a quarter turn?
        static bool AtOrPast(long angle, long x, long z)
        {
            P2 d = Direction(angle);
            return (decimal)d.Z * x - (decimal)d.X * z >= 0 && (decimal)d.X * x + (decimal)d.Z * z > 0;
        }
    }

    // A point or a vector on the ground plane, in millimetres: x east, z north.
    public readonly struct P2 : IEquatable<P2>
    {
        public readonly long X;
        public readonly long Z;

        public P2(long x, long z)
        {
            X = x;
            Z = z;
        }

        public long LengthSquared => X * X + Z * Z;

        public static P2 operator +(P2 a, P2 b) => new P2(a.X + b.X, a.Z + b.Z);
        public static P2 operator -(P2 a, P2 b) => new P2(a.X - b.X, a.Z - b.Z);

        public static long Dot(P2 a, P2 b) => a.X * b.X + a.Z * b.Z;

        // Positive when b is clockwise of a (seen from above, north up).
        public static long Clockwise(P2 a, P2 b) => a.Z * b.X - a.X * b.Z;

        public bool Equals(P2 other) => X == other.X && Z == other.Z;
        public override bool Equals(object obj) => obj is P2 other && Equals(other);
        public override int GetHashCode() => (X * 73856093L ^ Z * 19349663L).GetHashCode();
        public override string ToString() => $"({X}, {Z})";
    }

    // splitmix64, seeded with the FNV-1a 64 hash of a string's UTF-8 bytes (PRD v4 5.4.1).
    public struct SplitMix64
    {
        ulong state;

        public SplitMix64(string seed) : this(Fnv1a64(seed))
        {
        }

        public SplitMix64(ulong seed)
        {
            state = seed;
        }

        public static ulong Fnv1a64(string text)
        {
            ulong hash = 14695981039346656037UL;
            foreach (byte b in System.Text.Encoding.UTF8.GetBytes(text))
            {
                hash = unchecked((hash ^ b) * 1099511628211UL);
            }
            return hash;
        }

        public ulong Next()
        {
            unchecked
            {
                state += 0x9E3779B97F4A7C15UL;
                ulong z = state;
                z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
                z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
                return z ^ (z >> 31);
            }
        }

        // 0 to bound - 1, by remainder. The bias of the remainder is far below anything the layout
        // can show, and a rejection loop would be one more thing for two languages to agree on.
        public int Below(int bound) => (int)(Next() % (ulong)bound);
    }
}
