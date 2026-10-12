using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Kits
{
    // A kit prop's model as the project holds it: the mesh of its file and the kit's material for
    // each of its submeshes. Assigned by the generation entry point, in the order of the kit's kinds.
    [Serializable]
    public sealed class KitProp
    {
        public Mesh Mesh;
        public Material[] Materials;
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
                var made = new GameObject(kind.Model);
                made.transform.SetParent(transform, false);
                made.transform.SetLocalPositionAndRotation(new Vector3(prop.X, prop.Y - PropPlan.Sink * prop.Scale, prop.Z), Quaternion.Euler(0, prop.Yaw, 0));
                made.transform.localScale = Vector3.one * prop.Scale;
                made.AddComponent<MeshFilter>().sharedMesh = model.Mesh;
                var renderer = made.AddComponent<MeshRenderer>();
                renderer.sharedMaterials = model.Materials;
                renderer.shadowCastingMode = kind.Shadow ? ShadowCastingMode.On : ShadowCastingMode.Off;
                if (kind.Trunk > 0)
                {
                    var trunk = made.AddComponent<CapsuleCollider>();
                    trunk.radius = kind.Trunk;
                    trunk.height = kind.TrunkHeight;
                    trunk.center = new Vector3(0, kind.TrunkHeight / 2, 0);
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
