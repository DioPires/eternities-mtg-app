using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using Eternities.Avatar;
using Eternities.CardView;
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
    // PRD v4 8.8.3: the travel portal performs the automatic walk and arrives on the apron; card view
    // shows the right printings and the artist text; offline, a card with no image to be had shows
    // its swatch and a notice. All on Dominaria, with an image source the test watches.
    public class CardViewTests
    {
        sealed class Watched : IImageSource
        {
            public readonly List<string> Asked = new List<string>();
            public Func<string, bool> Has = url => true;

            public void Request(string url, float distance, Action<Texture2D> done)
            {
                Asked.Add(url);
                done(Has(url) ? new Texture2D(8, 8, TextureFormat.RGBA32, mipChain: false) : null);
            }

            public void Cancel(string url)
            {
            }

            public bool Failing(string url) => false;
        }

        readonly ScriptedInputSource hands = new ScriptedInputSource();
        Watched images;

        [OneTimeSetUp]
        public void MakeTheWorldsFiles()
        {
            string packDirectory = App.PackDirectory();
            string source = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", Path.GetFileName(packDirectory)));
            WorldFiles.Generate(source, packDirectory, App.HomeWorld);
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

        [UnitySetUp]
        public IEnumerator EnterDominaria()
        {
            images = new Watched();
            App.ImageSourceForTests = () => images;
            yield return SceneManager.LoadSceneAsync("Assets/Scenes/Hub.unity", LoadSceneMode.Single);
            yield return Until(() => App.Instance != null && App.Instance.HubReady, 30, "the hub");
            App app = App.Instance;
            app.Avatar.Source = hands;
            hands.Run = true;
            Vector3 toPortal = app.HubPortal.transform.position - app.Avatar.transform.position;
            toPortal.y = 0;
            hands.WorldMove = toPortal.normalized;
            yield return Until(() => app.WorldReady, 90, "the arrival");
            hands.WorldMove = Vector3.zero;
            hands.Run = false;
        }

        // The first stand whose card fits, among those well away from the arrival point: a stand
        // within 25 m of the avatar is already being given its image.
        static int StandOf(Predicate<PackCard> card)
        {
            App app = App.Instance;
            return app.World.Layout.Stands.FindIndex(stand => StandField.Ground(stand.Position).magnitude > 100 && card(app.World.Cards[stand.Card]));
        }

        IEnumerator TravelTo(int stand)
        {
            App app = App.Instance;
            Vector3 from = app.Avatar.transform.position;
            float began = Time.realtimeSinceStartup;
            app.TravelTo(stand);
            Assert.That(app.InTransition && app.Avatar.Locked, "travel locks the visitor's input");
            yield return null;
            yield return null;
            Assert.That(Vector3.Distance(app.Avatar.transform.position, from), Is.InRange(0.001f, 0.5f), "the avatar walks into the travel portal by itself");
            yield return Until(() => !app.InTransition, 15, "the arrival on the apron");
            Assert.That(Time.realtimeSinceStartup - began, Is.GreaterThanOrEqualTo(App.TravelWalkSeconds), "the walk into the portal takes its second");
        }

        [UnityTest]
        public IEnumerator TravelArrivesOnTheApronAndCardViewShowsThePrintings()
        {
            App app = App.Instance;
            int stand = StandOf(card => card.Printings.Length >= 3 && !card.HasBackImage);
            PackCard card = app.World.Cards[app.World.Layout.Stands[stand].Card];
            LayoutStand placed = app.World.Layout.Stands[stand];

            // The travel menu opens on T and closes on Esc without leaving the world.
            hands.TravelMenu = true;
            yield return Until(() => app.Hud.TravelOpen, 5, "the travel menu");
            hands.Back = true;
            yield return Until(() => !app.Hud.TravelOpen, 5, "the travel menu closing");
            Assert.That(app.Place, Is.EqualTo(Place.World));

            // PRD v4 5.9.4: the avatar arrives on the stand's apron, facing the stand.
            yield return TravelTo(stand);
            Quaternion facing = StandField.Facing(placed);
            Vector3 apron = StandField.Ground(placed.Position) + facing * Vector3.forward * 0.9f;
            Vector3 at = app.Avatar.transform.position;
            Assert.That(new Vector2(at.x - apron.x, at.z - apron.z).magnitude, Is.LessThan(0.1f));
            Assert.That(Vector3.Angle(app.Avatar.transform.forward, facing * Vector3.back), Is.LessThan(2));

            // PRD v4 5.5.3: within 3 m the label shows card name, set, year and artist.
            yield return Until(() => app.HoveredStand == stand, 5, "the hover label");
            PackSet first = app.World.Sets[card.Printings[0].SetId];
            StringAssert.Contains(card.Name, app.Hud.HoverText);
            StringAssert.Contains(first.Name, app.Hud.HoverText);
            StringAssert.Contains(first.Year.ToString(), app.Hud.HoverText);
            StringAssert.Contains(card.Printings[0].Artist, app.Hud.HoverText);

            // The label stands over the stand in the view, whatever the view is drawn into: here a
            // texture of another size than the screen, as in a bench run without one.
            var view = new RenderTexture(1600, 900, 24, UnityEngine.Experimental.Rendering.GraphicsFormat.R8G8B8A8_SRGB);
            var overlays = new RenderTexture(1600, 900, 24, UnityEngine.Experimental.Rendering.GraphicsFormat.R8G8B8A8_SRGB);
            Camera.main.targetTexture = view;
            app.Hud.Settings.targetTexture = overlays;
            try
            {
                Assert.That(Screen.height, Is.Not.EqualTo(view.height), "the test's view is not the screen's size");
                // The view has just changed under a running camera and a laid-out panel, which the
                // product never does: the frames that follow are the pipeline's and the panel's to
                // settle in. They are counted, not timed: on a machine whose shader cache is cold,
                // as the CI runner's is on every run, the first frame into a texture took more than
                // ten seconds. The label is where it belongs after ten frames, or within a minute
                // of more, or it is not going to be.
                Vector2 over = default;
                Rect label = default, panel = default;
                float began = Time.realtimeSinceStartup;
                int frames = 0;
                for (bool there = false; frames < 10 || (!there && Time.realtimeSinceStartup - began < 60); frames++)
                {
                    yield return null;
                    Vector3 top = Camera.main.WorldToScreenPoint(StandField.Ground(placed.Position) + Vector3.up * StandField.SlabTop);
                    over = app.Hud.ViewToPanel(new Vector2(top.x, view.height - top.y));
                    label = app.Hud.HoverBounds;
                    panel = app.Hud.PanelBounds;
                    there = Mathf.Abs(label.center.x - over.x) <= 3 && Mathf.Abs(label.yMax - (over.y - 8)) <= 3;
                }
                string seen = $"after {frames} frames and {Time.realtimeSinceStartup - began:F1} s the label is {label} in the panel {panel}, the stand's top at {over}; the screen is {Screen.width} x {Screen.height}";
                Debug.Log($"CardViewTests: {seen}");
                Assert.That(label.center.x, Is.EqualTo(over.x).Within(3), $"the label is centred over the stand: {seen}");
                Assert.That(label.yMax, Is.EqualTo(over.y - 8).Within(3), $"and stands just above its top: {seen}");
                Assert.That(panel.Contains(label.min) && panel.Contains(label.max), $"the label is inside the panel: {seen}");
            }
            finally
            {
                Camera.main.targetTexture = null;
                app.Hud.Settings.targetTexture = null;
                UnityEngine.Object.Destroy(view);
                UnityEngine.Object.Destroy(overlays);
            }

            // PRD v4 6.1.3: a click on the stand enters card view, and a click beside it does not.
            Vector3 surface = Camera.main.WorldToScreenPoint(StandField.Ground(placed.Position) + Vector3.up * (StandField.PlinthHeight + StandField.SurfaceHeight / 2));
            hands.Pointer = new Vector2(2, 2);
            hands.Click = true;
            yield return null;
            yield return null;
            yield return null;
            Assert.That(app.CardView.Active, Is.False, "a click on the ground is not a click on the stand");
            hands.Pointer = surface;
            hands.Click = true;
            yield return Until(() => app.CardView.Active && app.CardView.Settled, 10, "card view, by a click on the stand");
            hands.Back = true;
            yield return Until(() => !app.CardView.Active && app.CardView.Settled, 5, "leaving card view");
            yield return Until(() => app.HoveredStand == stand, 5, "the hover label again");

            // PRD v4 5.10: interacting enters card view; the camera comes inside the apron.
            hands.Interact = true;
            yield return Until(() => app.CardView.Active && app.CardView.Settled, 10, "card view");
            Assert.That(app.CardView.Stand, Is.EqualTo(stand));

            // PRD v4 5.10.2: the card is a rounded rectangle. Its faces reach the card's four edges
            // and leave its corners out, where an image file is white and a printed card is not there.
            Mesh faces = app.CardView.CardTransform.Find("Faces").GetComponent<MeshFilter>().sharedMesh;
            Assert.That(faces.bounds.size.x, Is.EqualTo(CardViewer.CardWidth).Within(1e-4f));
            Assert.That(faces.bounds.size.y, Is.EqualTo(CardViewer.CardHeight).Within(1e-4f));
            float corner = CardViewer.CardWidth * CardViewer.CornerFraction;
            foreach (Vector3 vertex in faces.vertices)
            {
                float fromSide = CardViewer.CardWidth / 2 - Mathf.Abs(vertex.x), fromEnd = CardViewer.CardHeight / 2 - Mathf.Abs(vertex.y);
                if (fromSide < corner && fromEnd < corner)
                {
                    Assert.That(new Vector2(corner - fromSide, corner - fromEnd).magnitude, Is.LessThanOrEqualTo(corner + 1e-4f), "no part of a face is in a corner");
                }
            }
            Assert.That(app.Hud.CardShown);
            Assert.That(app.Hud.HoverText, Is.Null, "the HUD hides in card view except for the panel");
            Vector3 eye = Camera.main.transform.position - StandField.Ground(placed.Position);
            Assert.That(Vector3.Dot(eye, facing * Vector3.forward), Is.InRange(0.5f, 1.65f), "the camera is inside the apron, in front of the stand");
            Assert.That(Vector3.Angle(Camera.main.transform.forward, facing * Vector3.back), Is.LessThan(1));
            Assert.That(app.Avatar.GetComponentInChildren<Renderer>().enabled, Is.False, "the avatar is out of the frame");

            // PRD v4 5.10.2: the card tilts toward the pointer, 12 degrees each way. Tilted all the
            // way toward each corner of the view, the whole card is still in front of its stand's
            // slab: a card that leans back into the slab is cut off where it enters it, and the
            // first card view a build drew with a pointer on the screen had lost a corner so.
            Transform solid = app.CardView.CardTransform.Find("Solid");
            Vector3[] body = solid.GetComponent<MeshFilter>().sharedMesh.vertices;
            Vector3 slabFront = StandField.Ground(placed.Position) + facing * Vector3.forward * (StandField.SlabDepth / 2 + StandImages.Proud);
            foreach (Vector2 pointer in new[] { new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1), new Vector2(1, 0) })
            {
                app.CardView.PointerForTests = pointer;
                yield return new WaitForSeconds(1.5f);
                Assert.That(Quaternion.Angle(app.CardView.CardTransform.rotation, facing), Is.GreaterThan(CardViewer.TiltDegrees), $"the card tilts toward {pointer}");
                float nearest = float.PositiveInfinity;
                foreach (Vector3 vertex in body)
                {
                    nearest = Mathf.Min(nearest, Vector3.Dot(solid.TransformPoint(vertex) - slabFront, facing * Vector3.forward));
                }
                Assert.That(nearest, Is.GreaterThan(0.005f), $"tilted toward {pointer}, the card's nearest point to the slab is in front of it");
            }
            app.CardView.PointerForTests = null;
            yield return new WaitForSeconds(1);

            // The panel: the card as text, every printing by release date, the artist of the image shown.
            UI.CardSheet sheet = app.Hud.Sheet;
            Assert.That(sheet.Name, Is.EqualTo(card.Name));
            Assert.That(sheet.TypeLine, Is.EqualTo(card.TypeLine));
            Assert.That(sheet.Text, Is.EqualTo(card.OracleText));
            Assert.That(sheet.Printings.Count, Is.EqualTo(card.Printings.Length));
            for (int i = 0; i < card.Printings.Length; i++)
            {
                PackSet set = app.World.Sets[card.Printings[i].SetId];
                StringAssert.Contains(set.Name, sheet.Printings[i]);
                StringAssert.Contains(set.Year.ToString(), sheet.Printings[i]);
                StringAssert.Contains(card.Printings[i].Artist, sheet.Printings[i]);
                Assert.That(i == 0 || set.Year >= app.World.Sets[card.Printings[i - 1].SetId].Year, "by release date");
            }
            Assert.That(sheet.Active, Is.EqualTo(0));
            Assert.That(sheet.Artist, Is.EqualTo(card.Printings[0].Artist));
            Assert.That(sheet.CanFlip, Is.False);
            // The face is the `large` image of the first printing, and behind it the card back.
            Assert.That(images.Asked, Has.Member(ImageUrls.Face(card.Printings[0].Id, card.Printings[0].ImageTs, ImageSize.Large)));
            Assert.That(images.Asked, Has.Member(ImageUrls.CardBack));
            Assert.That(app.CardView.FrontShown && app.CardView.BackShown);

            // Choosing a row swaps the face (PRD v4 5.10.3).
            app.CardView.Show(2);
            yield return null;
            Assert.That(app.Hud.Sheet.Active, Is.EqualTo(2));
            Assert.That(app.Hud.Sheet.Artist, Is.EqualTo(card.Printings[2].Artist));
            Assert.That(images.Asked, Has.Member(ImageUrls.Face(card.Printings[2].Id, card.Printings[2].ImageTs, ImageSize.Large)));
            PackSet third = app.World.Sets[card.Printings[2].SetId];
            Assert.That(app.CardView.PageUrl(), Is.EqualTo($"https://scryfall.com/card/{third.Code}/{Uri.EscapeDataString(card.Printings[2].CollectorNumber)}"));

            // E does nothing to a card with no back image; walking leaves card view (PRD v4 5.10.4).
            hands.Interact = true;
            yield return null;
            yield return null;
            Assert.That(app.CardView.ShowingBack, Is.False);
            hands.WorldMove = facing * Vector3.right;
            yield return Until(() => !app.CardView.Active, 5, "leaving card view");
            hands.WorldMove = Vector3.zero;
            Assert.That(app.Hud.CardShown, Is.False);
            Assert.That(app.Avatar.GetComponentInChildren<Renderer>().enabled);
            Assert.That(app.RecentlyVisited, Is.EqualTo(new[] { stand }));
            Assert.That(app.Place, Is.EqualTo(Place.World));
        }

        // PRD v4 5.10.2 and question 5 of the slice: a card with the back-image flag flips.
        [UnityTest]
        public IEnumerator ACardWithABackImageFlips()
        {
            App app = App.Instance;
            int stand = StandOf(card => card.Name == "Invasion of Dominaria");
            PackCard card = app.World.Cards[app.World.Layout.Stands[stand].Card];
            yield return TravelTo(stand);
            yield return Until(() => app.HoveredStand == stand, 5, "the hover label");
            hands.Interact = true;
            yield return Until(() => app.CardView.Active && app.CardView.Settled, 10, "card view");
            Assert.That(app.Hud.Sheet.CanFlip);
            Assert.That(app.Hud.Sheet.BackName, Is.EqualTo("Serra Faithkeeper"));
            Assert.That(images.Asked, Has.Member(ImageUrls.Face(card.Printings[0].Id, card.Printings[0].ImageTs, ImageSize.Large, back: true)), "the back is the printing's own back image");
            Assert.That(images.Asked, Has.No.Member(ImageUrls.CardBack));

            Quaternion before = app.CardView.CardTransform.rotation;
            hands.Interact = true;
            yield return Until(() => app.CardView.ShowingBack, 5, "the flip");
            yield return new WaitForSeconds(1);
            Assert.That(Quaternion.Angle(before, app.CardView.CardTransform.rotation), Is.EqualTo(180).Within(2), "the card has turned its back to the camera");
            hands.Interact = true;
            yield return Until(() => !app.CardView.ShowingBack, 5, "the flip back");
            hands.Back = true;
            yield return Until(() => !app.CardView.Active, 5, "leaving card view");
            Assert.That(app.Place, Is.EqualTo(Place.World), "Esc in card view leaves card view, not the world");
        }

        // PRD v4 7.4.3 and question 5: with no image to be had, card view shows the swatch and a
        // one-line notice, and nothing is a dead end.
        [UnityTest]
        public IEnumerator WithNoImageToBeHadCardViewShowsANoticeAndStillLeaves()
        {
            App app = App.Instance;
            images.Has = url => false;
            int stand = StandOf(card => card.Printings.Length >= 2);
            yield return TravelTo(stand);
            yield return Until(() => app.HoveredStand == stand, 5, "the hover label");
            Assert.That(app.Images.SlotOf(stand), Is.EqualTo(-1), "the stand is on its swatch");
            hands.Interact = true;
            yield return Until(() => app.CardView.Active && app.CardView.Settled, 10, "card view");
            Assert.That(app.CardView.FrontShown, Is.False);
            StringAssert.Contains("could not be loaded", app.Hud.Sheet.Notice);
            Assert.That(app.Hud.Sheet.Printings.Count, Is.GreaterThanOrEqualTo(2), "the panel is whole without the image");
            app.CardView.Show(1);
            yield return null;
            Assert.That(app.Hud.Sheet.Active, Is.EqualTo(1));
            hands.Back = true;
            yield return Until(() => !app.CardView.Active, 5, "leaving card view");
            hands.Back = true;
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 30, "the return to the hub");
        }
    }
}
