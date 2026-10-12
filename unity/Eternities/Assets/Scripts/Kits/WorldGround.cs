using System;
using System.Collections;
using Eternities.Layout;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // What a world's ground is made from, worked out away from the main thread: which of the kit's
    // layers lies where, and the tone of each wedge's ground. It needs the layout and nothing of
    // the engine.
    public sealed class GroundPlan
    {
        // The kit's three layers, and after them the world's own: its tones.
        public const int Meadow = 0, Path = 1, Gravel = 2, KitLayers = 3, Tone = 3, Layers = 4;
        // PRD v4 5.6.3: the kit varies its ground by wedge, so the ground under a wedge reads as its
        // colour (9.3). One layer more holds a picture of the whole world, each wedge in its tone,
        // and this share of the ground between the paths is that picture; the rest is the kit's own
        // layer for the wedge, the meadow or bare stone. A layer for each wedge would be nine, and
        // the pipeline's terrain shader draws four in its lighter variant.
        public const float ToneShare = 0.45f;
        // The picture's side in texels: about 2 m of Dominaria to a texel.
        public const int ToneResolution = 512;
        // Two wedges' tones run into each other within this many degrees of their boundary. Inside
        // the world a radial path lies on it; beyond the rim nothing does.
        public const double ToneBlend = 1.5;
        public const float Margin = 120;
        // The ground level of everything the allocator placed is 0. The terrain's own floor lies
        // this far below it, so the kit can carve a river bed, and its ceiling as far above.
        public const float Floor = 50, Height = 100;
        // The relief keeps this far from anything flat, then rises to full height over the falloff.
        public const float FlatApron = 1.5f, Falloff = 10;
        // The bed is at its full depth within the half width or the radius, and rises to the ground
        // level over the bank beyond it.
        public const float WaterLevel = -0.6f, RiverDepth = 1.6f, RiverHalfWidth = 3.5f, LakeDepth = 3.5f, LakeRadius = 45, Bank = 5;

        public float Radius, Side;      // metres
        public int HeightResolution, AlphaResolution;
        public float[,] Heights;        // [z, x], metres above the ground level
        public float[,] Normalised;     // the same as Unity Terrain takes them: 0 at its floor, 1 at its ceiling
        public float[,,] Alphas;        // [z, x, layer], as Unity Terrain takes them
        public Color32[] Tones;         // [z * ToneResolution + x]: the tone layer's texture, with no alpha, so no gloss
        // The slice's water (PRD v4 9.5): one river and one lake, in the margin beyond the ring,
        // because inside the world the 3 m water buffer around paths, aprons and corridors leaves
        // no zone (PRD v4 8.4.2). The river runs west to east past the end of the north radial path
        // and into the lake. The lake lies as near the rim as the buffer lets it, so that ground
        // is left behind its far shore for the wood that closes the view across it.
        public Vector2 RiverFrom, RiverTo, LakeCentre;

        // How deep below the ground level the water's bed is at a point: 0 away from the water.
        public float Bed(float x, float z)
        {
            Vector2 p = new Vector2(x, z), along = RiverTo - RiverFrom;
            float t = Mathf.Clamp01(Vector2.Dot(p - RiverFrom, along) / along.sqrMagnitude);
            float river = RiverDepth * Mathf.SmoothStep(1, 0, (Vector2.Distance(p, RiverFrom + along * t) - RiverHalfWidth) / Bank);
            float lake = LakeDepth * Mathf.SmoothStep(1, 0, (Vector2.Distance(p, LakeCentre) - LakeRadius) / Bank);
            return Mathf.Max(river, lake);
        }

        // The height of the ground at a point, from the nearest sample.
        public float HeightAt(float x, float z)
        {
            float texel = Side / AlphaResolution;
            int column = Mathf.Clamp(Mathf.RoundToInt((x + Side / 2) / texel), 0, HeightResolution - 1);
            int row = Mathf.Clamp(Mathf.RoundToInt((z + Side / 2) / texel), 0, HeightResolution - 1);
            return Heights[row, column];
        }

        // Is a point in the water or on its bank? The avatar is kept out of it.
        public bool Wet(float x, float z) => Bed(x, z) > -WaterLevel * 0.5f;

        // PRD v4 8.4.5: 513 for worlds under 100 m of radius, 1,025 to 260 m, 2,049 beyond.
        public static int HeightmapResolution(float worldRadius) => worldRadius < 100 ? 513 : worldRadius <= 260 ? 1025 : 2049;

        // The plaza, the ring paths, the radial paths, the spurs and the pads are painted as path;
        // everything else is its wedge's ground (PRD v4 9.5: the paths are visible as ground).
        // `hillHeight` and `hillWidth` are the kit's relief in metres: how high a hill stands over a
        // hollow, and how far apart hills are.
        public static GroundPlan Compute(WorldLayout layout, float hillHeight = 3, float hillWidth = 60)
        {
            var plan = new GroundPlan { Radius = layout.WorldRadius / 1000f };
            plan.RiverFrom = new Vector2(-240, plan.Radius + 20);
            plan.RiverTo = new Vector2(110, plan.Radius + 20);
            plan.LakeCentre = new Vector2(120, plan.Radius + 47);
            plan.Side = 2 * (plan.Radius + Margin);
            plan.HeightResolution = HeightmapResolution(plan.Radius);
            int n = plan.AlphaResolution = plan.HeightResolution - 1;
            var path = new bool[n, n];

            double plaza = layout.PlazaRadius / 1000.0, world = layout.WorldRadius / 1000.0, half = LayoutConstants.PathWidth / 2000.0;
            var rings = layout.Paths.FindAll(p => p.Kind == PathKind.Ring);
            var ringInner = new double[rings.Count];
            for (int i = 0; i < rings.Count; i++)
            {
                ringInner[i] = rings[i].Inner / 1000.0;     // ring paths are listed from the plaza outward
            }
            var radials = layout.Paths.FindAll(p => p.Kind == PathKind.Radial);
            var sines = new double[radials.Count];
            var cosines = new double[radials.Count];
            for (int i = 0; i < radials.Count; i++)
            {
                double angle = radials[i].Angle / 1e6 * Math.PI / 180;
                sines[i] = Math.Sin(angle);
                cosines[i] = Math.Cos(angle);
            }

            double texel = plan.Side / n;
            for (int row = 0; row < n; row++)
            {
                double z = -plan.Side / 2 + (row + 0.5) * texel;
                for (int column = 0; column < n; column++)
                {
                    double x = -plan.Side / 2 + (column + 0.5) * texel;
                    double r = Math.Sqrt(x * x + z * z);
                    if (r > world)
                    {
                        continue;
                    }
                    bool on = r <= plaza;
                    if (!on)
                    {
                        int at = Array.BinarySearch(ringInner, r);
                        at = at >= 0 ? at : ~at - 1;
                        on = at >= 0 && r <= rings[at].Outer / 1000.0;
                    }
                    for (int i = 0; i < sines.Length && !on; i++)
                    {
                        double along = x * sines[i] + z * cosines[i];
                        on = along >= plaza && Math.Abs(x * cosines[i] - z * sines[i]) <= half;
                    }
                    path[row, column] = on;
                }
            }
            foreach (LayoutPath spur in layout.Paths)
            {
                if (spur.Kind == PathKind.Spur)
                {
                    plan.Mark(path, spur.Quad, (x, z) => Inside(spur.Quad, x, z));
                }
            }
            foreach (LayoutPad pad in layout.Pads)
            {
                P2 c = pad.Centre;
                long radius = pad.Radius;
                var box = new[] { new P2(c.X - radius, c.Z - radius), new P2(c.X + radius, c.Z + radius) };
                plan.Mark(path, box, (x, z) => (x - c.X / 1000.0) * (x - c.X / 1000.0) + (z - c.Z / 1000.0) * (z - c.Z / 1000.0) <= radius / 1000.0 * (radius / 1000.0));
            }

            // Flat too, though not painted: every stand's footprint, apron and corridor (PRD v4 8.4.5).
            var flat = (bool[,])path.Clone();
            foreach (LayoutStand stand in layout.Stands)
            {
                double yaw = stand.Yaw / 1e6 * Math.PI / 180, fx = Math.Sin(yaw), fz = Math.Cos(yaw);
                double length = ((stand.PathPoint.X - stand.Position.X) * fx + (stand.PathPoint.Z - stand.Position.Z) * fz) / 1000.0;
                double back = -LayoutConstants.FootprintHalfDepth / 1000.0, side = LayoutConstants.CorridorHalfWidth / 1000.0;
                P2 Corner(double a, double c) => new P2(
                    (long)(stand.Position.X + (fx * a + fz * c) * 1000), (long)(stand.Position.Z + (fz * a - fx * c) * 1000));
                P2[] strip = { Corner(back, -side), Corner(back, side), Corner(length, side), Corner(length, -side) };
                plan.Mark(flat, strip, (x, z) => Inside(strip, x, z));
            }

            plan.Alphas = new float[n, n, Layers];
            for (int row = 0; row < n; row++)
            {
                float z = (float)(-plan.Side / 2 + (row + 0.5) * texel);
                for (int column = 0; column < n; column++)
                {
                    float x = (float)(-plan.Side / 2 + (column + 0.5) * texel);
                    // The river's bed and banks and the lake's shore are gravel. The hills stay off
                    // them as they stay off a path, so the water lies in the low ground.
                    float bed = plan.Bed(x, z);
                    flat[row, column] |= bed > 0;
                    if (path[row, column] || bed > 0.05f)
                    {
                        plan.Alphas[row, column, path[row, column] ? Path : Gravel] = 1;
                        continue;
                    }
                    // Between the paths: the kit's ground for the wedge, meadow or bare stone, in the
                    // wedge's tone, and on the colourless ring bare stone in the ring's.
                    float stone = StoneAt(layout, x, z);
                    plan.Alphas[row, column, Gravel] = (1 - ToneShare) * stone;
                    plan.Alphas[row, column, Meadow] = (1 - ToneShare) * (1 - stone);
                    plan.Alphas[row, column, Tone] = ToneShare;
                }
            }
            plan.Tones = new Color32[ToneResolution * ToneResolution];
            for (int row = 0; row < ToneResolution; row++)
            {
                float z = -plan.Side / 2 + (row + 0.5f) * plan.Side / ToneResolution;
                for (int column = 0; column < ToneResolution; column++)
                {
                    Color tone = ToneAt(layout, -plan.Side / 2 + (column + 0.5f) * plan.Side / ToneResolution, z);
                    plan.Tones[row * ToneResolution + column] = new Color32((byte)Mathf.RoundToInt(tone.r * 255), (byte)Mathf.RoundToInt(tone.g * 255), (byte)Mathf.RoundToInt(tone.b * 255), 0);
                }
            }
            plan.Relief(flat, hillHeight, hillWidth, layout.Input.PlaneSlug);
            return plan;
        }

        // Where a point lies among the colour classes (PRD v4 5.6.3): on the ring, in the ring's;
        // elsewhere in the wedge its bearing lies in, beyond the rim too, so the wood there is its
        // wedge's. Within `ToneBlend` of a boundary the wedge across it has a share, a half on the
        // boundary itself.
        static void Among(WorldLayout layout, float x, float z, out int here, out int other, out float share)
        {
            here = other = (int)ColourClass.Colourless;     // a world with no wedge is all ring
            share = 0;
            double r = Math.Sqrt((double)x * x + (double)z * z);
            if (layout.RingWidth > 0 && r >= layout.RingInner / 1000.0 && r <= layout.WorldRadius / 1000.0)
            {
                return;
            }
            double bearing = Math.Atan2(x, z) * 180 / Math.PI * 1e6;     // clockwise from north
            int wedge = WedgeAt(layout, bearing);
            if (wedge < 0)
            {
                return;
            }
            here = other = wedge;
            double into = Repeat(bearing - layout.WedgeFrom[wedge]), left = layout.WedgeSpan[wedge] - into, blend = ToneBlend * 1e6;
            double edge = Math.Min(into, left);
            if (edge >= blend)
            {
                return;
            }
            int across = into < left ? WedgeAt(layout, bearing - into - 1) : WedgeAt(layout, bearing + left + 1);
            if (across >= 0 && across != wedge)
            {
                other = across;
                share = 0.5f * Mathf.SmoothStep(1, 0, (float)(edge / blend));
            }
        }

        // The tone of the ground at a point, from the kit's table.
        public static Color ToneAt(WorldLayout layout, float x, float z)
        {
            Among(layout, x, z, out int here, out int other, out float share);
            Color32[] tones = Temperate.GroundTones;
            return share > 0 ? Color.Lerp(tones[here], tones[other], share) : (Color)tones[here];
        }

        // How much of the kit's ground at a point is bare stone and not meadow, from the kit's table.
        public static float StoneAt(WorldLayout layout, float x, float z)
        {
            Among(layout, x, z, out int here, out int other, out float share);
            int[] ground = Temperate.GroundBase;
            return Mathf.Lerp(ground[here] == Gravel ? 1 : 0, ground[other] == Gravel ? 1 : 0, share);
        }

        // The wedge a bearing lies in, in micro-degrees clockwise from north; -1 where there is none.
        static int WedgeAt(WorldLayout layout, double bearing)
        {
            for (int c = 0; c < ColourClasses.WedgeCount; c++)
            {
                if (layout.WedgeSpan[c] > 0 && Repeat(bearing - layout.WedgeFrom[c]) < layout.WedgeSpan[c])
                {
                    return c;
                }
            }
            return -1;
        }

        static double Repeat(double microDegrees) => microDegrees - Math.Floor(microDegrees / 360e6) * 360e6;

        // The heights: the kit's noise, held to zero on everything flat and for a step around it,
        // rising to full height over the falloff, and carved for the water.
        void Relief(bool[,] flat, float hillHeight, float hillWidth, string slug)
        {
            int n = AlphaResolution, size = HeightResolution;
            float texel = Side / n;
            // The distance to the nearest flat texel, by a two-pass chamfer over the texel grid.
            var distance = new float[n, n];
            const float Straight = 1, Diagonal = 1.41421356f, Far = 1e9f;
            for (int row = 0; row < n; row++)
            {
                for (int column = 0; column < n; column++)
                {
                    float d = flat[row, column] ? 0 : Far;
                    if (d > 0 && row > 0)
                    {
                        d = Math.Min(d, distance[row - 1, column] + Straight);
                        d = column > 0 ? Math.Min(d, distance[row - 1, column - 1] + Diagonal) : d;
                        d = column < n - 1 ? Math.Min(d, distance[row - 1, column + 1] + Diagonal) : d;
                    }
                    distance[row, column] = d > 0 && column > 0 ? Math.Min(d, distance[row, column - 1] + Straight) : d;
                }
            }
            for (int row = n - 1; row >= 0; row--)
            {
                for (int column = n - 1; column >= 0; column--)
                {
                    float d = distance[row, column];
                    if (d > 0 && row < n - 1)
                    {
                        d = Math.Min(d, distance[row + 1, column] + Straight);
                        d = column > 0 ? Math.Min(d, distance[row + 1, column - 1] + Diagonal) : d;
                        d = column < n - 1 ? Math.Min(d, distance[row + 1, column + 1] + Diagonal) : d;
                    }
                    distance[row, column] = d > 0 && column < n - 1 ? Math.Min(d, distance[row, column + 1] + Straight) : d;
                }
            }

            uint seed = (uint)SplitMix64.Fnv1a64($"eternities-v4|terrain|{slug}");
            Heights = new float[size, size];
            Normalised = new float[size, size];
            for (int row = 0; row < size; row++)
            {
                float z = -Side / 2 + row * texel;
                for (int column = 0; column < size; column++)
                {
                    float x = -Side / 2 + column * texel;
                    // A height sample is a corner of up to four texels: it is as near to flat as the nearest of them.
                    float d = Far;
                    for (int r = Math.Max(row - 1, 0); r <= Math.Min(row, n - 1); r++)
                    {
                        for (int c = Math.Max(column - 1, 0); c <= Math.Min(column, n - 1); c++)
                        {
                            d = Math.Min(d, distance[r, c]);
                        }
                    }
                    float rise = Mathf.SmoothStep(0, 1, (d * texel - FlatApron) / Falloff);
                    float hills = (Noise(x / hillWidth, z / hillWidth, seed) * 0.75f + Noise(x / hillWidth * 2.7f, z / hillWidth * 2.7f, seed + 1) * 0.25f) * hillHeight;
                    Heights[row, column] = hills * rise - Bed(x, z);
                    Normalised[row, column] = (Heights[row, column] + Floor) / Height;
                }
            }
        }

        // Value noise from 0 to 1 on an integer hash, the same on every machine.
        static float Noise(float x, float z, uint seed)
        {
            int x0 = Mathf.FloorToInt(x), z0 = Mathf.FloorToInt(z);
            float tx = x - x0, tz = z - z0;
            tx = tx * tx * (3 - 2 * tx);
            tz = tz * tz * (3 - 2 * tz);
            float a = Hash(x0, z0, seed), b = Hash(x0 + 1, z0, seed), c = Hash(x0, z0 + 1, seed), d = Hash(x0 + 1, z0 + 1, seed);
            return Mathf.Lerp(Mathf.Lerp(a, b, tx), Mathf.Lerp(c, d, tx), tz);
        }

        internal static float Hash(int x, int z, uint seed)
        {
            unchecked
            {
                uint h = (uint)x * 0x85EBCA6Bu ^ (uint)z * 0xC2B2AE35u ^ seed * 0x27D4EB2Fu;
                h ^= h >> 15;
                h *= 0x2C1B3C6Du;
                h ^= h >> 12;
                h *= 0x297A2D39u;
                h ^= h >> 15;
                return (h & 0xFFFFFF) / (float)0x1000000;
            }
        }

        // Marks the texels of a shape's bounding box whose centres the shape holds.
        void Mark(bool[,] cells, P2[] bounds, Func<double, double, bool> holds)
        {
            int n = AlphaResolution;
            double texel = Side / n, minX = double.MaxValue, minZ = double.MaxValue, maxX = double.MinValue, maxZ = double.MinValue;
            foreach (P2 p in bounds)
            {
                minX = Math.Min(minX, p.X / 1000.0);
                maxX = Math.Max(maxX, p.X / 1000.0);
                minZ = Math.Min(minZ, p.Z / 1000.0);
                maxZ = Math.Max(maxZ, p.Z / 1000.0);
            }
            int Cell(double v) => Math.Max(0, Math.Min(n - 1, (int)Math.Floor((v + Side / 2) / texel)));
            for (int row = Cell(minZ); row <= Cell(maxZ); row++)
            {
                for (int column = Cell(minX); column <= Cell(maxX); column++)
                {
                    if (holds(-Side / 2 + (column + 0.5) * texel, -Side / 2 + (row + 0.5) * texel))
                    {
                        cells[row, column] = true;
                    }
                }
            }
        }

        static bool Inside(P2[] quad, double x, double z)
        {
            bool positive = false, negative = false;
            for (int i = 0; i < quad.Length; i++)
            {
                P2 a = quad[i], b = quad[(i + 1) % quad.Length];
                double side = (b.X - a.X) / 1000.0 * (z - a.Z / 1000.0) - (b.Z - a.Z) / 1000.0 * (x - a.X / 1000.0);
                positive |= side > 0;
                negative |= side < 0;
            }
            return !(positive && negative);
        }
    }

    // A world's ground: one Unity Terrain (PRD v4 8.4.5), square, centred on the arrival point, as
    // wide as the world and a margin, with the plan's heights and the kit's layers painted from it.
    public static class WorldGround
    {

        // The ground's layers: the kit's three, or plain colours in their place while the kit has
        // none, and the world's tones (PRD v4 5.6.3) as a fourth, one picture laid once over the
        // whole terrain. `owned` takes what is made here, which leaves with the world.
        public static TerrainLayer[] Layers(TerrainLayer[] kit, GroundPlan plan, System.Collections.Generic.List<UnityEngine.Object> owned)
        {
            var layers = new TerrainLayer[GroundPlan.Layers];
            if (kit != null && kit.Length == GroundPlan.KitLayers && Array.TrueForAll(kit, layer => layer != null))
            {
                Array.Copy(kit, layers, GroundPlan.KitLayers);
            }
            else
            {
                // Without a mask map the terrain shader reads a layer's smoothness from its alpha:
                // zero, or the ground mirrors the sky.
                Color[] colours = { new Color(0.24f, 0.36f, 0.16f, 0), new Color(0.52f, 0.44f, 0.32f, 0), new Color(0.45f, 0.45f, 0.44f, 0) };
                for (int i = 0; i < GroundPlan.KitLayers; i++)
                {
                    var texture = new Texture2D(2, 2, TextureFormat.RGBA32, mipChain: false) { name = "plain layer" };
                    texture.SetPixels(new[] { colours[i], colours[i], colours[i], colours[i] });
                    texture.Apply();
                    layers[i] = new TerrainLayer { diffuseTexture = texture, tileSize = new Vector2(4, 4), smoothness = 0, metallic = 0 };
                    owned.Add(texture);
                    owned.Add(layers[i]);
                }
            }
            var tones = new Texture2D(GroundPlan.ToneResolution, GroundPlan.ToneResolution, TextureFormat.RGBA32, mipChain: true) { name = "ground tones", wrapMode = TextureWrapMode.Clamp };
            tones.SetPixels32(plan.Tones);
            tones.Apply(updateMipmaps: true, makeNoLongerReadable: true);
            layers[GroundPlan.Tone] = new TerrainLayer { diffuseTexture = tones, tileSize = new Vector2(plan.Side, plan.Side), smoothness = 0, metallic = 0 };
            owned.Add(tones);
            owned.Add(layers[GroundPlan.Tone]);
            return layers;
        }

        // The scene's own material, with HDRP's terrain shader, is one a build can draw. The
        // pipeline's default terrain material is the editor's and is not in a build: a ground given
        // that one is drawn in the editor and is not there at all in a player.
        public static bool Drawable(Material material) => material != null && material.shader != null && material.shader.isSupported;

        // Rows of the plan handed to the terrain in one step.
        public const int HeightRows = 64, AlphaRows = 512;

        // Builds the ground in steps, and yields whenever a frame has spent `budget` milliseconds
        // on it, as the stands do (PRD v4 7.3.3). `done` takes the terrain. Handed to the terrain
        // in one call, a heightmap of 2,049 took 110 ms, and the visitor walking up to the portal
        // saw one frame of 150 ms (DEC-953). The heights and the layers go in by strips of rows,
        // and the terrain's object is made last, so nothing draws or collides with a ground that
        // is half there. Four steps cannot be cut smaller and are longer than a strip: making the
        // heightmap, making the alphamap, the one pass that works out the terrain's levels of
        // detail from all the heights, and any call that paints layers, however few rows it holds.
        // `owned` takes the terrain's data at once: it belongs to no object, and a load that is
        // stopped half-way must not leave it behind.
        public static IEnumerator Build(GroundPlan plan, TerrainLayer[] layers, Material material, string name, Transform parent, float budget,
            System.Collections.Generic.List<UnityEngine.Object> owned, Action<Terrain> done)
        {
            double sliceStarted = Time.realtimeSinceStartupAsDouble;
            bool Spent() => (Time.realtimeSinceStartupAsDouble - sliceStarted) * 1000 > budget;

            var data = new TerrainData { name = name, heightmapResolution = plan.HeightResolution };
            owned.Add(data);
            if (Spent())
            {
                yield return null;
                sliceStarted = Time.realtimeSinceStartupAsDouble;
            }
            data.alphamapResolution = plan.AlphaResolution;
            data.size = new Vector3(plan.Side, GroundPlan.Height, plan.Side);      // after the resolutions, which reset it
            data.terrainLayers = layers;
            if (Spent())
            {
                yield return null;
                sliceStarted = Time.realtimeSinceStartupAsDouble;
            }

            // A strip is copied out of the plan, because the terrain takes an array's own size.
            int size = plan.HeightResolution;
            float[,] heights = null;
            for (int row = 0; row < size; row += HeightRows)
            {
                int count = Math.Min(HeightRows, size - row);
                if (heights == null || heights.GetLength(0) != count)
                {
                    heights = new float[count, size];
                }
                Buffer.BlockCopy(plan.Normalised, row * size * sizeof(float), heights, 0, count * size * sizeof(float));
                // Without the levels of detail: worked out after every strip, they cost 9 ms a call.
                data.SetHeightsDelayLOD(0, row, heights);
                if (Spent())
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
            data.SyncHeightmap();
            if (Spent())
            {
                yield return null;
                sliceStarted = Time.realtimeSinceStartupAsDouble;
            }

            int n = plan.AlphaResolution;
            float[,,] alphas = null;
            for (int row = 0; row < n; row += AlphaRows)
            {
                int count = Math.Min(AlphaRows, n - row);
                if (alphas == null || alphas.GetLength(0) != count)
                {
                    alphas = new float[count, n, GroundPlan.Layers];
                }
                Buffer.BlockCopy(plan.Alphas, row * n * GroundPlan.Layers * sizeof(float), alphas, 0, count * n * GroundPlan.Layers * sizeof(float));
                data.SetAlphamaps(0, row, alphas);
                if (Spent())
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }

            GameObject ground = Terrain.CreateTerrainGameObject(data);
            ground.name = "Ground";
            ground.transform.SetParent(parent, false);
            ground.transform.localPosition = new Vector3(-plan.Side / 2, -GroundPlan.Floor, -plan.Side / 2);
            var terrain = ground.GetComponent<Terrain>();
            terrain.materialTemplate = material;
            done(terrain);
        }
    }
}
