using System.Collections;
using System.Collections.Generic;
using Eternities.Data;
using Eternities.Layout;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // The greybox of PRD v4 9.6 (leg 1): a laid-out world drawn from its pack on flat ground, so the
    // owner can walk the journey law before it is dressed. The flat ground is one mesh with a
    // submesh a material: the ground itself, a disc of the world's radius; every site path, site
    // approach, trail leg (its attachment segments included) and the plaza approach as a strip of
    // the path's width; the plaza with its edge path, and every pad, as discs; and each region's
    // cell boundary as a thin line, so the regions read. Every stone is a plain cylinder of the
    // stone's radius. The stands are `StandField`'s plinths. Nothing else: no dressing, no kit
    // scatter, no water. Every figure is the pack's millimetre integer over 1,000.
    public sealed class Greybox : MonoBehaviour
    {
        public const int GroundMaterial = 0, PathMaterial = 1, PadMaterial = 2, LineMaterial = 3, StoneMaterial = 4, Materials = 5;
        // How far each flat layer stands above the ground, so that none flickers in another.
        public const float PlazaLift = 0.01f, PathLift = 0.02f, LineLift = 0.03f, PadLift = 0.04f;
        public const float LineHalfWidth = 0.1f;
        // The ground reaches this far past the world's radius, which is as far as the avatar goes.
        public const float GroundMargin = 30;
        // A reading stone stands 2 m tall; a chapter, way or marker stone is lower (9.6).
        public const float ReadingHeight = 2, LowHeight = 1;
        const float FloorDepth = 1;
        const int DiscSides = 32, GroundSides = 360, PlazaSides = 96;

        public Renderer Ground { get; private set; }
        public float GroundRadius { get; private set; }
        public int Strips { get; private set; }     // the strips of the paths' material: paths, approaches and legs
        public int Pads { get; private set; }
        public int Lines { get; private set; }
        public int Stones { get; private set; }

        readonly List<Mesh> meshes = new List<Mesh>();

        void OnDestroy()
        {
            foreach (Mesh mesh in meshes)
            {
                Destroy(mesh);
            }
        }

        public static Greybox Create(Transform parent)
        {
            var root = new GameObject("Greybox");
            root.transform.SetParent(parent, false);
            return root.AddComponent<Greybox>();
        }

        public static Greybox Build(WorldData world, Material[] materials, Transform parent)
        {
            Greybox greybox = Create(parent);
            IEnumerator fill = greybox.Fill(world, materials, float.PositiveInfinity);
            while (fill.MoveNext())
            {
            }
            return greybox;
        }

        static Vector2 Metres(P2 millimetres) => new Vector2(millimetres.X / 1000f, millimetres.Z / 1000f);

        sealed class Layer
        {
            public readonly List<int> Triangles = new List<int>();
        }

        readonly List<Vector3> vertices = new List<Vector3>();
        readonly Layer[] layers = { new Layer(), new Layer(), new Layer(), new Layer() };

        // `materials`: the ground's, the paths', the pads', the region lines' and the stones', in
        // the order of the constants above. Yields whenever a frame has spent `budget`
        // milliseconds, so a world loads behind a portal without stopping the frame.
        public IEnumerator Fill(WorldData world, Material[] materials, float budget)
        {
            WorldDocument layout = world.Layout;
            double sliceStarted = Time.realtimeSinceStartupAsDouble;
            bool Spent() => (Time.realtimeSinceStartupAsDouble - sliceStarted) * 1000 > budget;

            GroundRadius = layout.Radius / 1000f + GroundMargin;
            Disc(GroundMaterial, Vector2.zero, GroundRadius, 0, GroundSides);
            Disc(PadMaterial, Vector2.zero, layout.PlazaRadius / 1000f, PlazaLift, PlazaSides);
            Ring(PathMaterial, Vector2.zero, layout.PlazaRadius / 1000f, layout.PlazaEdgeRadius / 1000f, PlazaLift, PlazaSides);
            float half = LayoutConstants.PathHalfWidth / 1000f;
            if (layout.PlazaApproach != null)
            {
                Strip(PathMaterial, layout.PlazaApproach, half, PathLift, closed: false);
            }
            foreach (WorldPad pad in layout.Pads)
            {
                Disc(PadMaterial, Metres(pad.Centre), pad.Radius / 1000f, PadLift, DiscSides);
                Pads++;
            }
            foreach (WorldSite site in layout.Sites)
            {
                Strip(PathMaterial, site.Path, half, PathLift, closed: false);
                Strip(PathMaterial, new[] { site.Pad.Position, site.ApproachPoint }, half, PathLift, closed: false);
                if (Spent())
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
            foreach (TrailLeg leg in layout.Legs)
            {
                Strip(PathMaterial, leg.Polyline, half, PathLift, closed: false);
                if (Spent())
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
            foreach (WorldRegion region in layout.Regions)
            {
                Strip(LineMaterial, region.Cell, LineHalfWidth, LineLift, closed: true);
                Lines++;
            }

            var mesh = new Mesh { name = $"greybox {layout.Slug}", indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(vertices);
            var normals = new Vector3[vertices.Count];
            for (int i = 0; i < normals.Length; i++)
            {
                normals[i] = Vector3.up;
            }
            mesh.SetNormals(normals);
            mesh.subMeshCount = layers.Length;
            for (int m = 0; m < layers.Length; m++)
            {
                mesh.SetTriangles(layers[m].Triangles, m);
            }
            mesh.RecalculateBounds();
            meshes.Add(mesh);
            var ground = new GameObject("Ground");
            ground.transform.SetParent(transform, false);
            ground.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = ground.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = new[] { materials[GroundMaterial], materials[PathMaterial], materials[PadMaterial], materials[LineMaterial] };
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            Ground = renderer;
            // The avatar stands on a flat box as wide as the ground, its top at the ground level: the
            // paths and pads lie flat on it. A mesh collider of the ground's disc would hold
            // triangles hundreds of metres long, which the physics engine warns of.
            var floor = ground.AddComponent<BoxCollider>();
            floor.center = new Vector3(0, -FloorDepth / 2, 0);
            floor.size = new Vector3(2 * GroundRadius, FloorDepth, 2 * GroundRadius);
            vertices.Clear();
            foreach (Layer layer in layers)
            {
                layer.Triangles.Clear();
            }
            yield return null;
            sliceStarted = Time.realtimeSinceStartupAsDouble;

            foreach (WorldSite site in layout.Sites)
            {
                StoneOf($"stone of {site.Key}", site.Stone.Position, site.StoneKind == "reading" ? ReadingHeight : LowHeight, materials[StoneMaterial]);
                foreach (SiteChapter chapter in site.Chapters)
                {
                    if (chapter.Stone != null)
                    {
                        StoneOf($"chapter stone of set id {chapter.SetId} in {site.Key}", chapter.Stone.Value.Position, LowHeight, materials[StoneMaterial]);
                    }
                }
                if (Spent())
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
        }

        void StoneOf(string name, P2 centre, float height, Material material)
        {
            GameObject stone = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            stone.name = name;
            stone.transform.SetParent(transform, false);
            float radius = LayoutConstants.StoneRadius / 1000f;
            Vector2 at = Metres(centre);
            // The primitive is 2 m tall and 1 m across.
            stone.transform.localPosition = new Vector3(at.x, height / 2, at.y);
            stone.transform.localScale = new Vector3(2 * radius, height / 2, 2 * radius);
            stone.GetComponent<Renderer>().sharedMaterial = material;
            Stones++;
        }

        // A disc as a fan from its centre, its rim clockwise from north as seen from above, so
        // every triangle faces up.
        void Disc(int layer, Vector2 centre, float radius, float lift, int sides)
        {
            int first = vertices.Count;
            vertices.Add(new Vector3(centre.x, lift, centre.y));
            for (int i = 0; i <= sides; i++)
            {
                float a = 2 * Mathf.PI * i / sides;
                vertices.Add(new Vector3(centre.x + Mathf.Sin(a) * radius, lift, centre.y + Mathf.Cos(a) * radius));
            }
            List<int> triangles = layers[layer].Triangles;
            for (int i = 1; i <= sides; i++)
            {
                triangles.Add(first);
                triangles.Add(first + i);
                triangles.Add(first + i + 1);
            }
        }

        // The ring between two radii, as quads.
        void Ring(int layer, Vector2 centre, float inner, float outer, float lift, int sides)
        {
            int first = vertices.Count;
            for (int i = 0; i <= sides; i++)
            {
                float a = 2 * Mathf.PI * i / sides;
                var direction = new Vector2(Mathf.Sin(a), Mathf.Cos(a));
                vertices.Add(new Vector3(centre.x + direction.x * inner, lift, centre.y + direction.y * inner));
                vertices.Add(new Vector3(centre.x + direction.x * outer, lift, centre.y + direction.y * outer));
            }
            List<int> triangles = layers[layer].Triangles;
            for (int i = 0; i < sides; i++)
            {
                int a = first + 2 * i;
                triangles.AddRange(new[] { a, a + 1, a + 3, a, a + 3, a + 2 });
            }
        }

        // A strip of `half` metres each side of a polyline of the pack: at each vertex the two
        // sides are set out along the mean of the neighbouring segments' left normals, far enough
        // that each side stays `half` from both segments, up to twice that at a sharp turn.
        void Strip(int layer, IReadOnlyList<P2> polyline, float half, float lift, bool closed)
        {
            var points = new List<Vector2>(polyline.Count + 1);
            foreach (P2 point in polyline)
            {
                Vector2 at = Metres(point);
                if (points.Count == 0 || (at - points[points.Count - 1]).sqrMagnitude > 1e-6f)
                {
                    points.Add(at);
                }
            }
            if (closed && points.Count > 2)
            {
                if ((points[0] - points[points.Count - 1]).sqrMagnitude <= 1e-6f)
                {
                    points.RemoveAt(points.Count - 1);
                }
                points.Add(points[0]);
            }
            if (points.Count < 2)
            {
                return;
            }
            if (layer == PathMaterial)
            {
                Strips++;
            }
            int first = vertices.Count;
            int count = points.Count;
            for (int i = 0; i < count; i++)
            {
                Vector2 before = i > 0 ? Normal(points[i - 1], points[i]) : closed ? Normal(points[count - 2], points[0]) : Normal(points[0], points[1]);
                Vector2 after = i < count - 1 ? Normal(points[i], points[i + 1]) : closed ? Normal(points[0], points[1]) : before;
                Vector2 mean = before + after;
                Vector2 normal = mean.sqrMagnitude < 1e-8f ? after : mean.normalized;
                float reach = half / Mathf.Max(Vector2.Dot(normal, after), 0.5f);
                Vector2 left = points[i] + normal * reach, right = points[i] - normal * reach;
                vertices.Add(new Vector3(left.x, lift, left.y));
                vertices.Add(new Vector3(right.x, lift, right.y));
            }
            List<int> triangles = layers[layer].Triangles;
            for (int i = 0; i + 1 < count; i++)
            {
                int l = first + 2 * i, r = l + 1;
                triangles.AddRange(new[] { l, l + 2, r, r, l + 2, r + 2 });
            }
        }

        // The left normal of the segment from a to b, on the ground: (−dz, dx), unit length.
        static Vector2 Normal(Vector2 a, Vector2 b)
        {
            Vector2 d = (b - a).normalized;
            return new Vector2(-d.y, d.x);
        }
    }
}
