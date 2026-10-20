using System.Collections;
using System.Collections.Generic;
using Eternities.Data;
using Eternities.Layout;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // Every stand of a world as geometry (PRD v4 5.5): a plinth 1.1 m tall on the stand's footprint,
    // shaped as a pedestal, and, upright on it, the slab that carries the image surface, facing the
    // apron.
    // One mesh and one collider a site, so the engine culls and streams by site and nothing is one
    // object a card. The plinth's material is the card's rarity; a thin rim of its class's colour
    // runs round the plinth's top edge (PRD v4 5.5.1, the colour cue); the image surface is drawn
    // by the isolated path (PRD v4 8.4.4) and is not part of this mesh.
    public sealed class StandField : MonoBehaviour
    {
        public const float PlinthHeight = 1.1f, SurfaceHeight = 0.88f, SlabDepth = 0.02f;
        // The slab frames the image surface by a centimetre on every side. The surface takes the
        // image's pixel aspect, 488 by 680 (PRD v4 4.15.5), so it is 0.6315 m wide.
        public const float SlabWidth = SurfaceHeight * 488 / 680 + 0.02f, SlabHeight = SurfaceHeight + 0.02f, SlabTop = PlinthHeight + SurfaceHeight + 0.01f;
        public const int Rarities = 4, SlabMaterial = 4;
        // The plinth's shape from the ground up: a base as wide as the footprint, a shaft set in
        // from it, and a cap as wide as the base again. Each level is a height and how far its
        // edge is set in from the footprint's. A box 1.1 m tall read as a crate. The cap's last
        // `RimHeight` is the rim's band.
        public static readonly (float Height, float Inset)[] Pedestal =
        {
            (0f, 0f), (0.14f, 0f), (0.19f, 0.04f), (0.94f, 0.04f), (0.99f, 0f), (PlinthHeight - RimHeight, 0f), (PlinthHeight, 0f),
        };

        // The rim (PRD v4 5.5.1): the cap's top band on its four sides, and a frame as wide as
        // `RimWidth` round its top face, in the colour of the stand's class.
        public const float RimHeight = 0.03f, RimWidth = 0.025f;

        // The colour classes of `stands.bin` (docs/data-contract.md: 0 W, 1 U, 2 B, 3 R, 4 G, 5
        // multicolour, 6 colourless), and the colour of each one's rim and of its dot on the map.
        // They are the web edition's hue classes (`web/src/scene/tuning.ts`), but for black: a black
        // rim would not show on a dark stone or at dusk, and the web edition's violet reads as the
        // magenta of the image path's test placeholder (PRD v4 8.4.4), so black is an indigo.
        // Multicolour is gold and colourless grey, as 5.5.1 names them.
        public const int Classes = 7;
        public static readonly Color[] ClassColours =
        {
            new Color(1.0f, 0.949f, 0.827f),        // W, warm ivory
            new Color(0.322f, 0.639f, 1.0f),        // U, cerulean
            new Color(0.50f, 0.42f, 0.95f),         // B, indigo
            new Color(1.0f, 0.451f, 0.239f),        // R, ember orange
            new Color(0.322f, 0.831f, 0.494f),      // G, viridian
            new Color(1.0f, 0.812f, 0.361f),        // multicolour, gold
            new Color(0.812f, 0.855f, 0.898f),      // colourless, grey
        };

        public static int ClassOf(WorldData world, int stand) => Mathf.Clamp(world.Stands.Class[stand], 0, Classes - 1);

        public int Stands { get; private set; }
        public int Sites { get; private set; }

        readonly List<Mesh> meshes = new List<Mesh>();

        // A mesh made in code belongs to no object, so it leaves with the field that made it.
        void OnDestroy()
        {
            foreach (Mesh mesh in meshes)
            {
                Destroy(mesh);
            }
        }

        public static Vector3 Ground(P2 millimetres) => new Vector3(millimetres.X / 1000f, 0, millimetres.Z / 1000f);

        // The way a pose of the pack faces: its yaw is counter-clockwise from +x, east
        // (docs/data-contract-v4.md section 2), and the engine turns clockwise about its up axis
        // from +z, north.
        public static Quaternion Facing(long yaw) => Quaternion.Euler(0, 90 - yaw / 1e6f, 0);

        // The way a stand's image surface faces: towards its path vertex (PRD v4 3.2, invariant 9).
        public static Quaternion Facing(WorldData world, int stand) => Facing(world.Yaw(stand));

        // `materials`: the four plinth materials by rarity, then the slab's; `rims`: one a colour
        // class, in the order of `ClassColours`.
        public static StandField Build(WorldData world, Material[] materials, Material[] rims, Transform parent)
        {
            StandField field = Create(parent);
            IEnumerator fill = field.Fill(world, materials, rims, float.PositiveInfinity);
            while (fill.MoveNext())
            {
            }
            return field;
        }

        public static StandField Create(Transform parent)
        {
            var root = new GameObject("Stands");
            root.transform.SetParent(parent, false);
            return root.AddComponent<StandField>();
        }

        // Builds the sites one after another, and yields whenever a frame has spent `budget`
        // milliseconds on them, so a world loads behind a portal without stopping the frame.
        public IEnumerator Fill(WorldData world, Material[] materials, Material[] rims, float budget)
        {
            var bySite = new List<int>[world.Layout.Sites.Length];
            for (int stand = 0; stand < world.StandCount; stand++)
            {
                (bySite[world.Site(stand)] ??= new List<int>()).Add(stand);
            }
            // A site's mesh has a submesh a material: the plinths by rarity, the slab, then the
            // rims by class.
            var all = new Material[materials.Length + rims.Length];
            materials.CopyTo(all, 0);
            rims.CopyTo(all, materials.Length);
            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var triangles = new List<int>[all.Length];
            for (int m = 0; m < triangles.Length; m++)
            {
                triangles[m] = new List<int>();
            }
            double sliceStarted = Time.realtimeSinceStartupAsDouble;
            for (int index = 0; index < world.Layout.Sites.Length; index++)
            {
                WorldSite site = world.Layout.Sites[index];
                if (bySite[index] == null)
                {
                    continue;
                }
                vertices.Clear();
                normals.Clear();
                foreach (List<int> list in triangles)
                {
                    list.Clear();
                }
                // Vertices are relative to the site's centre, so a far site keeps its precision.
                Vector3 origin = Ground(site.Centre);
                foreach (int stand in bySite[index])
                {
                    Vector3 at = Ground(world.Position(stand)) - origin;
                    Quaternion facing = Facing(world, stand);
                    float footprintHalfWidth = LayoutConstants.FootprintWidth / 2000f, footprintHalfDepth = LayoutConstants.FootprintDepth / 2000f;
                    List<int> plinth = triangles[Mathf.Clamp(world.Stands.Rarity[stand], 0, Rarities - 1)];
                    List<int> rim = triangles[materials.Length + ClassOf(world, stand)];
                    for (int level = 0; level + 1 < Pedestal.Length; level++)
                    {
                        Sides(vertices, normals, level + 2 == Pedestal.Length ? rim : plinth, at, facing,
                            new Vector3(footprintHalfWidth - Pedestal[level].Inset, Pedestal[level].Height, footprintHalfDepth - Pedestal[level].Inset),
                            new Vector3(footprintHalfWidth - Pedestal[level + 1].Inset, Pedestal[level + 1].Height, footprintHalfDepth - Pedestal[level + 1].Inset));
                    }
                    // The cap's top, which the slab stands on: the rim's frame round its edge, and
                    // the plinth's own face inside it. A box of no height has that one face to show.
                    Vector3 top = at + new Vector3(0, PlinthHeight, 0);
                    Frame(vertices, normals, rim, top, facing, footprintHalfWidth, footprintHalfDepth, RimWidth);
                    Box(vertices, normals, plinth, top, facing, new Vector3(footprintHalfWidth - RimWidth, 0, footprintHalfDepth - RimWidth), only: Vector3.up);
                    Box(vertices, normals, triangles[SlabMaterial],
                        at + new Vector3(0, PlinthHeight + SurfaceHeight / 2, 0), facing, new Vector3(SlabWidth / 2, SlabHeight / 2, SlabDepth / 2));
                }

                // A site of more than about 470 stands passes the 65,535 vertices that 16-bit
                // indices reach: Dominaria's `era:ice-age` holds 635, and its last plinths drew
                // with other stands' vertices until the format followed the count.
                var mesh = new Mesh { name = $"stands {site.Key}", indexFormat = vertices.Count > ushort.MaxValue ? IndexFormat.UInt32 : IndexFormat.UInt16 };
                mesh.SetVertices(vertices);
                mesh.SetNormals(normals);
                mesh.subMeshCount = all.Length;
                for (int m = 0; m < all.Length; m++)
                {
                    mesh.SetTriangles(triangles[m], m);
                }
                mesh.RecalculateBounds();
                meshes.Add(mesh);

                var siteObject = new GameObject(mesh.name);
                siteObject.transform.SetParent(transform, false);
                siteObject.transform.localPosition = origin;
                siteObject.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = siteObject.AddComponent<MeshRenderer>();
                renderer.sharedMaterials = all;
                renderer.shadowCastingMode = ShadowCastingMode.On;
                siteObject.AddComponent<MeshCollider>().sharedMesh = mesh;
                Sites++;
                Stands += bySite[index].Count;

                if ((Time.realtimeSinceStartupAsDouble - sliceStarted) * 1000 > budget)
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
        }

        static readonly Vector3[] Faces = { Vector3.forward, Vector3.back, Vector3.right, Vector3.left, Vector3.up, Vector3.down };

        // Round a rectangle so that a side's run crossed with its rise points outward.
        static readonly (float X, float Z)[] Round = { (-1, -1), (-1, 1), (1, 1), (1, -1) };

        // The four sides between two levels of a pedestal: a rectangle `lower.x` by `lower.z` in
        // half extents at the height `lower.y`, and another above it. A side is flat, and leans
        // where the two rectangles differ.
        static void Sides(List<Vector3> vertices, List<Vector3> normals, List<int> triangles, Vector3 centre, Quaternion rotation, Vector3 lower, Vector3 upper)
        {
            for (int side = 0; side < 4; side++)
            {
                (float X, float Z) from = Round[side], to = Round[(side + 1) % 4];
                Vector3 a = new Vector3(from.X * lower.x, lower.y, from.Z * lower.z), b = new Vector3(to.X * lower.x, lower.y, to.Z * lower.z);
                Vector3 c = new Vector3(to.X * upper.x, upper.y, to.Z * upper.z), d = new Vector3(from.X * upper.x, upper.y, from.Z * upper.z);
                Vector3 normal = rotation * Vector3.Cross(b - a, d - a).normalized;
                int first = vertices.Count;
                vertices.Add(centre + rotation * a);
                vertices.Add(centre + rotation * b);
                vertices.Add(centre + rotation * c);
                vertices.Add(centre + rotation * d);
                for (int corner = 0; corner < 4; corner++)
                {
                    normals.Add(normal);
                }
                triangles.Add(first);
                triangles.Add(first + 1);
                triangles.Add(first + 2);
                triangles.Add(first);
                triangles.Add(first + 2);
                triangles.Add(first + 3);
            }
        }

        // A flat frame facing up at `centre`: the ring between a rectangle of half extents
        // `halfWidth` by `halfDepth` and the same rectangle set in by `width`, as four quads.
        static void Frame(List<Vector3> vertices, List<Vector3> normals, List<int> triangles, Vector3 centre, Quaternion rotation, float halfWidth, float halfDepth, float width)
        {
            Vector3 up = rotation * Vector3.up;
            for (int side = 0; side < 4; side++)
            {
                (float X, float Z) from = Round[side], to = Round[(side + 1) % 4];
                // Round's order runs clockwise seen from above, so the outer edge a to b and then
                // the inner edge c back to d wind clockwise too, which faces up.
                Vector3 a = new Vector3(from.X * halfWidth, 0, from.Z * halfDepth), b = new Vector3(to.X * halfWidth, 0, to.Z * halfDepth);
                Vector3 c = new Vector3(to.X * (halfWidth - width), 0, to.Z * (halfDepth - width)), d = new Vector3(from.X * (halfWidth - width), 0, from.Z * (halfDepth - width));
                int first = vertices.Count;
                vertices.Add(centre + rotation * a);
                vertices.Add(centre + rotation * b);
                vertices.Add(centre + rotation * c);
                vertices.Add(centre + rotation * d);
                for (int corner = 0; corner < 4; corner++)
                {
                    normals.Add(up);
                }
                triangles.Add(first);
                triangles.Add(first + 1);
                triangles.Add(first + 2);
                triangles.Add(first);
                triangles.Add(first + 2);
                triangles.Add(first + 3);
            }
        }

        // `only`: the one face to make, or none of them named for all six.
        static void Box(List<Vector3> vertices, List<Vector3> normals, List<int> triangles, Vector3 centre, Quaternion rotation, Vector3 half, Vector3 only = default)
        {
            foreach (Vector3 face in Faces)
            {
                if (only != default && face != only)
                {
                    continue;
                }
                // Two axes across the face with u x v along its normal, so the winding below faces
                // outward.
                Vector3 u = face.y != 0 ? Vector3.right : Vector3.up;
                Vector3 v = Vector3.Cross(face, u);
                int first = vertices.Count;
                for (int corner = 0; corner < 4; corner++)
                {
                    float su = corner == 0 || corner == 3 ? -1 : 1, sv = corner < 2 ? -1 : 1;
                    Vector3 local = Vector3.Scale(face + su * u + sv * v, half);
                    vertices.Add(centre + rotation * local);
                    normals.Add(rotation * face);
                }
                triangles.Add(first);
                triangles.Add(first + 1);
                triangles.Add(first + 2);
                triangles.Add(first);
                triangles.Add(first + 2);
                triangles.Add(first + 3);
            }
        }
    }
}
