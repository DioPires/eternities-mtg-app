using System.Collections.Generic;
using UnityEngine;

namespace Eternities.Travel
{
    // A portal (PRD v4 5.9.1): a standing ring of 3 m with a surface, and a 3 m pad in front of it.
    // It faces along its own forward axis; the pad's centre is 3 m that way. A portal has no
    // collision: stepping into the ring is what uses it.
    public sealed class Portal : MonoBehaviour
    {
        public const float RingRadius = 1.5f, Tube = 0.14f, PadDistance = 3;

        public Vector3 Pad => transform.position + transform.forward * PadDistance;

        // Is a point on the ground inside the ring's opening?
        public bool Holds(Vector3 position)
        {
            Vector3 local = transform.InverseTransformPoint(position);
            return Opening(local) && Mathf.Abs(local.z) < 0.5f;
        }

        // Did a step from one point to another use the ring? It did when it ends inside the opening,
        // or when it crossed the ring's plane inside the opening. One slow frame at a run is a step
        // of 2 m, longer than the opening is deep, and neither of its ends is inside (DEC-989).
        public bool Crossed(Vector3 from, Vector3 to)
        {
            if (Holds(to))
            {
                return true;
            }
            Vector3 start = transform.InverseTransformPoint(from), end = transform.InverseTransformPoint(to);
            if (start.z * end.z >= 0)
            {
                return false;       // both ends on one side of the plane, or no step at all
            }
            return Opening(Vector3.Lerp(start, end, start.z / (start.z - end.z)));
        }

        // Is a point of the portal's own space within the opening's width and height?
        static bool Opening(Vector3 local) => Mathf.Abs(local.x) < RingRadius - 0.3f && local.y > -1 && local.y < 2 * RingRadius;

        public static Portal Build(string name, Material frame, Material surface, Transform parent, Vector3 position, Quaternion facing)
        {
            var root = new GameObject(name);
            root.transform.SetParent(parent, false);
            root.transform.SetPositionAndRotation(position, facing);
            var portal = root.AddComponent<Portal>();

            var ring = new GameObject("Ring");
            ring.transform.SetParent(root.transform, false);
            ring.transform.localPosition = new Vector3(0, RingRadius + Tube, 0);
            ring.AddComponent<MeshFilter>().sharedMesh = portal.ringMesh = Torus(RingRadius + Tube, Tube, 48, 10);
            ring.AddComponent<MeshRenderer>().sharedMaterial = frame;

            var face = new GameObject("Surface");
            face.transform.SetParent(root.transform, false);
            face.transform.localPosition = new Vector3(0, RingRadius + Tube, 0);
            face.AddComponent<MeshFilter>().sharedMesh = portal.surfaceMesh = Disc(RingRadius, 48);
            face.AddComponent<MeshRenderer>().sharedMaterial = surface;
            return portal;
        }

        Mesh ringMesh, surfaceMesh;

        void OnDestroy()
        {
            Destroy(ringMesh);
            Destroy(surfaceMesh);
        }

        // A torus in the plane across the portal's forward axis.
        static Mesh Torus(float radius, float tube, int around, int across)
        {
            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var triangles = new List<int>();
            for (int i = 0; i <= around; i++)
            {
                float a = 2 * Mathf.PI * i / around;
                var outward = new Vector3(Mathf.Cos(a), Mathf.Sin(a), 0);
                for (int j = 0; j <= across; j++)
                {
                    float b = 2 * Mathf.PI * j / across;
                    Vector3 normal = outward * Mathf.Cos(b) + Vector3.forward * Mathf.Sin(b);
                    vertices.Add(outward * radius + normal * tube);
                    normals.Add(normal);
                }
            }
            for (int i = 0; i < around; i++)
            {
                for (int j = 0; j < across; j++)
                {
                    int a = i * (across + 1) + j, b = a + across + 1;
                    triangles.AddRange(new[] { a, a + 1, b, b, a + 1, b + 1 });
                }
            }
            var mesh = new Mesh { name = "portal ring" };
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetTriangles(triangles, 0);
            return mesh;
        }

        // A disc seen from both sides.
        static Mesh Disc(float radius, int around)
        {
            var vertices = new List<Vector3>();
            var normals = new List<Vector3>();
            var triangles = new List<int>();
            foreach (float side in new[] { 1f, -1f })
            {
                int centre = vertices.Count;
                vertices.Add(Vector3.zero);
                normals.Add(Vector3.forward * side);
                for (int i = 0; i <= around; i++)
                {
                    float a = 2 * Mathf.PI * i / around;
                    vertices.Add(new Vector3(Mathf.Cos(a) * radius, Mathf.Sin(a) * radius, 0));
                    normals.Add(Vector3.forward * side);
                }
                for (int i = 1; i <= around; i++)
                {
                    triangles.AddRange(side > 0 ? new[] { centre, centre + i, centre + i + 1 } : new[] { centre, centre + i + 1, centre + i });
                }
            }
            var mesh = new Mesh { name = "portal surface" };
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetTriangles(triangles, 0);
            return mesh;
        }
    }
}
