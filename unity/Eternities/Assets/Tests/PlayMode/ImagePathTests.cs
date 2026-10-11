using System;
using System.Collections;
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
using UnityEngine.Rendering.HighDefinition;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Eternities.Tests
{
    // The six tests of the isolated image path (PRD v4 8.4.4 (a) to (f); row I of 9.5).
    //
    // One stand of Dominaria carries an image the test makes, a different colour at every pixel. The
    // main camera stands square in front of it at the distance where the surface is exactly
    // 244 x 340 pixels of a 1280 x 720 target, its edges on pixel edges, so every pixel of the card
    // on screen has one texel of the half-size image it must equal. That stand's swatch is made
    // magenta for the tests, a colour nothing else in the frame has, so a pixel of the placeholder
    // that survives the composite is found wherever it is.
    public class ImagePathTests
    {
        const int Width = 1280, Height = 720, CardWidth = 244, CardHeight = 340;
        const int Left = Width / 2 - CardWidth / 2, Bottom = Height / 2 - CardHeight / 2;
        const int Stand = 100, StandWithoutAnImage = 2000;

        sealed class PatternImages : IImageSource
        {
            // No pixel of the pattern is magenta: red and blue stay under 128 and green over 95.
            public static Color32 Pixel(int x, int y)
            {
                uint h = (uint)(x * 73856093) ^ (uint)(y * 19349663);
                h ^= h >> 13;
                h *= 0x5bd1e995;
                h ^= h >> 15;
                return new Color32((byte)(h & 0x7F), (byte)(96 + ((h >> 8) & 0x7F)), (byte)((h >> 16) & 0x7F), 255);
            }

            public string Without;      // the card that has no image

            public void Request(PackCard card, float distance, Action<Texture2D> done)
            {
                if (card.OracleId == Without)
                {
                    done(null);
                    return;
                }
                var texture = new Texture2D(488, 680, TextureFormat.RGBA32, mipChain: false);
                var pixels = new Color32[488 * 680];
                for (int y = 0; y < 680; y++)
                {
                    for (int x = 0; x < 488; x++)
                    {
                        pixels[y * 488 + x] = Pixel(x, y);
                    }
                }
                texture.SetPixels32(pixels);
                texture.Apply();
                done(texture);
            }

            public void Cancel(PackCard card)
            {
            }
        }

        static readonly PatternImages Images = new PatternImages();
        static Color32[] expected;
        static Texture2D swatches;
        readonly ScriptedInputSource hands = new ScriptedInputSource();
        RenderTexture target;
        Volume conditions;
        Vector3 cameraHome;
        GameObject box;

        // The source image at half size: each pixel the mean of its 2 x 2 block in linear light.
        static Color32[] Half()
        {
            float Linear(byte v)
            {
                float c = v / 255f;
                return c <= 0.04045f ? c / 12.92f : Mathf.Pow((c + 0.055f) / 1.055f, 2.4f);
            }
            byte Encoded(float c) => (byte)Mathf.RoundToInt(255 * (c <= 0.0031308f ? 12.92f * c : 1.055f * Mathf.Pow(c, 1 / 2.4f) - 0.055f));
            var half = new Color32[CardWidth * CardHeight];
            for (int y = 0; y < CardHeight; y++)
            {
                for (int x = 0; x < CardWidth; x++)
                {
                    float r = 0, g = 0, b = 0;
                    for (int i = 0; i < 4; i++)
                    {
                        Color32 p = PatternImages.Pixel(2 * x + (i & 1), 2 * y + (i >> 1));
                        r += Linear(p.r) / 4;
                        g += Linear(p.g) / 4;
                        b += Linear(p.b) / 4;
                    }
                    half[y * CardWidth + x] = new Color32(Encoded(r), Encoded(g), Encoded(b), 255);
                }
            }
            return half;
        }

        [OneTimeSetUp]
        public void MakeTheWorldsFiles()
        {
            string packDirectory = App.PackDirectory();
            string source = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", Path.GetFileName(packDirectory)));
            WorldFiles.Generate(source, packDirectory, App.HomeWorld);
            expected = Half();
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
        public IEnumerator StandBeforeTheCard()
        {
            // Dominaria is entered once for the six tests.
            if (App.Instance == null || App.Instance.ImageSource != Images || !App.Instance.WorldReady)
            {
                yield return SceneManager.LoadSceneAsync("Assets/Scenes/Hub.unity", LoadSceneMode.Single);
                yield return Until(() => App.Instance != null && App.Instance.HubReady, 30, "the hub");
                App.Instance.ImageSource = Images;
                App.Instance.Avatar.Source = hands;
                Vector3 toPortal = App.Instance.HubPortal.transform.position - App.Instance.Avatar.transform.position;
                toPortal.y = 0;
                hands.WorldMove = toPortal.normalized;
                hands.Run = true;
                yield return Until(() => App.Instance.WorldReady, 90, "the arrival");
                hands.WorldMove = Vector3.zero;
                ((Behaviour)Camera.main.GetComponent("CinemachineBrain")).enabled = false;
                Images.Without = App.Instance.World.Cards[App.Instance.World.Layout.Stands[StandWithoutAnImage].Card].OracleId;
            }
            App app = App.Instance;
            Camera view = Camera.main;
            target = new RenderTexture(Width, Height, 24, GraphicsFormat.R8G8B8A8_SRGB) { name = "test target" };
            view.targetTexture = target;
            view.GetComponent<HDAdditionalCameraData>().antialiasing = HDAdditionalCameraData.AntialiasingMode.TemporalAntialiasing;
            app.Exhibit.CompositeEnabled = true;

            Before(Stand);

            // This stand's swatch becomes magenta and every other stand's grey, in a texture laid
            // out as the product's is: a 2 x 2 block a stand.
            if (swatches == null)
            {
                Texture products = app.Images.SurfaceMaterial.GetTexture("_UnlitColorMap");
                swatches = new Texture2D(products.width, products.height, TextureFormat.RGBA32, mipChain: false) { filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
                var texels = new Color32[products.width * products.height];
                for (int i = 0; i < texels.Length; i++)
                {
                    texels[i] = new Color32(128, 128, 128, 255);
                }
                foreach (int stand in new[] { Stand, StandWithoutAnImage })
                {
                    for (int i = 0; i < 4; i++)
                    {
                        texels[(2 * (stand / StandImages.AtlasBlocks) + (i >> 1)) * products.width + 2 * (stand % StandImages.AtlasBlocks) + (i & 1)] = new Color32(255, 0, 255, 255);
                    }
                }
                // The product's last block is the one a cut-out surface reads: it stays transparent.
                int cut = app.World.Layout.Stands.Count;
                for (int i = 0; i < 4; i++)
                {
                    texels[(2 * (cut / StandImages.AtlasBlocks) + (i >> 1)) * products.width + 2 * (cut % StandImages.AtlasBlocks) + (i & 1)] = new Color32(0, 0, 0, 0);
                }
                swatches.SetPixels32(texels);
                swatches.Apply();
            }
            app.Images.SurfaceMaterial.SetTexture("_UnlitColorMap", swatches);
            yield return Until(() => app.Images.SlotOf(Stand) >= 0 && app.Images.CoverageOf(Stand) >= 1 && app.Images.Idle, 60, "the stand's image");

            var holder = new GameObject("Test conditions");
            conditions = holder.AddComponent<Volume>();
            conditions.isGlobal = true;
            conditions.priority = 1000;
            conditions.profile = ScriptableObject.CreateInstance<VolumeProfile>();
        }

        // Square in front of the middle of a stand's surface, where its 0.88 m are 340 of the 720
        // rows, with the avatar out of the picture behind the camera.
        void Before(int stand)
        {
            App app = App.Instance;
            Camera view = Camera.main;
            LayoutStand placed = app.World.Layout.Stands[stand];
            Quaternion facing = StandField.Facing(placed);
            Vector3 centre = StandField.Ground(placed.Position) + new Vector3(0, StandField.PlinthHeight + StandImages.SurfaceHeight / 2, 0) + facing * Vector3.forward * (StandField.SlabDepth / 2 + StandImages.Proud);
            float distance = Height * StandImages.SurfaceHeight / (CardHeight * 2 * Mathf.Tan(view.fieldOfView * Mathf.Deg2Rad / 2));
            cameraHome = centre + facing * Vector3.forward * distance;
            view.transform.SetPositionAndRotation(cameraHome, facing * Quaternion.Euler(0, 180, 0));
            Vector3 behind = StandField.Ground(placed.Position) + facing * Vector3.forward * (distance + 3);
            app.Avatar.Place(new Vector3(behind.x, 0, behind.z), facing * Quaternion.Euler(0, 180, 0));
        }

        [TearDown]
        public void Release()
        {
            if (Camera.main != null)
            {
                Camera.main.targetTexture = null;
            }
            if (target != null)
            {
                target.Release();
                UnityEngine.Object.Destroy(target);
            }
            if (conditions != null)
            {
                UnityEngine.Object.Destroy(conditions.profile);
                UnityEngine.Object.Destroy(conditions.gameObject);
            }
            if (box != null)
            {
                UnityEngine.Object.Destroy(box);
            }
            DynamicResolutionHandler.SetDynamicResScaler(() => 100, DynamicResScalePolicyType.ReturnsPercentage);
        }

        // The frame, bottom row first, after the pipeline has had a few frames to settle.
        IEnumerator Read(Action<Color32[]> frame, int settle = 8)
        {
            for (int i = 0; i < settle; i++)
            {
                yield return null;
            }
            AsyncGPUReadbackRequest request = AsyncGPUReadback.Request(target, 0, GraphicsFormat.R8G8B8A8_SRGB);
            yield return Until(() => request.done, 20, "the readback");
            Assert.That(request.hasError, Is.False);
            Color32[] pixels = request.GetData<Color32>().ToArray();
            string dump = Environment.GetEnvironmentVariable("ETERNITIES_TEST_DUMP");
            if (!string.IsNullOrEmpty(dump))
            {
                Directory.CreateDirectory(dump);
                using (var raw = new NativeArray<Color32>(pixels, Unity.Collections.Allocator.Temp))
                {
                    File.WriteAllBytes(Path.Combine(dump, $"{TestContext.CurrentContext.Test.Name}-{Directory.GetFiles(dump, TestContext.CurrentContext.Test.Name + "-*.png").Length}.png"),
                        ImageConversion.EncodeNativeArrayToPNG(raw, GraphicsFormat.R8G8B8A8_SRGB, Width, Height).ToArray());
                }
            }
            frame(pixels);
        }

        static bool Magenta(Color32 c) => c.r - c.g > 50 && c.b - c.g > 50;

        static int Apart(Color32 a, Color32 b) => Math.Max(Math.Abs(a.r - b.r), Math.Max(Math.Abs(a.g - b.g), Math.Abs(a.b - b.b)));

        // Is the pixel the texel of the card it must be, with the card `shift` pixels to the right?
        static bool IsCard(Color32[] frame, int x, int y, int shift, int tolerance)
        {
            return Apart(frame[y * Width + x], expected[(y - Bottom) * CardWidth + (x - Left - shift)]) <= tolerance;
        }

        // The card's pixels: every pixel of the rectangle, less `inset` at its edge, is its texel.
        static void AssertCard(Color32[] frame, int tolerance, int inset, string when, int shift = 0)
        {
            int wrong = 0, worst = 0;
            for (int y = Bottom + inset; y < Bottom + CardHeight - inset; y++)
            {
                for (int x = Left + shift + inset; x < Left + shift + CardWidth - inset; x++)
                {
                    int apart = Apart(frame[y * Width + x], expected[(y - Bottom) * CardWidth + (x - Left - shift)]);
                    wrong += apart > tolerance ? 1 : 0;
                    worst = Math.Max(worst, apart);
                }
            }
            Assert.That(wrong, Is.EqualTo(0), $"{when}: {wrong} pixels of the card are off by more than {tolerance}, the worst by {worst}");
        }

        // No pixel of the placeholder survives: nothing magenta anywhere but within one pixel of the
        // card's exact edge.
        static void AssertNoPlaceholder(Color32[] frame, string when, int shift = 0)
        {
            int survivors = 0;
            for (int y = 0; y < Height; y++)
            {
                for (int x = 0; x < Width; x++)
                {
                    int dx = Math.Min(Math.Abs(x - (Left + shift)), Math.Abs(x - (Left + shift + CardWidth - 1)));
                    int dy = Math.Min(Math.Abs(y - Bottom), Math.Abs(y - (Bottom + CardHeight - 1)));
                    bool insideX = x >= Left + shift - 1 && x <= Left + shift + CardWidth, insideY = y >= Bottom - 1 && y <= Bottom + CardHeight;
                    bool onEdge = (insideX && insideY) && (dx <= 1 || dy <= 1 || x == Left + shift - 1 || x == Left + shift + CardWidth || y == Bottom - 1 || y == Bottom + CardHeight);
                    survivors += !onEdge && Magenta(frame[y * Width + x]) ? 1 : 0;
                }
            }
            Assert.That(survivors, Is.EqualTo(0), $"{when}: {survivors} pixels of the placeholder survive the composite");
        }

        T Condition<T>() where T : VolumeComponent
        {
            return conditions.profile.TryGet(out T component) ? component : conditions.profile.Add<T>(overrides: false);
        }

        void DepthOfFieldOn()
        {
            DepthOfField blur = Condition<DepthOfField>();
            blur.focusMode.Override(DepthOfFieldMode.Manual);
            blur.nearFocusStart.Override(0);
            blur.nearFocusEnd.Override(0);
            blur.farFocusStart.Override(4);
            blur.farFocusEnd.Override(9);
        }

        static float SkyBrightness(Color32[] frame)
        {
            float sum = 0;
            for (int x = 0; x < Width; x++)
            {
                Color32 c = frame[(Height - 20) * Width + x];
                sum += c.r + c.g + c.b;
            }
            return sum / Width / 3;
        }

        // (a) Colour isolation: the card at exactly 244 x 340 pixels is the half-size image, to 1 of
        // 255, under a bright sky, a dark sky and dense fog.
        [UnityTest]
        public IEnumerator A_ColourIsolation()
        {
            // Without the composite the rectangle is neither the card nor its swatch: under an image
            // that is wholly shown, the main camera draws the slab.
            App.Instance.Exhibit.CompositeEnabled = false;
            Color32[] frame = null;
            yield return Read(pixels => frame = pixels);
            int cards = 0, swatch = 0;
            for (int y = Bottom + 2; y < Bottom + CardHeight - 2; y++)
            {
                for (int x = Left + 2; x < Left + CardWidth - 2; x++)
                {
                    cards += IsCard(frame, x, y, 0, 8) ? 1 : 0;
                    swatch += Magenta(frame[y * Width + x]) ? 1 : 0;
                }
            }
            Assert.That(cards, Is.LessThan(CardWidth * CardHeight / 50), "without the composite, the rectangle is not the card");
            Assert.That(swatch, Is.EqualTo(0), "under a shown image the main camera does not draw the swatch");
            App.Instance.Exhibit.CompositeEnabled = true;

            Exposure exposure = Condition<Exposure>();
            exposure.mode.Override(ExposureMode.Fixed);
            exposure.fixedExposure.Override(11);
            yield return Read(pixels => frame = pixels);
            float bright = SkyBrightness(frame);
            AssertCard(frame, 1, 0, "under a bright sky");
            AssertNoPlaceholder(frame, "under a bright sky");

            exposure.fixedExposure.Override(19);
            yield return Read(pixels => frame = pixels);
            float dark = SkyBrightness(frame);
            Assert.That(bright - dark, Is.GreaterThan(60), $"the dark sky is dark: {bright} against {dark}");
            AssertCard(frame, 1, 0, "under a dark sky");

            exposure.fixedExposure.Override(13);
            Fog fog = Condition<Fog>();
            fog.enabled.Override(true);
            fog.meanFreePath.Override(2);
            fog.maximumHeight.Override(200);
            fog.baseHeight.Override(0);
            Color32[] clear = null;
            fog.enabled.Override(false);
            yield return Read(pixels => clear = pixels);
            fog.enabled.Override(true);
            yield return Read(pixels => frame = pixels);
            // The plinth under the card is 2.3 m away, in fog whose mean free path is 2 m.
            Assert.That(Apart(frame[(Bottom - 40) * Width + Width / 2], clear[(Bottom - 40) * Width + Width / 2]), Is.GreaterThan(20), "the fog is on the world");
            AssertCard(frame, 1, 0, "in dense fog");
            AssertNoPlaceholder(frame, "in dense fog");
        }

        // (b) Occlusion: a box between the camera and the stand hides exactly the pixels the main
        // camera hides.
        [UnityTest]
        public IEnumerator B_Occlusion()
        {
            // The main camera's own frame of the card, before the box and with it.
            Camera view = Camera.main;
            Color32[] before = null;
            App.Instance.Exhibit.CompositeEnabled = false;
            yield return Read(pixels => before = pixels);
            box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.transform.SetPositionAndRotation(view.transform.position + view.transform.forward * 1.2f + view.transform.right * 0.11f + view.transform.up * 0.07f, view.transform.rotation * Quaternion.Euler(0, 0, 20));
            box.transform.localScale = new Vector3(0.12f, 0.2f, 0.05f);

            Color32[] main = null, composited = null;
            yield return Read(pixels => main = pixels);
            App.Instance.Exhibit.CompositeEnabled = true;
            yield return Read(pixels => composited = pixels);

            // In the main camera a pixel of the rectangle is hidden where the box changed it; after
            // the composite, where it is not the card.
            var hiddenMain = new bool[CardWidth * CardHeight];
            var hiddenExhibit = new bool[CardWidth * CardHeight];
            int hidden = 0;
            for (int y = 0; y < CardHeight; y++)
            {
                for (int x = 0; x < CardWidth; x++)
                {
                    hiddenMain[y * CardWidth + x] = Apart(main[(Bottom + y) * Width + Left + x], before[(Bottom + y) * Width + Left + x]) > 12;
                    hiddenExhibit[y * CardWidth + x] = !IsCard(composited, Left + x, Bottom + y, 0, 1);
                    hidden += hiddenExhibit[y * CardWidth + x] ? 1 : 0;
                }
            }
            Assert.That(hidden, Is.InRange(2000, CardWidth * CardHeight / 2), "the box hides a part of the card");
            // The two agree everywhere but on the box's own outline, where the main camera's edge is
            // anti-aliased over a pixel.
            int disagree = 0;
            for (int y = 1; y < CardHeight - 1; y++)
            {
                for (int x = 1; x < CardWidth - 1; x++)
                {
                    int i = y * CardWidth + x;
                    if (hiddenMain[i] == hiddenExhibit[i])
                    {
                        continue;
                    }
                    bool outline = false;
                    for (int n = 0; n < 9 && !outline; n++)
                    {
                        int j = (y + n / 3 - 1) * CardWidth + x + n % 3 - 1;
                        outline = hiddenExhibit[j] != hiddenExhibit[i] || hiddenMain[j] != hiddenMain[i];
                    }
                    disagree += outline ? 0 : 1;
                }
            }
            Assert.That(disagree, Is.EqualTo(0), "pixels the exhibit hides and the main camera does not, or the reverse, away from the box's outline");
        }

        // Twenty frames of the camera sliding sideways, two pixels of the card a frame. In every
        // frame the card is its texels, and no placeholder shows.
        IEnumerator TwentyFramesOfMotion(int tolerance, string when)
        {
            Camera view = Camera.main;
            float metresAPixel = StandImages.SurfaceHeight / CardHeight;
            var frames = new Color32[20][];
            int read = 0;
            for (int i = 0; i < 20; i++)
            {
                // The camera moves to its left, so the card moves to the right on screen.
                view.transform.position = cameraHome - view.transform.right * (2 * (i + 1) * metresAPixel);
                yield return null;
                int n = i;
                // A readback's data lasts one frame, so it is copied the moment it arrives.
                AsyncGPUReadback.Request(target, 0, GraphicsFormat.R8G8B8A8_SRGB, request =>
                {
                    frames[n] = request.hasError ? null : request.GetData<Color32>().ToArray();
                    read++;
                });
            }
            yield return Until(() => read == 20, 30, "the twenty readbacks");
            view.transform.position = cameraHome;
            for (int i = 0; i < 20; i++)
            {
                Assert.That(frames[i], Is.Not.Null);
                AssertCard(frames[i], tolerance, 1, $"{when}, frame {i + 1} of the motion", shift: 2 * (i + 1));
                AssertNoPlaceholder(frames[i], $"{when}, frame {i + 1} of the motion", shift: 2 * (i + 1));
            }
        }

        // (c) Motion: twenty frames of camera motion with TAA on change nothing on the card.
        [UnityTest]
        public IEnumerator C_MotionWithTemporalAntiAliasing()
        {
            Assert.That(Camera.main.GetComponent<HDAdditionalCameraData>().antialiasing, Is.EqualTo(HDAdditionalCameraData.AntialiasingMode.TemporalAntialiasing));
            yield return Read(pixels => AssertCard(pixels, 1, 0, "before the motion"));
            yield return TwentyFramesOfMotion(1, "with TAA");
        }

        // (d) Depth of field leaves the card's pixels alone while the world behind it blurs.
        [UnityTest]
        public IEnumerator D_DepthOfField()
        {
            float Detail(Color32[] frame)
            {
                // How much neighbouring pixels differ, across the band of stands on the horizon.
                float sum = 0;
                for (int y = Height / 2 - 40; y < Height / 2 + 40; y++)
                {
                    for (int x = 20; x < Left - 40; x++)
                    {
                        sum += Apart(frame[y * Width + x], frame[y * Width + x + 1]);
                    }
                }
                return sum;
            }

            Color32[] sharp = null, blurred = null;
            yield return Read(pixels => sharp = pixels);
            DepthOfFieldOn();
            yield return Read(pixels => blurred = pixels);
            Assert.That(Detail(blurred), Is.LessThan(0.6f * Detail(sharp)), "the world behind the card blurs");
            AssertCard(blurred, 1, 0, "with depth of field");
            AssertNoPlaceholder(blurred, "with depth of field");
        }

        // PRD v4 5.5.5: a stand whose image has not arrived shows its swatch, here the test's magenta,
        // through the composite and all. It is also what proves the other tests' search for the
        // placeholder can find one.
        [UnityTest]
        public IEnumerator G_AStandWithoutAnImageShowsItsSwatch()
        {
            Before(StandWithoutAnImage);
            App app = App.Instance;
            yield return Until(() => app.Images.Idle, 60, "the images around the stand");
            Assert.That(app.Images.SlotOf(StandWithoutAnImage), Is.EqualTo(-1));
            Color32[] frame = null;
            yield return Read(pixels => frame = pixels);
            int swatch = 0;
            for (int y = Bottom + 2; y < Bottom + CardHeight - 2; y++)
            {
                for (int x = Left + 2; x < Left + CardWidth - 2; x++)
                {
                    swatch += Magenta(frame[y * Width + x]) ? 1 : 0;
                }
            }
            Assert.That(swatch, Is.EqualTo((CardWidth - 4) * (CardHeight - 4)), "the whole surface is the swatch");
        }

        static bool DynamicResolutionIsOn => ((HDRenderPipelineAsset)GraphicsSettings.currentRenderPipeline).currentPlatformRenderPipelineSettings.dynamicResolutionSettings.enabled;

        IEnumerator AtThreeQuarterScale()
        {
            if (!DynamicResolutionIsOn)
            {
                Assert.Ignore("dynamic resolution is off in the HDRP asset of this quality level, so no test can run at scale 0.75 (DEC-953: the four fixed switches)");
            }
            Camera.main.GetComponent<HDAdditionalCameraData>().allowDynamicResolution = true;
            DynamicResolutionHandler.SetDynamicResScaler(() => 75, DynamicResScalePolicyType.ReturnsPercentage);
            for (int i = 0; i < 10; i++)
            {
                yield return null;
            }
            Assert.That(HDCamera.GetOrCreate(Camera.main).actualWidth, Is.EqualTo(Width * 3 / 4).Within(2), "the main camera renders at three quarters");
        }

        // (e) Resolution scale 0.75 keeps (a) within 2 of 255.
        [UnityTest]
        public IEnumerator E_ResolutionScale()
        {
            yield return AtThreeQuarterScale();
            Color32[] frame = null;
            yield return Read(pixels => frame = pixels);
            AssertCard(frame, 2, 0, "at resolution scale 0.75");
            AssertNoPlaceholder(frame, "at resolution scale 0.75");
        }

        // (f) Boundary: with TAA and depth of field on, along the whole perimeter no pixel of the
        // placeholder survives and no pixel of the card is lost, to within one output pixel of the
        // exact edge, for a static camera and across twenty frames of motion.
        [UnityTest]
        public IEnumerator F_Boundary()
        {
            DepthOfFieldOn();
            Color32[] frame = null;
            yield return Read(pixels => frame = pixels);
            AssertCard(frame, 1, 1, "static, TAA and depth of field on");
            AssertNoPlaceholder(frame, "static, TAA and depth of field on");
            yield return TwentyFramesOfMotion(1, "TAA and depth of field on");
        }

        [UnityTest]
        public IEnumerator F_BoundaryAtThreeQuarterScale()
        {
            DepthOfFieldOn();
            yield return AtThreeQuarterScale();
            Color32[] frame = null;
            yield return Read(pixels => frame = pixels);
            AssertCard(frame, 2, 1, "static, at resolution scale 0.75");
            AssertNoPlaceholder(frame, "static, at resolution scale 0.75");
            yield return TwentyFramesOfMotion(2, "at resolution scale 0.75");
        }
    }
}
