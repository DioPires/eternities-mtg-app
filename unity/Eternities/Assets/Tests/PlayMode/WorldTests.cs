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
            Assert.That(app.Stands.Sites, Is.EqualTo(26));
            // Dominaria's sun (PRD v4 Appendix C): 35 degrees up, warm, and to the visitor's left.
            Assert.That(Elevation(app.Sun), Is.EqualTo(35).Within(0.01f));
            Assert.That(app.Sun.colorTemperature, Is.LessThan(5600), "a warm sun");
            Assert.That(Vector3.Dot(-app.Sun.transform.forward, Vector3.left), Is.GreaterThan(0.5f), "the sun stands to the west");
            // The greybox (PRD v4 9.6, leg 1): flat ground as wide as the world, every site path,
            // site approach, trail leg and the plaza approach as a strip, every pad, every region's
            // boundary, and every stone; no props, no water and no sound.
            WorldDocument layout = app.World.Layout;
            Assert.That(app.Greybox.GroundRadius, Is.GreaterThan(layout.Radius / 1000f));
            Assert.That(app.Ground.sharedMaterials.Length, Is.EqualTo(4));
            Assert.That(app.Greybox.Strips, Is.EqualTo(2 * layout.Sites.Length + layout.Legs.Length + 1));
            Assert.That(app.Greybox.Pads, Is.EqualTo(layout.Pads.Length));
            Assert.That(app.Greybox.Lines, Is.EqualTo(12));
            Assert.That(app.Greybox.Stones, Is.EqualTo(26 + 22), "a stone a site and a chapter stone a chapter after the first");
            Assert.That(app.Props, Is.Null);
            Assert.That(app.Water, Is.Null);
            Assert.That(app.Sound, Is.Null);
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
            // A reading stone stands 2 m tall at its place.
            WorldSite era = Array.Find(layout.Sites, site => site.StoneKind == "reading");
            Vector3 stone = StandField.Ground(era.Stone.Position);
            Assert.That(Physics.Raycast(stone + 10 * Vector3.up, Vector3.down, out hit, 20));
            Assert.That(hit.point.y, Is.EqualTo(Greybox.ReadingHeight).Within(0.01f));

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
