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
using Unity.Collections;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Eternities.Tests
{
    // The isolated image path (PRD v4 8.4.4), on images the test makes, so no test needs Scryfall.
    public class ExhibitTests
    {
        // Every card's image is one flat colour that depends on the card and is far from grey, so a
        // pixel of it is recognised wherever it lands.
        sealed class FlatImages : IImageSource
        {
            public int Requests;

            public static Color32 ColourOf(PackCard card)
            {
                int hash = card.OracleId.GetHashCode();
                return new Color32((byte)(40 + (hash & 0x7F)), (byte)(200 - ((hash >> 8) & 0x3F)), (byte)(30 + ((hash >> 16) & 0x1F)), 255);
            }

            public void Request(PackCard card, float distance, Action<Texture2D> done)
            {
                Requests++;
                var texture = new Texture2D(488, 680, TextureFormat.RGBA32, mipChain: false);
                var pixels = new Color32[488 * 680];
                Color32 colour = ColourOf(card);
                for (int i = 0; i < pixels.Length; i++)
                {
                    pixels[i] = colour;
                }
                texture.SetPixels32(pixels);
                texture.Apply();
                done(texture);
            }

            public void Cancel(PackCard card)
            {
            }
        }

        readonly ScriptedInputSource hands = new ScriptedInputSource();
        readonly FlatImages images = new FlatImages();
        RenderTexture target;

        [OneTimeSetUp]
        public void MakeTheWorldsFiles()
        {
            string packDirectory = App.PackDirectory();
            string source = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", Path.GetFileName(packDirectory)));
            WorldFiles.Generate(source, packDirectory, App.HomeWorld);
        }

        [TearDown]
        public void ReleaseTheTarget()
        {
            if (target != null)
            {
                if (Camera.main != null)
                {
                    Camera.main.targetTexture = null;
                }
                target.Release();
                UnityEngine.Object.Destroy(target);
                target = null;
            }
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

        // Dominaria, with the test's images and the test's hands, the main camera rendering into a
        // target of the test's and placed by the test.
        IEnumerator Dominaria(int width, int height)
        {
            yield return SceneManager.LoadSceneAsync("Assets/Scenes/Hub.unity", LoadSceneMode.Single);
            yield return Until(() => App.Instance != null && App.Instance.HubReady, 30, "the hub");
            App app = App.Instance;
            app.ImageSource = images;
            app.Avatar.Source = hands;
            Vector3 toPortal = app.HubPortal.transform.position - app.Avatar.transform.position;
            toPortal.y = 0;
            hands.WorldMove = toPortal.normalized;
            hands.Run = true;
            yield return Until(() => app.WorldReady, 90, "the arrival");
            hands.WorldMove = Vector3.zero;

            target = new RenderTexture(width, height, 24, GraphicsFormat.R8G8B8A8_SRGB) { name = "test target" };
            Camera.main.targetTexture = target;
            ((Behaviour)Camera.main.GetComponent("CinemachineBrain")).enabled = false;
        }

        // The camera `distance` metres in front of the middle of a stand's image surface, looking
        // straight at it, and the avatar out of the picture, behind the camera.
        static Vector3 LookAt(int stand, float distance)
        {
            App app = App.Instance;
            LayoutStand placed = app.World.Layout.Stands[stand];
            Quaternion facing = StandField.Facing(placed);
            Vector3 centre = StandField.Ground(placed.Position) + new Vector3(0, StandField.PlinthHeight + StandImages.SurfaceHeight / 2, 0) + facing * Vector3.forward * (StandField.SlabDepth / 2 + StandImages.Proud);
            Camera.main.transform.SetPositionAndRotation(centre + facing * Vector3.forward * distance, facing * Quaternion.Euler(0, 180, 0));
            Vector3 behind = StandField.Ground(placed.Position) + facing * Vector3.forward * (distance + 3);
            app.Avatar.Place(new Vector3(behind.x, 0, behind.z), facing * Quaternion.Euler(0, 180, 0));
            return centre;
        }

        IEnumerator Read(Action<NativeArray<Color32>> pixels)
        {
            // Let a few frames pass, so what is read is what the pipeline settles on.
            for (int frame = 0; frame < 6; frame++)
            {
                yield return null;
            }
            AsyncGPUReadbackRequest request = AsyncGPUReadback.Request(target, 0, GraphicsFormat.R8G8B8A8_SRGB);
            yield return Until(() => request.done, 20, "the readback");
            Assert.That(request.hasError, Is.False);
            // A readback's data lasts one frame: it is copied before anything else is waited for.
            var read = new NativeArray<Color32>(request.GetData<Color32>(), Unity.Collections.Allocator.Temp);
            string dump = Environment.GetEnvironmentVariable("ETERNITIES_TEST_DUMP");
            if (!string.IsNullOrEmpty(dump))
            {
                // For whoever debugs a failure: the frame the test read, and the exhibit buffer behind it.
                Directory.CreateDirectory(dump);
                int n = Directory.GetFiles(dump, "frame-*.png").Length;
                File.WriteAllBytes(Path.Combine(dump, $"frame-{n}.png"), ImageConversion.EncodeNativeArrayToPNG(read, GraphicsFormat.R8G8B8A8_SRGB, (uint)target.width, (uint)target.height).ToArray());
            }
            pixels(read);
            read.Dispose();
        }

        static void AssertColour(Color32 actual, Color32 expected, int tolerance, string what)
        {
            Assert.That(Math.Abs(actual.r - expected.r) <= tolerance && Math.Abs(actual.g - expected.g) <= tolerance && Math.Abs(actual.b - expected.b) <= tolerance,
                $"{what}: expected {expected}, was {actual}");
        }

        // The path end to end: a stand near the avatar gets a slot and its image; the composite puts
        // the image's own pixels on the screen, to the last bit, where the main camera drew the
        // swatch; and what stands between the camera and the card hides it.
        [UnityTest]
        public IEnumerator ACardsOwnPixelsReachTheScreenAndTheWorldHidesThem()
        {
            const int width = 1280, height = 720;
            yield return Dominaria(width, height);
            App app = App.Instance;
            int stand = 100;
            LookAt(stand, 2);
            PackCard card = app.World.Cards[app.World.Layout.Stands[stand].Card];
            yield return Until(() => app.Images.SlotOf(stand) >= 0 && app.Images.CoverageOf(stand) >= 1, 30, "the stand's image");
            // Every stand within 25 m is asked for once and uploaded once, two a frame.
            yield return Until(() => app.Images.Idle, 30, "the last upload");
            Assert.That(app.Images.SlotsInUse, Is.InRange(1, StandImages.Slots));
            Assert.That(app.Images.Uploads, Is.EqualTo(images.Requests), "one request an image, none twice");
            Assert.That(app.Images.Uploads, Is.EqualTo(app.Images.SlotsInUse));

            Color32 centre = default, corner = default;
            yield return Read(pixels =>
            {
                centre = pixels[height / 2 * width + width / 2];
                corner = pixels[10 * width + 10];
            });
            AssertColour(centre, FlatImages.ColourOf(card), 1, "the middle of the card, composited");
            Assert.That(corner.g, Is.Not.EqualTo(FlatImages.ColourOf(card).g), "the world beside the card is not the card");

            // Without the composite, the main camera's own pixel is there: the swatch, lit by nothing
            // but exposed, toned and fogged with the rest of the frame.
            app.Exhibit.CompositeEnabled = false;
            Color32 placeholder = default;
            yield return Read(pixels => placeholder = pixels[height / 2 * width + width / 2]);
            Color32 expected = FlatImages.ColourOf(card);
            Assert.That(Math.Abs(placeholder.r - expected.r) + Math.Abs(placeholder.g - expected.g) + Math.Abs(placeholder.b - expected.b), Is.GreaterThan(12), "the placeholder is not the image");
            app.Exhibit.CompositeEnabled = true;

            // An occluder between the camera and the card hides the card.
            GameObject box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.transform.position = Camera.main.transform.position + Camera.main.transform.forward * 1f;
            box.transform.localScale = new Vector3(0.1f, 0.1f, 0.05f);    // at half the card's distance it hides 0.2 m of the card
            box.transform.rotation = Camera.main.transform.rotation;
            Color32 hidden = default, beside = default;
            yield return Read(pixels =>
            {
                hidden = pixels[height / 2 * width + width / 2];
                // 0.2 m to the side of the middle, at the card's 2 m, is on the card (0.63 m wide) and clear of the box.
                beside = pixels[height / 2 * width + width / 2 + (int)(0.2f / 2f / Mathf.Tan(Camera.main.fieldOfView * Mathf.Deg2Rad / 2) * height / 2)];
            });
            Assert.That(Math.Abs(hidden.r - expected.r) + Math.Abs(hidden.g - expected.g) + Math.Abs(hidden.b - expected.b), Is.GreaterThan(12), "the box hides the middle of the card");
            AssertColour(beside, expected, 1, "the card beside the box");
            UnityEngine.Object.Destroy(box);
        }
    }
}
