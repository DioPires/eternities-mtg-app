using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Eternities.Audio;
using Eternities.Avatar;
using Eternities.CardView;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using Eternities.UI;
using UnityEngine;
using UnityEngine.UIElements;

namespace Eternities.Travel
{
    public enum Place
    {
        Hub,
        World,
    }

    // The one object of the persistent scene (PRD v4 8.4.1). It owns the avatar, the camera rig, the
    // hub and whichever world is loaded, and it is the only thing that moves the visitor between
    // them. The slice's hub is plain (PRD v4 9.5): the ground, the home plane's portal where the
    // ring of 88 will have it, and nothing else.
    //
    // The hub stands 2 km above the world's ground, so a world is built in place, whole, while the
    // visitor is still in the hub, and the cut of a portal is a move of the avatar.
    public sealed class App : MonoBehaviour
    {
        public const string HomeWorld = "dominaria";
        public const float TransitionSeconds = 1.5f, ReducedFadeSeconds = 0.3f, ArrivalFadeSeconds = 0.25f;   // PRD v4 5.9.1, 5.9.5
        public const float HoldIndicatorAfter = 6;                  // PRD v4 5.9.2, 7.2
        public const float PreloadDistance = 10;                    // PRD v4 5.3.3
        public const float PortalRingRadius = 56, HubRadius = 64;   // PRD v4 5.3.2
        public const float ReturnPortalSouth = 8;                   // PRD v4 5.4.5
        public const float LoadBudgetMs = 4;
        static readonly Vector3 HubOrigin = new Vector3(0, 2000, 0);

        // Assigned by the generation entry point. The stand materials are the four plinths by
        // rarity, then the slab. The terrain layers are the kit's meadow, path and gravel, or empty.
        [SerializeField] Material[] standMaterials = new Material[0];
        [SerializeField] Material avatarMaterial, hubGroundMaterial, portalFrameMaterial, portalSurfaceMaterial, veilMaterial;
        [SerializeField] TerrainLayer[] terrainLayers = new TerrainLayer[0];
        [SerializeField] Material imageSurfaceMaterial;
        [SerializeField] Shader exhibitShader, exhibitCompositeShader;
        [SerializeField] AudioClip ambientBed, riverLoop;
        [SerializeField] PanelSettings panelSettings;

        public static App Instance { get; private set; }

        public Material[] StandMaterials { get => standMaterials; set => standMaterials = value; }
        public Material AvatarMaterial { get => avatarMaterial; set => avatarMaterial = value; }
        public Material HubGroundMaterial { get => hubGroundMaterial; set => hubGroundMaterial = value; }
        public Material PortalFrameMaterial { get => portalFrameMaterial; set => portalFrameMaterial = value; }
        public Material PortalSurfaceMaterial { get => portalSurfaceMaterial; set => portalSurfaceMaterial = value; }
        public Material VeilMaterial { get => veilMaterial; set => veilMaterial = value; }
        public TerrainLayer[] TerrainLayers { get => terrainLayers; set => terrainLayers = value; }
        public Material ImageSurfaceMaterial { get => imageSurfaceMaterial; set => imageSurfaceMaterial = value; }
        public Shader ExhibitShader { get => exhibitShader; set => exhibitShader = value; }
        public Shader ExhibitCompositeShader { get => exhibitCompositeShader; set => exhibitCompositeShader = value; }
        public AudioClip AmbientBed { get => ambientBed; set => ambientBed = value; }
        public AudioClip RiverLoop { get => riverLoop; set => riverLoop = value; }
        public PanelSettings PanelSettings { get => panelSettings; set => panelSettings = value; }

        public Pack Pack { get; private set; }
        public AvatarController Avatar { get; private set; }
        public FollowCamera View { get; private set; }
        public Portal HubPortal { get; private set; }
        public Portal ReturnPortal { get; private set; }
        public WorldData World { get; private set; }
        public StandField Stands { get; private set; }
        public StandImages Images { get; private set; }
        public Exhibit Exhibit { get; private set; }
        public WorldSound Sound { get; private set; }
        public Hud Hud { get; private set; }
        public CardViewer CardView { get; private set; }
        public int HoveredStand { get; private set; } = -1;
        public readonly List<int> RecentlyVisited = new List<int>();     // the last 50 stands entered in card view (PRD v4 6.6.4)
        public const float InteractDistance = 3;                         // PRD v4 5.5.3
        public const float TravelPortalDistance = 2, TravelWalkSeconds = 1;  // PRD v4 5.9.4
        public IImageSource ImageSource;    // where stand images come from; set before a world loads
        // Tests name a source of their own here, so that no test run reaches Scryfall.
        public static Func<IImageSource> ImageSourceForTests;
        public Terrain Ground { get; private set; }
        public GroundPlan GroundPlan => plan;

        public Place Place { get; private set; }
        public bool HubReady { get; private set; }
        public bool WorldLoaded { get; private set; }       // built and ready to be walked into
        public bool WorldReady => WorldLoaded && Place == Place.World && !InTransition;
        public bool InTransition { get; private set; }
        public bool Holding { get; private set; }           // a portal is waiting for its world (PRD v4 5.9.2)
        public bool HoldIndicator { get; private set; }
        public bool ReducedMotion;                          // PRD v4 5.11.2
        public float LoadDelayForTests;                     // seconds a load waits before it ends, so a test can see the hold
        public string Failure { get; private set; }

        // What the bench times, in seconds: from the step into a portal to the arrival beyond it,
        // and the part of that spent holding for the world.
        public double LastTravelSeconds { get; private set; }
        public double LastHoldSeconds { get; private set; }

        GameObject hubRoot, worldRoot;
        Coroutine loading;
        Renderer veil;
        readonly List<UnityEngine.Object> worldOwned = new List<UnityEngine.Object>();

        static double Now => Time.realtimeSinceStartupAsDouble;

        // The pinned pack's directory: `StreamingAssets/data/<hash>/`, the hash from the manifest
        // beside it (PRD v4 8.3.1).
        public static string PackDirectory()
        {
            string data = Path.Combine(Application.streamingAssetsPath, "data");
            var manifest = Json.Object(Json.Parse(File.ReadAllText(Path.Combine(data, "manifest.json"))));
            return Path.Combine(data, Json.Text(manifest["hash"]));
        }

        // Where a plane's portal stands on the hub's ring, in degrees clockwise from north: by the
        // plane's first year, ties by slug; planes without cards last, by slug (PRD v4 5.3.2).
        public static float PortalAngle(Pack pack, string slug)
        {
            var order = new List<PackPlane>(pack.Planes);
            order.Sort((a, b) =>
            {
                if ((a.CardCount == 0) != (b.CardCount == 0))
                {
                    return a.CardCount == 0 ? 1 : -1;
                }
                int byYear = a.CardCount == 0 ? 0 : a.FirstYear.CompareTo(b.FirstYear);
                return byYear != 0 ? byYear : string.CompareOrdinal(a.Slug, b.Slug);
            });
            return 360f * order.FindIndex(plane => plane.Slug == slug) / order.Count;
        }

        void Awake()
        {
            Instance = this;
        }

        void Start()
        {
            try
            {
                Pack = new Pack(PackDirectory());
                // The image cache lives under the application-support directory (PRD v4 4.15.3, 7.4.4).
                ImageSource = ImageSourceForTests != null ? ImageSourceForTests() : ScryfallImages.Create(Path.Combine(Application.persistentDataPath, "images"), transform);
                BuildHub();
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

        void BuildHub()
        {
            hubRoot = new GameObject("Hub");
            hubRoot.transform.position = HubOrigin;

            var ground = new GameObject("Ground");
            ground.transform.SetParent(hubRoot.transform, false);
            Mesh disc = GroundDisc(HubRadius, 64);
            ground.AddComponent<MeshFilter>().sharedMesh = disc;
            ground.AddComponent<MeshRenderer>().sharedMaterial = hubGroundMaterial;
            ground.AddComponent<MeshCollider>().sharedMesh = disc;

            // The portal stands on the ring and faces the arrival point at the centre.
            Quaternion toPortal = Quaternion.Euler(0, PortalAngle(Pack, HomeWorld), 0);
            HubPortal = Portal.Build($"Portal to {HomeWorld}", portalFrameMaterial, portalSurfaceMaterial, hubRoot.transform,
                HubOrigin + toPortal * Vector3.forward * PortalRingRadius, toPortal * Quaternion.Euler(0, 180, 0));

            Avatar = AvatarController.Create(avatarMaterial);
            Avatar.Source = new PlayerInputSource();
            Avatar.Place(HubOrigin, toPortal);      // the visitor arrives facing the home plane's portal (PRD v4 5.8.5)
            Avatar.Keep = KeepInHub;
            Camera view = Camera.main;
            View = FollowCamera.Create(view, Avatar);
            Exhibit = Exhibit.Create(view, exhibitShader, exhibitCompositeShader);
            CardView = CardViewer.Create(view);
            CardView.BodyMaterial = standMaterials[standMaterials.Length - 1];
            CardView.Changed += CardChanged;
            Hud = Hud.Create(panelSettings, transform);

            // The veil: what a portal's surface becomes as it fills the view. A quad just past the
            // near plane, black, its opacity set by the transition.
            GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            quad.name = "Veil";
            Destroy(quad.GetComponent<Collider>());
            quad.layer = 2;
            quad.transform.SetParent(view.transform, false);
            float distance = view.nearClipPlane + 0.05f;
            quad.transform.localPosition = new Vector3(0, 0, distance);
            quad.transform.localScale = new Vector3(8 * distance, 8 * distance, 1);
            veil = quad.GetComponent<Renderer>();
            veil.material = veilMaterial;
            Veil(0);

            Place = Place.Hub;
            HubReady = true;
        }

        static Mesh GroundDisc(float radius, int around)
        {
            var vertices = new List<Vector3> { Vector3.zero };
            var triangles = new List<int>();
            for (int i = 0; i <= around; i++)
            {
                float a = 2 * Mathf.PI * i / around;
                vertices.Add(new Vector3(Mathf.Sin(a) * radius, 0, Mathf.Cos(a) * radius));
            }
            for (int i = 1; i <= around; i++)
            {
                triangles.AddRange(new[] { 0, i, i + 1 });
            }
            var mesh = new Mesh { name = "hub ground" };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            return mesh;
        }

        Vector3 KeepInHub(Vector3 position)
        {
            Vector3 flat = position - HubOrigin;
            flat.y = 0;
            return flat.magnitude <= HubRadius - 1 ? position : HubOrigin + flat.normalized * (HubRadius - 1) + Vector3.up * (position.y - HubOrigin.y);
        }

        // The world's edge is the kit's to make natural (PRD v4 5.1.5). Until it does, the avatar
        // stops where the ground's margin begins.
        Vector3 KeepInWorld(Vector3 position)
        {
            float limit = World.Layout.WorldRadius / 1000f + GroundPlan.Margin - 20;
            var flat = new Vector3(position.x, 0, position.z);
            if (flat.magnitude > limit)
            {
                return flat.normalized * limit + Vector3.up * position.y;
            }
            // The water is an edge too: a step that would end in it is not taken.
            return plan.Wet(position.x, position.z) && !plan.Wet(lastDry.x, lastDry.z) ? lastDry : (lastDry = position);
        }

        GroundPlan plan;
        Vector3 lastDry;

        void Veil(float opacity)
        {
            veil.enabled = opacity > 0;
            veil.material.SetColor("_UnlitColor", new Color(0, 0, 0, opacity));
        }

        void Update()
        {
            if (Failure != null || !HubReady || InTransition)
            {
                return;
            }
            Vector3 at = Avatar.transform.position;
            if (Place == Place.World && Explore(at))
            {
                return;
            }
            if (Place == Place.Hub)
            {
                // PRD v4 5.3.3: the world whose pad the avatar is near begins to load.
                if (loading == null && !WorldLoaded && Vector3.Distance(at, HubPortal.Pad) < PreloadDistance)
                {
                    loading = StartCoroutine(Load(HomeWorld));
                }
                if (HubPortal.Holds(at) || (Avatar.Input.Interact && Vector3.Distance(at, HubPortal.Pad) < 3))
                {
                    StartCoroutine(Through(HubPortal, Place.World));
                }
            }
            else if (ReturnPortal.Holds(at) || Avatar.Input.Back)
            {
                // PRD v4 5.3.5: Esc from any world returns to the hub through the return portal.
                StartCoroutine(Through(ReturnPortal, Place.Hub));
            }
        }

        // Explore, card view and the travel menu (PRD v4 6.2). True when the frame's input was used.
        bool Explore(Vector3 at)
        {
            AvatarInput input = Avatar.Input;
            CardView.ReducedMotion = ReducedMotion;
            if (CardView.Active)
            {
                // Esc, the back control or walking leaves card view (PRD v4 5.10.4).
                if (input.Back || input.Move != Vector2.zero || input.WorldMove != Vector3.zero)
                {
                    CardView.Leave();
                }
                else if (input.Interact && CardView.Card.HasBackImage)
                {
                    CardView.Flip();
                }
                return true;
            }
            if (Hud.TravelOpen)
            {
                if (input.Back || input.TravelMenu)
                {
                    Hud.HideTravel();
                }
                return true;
            }
            if (input.TravelMenu)
            {
                OpenTravel();
                return true;
            }

            // The stand within reach shows its label, and interacting with it enters card view.
            HoveredStand = Images != null ? Images.Nearest(at, InteractDistance) : -1;
            if (HoveredStand >= 0)
            {
                LayoutStand stand = World.Layout.Stands[HoveredStand];
                Vector3 top = StandField.Ground(stand.Position) + Vector3.up * StandField.SlabTop;
                Vector3 screen = Camera.main.WorldToScreenPoint(top);
                Hud.Hover(screen.z > 0 ? CardViewer.Label(World, HoveredStand) : null, screen);
                if (input.Interact)
                {
                    CardView.Enter(HoveredStand);
                    return true;
                }
            }
            else
            {
                Hud.Hover(null, default);
            }
            return false;
        }

        void CardChanged()
        {
            Avatar.Shown = !CardView.Active;
            if (!CardView.Active)
            {
                Hud.HideCard();
                return;
            }
            Hud.Hover(null, default);
            if (RecentlyVisited.Count == 0 || RecentlyVisited[RecentlyVisited.Count - 1] != CardView.Stand)
            {
                RecentlyVisited.Remove(CardView.Stand);
                RecentlyVisited.Add(CardView.Stand);
                if (RecentlyVisited.Count > 50)
                {
                    RecentlyVisited.RemoveAt(0);
                }
            }
            Hud.ShowCard(CardView.Sheet(), CardView.Show, CardView.Flip, () => Application.OpenURL(CardView.PageUrl()), CardView.Leave);
        }

        // The slice's travel menu: this world's sites, and the cards of the one chosen.
        void OpenTravel()
        {
            var sites = new List<string>();
            foreach (LayoutSite site in World.Layout.Sites)
            {
                PackSet set = World.Plane.Sets[site.Set];
                string wedge = new[] { "White", "Blue", "Black", "Red", "Green", "Gold", "Colourless" }[(int)site.Class];
                sites.Add($"{set.Name}, {set.Year} · {wedge} · {site.Stands}");
            }
            Hud.Hover(null, default);
            Hud.ShowTravel(World.Plane.DisplayName, sites, site => StandsOf(site).ConvertAll(stand => World.Cards[World.Layout.Stands[stand].Card].Name),
                (site, card) => TravelTo(StandsOf(site)[card]), Hud.HideTravel);
        }

        // A site's stands, by the name of their card.
        public List<int> StandsOf(int site)
        {
            var stands = new List<int>();
            for (int stand = 0; stand < World.Layout.Stands.Count; stand++)
            {
                if (World.Layout.Stands[stand].Site == site)
                {
                    stands.Add(stand);
                }
            }
            stands.Sort((a, b) => string.CompareOrdinal(World.Cards[World.Layout.Stands[a].Card].Name, World.Cards[World.Layout.Stands[b].Card].Name));
            return stands;
        }

        // Travel within the world (PRD v4 5.9.4): a portal opens 2 m in front of the avatar, facing
        // it; the avatar walks into it over a second, with no steering by the visitor, and arrives
        // on the stand's apron, facing the stand. The portal closes behind it.
        public void TravelTo(int stand)
        {
            if (Place == Place.World && !InTransition)
            {
                Hud.HideTravel();
                StartCoroutine(Travel(stand));
            }
        }

        IEnumerator Travel(int stand)
        {
            InTransition = true;
            double entered = Now;
            Avatar.Locked = true;
            Vector3 ahead = Avatar.transform.forward;
            Portal portal = Portal.Build("Travel portal", portalFrameMaterial, portalSurfaceMaterial, worldRoot.transform,
                Avatar.transform.position + ahead * TravelPortalDistance, Quaternion.LookRotation(-ahead));
            Avatar.Walk = ahead * (TravelPortalDistance / TravelWalkSeconds);
            float fade = ReducedMotion ? ReducedFadeSeconds : TravelWalkSeconds;
            for (double began = Now; Now - began < TravelWalkSeconds;)
            {
                Veil(Mathf.Clamp01((float)((Now - began - (TravelWalkSeconds - fade)) / fade)));
                yield return null;
            }
            Veil(1);
            Avatar.Walk = Vector3.zero;

            LayoutStand placed = World.Layout.Stands[stand];
            Quaternion facing = StandField.Facing(placed);
            Vector3 apron = StandField.Ground(placed.Position) + facing * Vector3.forward * ((LayoutConstants.FootprintHalfDepth + LayoutConstants.ApronDepth / 2) / 1000f);
            Avatar.Place(lastDry = apron, facing * Quaternion.Euler(0, 180, 0));
            View.Behind();
            Destroy(portal.gameObject);
            yield return null;
            LastTravelSeconds = Now - entered;
            for (double began = Now; Now - began < ArrivalFadeSeconds;)
            {
                Veil(1 - Mathf.Clamp01((float)((Now - began) / ArrivalFadeSeconds)));
                yield return null;
            }
            Veil(0);
            Avatar.Locked = false;
            InTransition = false;
        }

        // A world, built whole while the visitor is elsewhere: the pack's shards and the layout are
        // read and the ground planned on another thread, and the main thread builds in slices.
        IEnumerator Load(string slug)
        {
            string directory = PackDirectory();
            Task<(WorldData, GroundPlan)> read = Task.Run(() =>
            {
                WorldData world = WorldData.Load(directory, slug);
                return (world, GroundPlan.Compute(world.Layout));
            });
            while (!read.IsCompleted)
            {
                yield return null;
            }
            if (read.IsFaulted)
            {
                Failure = read.Exception.GetBaseException().Message;
                Debug.LogException(read.Exception);
                yield break;
            }
            (World, plan) = read.Result;
            worldRoot = new GameObject(World.Plane.DisplayName);
            yield return null;

            TerrainLayer[] layers = WorldGround.Layers(terrainLayers);
            Ground = WorldGround.Build(plan, layers, World.Plane.Slug, worldRoot.transform);
            worldOwned.Add(Ground.terrainData);
            if (layers != terrainLayers)
            {
                foreach (TerrainLayer layer in layers)
                {
                    worldOwned.Add(layer.diffuseTexture);
                    worldOwned.Add(layer);
                }
            }
            yield return null;

            Stands = StandField.Create(worldRoot.transform);
            yield return Stands.Fill(World, standMaterials, LoadBudgetMs);
            Images = StandImages.Create(worldRoot.transform);
            yield return Images.Fill(World, imageSurfaceMaterial, LoadBudgetMs);
            Images.Source = ImageSource;
            Images.Viewer = Avatar.transform;
            Exhibit.SetImages(Images.Array);
            CardView.Bind(World, Images, ImageSource);

            // The ambient bed and the river (PRD v4 5.12). The river's source follows the listener
            // along the water, at the water's level.
            Sound = WorldSound.Create(worldRoot.transform, ambientBed, riverLoop,
                new Vector3(plan.RiverFrom.x, GroundPlan.WaterLevel, plan.RiverFrom.y), new Vector3(plan.RiverTo.x, GroundPlan.WaterLevel, plan.RiverTo.y), Camera.main.transform);

            // The return portal, 8 m south of the centre and facing it (PRD v4 5.4.5).
            ReturnPortal = Portal.Build("Return portal", portalFrameMaterial, portalSurfaceMaterial, worldRoot.transform,
                new Vector3(0, 0, -ReturnPortalSouth), Quaternion.identity);
            yield return null;
            for (double waited = Now; Now - waited < LoadDelayForTests;)
            {
                yield return null;
            }
            WorldLoaded = true;
            loading = null;
        }

        void Unload()
        {
            if (loading != null)
            {
                StopCoroutine(loading);
                loading = null;
            }
            CardView.Bind(null, null, null);
            Hud.HideTravel();
            Hud.Hover(null, default);
            HoveredStand = -1;
            RecentlyVisited.Clear();
            if (worldRoot != null)
            {
                Destroy(worldRoot);
            }
            foreach (UnityEngine.Object owned in worldOwned)
            {
                Destroy(owned);
            }
            worldOwned.Clear();
            World = null;
            Stands = null;
            Images = null;
            Sound = null;
            Ground = null;
            ReturnPortal = null;
            WorldLoaded = false;
        }

        // The portal transition (PRD v4 5.9.1, 5.9.2): the visitor's input is locked, the avatar
        // walks on into the ring, the surface fills the view, and the cut waits for the destination.
        IEnumerator Through(Portal portal, Place destination)
        {
            InTransition = true;
            double entered = Now;
            Avatar.Locked = true;
            // The automatic walk goes on through the ring. A return by Esc starts anywhere, and stays there.
            Vector3 through = Vector3.Dot(portal.transform.forward, Avatar.transform.position - portal.transform.position) > 0 ? -portal.transform.forward : portal.transform.forward;
            bool atPortal = Vector3.Distance(Avatar.transform.position, portal.transform.position) < 2 * Portal.PadDistance;
            Avatar.Walk = atPortal ? through * AvatarController.WalkSpeed : Vector3.zero;
            if (destination == Place.World && loading == null && !WorldLoaded)
            {
                loading = StartCoroutine(Load(HomeWorld));
            }

            float fade = ReducedMotion ? ReducedFadeSeconds : TransitionSeconds;
            for (double began = Now; Now - began < fade;)
            {
                Veil(Mathf.Clamp01((float)((Now - began) / fade)));
                yield return null;
            }
            Veil(1);
            Avatar.Walk = Vector3.zero;

            // The hold: the surface stays, input stays locked, and after the ceiling an indicator
            // shows. The transition never cuts to a world that is not ready.
            double held = Now;
            while (destination == Place.World && !WorldLoaded && Failure == null)
            {
                Holding = true;
                HoldIndicator = Now - held > HoldIndicatorAfter;
                yield return null;
            }
            Holding = HoldIndicator = false;
            LastHoldSeconds = Now - held;

            if (Failure == null)
            {
                if (destination == Place.World)
                {
                    // The arrival point, facing north (PRD v4 5.4.5).
                    Avatar.Place(lastDry = StandField.Ground(World.Layout.Arrival), Quaternion.identity);
                    Avatar.Keep = KeepInWorld;
                }
                else
                {
                    // Back on the pad of the portal the visitor left by, facing the hub's centre.
                    Avatar.Place(HubPortal.Pad, HubPortal.transform.rotation);
                    Avatar.Keep = KeepInHub;
                    Unload();
                }
                Place = destination;
                View.Behind();
                yield return null;      // one frame at the destination behind the veil
            }
            LastTravelSeconds = Now - entered;

            for (double began = Now; Now - began < ArrivalFadeSeconds;)
            {
                Veil(1 - Mathf.Clamp01((float)((Now - began) / ArrivalFadeSeconds)));
                yield return null;
            }
            Veil(0);
            Avatar.Locked = false;
            InTransition = false;
        }

        void OnGUI()
        {
            // The loading indicator of PRD v4 5.9.2, as plain text until the overlays exist.
            if (HoldIndicator)
            {
                GUI.Label(new Rect(Screen.width / 2f - 100, Screen.height / 2f, 200, 30), "Loading…");
            }
        }
    }
}
