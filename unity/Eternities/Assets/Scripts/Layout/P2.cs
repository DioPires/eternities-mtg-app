using System;

namespace Eternities.Layout
{
    // A point or a vector on the ground plane: x east, z north. A position of the pack is in
    // millimetres; a rebuilt shape of the checker is over the trig table's 2^30 (`Checker`).
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

        public bool Equals(P2 other) => X == other.X && Z == other.Z;
        public override bool Equals(object obj) => obj is P2 other && Equals(other);
        public override int GetHashCode() => (X * 73856093L ^ Z * 19349663L).GetHashCode();
        public override string ToString() => $"({X}, {Z})";
    }
}
