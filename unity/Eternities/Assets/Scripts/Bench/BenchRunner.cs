using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
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
    // Day 1 of the slice has the skeleton: the world loads, the run stands at the arrival point and
    // measures, and capture 3 is taken. The other steps of the path come with what they exercise.
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
            public bool Hub;
            public FrameSeries Frames = new FrameSeries(1 << 16);
            public float Metres;
        }

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

            yield return Step("load", 120, () => App.Instance != null && (App.Instance.WorldReady || App.Instance.Failure != null));
            if (failure == null && App.Instance.Failure != null)
            {
                failure = $"the world did not load: {App.Instance.Failure}";
            }
            if (failure == null)
            {
                // Step 3 of the path: stand at the arrival point, facing north.
                Begin("arrival", hub: false);
                excludeUntil = Now + AfterArrival;
                yield return Wait(3);
                yield return Capture(3, "checkpoint-3-arrival.png");
                yield return Wait(2);
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
                (segment.Hub ? hub : dominaria).Add(milliseconds, at, segment.Id);
            }
        }

        void Begin(string id, bool hub)
        {
            segment = new Segment { Id = id, Hub = hub };
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
            App app = App.Instance;
            WorldData world = app != null ? app.World : null;
            Resolution display = Screen.currentResolution;
            int width = target != null ? target.width : Screen.width, height = target != null ? target.height : Screen.height;
            var segmentList = new List<object>();
            foreach (Segment s in segments)
            {
                Dictionary<string, object> entry = s.Frames.ToJson();
                var ordered = new Dictionary<string, object> { ["id"] = s.Id, ["seconds"] = entry["seconds"], ["metres"] = s.Metres };
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
                    ["packHash"] = world?.Pack.Hash,
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
                ["world"] = new Dictionary<string, object>
                {
                    ["slug"] = world?.Plane.Slug, ["stands"] = world?.Layout.Stands.Count ?? 0, ["sites"] = world?.Layout.Sites.Count ?? 0,
                    ["diameterMm"] = 2 * (world?.Layout.WorldRadius ?? 0),
                },
                ["frames"] = new Dictionary<string, object>
                {
                    ["dominaria"] = Block(dominaria), ["hub"] = Block(hub),
                    ["excluded"] = new Dictionary<string, object> { ["afterPortal"] = excludedAfterPortal, ["capture"] = excludedCapture },
                },
                ["segments"] = segmentList,
                ["timings"] = new Dictionary<string, object>
                {
                    ["hubReadyMs"] = null, ["portalToWorldReadyMs"] = null, ["holdMs"] = null, ["cardViewEnterMs"] = null, ["cardViewLeaveMs"] = null,
                    ["travelMenuToCardViewMs"] = null, ["portalOutMs"] = null,
                },
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
