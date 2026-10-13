using System;
using System.Collections;
using System.IO;
using Eternities.Avatar;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using Eternities.Travel;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering.HighDefinition;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Eternities.Tests
{
    public class WorldTests
    {
        readonly ScriptedInputSource hands = new ScriptedInputSource();

        // CI checks out clean, so the world's files are made here the way the generation entry
        // point makes them: from the repository's copy of the pinned pack.
        [OneTimeSetUp]
        public void MakeTheWorldsFiles()
        {
            string target = App.PackDirectory();
            string source = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", Path.GetFileName(target)));
            WorldFiles.Generate(source, target, App.HomeWorld);
            App.ImageSourceForTests = () => new NoImages();
        }

        [OneTimeTearDown]
        public void LeaveTheSourceAlone()
        {
            App.ImageSourceForTests = null;
        }

        // `OneSlowStep` sets the length of a frame, and a test that fails there leaves it set.
        [TearDown]
        public void GiveTheClockBack()
        {
            Time.captureDeltaTime = 0;
        }

        // These tests are about the world, not its images: every stand stays its swatch.
        public sealed class NoImages : Eternities.CardView.IImageSource
        {
            public void Request(string url, float distance, Action<Texture2D> done) => done(null);

            public void Cancel(string url)
            {
            }

            public bool Failing(string url) => false;
        }

        static IEnumerator Until(Func<bool> done, float seconds, string what)
        {
            float until = Time.realtimeSinceStartup + seconds;
            while (!done())
            {
                Assert.That(App.Instance == null ? null : App.Instance.Failure, Is.Null);
                Assert.That(Time.realtimeSinceStartup, Is.LessThan(until), $"{what} did not happen in {seconds} s{Where()}");
                yield return null;
            }
        }

        static string Where()
        {
            App app = App.Instance;
            return app == null || app.Avatar == null ? "" : $"; the avatar is at {app.Avatar.transform.position} in the {app.Place}, walking at {app.Avatar.Speed} m/s (frame {Time.frameCount}, step {Time.deltaTime} s)";
        }

        // The hub, with the avatar's input in the test's hands.
        IEnumerator Hub()
        {
            yield return SceneManager.LoadSceneAsync("Assets/Scenes/Hub.unity", LoadSceneMode.Single);
            yield return Until(() => App.Instance != null && App.Instance.HubReady, 30, "the hub");
            App.Instance.Avatar.Source = hands;
            hands.WorldMove = Vector3.zero;
            hands.Run = false;
        }

        void TowardThePortal()
        {
            App app = App.Instance;
            Vector3 toPortal = app.HubPortal.transform.position - app.Avatar.transform.position;
            toPortal.y = 0;
            hands.WorldMove = toPortal.normalized;
            hands.Run = true;
        }

        // PRD v4 5.3.2 and 5.8.5: the visitor arrives in the hub facing the home plane's portal,
        // which stands on the ring of 56 m; Dominaria's is the first, at north.
        [UnityTest]
        public IEnumerator TheHubHasDominariasPortalAtNorth()
        {
            yield return Hub();
            App app = App.Instance;
            Assert.That(app.Place, Is.EqualTo(Place.Hub));
            Assert.That(App.PortalAngle(app.Pack, "dominaria"), Is.EqualTo(0));
            Assert.That(App.PortalAngle(app.Pack, "rabiah"), Is.EqualTo(360f / 88).Within(1e-4f));
            Vector3 toPortal = app.HubPortal.transform.position - app.Avatar.transform.position;
            Assert.That(new Vector2(toPortal.x, toPortal.z).magnitude, Is.EqualTo(56).Within(0.01f));
            Assert.That(Vector3.Angle(app.Avatar.transform.forward, toPortal), Is.LessThan(1));
            Assert.That(app.WorldLoaded, Is.False, "no world loads until the avatar nears a portal's pad");
        }

        // How high the sun stands, in degrees above the horizon.
        static float Elevation(Light sun) => 90 - Vector3.Angle(-sun.transform.forward, Vector3.up);

        // PRD v4 8.8.3: a world loads and places the pack's stands. And PRD v4 5.9: the portal leads
        // there, the walk is at the avatar's speed, and Esc leads back and unloads the world.
        [UnityTest]
        public IEnumerator ThePortalLeadsToDominariaAndBack()
        {
            yield return Hub();
            App app = App.Instance;
            TowardThePortal();
            float started = Time.realtimeSinceStartup;
            yield return Until(() => app.InTransition, 30, "the step into the portal");
            // 50 m to the ring's opening at the running speed of 6 m/s.
            Assert.That(Time.realtimeSinceStartup - started, Is.InRange(8f, 11f));
            Assert.That(app.Avatar.Locked, "input is locked through a transition");
            yield return Until(() => app.WorldReady, 60, "the arrival");
            hands.WorldMove = Vector3.zero;

            Assert.That(app.Place, Is.EqualTo(Place.World));
            Assert.That(app.LastTravelSeconds, Is.GreaterThanOrEqualTo(App.TransitionSeconds));
            Assert.That(app.Stands.Stands, Is.EqualTo(6271));
            Assert.That(app.Stands.Sites, Is.EqualTo(233));
            Assert.That(app.Ground.terrainData.heightmapResolution, Is.EqualTo(2049));
            // Dominaria's sun (PRD v4 Appendix C): 35 degrees up, warm, and to the visitor's left.
            Assert.That(Elevation(app.Sun), Is.EqualTo(35).Within(0.01f));
            Assert.That(app.Sun.colorTemperature, Is.LessThan(5600), "a warm sun");
            Assert.That(Vector3.Dot(-app.Sun.transform.forward, Vector3.left), Is.GreaterThan(0.5f), "the sun stands to the west");
            // The ground wears the kit's three textures, not the plain colours that stand in for them,
            // and the world's tones as a fourth layer (PRD v4 5.6.3).
            Assert.That(System.Array.ConvertAll(app.Ground.terrainData.terrainLayers, layer => layer.diffuseTexture.name),
                Is.EqualTo(new[] { "leafy_grass_diff_2k", "dirt_floor_diff_2k", "ganges_river_pebbles_diff_2k", "ground tones" }));
            Assert.That(app.Ground.terrainData.size.x, Is.GreaterThanOrEqualTo(2 * app.World.Layout.WorldRadius / 1000f));
            // The arrival point, facing north, on the ground.
            yield return new WaitForFixedUpdate();
            yield return null;
            Assert.That(app.Avatar.transform.position.magnitude, Is.LessThan(0.3f));
            Assert.That(Vector3.Angle(app.Avatar.transform.forward, Vector3.forward), Is.LessThan(1));

            // A stand is where its layout says: straight down onto it is the top of its slab, and a
            // step in front of it, on its apron, is the ground.
            LayoutStand stand = app.World.Layout.Stands[0];
            Vector3 at = StandField.Ground(stand.Position);
            Assert.That(Physics.Raycast(at + 10 * Vector3.up, Vector3.down, out RaycastHit hit, 20));
            Assert.That(hit.point.y, Is.EqualTo(StandField.SlabTop).Within(0.005f));
            Vector3 apron = at + StandField.Facing(stand) * Vector3.forward;
            Assert.That(Physics.Raycast(apron + 10 * Vector3.up, Vector3.down, out hit, 20));
            Assert.That(hit.point.y, Is.EqualTo(0).Within(0.01f));

            // The paths are visible as ground (PRD v4 9.5): the plaza is the path layer, and the
            // meadow begins behind a stand.
            float[,,] plaza = app.Ground.terrainData.GetAlphamaps(app.Ground.terrainData.alphamapResolution / 2, app.Ground.terrainData.alphamapResolution / 2, 1, 1);
            Assert.That(plaza[0, 0, GroundPlan.Path], Is.EqualTo(1));
            Vector3 behind = at - StandField.Facing(stand) * Vector3.forward * 0.8f - app.Ground.transform.position;
            Vector3 size = app.Ground.terrainData.size;
            int n = app.Ground.terrainData.alphamapResolution;
            float[,,] meadow = app.Ground.terrainData.GetAlphamaps((int)(behind.x / size.x * n), (int)(behind.z / size.z * n), 1, 1);
            // Between the paths the ground is its wedge's tone for a share and the meadow for the rest (PRD v4 5.6.3).
            Assert.That(meadow[0, 0, GroundPlan.Path], Is.EqualTo(0));
            Assert.That(meadow[0, 0, GroundPlan.Tone], Is.EqualTo(GroundPlan.ToneShare).Within(0.01f));

            // PRD v4 8.4.2: the kit's props are in the world, each of them an object of its kind's
            // mesh on the ground, and a tree stops what walks into its trunk.
            Assert.That(app.Props.Count, Is.EqualTo(app.PropPlan.Props.Count));
            Assert.That(app.Props.Count, Is.GreaterThan(3000));
            Assert.That(app.Props.transform.childCount, Is.EqualTo(app.Props.Count));
            int oak = app.PropPlan.Props.FindIndex(prop => prop.Kind == Temperate.Oak);
            Transform tree = app.Props.transform.GetChild(oak);
            Assert.That(tree.GetComponent<MeshFilter>().sharedMesh.name, Is.EqualTo("tree_oak"));
            Assert.That(tree.GetComponent<MeshRenderer>().sharedMaterials, Has.All.Not.Null);
            Assert.That(tree.GetComponent<CapsuleCollider>(), Is.Not.Null);
            RaycastHit[] met = Physics.RaycastAll(tree.position + new Vector3(2, 1.5f, 0), Vector3.left, 2);
            Assert.That(Array.Exists(met, at => at.collider.transform == tree), "a ray at chest height meets the trunk");

            // PRD v4 9.5: one river and one lake of the HDRP water system, over the bed the ground
            // carries, when water is on in the HDRP asset in force; nothing while it is off.
            Assert.That(app.Water != null, Is.EqualTo(WorldWater.Supported));
            if (app.Water != null)
            {
                var surfaces = app.Water.GetComponentsInChildren<UnityEngine.Rendering.HighDefinition.WaterSurface>();
                Assert.That(surfaces.Length, Is.EqualTo(2));
                foreach (var surface in surfaces)
                {
                    Assert.That(surface.transform.position.y, Is.EqualTo(GroundPlan.WaterLevel).Within(1e-4f));
                    Assert.That(app.GroundPlan.HeightAt(surface.transform.position.x, surface.transform.position.z), Is.LessThan(GroundPlan.WaterLevel), "the bed under the middle of the water is below it");
                }
            }

            // PRD v4 5.12: one ambient bed, and the river as a positional source that is heard before
            // it is seen. From the plaza it is silent; at the rim it is at the water, north of the
            // avatar, and within earshot.
            Assert.That(app.Sound.Bed.clip, Is.Not.Null);
            Assert.That(app.Sound.Bed.spatialBlend, Is.EqualTo(0));
            Assert.That(app.Sound.River.clip, Is.Not.Null);
            Assert.That(app.Sound.River.spatialBlend, Is.EqualTo(1));
            float rim = app.World.Layout.WorldRadius / 1000f;
            Assert.That(Vector3.Distance(app.Sound.NearestOnRiver(Vector3.zero), Vector3.zero), Is.GreaterThan(Eternities.Audio.WorldSound.RiverFar), "the river is out of earshot of the plaza");
            Vector3 atTheRim = new Vector3(0, 0, rim);
            Vector3 nearest = app.Sound.NearestOnRiver(atTheRim);
            Assert.That(nearest.z, Is.GreaterThan(rim));
            Assert.That(Vector3.Distance(nearest, atTheRim), Is.LessThan(Eternities.Audio.WorldSound.RiverFar / 4), "at the rim the river is close");
            Assert.That(Vector3.Distance(app.Sound.NearestOnRiver(new Vector3(0, 0, rim - 100)), new Vector3(0, 0, rim - 100)), Is.LessThan(Eternities.Audio.WorldSound.RiverFar), "100 m short of the rim it is already heard");

            Texture2DArray images = app.Images.Array;
            Assert.That(images.depth, Is.EqualTo(Eternities.CardView.StandImages.Slots));
            hands.Back = true;
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 30, "the return to the hub");
            Assert.That(app.World, Is.Null);
            Assert.That(app.WorldLoaded, Is.False);
            Assert.That(Vector3.Distance(app.Avatar.transform.position, app.HubPortal.Pad), Is.LessThan(0.5f));
            Assert.That(Elevation(app.Sun), Is.EqualTo(45).Within(0.01f), "the hub has the scene's own sun again");
            Assert.That(app.Sun.colorTemperature, Is.EqualTo(6500));

            // The stands' image array is the application's, made once with the hub (DEC-953): made
            // at each load, its 170 MB stopped a frame for 60 ms. The world that leaves does not
            // take it, and the world that comes next uses it, with no stand shown from a slot yet.
            Assert.That(images != null, "the image array outlives the world that used it");
            TowardThePortal();
            yield return Until(() => app.WorldReady, 60, "the second arrival");
            hands.WorldMove = Vector3.zero;
            Assert.That(app.Images.Array, Is.SameAs(images));
            Assert.That(app.Images.SlotsInUse, Is.EqualTo(0));
            Assert.That(app.Stands.Stands, Is.EqualTo(6271));
        }

        // A player starts at the level its command line names, and at the project's default, high,
        // where it names none: never at the level the last run left in the player's preferences
        // (DEC-953). `-quality` is a visitor's argument and `-benchQuality` the bench's.
        [Test]
        public void APlayerStartsAtTheLevelItsCommandLineNames()
        {
            string[] names = QualitySettings.names;
            Assert.That(names, Is.EqualTo(new[] { "high", "medium", "low" }));
            Assert.That(App.StartLevel(new[] { "Eternities" }, names), Is.EqualTo(0), "the default is the first level");
            Assert.That(App.StartLevel(new[] { "Eternities", "-quality", "medium" }, names), Is.EqualTo(1));
            Assert.That(App.StartLevel(new[] { "Eternities", "-quality", "high" }, names), Is.EqualTo(0));
            Assert.That(App.StartLevel(new[] { "Eternities", "-bench", "warm", "-benchQuality", "low", "-benchOut", "x.json" }, names), Is.EqualTo(2), "a bench run starts at the level it measures");
            Assert.That(App.StartLevel(new[] { "Eternities", "-benchQuality", "low", "-quality", "medium" }, names), Is.EqualTo(1), "the visitor's argument comes first");
            Assert.That(App.StartLevel(new[] { "Eternities", "-quality", "ultra" }, names), Is.EqualTo(0));
            Assert.That(App.StartLevel(new[] { "Eternities", "-quality" }, names), Is.EqualTo(0));
        }

        // PRD v4 9.5: the river is seen from the rim, where the north radial path ends: the frame
        // from there changes when the water is taken away, by more than it changes by itself.
        [UnityTest]
        public IEnumerator TheRiverIsSeenFromTheRim()
        {
            yield return Hub();
            App app = App.Instance;
            TowardThePortal();
            yield return Until(() => app.WorldReady, 60, "the arrival");
            hands.WorldMove = Vector3.zero;
            Assert.That(WorldWater.Supported, Is.True, "water is on in the HDRP asset of this quality level (PRD v4 8.1.1)");
            Assert.That(app.Water, Is.Not.Null);

            const int width = 1280, height = 720;
            var target = new RenderTexture(width, height, 24, UnityEngine.Experimental.Rendering.GraphicsFormat.R8G8B8A8_SRGB);
            Camera view = Camera.main;
            view.targetTexture = target;
            ((Behaviour)view.GetComponent("CinemachineBrain")).enabled = false;
            float rim = app.World.Layout.WorldRadius / 1000f;
            app.Avatar.Place(new Vector3(0, 0, rim - 6), Quaternion.identity);
            view.transform.SetPositionAndRotation(new Vector3(0, 1.6f, rim), Quaternion.Euler(8, 0, 0));

            Color32[] read = null;
            IEnumerator Read(double seconds)
            {
                double until = Time.realtimeSinceStartupAsDouble + seconds;
                for (int i = 0; i < 12 || Time.realtimeSinceStartupAsDouble < until; i++)
                {
                    yield return null;
                }
                var request = UnityEngine.Rendering.AsyncGPUReadback.Request(target, 0, UnityEngine.Experimental.Rendering.GraphicsFormat.R8G8B8A8_SRGB);
                yield return Until(() => request.done, 20, "the readback");
                read = request.GetData<Color32>().ToArray();
            }
            int Changed(Color32[] a, Color32[] b)
            {
                int count = 0;
                for (int i = 0; i < a.Length; i++)
                {
                    count += Math.Abs(a[i].r - b[i].r) + Math.Abs(a[i].g - b[i].g) + Math.Abs(a[i].b - b[i].b) > 24 ? 1 : 0;
                }
                return count;
            }
            void Dump(string file)
            {
                string dump = Environment.GetEnvironmentVariable("ETERNITIES_TEST_DUMP");
                if (!string.IsNullOrEmpty(dump))
                {
                    Directory.CreateDirectory(dump);
                    File.WriteAllBytes(Path.Combine(dump, file), ImageConversion.EncodeArrayToPNG(read, UnityEngine.Experimental.Rendering.GraphicsFormat.R8G8B8A8_SRGB, width, height));
                }
            }

            // The view has just come from the hub, which is dark, and the exposure takes a second
            // or two to come down to daylight. A frame read meanwhile differs from the next one
            // in every pixel, whatever is in it, so the view is first left to settle, without the
            // water. Settled, it still changes a little between two reads: the clouds move.
            app.Water.SetActive(false);
            Color32[] without = null;
            var drift = new System.Collections.Generic.List<int>();
            for (int tries = 0; ; tries++)
            {
                yield return Read(0.5);
                if (without != null)
                {
                    drift.Add(Changed(without, read));
                    if (drift[drift.Count - 1] < width * height / 100)
                    {
                        break;
                    }
                }
                Assert.That(tries, Is.LessThan(40), $"the view from the rim settles; pixels changed between reads half a second apart: {string.Join(", ", drift)}");
                without = read;
            }
            without = read;
            app.Water.SetActive(true);
            yield return Read(0.5);
            Color32[] withWater = read;
            Dump("river.png");
            int changed = Changed(withWater, without);

            // For whoever looks at the frames: the lake from the shore nearest the world, where a
            // visitor comes to it, with its far shore across the water.
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ETERNITIES_TEST_DUMP")))
            {
                Vector2 lake = app.GroundPlan.LakeCentre;
                Vector2 shore = lake - lake.normalized * (GroundPlan.LakeRadius + GroundPlan.Bank + 4);
                var eye = new Vector3(shore.x, 0, shore.y);
                eye.y = app.Ground.SampleHeight(eye) + app.Ground.transform.position.y + 1.6f;
                view.transform.SetPositionAndRotation(eye, Quaternion.LookRotation(new Vector3(lake.x, 0.5f, lake.y) - eye));
                yield return Read(2);
                Dump("lake.png");
                // And each wedge's ground, from just beyond the plaza, out along the middle of the
                // wedge (PRD v4 5.6.3: the ground under a wedge reads as its colour).
                WorldLayout layout = app.World.Layout;
                for (int c = 0; c < ColourClasses.WedgeCount; c++)
                {
                    if (layout.WedgeSpan[c] <= 0)
                    {
                        continue;
                    }
                    double bearing = (layout.WedgeFrom[c] + layout.WedgeSpan[c] / 2) / 1e6 * Math.PI / 180;
                    var along = new Vector3((float)Math.Sin(bearing), 0, (float)Math.Cos(bearing));
                    view.transform.SetPositionAndRotation(along * (layout.PlazaRadius / 1000f + 12) + Vector3.up * 1.6f, Quaternion.LookRotation(along) * Quaternion.Euler(6, 0, 0));
                    yield return Read(1);
                    Dump($"wedge-{(ColourClass)c}.png");
                }
            }
            view.targetTexture = null;
            target.Release();
            UnityEngine.Object.Destroy(target);

            int still = drift[drift.Count - 1];
            Debug.Log($"TheRiverIsSeenFromTheRim: {changed} pixels of {width * height} change with the water, {still} with nothing changed; before the view settled: {string.Join(", ", drift)}");
            Assert.That(changed - still, Is.GreaterThan(width * height / 100), "the water is at least a hundredth of the view from the rim, beyond what changes there by itself");
        }

        // The owner tunes the water by changing its prefab while the game plays (DEC-953): in the
        // editor the river takes a change of its prefab's without a new arrival. The prefab is
        // changed in memory only, and put back.
        [UnityTest]
        public IEnumerator InTheEditorTheRiverFollowsItsPrefab()
        {
            yield return Hub();
            App app = App.Instance;
            TowardThePortal();
            yield return Until(() => app.WorldReady, 60, "the arrival");
            hands.WorldMove = Vector3.zero;
            var prefab = app.RiverPrefab.GetComponent<WaterSurface>();
            var river = app.Water.transform.Find("River").GetComponent<WaterSurface>();
            Assert.That(river, Is.Not.SameAs(prefab));
            float speed = prefab.largeCurrentSpeedValue;
            Color colour = prefab.refractionColor;
            Assert.That(river.largeCurrentSpeedValue, Is.EqualTo(speed));
            prefab.largeCurrentSpeedValue = speed + 2;
            prefab.refractionColor = Color.red;
            try
            {
                yield return Until(() => river.largeCurrentSpeedValue == speed + 2 && river.refractionColor == Color.red, 5, "the river to take its prefab's change");
            }
            finally
            {
                prefab.largeCurrentSpeedValue = speed;
                prefab.refractionColor = colour;
            }
            yield return Until(() => river.largeCurrentSpeedValue == speed && river.refractionColor == colour, 5, "the river to take the change back");
            // What places the river is the world's, not the prefab's.
            Assert.That(river.transform.localScale.z, Is.GreaterThan(100));
        }

        // PRD v4 9.3: the avatar's footing is physical, with no sliding. While a foot of the
        // mannequin is on the ground it stays where it was put, walking and running, and the legs
        // come back under the body when it stops.
        [UnityTest]
        public IEnumerator AFootOnTheGroundStaysWhereItWasPut()
        {
            yield return Hub();
            App app = App.Instance;
            var gait = app.Avatar.GetComponentInChildren<Gait>();
            Assert.That(Mathf.Abs(gait.LegDegrees(0)) + Mathf.Abs(gait.LegDegrees(1)), Is.LessThan(0.5f), "standing, both legs are under the body");
            foreach (bool run in new[] { false, true })
            {
                hands.Run = run;
                hands.WorldMove = Vector3.right;    // along the hub's ground, away from the portal
                yield return Until(() => gait.Walking, 5, "the gait");
                int step = -1, steps = 0;
                Vector3 put = default;
                float slid = 0, carried = 0, widest = 0;
                Vector3 from = app.Avatar.transform.position;
                for (float until = Time.time + 3; Time.time < until;)
                {
                    yield return null;
                    widest = Mathf.Max(widest, Mathf.Abs(gait.LegDegrees(0) - gait.LegDegrees(1)));
                    if (!gait.Grounded)
                    {
                        continue;
                    }
                    if (gait.Step != step)
                    {
                        step = gait.Step;
                        put = gait.StanceFoot;
                        from = app.Avatar.transform.position;
                        steps++;
                    }
                    slid = Mathf.Max(slid, Vector3.Distance(gait.StanceFoot, put));
                    carried = Mathf.Max(carried, Vector3.Distance(app.Avatar.transform.position, from));
                }
                string pace = run ? "running" : "walking";
                Assert.That(steps, Is.GreaterThanOrEqualTo(4), $"{pace}: steps in three seconds");
                Assert.That(carried, Is.GreaterThan(0.5f), $"{pace}: the body passes over the foot");
                Assert.That(slid, Is.LessThan(0.01f), $"{pace}: the foot on the ground stays where it was put");
                Assert.That(widest, Is.GreaterThan(30), $"{pace}: the legs open into a stride");
                hands.WorldMove = Vector3.zero;
                hands.Run = false;
                yield return new WaitForSeconds(0.5f);
                Assert.That(Mathf.Abs(gait.LegDegrees(0)) + Mathf.Abs(gait.LegDegrees(1)), Is.LessThan(0.5f), $"{pace}: stopped, both legs are under the body again");
            }
        }

        // PRD v4 5.9.2: a portal whose world is not ready holds, with input locked, and never cuts
        // to an unready world.
        [UnityTest]
        public IEnumerator APortalHoldsUntilItsWorldIsReady()
        {
            yield return Hub();
            App app = App.Instance;
            // The load begins 13 m before the ring, about 3.7 s before the transition ends. With six
            // more seconds on it, the transition ends first and has to hold.
            app.LoadDelayForTests = 6;
            TowardThePortal();
            yield return Until(() => app.Holding, 40, "the hold");
            Assert.That(app.Place, Is.EqualTo(Place.Hub));
            Assert.That(app.WorldLoaded, Is.False);
            Assert.That(app.Avatar.Locked);
            Assert.That(app.HoldIndicator, Is.False, "the indicator waits for the 6 s ceiling");
            Assert.That(app.Hud.Line, Is.Null);
            hands.WorldMove = Vector3.zero;
            yield return Until(() => app.WorldReady, 60, "the arrival");
            Assert.That(app.LastHoldSeconds, Is.GreaterThan(1.0));
            Assert.That(app.Avatar.Locked, Is.False);
            Assert.That(app.Avatar.transform.position.magnitude, Is.LessThan(0.5f), "the avatar arrives at the arrival point, wherever the hold found it");
        }

        // PRD v4 5.9.2: beyond the 6 s ceiling a loading indicator appears on the held surface.
        [UnityTest]
        public IEnumerator AHoldPastTheCeilingSaysItIsLoading()
        {
            yield return Hub();
            App app = App.Instance;
            app.LoadDelayForTests = 11;
            TowardThePortal();
            yield return Until(() => app.HoldIndicator, 40, "the indicator");
            Assert.That(app.Holding && app.Place == Place.Hub);
            Assert.That(app.Hud.Line, Is.EqualTo("Loading…"));
            hands.WorldMove = Vector3.zero;
            yield return Until(() => app.WorldReady, 60, "the arrival");
            Assert.That(app.LastHoldSeconds, Is.GreaterThan(App.HoldIndicatorAfter));
            Assert.That(app.Hud.Line, Is.Null, "the line goes with the hold");
        }

        // Where the last `OneSlowStep` began and where it ended.
        Vector3 from, to;

        // Stands the avatar 1 m before a ring's plane, in the middle of its opening, and runs it
        // straight on for one frame as long as the project lets a frame be (`Maximum Allowed
        // Timestep`, a third of a second): one step of 2 m, to 1 m beyond the plane.
        IEnumerator OneSlowStep(Portal portal)
        {
            AvatarController avatar = App.Instance.Avatar;
            Transform ring = portal.transform;
            avatar.Place(ring.TransformPoint(0, 0, 1), Quaternion.LookRotation(-ring.forward));
            Time.captureDeltaTime = Time.maximumDeltaTime;
            hands.WorldMove = -ring.forward;
            hands.Run = true;
            yield return null;
            Time.captureDeltaTime = 0;
            hands.WorldMove = Vector3.zero;
            hands.Run = false;
            from = avatar.StepFrom;
            to = avatar.transform.position;
            Vector3 began = ring.InverseTransformPoint(from), ended = ring.InverseTransformPoint(to);
            Assert.That(began.z, Is.EqualTo(1).Within(0.05f), $"the step began 1 m before the ring{Where()}");
            Assert.That(ended.z, Is.EqualTo(-1).Within(0.05f), $"the step ended 1 m beyond the ring{Where()}");
            Assert.That(Mathf.Max(Mathf.Abs(began.x), Mathf.Abs(ended.x)), Is.LessThan(0.05f), "and went through the middle of the opening");
        }

        // DEC-989: a portal is used by the step that crosses its ring, however long the step. One
        // slow frame at a run carries the avatar 2 m and the opening is 1 m deep, so a step can
        // begin before the opening and end beyond it, with neither end inside. Both portals read
        // the step, and the automatic walk goes on the way the step went, not back through the ring.
        [UnityTest]
        public IEnumerator AStepAcrossTheRingUsesThePortal()
        {
            yield return Hub();
            App app = App.Instance;
            foreach (Place destination in new[] { Place.World, Place.Hub })
            {
                Portal portal = destination == Place.World ? app.HubPortal : app.ReturnPortal;
                yield return OneSlowStep(portal);
                Assert.That(portal.Holds(from), Is.False, $"to the {destination}: the step begins outside the opening");
                Assert.That(portal.Holds(to), Is.False, $"to the {destination}: and ends outside it, on the far side");
                Assert.That(portal.Crossed(from, to), $"to the {destination}: the step crossed the ring's plane inside the opening");
                yield return null;      // the application may read a step in the frame after the avatar took it
                Assert.That(app.InTransition, $"to the {destination}: the step across the ring uses the portal{Where()}");
                Assert.That(Vector3.Dot(app.Avatar.Walk, portal.transform.forward), Is.EqualTo(-AvatarController.WalkSpeed).Within(1e-3f), $"to the {destination}: the automatic walk goes on, away from the side the step began on");
                yield return Until(() => app.Place == destination && !app.InTransition, 60, $"the arrival in the {destination}");
            }
            Assert.That(app.WorldLoaded, Is.False, "the return unloaded the world");
        }

        // DEC-989: the swept check reads the opening in the portal's own space, from either side:
        // a step uses the portal when it ends inside the opening, or crosses the ring's plane there.
        [Test]
        public void AStepUsesAPortalOnlyThroughItsOpening()
        {
            Portal portal = Portal.Build("A portal", null, null, null, new Vector3(30, 2, -70), Quaternion.Euler(0, 130, 0));
            Vector3 At(float x, float y, float z) => portal.transform.TransformPoint(x, y, z);
            try
            {
                Assert.That(portal.Crossed(At(0, 0, 1), At(0, 0, -1)), "2 m through the opening");
                Assert.That(portal.Crossed(At(0, 0, -1), At(0, 0, 1)), "and from behind");
                Assert.That(portal.Crossed(At(1, 0, 1), At(-1, 0, -1)), "and at a slant");
                Assert.That(portal.Crossed(At(0, 0, 0.6f), At(0, 0, 0.4f)), "a short step that ends inside the opening, as before");
                Assert.That(portal.Crossed(At(2, 0, 1), At(2, 0, -1)), Is.False, "2 m beside the ring");
                Assert.That(portal.Crossed(At(2, 0, 0.2f), At(0, 0, -1.8f)), Is.False, "across the plane beside the ring, to end behind the opening");
                Assert.That(portal.Crossed(At(0, 0, 3), At(0, 0, 1)), Is.False, "2 m that end short of the ring");
                Assert.That(portal.Crossed(At(0, 4, 1), At(0, 4, -1)), Is.False, "2 m over the ring");
                Assert.That(portal.Crossed(At(0, 0, 1), At(0, 0, 1)), Is.False, "no step at all");
            }
            finally
            {
                UnityEngine.Object.Destroy(portal.gameObject);
            }
        }

        // DEC-989: a placement is not a step. An arrival, and a test, put the avatar somewhere
        // without walking it there, and the line from where it stood may cross a ring.
        [UnityTest]
        public IEnumerator APlacementAcrossTheRingDoesNotUseThePortal()
        {
            yield return Hub();
            App app = App.Instance;
            Transform ring = app.HubPortal.transform;
            Vector3 before = ring.TransformPoint(0, 0, 1), beyond = ring.TransformPoint(0, 0, -1);
            Assert.That(app.HubPortal.Crossed(before, beyond), "a step between the two places would use the portal");
            app.Avatar.Place(before, ring.rotation);
            yield return null;
            yield return null;      // the avatar has stood a step at the first place, whichever of the two updates first
            app.Avatar.Place(beyond, ring.rotation);
            Assert.That(Vector3.Distance(app.Avatar.StepFrom, beyond), Is.LessThan(1e-3f), "the next step begins where the avatar was placed");
            for (int frame = 0; frame < 3; frame++)
            {
                yield return null;
                Assert.That(app.InTransition, Is.False, $"a placement across the ring is not a step through it{Where()}");
            }
            Assert.That(app.Place, Is.EqualTo(Place.Hub));
        }
    }
}
