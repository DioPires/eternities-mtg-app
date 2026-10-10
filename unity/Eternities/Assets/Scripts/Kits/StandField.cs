using System.Collections.Generic;
using Eternities.Data;
using Eternities.Layout;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // Every stand of a world as geometry (PRD v4 5.5): a plinth 1.1 m tall on the stand's footprint
    // and, upright on it, the slab that carries the image surface, 0.63 by 0.88 m, facing the apron.
    // One mesh and one collider a site, so the engine culls and streams by site and nothing is one
    // object a card. The plinth's material is the card's rarity; the image surface is drawn by the
    // isolated path (PRD v4 8.4.4) and is not part of this mesh.
    public sealed class StandField : MonoBehaviour
    {
        public const float PlinthHeight = 1.1f, SurfaceWidth = 0.63f, SurfaceHeight = 0.88f, SlabDepth = 0.02f;
        public const int Rarities = 4, SlabMaterial = 4;

        public int Stands { get; private set; }
        public int Sites { get; private set; }

        public static Vector3 Ground(P2 millimetres) => new Vector3(millimetres.X / 1000f, 0, millimetres.Z / 1000f);

        // The way a stand's image surface faces: its yaw is clockwise from north, which is a turn
        // about the engine's up axis from +z.
        public static Quaternion Facing(LayoutStand stand) => Quaternion.Euler(0, stand.Yaw / 1e6f, 0);

        // `materials`: the four plinth materials by rarity, then the slab's.
        public static StandField Build(WorldData world, Material[] materials, Transform parent)
        {
            var root = new GameObject("Stands");
            root.transform.SetParent(parent, false);
            var field = root.AddComponent<StandField>();

            var bySite = new List<LayoutStand>[world.Layout.Sites.Count];
            foreach (LayoutStand stand in world.Layout.Stands)
            {
                (bySite[stand.Site] ??= new List<LayoutStand>()).Add(stand);
            }
            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var triangles = new List<int>[materials.Length];
            for (int m = 0; m < triangles.Length; m++)
            {
                triangles[m] = new List<int>();
            }
            foreach (LayoutSite site in world.Layout.Sites)
            {
                if (bySite[site.Index] == null)
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
                foreach (LayoutStand stand in bySite[site.Index])
                {
                    Vector3 at = Ground(stand.Position) - origin;
                    Quaternion facing = Facing(stand);
                    float footprintHalfWidth = LayoutConstants.FootprintHalfWidth / 1000f, footprintHalfDepth = LayoutConstants.FootprintHalfDepth / 1000f;
                    Box(vertices, normals, triangles[Mathf.Clamp(world.Cards[stand.Card].Rarity, 0, Rarities - 1)],
                        at + new Vector3(0, PlinthHeight / 2, 0), facing, new Vector3(footprintHalfWidth, PlinthHeight / 2, footprintHalfDepth));
                    Box(vertices, normals, triangles[SlabMaterial],
                        at + new Vector3(0, PlinthHeight + SurfaceHeight / 2, 0), facing, new Vector3(SurfaceWidth / 2, SurfaceHeight / 2, SlabDepth / 2));
                }

                var mesh = new Mesh { name = $"stands {world.Layout.Input.SetCodes[site.Set]} {ColourClasses.SeedNames[(int)site.Class]}" };
                mesh.SetVertices(vertices);
                mesh.SetNormals(normals);
                mesh.subMeshCount = materials.Length;
                for (int m = 0; m < materials.Length; m++)
                {
                    mesh.SetTriangles(triangles[m], m);
                }
                mesh.RecalculateBounds();

                var siteObject = new GameObject(mesh.name);
                siteObject.transform.SetParent(root.transform, false);
                siteObject.transform.localPosition = origin;
                siteObject.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = siteObject.AddComponent<MeshRenderer>();
                renderer.sharedMaterials = materials;
                renderer.shadowCastingMode = ShadowCastingMode.On;
                siteObject.AddComponent<MeshCollider>().sharedMesh = mesh;
                field.Sites++;
                field.Stands += bySite[site.Index].Count;
            }
            return field;
        }

        static readonly Vector3[] Faces = { Vector3.forward, Vector3.back, Vector3.right, Vector3.left, Vector3.up, Vector3.down };

        static void Box(List<Vector3> vertices, List<Vector3> normals, List<int> triangles, Vector3 centre, Quaternion rotation, Vector3 half)
        {
            foreach (Vector3 face in Faces)
            {
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
