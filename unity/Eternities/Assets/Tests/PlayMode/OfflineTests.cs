using System;
using System.Collections;
using System.IO;
using Eternities.Avatar;
using Eternities.CardView;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Travel;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Eternities.Tests
{
    // PRD v4 7.4.3 and question 5 of the slice, with the loader the product ships: a server of the
    // test's own stands in for Scryfall, and then nothing answers at its address. A card whose
    // images are on disk still shows them; one whose images are not shows its swatch and a
    // one-line notice, and nothing is a dead end.
    public class OfflineTests
    {
        readonly ScriptedInputSource hands = new ScriptedInputSource();
        ScryfallImagesTests.Server server;
        ScryfallImages loader;
        string cacheDirectory;

        [OneTimeSetUp]
        public void MakeTheWorldsFiles()
        {
            string packDirectory = App.PackDirectory();
            string source = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", Path.GetFileName(packDirectory)));
            WorldFiles.Generate(source, packDirectory, App.HomeWorld);
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
            server = new ScryfallImagesTests.Server();
            var texture = new Texture2D(488, 680, TextureFormat.RGB24, mipChain: false);
            server.Image = texture.EncodeToJPG();
            UnityEngine.Object.Destroy(texture);
            cacheDirectory = Path.Combine(Path.GetTempPath(), "eternities-offline-test-" + Guid.NewGuid().ToString("N"));
            int port = server.Port;
            App.ImageSourceForTests = () =>
            {
                loader = ScryfallImages.Create(cacheDirectory);
                loader.Address = url => $"http://127.0.0.1:{port}{new Uri(url).PathAndQuery}";
                return loader;
            };
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

        [TearDown]
        public void End()
        {
            App.ImageSourceForTests = null;
            server.Dispose();
            if (Directory.Exists(cacheDirectory))
            {
                Directory.Delete(cacheDirectory, recursive: true);
            }
        }

        IEnumerator TravelTo(int stand)
        {
            App app = App.Instance;
            app.TravelTo(stand);
            yield return Until(() => !app.InTransition, 15, "the arrival on the apron");
            yield return Until(() => app.HoveredStand == stand, 5, "the hover label");
        }

        IEnumerator CardView(int stand)
        {
            App app = App.Instance;
            hands.Interact = true;
            yield return Until(() => app.CardView.Active && app.CardView.Stand == stand && app.CardView.Settled, 10, "card view");
        }

        IEnumerator Leave()
        {
            App app = App.Instance;
            hands.Back = true;
            yield return Until(() => !app.CardView.Active, 5, "leaving card view");
            Assert.That(app.Place, Is.EqualTo(Place.World), "Esc in card view leaves card view, not the world");
        }

        [UnityTest]
        public IEnumerator WithTheNetworkGoneACachedCardShowsItsImageAndAnUncachedOneItsSwatchAndANotice()
        {
            App app = App.Instance;
            // Two stands far from the arrival point and far from each other: a stand within 25 m of
            // where the avatar has been has had its image asked for.
            var stands = app.World.Layout.Stands;
            int cached = stands.FindIndex(stand => StandField.Ground(stand.Position).magnitude > 100 && !app.World.Cards[stand.Card].HasBackImage);
            int uncached = stands.FindIndex(stand => StandField.Ground(stand.Position).magnitude > 100 && !app.World.Cards[stand.Card].HasBackImage
                && Vector3.Distance(StandField.Ground(stand.Position), StandField.Ground(stands[cached].Position)) > 100);
            Assert.That(cached >= 0 && uncached >= 0);
            PackPrinting first = app.World.Cards[stands[cached].Card].Printings[0];
            string large = ImageUrls.Face(first.Id, first.ImageTs, ImageSize.Large);

            // With the network up, the first card is seen on its stand and in card view.
            yield return TravelTo(cached);
            yield return Until(() => app.Images.SlotOf(cached) >= 0, 20, "the stand's image");
            yield return CardView(cached);
            yield return Until(() => app.CardView.FrontShown && app.CardView.BackShown, 20, "the card's two images");
            yield return null;
            Assert.That(app.Hud.Sheet.Notice, Is.Null);
            yield return Until(() => loader.Cache.Find(large, DateTimeOffset.UtcNow.ToUnixTimeSeconds()) != null, 10, "the large image on disk");
            yield return Leave();

            // The network goes: nothing answers at the address any more.
            server.Dispose();
            int heard = server.Count;

            // An uncached card: its stand stays on its swatch, and card view says so in one line.
            yield return TravelTo(uncached);
            yield return new WaitForSecondsRealtime(1);
            Assert.That(app.Images.SlotOf(uncached), Is.EqualTo(-1), "the stand is on its swatch");
            yield return CardView(uncached);
            yield return Until(() => app.Hud.Sheet != null && app.Hud.Sheet.Notice != null, 10, "the notice");
            Assert.That(app.Hud.Sheet.Notice, Is.EqualTo(CardViewer.NoImage));
            Assert.That(app.CardView.FrontShown, Is.False);
            PackPrinting other = app.World.Cards[stands[uncached].Card].Printings[0];
            Assert.That(loader.Policy.IsFinal(ImageUrls.Face(other.Id, other.ImageTs, ImageSize.Large)), Is.False, "the image is still wanted: it comes when the network does");
            Assert.That(app.Hud.Sheet.Printings.Count, Is.EqualTo(app.World.Cards[stands[uncached].Card].Printings.Length), "the panel is whole without the image");
            yield return Leave();

            // The cached card again: its stand's image and its card view's come from the disk.
            yield return TravelTo(cached);
            yield return Until(() => app.Images.SlotOf(cached) >= 0, 20, "the stand's image from disk");
            yield return CardView(cached);
            yield return Until(() => app.CardView.FrontShown && app.CardView.BackShown, 20, "the card's two images from disk");
            yield return null;
            Assert.That(app.Hud.Sheet.Notice, Is.Null, "a card whose image is shown has no notice");
            Assert.That(server.Count, Is.EqualTo(heard));
            yield return Leave();

            // And nothing is a dead end: Esc in the world still returns to the hub.
            hands.Back = true;
            yield return Until(() => app.Place == Place.Hub && !app.InTransition, 30, "the return to the hub");
        }
    }
}
