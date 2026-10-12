using System.Collections.Generic;
using System.IO;
using Eternities.EditorTools;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.Experimental.Rendering;

namespace Eternities.Tests
{
    public class KitMaskImportTests
    {
        // The compressed mask map against the source file, as means over the whole texture. The four
        // channels of a ground texture differ by far more than this, so a channel in the wrong slot
        // fails; block compression moves a mean by a few levels at most.
        const float Tolerance = 8f;

        [Test]
        public void RepackPutsEachChannelInItsMaskMapSlot()
        {
            // Ambient occlusion 10, roughness 200, metalness 30.
            var pixels = new[] { new Color32(10, 200, 30, 255) };
            KitMaskImport.Repack(pixels);
            Assert.AreEqual(new Color32(30, 10, KitMaskImport.Height, 55), pixels[0]);
        }

        [Test]
        public void PackPutsRoughnessAndOcclusionInTheirMaskMapSlots()
        {
            // Roughness 200 and, in the file beside it, ambient occlusion 10: no metal.
            var pixels = new[] { new Color32(200, 200, 200, 255) };
            KitMaskImport.Pack(pixels, new[] { new Color32(10, 10, 10, 255) });
            Assert.AreEqual(new Color32(0, 10, KitMaskImport.Height, 55), pixels[0]);
        }

        [Test]
        public void OnlyAKitsArmTextureIsAMaskSource()
        {
            Assert.IsTrue(KitMaskImport.IsMaskSource("Assets/Kits/temperate/Terrain/leafy_grass_arm_2k.jpg"));
            Assert.IsFalse(KitMaskImport.IsMaskSource("Assets/Kits/temperate/Terrain/leafy_grass_diff_2k.jpg"));
            Assert.IsFalse(KitMaskImport.IsMaskSource("Assets/Settings/some_arm_2k.jpg"));
        }

        // A source with no `_arm_` file: its roughness is the mask's source, with the occlusion
        // file beside it.
        [Test]
        public void ARoughnessFileWithItsOcclusionBesideItIsAMaskSource()
        {
            Assert.AreEqual("Assets/Kits/temperate/Terrain/ground037_ao_1k.jpg", KitMaskImport.OcclusionOf("Assets/Kits/temperate/Terrain/ground037_rough_1k.jpg"));
            Assert.IsTrue(KitMaskImport.IsMaskSource("Assets/Kits/temperate/Terrain/ground037_rough_1k.jpg"));
            Assert.IsFalse(KitMaskImport.IsMaskSource("Assets/Kits/temperate/Terrain/ground037_ao_1k.jpg"), "the occlusion is read, and is no mask itself");
            Assert.IsNull(KitMaskImport.OcclusionOf("Assets/Kits/temperate/Terrain/no_such_rough_1k.jpg"), "a roughness file alone");
            Assert.IsNull(KitMaskImport.OcclusionOf("Assets/Settings/ground037_rough_1k.jpg"), "only a kit's");
        }

        static IEnumerable<string> MaskSources()
        {
            foreach (string guid in AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets/Kits" }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (KitMaskImport.IsMaskSource(path))
                {
                    yield return path;
                }
            }
        }

        // The temperate kit has ten ground textures (CREDITS.md): nine with an `_arm_` file and one
        // with its roughness and occlusion apart. And one mask for each photograph its props are
        // coloured by.
        [Test]
        public void TheTemperateKitHasItsMaskSources()
        {
            var sources = new List<string>(MaskSources());
            Assert.AreEqual(10, sources.FindAll(path => path.StartsWith("Assets/Kits/temperate/Terrain/")).Count);
            Assert.AreEqual(1, sources.FindAll(path => KitMaskImport.OcclusionOf(path) != null).Count);
            foreach (string guid in AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets/Kits/temperate/Props" }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (path.Contains("_diff_"))
                {
                    CollectionAssert.Contains(sources, System.Text.RegularExpressions.Regex.Replace(path, @"_diff_(\w+)\.\w+$", "_arm_$1.jpg"), $"the mask beside {path}");
                }
            }
        }

        [TestCaseSource(nameof(MaskSources))]
        public void AMaskSourceIsImportedInTheMaskMapLayout(string path)
        {
            var imported = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            Assert.IsNotNull(imported, path);
            Assert.IsTrue(GraphicsFormatUtility.HasAlphaChannel(imported.graphicsFormat), $"{imported.graphicsFormat} has no alpha");
            Assert.IsFalse(GraphicsFormatUtility.IsSRGBFormat(imported.graphicsFormat), $"{imported.graphicsFormat} is sRGB");

            var source = new Texture2D(2, 2, TextureFormat.RGB24, false, true);
            var beside = new Texture2D(2, 2, TextureFormat.RGB24, false, true);
            try
            {
                Assert.IsTrue(source.LoadImage(File.ReadAllBytes(path)), path);
                Color32[] expected = source.GetPixels32();
                string occlusion = KitMaskImport.OcclusionOf(path);
                if (occlusion == null)
                {
                    KitMaskImport.Repack(expected);
                }
                else
                {
                    Assert.IsTrue(beside.LoadImage(File.ReadAllBytes(occlusion)), occlusion);
                    KitMaskImport.Pack(expected, beside.GetPixels32());
                }

                Vector4 want = Mean(expected);
                Vector4 got = Mean(Minified(imported));
                for (int channel = 0; channel < 4; channel++)
                {
                    Assert.AreEqual(want[channel], got[channel], Tolerance, $"channel {"RGBA"[channel]} of {path}");
                }
            }
            finally
            {
                Object.DestroyImmediate(source);
                Object.DestroyImmediate(beside);
            }
        }

        // An imported texture is not readable, so it is drawn into a render texture and read from
        // there. At one thirty-second of the size the draw samples the texture's own mip chain, and
        // the mean of the result is the mean of the texture.
        static Color32[] Minified(Texture2D texture)
        {
            int width = Mathf.Max(1, texture.width / 32);
            int height = Mathf.Max(1, texture.height / 32);
            RenderTexture target = RenderTexture.GetTemporary(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            RenderTexture before = RenderTexture.active;
            var read = new Texture2D(width, height, TextureFormat.RGBA32, false, true);
            try
            {
                Graphics.Blit(texture, target);
                RenderTexture.active = target;
                read.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                return read.GetPixels32();
            }
            finally
            {
                RenderTexture.active = before;
                RenderTexture.ReleaseTemporary(target);
                Object.DestroyImmediate(read);
            }
        }

        static Vector4 Mean(Color32[] pixels)
        {
            double r = 0, g = 0, b = 0, a = 0;
            foreach (Color32 pixel in pixels)
            {
                r += pixel.r;
                g += pixel.g;
                b += pixel.b;
                a += pixel.a;
            }
            return new Vector4((float)(r / pixels.Length), (float)(g / pixels.Length), (float)(b / pixels.Length), (float)(a / pixels.Length));
        }
    }
}
