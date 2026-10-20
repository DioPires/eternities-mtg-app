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
    // Three pictures after them show what pull request 2 added (DEC-1005): `hud`, the place line
    // and the region's sentence at the first era site; `rims`, the plinths' rims from beside a
    // cluster; and `map`, the map open there. The first and the last lay the overlays over the
    // frame, as the bench's captures do.
    public static class WorldPictures
    {
        const string Key = "Eternities.WorldPictures";
        const float Eye = 1.6f;
        // Frames a view is held before its picture: the exposure settles, and the props about the
        // walker are made.
        const int Settle = 90;

        static IEnumerator steps;
        static readonly Stack<IEnumerator> running = new Stack<IEnumerator>();

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
                // A step that yields an enumerator runs it to its end before it goes on.
                IEnumerator current = running.Count > 0 ? running.Peek() : steps;
                if (current.MoveNext())
                {
                    if (current.Current is IEnumerator inner)
                    {
                        running.Push(inner);
                    }
                }
                else if (running.Count > 0)
                {
                    running.Pop();
                }
                else
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
            // With no screen the overlays have nowhere to be drawn: they go into a texture of their
            // own, which the pictures of the HUD and the map lay over the frame.
            var overlays = new RenderTexture(width, height, 24, GraphicsFormat.R8G8B8A8_SRGB);
            UnityEngine.UIElements.PanelSettings panel = app.Hud.Settings;
            bool clearColour = panel.clearColor;
            Color clearValue = panel.colorClearValue;
            panel.targetTexture = overlays;
            panel.clearColor = true;
            panel.colorClearValue = new Color(0, 0, 0, 0);

            // One picture: the avatar at `at` facing `toward`, the camera at `eye` looking along
            // `look`, held `Settle` frames; `before` runs a few frames before the picture.
            IEnumerator Shoot(string name, Vector2 at, Vector2 toward, Vector3 eye, Vector3 look, bool withOverlays, Action before = null)
            {
                float ground = Mathf.Max(app.Dress.HeightAt(at.x, at.y), DressPlan.WaterLevel);
                app.Avatar.Place(new Vector3(at.x, ground, at.y), Quaternion.LookRotation(new Vector3(toward.x, 0, toward.y)));
                camera.transform.SetPositionAndRotation(eye, Quaternion.LookRotation(look));
                for (int frame = 0; frame < Settle; frame++)
                {
                    if (frame == Settle - 8)
                    {
                        before?.Invoke();
                    }
                    yield return null;
                }
                RenderTexture source = target, laid = null;
                if (withOverlays)
                {
                    laid = RenderTexture.GetTemporary(width, height, 0, GraphicsFormat.R8G8B8A8_SRGB);
                    Graphics.Blit(target, laid);
                    app.Exhibit.Over(overlays, laid, flip: false);
                    source = laid;
                }
                AsyncGPUReadbackRequest request = AsyncGPUReadback.Request(source, 0, GraphicsFormat.R8G8B8A8_SRGB);
                while (!request.done)
                {
                    yield return null;
                }
                if (laid != null)
                {
                    RenderTexture.ReleaseTemporary(laid);
                }
                string file = $"world-{name}-{quality}.png";
                using (NativeArray<byte> png = ImageConversion.EncodeNativeArrayToPNG(request.GetData<byte>(), GraphicsFormat.R8G8B8A8_SRGB, (uint)width, (uint)height))
                {
                    File.WriteAllBytes(Path.Combine(output, file), png.ToArray());
                }
                RegionDress region = app.Dress.RegionAt(at.x, at.y);
                log.Add($"{file}: at {at.x:F1}, {at.y:F1}, looking {Mathf.Atan2(look.x, look.z) * Mathf.Rad2Deg:F0} degrees from north, in {region.Id} ({region.Variant.Name}); {app.Props.Drawn} props drawn"
                    + (withOverlays ? $"; the line reads \"{app.Hud.PlaceText}\"" : ""));
                Debug.Log($"WorldPictures: {log[log.Count - 1]}");
            }

            foreach ((string name, Vector2 at, Vector2 toward) in Views(app.Dress).Concat(Aerials(app.Dress)).Where(view => view.Name.StartsWith(only, StringComparison.Ordinal)))
            {
                // The avatar stands there too, so the props about the walker are the place's. An
                // aerial view is 70 m over its place, looking down at 35 degrees.
                bool aerial = name.StartsWith("aerial", StringComparison.Ordinal);
                float ground = Mathf.Max(app.Dress.HeightAt(at.x, at.y), DressPlan.WaterLevel);
                yield return Shoot(name, at, toward, new Vector3(at.x, ground + (aerial ? 70 : Eye), at.y), new Vector3(toward.x, aerial ? -0.7f : -0.06f, toward.y), withOverlays: false);
            }

            // Pull request 2's: the place line at the first era site's pad, with the region's
            // sentence shown again just before the picture (it shows for 4 s after the crossing,
            // and a view is held longer); the rims from 2.5 m in front of that site's tenth stand,
            // looking down at its plinth's top; and the map, open at the pad.
            WorldDocument layout = app.World.Layout;
            int site = Array.FindIndex(layout.Sites, row => row.Kind == "era");
            site = Math.Max(site, 0);
            Vector2 pad = DressPlan.Metres(layout.Sites[site].Pad.Position), along = DressPlan.Metres(layout.Sites[site].Path[Mathf.Min(8, layout.Sites[site].Path.Length - 1)]) - pad;
            along = along.sqrMagnitude > 0 ? along.normalized : Vector2.up;
            float padGround = Mathf.Max(app.Dress.HeightAt(pad.x, pad.y), DressPlan.WaterLevel);
            Vector3 padEye = new Vector3(pad.x, padGround + Eye, pad.y), padLook = new Vector3(along.x, -0.06f, along.y);
            if ("hud".StartsWith(only, StringComparison.Ordinal))
            {
                yield return Shoot("hud", pad, along, padEye, padLook, withOverlays: true,
                    before: () => app.Hud.Sentence(Whereabouts.Sentence(app.World, app.ShownRegion)));
            }
            int stand = Enumerable.Range(0, app.World.StandCount).Where(index => app.World.Site(index) == site).Skip(9).DefaultIfEmpty(0).First();
            if ("rims".StartsWith(only, StringComparison.Ordinal))
            {
                Vector3 plinth = StandField.Ground(app.World.Position(stand));
                Vector3 front = StandField.Facing(app.World, stand) * Vector3.forward;
                Vector3 eye = plinth + front * 2.5f + Vector3.up * 1.9f + Vector3.Cross(Vector3.up, front) * 1.2f;
                Vector2 at = new Vector2(eye.x, eye.z);
                Vector3 look = plinth + Vector3.up * StandField.PlinthHeight - eye;
                yield return Shoot("rims", at, new Vector2(-front.x, -front.z), eye, look, withOverlays: false);
            }
            if ("map".StartsWith(only, StringComparison.Ordinal))
            {
                app.Hud.ShowMap(app.Map, app.TravelToSite);
                yield return Shoot("map", pad, along, padEye, padLook, withOverlays: true,
                    before: () => app.Hud.Map.Walker(pad, Mathf.Atan2(along.x, along.y) * Mathf.Rad2Deg));
                app.Hud.HideMap();
            }

            // Pull request 3's (DEC-1005): a reading stone, a waystone and a chapter stone from a
            // walker's eye 3 m in front of each, and the reading stone's face from 1.4 m; the
            // reading overlay and a waystone's travel open, with the time from the use to the
            // text; and the travel menu's two sections.
            int Find(string kind) => app.Stones.All.FindIndex(stone => stone.Kind == kind);
            foreach ((string name, int index, float back) in new[]
            {
                ("stone-reading", Find(Reading.ReadingStone), 3f), ("stone-reading-face", Find(Reading.ReadingStone), 1.4f),
                ("stone-way", Find(Reading.Waystone), 3f), ("stone-chapter", Find(StoneField.Chapter), 3f),
            })
            {
                if (index < 0 || !name.StartsWith(only, StringComparison.Ordinal))
                {
                    continue;
                }
                StoneField.Stone stone = app.Stones.All[index];
                Vector3 front = stone.Facing * Vector3.forward;
                Vector3 eye = stone.Foot + front * back + Vector3.up * Eye;
                Vector3 look = stone.Foot + Vector3.up * Mathf.Min(stone.Height * 0.62f, Eye) - eye;
                yield return Shoot(name, new Vector2(eye.x, eye.z), new Vector2(-front.x, -front.z), eye, look, withOverlays: false);
            }
            foreach ((string name, int index) in new[] { ("reading", Find(Reading.ReadingStone)), ("waystone", Find(Reading.Waystone)) })
            {
                if (index < 0 || !name.StartsWith(only, StringComparison.Ordinal))
                {
                    continue;
                }
                StoneField.Stone stone = app.Stones.All[index];
                Vector3 front = stone.Facing * Vector3.forward;
                Vector3 eye = stone.Foot + front * 2.2f + Vector3.up * Eye;
                Vector3 look = stone.Foot + Vector3.up * 1.2f - eye;
                yield return Shoot(name, new Vector2(eye.x, eye.z), new Vector2(-front.x, -front.z), eye, look, withOverlays: true, before: () => app.Use(index));
                if (name == "reading")
                {
                    log.Add($"the reading overlay's text was laid out {app.LastStoneTextSeconds * 1000:F1} ms after the use, in the editor at {quality}");
                    Debug.Log($"WorldPictures: {log[log.Count - 1]}");
                }
                app.Hud.HideStone();
            }
            if ("travel".StartsWith(only, StringComparison.Ordinal))
            {
                app.OpenTravelMenu();
                yield return Shoot("travel-trail", pad, along, padEye, padLook, withOverlays: true);
                yield return Shoot("travel-regions", pad, along, padEye, padLook, withOverlays: true,
                    before: () => app.Hud.TravelList.scrollOffset = new Vector2(0, float.MaxValue));
                app.Hud.HideTravel();
            }

            panel.targetTexture = null;
            panel.clearColor = clearColour;
            panel.colorClearValue = clearValue;
            overlays.Release();
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
