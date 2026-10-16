using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
    // The hub stands 4 km to the east of the world's centre, out of sight of it, so a world is built
    // in place, whole, while the visitor is still in the hub, and the cut of a portal is a move of
    // the avatar.
    public sealed class App : MonoBehaviour
    {
        public const string HomeWorld = "dominaria";
        public const float TransitionSeconds = 1.5f, ReducedFadeSeconds = 0.3f, ArrivalFadeSeconds = 0.25f;   // PRD v4 5.9.1, 5.9.5
        public const float HoldIndicatorAfter = 6;                  // PRD v4 5.9.2, 7.2
        public const float PreloadDistance = 10;                    // PRD v4 5.3.3
        public const float PortalRingRadius = 56, HubRadius = 64;   // PRD v4 5.3.2
        public const float ReturnPortalSouth = 8;                   // PRD v4 5.4.5
        public const float LoadBudgetMs = 4;
        static readonly Vector3 HubOrigin = new Vector3(4000, 0, 0);
        static bool warmed;

        // Assigned by the generation entry point. The stand materials are the four plinths by
        // rarity, then the slab. The terrain layers are the kit's meadow, path and gravel, or empty.
        // The props are the kit's kinds, in their order. The variants are the kit's, in the order of
        // `Variants.Temperate`; nothing draws them yet (PRD v4 9.6, leg 2).
        [SerializeField] Material[] standMaterials = new Material[0];
        [SerializeField] Material avatarMaterial, hubGroundMaterial, portalFrameMaterial, portalSurfaceMaterial, veilMaterial;
        [SerializeField] TerrainLayer[] terrainLayers = new TerrainLayer[0];
        // The ground's material, and with it the variants of the terrain shader a build must hold.
        [SerializeField] Material[] groundMaterials = new Material[0];
        [SerializeField] Material imageSurfaceMaterial;
        [SerializeField] Shader exhibitShader, exhibitCompositeShader;
        [SerializeField] AudioClip ambientBed, riverLoop;
        [SerializeField] PanelSettings panelSettings;
        [SerializeField] GameObject riverPrefab, lakePrefab;
        [SerializeField] KitProp[] props = new KitProp[0];
        [SerializeField] KitVariant[] variants = new KitVariant[0];
        // The greybox's materials (PRD v4 9.6, leg 1), in the order of `Greybox`'s constants: the
        // ground, the paths, the pads, the region lines and the stones. The kit's terrain layers,
        // ground materials, props, variants, water and sound above are leg 2's dressing, which the
        // greybox does not draw.
        [SerializeField] Material[] greyboxMaterials = new Material[0];

        public static App Instance { get; private set; }

        public Light Sun { get; private set; }
        Quaternion hubSun;
        float hubSunKelvin;

        public Material[] StandMaterials { get => standMaterials; set => standMaterials = value; }
        public Material AvatarMaterial { get => avatarMaterial; set => avatarMaterial = value; }
        public Material HubGroundMaterial { get => hubGroundMaterial; set => hubGroundMaterial = value; }
        public Material PortalFrameMaterial { get => portalFrameMaterial; set => portalFrameMaterial = value; }
        public Material PortalSurfaceMaterial { get => portalSurfaceMaterial; set => portalSurfaceMaterial = value; }
        public Material VeilMaterial { get => veilMaterial; set => veilMaterial = value; }
        public TerrainLayer[] TerrainLayers { get => terrainLayers; set => terrainLayers = value; }
        public Material[] GroundMaterials { get => groundMaterials; set => groundMaterials = value; }
        public Material ImageSurfaceMaterial { get => imageSurfaceMaterial; set => imageSurfaceMaterial = value; }
        public Shader ExhibitShader { get => exhibitShader; set => exhibitShader = value; }
        public Shader ExhibitCompositeShader { get => exhibitCompositeShader; set => exhibitCompositeShader = value; }
        public AudioClip AmbientBed { get => ambientBed; set => ambientBed = value; }
        public AudioClip RiverLoop { get => riverLoop; set => riverLoop = value; }
        public PanelSettings PanelSettings { get => panelSettings; set => panelSettings = value; }
        public GameObject RiverPrefab { get => riverPrefab; set => riverPrefab = value; }
        public GameObject LakePrefab { get => lakePrefab; set => lakePrefab = value; }
        public KitProp[] KitProps { get => props; set => props = value; }
        public KitVariant[] KitVariants { get => variants; set => variants = value; }
        public Material[] GreyboxMaterials { get => greyboxMaterials; set => greyboxMaterials = value; }

        public Pack Pack { get; private set; }
        public AvatarController Avatar { get; private set; }
        public FollowCamera View { get; private set; }
        public Portal HubPortal { get; private set; }
        public Portal ReturnPortal { get; private set; }
        public WorldData World { get; private set; }
        // `stands.bin`, read once at launch with the assertions of 4.13.3 at launch (PRD v4 8.3.2).
        // World entry uses these records; the app disposes them when it ends.
        public StandsFile Records { get; private set; }
        public StandField Stands { get; private set; }
        public StandImages Images { get; private set; }
        public Exhibit Exhibit { get; private set; }
        public Greybox Greybox { get; private set; }
        // Leg 2's dressing: null in the greybox, which has no props, no sound and no water.
        public PropField Props { get; private set; }
        public PropPlan PropPlan { get; private set; }
        public WorldSound Sound { get; private set; }
        public GameObject Water { get; private set; }
        public Hud Hud { get; private set; }
        public CardViewer CardView { get; private set; }
        public int HoveredStand { get; private set; } = -1;
        public readonly List<int> RecentlyVisited = new List<int>();     // the last 50 stands entered in card view (PRD v4 6.6.4)
        public const float InteractDistance = 3;                         // PRD v4 5.5.3
        public const float TravelPortalDistance = 2, TravelWalkSeconds = 1;  // PRD v4 5.9.4
        public IImageSource ImageSource;    // where stand images come from; set before a world loads
        // Tests name a source of their own here, so that no test run reaches Scryfall.
        public static Func<IImageSource> ImageSourceForTests;
        // The greybox's flat ground, with its paths, pads and region lines.
        public Renderer Ground { get; private set; }

        public Place Place { get; private set; }
        public bool HubReady { get; private set; }
        public bool WorldLoaded { get; private set; }       // built and ready to be walked into
        public bool WorldReady => WorldLoaded && Place == Place.World && !InTransition;
        public bool InTransition { get; private set; }
        public bool Holding { get; private set; }           // a portal is waiting for its world (PRD v4 5.9.2)
        public string LoadStage { get; private set; }       // what a load is making, for whoever times a frame; null when none runs
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
        Task<WorldData> reading;        // a world's read on its thread, which uses `Records`
        Renderer veil;
        readonly List<UnityEngine.Object> worldOwned = new List<UnityEngine.Object>();
        Texture2DArray standImages;     // every world's stand images, made once with the hub (`StandImages.NewArray`)

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

        // The level a player starts at: the one `-quality high|medium|low` names, else the one a
        // bench run asks for with `-benchQuality`, else the project's default, which is the first
        // (PRD v4 8.1.1: high). PRD v4 8.1.1 has a settings screen choose the level and the slice
        // has none, so `-quality` is how the owner walks at the level the acceptance matrix settles
        // on (DEC-953).
        public static int StartLevel(string[] arguments, string[] names)
        {
            foreach (string argument in new[] { "-quality", "-benchQuality" })
            {
                for (int i = 0; i + 1 < arguments.Length; i++)
                {
                    int level = arguments[i] == argument ? Array.IndexOf(names, arguments[i + 1]) : -1;
                    if (level >= 0)
                    {
                        return level;
                    }
                }
            }
            return 0;
        }

        // The engine keeps the level a player last ran at in the player's preferences and starts the
        // next run there. So a double-click started at whatever level the last bench run on the
        // machine had used, and a bench run at another level began at the remembered one, built the
        // hub there and then changed: its process held two levels' buffers, and its memory figures
        // were a run's and a half. A player's level is set here, before the pipeline draws its first
        // frame, and never taken from the last run. The editor's level is the project's.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSplashScreen)]
        static void StartAtItsLevel()
        {
            if (Application.isEditor)
            {
                return;
            }
            int level = StartLevel(Environment.GetCommandLineArgs(), QualitySettings.names);
            if (QualitySettings.GetQualityLevel() != level)
            {
                QualitySettings.SetQualityLevel(level, applyExpensiveChanges: true);
            }
        }

        void Awake()
        {
            Instance = this;
        }

        void Start()
        {
            // The overlays come first: they are where a failure to start is said.
            Hud = Hud.Create(panelSettings, transform);
            try
            {
                string directory = PackDirectory();
                Pack = new Pack(directory);
                // PRD v4 4.13.3, 8.3.2: `stands.bin` is read once, here, and its records pass the
                // assertions at launch before the hub is built. A file that fails one fails loudly
                // (7.4.1), and the visitor sees no hub.
                StandsFile records = StandsFile.Read(File.ReadAllBytes(WorldFiles.StandsPath(directory)));
                try
                {
                    WorldData.AssertAtLaunch(records, Pack.Planes.Length);
                }
                catch
                {
                    records.Dispose();
                    throw;
                }
                Records = records;
                // The image cache lives under the application-support directory (PRD v4 4.15.3, 7.4.4).
                ImageSource = ImageSourceForTests != null ? ImageSourceForTests() : ScryfallImages.Create(Path.Combine(Application.persistentDataPath, "images"), transform);
                BuildHub();
            }
            catch (Exception e)
            {
                Fail(e);
            }
        }

        // PRD v4 7.4.1: a pack file that does not read fails loudly, with a message that can be
        // read where the visitor is looking, and in the log.
        void Fail(Exception e)
        {
            Failure = e.Message;
            Debug.LogException(e);
            Hud.Say($"Eternities has stopped. {Failure}");
        }

        void OnDestroy()
        {
            if (Instance == this)
            {
                Instance = null;
            }
            Destroy(standImages);
            // The launch's records, once, when the app ends. A world still being read on its thread
            // reads them, so that read ends first.
            ((IAsyncResult)reading)?.AsyncWaitHandle.WaitOne();
            Records?.Dispose();
            Records = null;
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

            standImages = StandImages.NewArray();
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

            // The scene's sun is the hub's as it stands. A world sets it to its own (PRD v4 5.7.1).
            foreach (Light light in FindObjectsByType<Light>())
            {
                if (light.type == LightType.Directional)
                {
                    Sun = light;
                    hubSun = light.transform.rotation;
                    hubSunKelvin = light.colorTemperature;
                }
            }

            Place = Place.Hub;
            HubReady = true;
        }

        // The sun of the place the visitor is in: the world's own row, or the scene's for the hub.
        void Sunlight(Place place)
        {
            if (Sun == null)
            {
                return;
            }
            Sun.useColorTemperature = true;
            Sun.transform.rotation = place == Place.World ? Temperate.Sun(Temperate.SunElevation, Temperate.SunAzimuth) : hubSun;
            Sun.colorTemperature = place == Place.World ? Temperate.SunKelvin : hubSunKelvin;
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
        // stops at the world's radius R, the edge of its 72-gon's circle (4.13.5).
        Vector3 KeepInWorld(Vector3 position)
        {
            float limit = World.Layout.Radius / 1000f;
            var flat = new Vector3(position.x, 0, position.z);
            return flat.magnitude > limit ? flat.normalized * limit + Vector3.up * position.y : position;
        }

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
            // Did the avatar's step use the ring of the place it is in? A world reads this before
            // card view and the travel menu take the frame: they use the frame's input, and the
            // avatar takes its step all the same. A step that used the ring closes whatever is open
            // (DEC-1033).
            bool crossed = (Place == Place.Hub ? HubPortal : ReturnPortal).Crossed(Avatar.StepFrom, at);
            if (Place == Place.World && crossed)
            {
                CardView.Leave();
                Hud.HideTravel();
            }
            else if (Place == Place.World && Explore(at))
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
                if (crossed || (Avatar.Input.Interact && Vector3.Distance(at, HubPortal.Pad) < 3))
                {
                    StartCoroutine(Through(HubPortal, Place.World, crossed));
                }
            }
            else if (crossed || Avatar.Input.Back)
            {
                // PRD v4 5.3.5: Esc from any world returns to the hub through the return portal.
                StartCoroutine(Through(ReturnPortal, Place.Hub, crossed));
            }
        }

        // Explore, card view and the travel menu (PRD v4 6.2). True when the frame's input was used.
        bool Explore(Vector3 at)
        {
            AvatarInput input = Avatar.Input;
            CardView.ReducedMotion = ReducedMotion;
            View.ReducedMotion = ReducedMotion;
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
                else if (input.Step != 0)
                {
                    // The keyboard's way through the printings: [ and ], or Page Up and Page Down.
                    CardView.Show(Mathf.Clamp(CardView.Printing + input.Step, 0, CardView.Card.Printings.Length - 1));
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

            // The stand within reach shows its label, and interacting with it enters card view:
            // E, a face button, or a click on the stand (PRD v4 6.1.3).
            HoveredStand = Images != null ? Images.Nearest(at, InteractDistance) : -1;
            if (HoveredStand >= 0)
            {
                Vector3 top = StandField.Ground(World.Position(HoveredStand)) + Vector3.up * StandField.SlabTop;
                Camera view = Camera.main;
                Vector3 screen = view.WorldToScreenPoint(top);
                if (labelled != HoveredStand)
                {
                    // Made once a stand, not once a frame (PRD v4 7.3.2).
                    label = CardViewer.Label(World, labelled = HoveredStand);
                }
                Hud.Hover(screen.z > 0 ? label : null, new Vector2(screen.x, view.pixelHeight - screen.y));
                if (input.Interact || (input.Click && Over(World, HoveredStand, view, input.Pointer)))
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

        int labelled = -1;
        string label;

        // Is a point of the view on a stand, its plinth or its slab, as the camera sees it?
        static bool Over(WorldData world, int stand, Camera view, Vector2 pointer)
        {
            Vector3 foot = StandField.Ground(world.Position(stand));
            Quaternion facing = StandField.Facing(world, stand);
            Vector2 low = new Vector2(float.MaxValue, float.MaxValue), high = -low;
            for (int corner = 0; corner < 8; corner++)
            {
                var local = new Vector3(((corner & 1) == 0 ? -1 : 1) * LayoutConstants.FootprintWidth / 2000f, (corner & 2) == 0 ? 0 : StandField.SlabTop,
                    ((corner & 4) == 0 ? -1 : 1) * LayoutConstants.FootprintDepth / 2000f);
                Vector3 seen = view.WorldToScreenPoint(foot + facing * local);
                if (seen.z <= 0)
                {
                    return false;
                }
                low = Vector2.Min(low, seen);
                high = Vector2.Max(high, seen);
            }
            return pointer.x >= low.x && pointer.x <= high.x && pointer.y >= low.y && pointer.y <= high.y;
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

        // The slice's travel menu: this world's sites in site order, and the cards of the one chosen.
        void OpenTravel()
        {
            var sites = new List<string>();
            foreach (WorldSite site in World.Layout.Sites)
            {
                sites.Add($"{SiteName(World, site)} · {site.Clusters.Sum(cluster => cluster.Stands)}");
            }
            Hud.Hover(null, default);
            Hud.ShowTravel(World.Plane.DisplayName, sites, site => StandsOf(site).ConvertAll(stand => World.CardAt(stand).Name),
                (site, card) => TravelTo(StandsOf(site)[card]), Hud.HideTravel);
        }

        // A site's name in the travel menu: an era's name and years, a region's name, or a set's name
        // and year (4.13.5, 4.16.3).
        public static string SiteName(WorldData world, WorldSite site)
        {
            if (site.Kind == "era" && world.Lore != null)
            {
                LoreEra era = Array.Find(world.Lore.Eras, row => row.Id == site.EraId);
                return era == null ? site.Key : $"{era.Name}, {era.Years}";
            }
            if (site.Kind == "region" && world.Lore != null)
            {
                LoreRegion region = Array.Find(world.Lore.Regions, row => row.Id == site.RegionId);
                return region == null ? site.Key : region.Name;
            }
            return site.SetIds.Length == 1 && world.Sets.TryGetValue(site.SetIds[0], out PackSet set) ? $"{set.Name}, {set.Year}" : site.Key;
        }

        // A site's stands, by the name of their card.
        public List<int> StandsOf(int site)
        {
            var stands = new List<int>();
            for (int stand = 0; stand < World.StandCount; stand++)
            {
                if (World.Site(stand) == site)
                {
                    stands.Add(stand);
                }
            }
            stands.Sort((a, b) => string.CompareOrdinal(World.CardAt(a).Name, World.CardAt(b).Name));
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

            Quaternion facing = StandField.Facing(World, stand);
            Vector3 apron = StandField.Ground(World.Position(stand)) + facing * Vector3.forward * ((LayoutConstants.FootprintDepth / 2 + LayoutConstants.ApronDepth / 2) / 1000f);
            Avatar.Place(apron, facing * Quaternion.Euler(0, 180, 0));
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

        // A world, built whole while the visitor is elsewhere: the pack's shards and the world's
        // files are read and decoded on another thread, and the main thread builds the greybox
        // (PRD v4 9.6, leg 1) in slices.
        IEnumerator Load(string slug)
        {
            LoadStage = "reading";
            string directory = PackDirectory();
            // World entry reads the records of the launch, not the file again (PRD v4 8.3.2).
            StandsFile records = Records;
            Task<WorldData> read = reading = Task.Run(() => WorldData.Load(directory, slug, records));
            while (!read.IsCompleted)
            {
                yield return null;
            }
            if (read.IsFaulted)
            {
                Fail(read.Exception.GetBaseException());
                yield break;
            }
            World = read.Result;
            worldRoot = new GameObject(World.Plane.DisplayName);
            yield return null;

            LoadStage = "ground and paths";
            if (greyboxMaterials.Length != Greybox.Materials)
            {
                Fail(new InvalidOperationException("the greybox has no materials; run the generation entry point (unity/Eternities/README.md)"));
                yield break;
            }
            Greybox = Greybox.Create(worldRoot.transform);
            yield return Greybox.Fill(World, greyboxMaterials, LoadBudgetMs);
            Ground = Greybox.Ground;
            yield return null;

            LoadStage = "stands";
            Stands = StandField.Create(worldRoot.transform);
            yield return Stands.Fill(World, standMaterials, LoadBudgetMs);
            LoadStage = "image surfaces";
            Images = StandImages.Create(worldRoot.transform);
            yield return Images.Fill(World, imageSurfaceMaterial, standImages, LoadBudgetMs);
            Images.Source = ImageSource;
            Images.Viewer = Avatar.transform;
            Exhibit.SetImages(Images.Array);
            CardView.Bind(World, Images, ImageSource);

            // The return portal, at the pose the world names: 8 m south of the centre, facing it
            // (PRD v4 5.4.5, 4.13.5).
            LoadStage = "the return portal";
            ReturnPortal = Portal.Build("Return portal", portalFrameMaterial, portalSurfaceMaterial, worldRoot.transform,
                StandField.Ground(World.Layout.ReturnPortal.Position), StandField.Facing(World.Layout.ReturnPortal.Yaw));
            yield return null;
            for (double waited = Now; Now - waited < LoadDelayForTests;)
            {
                yield return null;
            }
            WorldLoaded = true;
            loading = null;
            LoadStage = null;
        }

        void Unload()
        {
            if (loading != null)
            {
                StopCoroutine(loading);
                loading = null;
            }
            LoadStage = null;
            CardView.Bind(null, null, null);
            Hud.HideTravel();
            Hud.Hover(null, default);
            HoveredStand = labelled = -1;
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
            World?.Dispose();
            World = null;
            Greybox = null;
            Stands = null;
            Images = null;
            Ground = null;
            ReturnPortal = null;
            WorldLoaded = false;
        }

        // The portal transition (PRD v4 5.9.1, 5.9.2): the visitor's input is locked, the avatar
        // walks on into the ring, the surface fills the view, and the cut waits for the destination.
        // `crossed` is whether a step used the ring; E on the pad and Esc use it without one.
        IEnumerator Through(Portal portal, Place destination, bool crossed)
        {
            InTransition = true;
            double entered = Now;
            Avatar.Locked = true;
            // The automatic walk goes on through the ring. After a step that used the ring it goes
            // away from the side the step began on: a long step has crossed the ring already. After
            // E or Esc it goes away from the side the avatar is on, whatever its last step crossed
            // (DEC-1033). A return by Esc starts anywhere, and stays there.
            Vector3 side = crossed ? Avatar.StepFrom : Avatar.transform.position;
            Vector3 through = Vector3.Dot(portal.transform.forward, side - portal.transform.position) > 0 ? -portal.transform.forward : portal.transform.forward;
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
                if (!HoldIndicator && Now - held > HoldIndicatorAfter)
                {
                    HoldIndicator = true;
                    Hud.Say("Loading…");
                }
                yield return null;
            }
            // The first time, what card view and the overlays will need is made ready here, behind
            // the surface: the first use of depth of field and of each size of text otherwise stops
            // a frame for most of a second, in the middle of the world.
            if (destination == Place.World && Failure == null && !warmed)
            {
                warmed = true;
                CardView.Warm(true);
                Hud.Warm(true);
                for (int frame = 0; frame < 4; frame++)
                {
                    yield return null;
                }
                CardView.Warm(false);
                Hud.Warm(false);
            }
            if (HoldIndicator && Failure == null)
            {
                Hud.Say(null);
            }
            Holding = HoldIndicator = false;
            LastHoldSeconds = Now - held;

            if (Failure == null)
            {
                if (destination == Place.World)
                {
                    // The arrival point, facing north (PRD v4 5.4.5): the pose the world names.
                    Avatar.Place(StandField.Ground(World.Layout.Arrival.Position), StandField.Facing(World.Layout.Arrival.Yaw));
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
                Sunlight(destination);
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
    }
}
