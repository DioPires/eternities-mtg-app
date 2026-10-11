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

        // These tests are about the world, not its images: every stand stays its swatch.
        public sealed class NoImages : Eternities.CardView.IImageSource
        {
            public void Request(PackCard card, float distance, Action<Texture2D> done) => done(null);

            public void Cancel(PackCard card)
            {
            }
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
            Assert.That(meadow[0, 0, GroundPlan.Meadow], Is.EqualTo(1));

            hands.Back = true;
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 30, "the return to the hub");
            Assert.That(app.World, Is.Null);
            Assert.That(app.WorldLoaded, Is.False);
            Assert.That(Vector3.Distance(app.Avatar.transform.position, app.HubPortal.Pad), Is.LessThan(0.5f));
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
            hands.WorldMove = Vector3.zero;
            yield return Until(() => app.WorldReady, 60, "the arrival");
            Assert.That(app.LastHoldSeconds, Is.GreaterThan(1.0));
            Assert.That(app.Avatar.Locked, Is.False);
            Assert.That(app.Avatar.transform.position.magnitude, Is.LessThan(0.5f), "the avatar arrives at the arrival point, wherever the hold found it");
        }
    }
}
