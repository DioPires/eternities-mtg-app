namespace Eternities.Layout
{
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
