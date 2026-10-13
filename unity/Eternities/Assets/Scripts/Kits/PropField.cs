using System;
using System.Collections;
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
        // and `scale` times its prefab's size.
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

    // A world's props as objects (PRD v4 8.4.2): one object a prop, and every object of a kind
    // sharing its mesh and materials, which is what the pipeline's GPU-driven path draws instanced.
    // A tree has a capsule at its trunk and a rock a box, so the avatar walks round them and the
    // following camera pulls in before them (PRD v4 8.4.2); bushes, flat stones and reeds are
    // walked through.
    public sealed class PropField : MonoBehaviour
    {
        public int Count { get; private set; }

        public static PropField Create(Transform parent)
        {
            var root = new GameObject("Props");
            root.transform.SetParent(parent, false);
            return root.AddComponent<PropField>();
        }

        // Makes the props one after another, and yields whenever a frame has spent `budget`
        // milliseconds on them, as the stands do.
        public IEnumerator Fill(PropPlan plan, KitProp[] kit, float budget)
        {
            double sliceStarted = Time.realtimeSinceStartupAsDouble;
            foreach (Prop prop in plan.Props)
            {
                PropKind kind = Temperate.Kinds[prop.Kind];
                KitProp model = kit[prop.Kind];
                GameObject made = model.Stand(kind.Name, transform, new Vector3(prop.X, prop.Y - kind.Sink * prop.Scale, prop.Z), prop.Yaw, prop.Scale, kind.Shadow).gameObject;
                if (kind.Trunk > 0)
                {
                    // In the mesh's own lengths. A tree's mesh stands on its own y axis: the
                    // generation entry point holds that.
                    var trunk = made.AddComponent<CapsuleCollider>();
                    trunk.radius = kind.Trunk / model.Scale;
                    trunk.height = kind.TrunkHeight / model.Scale;
                    trunk.center = (new Vector3(0, kind.TrunkHeight / 2, 0) - model.Offset) / model.Scale;
                }
                else if (kind.Block)
                {
                    // A little inside the model's bounds: a rock's corners are not where its bounds are.
                    var block = made.AddComponent<BoxCollider>();
                    block.center = model.Mesh.bounds.center;
                    block.size = model.Mesh.bounds.size * 0.8f;
                }
                Count++;
                if ((Count & 15) == 0 && (Time.realtimeSinceStartupAsDouble - sliceStarted) * 1000 > budget)
                {
                    yield return null;
                    sliceStarted = Time.realtimeSinceStartupAsDouble;
                }
            }
        }
    }
}
