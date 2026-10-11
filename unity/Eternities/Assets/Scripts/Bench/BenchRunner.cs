using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Eternities.Avatar;
using Eternities.CardView;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using Eternities.Travel;
using Unity.Collections;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.Bench
{
    // The bench (PRD v4 8.8.4), as designed on DEC-953: one script, run by a player build for the
    // figures of record and by the editor's play mode for CI. It starts itself when the process was
    // given `-bench`, walks the path, writes `eternities.bench.v1` to `-benchOut` and ends the
    // process: exit 0 only if the path completed.
    //
    // The path so far: the hub (capture 2), the walk into Dominaria's portal, the arrival (capture
    // 3), the walk along the north radial path to the rim, the run along the outermost ring path,
    // the nearest stand's apron (capture 4), card view there, travel by the menu to a named card and
    // its card view, the card flipped to its back (capture 5), the return to the hub, and the same
    // arrival with reduced motion (capture 9). A warm run first visits the world once; a cold run
    // first empties the image cache. A prices run goes no further than the arrival and one travel:
    // it draws up the price list of `BenchPrices.cs` at both.
    public sealed partial class BenchRunner : MonoBehaviour
    {
        public const string Schema = "eternities.bench.v1";
        public const string HdrpVersion = "17.6.0";     // held to Packages/packages-lock.json by a test
        const float HitchThresholdMs = 4;
        const double Watchdog = 600;
        const double AfterArrival = 1.0, AfterCapture = 0.5;

        static BenchArgs args;

        BenchArgs run;
        RenderTexture target;
        readonly FrameSeries dominaria = new FrameSeries(1 << 18), hub = new FrameSeries(1 << 16);
        readonly List<Segment> segments = new List<Segment>();
        readonly List<Dictionary<string, object>> captures = new List<Dictionary<string, object>>();
        Segment segment;
        double started, lastFrame, excludeUntil;
        int excludedAfterPortal, excludedCapture;
        bool excludingCapture, sampling, finished;
        int renderedFrames, updates;
        ProfilerRecorder gpuMemory, systemMemory;
        long gpuPeak, systemPeak;
        string failure;

        sealed class Segment
        {
            public string Id;
            public FrameSeries Block;       // the block of `frames` its frames count in, or null
            public FrameSeries Frames = new FrameSeries(1 << 16);
            public float Metres;
        }

        readonly ScriptedInputSource hands = new ScriptedInputSource();
        readonly Dictionary<string, object> timings = new Dictionary<string, object>
        {
            ["hubReadyMs"] = null, ["portalToWorldReadyMs"] = null, ["holdMs"] = null, ["cardViewEnterMs"] = null, ["cardViewLeaveMs"] = null,
            ["travelMenuToCardViewMs"] = null, ["portalOutMs"] = null,
        };
        readonly Dictionary<string, object> streaming = new Dictionary<string, object>
        {
            ["hitchThresholdMs"] = HitchThresholdMs, ["hitches"] = 0, ["worstMs"] = 0,
            ["imagesFromDisk"] = 0, ["imagesFromNetwork"] = 0, ["imagesFailed"] = 0, ["imageUploads"] = 0, ["evictions"] = 0,
        };
        readonly Dictionary<string, object> memory = new Dictionary<string, object>
        {
            ["gpuPeakBytes"] = 0L, ["gpuSource"] = "ProfilerRecorder: Gfx Used Memory", ["rssPeakBytes"] = 0L, ["rssSource"] = "ProfilerRecorder: System Used Memory",
            ["footprintBytes"] = null, ["graphicsFootprintBytes"] = null, ["footprintSource"] = null,
            ["residentImagesPeakBytes"] = 0L, ["imageSlots"] = StandImages.Slots, ["imageSlotsInUsePeak"] = 0,
        };
        readonly Dictionary<string, object> pathSeen = new Dictionary<string, object>
        {
            ["radialPathId"] = null, ["radialMetres"] = 0, ["ringMetres"] = 0, ["siteCard"] = null, ["siteImageShown"] = false,
            ["travelCard"] = null, ["travelCardBackShown"] = false,
        };
        // The exhibit pass and its composite on and off at the arrival point: an addition to the
        // schema as confirmed, for row I's limit on the prepass.
        readonly Dictionary<string, object> exhibit = new Dictionary<string, object> { ["withP50Ms"] = null, ["withoutP50Ms"] = null, ["costMs"] = null };
        Dictionary<string, object> worldSeen;
        string packHash;
        bool? dirty;        // null: the run does not know (the editor host)
        int renderWidth, renderHeight;
        Vector3 lastPosition;
        App app;
        ScryfallImages scryfall;
        const float RingArc = 150;
        const string TravelCard = "Invasion of Dominaria";     // one printing, and a back image: Serra Faithkeeper
        bool reducedMotion;
        RenderTexture overlays;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            args = BenchArgs.Parse(Environment.GetCommandLineArgs());
            if (args.Present)
            {
                var runner = new GameObject("Bench").AddComponent<BenchRunner>();
                DontDestroyOnLoad(runner.gameObject);
            }
        }

        double Now => Time.realtimeSinceStartupAsDouble;

        // A frame time is a figure only if nothing paces the frames: no vsync and no frame cap.
        static void Unpaced()
        {
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = -1;
        }

        // Puts a run's quality level in force; null is the level the project starts at. A level
        // carries a vsync count of its own, and the switch puts that in force too, so the run's
        // pacing is set again after it. Without that, a run at any level but the one the player
        // starts at was paced by the display, and on a locked screen, where no frame is ever
        // presented, it waited for its first frame for ever.
        public static bool EnterLevel(string quality)
        {
            if (quality != null)
            {
                int level = Array.IndexOf(QualitySettings.names, quality);
                if (level < 0)
                {
                    return false;
                }
                QualitySettings.SetQualityLevel(level, applyExpensiveChanges: true);
            }
            Unpaced();
            return true;
        }

        IEnumerator Start()
        {
            run = args;
            started = lastFrame = Now;
            // A player names the commit it was built from, whatever its command line says.
            string stamp = Path.Combine(Application.streamingAssetsPath, BuildStamp.FileName);
            if (!Application.isEditor && File.Exists(stamp) && BuildStamp.TryRead(File.ReadAllText(stamp), out string builtFrom, out bool builtDirty))
            {
                run.Commit = builtFrom;
                dirty = builtDirty;
            }
            Unpaced();
            Application.runInBackground = true;     // a run does not stop when its window loses the focus
            if (!Application.isEditor)
            {
                // A figure of record is taken full screen at the display's native resolution (PRD v4
                // 7.1). `-benchSize` asks for another, which a display may refuse: see below.
                bool sized = run.Width > 0;
                Screen.SetResolution(sized ? run.Width : Display.main.systemWidth, sized ? run.Height : Display.main.systemHeight, FullScreenMode.FullScreenWindow);
                yield return null;
                yield return null;
                // A display may not take a size that is not its own. A run that does not render
                // at the size it was asked for says so and is not a figure.
                for (double until = Now + 3; sized && Now < until && (Screen.width != run.Width || Screen.height != run.Height);)
                {
                    yield return null;
                }
                Debug.Log($"Bench: the view is {Screen.width} x {Screen.height}");
                if (sized && (Screen.width != run.Width || Screen.height != run.Height))
                {
                    Finish($"the display did not take {run.Width} x {run.Height}: the view is {Screen.width} x {Screen.height}");
                    yield break;
                }
            }
            if (!EnterLevel(run.Quality))
            {
                Finish($"no quality level is named '{run.Quality}'");
                yield break;
            }
            if (run.Scale < 1)
            {
                // The resolution scale of PRD v4 9.5, row R3, is HDRP's dynamic resolution held at
                // one value. It can only be held where the level's HDRP asset has it enabled; a run
                // that cannot render at the scale it was asked for says so and is not a figure.
                yield return null;      // the level's HDRP asset is in force from the next frame
                var asset = GraphicsSettings.currentRenderPipeline as HDRenderPipelineAsset;
                var view = Camera.main != null ? Camera.main.GetComponent<HDAdditionalCameraData>() : null;
                if (asset == null || view == null || !asset.currentPlatformRenderPipelineSettings.dynamicResolutionSettings.enabled)
                {
                    Finish($"a run at scale {run.Scale} needs dynamic resolution, and it is off in the HDRP asset of the quality level '{QualitySettings.names[QualitySettings.GetQualityLevel()]}'");
                    yield break;
                }
                float percentage = run.Scale * 100;
                view.allowDynamicResolution = true;
                DynamicResolutionHandler.SetDynamicResScaler(() => percentage, DynamicResScalePolicyType.ReturnsPercentage);
            }
            gpuMemory = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Gfx Used Memory");
            systemMemory = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "System Used Memory");
            RenderPipelineManager.endContextRendering += Rendered;

            // The editor has no Game view in batchmode: the run renders off screen at the size asked.
            if (run.Width > 0 && Camera.main != null)
            {
                target = new RenderTexture(run.Width, run.Height, 24, GraphicsFormat.R8G8B8A8_SRGB) { name = "bench" };
                Camera.main.targetTexture = target;
            }

            yield return Step("hub", 60, () => App.Instance != null && (App.Instance.HubReady || App.Instance.Failure != null));
            app = App.Instance;
            if (Ok)
            {
                timings["hubReadyMs"] = Math.Round(Time.realtimeSinceStartupAsDouble * 1000);
                packHash = app.Pack.Hash;
                app.Avatar.Source = hands;
                Vector3 hubArrival = lastPosition = app.Avatar.transform.position;
                scryfall = app.ImageSource as ScryfallImages;
                if (target != null)
                {
                    // With no screen the overlays have nowhere to be drawn: they go into a texture of
                    // their own, which a capture lays over the frame.
                    overlays = new RenderTexture(target.width, target.height, 24, GraphicsFormat.R8G8B8A8_SRGB) { name = "bench overlays" };
                    app.Hud.Settings.targetTexture = overlays;
                    app.Hud.Settings.clearColor = true;
                    app.Hud.Settings.colorClearValue = new Color(0, 0, 0, 0);
                }
                if (run.Mode == "cold" && scryfall != null)
                {
                    scryfall.Cache.Clear();     // a cold run starts with no image on disk (PRD v4 7.2)
                }
                else if (run.Mode == "warm")
                {
                    // A warm run has visited the world once in the session: in, and back to the hub.
                    yield return IntoThePortal("warm-up");
                    if (Ok)
                    {
                        hands.Back = true;
                        yield return Step("warm-up", 60, () => (app.Place == Place.Hub && !app.InTransition) || app.Failure != null);
                    }
                    // Back to where a visitor arrives in the hub, as a run starts.
                    if (Ok)
                    {
                        yield return Walk("warm-up", hubArrival, 60, run: true);
                    }
                }
            }
            if (Ok)
            {
                // Step 1: in the hub, facing Dominaria's portal.
                Begin("hub", hub);
                yield return Wait(2);
                yield return Capture(2, "checkpoint-2-hub.png");

                // Step 2: walk into the portal. It ends when the world is ready and the transition done.
                Begin("portal-in", hub);
                yield return IntoThePortal("portal-in");
            }
            if (Ok)
            {
                timings["portalToWorldReadyMs"] = Math.Round(app.LastTravelSeconds * 1000);
                timings["holdMs"] = Math.Round(app.LastHoldSeconds * 1000);
                WorldLayout layout = app.World.Layout;
                // What the main camera renders at, read from the pipeline and not worked out.
                HDCamera rendering = HDCamera.GetOrCreate(Camera.main);
                renderWidth = rendering.actualWidth;
                renderHeight = rendering.actualHeight;
                worldSeen = new Dictionary<string, object>
                {
                    ["slug"] = app.World.Plane.Slug, ["stands"] = layout.Stands.Count, ["sites"] = layout.Sites.Count,
                    ["diameterMm"] = 2 * layout.WorldRadius, ["props"] = app.Props != null ? app.Props.Count : 0,
                };

                // Step 3: stand at the arrival point, facing north, until the images in reach are in.
                Begin("arrival", dominaria);
                excludeUntil = Now + AfterArrival;
                yield return Wait(1);
                yield return Settle(5);
                yield return Capture(3, "checkpoint-3-arrival.png");

                // What the isolated image path costs (PRD v4 8.4.4, row I): the same view for three
                // seconds with the exhibit pass and its composite, and three without. Outside the
                // blocks: half of it is not what the product draws.
                var with = new FrameSeries(1 << 14);
                var without = new FrameSeries(1 << 14);
                Begin("exhibit-cost", null);
                yield return Wait(0.5);
                segment.Block = with;
                yield return Wait(3);
                segment.Block = null;
                app.Exhibit.PassEnabled = false;
                yield return Wait(0.5);
                segment.Block = without;
                yield return Wait(3);
                segment.Block = null;
                app.Exhibit.PassEnabled = true;
                exhibit["withP50Ms"] = with.Percentile(50);
                exhibit["withoutP50Ms"] = without.Percentile(50);
                exhibit["costMs"] = Math.Round(with.Percentile(50) - without.Percentile(50), 3);

                if (run.Mode == "prices")
                {
                    yield return Prices("the arrival point");
                    int far = layout.Stands.FindIndex(stand => app.World.Cards[stand.Card].Name == TravelCard);
                    app.TravelTo(far);
                    yield return null;
                    yield return Step("prices", 30, () => !app.InTransition || app.Failure != null);
                    if (Ok)
                    {
                        yield return Wait(1);
                        yield return Settle(5);
                        yield return Prices($"the apron of {TravelCard}");
                        Images();
                    }
                    Finish(failure ?? app.Failure);
                    yield break;
                }

                // Step 4: walk north along the radial path at 0 degrees, from the plaza to where it
                // meets the outermost ring path.
                LayoutPath radial = layout.Paths.Find(p => p.Kind == PathKind.Radial && p.Angle == 0);
                LayoutPath rim = layout.Paths.FindLast(p => p.Kind == PathKind.Ring);
                float ringRadius = (rim.Inner + rim.Outer) / 2000f;
                pathSeen["radialPathId"] = radial?.Id;
                Begin("radial", dominaria);
                yield return Walk("radial", new Vector3(0, 0, ringRadius), ringRadius / AvatarController.WalkSpeed + 30, run: false);
                pathSeen["radialMetres"] = Math.Round(segment.Metres, 2);

                // Step 5: turn clockwise and run along that ring path, across the wedge, for 150 m
                // of arc or to the next radial path.
                if (Ok)
                {
                    Begin("ring", dominaria);
                    float arc = Mathf.Min(RingArc, layout.WedgeSpan[0] > 0 ? layout.WedgeSpan[0] / 1e6f * Mathf.Deg2Rad * ringRadius : RingArc);
                    hands.Run = true;
                    yield return Step("ring", arc / AvatarController.RunSpeed + 30, () =>
                    {
                        Vector3 at = app.Avatar.transform.position;
                        var outward = new Vector3(at.x, 0, at.z).normalized;
                        // Along the circle, and back onto its centre line when it drifts off.
                        hands.WorldMove = (new Vector3(outward.z, 0, -outward.x) + outward * Mathf.Clamp(ringRadius - new Vector2(at.x, at.z).magnitude, -1, 1)).normalized;
                        return segment.Metres >= arc || app.Failure != null;
                    });
                    hands.WorldMove = Vector3.zero;
                    hands.Run = false;
                    pathSeen["ringMetres"] = Math.Round(segment.Metres, 2);
                }

                // Step 6: walk up the corridor of the nearest stand to its apron, and wait for its image.
                if (Ok)
                {
                    Begin("site", dominaria);
                    Vector3 here = app.Avatar.transform.position;
                    LayoutStand nearest = null;
                    foreach (LayoutStand stand in layout.Stands)
                    {
                        if (stand.Path == rim.Id && (nearest == null || (StandField.Ground(stand.PathPoint) - here).sqrMagnitude < (StandField.Ground(nearest.PathPoint) - here).sqrMagnitude))
                        {
                            nearest = stand;
                        }
                    }
                    PackCard card = app.World.Cards[nearest.Card];
                    pathSeen["siteCard"] = new Dictionary<string, object> { ["name"] = card.Name, ["oracleId"] = card.OracleId };
                    Vector3 apron = StandField.Ground(nearest.Position) + StandField.Facing(nearest) * Vector3.forward * (LayoutConstants.FootprintHalfDepth + LayoutConstants.ApronDepth / 2) / 1000f;
                    yield return Walk("site", StandField.Ground(nearest.PathPoint), 60, run: false);
                    yield return Walk("site", apron, 30, run: false);
                    int index = layout.Stands.IndexOf(nearest);
                    // Scryfall may be out of reach of the machine the bench runs on: the path goes on without the image.
                    for (double until = Now + 8; Now < until && app.Images.CoverageOf(index) < 1;)
                    {
                        yield return null;
                    }
                    pathSeen["siteImageShown"] = app.Images.CoverageOf(index) >= 1;
                    // The camera steps to one side, as a visitor's would, so the avatar is not in front of the card.
                    hands.Look = new Vector2(40, 0);
                    yield return Wait(1);
                    yield return Capture(4, "checkpoint-4-site.png");

                    // Step 7: interact, hold 2 s, leave.
                    Begin("card-view", dominaria);
                    yield return CardView("cardViewEnterMs", index);
                    yield return Wait(2);
                    if (Ok)
                    {
                        double left = Now;
                        hands.Back = true;
                        yield return Step("card-view", 10, () => (!app.CardView.Active && app.CardView.Settled) || app.Failure != null);
                        timings["cardViewLeaveMs"] = Math.Round((Now - left) * 1000);
                    }
                }

                // Step 8: open the travel menu and choose a card of this world; the travel portal, the
                // automatic walk, the arrival on its apron, and card view. Timed from the input that
                // opens the menu; the script chooses on the next frame, so the figure holds no human time.
                if (Ok)
                {
                    Begin("travel", dominaria);
                    int target = app.World.Layout.Stands.FindIndex(stand => app.World.Cards[stand.Card].Name == TravelCard);
                    PackCard card = app.World.Cards[app.World.Layout.Stands[target].Card];
                    pathSeen["travelCard"] = new Dictionary<string, object> { ["name"] = card.Name, ["oracleId"] = card.OracleId };
                    double opened = Now;
                    hands.TravelMenu = true;
                    yield return Step("travel", 10, () => app.Hud.TravelOpen || app.Failure != null);
                    app.TravelTo(target);
                    yield return Step("travel", 20, () => (!app.InTransition && app.HoveredStand == target) || app.Failure != null);
                    excludeUntil = Now + AfterArrival;
                    yield return CardView(null, target);
                    timings["travelMenuToCardViewMs"] = Math.Round((Now - opened) * 1000);
                }

                // Step 9: flip the card to its back, hold 2 s, leave.
                if (Ok)
                {
                    Begin("card-view-2", dominaria);
                    hands.Interact = true;
                    yield return Step("card-view-2", 10, () => app.CardView.ShowingBack || app.Failure != null);
                    for (double until = Now + 8; Now < until && !(app.CardView.FrontShown && app.CardView.BackShown);)
                    {
                        yield return null;
                    }
                    pathSeen["travelCardBackShown"] = app.CardView.BackShown;
                    yield return Wait(2);
                    yield return Capture(5, "checkpoint-5-card-view.png");
                    hands.Back = true;
                    yield return Step("card-view-2", 10, () => (!app.CardView.Active && app.CardView.Settled) || app.Failure != null);
                }
            }
            if (Ok)
            {
                // Step 10: Esc in explore returns to the hub through the return portal.
                Images();
                Begin("footprint", null);
                yield return Footprint();
                Begin("portal-out", null);
                hands.Back = true;
                yield return Step("portal-out", 60, () => (app.Place == Place.Hub && !app.InTransition) || app.Failure != null);
            }
            if (Ok)
            {
                timings["portalOutMs"] = Math.Round(app.LastTravelSeconds * 1000);

                // Step 11: reduced motion on, and into the portal again: the same arrival.
                app.ReducedMotion = true;
                reducedMotion = true;
                Begin("reduced", null);
                yield return IntoThePortal("reduced");
                if (Ok)
                {
                    yield return Wait(1);
                    yield return Settle(5);
                    yield return Capture(9, "checkpoint-9-reduced-motion.png");
                }
            }
            if (failure == null && app != null && app.Failure != null)
            {
                failure = $"the application failed: {app.Failure}";
            }
            Finish(failure);
        }

        bool Ok => failure == null && app != null && app.Failure == null;

        // Interacts with the stand the avatar stands before, and waits for the card view camera to
        // settle. `timing` names the figure the wait is written to, or is null.
        IEnumerator CardView(string timing, int stand)
        {
            double began = Now;
            hands.Interact = true;
            yield return Step("card-view", 10, () => (app.CardView.Active && app.CardView.Stand == stand && app.CardView.Settled) || app.Failure != null);
            if (timing != null && Ok)
            {
                timings[timing] = Math.Round((Now - began) * 1000);
            }
        }

        IEnumerator IntoThePortal(string step)
        {
            Vector3 toPortal = app.HubPortal.transform.position - app.Avatar.transform.position;
            toPortal.y = 0;
            hands.WorldMove = toPortal.normalized;
            yield return Step(step, 120, () => (app.Place == Place.World && !app.InTransition) || app.Failure != null);
            hands.WorldMove = Vector3.zero;
        }

        // Walks or runs straight to a point on the ground, through the avatar's own input.
        IEnumerator Walk(string step, Vector3 to, double timeout, bool run)
        {
            hands.Run = run;
            yield return Step(step, timeout, () =>
            {
                Vector3 toGo = to - app.Avatar.transform.position;
                toGo.y = 0;
                hands.WorldMove = toGo.magnitude > 0.2f ? toGo.normalized : Vector3.zero;
                return toGo.magnitude <= 0.2f || app.Failure != null;
            });
            hands.WorldMove = Vector3.zero;
            hands.Run = false;
        }

        // Waits until the images in reach are in, for `atMost` seconds.
        IEnumerator Settle(double atMost)
        {
            for (double until = Now + atMost; Now < until && !app.Images.Idle;)
            {
                yield return null;
            }
        }

        // What the image stream did, read before the world is left.
        void Images()
        {
            if (app.Images == null)
            {
                return;
            }
            streaming["hitches"] = app.Images.Hitches;
            streaming["worstMs"] = Math.Round(app.Images.LongestUpdateMs, 3);
            streaming["imageUploads"] = app.Images.Uploads;
            streaming["evictions"] = app.Images.Evictions;
            if (scryfall != null)
            {
                streaming["imagesFromDisk"] = scryfall.FromDisk;
                streaming["imagesFromNetwork"] = scryfall.FromNetwork;
                streaming["imagesFailed"] = scryfall.Failed;
            }
            memory["imageSlotsInUsePeak"] = app.Images.SlotsInUsePeak;
            // RGBA8 with a full mip chain: four thirds of the top level.
            memory["residentImagesPeakBytes"] = (long)app.Images.SlotsInUsePeak * StandImages.Width * StandImages.Height * 4 * 4 / 3;
        }

        // The process as the system counts it, read before the world is left: `footprint` gives its
        // physical footprint, and what of it the graphics driver holds, which on Apple Silicon is
        // the GPU's memory. A player that is not a development build has no engine counter for it,
        // and an IL2CPP player cannot start a process. So the run asks whoever started it: it
        // writes its process id beside the JSON and waits a few seconds for `bench.sh` to answer
        // with the tool's output. Outside the blocks: the tool may hold the process while it reads.
        IEnumerator Footprint()
        {
            string request = run.Out + ".footprint-request", answer = run.Out + ".footprint";
            File.Delete(answer);
            File.WriteAllText(request, System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
            for (double until = Now + 8; Now < until && !File.Exists(answer);)
            {
                yield return null;
            }
            if (File.Exists(answer))
            {
                (long total, long graphics) = BenchArgs.ParseFootprint(File.ReadAllText(answer));
                memory["footprintBytes"] = total;
                memory["graphicsFootprintBytes"] = graphics;
                memory["footprintSource"] = "footprint(1), run by bench.sh before the run left the world: the process's footprint, and its categories marked graphics with IOSurface";
                File.Delete(answer);
            }
            else
            {
                memory["footprintSource"] = "no answer: start the run with unity/Eternities/bench.sh to have the process's footprint read";
            }
            File.Delete(request);
        }

        void Rendered(ScriptableRenderContext context, List<Camera> cameras)
        {
            renderedFrames++;
        }

        void Update()
        {
            double now = Now, frameStart = lastFrame;
            float milliseconds = (float)((now - lastFrame) * 1000);
            lastFrame = now;
            updates++;
            if (finished)
            {
                return;
            }
            if (now - started > Watchdog)
            {
                Finish($"the run passed {Watchdog} s in step '{segment?.Id ?? "start"}'");
                return;
            }
            if (gpuMemory.Valid)
            {
                gpuPeak = Math.Max(gpuPeak, gpuMemory.LastValue);
            }
            if (systemMemory.Valid)
            {
                systemPeak = Math.Max(systemPeak, systemMemory.LastValue);
            }
            if (!sampling || segment == null)
            {
                return;
            }
            double at = now - started;
            if (App.Instance != null && App.Instance.Avatar != null)
            {
                // Metres walked, not moved: an arrival is a jump and is not counted.
                Vector3 position = App.Instance.Avatar.transform.position;
                Vector3 moved = position - lastPosition;
                moved.y = 0;
                segment.Metres += moved.magnitude < 5 ? moved.magnitude : 0;
                lastPosition = position;
            }
            segment.Frames.Add(milliseconds, at, segment.Id);
            if (excludingCapture)
            {
                excludedCapture++;
            }
            else if (frameStart < excludeUntil)
            {
                // A frame that began in the first second after an arrival, however long it ran.
                excludedAfterPortal++;
            }
            else
            {
                segment.Block?.Add(milliseconds, at, segment.Id);
            }
        }

        void Begin(string id, FrameSeries block)
        {
            segment = new Segment { Id = id, Block = block };
            segments.Add(segment);
            sampling = true;
        }

        IEnumerator Wait(double seconds)
        {
            double until = Now + seconds;
            while (Now < until)
            {
                yield return null;
            }
        }

        // Waits for `done`, and fails the run if it has not come after `timeout` seconds.
        IEnumerator Step(string id, double timeout, Func<bool> done)
        {
            double until = Now + timeout;
            while (!done())
            {
                if (Now > until)
                {
                    failure = $"step '{id}' passed its {timeout} s";
                    yield break;
                }
                yield return null;
            }
        }

        // A capture stalls its frame: the frames from here to half a second after it are counted
        // under `excluded.capture` and stay out of the statistics.
        IEnumerator Capture(int checkpoint, string file)
        {
            if (run.Captures == null)
            {
                yield break;
            }
            excludingCapture = true;
            double at = Now - started;
            RenderTexture source = target;
            RenderTexture screen = null;
            if (source != null && overlays != null)
            {
                screen = RenderTexture.GetTemporary(source.width, source.height, 0, GraphicsFormat.R8G8B8A8_SRGB);
                Graphics.Blit(source, screen);
                app.Exhibit.Over(overlays, screen, flip: false);
                source = screen;
            }
            else if (source == null)
            {
                yield return new WaitForEndOfFrame();
                screen = RenderTexture.GetTemporary(Screen.width, Screen.height, 0, GraphicsFormat.R8G8B8A8_SRGB);
                ScreenCapture.CaptureScreenshotIntoRenderTexture(screen);
                source = screen;
            }
            AsyncGPUReadbackRequest request = AsyncGPUReadback.Request(source, 0, GraphicsFormat.R8G8B8A8_SRGB);
            yield return Step($"capture {checkpoint}", 20, () => request.done);
            if (failure == null && request.hasError)
            {
                failure = $"capture {checkpoint} could not be read back";
            }
            if (failure == null)
            {
                Directory.CreateDirectory(run.Captures);
                using (NativeArray<byte> png = ImageConversion.EncodeNativeArrayToPNG(request.GetData<byte>(), GraphicsFormat.R8G8B8A8_SRGB, (uint)source.width, (uint)source.height))
                {
                    File.WriteAllBytes(Path.Combine(run.Captures, file), png.ToArray());
                }
                captures.Add(new Dictionary<string, object> { ["checkpoint"] = checkpoint, ["file"] = file, ["atSeconds"] = Math.Round(at, 3) });
            }
            if (screen != null)
            {
                RenderTexture.ReleaseTemporary(screen);
            }
            yield return Wait(AfterCapture);
            excludingCapture = false;
        }

        void Finish(string why)
        {
            if (finished)
            {
                return;
            }
            finished = true;
            sampling = false;
            RenderPipelineManager.endContextRendering -= Rendered;
            int code = why == null ? 0 : 1;
            try
            {
                File.WriteAllText(run.Out, Json.Write(Report(why)));
                Debug.Log($"Bench: wrote {run.Out}; {updates} updates, {renderedFrames} rendered; {(why == null ? "the path completed" : "FAILED: " + why)}");
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                code = 1;
            }
            gpuMemory.Dispose();
            systemMemory.Dispose();
#if UNITY_EDITOR
            UnityEditor.EditorApplication.Exit(code);
#else
            Application.Quit(code);
#endif
        }

        Dictionary<string, object> Memory()
        {
            memory["gpuPeakBytes"] = gpuPeak;
            memory["rssPeakBytes"] = systemPeak;
            return memory;
        }

        Dictionary<string, object> Block(FrameSeries frames)
        {
            Dictionary<string, object> block = frames.ToJson();
            block["longest"] = new Dictionary<string, object> { ["atSeconds"] = Math.Round(frames.LongestAtSeconds, 3), ["segment"] = frames.LongestSegment };
            return block;
        }

        Dictionary<string, object> Report(string why)
        {
            Resolution display = Screen.currentResolution;
            int width = target != null ? target.width : Screen.width, height = target != null ? target.height : Screen.height;
            var segmentList = new List<object>();
            foreach (Segment s in segments)
            {
                Dictionary<string, object> entry = s.Frames.ToJson();
                var ordered = new Dictionary<string, object> { ["id"] = s.Id, ["seconds"] = entry["seconds"], ["metres"] = Math.Round(s.Metres, 2) };
                foreach (string key in new[] { "count", "p50Ms", "p90Ms", "p99Ms", "longestMs" })
                {
                    ordered[key] = entry[key];
                }
                segmentList.Add(ordered);
            }
            return new Dictionary<string, object>
            {
                ["schema"] = Schema,
                ["run"] = new Dictionary<string, object>
                {
                    ["mode"] = run.Mode,
                    ["host"] = Application.isEditor ? "editor" : "player",
                    ["startedAt"] = DateTime.UtcNow.AddSeconds(-(Now - started)).ToString("yyyy-MM-ddTHH:mm:ssZ"),
                    ["commit"] = run.Commit, ["dirty"] = dirty,
                    ["packHash"] = packHash,
                    ["unity"] = Application.unityVersion, ["hdrp"] = HdrpVersion,
#if ENABLE_IL2CPP
                    ["scriptingBackend"] = "il2cpp",
#else
                    ["scriptingBackend"] = "mono",
#endif
                    ["developmentBuild"] = Debug.isDebugBuild,
                    ["machine"] = new Dictionary<string, object>
                    {
                        ["model"] = SystemInfo.deviceModel, ["chip"] = SystemInfo.processorType,
                        ["memoryBytes"] = SystemInfo.systemMemorySize * 1024L * 1024L, ["os"] = SystemInfo.operatingSystem,
                    },
                    ["display"] = new Dictionary<string, object>
                    {
                        ["width"] = display.width, ["height"] = display.height, ["refreshHz"] = Math.Round(display.refreshRateRatio.value, 2),
                    },
                    ["quality"] = QualitySettings.names[QualitySettings.GetQualityLevel()], ["resolutionScale"] = run.Scale,
                    ["output"] = new Dictionary<string, object> { ["width"] = width, ["height"] = height },
                    ["render"] = new Dictionary<string, object> { ["width"] = renderWidth, ["height"] = renderHeight },
                    ["vsync"] = QualitySettings.vSyncCount, ["frameCap"] = Math.Max(0, Application.targetFrameRate),
                    ["reducedMotion"] = reducedMotion, ["captures"] = run.Captures != null,
                    ["otherUnityProcesses"] = null,
                    ["complete"] = why == null, ["failure"] = why,
                },
                ["world"] = worldSeen ?? new Dictionary<string, object> { ["slug"] = null, ["stands"] = 0, ["sites"] = 0, ["diameterMm"] = 0, ["props"] = 0 },
                ["frames"] = new Dictionary<string, object>
                {
                    ["dominaria"] = Block(dominaria), ["hub"] = Block(hub),
                    ["excluded"] = new Dictionary<string, object> { ["afterPortal"] = excludedAfterPortal, ["capture"] = excludedCapture },
                },
                ["segments"] = segmentList,
                ["timings"] = timings,
                ["memory"] = Memory(),
                ["streaming"] = streaming,
                ["exhibit"] = exhibit,
                ["prices"] = prices,
                ["path"] = pathSeen,
                ["captures"] = captures,
            };
        }
    }
}
