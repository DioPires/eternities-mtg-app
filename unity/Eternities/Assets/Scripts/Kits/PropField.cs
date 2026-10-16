using System;
using System.Collections;
using System.Collections.Generic;
using Unity.Collections;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // A kit prop as its prefab gives it: the mesh, the kit's material for each of its submeshes,
    // where the mesh stands in the prefab, whose origin is the prop's base and whose lengths are
    // metres, and the level of detail of its mesh it is drawn from. Assigned by the generation
    // entry point, in the order of the kit's kinds.
    [Serializable]
    public sealed class KitProp
    {
        public Mesh Mesh;
        public Material[] Materials;
        public Vector3 Offset;
        public Quaternion Turn = Quaternion.identity;
        public float Scale = 1;
        public int From;
        // A tree is cut to levels of its own (`Derive/cut_tree.py`), each a mesh, and not to the
        // importer's: `Mesh` is drawn while the prop takes at least `First` of the view's height,
        // and then each of `Levels` in turn. A prop of one mesh has none.
        public float First;
        public KitLevel[] Levels = new KitLevel[0];

        // One of it as an object of its own: the prop's base at `position`, turned by `yaw` degrees
        // and `scale` times its prefab's size. The kit's pictures stand props so (`KitPictures`).
        public MeshRenderer Stand(string name, Transform parent, Vector3 position, float yaw, float scale, bool shadow)
        {
            var made = new GameObject(name);
            made.transform.SetParent(parent, false);
            Quaternion turn = Quaternion.Euler(0, yaw, 0);
            made.transform.SetLocalPositionAndRotation(position + turn * (Offset * scale), turn * Turn);
            made.transform.localScale = Vector3.one * (scale * Scale);
            made.AddComponent<MeshFilter>().sharedMesh = Mesh;
            var renderer = made.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = Materials;
            renderer.shadowCastingMode = shadow ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.meshLodSelectionBias = From;
            if (Levels != null && Levels.Length > 0)
            {
                var levels = new LOD[Levels.Length + 1];
                levels[0] = new LOD(First, new Renderer[] { renderer });
                for (int i = 0; i < Levels.Length; i++)
                {
                    var level = new GameObject($"LOD{i + 1}");
                    level.transform.SetParent(made.transform, false);
                    level.AddComponent<MeshFilter>().sharedMesh = Levels[i].Mesh;
                    var lighter = level.AddComponent<MeshRenderer>();
                    lighter.sharedMaterials = Levels[i].Materials;
                    lighter.shadowCastingMode = renderer.shadowCastingMode;
                    levels[i + 1] = new LOD(Levels[i].Until, new Renderer[] { lighter });
                }
                var group = made.AddComponent<LODGroup>();
                group.fadeMode = LODFadeMode.None;
                group.SetLODs(levels);
                group.RecalculateBounds();
            }
            return renderer;
        }

        // The prefab's shape for the scatter, read on the main thread.
        public PropShape Shape()
        {
            Bounds bounds = Mesh.bounds;
            Vector3 size = Vector3.Scale(bounds.size, Vector3.one * Scale);
            return new PropShape
            {
                Offset = Offset, Turn = Turn, Scale = Scale, Height = size.y,
                Footprint = 0.5f * Mathf.Max(size.x, size.z),
            };
        }
    }

    // A lighter level of a prop that was cut to levels of its own: it is drawn while the prop
    // takes at least `Until` of the view's height and less than the level before it needs.
    [Serializable]
    public sealed class KitLevel
    {
        public Mesh Mesh;
        public Material[] Materials;
        public float Until;
    }

    // A world's props, drawn (PRD v4 8.4.2, 7.3): no object a prop, but every kind's instances in
    // the view drawn together, a frame at a time, by the pipeline's instancing. The static props
    // stand in cells of `Scatter.Cell`; each frame the cells in the view and in reach give their
    // props, at the level of detail their distance asks for, the growth seen across a field thinned
    // as `Variants.FieldNear` over the distance and ground cover drawn about the walker only,
    // thinning out from `Variants.CoverNear` to `Variants.CoverFar`. A prop keeps its place on the
    // ground whoever looks at it and from wherever (DEC-1055, N17): what changes with the walker's
    // place is how many of a cell's are drawn, the first so many by their rank.
    //
    // A tree has a capsule at its trunk and a large rock a box, so the avatar walks round them and
    // the following camera pulls in before them (8.4.2): a few of each, put on the props nearest
    // the avatar as it moves. Bushes and ground cover are walked through.
    public sealed class PropField : MonoBehaviour
    {
        // How far each category is drawn, in metres. Past them fog and the trees nearer hide what
        // is not drawn.
        public static float Reach(Scatter.Kind kind) => kind.Low ? Variants.CoverFar : kind.Category switch
        {
            "Trees" => 520,
            "Rocks" => kind.Shape.Height > 1.2f ? 260 : 120,
            _ => kind.Far ? 170 : 160,
        };

        // Shadows are cast within these distances: by trees from farther than by a bush or a rock.
        public static float ShadowReach(Scatter.Kind kind) => kind.Low ? 0 : kind.Category == "Trees" ? 140 : kind.Far ? 30 : 45;

        // A level of the importer's mesh levels for a screen height, as a share of the view's.
        static readonly float[] MeshLevelsFrom = { 0.09f, 0.035f, 0.014f };

        // Colliders on the props nearest the avatar: so many, looked for within so far, and put
        // again when the avatar has moved so far.
        const int Trunks = 48, Blocks = 32;
        const float ColliderReach = 30, ColliderStep = 4;
        // The ground cover of so many cells is made in one frame at most, and in more while a
        // world is still behind the veil.
        const int CoverCellsAFrame = 24, FarCellsAFrame = 6;

        public int Count { get; private set; }      // the static props of the world
        public int Drawn { get; private set; }      // the props the last frame drew
        public int CoverCells => cover.Cells.Count;
        public int FarCells => far.Cells.Count;

        Scatter scatter;
        KitProp[] models;                           // by kind
        int[] meshLevels;                           // by kind: the importer's levels in its mesh
        Transform walker;
        public Camera View;

        // What a frame draws: by kind, level and shadow, the matrices and their bounds.
        sealed class Batch
        {
            public NativeArray<Matrix4x4> Matrices;
            public int Count;
            public Vector3 Low, High;
        }

        Batch[] batches;
        NativeArray<Matrix4x4> statics;
        Bounds[] cellBounds;
        readonly Plane[] planes = new Plane[6];

        // The props about the walker that are too many to place once: a cell's by kind, each
        // kind's in rank order. Ground cover in cells of `Scatter.CoverCell` within its reach, and
        // the growth seen across a field in cells of `Scatter.FarCell` within its.
        sealed class LazyCell
        {
            public int X, Z;
            public Matrix4x4[] Matrices = new Matrix4x4[256];
            public int Count;
            public int[] RunStart, RunCount;
            public Bounds Bounds;
        }

        sealed class Lazy
        {
            public float Size, Reach;
            public bool Low;
            public readonly Dictionary<long, LazyCell> Cells = new Dictionary<long, LazyCell>();
            public readonly Stack<LazyCell> Spare = new Stack<LazyCell>();
        }

        Lazy cover, far;
        Lazy[] lazies;
        readonly List<long> leaving = new List<long>();
        readonly List<(int Kind, Scatter.Instance Prop)> making = new List<(int, Scatter.Instance)>();

        CapsuleCollider[] trunks;
        BoxCollider[] blocks;
        Vector3 collidersAt = new Vector3(float.MaxValue, 0, 0);

        public static PropField Create(Transform parent)
        {
            var root = new GameObject("Props");
            root.transform.SetParent(parent, false);
            return root.AddComponent<PropField>();
        }

        // Takes the world's scatter, placed, and the scene's props by kind. `walker` is the avatar.
        public void Bind(Scatter placed, KitProp[] byKind, Transform avatar, Camera view)
        {
            scatter = placed;
            models = byKind;
            walker = avatar;
            View = view;
            Count = placed.Matrices.Length;
            meshLevels = new int[byKind.Length];
            int levels = 1;
            for (int kind = 0; kind < byKind.Length; kind++)
            {
                meshLevels[kind] = Mathf.Max(1, byKind[kind].Mesh.lodCount);
                levels = Mathf.Max(levels, byKind[kind].Levels.Length + 1, meshLevels[kind]);
            }
            batches = new Batch[byKind.Length * levels * 2];
            levelsPerKind = levels;
            statics = new NativeArray<Matrix4x4>(placed.Matrices, Allocator.Persistent);
            placed.Matrices = null;     // the field draws from its own copy (DEC-1005, the memory cut)
            int cells = placed.Cells;
            cellBounds = new Bounds[cells * cells];
            for (int cell = 0; cell < cellBounds.Length; cell++)
            {
                cellBounds[cell] = new Bounds(new Vector3(float.NaN, 0, 0), Vector3.zero);
            }
            for (int key = 0; key < placed.RunStart.Length; key++)
            {
                int cell = key / byKind.Length, kind = key % byKind.Length;
                for (int i = placed.RunStart[key]; i < placed.RunStart[key] + placed.RunCount[key]; i++)
                {
                    Vector3 at = placed.Instances[i].Position;
                    float height = placed.Kinds[kind].Shape.Height * placed.Instances[i].Scale;
                    var box = new Bounds(at + Vector3.up * height / 2, new Vector3(height, height, height));
                    if (float.IsNaN(cellBounds[cell].center.x))
                    {
                        cellBounds[cell] = box;
                    }
                    else
                    {
                        cellBounds[cell].Encapsulate(box);
                    }
                }
            }
            float farReach = 0;
            foreach (Scatter.Kind kind in placed.Kinds)
            {
                farReach = Mathf.Max(farReach, kind.Far ? Reach(kind) : 0);
            }
            cover = new Lazy { Size = Scatter.CoverCell, Reach = Variants.CoverFar, Low = true };
            far = new Lazy { Size = Scatter.FarCell, Reach = farReach, Low = false };
            lazies = new[] { cover, far };
            trunks = new CapsuleCollider[Trunks];
            blocks = new BoxCollider[Blocks];
            for (int i = 0; i < Trunks; i++)
            {
                var holder = new GameObject("Trunk") { layer = 0 };
                holder.transform.SetParent(transform, false);
                trunks[i] = holder.AddComponent<CapsuleCollider>();
                trunks[i].enabled = false;
            }
            for (int i = 0; i < Blocks; i++)
            {
                var holder = new GameObject("Rock") { layer = 0 };
                holder.transform.SetParent(transform, false);
                blocks[i] = holder.AddComponent<BoxCollider>();
                blocks[i].enabled = false;
            }
        }

        int levelsPerKind;

        void OnDestroy()
        {
            if (statics.IsCreated)
            {
                statics.Dispose();
            }
            if (batches != null)
            {
                foreach (Batch batch in batches)
                {
                    if (batch != null && batch.Matrices.IsCreated)
                    {
                        batch.Matrices.Dispose();
                    }
                }
            }
        }

        // Makes the props about the avatar's place at once, as a world is entered behind the
        // veil, so the first frame there has them.
        public IEnumerator Warm(float budget)
        {
            double started = Time.realtimeSinceStartupAsDouble;
            while (Make(cover, int.MaxValue) + Make(far, int.MaxValue) > 0)
            {
                if ((Time.realtimeSinceStartupAsDouble - started) * 1000 > budget)
                {
                    yield return null;
                    started = Time.realtimeSinceStartupAsDouble;
                }
            }
        }

        void Update()
        {
            if (scatter == null || walker == null)
            {
                return;
            }
            Camera view = View != null ? View : Camera.main;
            if (view == null)
            {
                return;
            }
            Make(cover, CoverCellsAFrame);
            Make(far, FarCellsAFrame);
            Colliders();
            Draw(view);
        }

        // The cells within a cache's reach of the walker are made, and those out of reach given
        // back, at most `most` made in a frame. Returns how many still want making.
        int Make(Lazy lazy, int most)
        {
            Vector3 at = walker.position;
            float size = lazy.Size, reach = lazy.Reach + size, min = scatter.Plan.Grid.Min;
            int c0 = Mathf.FloorToInt((at.x - reach - min) / size), c1 = Mathf.FloorToInt((at.x + reach - min) / size);
            int r0 = Mathf.FloorToInt((at.z - reach - min) / size), r1 = Mathf.FloorToInt((at.z + reach - min) / size);
            leaving.Clear();
            foreach (KeyValuePair<long, LazyCell> held in lazy.Cells)
            {
                if (held.Value.X < c0 - 1 || held.Value.X > c1 + 1 || held.Value.Z < r0 - 1 || held.Value.Z > r1 + 1)
                {
                    leaving.Add(held.Key);
                }
            }
            foreach (long key in leaving)
            {
                lazy.Spare.Push(lazy.Cells[key]);
                lazy.Cells.Remove(key);
            }
            int made = 0, waiting = 0;
            // Nearest first: the rings about the walker's own cell, outward.
            int cx = Mathf.FloorToInt((at.x - min) / size), cz = Mathf.FloorToInt((at.z - min) / size), rings = Mathf.CeilToInt(reach / size);
            for (int ring = 0; ring <= rings; ring++)
            {
                for (int r = cz - ring; r <= cz + ring; r++)
                {
                    for (int c = cx - ring; c <= cx + ring; c++)
                    {
                        if (Mathf.Max(Mathf.Abs(r - cz), Mathf.Abs(c - cx)) != ring)
                        {
                            continue;
                        }
                        long key = ((long)r << 32) ^ (uint)c;
                        if (lazy.Cells.ContainsKey(key))
                        {
                            continue;
                        }
                        float x = min + (c + 0.5f) * size, z = min + (r + 0.5f) * size;
                        if ((x - at.x) * (x - at.x) + (z - at.z) * (z - at.z) > reach * reach)
                        {
                            continue;
                        }
                        if (made >= most)
                        {
                            waiting++;
                            continue;
                        }
                        lazy.Cells[key] = MakeCell(lazy, c, r);
                        made++;
                    }
                }
            }
            return waiting;
        }

        LazyCell MakeCell(Lazy lazy, int c, int r)
        {
            LazyCell cell = lazy.Spare.Count > 0 ? lazy.Spare.Pop() : new LazyCell { RunStart = new int[scatter.Kinds.Length], RunCount = new int[scatter.Kinds.Length] };
            cell.X = c;
            cell.Z = r;
            making.Clear();
            if (lazy.Low)
            {
                scatter.CoverIn(c, r, (kind, prop) => making.Add((kind, prop)));
            }
            else
            {
                scatter.FarIn(c, r, (kind, prop) => making.Add((kind, prop)));
            }
            making.Sort((a, b) => a.Kind != b.Kind ? a.Kind.CompareTo(b.Kind) : a.Prop.Rank.CompareTo(b.Prop.Rank));
            if (cell.Matrices.Length < making.Count)
            {
                cell.Matrices = new Matrix4x4[Mathf.NextPowerOfTwo(making.Count)];
            }
            Array.Clear(cell.RunCount, 0, cell.RunCount.Length);
            cell.Count = making.Count;
            float low = float.MaxValue, high = float.MinValue;
            for (int i = 0; i < making.Count; i++)
            {
                (int kind, Scatter.Instance prop) = making[i];
                if (cell.RunCount[kind]++ == 0)
                {
                    cell.RunStart[kind] = i;
                }
                cell.Matrices[i] = Scatter.MatrixOf(scatter.Kinds[kind].Shape, prop);
                low = Mathf.Min(low, prop.Position.y);
                high = Mathf.Max(high, prop.Position.y + scatter.Kinds[kind].Shape.Height * prop.Scale);
            }
            float size = lazy.Size;
            var centre = new Vector3(scatter.Plan.Grid.Min + (c + 0.5f) * size, 0, scatter.Plan.Grid.Min + (r + 0.5f) * size);
            cell.Bounds = making.Count == 0 ? new Bounds(centre, Vector3.zero) : new Bounds(new Vector3(centre.x, (low + high) / 2, centre.z), new Vector3(size + 2, high - low + 0.5f, size + 2));
            return cell;
        }

        // The level a prop of a kind is drawn at, from the share of the view's height it takes:
        // its own cut levels' thresholds, or the importer's levels in its mesh. -1 is not drawn.
        int Level(int kind, float share)
        {
            KitProp model = models[kind];
            if (model.Levels.Length > 0)
            {
                if (share >= model.First)
                {
                    return 0;
                }
                for (int i = 0; i < model.Levels.Length; i++)
                {
                    if (share >= model.Levels[i].Until)
                    {
                        return i + 1;
                    }
                }
                return -1;
            }
            int level = model.From;
            foreach (float from in MeshLevelsFrom)
            {
                if (share < from)
                {
                    level++;
                }
            }
            return Mathf.Min(level, meshLevels[kind] - 1);
        }

        Batch BatchOf(int kind, int level, bool shadow)
        {
            int index = (kind * levelsPerKind + level) * 2 + (shadow ? 1 : 0);
            Batch batch = batches[index] ??= new Batch { Matrices = new NativeArray<Matrix4x4>(256, Allocator.Persistent) };
            if (batch.Count == 0)
            {
                batch.Low = new Vector3(float.MaxValue, float.MaxValue, float.MaxValue);
                batch.High = -batch.Low;
            }
            return batch;
        }

        void Add(Batch batch, NativeArray<Matrix4x4> from, int start, int count, Bounds bounds)
        {
            if (batch.Count + count > batch.Matrices.Length)
            {
                var larger = new NativeArray<Matrix4x4>(Mathf.NextPowerOfTwo(batch.Count + count), Allocator.Persistent);
                NativeArray<Matrix4x4>.Copy(batch.Matrices, larger, batch.Count);
                batch.Matrices.Dispose();
                batch.Matrices = larger;
            }
            NativeArray<Matrix4x4>.Copy(from, start, batch.Matrices, batch.Count, count);
            batch.Count += count;
            batch.Low = Vector3.Min(batch.Low, bounds.min);
            batch.High = Vector3.Max(batch.High, bounds.max);
        }

        void Add(Batch batch, Matrix4x4[] from, int start, int count, Bounds bounds)
        {
            if (batch.Count + count > batch.Matrices.Length)
            {
                var larger = new NativeArray<Matrix4x4>(Mathf.NextPowerOfTwo(batch.Count + count), Allocator.Persistent);
                NativeArray<Matrix4x4>.Copy(batch.Matrices, larger, batch.Count);
                batch.Matrices.Dispose();
                batch.Matrices = larger;
            }
            NativeArray<Matrix4x4>.Copy(from, start, batch.Matrices, batch.Count, count);
            batch.Count += count;
            batch.Low = Vector3.Min(batch.Low, bounds.min);
            batch.High = Vector3.Max(batch.High, bounds.max);
        }

        void Draw(Camera view)
        {
            Vector3 eye = view.transform.position;
            GeometryUtility.CalculateFrustumPlanes(view, planes);
            float lens = 2 * Mathf.Tan(view.fieldOfView * 0.5f * Mathf.Deg2Rad);
            int kinds = scatter.Kinds.Length, cells = scatter.Cells;
            float size = Scatter.Cell, min = scatter.Plan.Grid.Min;
            const float NearAlways = 60;

            // The static props: every cell in reach of the farthest-drawn kind.
            float farthest = 0;
            foreach (Scatter.Kind kind in scatter.Kinds)
            {
                farthest = Mathf.Max(farthest, kind.Low ? 0 : Reach(kind));
            }
            int c0 = Mathf.Max(0, Mathf.FloorToInt((eye.x - farthest - min) / size)), c1 = Mathf.Min(cells - 1, Mathf.FloorToInt((eye.x + farthest - min) / size));
            int r0 = Mathf.Max(0, Mathf.FloorToInt((eye.z - farthest - min) / size)), r1 = Mathf.Min(cells - 1, Mathf.FloorToInt((eye.z + farthest - min) / size));
            for (int r = r0; r <= r1; r++)
            {
                for (int c = c0; c <= c1; c++)
                {
                    int cell = r * cells + c;
                    Bounds bounds = cellBounds[cell];
                    if (float.IsNaN(bounds.center.x))
                    {
                        continue;
                    }
                    float distance = Mathf.Sqrt(bounds.SqrDistance(eye));
                    if (distance > farthest || (distance > NearAlways && !GeometryUtility.TestPlanesAABB(planes, bounds)))
                    {
                        continue;
                    }
                    for (int kind = 0; kind < kinds; kind++)
                    {
                        int key = cell * kinds + kind;
                        int count = scatter.RunCount[key];
                        Scatter.Kind of = scatter.Kinds[kind];
                        if (count == 0 || distance > Reach(of))
                        {
                            continue;
                        }
                        if (of.Far && distance > Variants.FieldNear)
                        {
                            count = Mathf.RoundToInt(count * Variants.FieldNear / distance);
                        }
                        int level = Level(kind, of.Shape.Height / (Mathf.Max(distance, 1) * lens));
                        if (count == 0 || level < 0)
                        {
                            continue;
                        }
                        Add(BatchOf(kind, level, distance < ShadowReach(of)), statics, scatter.RunStart[key], count, bounds);
                    }
                }
            }

            // Ground cover about the walker, thinning from `CoverNear` to `CoverFar`; and the growth
            // seen across a field, thinning as `FieldNear` over the distance.
            foreach (Lazy lazy in lazies)
            {
                foreach (LazyCell cell in lazy.Cells.Values)
                {
                    if (cell.Count == 0)
                    {
                        continue;
                    }
                    float fromEye = Mathf.Sqrt(cell.Bounds.SqrDistance(eye));
                    float keep = lazy.Low ? 1 - Mathf.InverseLerp(Variants.CoverNear, Variants.CoverFar, Mathf.Sqrt(cell.Bounds.SqrDistance(walker.position)))
                        : Mathf.Min(1, Variants.FieldNear / Mathf.Max(fromEye, 1));
                    if (keep <= 0 || (fromEye > NearAlways && !GeometryUtility.TestPlanesAABB(planes, cell.Bounds)))
                    {
                        continue;
                    }
                    for (int kind = 0; kind < kinds; kind++)
                    {
                        int count = Mathf.RoundToInt(cell.RunCount[kind] * keep);
                        Scatter.Kind of = scatter.Kinds[kind];
                        if (count == 0 || (!lazy.Low && fromEye > Reach(of)))
                        {
                            continue;
                        }
                        int level = Level(kind, of.Shape.Height / (Mathf.Max(fromEye, 1) * lens));
                        if (level >= 0)
                        {
                            Add(BatchOf(kind, level, !lazy.Low && fromEye < ShadowReach(of)), cell.Matrices, cell.RunStart[kind], count, cell.Bounds);
                        }
                    }
                }
            }

            int drawn = 0;
            for (int index = 0; index < batches.Length; index++)
            {
                Batch batch = batches[index];
                if (batch == null || batch.Count == 0)
                {
                    continue;
                }
                int kind = index / 2 / levelsPerKind, level = index / 2 % levelsPerKind;
                bool shadow = (index & 1) == 1;
                KitProp model = models[kind];
                Mesh mesh = model.Levels.Length > 0 && level > 0 ? model.Levels[level - 1].Mesh : model.Mesh;
                Material[] materials = model.Levels.Length > 0 && level > 0 ? model.Levels[level - 1].Materials : model.Materials;
                var bounds = new Bounds();
                bounds.SetMinMax(batch.Low, batch.High);
                for (int sub = 0; sub < mesh.subMeshCount && sub < materials.Length; sub++)
                {
                    var parameters = new RenderParams(materials[sub])
                    {
                        worldBounds = bounds, shadowCastingMode = shadow ? ShadowCastingMode.On : ShadowCastingMode.Off, receiveShadows = true,
                        motionVectorMode = MotionVectorGenerationMode.Camera, layer = gameObject.layer,
                        forceMeshLod = model.Levels.Length > 0 ? (short)-1 : (short)level,
                    };
                    for (int start = 0; start < batch.Count; start += 1023)
                    {
                        Graphics.RenderMeshInstanced(parameters, mesh, sub, batch.Matrices, Mathf.Min(1023, batch.Count - start), start);
                    }
                }
                drawn += batch.Count;
                batch.Count = 0;
            }
            Drawn = drawn;
        }

        // The colliders, on the trees and the large rocks nearest the avatar.
        void Colliders()
        {
            Vector3 at = walker.position;
            if ((at - collidersAt).sqrMagnitude < ColliderStep * ColliderStep)
            {
                return;
            }
            collidersAt = at;
            int trunk = 0, block = 0;
            int kinds = scatter.Kinds.Length, cells = scatter.Cells;
            float size = Scatter.Cell, min = scatter.Plan.Grid.Min;
            int c0 = Mathf.Max(0, Mathf.FloorToInt((at.x - ColliderReach - min) / size)), c1 = Mathf.Min(cells - 1, Mathf.FloorToInt((at.x + ColliderReach - min) / size));
            int r0 = Mathf.Max(0, Mathf.FloorToInt((at.z - ColliderReach - min) / size)), r1 = Mathf.Min(cells - 1, Mathf.FloorToInt((at.z + ColliderReach - min) / size));
            for (int r = r0; r <= r1; r++)
            {
                for (int c = c0; c <= c1; c++)
                {
                    for (int kind = 0; kind < kinds; kind++)
                    {
                        Scatter.Kind of = scatter.Kinds[kind];
                        bool tree = of.Category == "Trees", rock = of.Category == "Rocks" && of.Shape.Height > 0.6f;
                        if (!tree && !rock)
                        {
                            continue;
                        }
                        int key = (r * cells + c) * kinds + kind;
                        for (int i = scatter.RunStart[key]; i < scatter.RunStart[key] + scatter.RunCount[key]; i++)
                        {
                            Scatter.Instance prop = scatter.Instances[i];
                            if ((prop.Position - at).sqrMagnitude > ColliderReach * ColliderReach)
                            {
                                continue;
                            }
                            if (tree && trunk < trunks.Length)
                            {
                                CapsuleCollider capsule = trunks[trunk++];
                                capsule.transform.position = prop.Position;
                                capsule.radius = 0.22f * prop.Scale;
                                capsule.height = 3;
                                capsule.center = new Vector3(0, 1.5f, 0);
                                capsule.enabled = true;
                            }
                            else if (rock && block < blocks.Length)
                            {
                                BoxCollider box = blocks[block++];
                                Vector3 extent = models[kind].Mesh.bounds.size * models[kind].Scale * prop.Scale * 0.8f;
                                box.transform.SetPositionAndRotation(prop.Position, Quaternion.Euler(0, prop.Yaw, 0));
                                box.size = extent;
                                box.center = new Vector3(0, extent.y / 2, 0);
                                box.enabled = true;
                            }
                        }
                    }
                }
            }
            for (int i = trunk; i < trunks.Length; i++)
            {
                trunks[i].enabled = false;
            }
            for (int i = block; i < blocks.Length; i++)
            {
                blocks[i].enabled = false;
            }
        }
    }
}
