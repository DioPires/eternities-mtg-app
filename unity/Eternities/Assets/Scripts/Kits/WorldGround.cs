using System;
using Eternities.Layout;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // What a world's ground is made from, worked out away from the main thread: which of the kit's
    // layers lies where. It needs the layout and nothing of the engine.
    public sealed class GroundPlan
    {
        public const int Meadow = 0, Path = 1, Gravel = 2, Layers = 3;
        public const float Margin = 60;

        public float Radius, Side;      // metres
        public int HeightResolution, AlphaResolution;
        public float[,,] Alphas;        // [z, x, layer], as Unity Terrain takes them

        // PRD v4 8.4.5: 513 for worlds under 100 m of radius, 1,025 to 260 m, 2,049 beyond.
        public static int HeightmapResolution(float worldRadius) => worldRadius < 100 ? 513 : worldRadius <= 260 ? 1025 : 2049;

        // The plaza, the ring paths, the radial paths, the spurs and the pads are painted as path;
        // everything else is meadow (PRD v4 9.5: the paths are visible as ground).
        public static GroundPlan Compute(WorldLayout layout)
        {
            var plan = new GroundPlan { Radius = layout.WorldRadius / 1000f };
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

            plan.Alphas = new float[n, n, Layers];
            for (int row = 0; row < n; row++)
            {
                for (int column = 0; column < n; column++)
                {
                    plan.Alphas[row, column, path[row, column] ? Path : Meadow] = 1;
                }
            }
            return plan;
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
    // wide as the world and a margin, with the kit's layers painted from the plan. It is flat so
    // far: the kit's noise and the flattening under paths come with the owner's hill figures.
    public static class WorldGround
    {
        public const float Height = 100;

        // The kit's layers, or plain colours in their place while the kit has none.
        public static TerrainLayer[] Layers(TerrainLayer[] kit)
        {
            if (kit != null && kit.Length == GroundPlan.Layers && Array.TrueForAll(kit, layer => layer != null))
            {
                return kit;
            }
            // Without a mask map the terrain shader reads a layer's smoothness from its alpha: zero,
            // or the ground mirrors the sky.
            Color[] colours = { new Color(0.24f, 0.36f, 0.16f, 0), new Color(0.52f, 0.44f, 0.32f, 0), new Color(0.45f, 0.45f, 0.44f, 0) };
            var plain = new TerrainLayer[GroundPlan.Layers];
            for (int i = 0; i < plain.Length; i++)
            {
                var texture = new Texture2D(2, 2, TextureFormat.RGBA32, mipChain: false) { name = "plain layer" };
                texture.SetPixels(new[] { colours[i], colours[i], colours[i], colours[i] });
                texture.Apply();
                plain[i] = new TerrainLayer { diffuseTexture = texture, tileSize = new Vector2(4, 4), smoothness = 0, metallic = 0 };
            }
            return plain;
        }

        public static Terrain Build(GroundPlan plan, TerrainLayer[] layers, string name, Transform parent)
        {
            var data = new TerrainData { name = name, heightmapResolution = plan.HeightResolution, alphamapResolution = plan.AlphaResolution };
            data.size = new Vector3(plan.Side, Height, plan.Side);      // after the resolution, which resets it
            data.terrainLayers = layers;
            data.SetAlphamaps(0, 0, plan.Alphas);

            GameObject ground = Terrain.CreateTerrainGameObject(data);
            ground.name = "Ground";
            ground.transform.SetParent(parent, false);
            ground.transform.localPosition = new Vector3(-plan.Side / 2, 0, -plan.Side / 2);
            var terrain = ground.GetComponent<Terrain>();
            terrain.materialTemplate = GraphicsSettings.currentRenderPipeline.defaultTerrainMaterial;
            return terrain;
        }
    }
}
