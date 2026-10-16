using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Eternities.Tests
{
    // PRD v4 6.1.2 and 6.1.3, with the source the product ships and the Input System's test devices
    // where a visitor has a mouse and a keyboard: the mouse orbits the camera with no button held,
    // in the hub and in a world, and not under an overlay, where the pointer is the visitor's; a
    // click is on the stand whose label shows; a scroll zooms by a notch and then by its parts'
    // sizes, in the frames that send them.
    public class PointerTests
    {
        readonly InputTestFixture devices = new InputTestFixture();
        readonly ScriptedInputSource hands = new ScriptedInputSource();
        IAvatarInputSource own;     // the source the application made for itself
        string scrolls;             // where the instrument writes in a test: never in the visitor's file
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
            scrolls = Path.Combine(Application.temporaryCachePath, "scroll-parts-test.txt");
            File.Delete(scrolls);
            ScrollLog.PathForTests = scrolls;
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
            File.Delete(scrolls);
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
            int stand = Enumerable.Range(0, app.World.StandCount).First(placed => StandField.Ground(app.World.Position(placed)).magnitude > 100);
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
        // more than `ZoomMetresAFrame`, and when the parts stop no more than `OwedMetres` is still
        // owed, which is three frames.
        [UnityTest]
        public IEnumerator AScrollZoomsByANotchThenByItsPartsSizesAndNoFrameJumps()
        {
            App app = App.Instance;
            float start = Orbit().z;
            float pause = PlayerInputSource.ScrollPause * 2;
            float coasted = 0;      // metres the scroll asked of the camera in the frames `Zoomed` waited through,
            int coasting = 0;       // and how many of those frames it moved the camera in
            IEnumerator Zoomed()
            {
                coasted = 0;
                coasting = 0;
                for (int quiet = 0; quiet < 3;)
                {
                    yield return null;
                    float zoom = Mathf.Abs(app.Avatar.Input.Zoom);
                    Assert.That(zoom, Is.LessThanOrEqualTo(PlayerInputSource.ZoomMetresAFrame + 1e-4f), "no frame moves the camera more than its bound");
                    coasted += zoom;
                    coasting += zoom == 0 ? 0 : 1;
                    quiet = zoom == 0 ? quiet + 1 : 0;
                }
                yield return new WaitForSecondsRealtime(pause);
            }

            Assert.That(PlayerInputSource.ZoomMetresAFrame, Is.LessThanOrEqualTo(0.3f), "a frame never moves the camera more than 0.3 m");

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

            // A hard swipe: far more a frame than a frame may move the camera, for twenty frames.
            // No frame moves it more than its bound, and when the parts stop it goes on for what
            // is owed, which is never more than `OwedMetres`: for three frames, so it has stopped
            // within 0.1 s wherever a frame is a thirtieth of a second or shorter.
            float swiped = Orbit().z;
            for (int sent = 0; sent < 20; sent++)
            {
                devices.Set(mouse.scroll, new Vector2(0, 8));
                yield return null;
                Assert.That(Mathf.Abs(app.Avatar.Input.Zoom), Is.LessThanOrEqualTo(PlayerInputSource.ZoomMetresAFrame + 1e-4f), "a hard swipe moves the camera no more in a frame than its bound");
            }
            yield return Zoomed();
            Assert.That(swiped - Orbit().z, Is.GreaterThanOrEqualTo(PlayerInputSource.ScrollMetres - 1e-3f), "a hard swipe away from the visitor brings the camera a notch closer or more");
            Assert.That(coasted, Is.EqualTo(PlayerInputSource.OwedMetres - PlayerInputSource.ZoomMetresAFrame).Within(1e-3f), "after a hard swipe the camera goes on for what it may owe, less the last part's frame, and no further");
            Assert.That(coasting, Is.LessThanOrEqualTo(3), "and it has stopped three frames after the last part");

            // And the first part after a pause is one notch, however much it asks for.
            float before = Orbit().z;
            devices.Set(mouse.scroll, new Vector2(0, -100));
            yield return Zoomed();
            Assert.That(Orbit().z, Is.EqualTo(before + PlayerInputSource.ScrollMetres).Within(1e-3f), "a hundred notches in one frame move the camera one");
        }

        // The owner's own hand (DEC-978): every scroll part their wheel and their trackpad sent
        // the build from `4c4ad05` at medium on 2026-10-12, as that build's instrument wrote them
        // (`owner-scroll-parts.txt`), replayed here a frame for each frame of theirs and by their
        // clock. That build moved the camera at 6 m a second whatever the hand did, and the owner
        // found every swipe too slow. Now the camera goes as far as the fingers do, in the frames
        // they move in: the distances asked here of a roll of the wheel and of three of the swipes
        // are the ones the owner's answer set.
        [UnityTest]
        public IEnumerator TheOwnersSwipesMoveTheCameraAsFarAsTheirFingersWent()
        {
            App app = App.Instance;
            var plain = System.Globalization.CultureInfo.InvariantCulture;
            float now = 0;
            ((PlayerInputSource)own).Clock = () => now;

            var metres = new Dictionary<int, float>();      // the camera's, after each of the owner's frames
            int frame = -1, quiet = 0;      // the owner's frame the replay is at, and their frames since the last part
            foreach (string line in File.ReadAllLines(Path.Combine(Application.dataPath, "Tests", "PlayMode", "owner-scroll-parts.txt")))
            {
                if (line.StartsWith("#"))
                {
                    continue;
                }
                string[] fields = line.Split('\t');
                int sent = int.Parse(fields[1], plain);
                if (frame < 0)
                {
                    frame = sent - 1;
                    metres[frame] = Orbit().z;
                }
                // A frame of the owner's that read no scroll is a frame here too: the camera
                // moves in it only what it is still owed.
                while (frame < sent)
                {
                    frame++;
                    quiet++;
                    if (frame == sent)
                    {
                        now = float.Parse(fields[0], plain);
                        devices.Set(mouse.scroll, new Vector2(0, float.Parse(fields[3], plain)));
                        quiet = 0;
                    }
                    yield return null;
                    float zoom = Mathf.Abs(app.Avatar.Input.Zoom);
                    Assert.That(zoom, Is.LessThanOrEqualTo(PlayerInputSource.ZoomMetresAFrame + 1e-4f), $"no frame moves the camera more than its bound: the owner's frame {frame}");
                    Assert.That(zoom == 0 || quiet <= 3, $"the camera has stopped three frames after the last part, which were 0.04 s of the owner's: their frame {frame}");
                    metres[frame] = Orbit().z;
                }
            }

            // From before the owner's frame `first` to before their frame `next`, in which their
            // next gesture began.
            float Moved(int first, int next) => Mathf.Abs(metres[next - 1] - metres[first - 1]);
            Debug.Log(string.Format(plain, "PointerTests: the owner's hand: the roll of the wheel moved the camera {0:F2} m; the swipe of 1,648 points took it from {1:F2} m to {2:F2} m; the swipe of 1,012 points moved it {3:F2} m and the drag of 211 points {4:F2} m",
                Moved(80, 121), metres[310], metres[359], Moved(443, 509), Moved(604, 665)));
            Assert.That(Moved(80, 121), Is.InRange(1f, 2f), "a fast roll of five clicks of the wheel, a notch and four by their sizes, moves the camera 1 to 2 m");
            Assert.That(metres[310], Is.EqualTo(6f).Within(1e-3f), "the owner's hard swipe of 1,648 points began with the camera at the far end of its range, 6 m,");
            Assert.That(metres[359], Is.EqualTo(2f).Within(1e-3f), "and takes it to the near end, 2 m: across the whole range");
            Assert.That(Moved(443, 509), Is.InRange(2.5f, 4f), "an easy swipe of 1,012 points moves the camera 2.5 to 4 m");
            Assert.That(Moved(604, 665), Is.InRange(0.4f, 0.9f), "a slow drag of 211 points moves the camera 0.4 to 0.9 m");
        }

        // The instrument of DEC-978, which comes out with its test when the owner's wheel is
        // settled: every scroll the player reads is a line in its file, under a line for the run,
        // with what the visitor was doing and where the frame left the camera, and a second run
        // adds to the file.
        [UnityTest]
        public IEnumerator EveryScrollPartThePlayerReadsIsWrittenDown()
        {
            float start = Orbit().z;
            // A notch along, and then a scroll across while the visitor runs, by when the camera
            // has the pointer: it zooms nothing and is a line all the same.
            devices.Set(mouse.scroll, new Vector2(0, -1));
            yield return null;
            // W and Shift in one event: the fixture's second press of a key would let the first go.
            InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.W, Key.LeftShift));
            InputSystem.Update();
            yield return Frames(3);
            Assert.That(PointerLock.Held, "a movement key gives the pointer to the camera");
            devices.Set(mouse.scroll, new Vector2(0.05f, 0));
            yield return Frames(3);
            ScrollLog.Close();
            string[] read = { "-1\t0\t0\t0\t0", "0\t0.05\t1\t1\t1" };
            float[] asked = { start + PlayerInputSource.ZoomMetresAFrame, start + PlayerInputSource.ScrollMetres };

            string[] lines = File.ReadAllLines(scrolls);
            Assert.That(lines.Length, Is.EqualTo(1 + read.Length), "a line for the run and one for each frame that scrolled, and none for a frame that did not");
            Assert.That(lines[0], Does.StartWith("# run: build ").And.Contain("; started ").And.Contain("; quality " + QualitySettings.names[QualitySettings.GetQualityLevel()] + ";"));
            var plain = System.Globalization.CultureInfo.InvariantCulture;
            int frame = 0;
            for (int line = 0; line < read.Length; line++)
            {
                string[] fields = lines[1 + line].Split('\t');
                Assert.That(fields.Length, Is.EqualTo(10), "seconds, frame, the frame's unscaled seconds, the part, the scroll across, moving, running, the pointer held, the orbit's metres, the camera's metres");
                Assert.That(float.Parse(fields[0], plain), Is.GreaterThan(0));
                Assert.That(int.Parse(fields[1], plain), Is.GreaterThan(frame), "the lines are in the order the scrolls came, a frame each");
                frame = int.Parse(fields[1], plain);
                Assert.That(float.Parse(fields[2], plain), Is.GreaterThan(0));
                Assert.That(string.Join("\t", fields, 3, 5), Is.EqualTo(read[line]), "the part, the scroll across, and whether the visitor was moving, was running and the camera held the pointer");
                Assert.That(float.Parse(fields[8], plain), Is.EqualTo(asked[line]).Within(2e-3f), "the orbit's metres after the frame's zoom: after the first frame of the notch, and after all of it");
                Assert.That(float.Parse(fields[9], plain), Is.EqualTo(asked[line]).Within(0.5f), "the camera's own metres from the point it orbits: the orbit's, where nothing stands between");
            }

            devices.Set(mouse.scroll, new Vector2(0, 2));
            yield return Frames(3);
            ScrollLog.Close();
            Assert.That(File.ReadAllLines(scrolls).Length, Is.EqualTo(lines.Length + 2), "a second run adds its two lines and writes over nothing");
        }
    }
}
