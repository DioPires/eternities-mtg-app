using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using Eternities.Travel;
using Unity.Collections;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

namespace Eternities.EditorTools
{
    // Pictures of a dressed world (PRD v4 9.6, leg 2), for the owner's eye and a reviewer's: the
    // world loaded as a visitor enters it, and seen from a walker's eye at the places a walk meets
    // what the dressing made: the arrival, each region from its trail, each ford, the lake, the sea,
    // the lava, a site's path and a wood. Nothing is saved but the pictures and a line a picture in
    // `pictures.txt`. No `-quit`: the editor exits by itself after the last picture.
    //
    //   batchmode.sh -executeMethod Eternities.EditorTools.WorldPictures.Run -picturesOut <dir> [-picturesQuality medium] [-picturesSize 1920x1080] [-picturesOnly <name prefix>]
    //
    // The pictures are the main camera's, with the exhibit pass (the cards) and without the HUD.
    public static class WorldPictures
    {
        const string Key = "Eternities.WorldPictures";
        const float Eye = 1.6f;
        // Frames a view is held before its picture: the exposure settles, and the props about the
        // walker are made.
        const int Settle = 90;

        static IEnumerator steps;

        public static void Run()
        {
            string output = CommandLine.Require("-picturesOut");
            string quality = CommandLine.Optional("-picturesQuality") ?? "medium";
            string size = CommandLine.Optional("-picturesSize") ?? "1920x1080";
            Directory.CreateDirectory(output);
            Generate.Everything(CommandLine.Optional("-packHash") ?? Generate.ManifestHash());
            int level = Array.IndexOf(QualitySettings.names, quality);
            if (level < 0)
            {
                throw new InvalidDataException($"no quality level is named {quality}");
            }
            QualitySettings.SetQualityLevel(level, true);
            EditorSceneManager.OpenScene(Generate.HubScene, OpenSceneMode.Single);
            string[] wide = size.Split('x');
            steps = Pictures(output, quality, int.Parse(wide[0]), int.Parse(wide[1]), CommandLine.Optional("-picturesOnly") ?? "");
            EditorApplication.update += Step;
            EditorApplication.EnterPlaymode();
        }

        static void Step()
        {
            try
            {
                if (!EditorApplication.isPlaying)
                {
                    return;
                }
                if (!steps.MoveNext())
                {
                    EditorApplication.update -= Step;
                    EditorApplication.Exit(0);
                }
            }
            catch (Exception failure)
            {
                Debug.LogException(failure);
                EditorApplication.Exit(1);
            }
        }

        // One step an editor frame while the game plays.
        static IEnumerator Pictures(string output, string quality, int width, int height, string only)
        {
            double started = EditorApplication.timeSinceStartup;
            while (App.Instance == null || !App.Instance.HubReady)
            {
                if (EditorApplication.timeSinceStartup - started > 120)
                {
                    throw new TimeoutException("the hub was not ready in 120 s");
                }
                yield return null;
            }
            App app = App.Instance;
            if (app.Failure != null)
            {
                throw new InvalidOperationException(app.Failure);
            }
            double entering = EditorApplication.timeSinceStartup;
            app.EnterWorld();
            while (!app.WorldReady)
            {
                if (app.Failure != null)
                {
                    throw new InvalidOperationException(app.Failure);
                }
                if (EditorApplication.timeSinceStartup - entering > 180)
                {
                    throw new TimeoutException("the world was not ready in 180 s");
                }
                yield return null;
            }
            var log = new List<string> { $"world ready {EditorApplication.timeSinceStartup - entering:F1} s after the step into the portal; quality {quality}" };

            Camera camera = Camera.main;
            var brain = camera.GetComponent("CinemachineBrain") as Behaviour;
            if (brain != null)
            {
                brain.enabled = false;
            }
            app.Avatar.Shown = false;
            var target = new RenderTexture(width, height, 24, GraphicsFormat.R8G8B8A8_SRGB);
            camera.targetTexture = target;

            foreach ((string name, Vector2 at, Vector2 toward) in Views(app.Dress).Concat(Aerials(app.Dress)).Where(view => view.Name.StartsWith(only, StringComparison.Ordinal)))
            {
                // The avatar stands there too, so the props about the walker are the place's. An
                // aerial view is 70 m over its place, looking down at 35 degrees.
                bool aerial = name.StartsWith("aerial", StringComparison.Ordinal);
                float ground = Mathf.Max(app.Dress.HeightAt(at.x, at.y), DressPlan.WaterLevel);
                app.Avatar.Place(new Vector3(at.x, ground, at.y), Quaternion.LookRotation(new Vector3(toward.x, 0, toward.y)));
                Vector3 eye = new Vector3(at.x, ground + (aerial ? 70 : Eye), at.y);
                camera.transform.SetPositionAndRotation(eye, Quaternion.LookRotation(new Vector3(toward.x, aerial ? -0.7f : -0.06f, toward.y)));
                for (int frame = 0; frame < Settle; frame++)
                {
                    yield return null;
                }
                AsyncGPUReadbackRequest request = AsyncGPUReadback.Request(target, 0, GraphicsFormat.R8G8B8A8_SRGB);
                while (!request.done)
                {
                    yield return null;
                }
                string file = $"world-{name}-{quality}.png";
                using (NativeArray<byte> png = ImageConversion.EncodeNativeArrayToPNG(request.GetData<byte>(), GraphicsFormat.R8G8B8A8_SRGB, (uint)width, (uint)height))
                {
                    File.WriteAllBytes(Path.Combine(output, file), png.ToArray());
                }
                RegionDress region = app.Dress.RegionAt(at.x, at.y);
                log.Add($"{file}: at {at.x:F1}, {at.y:F1}, looking {Mathf.Atan2(toward.x, toward.y) * Mathf.Rad2Deg:F0} degrees from north, in {region.Id} ({region.Variant.Name}); {app.Props.Drawn} props drawn");
                Debug.Log($"WorldPictures: {log[log.Count - 1]}");
            }
            camera.targetTexture = null;
            target.Release();
            File.WriteAllLines(Path.Combine(output, "pictures.txt"), log);
            EditorApplication.ExitPlaymode();
        }

        // From above (`aerial`): each body of water, 100 m back from it on the side of the origin.
        static IEnumerable<(string Name, Vector2 At, Vector2 Toward)> Aerials(DressPlan plan)
        {
            var seen = new HashSet<string>();
            foreach (WaterBody body in plan.Water)
            {
                string name = $"aerial-{body.Kind}-{plan.Regions[body.Region].Id}";
                if (!seen.Add(name))
                {
                    continue;
                }
                Vector2 at;
                if (body.Kind == WaterBody.Sea)
                {
                    int wet = -1;
                    float nearest = float.MaxValue;
                    for (int i = 0; i < plan.Grid.Count; i += 7)
                    {
                        float x = plan.Grid.X(i % plan.N), z = plan.Grid.Z(i / plan.N);
                        if (plan.Wet[i] == DressPlan.WetSea && plan.Region[i] == body.Region && x * x + z * z < nearest)
                        {
                            nearest = x * x + z * z;
                            wet = i;
                        }
                    }
                    if (wet < 0)
                    {
                        continue;
                    }
                    at = new Vector2(plan.Grid.X(wet % plan.N), plan.Grid.Z(wet / plan.N));
                }
                else
                {
                    at = body.Line.Count > 1 ? body.Line[body.Line.Count / 2] : body.Centre;
                }
                Vector2 toward = at.sqrMagnitude > 1 ? at.normalized : Vector2.up;
                yield return (name, at - toward * 100, toward);
            }
            foreach (Ford ford in plan.Fords.Take(1))
            {
                yield return ("aerial-ford", ford.At - ford.Along * 80, ford.Along);
            }
            for (int r = 0; r < plan.Regions.Length; r++)
            {
                if (plan.Regions[r].Water == WaterBody.Marsh)
                {
                    Vector2 middle = plan.Layout.Regions[r].Cell.Select(DressPlan.Metres).Aggregate(Vector2.zero, (sum, p) => sum + p) / plan.Layout.Regions[r].Cell.Length;
                    yield return ($"aerial-marsh-{plan.Regions[r].Id}", middle, middle.sqrMagnitude > 1 ? -middle.normalized : Vector2.up);
                }
            }
        }

        // Where the pictures are taken from, and which way they look, from the world's pack and plan.
        static IEnumerable<(string Name, Vector2 At, Vector2 Toward)> Views(DressPlan plan)
        {
            WorldDocument layout = plan.Layout;
            yield return ("arrival", Vector2.zero, Vector2.up);

            // Each region from the trail where it runs nearest the region's middle, looking along it.
            var trail = layout.Legs.SelectMany(leg => leg.Polyline.Select(DressPlan.Metres)).ToList();
            for (int r = 0; r < plan.Regions.Length; r++)
            {
                Vector2 middle = layout.Regions[r].Cell.Select(DressPlan.Metres).Aggregate(Vector2.zero, (sum, p) => sum + p) / layout.Regions[r].Cell.Length;
                int best = -1;
                for (int i = 0; i + 1 < trail.Count; i++)
                {
                    if (plan.RegionAt(trail[i].x, trail[i].y) == plan.Regions[r] && (best < 0 || (trail[i] - middle).sqrMagnitude < (trail[best] - middle).sqrMagnitude))
                    {
                        best = i;
                    }
                }
                if (best >= 0)
                {
                    int ahead = Mathf.Min(best + 20, trail.Count - 1);
                    yield return ($"region-{plan.Regions[r].Id}", trail[best], (trail[ahead] - trail[best]).normalized);
                }
            }

            // Each ford, from the trail a few metres before it.
            int index = 0;
            foreach (Ford ford in plan.Fords)
            {
                int nearest = 0;
                for (int i = 0; i < trail.Count; i++)
                {
                    if ((trail[i] - ford.At).sqrMagnitude < (trail[nearest] - ford.At).sqrMagnitude)
                    {
                        nearest = i;
                    }
                }
                Vector2 from = trail[Mathf.Max(0, nearest - 30)];
                yield return ($"ford-{index++}", from, (ford.At - from).normalized);
            }

            // The lake and the lava from their shores; the sea from the land nearest it.
            foreach (WaterBody body in plan.Water)
            {
                if (body.Kind == WaterBody.Lake)
                {
                    Vector2 shore = body.Centre + Vector2.left * (body.Radius * 1.25f + 6);
                    yield return ($"lake-{plan.Regions[body.Region].Id}", shore, (body.Centre - shore).normalized);
                }
                else if (body.Kind == WaterBody.Lava && body.Line.Count > 1)
                {
                    Vector2 middle = body.Line[body.Line.Count / 2], across = Vector2.Perpendicular(body.Line[body.Line.Count / 2 + 1] - middle).normalized;
                    Vector2 bank = middle + across * (body.HalfWidth + DressPlan.LavaBank + 4);
                    yield return ($"lava-{plan.Regions[body.Region].Id}", bank, -across);
                }
                else if (body.Kind == WaterBody.River && body.Line.Count > 1)
                {
                    Vector2 middle = body.Line[body.Line.Count / 3], across = Vector2.Perpendicular(body.Line[body.Line.Count / 3 + 1] - middle).normalized;
                    Vector2 bank = middle + across * (body.HalfWidth + DressPlan.RiverBank + 6);
                    yield return ($"river-{plan.Regions[body.Region].Id}", bank, -across);
                }
            }
            for (int r = 0; r < plan.Regions.Length; r++)
            {
                if (plan.Regions[r].Water != WaterBody.Sea)
                {
                    continue;
                }
                int wet = -1;
                float nearest = float.MaxValue;
                for (int i = 0; i < plan.Grid.Count; i += 7)
                {
                    float x = plan.Grid.X(i % plan.N), z = plan.Grid.Z(i / plan.N);
                    if (plan.Wet[i] == DressPlan.WetSea && plan.Region[i] == r && x * x + z * z < nearest)
                    {
                        nearest = x * x + z * z;
                        wet = i;
                    }
                }
                if (wet >= 0)
                {
                    var water = new Vector2(plan.Grid.X(wet % plan.N), plan.Grid.Z(wet / plan.N));
                    Vector2 land = water * (1 - 40 / water.magnitude);
                    yield return ($"sea-{plan.Regions[r].Id}", land, (water - land).normalized);
                }
            }

            // The first era site from its pad along its path, and a wood's site from inside it.
            WorldSite first = layout.Sites.FirstOrDefault(site => site.Kind == "era") ?? layout.Sites[0];
            Vector2 pad = DressPlan.Metres(first.Pad.Position), head = DressPlan.Metres(first.Path[Mathf.Min(8, first.Path.Length - 1)]);
            yield return ("site-path", pad, (head - pad).normalized);
            WorldSite wooded = layout.Sites.FirstOrDefault(site => plan.RegionAt(site.Centre.X / 1000f, site.Centre.Z / 1000f).Variant.Name == "wood");
            if (wooded != null)
            {
                Vector2 inside = DressPlan.Metres(wooded.Path[wooded.Path.Length / 2]), next = DressPlan.Metres(wooded.Path[wooded.Path.Length / 2 + 6]);
                yield return ("wood-site", inside, (next - inside).normalized);
            }
        }
    }
}
