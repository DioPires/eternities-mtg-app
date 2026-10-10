using System;
using System.Collections;
using System.IO;
using Eternities.Data;
using Eternities.Kits;
using UnityEngine;

namespace Eternities.Travel
{
    // The one object of the persistent scene (PRD v4 8.4.1). It owns what is loaded: on day 1 of the
    // slice that is Dominaria, built from the pack and its layout as soon as the scene starts. The
    // hub, the portal and the hold rule (PRD v4 5.9.2) take over this loading on day 2.
    public sealed class App : MonoBehaviour
    {
        public const string HomeWorld = "dominaria";
        public const float EyeHeight = 1.7f;

        // The four plinth materials by rarity, then the slab's. Assigned by the generation entry point.
        [SerializeField] Material[] standMaterials = new Material[0];

        public static App Instance { get; private set; }
        public Material[] StandMaterials { get => standMaterials; set => standMaterials = value; }
        public WorldData World { get; private set; }
        public StandField Stands { get; private set; }
        public Terrain Ground { get; private set; }
        public bool WorldReady { get; private set; }
        public string Failure { get; private set; }

        // The pinned pack's directory: `StreamingAssets/data/<hash>/`, the hash from the manifest
        // beside it (PRD v4 8.3.1).
        public static string PackDirectory()
        {
            string data = Path.Combine(Application.streamingAssetsPath, "data");
            var manifest = Json.Object(Json.Parse(File.ReadAllText(Path.Combine(data, "manifest.json"))));
            return Path.Combine(data, Json.Text(manifest["hash"]));
        }

        void Awake()
        {
            Instance = this;
        }

        IEnumerator Start()
        {
            yield return null;
            try
            {
                World = WorldData.Load(PackDirectory(), HomeWorld);
                var root = new GameObject(World.Plane.DisplayName);
                Ground = WorldGround.Build(World, root.transform);
                Stands = StandField.Build(World, standMaterials, root.transform);

                // The arrival point, facing north (PRD v4 5.4.5), at eye height until the avatar exists.
                Camera view = Camera.main;
                if (view != null)
                {
                    view.transform.SetPositionAndRotation(StandField.Ground(World.Layout.Arrival) + new Vector3(0, EyeHeight, 0), Quaternion.identity);
                }
                WorldReady = true;
            }
            catch (Exception e)
            {
                Failure = e.Message;
                Debug.LogException(e);
            }
        }

        void OnDestroy()
        {
            if (Instance == this)
            {
                Instance = null;
            }
        }
    }
}
