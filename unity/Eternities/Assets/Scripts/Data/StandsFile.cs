using System;
using System.IO;
using System.Text;
using Unity.Collections;

namespace Eternities.Data
{
    // `stands.bin` of contract v4 (PRD v4 4.13.3, docs/data-contract-v4.md section 3), read once into
    // structure-of-arrays native collections: one array a field, indexed by stand index, the
    // record's position in the file. The 16-byte header of contract v3 section 2 comes first, at
    // version 4 and kind 1, then one 48-byte little-endian record a stand.
    public sealed class StandsFile : IDisposable
    {
        public const int HeaderBytes = 16, RecordBytes = 48, ContractVersion = 4, Kind = 1;

        public readonly int Count;
        public NativeArray<byte> Oracle;        // 16 bytes a stand, RFC 4122 network order
        public NativeArray<byte> Plane, Mask, Class, Rarity, Types, BackImage;
        public NativeArray<ushort> Site, SetId, Printings, Swatch, Shard, ShardIndex, Cluster;
        public NativeArray<int> X, Z, Yaw;      // millimetres, micro-degrees

        StandsFile(int count, Allocator allocator)
        {
            Count = count;
            Oracle = new NativeArray<byte>(16 * count, allocator);
            Plane = new NativeArray<byte>(count, allocator);
            Mask = new NativeArray<byte>(count, allocator);
            Class = new NativeArray<byte>(count, allocator);
            Rarity = new NativeArray<byte>(count, allocator);
            Types = new NativeArray<byte>(count, allocator);
            BackImage = new NativeArray<byte>(count, allocator);
            Site = new NativeArray<ushort>(count, allocator);
            SetId = new NativeArray<ushort>(count, allocator);
            Printings = new NativeArray<ushort>(count, allocator);
            Swatch = new NativeArray<ushort>(count, allocator);
            Shard = new NativeArray<ushort>(count, allocator);
            ShardIndex = new NativeArray<ushort>(count, allocator);
            Cluster = new NativeArray<ushort>(count, allocator);
            X = new NativeArray<int>(count, allocator);
            Z = new NativeArray<int>(count, allocator);
            Yaw = new NativeArray<int>(count, allocator);
        }

        // The file's records, or an InvalidDataException that names what is wrong with the header
        // or the length. The caller disposes the result.
        public static StandsFile Read(byte[] data, Allocator allocator = Allocator.Persistent)
        {
            if (data.Length < HeaderBytes)
            {
                throw new InvalidDataException($"stands.bin holds {data.Length} bytes, fewer than its {HeaderBytes}-byte header");
            }
            string magic = Encoding.ASCII.GetString(data, 0, 4);
            int kind = data[4], version = data[5], reserved = U16(data, 6);
            uint count = U32(data, 8), tail = U32(data, 12);
            if (magic != "ETRN" || kind != Kind || version != ContractVersion || reserved != 0 || tail != 0)
            {
                throw new InvalidDataException($"the header of stands.bin reads magic '{magic}', kind {kind}, version {version}, reserved {reserved} and {tail}; "
                    + $"a stands file is 'ETRN', kind {Kind}, version {ContractVersion}, with both reserved fields 0");
            }
            if (data.Length - HeaderBytes != (long)count * RecordBytes)
            {
                throw new InvalidDataException($"the header of stands.bin counts {count} records of {RecordBytes} bytes and the file holds {data.Length - HeaderBytes} bytes after its header");
            }
            var stands = new StandsFile((int)count, allocator);
            for (int i = 0; i < count; i++)
            {
                int at = HeaderBytes + i * RecordBytes;
                for (int b = 0; b < 16; b++)
                {
                    stands.Oracle[16 * i + b] = data[at + b];
                }
                stands.Plane[i] = data[at + 16];
                stands.Mask[i] = data[at + 17];
                stands.Class[i] = data[at + 18];
                stands.Rarity[i] = data[at + 19];
                stands.Types[i] = data[at + 20];
                stands.BackImage[i] = data[at + 21];
                stands.Site[i] = (ushort)U16(data, at + 22);
                stands.SetId[i] = (ushort)U16(data, at + 24);
                stands.Printings[i] = (ushort)U16(data, at + 26);
                stands.X[i] = (int)U32(data, at + 28);
                stands.Z[i] = (int)U32(data, at + 32);
                stands.Yaw[i] = (int)U32(data, at + 36);
                stands.Swatch[i] = (ushort)U16(data, at + 40);
                stands.Shard[i] = (ushort)U16(data, at + 42);
                stands.ShardIndex[i] = (ushort)U16(data, at + 44);
                stands.Cluster[i] = (ushort)U16(data, at + 46);
            }
            return stands;
        }

        static int U16(byte[] data, int at) => data[at] | data[at + 1] << 8;
        static uint U32(byte[] data, int at) => (uint)(data[at] | data[at + 1] << 8 | data[at + 2] << 16 | data[at + 3] << 24);

        // The stand's `oracle_id` as canonical UUID text, lower case.
        public string OracleId(int stand)
        {
            var text = new StringBuilder(36);
            for (int i = 0; i < 16; i++)
            {
                if (i == 4 || i == 6 || i == 8 || i == 10)
                {
                    text.Append('-');
                }
                text.Append(Oracle[16 * stand + i].ToString("x2"));
            }
            return text.ToString();
        }

        // The index of the stand's card among the plane's cards in v3 star order: the shard index
        // and the index within the shard (docs/data-contract-v4.md section 7, departure 5).
        public int CardIndex(int stand, int shardSize) => Shard[stand] * shardSize + ShardIndex[stand];

        public void Dispose()
        {
            if (!X.IsCreated)
            {
                return;
            }
            Oracle.Dispose();
            Plane.Dispose();
            Mask.Dispose();
            Class.Dispose();
            Rarity.Dispose();
            Types.Dispose();
            BackImage.Dispose();
            Site.Dispose();
            SetId.Dispose();
            Printings.Dispose();
            Swatch.Dispose();
            Shard.Dispose();
            ShardIndex.Dispose();
            Cluster.Dispose();
            X.Dispose();
            Z.Dispose();
            Yaw.Dispose();
        }
    }
}
