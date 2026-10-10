using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Eternities.Avatar;
using Eternities.Data;
using Eternities.Travel;
using Unity.Collections;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

namespace Eternities.Bench
{
    // The bench (PRD v4 8.8.4), as designed on DEC-953: one script, run by a player build for the
    // figures of record and by the editor's play mode for CI. It starts itself when the process was
    // given `-bench`, walks the path, writes `eternities.bench.v1` to `-benchOut` and ends the
    // process: exit 0 only if the path completed.
    //
    // The path so far: the hub (capture 2), the walk into Dominaria's portal, the arrival (capture
    // 3) and the return to the hub. The other steps come with what they exercise.
    public sealed class BenchRunner : MonoBehaviour
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
        Dictionary<string, object> worldSeen;
        string packHash;
        Vector3 lastPosition;

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

        IEnumerator Start()
        {
            run = args;
            started = lastFrame = Now;
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = -1;
            if (run.Quality != null)
            {
                int level = Array.IndexOf(QualitySettings.names, run.Quality);
                if (level < 0)
                {
                    Finish($"no quality level is named '{run.Quality}'");
                    yield break;
                }
                QualitySettings.SetQualityLevel(level, applyExpensiveChanges: true);
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
            App app = App.Instance;
            if (failure == null && app.Failure == null)
            {
                timings["hubReadyMs"] = Math.Round(Time.realtimeSinceStartupAsDouble * 1000);
                packHash = app.Pack.Hash;
                app.Avatar.Source = hands;
                lastPosition = app.Avatar.transform.position;

                // Step 1: in the hub at the arrival pose, facing Dominaria's portal.
                Begin("hub", hub);
                yield return Wait(2);
                yield return Capture(2, "checkpoint-2-hub.png");

                // Step 2: walk into the portal. It ends when the world is ready and the transition done.
                Begin("portal-in", hub);
                Vector3 toPortal = app.HubPortal.transform.position - app.Avatar.transform.position;
                toPortal.y = 0;
                hands.WorldMove = toPortal.normalized;
                yield return Step("portal-in", 120, () => (app.Place == Place.World && !app.InTransition) || app.Failure != null);
                hands.WorldMove = Vector3.zero;
            }
            if (failure == null && app.Failure == null)
            {
                timings["portalToWorldReadyMs"] = Math.Round(app.LastTravelSeconds * 1000);
                timings["holdMs"] = Math.Round(app.LastHoldSeconds * 1000);
                worldSeen = new Dictionary<string, object>
                {
                    ["slug"] = app.World.Plane.Slug, ["stands"] = app.World.Layout.Stands.Count, ["sites"] = app.World.Layout.Sites.Count,
                    ["diameterMm"] = 2 * app.World.Layout.WorldRadius,
                };

                // Step 3: stand at the arrival point, facing north.
                Begin("arrival", dominaria);
                excludeUntil = Now + AfterArrival;
                yield return Wait(3);
                yield return Capture(3, "checkpoint-3-arrival.png");
                yield return Wait(2);

                // Step 10: Esc in explore returns to the hub through the return portal.
                Begin("portal-out", null);
                hands.Back = true;
                yield return Step("portal-out", 60, () => (app.Place == Place.Hub && !app.InTransition) || app.Failure != null);
            }
            if (failure == null && app.Failure == null)
            {
                timings["portalOutMs"] = Math.Round(app.LastTravelSeconds * 1000);
            }
            if (failure == null && app != null && app.Failure != null)
            {
                failure = $"the application failed: {app.Failure}";
            }
            Finish(failure);
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
            if (source == null)
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
                    ["commit"] = run.Commit, ["dirty"] = null,
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
                    ["render"] = new Dictionary<string, object> { ["width"] = Mathf.RoundToInt(width * run.Scale), ["height"] = Mathf.RoundToInt(height * run.Scale) },
                    ["vsync"] = QualitySettings.vSyncCount, ["frameCap"] = Math.Max(0, Application.targetFrameRate),
                    ["reducedMotion"] = false, ["captures"] = run.Captures != null,
                    ["otherUnityProcesses"] = null,
                    ["complete"] = why == null, ["failure"] = why,
                },
                ["world"] = worldSeen ?? new Dictionary<string, object> { ["slug"] = null, ["stands"] = 0, ["sites"] = 0, ["diameterMm"] = 0 },
                ["frames"] = new Dictionary<string, object>
                {
                    ["dominaria"] = Block(dominaria), ["hub"] = Block(hub),
                    ["excluded"] = new Dictionary<string, object> { ["afterPortal"] = excludedAfterPortal, ["capture"] = excludedCapture },
                },
                ["segments"] = segmentList,
                ["timings"] = timings,
                ["memory"] = new Dictionary<string, object>
                {
                    ["gpuPeakBytes"] = gpuPeak, ["gpuSource"] = "ProfilerRecorder: Gfx Used Memory",
                    ["rssPeakBytes"] = systemPeak, ["rssSource"] = "ProfilerRecorder: System Used Memory",
                    ["residentImagesPeakBytes"] = 0, ["imageSlots"] = 384, ["imageSlotsInUsePeak"] = 0,
                },
                ["streaming"] = new Dictionary<string, object>
                {
                    ["hitchThresholdMs"] = HitchThresholdMs, ["hitches"] = 0, ["worstMs"] = 0, ["worst"] = null,
                    ["imagesFromDisk"] = 0, ["imagesFromNetwork"] = 0, ["imagesFailed"] = 0, ["imageUploads"] = 0, ["evictions"] = 0,
                },
                ["path"] = new Dictionary<string, object>
                {
                    ["radialPathId"] = null, ["radialMetres"] = 0, ["ringMetres"] = 0, ["siteCard"] = null, ["travelCard"] = null,
                },
                ["captures"] = captures,
            };
        }
    }
}
