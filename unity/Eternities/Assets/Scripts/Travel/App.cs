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
    // the avatar. The world's sky and water reach past its ground, to the hub: they show only while
    // the visitor is in the world (`Sunlight`).
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
        // rarity, then the slab. A kit's layers, props, water and loops are not here: each kit's
        // are an asset under its `Resources/` that a world loads when it is entered (`KitDressing`),
        // so the hub holds none of them (DEC-1055, N20).
        [SerializeField] Material[] standMaterials = new Material[0];
        // The plinths' rims, one a colour class in the order of `StandField.ClassColours` (PRD v4 5.5.1).
        [SerializeField] Material[] rimMaterials = new Material[0];
        [SerializeField] Material avatarMaterial, hubGroundMaterial, portalFrameMaterial, portalSurfaceMaterial, veilMaterial;
        // The ground's materials, and with them the variants of the terrain shader a build must
        // hold: by `GroundMaterial`'s constants.
        [SerializeField] Material[] groundMaterials = new Material[0];
        [SerializeField] Material imageSurfaceMaterial;
        [SerializeField] Shader exhibitShader, exhibitCompositeShader;
        [SerializeField] PanelSettings panelSettings;

        // The ground's materials: for a tile of up to four layers, and of more (`WorldGround`).
        public const int FourLayerGround = 2, EightLayerGround = 3, GroundMaterialCount = 4;

        public static App Instance { get; private set; }

        public Light Sun { get; private set; }
        Quaternion hubSun;
        float hubSunKelvin;

        public Material[] StandMaterials { get => standMaterials; set => standMaterials = value; }
        public Material[] RimMaterials { get => rimMaterials; set => rimMaterials = value; }
        public Material AvatarMaterial { get => avatarMaterial; set => avatarMaterial = value; }
        public Material HubGroundMaterial { get => hubGroundMaterial; set => hubGroundMaterial = value; }
        public Material PortalFrameMaterial { get => portalFrameMaterial; set => portalFrameMaterial = value; }
        public Material PortalSurfaceMaterial { get => portalSurfaceMaterial; set => portalSurfaceMaterial = value; }
        public Material VeilMaterial { get => veilMaterial; set => veilMaterial = value; }
        public Material[] GroundMaterials { get => groundMaterials; set => groundMaterials = value; }
        public Material ImageSurfaceMaterial { get => imageSurfaceMaterial; set => imageSurfaceMaterial = value; }
        public Shader ExhibitShader { get => exhibitShader; set => exhibitShader = value; }
        public Shader ExhibitCompositeShader { get => exhibitCompositeShader; set => exhibitCompositeShader = value; }
        public PanelSettings PanelSettings { get => panelSettings; set => panelSettings = value; }

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
        // The world's stones (PRD v4 5.4.16, 5.13.1), the kit's.
        public StoneField Stones { get; private set; }
        // The world's dressing (PRD v4 5.6.3, 8.4.2): its plan, its props, its sound, its water and its sky.
        public DressPlan Dress { get; private set; }
        public Scatter Scatter { get; private set; }
        public PropField Props { get; private set; }
        public WorldSound Sound { get; private set; }
        public GameObject Water { get; private set; }
        public WorldSky Sky { get; private set; }
        public Terrain[] Tiles { get; private set; }
        // The kits' dressings the world loaded, by kit.
        public readonly Dictionary<string, KitDressing> Kits = new Dictionary<string, KitDressing>();
        public Hud Hud { get; private set; }
        // The map of the world that is loaded (PRD v4 6.3.4), made with it.
        public MapModel Map { get; private set; }
        // The region and the site the HUD's line names now (PRD v4 6.3.1), or -1.
        public int ShownRegion { get; private set; } = -1;
        public int ShownSite { get; private set; } = -1;
        public CardViewer CardView { get; private set; }
        public int HoveredStand { get; private set; } = -1;
        public int HoveredStone { get; private set; } = -1;     // in `Stones.All`
        // From the frame that reads E at a reading stone to the frame its overlay's text is laid
        // out in, and drawn (PRD v4 5.13.1, 7.2); negative before the first.
        public double LastStoneTextSeconds { get; private set; } = -1;
        public readonly List<int> RecentlyVisited = new List<int>();     // the last 50 stands entered in card view (PRD v4 6.6.4)
        public const float InteractDistance = 3;                         // PRD v4 5.5.3
        public const float TravelPortalDistance = 2, TravelWalkSeconds = 1;  // PRD v4 5.9.4
        public IImageSource ImageSource;    // where stand images come from; set before a world loads
        // Tests name a source of their own here, so that no test run reaches Scryfall.
        public static Func<IImageSource> ImageSourceForTests;
        // The ground's switch: the terrain's tiles follow its `enabled` (`GroundSwitch`).
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
        Task reading;                   // a world's read on its thread, which uses `Records`
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
            hubFarClip = view.farClipPlane;
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
            Hud.Place(HubName);
            HubReady = true;
        }

        public const string HubName = "The Hub";      // the HUD's line in the hub (PRD v4 6.3.1)

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
            if (Sky != null)
            {
                Sky.Shown = place == Place.World;
            }
            if (Water != null)
            {
                WorldWater.Show(Water, place == Place.World);
            }
            // In a world the view reaches across it and over the sea; in the hub, as the scene has it.
            View.FarClip = place == Place.World && Sky != null ? WorldSky.FarClip : hubFarClip;
        }

        float hubFarClip = 1000;

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

        // The avatar stops at the world's radius R, the edge of its 72-gon's circle (4.13.5), where
        // the kit makes the edge natural (PRD v4 5.1.5): hills, a wood or the sea past it. And it
        // wades no deeper than `WadeDepth`, which a ford is not, and never into lava: a step that
        // would is not taken.
        public const float WadeDepth = 0.35f;

        Vector3 KeepInWorld(Vector3 position)
        {
            if (Dress != null && (Dress.DepthAt(position.x, position.z) > WadeDepth || Dress.LavaAt(position.x, position.z)))
            {
                return new Vector3(Avatar.StepFrom.x, position.y, Avatar.StepFrom.z);
            }
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
            if (Place == Place.World && World != null)
            {
                FollowWalker(at);
            }
            // Did the avatar's step use the ring of the place it is in? A world reads this before
            // card view and the travel menu take the frame: they use the frame's input, and the
            // avatar takes its step all the same. A step that used the ring closes whatever is open
            // (DEC-1033).
            bool crossed = (Place == Place.Hub ? HubPortal : ReturnPortal).Crossed(Avatar.StepFrom, at);
            if (Place == Place.World && crossed)
            {
                CardView.Leave();
                Hud.HideTravel();
                Hud.HideStone();
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
            // Only the hover label, when it shows below, keeps the stands' images off its pixels.
            Exhibit.Spared = Rect.zero;
            CardView.ReducedMotion = ReducedMotion;
            View.ReducedMotion = ReducedMotion;
            if (Sky != null)
            {
                Sky.Still = ReducedMotion;
            }
            if (lavaFlow != null)
            {
                lavaFlow.Still = ReducedMotion;
            }
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
            if (Hud.StoneOpen)
            {
                // Esc, the back control or walking input closes a stone's overlay (PRD v4 5.13.1).
                if (input.Back || input.Move != Vector2.zero || input.WorldMove != Vector3.zero)
                {
                    Hud.HideStone();
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
            if (Hud.MapOpen)
            {
                if (input.Back || input.Map)
                {
                    Hud.HideMap();
                }
                else
                {
                    Hud.Map.Walker(new Vector2(at.x, at.z), Avatar.transform.eulerAngles.y);
                }
                return true;
            }
            if (input.TravelMenu)
            {
                OpenTravelMenu();
                return true;
            }
            if (input.Map && Map != null)
            {
                Hud.Hover(null, default);
                Hud.ShowMap(Map, TravelToSite);
                Hud.Map.Walker(new Vector2(at.x, at.z), Avatar.transform.eulerAngles.y);
                return true;
            }

            // The thing within reach shows its label, and E or a click uses it (PRD v4 6.1.3): the
            // nearer of the stand and the stone within 3 m, the stand on a tie. A stand enters card
            // view; a reading stone opens its overlay and a waystone its travel; a chapter stone
            // and a marker stone are named and offer nothing.
            int stand = Images != null ? Images.Nearest(at, InteractDistance) : -1;
            float standSquared = stand >= 0 ? Squared(StandField.Ground(World.Position(stand)), at) : float.MaxValue;
            float stoneSquared = float.MaxValue;
            int stone = Stones != null ? Stones.Nearest(at, InteractDistance, out stoneSquared) : -1;
            bool onStone = StoneField.StoneWins(stand, standSquared, stone, stoneSquared);
            HoveredStand = onStone ? -1 : stand;
            HoveredStone = onStone ? stone : -1;
            if (HoveredStand >= 0)
            {
                Vector3 top = StandField.Ground(World.Position(HoveredStand)) + Vector3.up * StandField.SlabTop;
                if (labelled != HoveredStand)
                {
                    // Made once a stand, not once a frame (PRD v4 7.3.2).
                    label = CardViewer.Label(World, labelled = HoveredStand);
                }
                Camera view = Camera.main;
                Label(label, top, view);
                if (input.Interact || (input.Click && Over(World, HoveredStand, view, input.Pointer)))
                {
                    CardView.Enter(HoveredStand);
                    return true;
                }
                return false;
            }
            if (HoveredStone >= 0)
            {
                StoneField.Stone held = Stones.All[HoveredStone];
                Label(held.Label, held.Foot + Vector3.up * held.Height, Camera.main);
                if (input.Interact && StoneField.Usable(held.Kind))
                {
                    Use(HoveredStone);
                    return true;
                }
                return false;
            }
            Hud.Hover(null, default);
            return false;
        }

        static float Squared(Vector3 a, Vector3 b) => (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);

        // A hover label above a point of the world, or hidden when the point is behind the view.
        // The stands' images are laid over the finished frame, the label with it: they leave the
        // label's rectangle alone, so it reads in front of the stands behind it (DEC-1130 N10).
        void Label(string text, Vector3 above, Camera view)
        {
            Vector3 screen = view.WorldToScreenPoint(above);
            Vector2 anchor = new Vector2(screen.x, view.pixelHeight - screen.y);
            bool shown = screen.z > 0;
            Hud.Hover(shown ? text : null, anchor);
            Exhibit.Spared = shown ? Hud.HoverPixels(anchor, view.pixelWidth, view.pixelHeight, LabelMargin) : Rect.zero;
        }

        // A reading stone opens its overlay and a waystone its travel (PRD v4 5.13.1, 6.6.2), for a
        // walker in the region the HUD's line names. Public for a tool that pictures it.
        public void Use(int index)
        {
            StoneField.Stone held = Stones.All[index];
            double asked = Now;
            Hud.Hover(null, default);
            Exhibit.Spared = Rect.zero;
            var sheet = new StoneSheet();
            List<Choice> sets, headlines, travel;
            if (held.Kind == Reading.ReadingStone)
            {
                ReadingText text = Reading.Overlay(World, held.Site, ShownRegion);
                sheet.Name = text.Name;
                sheet.Years = text.Years;
                sheet.Place = text.Place;
                sheet.Paragraphs.AddRange(text.Paragraphs);
                sheet.Sources.AddRange(text.Sources);
                (sets, headlines, travel) = (text.Sets, text.Headlines, text.Travel);
            }
            else
            {
                WorldSite site = World.Layout.Sites[held.Site];
                (int first, int last, int count) = Reading.YearsOf(World, held.Site);
                sheet.Name = Whereabouts.SiteTitle(World, site);
                sheet.Years = count == 0 ? null : first == last ? $"{first} · {count:N0} cards" : $"{first}–{last} · {count:N0} cards";
                (sets, headlines, travel) = (new List<Choice>(), new List<Choice>(), Reading.StoneTravel(World, held.Site, ShownRegion));
            }
            sheet.Sets.AddRange(sets.Select(choice => (choice.Text, choice.Way != null)));
            sheet.Headlines.AddRange(headlines.Select(choice => (choice.Text, choice.Way != null)));
            sheet.Travel.AddRange(travel.Select(choice => choice.Text));
            void Go(List<Choice> list, int row)
            {
                if (list[row].Way is Way way)
                {
                    TravelBy(way);
                }
            }
            Hud.ShowStone(sheet, row => Go(sets, row), row => Go(headlines, row), row => Go(travel, row), Hud.HideStone);
            if (held.Kind == Reading.ReadingStone)
            {
                LastStoneTextSeconds = -1;
                VisualElement body = Hud.StoneBody;
                body.RegisterCallback<GeometryChangedEvent>(_ =>
                {
                    if (LastStoneTextSeconds < 0 && body.contentRect.height > 0)
                    {
                        LastStoneTextSeconds = Now - asked;
                    }
                });
            }
        }

        // Pixels about the hover label that the stands' images leave alone too.
        public const float LabelMargin = 1;

        int labelled = -1;
        string label;
        Whereabouts whereabouts;
        bool placeShown;        // the line names the world's place, not the hub

        // The HUD's line follows the walker across boundaries, and crossing into a region shows the
        // region's sentence (PRD v4 6.3.1, 5.13.7). The line is made only when the region or the
        // site changes, so a frame that changes neither allocates nothing.
        void FollowWalker(Vector3 at)
        {
            whereabouts ??= new Whereabouts(World.Layout);
            P2 here = Whereabouts.Millimetres(at.x, at.z);
            int region = whereabouts.Region(here), site = whereabouts.Site(here);
            if (placeShown && region == ShownRegion && site == ShownSite)
            {
                return;
            }
            placeShown = true;
            if (region != ShownRegion && region >= 0)
            {
                Hud.Sentence(Whereabouts.Sentence(World, region));
            }
            ShownRegion = region;
            ShownSite = site;
            Hud.Place(Whereabouts.Line(World, region, site));
        }

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

        // The travel menu (PRD v4 6.6.1): this world's sites in trail order, an era's chapters
        // under it, then its regions; and the cards of a site whose cards are asked for. Public
        // for a tool that pictures it.
        public void OpenTravelMenu()
        {
            var rows = new List<TravelRow>();
            var ways = new List<Way?>();
            void Section(string heading, List<Choice> choices)
            {
                if (choices.Count == 0)
                {
                    return;
                }
                rows.Add(new TravelRow { Text = heading, Heading = true });
                ways.Add(null);
                foreach (Choice choice in choices)
                {
                    rows.Add(new TravelRow { Text = choice.Text, Travels = choice.Way != null, Depth = choice.Depth, Site = choice.Site });
                    ways.Add(choice.Way);
                }
            }
            Section(World.Layout.Hero ? "Trail" : "Sets", Reading.TrailSection(World));
            Section("Regions", Reading.RegionSection(World));
            Hud.Hover(null, default);
            Hud.ShowTravel(World.Plane.DisplayName, rows, site => StandsOf(site).ConvertAll(stand => World.CardAt(stand).Name), row =>
            {
                if (ways[row] is Way way)
                {
                    TravelBy(way);
                }
            }, (site, card) => TravelTo(StandsOf(site)[card]), Hud.HideTravel);
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

        // Through the hub's portal at once, without the walk to it: for a tool that pictures a
        // world (`WorldPictures`).
        public void EnterWorld()
        {
            if (Place == Place.Hub && !InTransition && Failure == null && HubReady)
            {
                StartCoroutine(Through(HubPortal, Place.World, crossed: false));
            }
        }

        // Travel within the world (PRD v4 5.9.4): a portal opens 2 m in front of the avatar, facing
        // it; the avatar walks into it over a second, with no steering by the visitor, and arrives
        // on the stand's apron, facing the stand. The portal closes behind it.
        public void TravelTo(int stand)
        {
            if (Place == Place.World && !InTransition)
            {
                Hud.HideTravel();
                Quaternion facing = StandField.Facing(World, stand);
                Vector3 apron = StandField.Ground(World.Position(stand)) + facing * Vector3.forward * ((LayoutConstants.FootprintDepth / 2 + LayoutConstants.ApronDepth / 2) / 1000f);
                StartCoroutine(Travel(apron, facing * Quaternion.Euler(0, 180, 0)));
            }
        }

        // Travel to a site's pad, from the map, the travel menu or a stone (PRD v4 6.3.4, 6.6): the
        // same portal, arriving on the pad in the way the pad's pose faces.
        public void TravelToSite(int site)
        {
            if (Place == Place.World && !InTransition && site >= 0 && site < World.Layout.Sites.Length)
            {
                Eternities.Data.Pose pad = World.Layout.Sites[site].Pad;
                StartCoroutine(Travel(StandField.Ground(pad.Position), StandField.Facing(pad.Yaw)));
            }
        }

        // Wherever a choice of the travel menu, a stone or the reading overlay leads (PRD v4 6.6,
        // 5.13.1).
        public void TravelBy(Way way)
        {
            switch (way.Kind)
            {
                case Way.To.Stand:
                    TravelTo(way.Index);
                    break;
                case Way.To.Pad:
                    TravelToSite(way.Index);
                    break;
                case Way.To.Chapter:
                    TravelToChapter(way.Index, way.Chapter);
                    break;
                case Way.To.Plaza:
                    if (Place == Place.World && !InTransition)
                    {
                        StartCoroutine(Travel(StandField.Ground(World.Layout.Arrival.Position), StandField.Facing(World.Layout.Arrival.Yaw)));
                    }
                    break;
            }
        }

        // Travel to a chapter (PRD v4 6.6.1): to its stone, or its site's pad for a first chapter
        // (`StoneField.ChapterArrival`).
        public void TravelToChapter(int site, int chapter)
        {
            if (Place != Place.World || InTransition || site < 0 || site >= World.Layout.Sites.Length)
            {
                return;
            }
            Vector3 arrival = StoneField.ChapterArrival(World.Layout.Sites[site], chapter, out Quaternion heading);
            StartCoroutine(Travel(arrival, heading));
        }

        IEnumerator Travel(Vector3 arrival, Quaternion heading)
        {
            InTransition = true;
            Hud.HideTravel();
            Hud.HideMap();
            Hud.HideStone();
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

            Avatar.Place(arrival, heading);
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
        // files are read and decoded on another thread, where the world's dressing is planned too
        // (`DressPlan`), while the kits the world names load (`KitDressing`); then the main thread
        // builds the ground, the stands, the props, the water, the sound and the sky in slices.
        IEnumerator Load(string slug)
        {
            LoadStage = "reading";
            string directory = PackDirectory();
            // World entry reads the records of the launch, not the file again (PRD v4 8.3.2).
            StandsFile records = Records;
            Task<(WorldData World, DressPlan Plan, MapModel Map, Color32[] MapGround)> read = Task.Run(() =>
            {
                WorldData world = WorldData.Load(directory, slug, records);
                DressPlan plan = DressPlan.Compute(world);
                plan.ForTheBuild();
                MapModel map = MapOf(world);
                return (world, plan, map, Eternities.Kits.MapGround.Pixels(plan, map.Centre, map.HalfSide, MapGroundSide));
            });
            reading = read;
            yield return LoadKit("temperate");
            while (!read.IsCompleted)
            {
                yield return null;
            }
            if (read.IsFaulted)
            {
                Fail(read.Exception.GetBaseException());
                yield break;
            }
            Color32[] mapGround;
            (World, Dress, Map, mapGround) = read.Result;
            reading = null;     // the read is done: the field is for a read that still runs when the app ends (`OnDestroy`)
            worldRoot = new GameObject(World.Plane.DisplayName);
            // The map's ground, uploaded with no copy kept on the CPU.
            var ground = new Texture2D(MapGroundSide, MapGroundSide, TextureFormat.RGBA32, mipChain: false) { name = "map ground", wrapMode = TextureWrapMode.Clamp };
            ground.SetPixelData(mapGround, 0);
            ground.Apply(false, makeNoLongerReadable: true);
            worldOwned.Add(ground);
            Map.Ground = ground;

            // The kits of the world's ambient families and of its water (PRD v4 8.12.5).
            LoadStage = "kits";
            foreach (RegionDress region in Dress.Regions)
            {
                yield return LoadKit(KitLoops.KitOf(region.Ambient));
            }
            foreach (WaterBody body in Dress.Water)
            {
                yield return LoadKit(KitLoops.OfWater(body.Kind).Kit);
            }
            KitDressing temperate = Kits.TryGetValue("temperate", out KitDressing held) ? held : null;
            if (temperate == null || temperate.ReadingStone == null || temperate.Waystone == null || temperate.ChapterStone == null || temperate.Tablet == null || temperate.Inscription == null
                || groundMaterials.Length != GroundMaterialCount || rimMaterials.Length != StandField.Classes)
            {
                Fail(new InvalidOperationException("the world's kit or materials are missing; run the generation entry point (unity/Eternities/README.md)"));
                yield break;
            }

            // The props' places, on another thread, from each kind's shape read here.
            LoadStage = "props";
            KitProp PropOf(Scatter.Kind kind) => temperate.Variant(Variants.Temperate[kind.Variant].Name).Props[kind.Growth];
            Scatter.Kind[] kinds = Scatter.KindsOf(Variants.Temperate, (v, g) => temperate.Variant(Variants.Temperate[v].Name).Props[g].Shape());
            string level = QualitySettings.names[QualitySettings.GetQualityLevel()];
            var placed = new Scatter(Dress, kinds, Temperate.Density(level), Temperate.FarDensity(level));
            Task place = Task.Run(placed.PlaceAll);
            while (!place.IsCompleted)
            {
                yield return null;
            }
            if (place.IsFaulted)
            {
                Fail(place.Exception.GetBaseException());
                yield break;
            }
            Scatter = placed;

            LoadStage = "ground";
            if (!WorldGround.Drawable(groundMaterials[FourLayerGround]) || !WorldGround.Drawable(groundMaterials[EightLayerGround]))
            {
                Fail(new InvalidOperationException("the ground has no material this build can draw; run the generation entry point (unity/Eternities/README.md)"));
                yield break;
            }
            TerrainLayer LayerNamed(string name)
            {
                TerrainLayer layer = temperate.Layer(name);
                foreach (KitVariant variant in temperate.Variants)
                {
                    layer ??= Array.Find(variant.Layers, candidate => candidate != null && candidate.name == name);
                }
                return layer;
            }
            yield return WorldGround.Build(Dress, LayerNamed, groundMaterials[FourLayerGround], groundMaterials[EightLayerGround], World.Plane.Slug,
                worldRoot.transform, LoadBudgetMs, worldOwned, tiles => Tiles = tiles);
            Ground = GroundSwitch.Create(worldRoot.transform, Tiles);
            yield return null;

            LoadStage = "stands";
            Stands = StandField.Create(worldRoot.transform);
            yield return Stands.Fill(World, standMaterials, rimMaterials, LoadBudgetMs);
            LoadStage = "image surfaces";
            Images = StandImages.Create(worldRoot.transform);
            yield return Images.Fill(World, imageSurfaceMaterial, standImages, LoadBudgetMs);
            Images.Source = ImageSource;
            Images.Viewer = Avatar.transform;
            Exhibit.SetImages(Images.Array);
            CardView.Bind(World, Images, ImageSource);

            LoadStage = "stones";
            Stones = StoneField.Create(worldRoot.transform);
            yield return Stones.Fill(World, temperate, LoadBudgetMs);

            LoadStage = "props";
            Props = PropField.Create(worldRoot.transform);
            Props.Bind(Scatter, Array.ConvertAll(kinds, PropOf), Avatar.transform, Camera.main);
            yield return null;

            LoadStage = "water, sound, sky and the return portal";
            Kits.TryGetValue("volcanic", out KitDressing volcanic);
            Kits.TryGetValue("coast", out KitDressing coast);
            if (WorldWater.Supported)
            {
                Water = WorldWater.Build(Dress, temperate.River, temperate.Lake, coast != null ? coast.Sea : null, volcanic != null ? volcanic.Lava : null, worldRoot.transform, worldOwned);
                lavaFlow = Water.GetComponentInChildren<LavaFlow>();
            }
            Sound = BuildSound(Dress, Camera.main.transform);
            Sky = WorldSky.Create(worldRoot.transform, worldOwned);

            // The return portal, at the pose the world names: 8 m south of the centre, facing it
            // (PRD v4 5.4.5, 4.13.5).
            ReturnPortal = Portal.Build("Return portal", portalFrameMaterial, portalSurfaceMaterial, worldRoot.transform,
                StandField.Ground(World.Layout.ReturnPortal.Position), StandField.Facing(World.Layout.ReturnPortal.Yaw));
            yield return null;
            // The world is built: what only the build read goes (DEC-1005, the memory cut).
            Dress.ForTheWalk();
            for (double waited = Now; Now - waited < LoadDelayForTests;)
            {
                yield return null;
            }
            WorldLoaded = true;
            loading = null;
            LoadStage = null;
        }

        LavaFlow lavaFlow;

        public const int MapGroundSide = 512;       // texels across the map's picture of the ground

        // The map of a world (PRD v4 6.3.4), from the pack: its regions named at the middle of
        // their cells, the trail's legs every few metres, the sites in site order with their
        // outlines, stones, pads and chapter stones, the return portal and every stand in its
        // class colour. It shows the world's disc and a margin past its edge.
        public static MapModel MapOf(WorldData world)
        {
            WorldDocument layout = world.Layout;
            var map = new MapModel { Centre = Vector2.zero, HalfSide = layout.Radius / 1000f + MapMargin };
            static Vector2 At(P2 point) => new Vector2(point.X / 1000f, point.Z / 1000f);
            foreach (WorldRegion region in layout.Regions)
            {
                Vector2[] outline = Array.ConvertAll(region.Cell, At);
                map.Regions.Add(new MapModel.Area { Name = region.Name, Outline = outline, Label = Centroid(outline), Site = region.FirstSite ?? -1 });
            }
            foreach (TrailLeg leg in layout.Legs)
            {
                var points = new List<Vector2>();
                foreach (P2 point in leg.Polyline)
                {
                    Vector2 at = At(point);
                    if (points.Count == 0 || (at - points[points.Count - 1]).sqrMagnitude >= MapTrailStep * MapTrailStep)
                    {
                        points.Add(at);
                    }
                }
                if (leg.Polyline.Length > 1)
                {
                    points.Add(At(leg.Polyline[leg.Polyline.Length - 1]));
                }
                map.Trail.Add(points.ToArray());
            }
            foreach (WorldSite site in layout.Sites)
            {
                map.Sites.Add(new MapModel.Site
                {
                    Name = Whereabouts.SiteTitle(world, site), Outline = Array.ConvertAll(site.Blob, At), Stone = At(site.Stone.Position), Pad = At(site.Pad.Position),
                    Chapters = site.Chapters.Where(chapter => chapter.Stone != null).Select(chapter => At(chapter.Stone.Value.Position)).ToArray(),
                });
            }
            map.ReturnPortal = At(layout.ReturnPortal.Position);
            map.Dots = new Vector2[world.StandCount];
            map.DotColours = new Color[world.StandCount];
            for (int stand = 0; stand < world.StandCount; stand++)
            {
                map.Dots[stand] = At(world.Position(stand));
                map.DotColours[stand] = StandField.ClassColours[StandField.ClassOf(world, stand)];
            }
            return map;
        }

        public const float MapMargin = 40, MapTrailStep = 4;

        // The middle of a polygon's area.
        static Vector2 Centroid(Vector2[] polygon)
        {
            double area = 0, x = 0, y = 0;
            for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
            {
                double cross = (double)polygon[j].x * polygon[i].y - (double)polygon[i].x * polygon[j].y;
                area += cross;
                x += (polygon[j].x + polygon[i].x) * cross;
                y += (polygon[j].y + polygon[i].y) * cross;
            }
            return area == 0 ? polygon[0] : new Vector2((float)(x / (3 * area)), (float)(y / (3 * area)));
        }

        // A kit's dressing, once a session world: loaded from its resource without stopping the frame.
        IEnumerator LoadKit(string kit)
        {
            if (kit == null || Kits.ContainsKey(kit))
            {
                yield break;
            }
            ResourceRequest request = Resources.LoadAsync<KitDressing>(KitDressing.ResourceOf(kit));
            while (!request.isDone)
            {
                yield return null;
            }
            Kits[kit] = request.asset as KitDressing;
        }

        // The ambient bed of every family the world's regions name, and a source on every body of
        // water (PRD v4 5.12.1, 5.12.3): rivers, ponds and lakes, the sea along its shore, and lava.
        WorldSound BuildSound(DressPlan plan, Transform listener)
        {
            WorldSound sound = WorldSound.Create(worldRoot.transform, listener, at =>
            {
                // The world can be left in a frame before its sound goes (`Unload`): its plan has
                // no grids then (DEC-1194 N27).
                if (plan.Region == null)
                {
                    return (null, null, 0);
                }
                int texel = plan.Grid.At(at.x, at.z);
                return (plan.Regions[plan.Region[texel]].Ambient, plan.Regions[plan.Other[texel]].Ambient, plan.Share(texel));
            });
            foreach (RegionDress region in plan.Regions)
            {
                string kit = KitLoops.KitOf(region.Ambient);
                if (kit != null && Kits.TryGetValue(kit, out KitDressing dressing) && dressing != null)
                {
                    sound.Bed(region.Ambient, dressing.Loop(region.Ambient));
                }
            }
            AudioClip Loop((string Kit, string Loop) of) => of.Kit != null && Kits.TryGetValue(of.Kit, out KitDressing dressing) && dressing != null ? dressing.Loop(of.Loop) : null;
            float level = DressPlan.WaterLevel;
            int index = 0;
            foreach (WaterBody body in plan.Water)
            {
                AudioClip clip = Loop(KitLoops.OfWater(body.Kind));
                string name = $"{body.Kind} {index++}";
                if (body.Line.Count > 1)
                {
                    float height = body.Kind == WaterBody.Lava ? DressPlan.LavaLevel : level;
                    var line = body.Line.ConvertAll(point => new Vector3(point.x, height, point.y));
                    bool lava = body.Kind == WaterBody.Lava;
                    sound.Water(name, clip, at => WorldSound.NearestOnLine(line, at), lava ? 5 : 6, lava ? 90 : 140, lava ? 0.8f : 0.9f, 60);
                }
                else if (body.Kind == WaterBody.Sea)
                {
                    // Each sea's own shore: one source a sea (DEC-1194 N9).
                    List<Vector3> shore = plan.Shore(DressPlan.WetSea, body.Region);
                    if (shore.Count > 0)
                    {
                        sound.Water(name, clip, at => Nearest(shore, at), 15, 260, 1, 120);
                    }
                }
                else
                {
                    Vector3 centre = new Vector3(body.Centre.x, body.Kind == WaterBody.Lava ? DressPlan.LavaLevel : level, body.Centre.y);
                    float radius = body.Radius;
                    bool lake = body.Kind == WaterBody.Lake;
                    sound.Water(name, clip, at =>
                    {
                        Vector3 away = at - centre;
                        away.y = 0;
                        return away.magnitude <= radius ? new Vector3(at.x, centre.y, at.z) : centre + away.normalized * radius;
                    }, lake ? 8 : 4, lake ? 120 : 50, lake ? 0.8f : 0.5f, 90);
                }
            }
            // A marsh's pools are no body of water, but they are heard as a lake's edge is: one
            // source a marsh, riding the nearest of its pools' shores (PRD v4 5.12.3; DEC-1194 B1).
            for (int r = 0; r < plan.Regions.Length; r++)
            {
                if (plan.Regions[r].Water != WaterBody.Marsh)
                {
                    continue;
                }
                List<Vector3> pools = plan.Shore(DressPlan.WetMarsh, r);
                if (pools.Count > 0)
                {
                    sound.Water($"{WaterBody.Marsh} {index++}", Loop(KitLoops.OfWater(WaterBody.Marsh)), at => Nearest(pools, at), 4, 50, 0.5f, 90);
                }
            }
            sound.Settle();
            return sound;
        }

        static Vector3 Nearest(List<Vector3> points, Vector3 at)
        {
            Vector3 best = points[0];
            float bestDistance = float.MaxValue;
            foreach (Vector3 point in points)
            {
                float d = (point.x - at.x) * (point.x - at.x) + (point.z - at.z) * (point.z - at.z);
                if (d < bestDistance)
                {
                    bestDistance = d;
                    best = point;
                }
            }
            return best;
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
            Hud.HideMap();
            Hud.HideStone();
            Hud.Hover(null, default);
            Exhibit.Spared = Rect.zero;
            HoveredStand = HoveredStone = labelled = -1;
            // The sound stops reading the plan before the plan lets its grids go (DEC-1194 N27).
            if (Sound != null)
            {
                Sound.enabled = false;
            }
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
            // The plan's grids and the props' places go with the world, whatever still holds the
            // plan or the scatter: after a first visit they stayed in the heap, and the next
            // visit's plan was built beside them (DEC-1005, the memory cut).
            Dress?.Release();
            Scatter?.Release();
            Map = null;
            whereabouts = null;
            placeShown = false;
            ShownRegion = ShownSite = -1;
            Stones = null;
            Stands = null;
            Images = null;
            Ground = null;
            Tiles = null;
            Dress = null;
            Scatter = null;
            Props = null;
            Sound = null;
            Water = null;
            Sky = null;
            lavaFlow = null;
            ReturnPortal = null;
            WorldLoaded = false;
            // The kits leave with the world: the hub holds none of them (DEC-1055, N20).
            Kits.Clear();
            Resources.UnloadUnusedAssets();
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
            // The first time, what card view, the overlays and the water will need is made ready
            // here, behind the surface: the first use of depth of field, of each size of text and
            // of each kind of water otherwise stops a frame for most of a second, in the middle of
            // the world.
            if (destination == Place.World && Failure == null && !warmed)
            {
                warmed = true;
                CardView.Warm(true);
                Hud.Warm(true);
                GameObject waterWarmUp = Water != null ? WorldWater.WarmUp(Water, World.Layout.Radius / 1000f) : null;
                for (int frame = 0; frame < 4; frame++)
                {
                    yield return null;
                }
                CardView.Warm(false);
                Hud.Warm(false);
                if (waterWarmUp != null)
                {
                    WorldWater.EndWarmUp(Water, waterWarmUp);
                }
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
                    Hud.Place(HubName);
                    Hud.Sentence(null);
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
