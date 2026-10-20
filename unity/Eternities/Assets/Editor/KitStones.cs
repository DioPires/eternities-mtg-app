using System.IO;
using System.Linq;
using Eternities.Kits;
using UnityEditor;
using UnityEngine;

namespace Eternities.EditorTools
{
    // The kit's stones (PRD v4 5.4.16, 5.13.1; the glossary's "Stone"), each one of the kit's CC0
    // rocks stood on end and sized in its prefab (the parked Tripo trial's note on DEC-1005): a
    // reading stone of about 2 m from the dark block `rock_07`, with a face for its inscription; a
    // waystone from the bare `boulder_01`; and a low stone from the block again, for a chapter and
    // for a marker. A stone draws its rock's own mesh and material, so the stones add no texture
    // and no mesh to the kit. Each is made once, and then left alone, as the kit's props are.
    //
    // A stone's box is its rock's, stretched to the stone's size in its own axes; its footprint
    // and its collider lie inside its pose's disc of 0.5 m (`LayoutConstants.StoneRadius`), which
    // the layout's clearances assume.
    public static class KitStones
    {
        public sealed class Stone
        {
            public string Prefab;       // under the kit's `Prefabs/Stones/`
            public string Rock;         // the kit's prop it is made of, under `Prefabs/Rocks/`
            public Vector3 Up;          // the axis of the rock, as its prop turns it, that the stone stands on
            public float Spin;          // degrees about the vertical, to choose which face looks out
            public Vector3 Size;        // its box in metres: width, height from its base, depth
            public float Sink;          // how deep its base lies under the ground
            public Vector2 Face;        // its inscription face, width and height; none when zero
            public float FaceAt;        // the face's middle, above the ground
        }

        public static readonly Stone[] Temperate =
        {
            new Stone { Prefab = "reading_stone", Rock = "rock_07", Up = Vector3.forward, Size = new Vector3(0.80f, 2.10f, 0.42f), Sink = 0.08f, Face = new Vector2(0.56f, 0.86f), FaceAt = 1.28f },
            new Stone { Prefab = "waystone", Rock = "boulder_01", Up = Vector3.forward, Size = new Vector3(0.72f, 1.48f, 0.50f), Sink = 0.08f },
            new Stone { Prefab = "chapter_stone", Rock = "rock_07", Up = Vector3.forward, Spin = 180, Size = new Vector3(0.46f, 0.92f, 0.30f), Sink = 0.06f },
        };

        public static string Path(string kit, string prefab) => KitPrefabs.Path(kit, $"Stones/{prefab}");

        // Makes each of a kit's stones that is not there yet. A second run changes nothing.
        public static void Make(string kit, Stone[] stones)
        {
            foreach (Stone stone in stones)
            {
                string path = Path(kit, stone.Prefab);
                if (AssetDatabase.LoadAssetAtPath<GameObject>(path) != null)
                {
                    continue;
                }
                string from = KitPrefabs.Path(kit, $"Rocks/{stone.Rock}");
                var rock = AssetDatabase.LoadAssetAtPath<GameObject>(from);
                MeshFilter theirs = rock == null ? null : rock.GetComponentInChildren<MeshFilter>();
                if (theirs == null || theirs.sharedMesh == null)
                {
                    throw new InvalidDataException($"the kit's rock {from} is not in the project: run the generation entry point (unity/Eternities/README.md)");
                }
                // The rock as its prop turns and sizes it, stood on end and spun.
                Quaternion turn = Quaternion.Euler(0, stone.Spin, 0) * Quaternion.FromToRotation(stone.Up, Vector3.up) * theirs.transform.localRotation;
                Vector3 scale = theirs.transform.localScale;
                Vector3[] points = theirs.sharedMesh.vertices.Select(vertex => turn * Vector3.Scale(scale, vertex)).ToArray();
                var low = new Vector3(points.Min(p => p.x), points.Min(p => p.y), points.Min(p => p.z));
                var high = new Vector3(points.Max(p => p.x), points.Max(p => p.y), points.Max(p => p.z));
                Vector3 extent = high - low, middle = (low + high) / 2;
                var stretch = new Vector3(stone.Size.x / extent.x, stone.Size.y / extent.y, stone.Size.z / extent.z);

                var root = new GameObject(stone.Prefab);
                // The stretch is in the stone's own axes, so it is a parent of the turned rock.
                var upright = new GameObject("Upright");
                upright.transform.SetParent(root.transform, false);
                upright.transform.localScale = stretch;
                upright.transform.localPosition = new Vector3(-middle.x * stretch.x, -low.y * stretch.y - stone.Sink, -middle.z * stretch.z);
                var drawn = new GameObject("Model");
                drawn.transform.SetParent(upright.transform, false);
                drawn.transform.localRotation = turn;
                drawn.transform.localScale = scale;
                drawn.AddComponent<MeshFilter>().sharedMesh = theirs.sharedMesh;
                drawn.AddComponent<MeshRenderer>().sharedMaterials = theirs.GetComponent<MeshRenderer>().sharedMaterials;

                // What the avatar stands against: the stone's box above the ground.
                float above = stone.Size.y - stone.Sink;
                var box = root.AddComponent<BoxCollider>();
                box.size = new Vector3(stone.Size.x, above, stone.Size.z);
                box.center = new Vector3(0, above / 2, 0);

                if (stone.Face != Vector2.zero)
                {
                    // Where the inscription is cut: on the stone's front, which its pose turns to the pad.
                    var face = new GameObject(StoneField.FaceName);
                    face.transform.SetParent(root.transform, false);
                    face.transform.localPosition = new Vector3(0, stone.FaceAt, stone.Size.z / 2 + 0.002f);
                    face.transform.localScale = new Vector3(stone.Face.x, stone.Face.y, 1);
                }

                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
                PrefabUtility.SaveAsPrefabAsset(root, path);
                Object.DestroyImmediate(root);
            }
        }

        public static GameObject Prefab(string kit, string prefab) => AssetDatabase.LoadAssetAtPath<GameObject>(Path(kit, prefab));
    }
}
