using System;
using System.Collections;
using System.IO;
using Eternities.Avatar;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Travel;
using Eternities.UI;
using NUnit.Framework;
using Unity.Cinemachine;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Eternities.Tests
{
    // PRD v4 6.1.2 and 6.1.3, with the source the product ships and the Input System's test devices
    // where a visitor has a mouse and a keyboard: the mouse orbits the camera with no button held,
    // in the hub and in a world, and not under an overlay, where the pointer is the visitor's; a
    // click is on the stand whose label shows; a scroll zooms by a notch and then by its size, at
    // the camera's pace.
    public class PointerTests
    {
        readonly InputTestFixture devices = new InputTestFixture();
        readonly ScriptedInputSource hands = new ScriptedInputSource();
        IAvatarInputSource own;     // the source the application made for itself
        Mouse mouse;
        Keyboard keyboard;

        [OneTimeSetUp]
        public void MakeTheWorldsFiles()
        {
            string packDirectory = App.PackDirectory();
            string source = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", Path.GetFileName(packDirectory)));
            WorldFiles.Generate(source, packDirectory, App.HomeWorld);
            App.ImageSourceForTests = () => new WorldTests.NoImages();
        }

        [OneTimeTearDown]
        public void LeaveTheSourceAlone()
        {
            App.ImageSourceForTests = null;
        }

        static IEnumerator Until(Func<bool> done, float seconds, string what)
        {
            float until = Time.realtimeSinceStartup + seconds;
            while (!done())
            {
                Assert.That(App.Instance == null ? null : App.Instance.Failure, Is.Null);
                Assert.That(Time.realtimeSinceStartup, Is.LessThan(until), $"{what} did not happen in {seconds} s");
                yield return null;
            }
        }

        static IEnumerator Frames(int count)
        {
            for (int frame = 0; frame < count; frame++)
            {
                yield return null;
            }
        }

        // The hub, with no device but the test's own, a pointer the camera can hold, and the
        // avatar's input left to the application.
        [UnitySetUp]
        public IEnumerator TheHub()
        {
            PointerLock.StateForTests = CursorLockMode.None;
            devices.Setup();
            mouse = InputSystem.AddDevice<Mouse>();
            keyboard = InputSystem.AddDevice<Keyboard>();
            yield return SceneManager.LoadSceneAsync("Assets/Scenes/Hub.unity", LoadSceneMode.Single);
            yield return Until(() => App.Instance != null && App.Instance.HubReady, 30, "the hub");
            own = App.Instance.Avatar.Source;
            Assert.That(own, Is.InstanceOf<PlayerInputSource>());
            yield return Frames(3);
        }

        [TearDown]
        public void End()
        {
            ScrollLog.PathForTests = null;
            ScrollLog.Close();
            PointerLock.StateForTests = null;
            devices.TearDown();
        }

        // Into Dominaria in the test's hands, and then the avatar's input is the application's again.
        IEnumerator EnterDominaria()
        {
            App app = App.Instance;
            app.Avatar.Source = hands;
            hands.Run = true;
            Vector3 toPortal = app.HubPortal.transform.position - app.Avatar.transform.position;
            toPortal.y = 0;
            hands.WorldMove = toPortal.normalized;
            yield return Until(() => app.WorldReady, 90, "the arrival");
            hands.WorldMove = Vector3.zero;
            hands.Run = false;
            app.Avatar.Source = own;
            yield return Frames(3);
        }

        // The camera's orbit: degrees about the avatar, degrees up, metres away.
        static Vector3 Orbit()
        {
            var orbit = App.Instance.View.GetComponent<CinemachineOrbitalFollow>();
            return new Vector3(orbit.HorizontalAxis.Value, orbit.VerticalAxis.Value, orbit.Radius * orbit.RadialAxis.Value);
        }

        // A key or a button goes down for a frame and comes up.
        IEnumerator Press(ButtonControl button)
        {
            devices.Press(button);
            yield return null;
            devices.Release(button);
            yield return null;
        }

        // The mouse moves with no button held, and the camera turns by it.
        IEnumerator Orbits(Vector2 delta, string where)
        {
            Vector3 before = Orbit();
            Assert.That(mouse.leftButton.isPressed || mouse.rightButton.isPressed || mouse.middleButton.isPressed, Is.False);
            devices.Set(mouse.delta, delta);
            yield return Frames(3);
            Vector3 after = Orbit();
            Assert.That(Mathf.DeltaAngle(before.x, after.x), Is.EqualTo(delta.x * PlayerInputSource.MouseDegrees).Within(0.01f), $"{where}, the mouse turns the camera about the avatar");
            Assert.That(after.y - before.y, Is.EqualTo(-delta.y * PlayerInputSource.MouseDegrees).Within(0.01f), $"{where}, the mouse turns the camera up and down");
        }

        // The mouse moves and scrolls, and the camera stays where it is.
        IEnumerator Still(string where)
        {
            Vector3 before = Orbit();
            devices.Set(mouse.delta, new Vector2(40, -20));
            devices.Set(mouse.scroll, new Vector2(0, -1));
            yield return Frames(5);
            Vector3 after = Orbit();
            Assert.That(after.x, Is.EqualTo(before.x), $"{where}, the mouse does not turn the camera about the avatar");
            Assert.That(after.y, Is.EqualTo(before.y), $"{where}, the mouse does not turn the camera up or down");
            Assert.That(after.z, Is.EqualTo(before.z), $"{where}, a scroll does not move the camera");
        }

        // PRD v4 6.1.2: the mouse orbits the camera. With no button held: on a trackpad a held
        // button is two fingers pressed while they drag, and the owner could not steer (DEC-975).
        [UnityTest]
        public IEnumerator TheMouseOrbitsTheCameraWithNoButtonHeld()
        {
            Assert.That(PointerLock.Held, Is.False, "the pointer is the visitor's until they click or move");
            yield return Orbits(new Vector2(40, -20), "in the hub");
            Assert.That(PointerLock.Held, Is.False, "moving the mouse does not take the pointer");

            // A click gives the pointer to the camera, and the next frame's delta is the system's
            // doing, not the visitor's: the camera does not jump.
            yield return Press(mouse.leftButton);
            Assert.That(PointerLock.Held, "a click gives the pointer to the camera");
            Vector3 held = Orbit();
            devices.Set(mouse.delta, new Vector2(500, 300));
            yield return Frames(3);
            Assert.That(Orbit(), Is.EqualTo(held), "the delta of the frame after the pointer changes hands is dropped");
            yield return Orbits(new Vector2(-30, 10), "with the pointer held");

            yield return EnterDominaria();
            yield return Orbits(new Vector2(-60, 12), "in a world");
        }

        // PRD v4 5.10.2 and 6.2.1: under an overlay the pointer is the visitor's, to tilt the card
        // and to click with, and the same hand on the mouse turns nothing. PRD v4 6.1.3: a click
        // enters card view, and with no pointer to put on a stand it is the stand whose label shows.
        [UnityTest]
        public IEnumerator TheMouseDoesNotOrbitTheCameraUnderTheTravelMenuOrCardView()
        {
            yield return EnterDominaria();
            App app = App.Instance;
            yield return Press(keyboard.wKey);
            Assert.That(PointerLock.Held, "a movement key gives the pointer to the camera");
            yield return Frames(3);

            yield return Press(keyboard.tKey);
            yield return Until(() => app.Hud.TravelOpen, 5, "the travel menu");
            Assert.That(PointerLock.Held, Is.False, "the pointer is the visitor's under the travel menu");
            yield return Still("under the travel menu");
            yield return Press(keyboard.escapeKey);
            yield return Until(() => !app.Hud.TravelOpen, 5, "the travel menu closing");
            Assert.That(app.Place, Is.EqualTo(Place.World), "Esc closed the menu and did no more");
            yield return Frames(3);
            Assert.That(PointerLock.Held, Is.False, "and it stays the visitor's until they click or move");
            yield return Orbits(new Vector2(40, -20), "with the travel menu closed");

            // A stand well away from the arrival point, by the travel portal, and the camera has
            // the pointer again: there is none to put on the stand.
            int stand = app.World.Layout.Stands.FindIndex(placed => StandField.Ground(placed.Position).magnitude > 100);
            app.TravelTo(stand);
            yield return Until(() => !app.InTransition, 15, "the arrival on the apron");
            yield return Until(() => app.HoveredStand == stand, 5, "the hover label");
            yield return Press(mouse.rightButton);
            Assert.That(PointerLock.Held, "a click of the other button gives the pointer to the camera too");
            yield return Press(mouse.leftButton);
            yield return Until(() => app.CardView.Active && app.CardView.Settled, 10, "card view, by a click");
            Assert.That(app.CardView.Stand, Is.EqualTo(stand), "a click is on the stand whose label shows");
            Assert.That(PointerLock.Held, Is.False, "the pointer is the visitor's in card view");
            yield return Still("in card view");
            yield return Press(keyboard.escapeKey);
            yield return Until(() => !app.CardView.Active && app.CardView.Settled, 5, "leaving card view");
            Assert.That(app.Place, Is.EqualTo(Place.World), "Esc left card view and did no more");
            yield return Orbits(new Vector2(40, -20), "after card view");

            // A click with the pointer free enters card view too, and the camera does not take a
            // pointer that card view has: it stays where the visitor had it.
            yield return Until(() => app.HoveredStand == stand, 5, "the hover label again");
            Assert.That(PointerLock.Held, Is.False);
            yield return Press(mouse.leftButton);
            yield return Until(() => app.CardView.Active, 10, "card view, by a click with the pointer free");
            yield return Frames(3);
            Assert.That(PointerLock.Held, Is.False, "the camera does not take the pointer from card view");
        }

        // PRD v4 6.1.2: scroll zooms. A wheel's notch is half a metre, whatever size the system
        // sends it as. A trackpad's two fingers send a run of parts, one a frame: after the first
        // each moves the camera by its size, a part of 1 by `RunMetres`. No frame moves the camera
        // faster than its pace, and when the parts stop no more than `OwedMetres` is still owed.
        [UnityTest]
        public IEnumerator AScrollZoomsByANotchThenByItsPartsSizesAndNoFrameExceedsTheCamerasPace()
        {
            App app = App.Instance;
            float start = Orbit().z;
            float pause = PlayerInputSource.ScrollPause * 2;
            float coasted = 0;      // metres the scroll asked of the camera in the frames `Zoomed` waited through
            IEnumerator Zoomed()
            {
                coasted = 0;
                for (int quiet = 0; quiet < 3;)
                {
                    yield return null;
                    Assert.That(Mathf.Abs(app.Avatar.Input.Zoom), Is.LessThanOrEqualTo(PlayerInputSource.Pace(Time.unscaledDeltaTime) + 1e-4f), "the camera moves no faster than its pace");
                    coasted += Mathf.Abs(app.Avatar.Input.Zoom);
                    quiet = app.Avatar.Input.Zoom == 0 ? quiet + 1 : 0;
                }
                yield return new WaitForSecondsRealtime(pause);
            }

            // The pace is 6 m a second, and a frame longer than a sixtieth of one moves the
            // camera a tenth of a metre and no more.
            Assert.That(PlayerInputSource.Pace(1f / 120), Is.EqualTo(PlayerInputSource.ZoomMetresPerSecond / 120).Within(1e-6f));
            Assert.That(PlayerInputSource.Pace(1f / 30), Is.EqualTo(PlayerInputSource.ZoomMetresAFrame));
            Assert.That(PlayerInputSource.ZoomMetresAFrame, Is.LessThanOrEqualTo(0.1f), "a frame never moves the camera more than 0.1 m");

            devices.Set(mouse.scroll, new Vector2(0, -1));
            yield return Zoomed();
            Assert.That(Orbit().z, Is.EqualTo(start + PlayerInputSource.ScrollMetres).Within(1e-3f), "a notch toward the visitor moves the camera half a metre away");
            devices.Set(mouse.scroll, new Vector2(0, 0.1f));
            yield return Zoomed();
            Assert.That(Orbit().z, Is.EqualTo(start).Within(1e-3f), "and a notch away, sent as a tenth of one, brings it back");

            // Two fingers on a trackpad, which sends about 120 parts a second, each here of 5 of
            // the system's points: a notch for the first, and the nineteen that follow within the
            // pause by their size.
            const float part = 0.25f;
            float last = 0, slowest = 0;
            for (int sent = 0; sent < 20; sent++)
            {
                devices.Set(mouse.scroll, new Vector2(0, -part));
                yield return null;
                slowest = sent == 0 ? 0 : Mathf.Max(slowest, Time.unscaledTime - last);
                last = Time.unscaledTime;
                yield return new WaitForSecondsRealtime(1f / 120);
            }
            yield return Zoomed();
            if (slowest < PlayerInputSource.ScrollPause)
            {
                Assert.That(Orbit().z, Is.EqualTo(start + PlayerInputSource.ScrollMetres + 19 * part * PlayerInputSource.RunMetres).Within(1e-3f), "a run moves the camera a notch and then by the sum of its parts");
            }
            else
            {
                Debug.Log($"PointerTests: a frame of the run took {slowest:F3} s, a pause, so the run was more than one; its sum is not checked");
            }

            // A flick: far more a frame than the camera's pace, for twenty frames. No frame
            // moves the camera faster than its pace, and when the parts stop it goes on for what
            // is owed, which is never more than `OwedMetres`.
            float flicked = Orbit().z;
            float fast = 0;
            for (int sent = 0; sent < 20; sent++)
            {
                devices.Set(mouse.scroll, new Vector2(0, 8));
                yield return null;
                Assert.That(Mathf.Abs(app.Avatar.Input.Zoom), Is.LessThanOrEqualTo(PlayerInputSource.Pace(Time.unscaledDeltaTime) + 1e-4f), "a flick moves the camera no faster than its pace");
                fast = PlayerInputSource.Pace(Time.unscaledDeltaTime);
            }
            yield return Zoomed();
            Assert.That(flicked - Orbit().z, Is.GreaterThanOrEqualTo(PlayerInputSource.ScrollMetres - 1e-3f), "a flick away from the visitor brings the camera a notch closer or more");
            Assert.That(coasted, Is.EqualTo(PlayerInputSource.OwedMetres - fast).Within(1e-3f), "after a flick the camera goes on for what it may owe, less the last part's frame, and no further");

            // And the first part after a pause is one notch, however much it asks for.
            float before = Orbit().z;
            devices.Set(mouse.scroll, new Vector2(0, -100));
            yield return Zoomed();
            Assert.That(Orbit().z, Is.EqualTo(before + PlayerInputSource.ScrollMetres).Within(1e-3f), "a hundred notches in one frame move the camera one");
        }

        // The instrument of DEC-978, which comes out with its test when the zoom's numbers are
        // final: every scroll part the player reads is a line in its file, under a line for the
        // run, and a second run adds to the file.
        [UnityTest]
        public IEnumerator EveryScrollPartThePlayerReadsIsWrittenDown()
        {
            string path = Path.Combine(Application.temporaryCachePath, "scroll-parts-test.txt");
            File.Delete(path);
            ScrollLog.PathForTests = path;
            float[] parts = { -1, -0.25f, 0.05f };
            foreach (float part in parts)
            {
                devices.Set(mouse.scroll, new Vector2(0, part));
                yield return null;
            }
            yield return Frames(3);
            ScrollLog.Close();

            string[] lines = File.ReadAllLines(path);
            Assert.That(lines.Length, Is.EqualTo(1 + parts.Length), "a line for the run and one for each part, and none for a frame with no scroll");
            Assert.That(lines[0], Does.StartWith("# run: build ").And.Contain("; started ").And.Contain("; quality " + QualitySettings.names[QualitySettings.GetQualityLevel()] + ";"));
            var plain = System.Globalization.CultureInfo.InvariantCulture;
            int frame = 0;
            for (int read = 0; read < parts.Length; read++)
            {
                string[] fields = lines[1 + read].Split('\t');
                Assert.That(fields.Length, Is.EqualTo(4), "seconds, frame, the frame's unscaled seconds, the part");
                Assert.That(float.Parse(fields[0], plain), Is.GreaterThan(0));
                Assert.That(int.Parse(fields[1], plain), Is.GreaterThan(frame), "the parts are in the order they came, a frame each");
                frame = int.Parse(fields[1], plain);
                Assert.That(float.Parse(fields[2], plain), Is.GreaterThan(0));
                Assert.That(float.Parse(fields[3], plain), Is.EqualTo(parts[read]));
            }

            devices.Set(mouse.scroll, new Vector2(0, 2));
            yield return Frames(3);
            ScrollLog.Close();
            Assert.That(File.ReadAllLines(path).Length, Is.EqualTo(lines.Length + 2), "a second run adds its two lines and writes over nothing");
            File.Delete(path);
        }
    }
}
