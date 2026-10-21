using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using Eternities.Avatar;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using Eternities.Travel;
using Eternities.UI;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;
using UnityEngine.UIElements;

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

        // PRD v4 4.13.3, 8.3.2 and 7.4.1: the app reads `stands.bin` once at launch, and a record that
        // fails an assertion at launch stops it there, with the stand named where the visitor looks
        // and in the log. The hub is not built (DEC-1130 B2).
        [UnityTest]
        public IEnumerator AStandsFileThatFailsAtLaunchStopsTheAppBeforeTheHub()
        {
            string path = WorldFiles.StandsPath(App.PackDirectory());
            byte[] good = File.ReadAllBytes(path);
            byte[] broken = (byte[])good.Clone();
            // Record 0's class, one past the class of its colour identity mask (4.13.3, offset 18).
            int mask = broken[StandsFile.HeaderBytes + 17], wrong = (Checker.ClassOf(mask) + 1) % 7;
            broken[StandsFile.HeaderBytes + 18] = (byte)wrong;
            try
            {
                File.WriteAllBytes(path, broken);
                LogAssert.Expect(LogType.Exception, new System.Text.RegularExpressions.Regex($"InvalidDataException: stand 0 \\([0-9a-f-]{{36}}\\) records class {wrong} for the colour identity mask {mask}"));
                yield return SceneManager.LoadSceneAsync("Assets/Scenes/Hub.unity", LoadSceneMode.Single);
                for (float until = Time.realtimeSinceStartup + 30; (App.Instance == null || App.Instance.Failure == null) && Time.realtimeSinceStartup < until;)
                {
                    yield return null;
                }
                App app = App.Instance;
                Assert.That(app.Failure, Does.StartWith("stand 0 (").And.EndWith($"records class {wrong} for the colour identity mask {mask}"));
                for (int frame = 0; frame < 10; frame++)
                {
                    yield return null;
                }
                Assert.That(app.HubReady, Is.False);
                Assert.That(app.HubPortal, Is.Null, "the hub is not built");
                Assert.That(app.Records, Is.Null, "the records that failed are not kept");
            }
            finally
            {
                File.WriteAllBytes(path, good);
            }
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
            Assert.That(app.Stands.Sites, Is.EqualTo(app.World.Layout.Sites.Length));
            // Dominaria's sun (PRD v4 Appendix C): 35 degrees up, warm, and to the visitor's left.
            Assert.That(Elevation(app.Sun), Is.EqualTo(35).Within(0.01f));
            Assert.That(app.Sun.colorTemperature, Is.LessThan(5600), "a warm sun");
            Assert.That(Vector3.Dot(-app.Sun.transform.forward, Vector3.left), Is.GreaterThan(0.5f), "the sun stands to the west");
            // Dressed (PRD v4 9.6, leg 2): the ground in tiles of at most eight layers each, as wide
            // as the world and its margin; every stone; the props; the water each region row names;
            // a bed for each ambient family, a source on each body of water and one on each marsh's
            // pools; and the sky.
            WorldDocument layout = app.World.Layout;
            Assert.That(app.Tiles.Length, Is.EqualTo(app.Dress.Tiles * app.Dress.Tiles));
            Assert.That(app.Tiles.All(tile => tile.terrainData.terrainLayers.Length is > 0 and <= DressPlan.TileLayersMost));
            Assert.That(app.Tiles.Sum(tile => tile.terrainData.size.x) / app.Dress.Tiles, Is.EqualTo(app.Dress.Grid.Side).Within(0.01f));
            Assert.That(app.Dress.Grid.Side, Is.GreaterThan(2 * layout.Radius / 1000f));
            Assert.That(app.Stones.Count, Is.EqualTo(layout.Sites.Length + layout.Sites.Sum(site => site.Chapters.Count(chapter => chapter.Stone != null))),
                "a stone a site and a chapter stone a chapter after the first");
            Assert.That(app.Stones.Inscriptions, Is.EqualTo(layout.Sites.Count(site => site.StoneKind == "reading")), "an inscription on each reading stone");
            Assert.That(app.Props.Count, Is.EqualTo(app.Scatter.Instances.Length).And.GreaterThan(0));
            Assert.That(app.Water, Is.Not.Null);
            foreach ((string water, string surface) in new[] { (WaterBody.River, "Rivers"), (WaterBody.Lake, "Lakes and pools"), (WaterBody.Sea, "Sea"), (WaterBody.Lava, "Lava") })
            {
                if (app.Dress.Regions.Any(region => region.Water == water))
                {
                    Assert.That(app.Water.transform.Find(surface), Is.Not.Null, surface);
                }
            }
            Assert.That(app.Sound.Beds, Is.EqualTo(app.Dress.Regions.Select(region => region.Ambient).Distinct().Count()));
            Assert.That(app.Sound.Emitters, Is.EqualTo(app.Dress.Water.Count + app.Dress.Regions.Count(region => region.Water == WaterBody.Marsh)));
            Assert.That(app.Sky, Is.Not.Null);
            Assert.That(app.Kits.Keys, Does.Contain("temperate"));
            // The arrival point, facing north, on the ground.
            yield return new WaitForFixedUpdate();
            yield return null;
            Assert.That(app.Avatar.transform.position.magnitude, Is.LessThan(0.3f));
            Assert.That(Vector3.Angle(app.Avatar.transform.forward, Vector3.forward), Is.LessThan(1));

            // A stand is where the pack says: straight down onto it is the top of its slab, and a
            // step in front of it, on its apron, is the ground. It faces its path vertex.
            Vector3 at = StandField.Ground(app.World.Position(0));
            Assert.That(Physics.Raycast(at + 10 * Vector3.up, Vector3.down, out RaycastHit hit, 20));
            Assert.That(hit.point.y, Is.EqualTo(StandField.SlabTop).Within(0.005f));
            Vector3 apron = at + StandField.Facing(app.World, 0) * Vector3.forward;
            Assert.That(Physics.Raycast(apron + 10 * Vector3.up, Vector3.down, out hit, 20));
            Assert.That(hit.point.y, Is.EqualTo(0).Within(0.01f));
            Vector3 vertex = StandField.Ground(layout.Sites[app.World.Site(0)].Path[layout.StandVertex[0]]);
            Assert.That(Vector3.Angle(StandField.Facing(app.World, 0) * Vector3.forward, vertex - at), Is.LessThan(0.2f), "the stand faces its path vertex");
            // A reading stone stands about 2 m tall at its place (PRD v4 5.13.1).
            WorldSite era = Array.Find(layout.Sites, site => site.StoneKind == "reading");
            Vector3 stone = StandField.Ground(era.Stone.Position);
            Assert.That(Physics.Raycast(stone + 10 * Vector3.up, Vector3.down, out hit, 20));
            Assert.That(hit.point.y, Is.EqualTo(StoneField.HeightOf(app.Kits["temperate"].ReadingStone)).Within(0.01f));
            Assert.That(hit.point.y, Is.InRange(1.8f, 2.2f));

            // The walk holds what it reads of the plan, and nothing that only the build read
            // (DEC-1005, the memory cut).
            DressPlan plan = app.Dress;
            Scatter placed = app.Scatter;
            Assert.That(plan.Heights, Is.Not.Null);
            Assert.That(plan.FromReserved, Is.Not.Null);
            Assert.That(plan.TileLayers, Is.Null);
            Assert.That(plan.Current, Is.Null);
            Assert.That(plan.FromTrail, Is.Null);
            Assert.That(placed.Matrices, Is.Null, "the props draw from their own copy");

            Texture2DArray images = app.Images.Array;
            Assert.That(images.depth, Is.EqualTo(Eternities.CardView.StandImages.Slots));
            hands.Back = true;
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 30, "the return to the hub");
            Assert.That(app.World, Is.Null);
            Assert.That(app.WorldLoaded, Is.False);
            Assert.That(app.Dress, Is.Null);
            // Whatever still holds the plan or the scatter holds none of their grids: after a first
            // visit they stayed in the heap, and the next visit's plan was built beside them.
            Assert.That(plan.Heights == null && plan.Region == null && plan.Wet == null && plan.FromReserved == null, "the plan's grids leave with the world");
            Assert.That(placed.Instances == null && placed.RunStart == null, "the props' places leave with the world");
            Assert.That(app.Kits, Is.Empty, "the kits leave with the world (DEC-1055, N20)");
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
        // Timestep`, a third of a second): one step of 2 m, to 1 m beyond the plane. `beside` moves
        // the step that many metres along the plane, `fromBehind` turns it round, to begin behind
        // the ring and end before it, and `press` is what else the visitor does in the step's frame.
        IEnumerator OneSlowStep(Portal portal, float beside = 0, bool fromBehind = false, Action press = null)
        {
            AvatarController avatar = App.Instance.Avatar;
            Transform ring = portal.transform;
            float side = fromBehind ? -1 : 1;
            avatar.Place(ring.TransformPoint(beside, 0, side), Quaternion.LookRotation(-side * ring.forward));
            Time.captureDeltaTime = Time.maximumDeltaTime;
            hands.WorldMove = -side * ring.forward;
            hands.Run = true;
            press?.Invoke();
            yield return null;
            Time.captureDeltaTime = 0;
            hands.WorldMove = Vector3.zero;
            hands.Run = false;
            from = avatar.StepFrom;
            to = avatar.transform.position;
            Vector3 began = ring.InverseTransformPoint(from), ended = ring.InverseTransformPoint(to);
            Assert.That(began.z, Is.EqualTo(side).Within(0.05f), $"the step began 1 m {(fromBehind ? "behind" : "before")} the ring{Where()}");
            Assert.That(ended.z, Is.EqualTo(-side).Within(0.05f), $"the step ended 1 m {(fromBehind ? "before" : "beyond")} the ring{Where()}");
            Assert.That(Mathf.Max(Mathf.Abs(began.x - beside), Mathf.Abs(ended.x - beside)), Is.LessThan(0.05f), beside == 0 ? "and went through the middle of the opening" : $"and went {beside} m beside the middle of the opening");
        }

        // Dominaria, by one slow step through the hub's ring. The walk there is
        // `ThePortalLeadsToDominariaAndBack`'s to test.
        IEnumerator World()
        {
            yield return Hub();
            yield return OneSlowStep(App.Instance.HubPortal);
            yield return Until(() => App.Instance.WorldReady, 60, "the arrival");
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

        // DEC-1033: the travel menu uses a frame's input and the avatar takes its step all the
        // same, so a step across the return ring counts in a frame with the menu open. The menu
        // closes as the transition begins.
        [UnityTest]
        public IEnumerator AStepAcrossTheReturnRingCountsWithTheTravelMenuOpen()
        {
            yield return World();
            App app = App.Instance;
            hands.TravelMenu = true;
            yield return Until(() => app.Hud.TravelOpen, 5, "the travel menu");
            yield return OneSlowStep(app.ReturnPortal);
            Assert.That(app.ReturnPortal.Crossed(from, to), "the step crossed the ring's plane inside the opening");
            yield return null;      // the application may read a step in the frame after the avatar took it
            Assert.That(app.InTransition, $"the step across the ring uses the portal with the travel menu open{Where()}");
            Assert.That(app.Hud.TravelOpen, Is.False, "the menu closes as the transition begins");
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 60, "the arrival in the hub");
        }

        // DEC-1033: the automatic walk takes its side from the step only when the step used the
        // ring. E on the hub's pad uses no step: the walk goes through the ring's plane from the
        // side the avatar is on, as before DEC-989, in the frame its step came round the ring from
        // behind too.
        [UnityTest]
        public IEnumerator AnInteractOnThePadWalksFromTheSideTheAvatarIsOn()
        {
            yield return Hub();
            App app = App.Instance;
            Portal portal = app.HubPortal;
            yield return OneSlowStep(portal, beside: 1.7f, fromBehind: true, press: () => hands.Interact = true);
            Assert.That(portal.Crossed(from, to), Is.False, "the step crossed the ring's plane beside the ring, and did not use it");
            Assert.That(Vector3.Distance(to, portal.Pad), Is.LessThan(3), "and ended on the pad");
            yield return null;      // the application may read a step in the frame after the avatar took it
            Assert.That(app.InTransition, $"E on the pad uses the portal{Where()}");
            Assert.That(Vector3.Dot(app.Avatar.Walk, portal.transform.forward), Is.EqualTo(-AvatarController.WalkSpeed).Within(1e-3f), "the avatar is before the ring's plane now, and the automatic walk goes on through that plane");
            yield return Until(() => app.WorldReady, 60, "the arrival");
        }

        // And Esc beside the return ring uses no step either, in the frame the avatar's step
        // crossed the ring's plane from the front.
        [UnityTest]
        public IEnumerator AnEscBesideTheRingWalksFromTheSideTheAvatarIsOn()
        {
            yield return World();
            App app = App.Instance;
            Portal portal = app.ReturnPortal;
            yield return OneSlowStep(portal, beside: 3, press: () => hands.Back = true);
            Assert.That(portal.Crossed(from, to), Is.False, "the step crossed the ring's plane beside the ring, and did not use it");
            Assert.That(Vector3.Distance(to, portal.transform.position), Is.LessThan(2 * Portal.PadDistance), "and ended near enough to the ring for the automatic walk");
            yield return null;      // the application may read a step in the frame after the avatar took it
            Assert.That(app.InTransition, $"Esc returns to the hub{Where()}");
            Assert.That(Vector3.Dot(app.Avatar.Walk, portal.transform.forward), Is.EqualTo(AvatarController.WalkSpeed).Within(1e-3f), "the avatar is behind the ring's plane now, and the automatic walk goes back through that plane");
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 60, "the arrival in the hub");
        }

        // The world's edge (PRD v4 5.1.5): until the kit makes it natural, a step past the world's
        // radius R is kept on it, and a step inside it is taken.
        [UnityTest]
        public IEnumerator AStepPastTheWorldsEdgeStaysAtTheEdge()
        {
            yield return World();
            App app = App.Instance;
            float limit = app.World.Layout.Radius / 1000f;
            var outside = new Vector3(0.6f, 0, 0.8f) * (limit * 1.01f);
            Vector3 kept = app.Avatar.Keep(outside);
            Assert.That(new Vector2(kept.x, kept.z).magnitude, Is.EqualTo(limit).Within(0.01f), "a step past R is kept on it");
            Assert.That(Vector3.Angle(kept, outside), Is.LessThan(0.01f), "on the same bearing");
            var inside = new Vector3(0.6f, 0, 0.8f) * (limit - 1);
            Assert.That(Vector3.Distance(app.Avatar.Keep(inside), inside), Is.LessThan(1e-4f), "a step inside the world is taken");
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

        // PRD v4 6.3.1 and 5.13.7 (8.8.3: "crossing a region boundary updates the HUD's region
        // line and shows the sentence"): the line reads "The Hub" in the hub, names the plane and
        // the plaza's region on arrival with that region's sentence, follows a walk along the trail
        // across a boundary, and the sentence of the region crossed into shows for 4 s.
        [UnityTest]
        public IEnumerator TheLineFollowsTheWalkerAcrossARegionsBoundary()
        {
            yield return Hub();
            App app = App.Instance;
            Assert.That(app.Hud.PlaceText, Is.EqualTo(App.HubName));
            yield return OneSlowStep(app.HubPortal);
            yield return Until(() => app.WorldReady, 60, "the arrival");
            yield return null;
            WorldData world = app.World;
            WorldDocument layout = world.Layout;
            var where = new Whereabouts(layout);
            int plaza = where.Region(layout.Arrival.Position);
            Assert.That(app.Hud.PlaceText, Is.EqualTo(Whereabouts.Line(world, plaza, -1)));
            Assert.That(app.Hud.SentenceText, Is.EqualTo(Whereabouts.Sentence(world, plaza)).And.Not.Null);

            // A place on the trail 6 m before it crosses from one region into another, from the
            // fixture's own trail: the trail is flat and dry, but at a ford, which a walker wades.
            (Vector3 start, Vector3 end, int from, int into) = TrailCrossing(layout, where);
            app.Avatar.Place(start, Quaternion.LookRotation(end - start));
            yield return Until(() => app.ShownRegion == from, 5, "the line at the place before the boundary");
            Assert.That(app.Hud.PlaceText, Does.StartWith($"{world.Plane.DisplayName} · {layout.Regions[from].Name}"));
            hands.WorldMove = (end - start).normalized;
            yield return Until(() => app.ShownRegion == into, 10, $"the walk from {layout.Regions[from].Id} into {layout.Regions[into].Id}");
            float crossed = Time.unscaledTime;
            hands.WorldMove = Vector3.zero;
            Assert.That(app.Hud.PlaceText, Does.StartWith($"{world.Plane.DisplayName} · {layout.Regions[into].Name}"));
            Assert.That(app.Hud.SentenceText, Is.EqualTo(Whereabouts.Sentence(world, into)));
            yield return Until(() => app.Hud.SentenceText == null, Hud.SentenceSeconds + 2, "the sentence's end");
            Assert.That(Time.unscaledTime - crossed, Is.InRange(Hud.SentenceSeconds - 0.5f, Hud.SentenceSeconds + 0.5f), "the sentence shows for 4 s");
            Assert.That(app.Hud.PlaceText, Is.Not.Null, "the line stays");

            hands.Back = true;
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 30, "the return to the hub");
            Assert.That(app.Hud.PlaceText, Is.EqualTo(App.HubName));
            Assert.That(app.Hud.SentenceText, Is.Null);
        }

        // The first place on the trail's legs, sampled every 0.5 m, where 4 m of walking crosses
        // from one region into another: from 6 m before that crossing to 6 m after it.
        static (Vector3 Start, Vector3 End, int From, int Into) TrailCrossing(WorldDocument layout, Whereabouts where)
        {
            foreach (TrailLeg leg in layout.Legs)
            {
                P2[] line = leg.Polyline;
                for (int i = 12; i + 20 < line.Length; i++)
                {
                    int from = where.Region(line[i]), into = where.Region(line[i + 8]);
                    if (from >= 0 && into >= 0 && from != into && where.Region(line[i - 12]) == from && where.Region(line[i + 20]) == into)
                    {
                        return (StandField.Ground(line[i - 12]), StandField.Ground(line[i + 20]), from, into);
                    }
                }
            }
            Assert.Fail("no leg of the trail crosses a region's boundary");
            return default;
        }

        // PRD v4 6.3.4: M opens the map of the world: its regions, the trail's legs, every site in
        // site order with its stone and its outline, the return portal and every stand as a dot in
        // its class colour. A click on a site's stone or its outline asks for that site, and on a
        // region for its first site; the travel portal it opens arrives on the site's pad. M or
        // Esc closes the map, and while it is open the pointer is the visitor's.
        [UnityTest]
        public IEnumerator TheMapShowsTheWorldAndAClickTravelsToASite()
        {
            yield return World();
            App app = App.Instance;
            WorldData world = app.World;
            WorldDocument layout = world.Layout;
            hands.Map = true;
            yield return Until(() => app.Hud.MapOpen, 5, "the map");
            Assert.That(app.Hud.Open, "the map is an overlay");
            MapModel map = app.Map;
            Assert.That(map.Regions.Count, Is.EqualTo(layout.Regions.Length));
            Assert.That(map.Regions.Select(area => area.Name), Is.EqualTo(layout.Regions.Select(region => region.Name)));
            Assert.That(map.Trail.Count, Is.EqualTo(layout.Legs.Length));
            Assert.That(map.Sites.Count, Is.EqualTo(layout.Sites.Length));
            Assert.That(map.Dots.Length, Is.EqualTo(world.StandCount));
            Assert.That(map.Ground, Is.Not.Null);
            Assert.That(map.Ground.width, Is.EqualTo(App.MapGroundSide));
            Assert.That(map.HalfSide, Is.GreaterThan(layout.Radius / 1000f), "the map shows the whole world");
            for (int stand = 0; stand < world.StandCount; stand += 97)
            {
                Assert.That(map.DotColours[stand], Is.EqualTo(StandField.ClassColours[StandField.ClassOf(world, stand)]));
            }
            for (int s = 0; s < layout.Sites.Length; s++)
            {
                Assert.That(map.Sites[s].Chapters.Length, Is.EqualTo(layout.Sites[s].Chapters.Count(chapter => chapter.Stone != null)), layout.Sites[s].Key);
            }
            yield return null;
            yield return null;
            MapView view = app.Hud.Map;
            Assert.That(view.contentRect.width, Is.GreaterThan(50), "the map is laid out");
            for (int s = 0; s < map.Sites.Count; s++)
            {
                Assert.That(view.SiteAt(view.ToView(map.Sites[s].Stone)), Is.EqualTo(s), $"a click on {layout.Sites[s].Key}'s stone");
            }
            foreach (MapModel.Area area in map.Regions)
            {
                if (area.Site < 0)
                {
                    Assert.That(view.SiteAt(view.ToView(area.Label)), Is.EqualTo(-1), $"{area.Name} has no site and offers no travel");
                }
            }

            // A click on the last site travels to its pad.
            int chosen = map.Sites.Count - 1;
            view.Chosen(chosen);
            Assert.That(app.Hud.MapOpen, Is.False, "the map closes as the travel begins");
            yield return Until(() => !app.InTransition, 10, "the travel");
            Vector3 pad = StandField.Ground(layout.Sites[chosen].Pad.Position);
            Vector3 at = app.Avatar.transform.position;
            Assert.That(Vector2.Distance(new Vector2(at.x, at.z), new Vector2(pad.x, pad.z)), Is.LessThan(0.3f), "on the site's pad");
            yield return null;
            Assert.That(app.ShownSite, Is.EqualTo(chosen));

            // M opens it again, and M closes it.
            hands.Map = true;
            yield return Until(() => app.Hud.MapOpen, 5, "the map again");
            hands.Map = true;
            yield return Until(() => !app.Hud.MapOpen, 5, "the map closing");
            Assert.That(app.Hud.Open, Is.False);
        }

        // DEC-1203 N4: a world is built while the visitor stands on the hub's pad, and its sea
        // reaches past its ground to the hub. Its water shows only in the world: in the hub the
        // water system is off for the main camera, as HDRP reads it from the camera's volumes,
        // before the first visit and after a return, while the world stands built.
        [UnityTest]
        public IEnumerator TheWorldsWaterShowsOnlyInTheWorld()
        {
            // The water system's switch as HDRP blends it for the main camera each frame: HDRP's
            // default profile, then every volume the camera's mask takes.
            static bool Rendered()
            {
                Camera view = Camera.main;
                if (!VolumeManager.instance.isInitialized)
                {
                    // A run with no window renders nothing on its own, and HDRP starts the volumes
                    // with its first frame: one frame into a texture starts them.
                    RenderTexture target = RenderTexture.GetTemporary(64, 64, 24);
                    view.targetTexture = target;
                    view.Render();
                    view.targetTexture = null;
                    RenderTexture.ReleaseTemporary(target);
                }
                VolumeStack stack = VolumeManager.instance.CreateStack();
                try
                {
                    VolumeManager.instance.Update(stack, view.transform, view.GetComponent<HDAdditionalCameraData>().volumeLayerMask);
                    return stack.GetComponent<WaterRendering>().enable.value;
                }
                finally
                {
                    VolumeManager.instance.DestroyStack(stack);
                }
            }
            yield return Hub();
            App app = App.Instance;
            app.Avatar.Place(app.HubPortal.Pad, app.HubPortal.transform.rotation);
            yield return Until(() => app.WorldLoaded, 60, "the world built from the pad");
            yield return null;
            yield return null;
            Assert.That(app.Place, Is.EqualTo(Place.Hub));
            Assert.That(app.Water, Is.Not.Null);
            Assert.That(Rendered(), Is.False, "built from the hub, the world's water is not drawn in the hub");
            yield return OneSlowStep(app.HubPortal);
            yield return Until(() => app.WorldReady, 60, "the arrival");
            yield return null;
            Assert.That(Rendered(), "in the world it is");
            hands.Back = true;
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 30, "the return to the hub");
            yield return Until(() => app.WorldLoaded, 60, "the world built again from the pad the return leaves the visitor on");
            yield return null;
            yield return null;
            Assert.That(Rendered(), Is.False, "and after a visit it is not drawn in the hub");
        }

        // The avatar `metres` in front of a stone, facing it, until the frame after it stands there.
        IEnumerator Before(StoneField.Stone stone, float metres)
        {
            Vector3 front = stone.Facing * Vector3.forward;
            App.Instance.Avatar.Place(stone.Foot + front * metres, Quaternion.LookRotation(-front));
            yield return null;
            yield return null;
        }

        // What a keyboard's Enter and a gamepad's submit send to the control that has the focus.
        static void Submit(Button control)
        {
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = control;
                control.SendEvent(submit);
            }
        }

        static float Flat(Vector3 a, Vector3 b) => Vector2.Distance(new Vector2(a.x, a.z), new Vector2(b.x, b.z));

        // PRD v4 5.13.1, 6.1.3 and 6.6.2: within 3 m a reading stone shows its era's name and years,
        // and E opens its overlay, its text shown within 7.2's 0.5 s, its first link holding the
        // focus. Walking closes it; Esc closes it and stays in the world. A choice of travel that a
        // keyboard's or a gamepad's submit takes opens a portal to the next site's pad. A waystone
        // offers the same travel and no text; a chapter stone is named and offers nothing.
        [UnityTest]
        public IEnumerator AStoneIsReadAndTravelledFrom()
        {
            yield return World();
            App app = App.Instance;
            WorldDocument layout = app.World.Layout;
            int reading = app.Stones.All.FindIndex(stone => stone.Kind == Reading.ReadingStone);
            StoneField.Stone held = app.Stones.All[reading];
            yield return Before(held, 2);
            Assert.That(app.HoveredStone, Is.EqualTo(reading));
            Assert.That(app.HoveredStand, Is.EqualTo(-1));
            Assert.That(app.Hud.HoverText, Is.EqualTo(held.Label));
            hands.Interact = true;
            yield return Until(() => app.Hud.StoneOpen, 5, "the reading overlay");
            yield return Until(() => app.LastStoneTextSeconds >= 0, 2, "the overlay's text laid out");
            Debug.Log($"WorldTests: the reading overlay's text was laid out {app.LastStoneTextSeconds * 1000:F1} ms after E");
            Assert.That(app.LastStoneTextSeconds, Is.LessThan(0.5), "PRD v4 7.2's ceiling");
            LoreEra era = Reading.EraOf(app.World, layout.Sites[held.Site]);
            Assert.That(app.Hud.Stone.Name, Is.EqualTo(era.Name));
            Assert.That(app.Hud.Stone.Years, Is.EqualTo(era.Years));
            Assert.That(app.Hud.Stone.Paragraphs.Count, Is.EqualTo(era.Paragraphs.Length));
            Assert.That(app.Hud.Open, "an overlay, with the pointer the visitor's");
            Assert.That(app.Hud.PlaceText, Is.Null, "the place line hides under it");
            Focusable focused = app.Hud.StoneBody.panel.focusController.focusedElement;
            Assert.That(focused, Is.InstanceOf<Button>(), "a link has the focus");
            Assert.That(((Button)focused).text, Is.EqualTo(app.Hud.Stone.Sets[0].Text), "the first link");

            hands.WorldMove = Vector3.right;
            yield return Until(() => !app.Hud.StoneOpen, 5, "walking to close the overlay");
            hands.WorldMove = Vector3.zero;
            yield return Before(held, 2);
            hands.Interact = true;
            yield return Until(() => app.Hud.StoneOpen, 5, "the reading overlay again");
            hands.Back = true;
            yield return Until(() => !app.Hud.StoneOpen, 5, "Esc to close the overlay");
            for (int frame = 0; frame < 5; frame++)
            {
                yield return null;
            }
            Assert.That(app.Place, Is.EqualTo(Place.World), "Esc closed the overlay, and left the world no sooner");
            Assert.That(app.InTransition, Is.False);

            yield return Before(held, 2);
            hands.Interact = true;
            yield return Until(() => app.Hud.StoneOpen, 5, "the reading overlay a third time");
            Button next = app.Hud.StoneBody.Query<Button>().ToList().First(control => control.text.StartsWith("Next site", StringComparison.Ordinal));
            Submit(next);
            yield return Until(() => app.InTransition, 5, "the travel portal");
            Assert.That(app.Hud.StoneOpen, Is.False, "the overlay closes as the travel begins");
            yield return Until(() => !app.InTransition, 10, "the travel");
            Assert.That(Flat(app.Avatar.transform.position, StandField.Ground(layout.Sites[held.Site + 1].Pad.Position)), Is.LessThan(0.3f), "on the next site's pad");

            int way = app.Stones.All.FindIndex(stone => stone.Kind == Reading.Waystone);
            yield return Before(app.Stones.All[way], 2);
            Assert.That(app.HoveredStone, Is.EqualTo(way));
            hands.Interact = true;
            yield return Until(() => app.Hud.StoneOpen, 5, "the waystone's travel");
            Assert.That(app.Hud.Stone.Paragraphs, Is.Empty);
            Assert.That(app.Hud.Stone.Travel, Does.Contain("The plaza"));
            Button plaza = app.Hud.StoneBody.Query<Button>().ToList().First(control => control.text == "The plaza");
            Submit(plaza);
            yield return Until(() => app.InTransition, 5, "the travel portal to the plaza");
            yield return Until(() => !app.InTransition, 10, "the travel to the plaza");
            Assert.That(Flat(app.Avatar.transform.position, StandField.Ground(layout.Arrival.Position)), Is.LessThan(0.3f), "at the plaza's arrival point");

            int chapter = app.Stones.All.FindIndex(stone => stone.Kind == StoneField.Chapter);
            yield return Before(app.Stones.All[chapter], 1);
            Assert.That(app.HoveredStone, Is.EqualTo(chapter));
            Assert.That(app.Hud.HoverText, Is.EqualTo(app.Stones.All[chapter].Label));
            hands.Interact = true;
            for (int frame = 0; frame < 5; frame++)
            {
                yield return null;
            }
            Assert.That(app.Hud.StoneOpen || app.InTransition || app.CardView.Active, Is.False, "a chapter stone offers nothing");
        }

        // PRD v4 6.6.1: T opens the menu with its trail and its regions. A chapter's row travels to
        // its stone, and a site's cards are listed on asking.
        [UnityTest]
        public IEnumerator TheTravelMenuHasTheTrailAndTheRegions()
        {
            yield return World();
            App app = App.Instance;
            WorldData world = app.World;
            hands.TravelMenu = true;
            yield return Until(() => app.Hud.TravelOpen, 5, "the travel menu");
            yield return null;
            ScrollView list = app.Hud.TravelList;
            Assert.That(list.Query<Label>().ToList().Select(label => label.text), Does.Contain("Trail").And.Contain("Regions"));
            List<Choice> rows = Reading.TrailSection(world).Concat(Reading.RegionSection(world)).Where(row => row.Way != null).ToList();
            List<Button> links = list.Query<Button>().ToList().Where(control => control.text != "Cards").ToList();
            Assert.That(links.Select(control => control.text), Is.EqualTo(rows.Select(row => row.Text)));
            Focusable focused = list.panel.focusController.focusedElement;
            Assert.That(focused, Is.SameAs(links[0]), "the first row has the focus");

            // A site's cards, on asking.
            Button cards = list.Query<Button>().ToList().First(control => control.text == "Cards");
            Submit(cards);
            yield return null;
            Assert.That(app.Hud.TravelOpen, "asking for a site's cards travels nowhere");

            // A later chapter, to its stone.
            int index = rows.FindIndex(row => row.Way is Way way && way.Kind == Way.To.Chapter && world.Layout.Sites[way.Index].Chapters[way.Chapter].Stone != null);
            Way chosen = rows[index].Way.Value;
            Submit(links[index]);
            yield return Until(() => app.InTransition, 5, "the travel portal");
            Assert.That(app.Hud.TravelOpen, Is.False, "the menu closes as the travel begins");
            yield return Until(() => !app.InTransition, 10, "the travel");
            Vector3 arrival = StoneField.ChapterArrival(world.Layout.Sites[chosen.Index], chosen.Chapter, out Quaternion heading);
            Assert.That(Flat(app.Avatar.transform.position, arrival), Is.LessThan(0.3f), "on the path by the chapter's stone");
            Assert.That(Vector3.Angle(app.Avatar.transform.forward, heading * Vector3.forward), Is.LessThan(2), "facing the stone");
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
