using System.Collections;
using System.Collections.Generic;
using Eternities.Data;
using Eternities.Layout;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // A world's stones (PRD v4 5.4.16, 5.13.1; the glossary's "Stone"): the kit's reading stone at
    // each era site's pad, its waystone at each regional site and at a set site of five stands or
    // more, and its low stone for a marker stone and for each chapter after an era's first. Each
    // stands on its pose's disc of 0.5 m (`LayoutConstants.StoneRadius`), turned the way its pose
    // faces, and its collider stays inside that disc, as the layout's clearances assume.
    //
    // A reading stone's face towards its pad carries an inscription: a dressed tablet set into the
    // stone, cut with rows of marks that read as text from the pad. The prefab says where the face
    // is (its child `Face`); the tablets and the marks of every reading stone are one mesh, made
    // here, in the kit's materials for each.
    public sealed class StoneField : MonoBehaviour
    {
        public const string Chapter = "chapter";
        public const string FaceName = "Face";
        // How deep a tablet is set into its stone, and how far its marks stand in front of it.
        public const float TabletDepth = 0.15f, MarkLift = 0.0015f;
        // The marks: rows of words, each row as tall as a carved letter, under a taller first row.
        public const float RowHeight = 0.022f, TitleHeight = 0.034f, RowGap = 0.03f, WordGap = 0.026f, LetterGap = 0.3f, Margin = 0.07f;

        public sealed class Stone
        {
            public string Kind;             // reading, way, marker or chapter
            public int Site;
            public int Chapter = -1;        // a chapter stone's place in its site's list of chapters
            public Vector3 Foot;
            public Quaternion Facing;
            public float Height;            // its top above the ground, where its label stands
            public string Label;            // made once, with the stone (PRD v4 7.3.2)
            public GameObject Shown;
        }

        public readonly List<Stone> All = new List<Stone>();
        public int Count => All.Count;
        public int Inscriptions { get; private set; }
        public Mesh Inscribed { get; private set; }

        readonly List<Vector3> vertices = new List<Vector3>();
        readonly List<Vector3> normals = new List<Vector3>();
        readonly List<Vector2> uvs = new List<Vector2>();
        readonly List<int> tablets = new List<int>(), marks = new List<int>();

        void OnDestroy()
        {
            if (Inscribed != null)
            {
                Destroy(Inscribed);
            }
        }

        public static StoneField Create(Transform parent)
        {
            var root = new GameObject("Stones");
            root.transform.SetParent(parent, false);
            return root.AddComponent<StoneField>();
        }

        // The prefab a kind of stone is drawn with: a marker stone is low, as a chapter stone is.
        public static GameObject PrefabOf(KitDressing kit, string kind) => kind switch
        {
            Reading.ReadingStone => kit.ReadingStone,
            Reading.Waystone => kit.Waystone,
            _ => kit.ChapterStone,
        };

        // Every stone of the world, from the kit's prefabs. Yields whenever a frame has spent
        // `budget` milliseconds.
        public IEnumerator Fill(WorldData world, KitDressing kit, float budget)
        {
            double sliceStarted = Time.realtimeSinceStartupAsDouble;
            WorldSite[] sites = world.Layout.Sites;
            for (int s = 0; s < sites.Length; s++)
            {
                WorldSite site = sites[s];
                Place(new Stone { Kind = site.StoneKind, Site = s, Label = Reading.Label(world, s) }, site.Stone, kit);
                for (int c = 0; c < site.Chapters.Length; c++)
                {
                    if (site.Chapters[c].Stone is Data.Pose pose)
                    {
                        Place(new Stone { Kind = Chapter, Site = s, Chapter = c, Label = Reading.ChapterLabel(world, s, c) }, pose, kit);
                    }
                }
                if ((Time.realtimeSinceStartupAsDouble - sliceStarted) * 1000 > budget)
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
            if (Inscriptions > 0)
            {
                Inscribed = new Mesh { name = $"inscriptions {world.Plane.Slug}", indexFormat = IndexFormat.UInt32 };
                Inscribed.SetVertices(vertices);
                Inscribed.SetNormals(normals);
                Inscribed.SetUVs(0, uvs);
                Inscribed.subMeshCount = 2;
                Inscribed.SetTriangles(tablets, 0);
                Inscribed.SetTriangles(marks, 1);
                Inscribed.RecalculateBounds();
                Inscribed.UploadMeshData(true);
                var faces = new GameObject("Inscriptions");
                faces.transform.SetParent(transform, false);
                faces.AddComponent<MeshFilter>().sharedMesh = Inscribed;
                var renderer = faces.AddComponent<MeshRenderer>();
                renderer.sharedMaterials = new[] { kit.Tablet, kit.Inscription };
                renderer.shadowCastingMode = ShadowCastingMode.Off;
            }
            vertices.Clear();
            normals.Clear();
            uvs.Clear();
            tablets.Clear();
            marks.Clear();
        }

        void Place(Stone stone, Data.Pose pose, KitDressing kit)
        {
            GameObject prefab = PrefabOf(kit, stone.Kind);
            stone.Foot = StandField.Ground(pose.Position);
            stone.Facing = StandField.Facing(pose.Yaw);
            stone.Shown = Instantiate(prefab, stone.Foot, stone.Facing, transform);
            stone.Shown.name = stone.Chapter >= 0 ? $"chapter stone {stone.Chapter} of site {stone.Site}" : $"{stone.Kind} stone of site {stone.Site}";
            stone.Height = HeightOf(prefab);
            Transform face = stone.Kind == Reading.ReadingStone ? prefab.transform.Find(FaceName) : null;
            if (face != null)
            {
                Inscribe(stone, face);
            }
            All.Add(stone);
        }

        // How tall a stone's prefab stands above the ground: the top of its collider.
        public static float HeightOf(GameObject prefab)
        {
            var box = prefab.GetComponent<BoxCollider>();
            return box == null ? 1 : box.center.y + box.size.y / 2;
        }

        // A reading stone's inscription: the tablet on the prefab's face, and its marks, drawn the
        // same for the same site on every machine. A tablet's texture coordinates are metres.
        void Inscribe(Stone stone, Transform face)
        {
            float width = face.localScale.x, height = face.localScale.y;
            Vector3 middle = face.localPosition;
            Vector3 At(float x, float y, float z) => stone.Foot + stone.Facing * (middle + new Vector3(x, y, z));
            Vector3 front = stone.Facing * Vector3.forward;

            // The tablet: its front and its four sides, set `TabletDepth` into the stone.
            float hw = width / 2, hh = height / 2;
            Quad(tablets, At(-hw, -hh, 0), At(-hw, hh, 0), At(hw, hh, 0), At(hw, -hh, 0), front, width, height);
            Quad(tablets, At(-hw, -hh, -TabletDepth), At(-hw, hh, -TabletDepth), At(-hw, hh, 0), At(-hw, -hh, 0), stone.Facing * Vector3.left, TabletDepth, height);
            Quad(tablets, At(hw, -hh, 0), At(hw, hh, 0), At(hw, hh, -TabletDepth), At(hw, -hh, -TabletDepth), stone.Facing * Vector3.right, TabletDepth, height);
            Quad(tablets, At(-hw, hh, 0), At(-hw, hh, -TabletDepth), At(hw, hh, -TabletDepth), At(hw, hh, 0), stone.Facing * Vector3.up, width, TabletDepth);
            Quad(tablets, At(-hw, -hh, -TabletDepth), At(-hw, -hh, 0), At(hw, -hh, 0), At(hw, -hh, -TabletDepth), stone.Facing * Vector3.down, width, TabletDepth);

            // The marks: a title row, then rows of words of the era's text's rough length.
            var random = new System.Random(7919 * (stone.Site + 1));
            float top = hh - Margin, left = -hw + Margin, right = hw - Margin;
            float y = top;
            for (int row = 0; y - (row == 0 ? TitleHeight : RowHeight) > -hh + Margin; row++)
            {
                float tall = row == 0 ? TitleHeight : RowHeight;
                float x = row == 0 ? left + (float)random.NextDouble() * 0.12f : left;
                float end = row == 0 ? right - (float)random.NextDouble() * 0.12f : right - (float)random.NextDouble() * 0.08f;
                while (x < end)
                {
                    // A word of two to seven letters, each a cut of its own.
                    int letters = 2 + random.Next(6);
                    for (int letter = 0; letter < letters && x < end; letter++)
                    {
                        float wide = Mathf.Min(tall * (0.45f + (float)random.NextDouble() * 0.4f), end - x);
                        if (wide > tall * 0.3f)
                        {
                            Quad(marks, At(x, y - tall, MarkLift), At(x, y, MarkLift), At(x + wide, y, MarkLift), At(x + wide, y - tall, MarkLift), front, wide, tall);
                        }
                        x += wide + tall * LetterGap;
                    }
                    x += WordGap;
                }
                y -= tall + RowGap + (row == 0 ? 0.02f : 0);
            }
            Inscriptions++;
        }

        void Quad(List<int> triangles, Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 normal, float u, float v)
        {
            int first = vertices.Count;
            vertices.Add(a);
            vertices.Add(b);
            vertices.Add(c);
            vertices.Add(d);
            for (int i = 0; i < 4; i++)
            {
                normals.Add(normal);
            }
            uvs.Add(new Vector2(0, 0));
            uvs.Add(new Vector2(0, v));
            uvs.Add(new Vector2(u, v));
            uvs.Add(new Vector2(u, 0));
            // The engine draws a triangle's clockwise side: the side `normal` looks out of.
            bool clockwise = Vector3.Dot(Vector3.Cross(b - a, c - a), normal) > 0;
            triangles.AddRange(clockwise
                ? new[] { first, first + 1, first + 2, first, first + 2, first + 3 }
                : new[] { first, first + 2, first + 1, first, first + 3, first + 2 });
        }

        // Where travel to a chapter arrives, and which way it faces (PRD v4 6.6.1): a first
        // chapter's is its site's pad. A later chapter's stone stands among the chapter's stands,
        // so the travel arrives on the site's path at the point nearest the stone, facing it: the
        // path is reserved ground, where nothing stands. The pack's own destination is the stone's
        // pose, inside the stone.
        public static Vector3 ChapterArrival(WorldSite site, int chapter, out Quaternion heading)
        {
            SiteChapter row = site.Chapters[chapter];
            if (row.Stone == null)
            {
                heading = Facing(site.Pad.Yaw);
                return StandField.Ground(site.Pad.Position);
            }
            Vector3 stone = StandField.Ground(row.Stone.Value.Position);
            Vector3 arrival = StandField.Ground(site.Path[0]);
            float best = float.MaxValue;
            for (int i = 0; i + 1 < site.Path.Length; i++)
            {
                Vector3 a = StandField.Ground(site.Path[i]), b = StandField.Ground(site.Path[i + 1]), along = b - a;
                float t = along.sqrMagnitude > 0 ? Mathf.Clamp01(Vector3.Dot(stone - a, along) / along.sqrMagnitude) : 0;
                Vector3 at = a + along * t;
                if ((at - stone).sqrMagnitude < best)
                {
                    best = (at - stone).sqrMagnitude;
                    arrival = at;
                }
            }
            Vector3 toward = stone - arrival;
            heading = toward.sqrMagnitude > 1e-6f ? Quaternion.LookRotation(toward) : Facing(row.Stone.Value.Yaw);
            return arrival;
        }

        static Quaternion Facing(long yaw) => StandField.Facing(yaw);

        // The nearest stone within `within` metres of a point on the ground, or -1, and the square
        // of its distance; measured to its pose, as a stand's is to its own (`StandImages.Nearest`).
        public int Nearest(Vector3 position, float within, out float squared)
        {
            int best = -1;
            squared = within * within;
            for (int i = 0; i < All.Count; i++)
            {
                float dx = All[i].Foot.x - position.x, dz = All[i].Foot.z - position.z;
                if (dx * dx + dz * dz <= squared)
                {
                    squared = dx * dx + dz * dz;
                    best = i;
                }
            }
            return best;
        }

        // What a visitor's E or click reaches (PRD v4 6.1.3): the nearer of the stand and the stone
        // within reach, each given by the square of its distance, or -1 for none; on a tie, the
        // stand. True when the stone wins.
        public static bool StoneWins(int stand, float standSquared, int stone, float stoneSquared) =>
            stone >= 0 && (stand < 0 || stoneSquared < standSquared);

        // Does a stone use E (PRD v4 6.1.3, 6.6.2)? A reading stone and a waystone do; a marker
        // stone and a chapter stone show their label and offer no travel.
        public static bool Usable(string kind) => kind == Reading.ReadingStone || kind == Reading.Waystone;
    }
}
