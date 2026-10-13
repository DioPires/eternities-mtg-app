using System.Collections.Generic;
using System.IO;
using Eternities.EditorTools;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.Experimental.Rendering;

namespace Eternities.Tests
{
    // A kit's photograph of leaves is cut out by the opacity file beside it, written into the
    // colour's alpha as the colour is imported (`KitAlphaImport`; the prop conditioning rule).
    public class KitAlphaImportTests
    {
        [Test]
        public void TheOpacityOfAKitsColourIsTheFileBesideIt()
        {
            Assert.AreEqual("Assets/Kits/temperate/Props/fern_02_alpha_1k.png", KitAlphaImport.OpacityOf("Assets/Kits/temperate/Props/fern_02_diff_1k.jpg"));
            Assert.IsNull(KitAlphaImport.OpacityOf("Assets/Kits/temperate/Props/rock_moss_set_01_diff_2k.jpg"), "a rock has no opacity file");
            Assert.IsNull(KitAlphaImport.OpacityOf("Assets/Kits/temperate/Props/fern_02_nor_gl_1k.jpg"), "only the colour is cut out");
            Assert.IsNull(KitAlphaImport.OpacityOf("Assets/Settings/fern_02_diff_1k.jpg"), "only a kit's");
        }

        // A smaller level's alphas are scaled until as many pass the cut as at full size.
        [Test]
        public void ASmallerLevelKeepsItsCoverage()
        {
            // A leaf's edge, averaged: half the texels at 100, under the cut of 128, half at 0.
            var pixels = new Color32[8];
            for (int i = 0; i < 4; i++)
            {
                pixels[i].a = 100;
            }
            Assert.AreEqual(0, KitAlphaImport.Coverage(pixels, 1));
            KitAlphaImport.Keep(pixels, 0.5f);
            Assert.AreEqual(0.5f, KitAlphaImport.Coverage(pixels, 1));
            Assert.That(pixels[0].a, Is.InRange(128, 132), "raised just over the cut, and no further");
            Assert.AreEqual(0, pixels[7].a);

            // What already passes is left as it is.
            var passed = new[] { new Color32(0, 0, 0, 200), new Color32(0, 0, 0, 0) };
            KitAlphaImport.Keep(passed, 0.5f);
            Assert.AreEqual(200, passed[0].a);
        }

        static IEnumerable<string> CutOuts()
        {
            foreach (string guid in AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets/Kits" }))
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                if (KitAlphaImport.OpacityOf(path) != null)
                {
                    yield return path;
                }
            }
        }

        [Test]
        public void TheTemperateKitHasItsCutOuts()
        {
            Assert.That(new List<string>(CutOuts()), Has.Member("Assets/Kits/temperate/Props/fern_02_diff_1k.jpg"));
        }

        // The imported colour's alpha is the opacity file's, at full size: as much of it passes the
        // cut. And a level a sixteenth the size still passes about as much, where plain averaging
        // loses the thin leaves.
        [TestCaseSource(nameof(CutOuts))]
        public void AColourWithAnOpacityFileIsImportedCutOut(string path)
        {
            var imported = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            Assert.IsNotNull(imported, path);
            Assert.IsTrue(GraphicsFormatUtility.HasAlphaChannel(imported.graphicsFormat), $"{imported.graphicsFormat} has no alpha");

            var opacity = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            try
            {
                Assert.IsTrue(opacity.LoadImage(File.ReadAllBytes(KitAlphaImport.OpacityOf(path))), path);
                Color32[] theirs = opacity.GetPixels32();
                int passing = 0;
                foreach (Color32 pixel in theirs)
                {
                    passing += pixel.r >= KitAlphaImport.Cut * 255 ? 1 : 0;
                }
                float wanted = (float)passing / theirs.Length;
                Assert.That(wanted, Is.InRange(0.02f, 0.98f), "the opacity file cuts something out and leaves something");
                Assert.AreEqual(wanted, KitAlphaImport.Coverage(Drawn(imported, 1), 1), 0.01f, $"the share of {path} that is drawn, at full size");
                Assert.AreEqual(wanted, KitAlphaImport.Coverage(Drawn(imported, 16), 1), 0.2f * wanted, $"the share of {path} that is drawn, at a sixteenth of its size");
            }
            finally
            {
                Object.DestroyImmediate(opacity);
            }
        }

        // An imported texture is not readable, so it is drawn into a render texture and read from
        // there: at its own size, or so many times smaller, where the draw takes the texture's
        // own smaller level.
        static Color32[] Drawn(Texture2D texture, int smaller)
        {
            int width = Mathf.Max(1, texture.width / smaller), height = Mathf.Max(1, texture.height / smaller);
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
    }
}
