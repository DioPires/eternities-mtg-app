using System.IO;
using UnityEditor;
using UnityEngine;

namespace Eternities.EditorTools
{
    // A kit's photograph of leaves comes as two files, as its source publishes it: the colour, a
    // JPG, and beside it the opacity, a grey PNG (`_diff_` and `_alpha_` in the same name). HDRP's
    // lit shader cuts a leaf out by the alpha of its colour map. This writes the opacity into the
    // colour's alpha while the colour is imported, so both files keep the bytes `sources.yaml`
    // pins and no texture is written out again (the prop conditioning rule, `PropRule`).
    //
    // A smaller level of a cut-out thins as its alpha is averaged: a far bush loses its leaves.
    // Each level's alpha is scaled until as much of it passes the cut as passes at full size.
    //
    // As with `KitMaskImport`, alpha from grey scale makes the importer keep a channel for a JPG,
    // and the setting is also in the committed `.meta`, so an import changes no file.
    public sealed class KitAlphaImport : AssetPostprocessor
    {
        // The cut: a texel under it is not drawn. The kit's cut-out materials use the same.
        public const float Cut = 0.5f;

        // Raise it with any change to what is written: the editor then imports the textures again.
        public override uint GetVersion() => 1;

        // The opacity file beside a colour file, or null: a kit's `<name>_diff_<size>.jpg` has
        // `<name>_alpha_<size>.png`.
        public static string OpacityOf(string assetPath)
        {
            string file = Path.GetFileName(assetPath);
            if (!assetPath.StartsWith("Assets/Kits/") || !file.Contains("_diff_"))
            {
                return null;
            }
            string beside = $"{Path.GetDirectoryName(assetPath)}/{Path.GetFileNameWithoutExtension(file).Replace("_diff_", "_alpha_")}.png".Replace('\\', '/');
            return File.Exists(beside) ? beside : null;
        }

        // The share of the opacities that pass the cut when each is multiplied by `scale`.
        public static float Coverage(Color32[] pixels, float scale)
        {
            int passed = 0;
            foreach (Color32 pixel in pixels)
            {
                passed += pixel.a * scale >= Cut * 255 ? 1 : 0;
            }
            return (float)passed / pixels.Length;
        }

        // In place: the alphas scaled so that `coverage` of them pass the cut, as nearly as a
        // scale from 1 to 8 gives it.
        public static void Keep(Color32[] pixels, float coverage)
        {
            float low = 1, high = 8;
            for (int step = 0; step < 12; step++)
            {
                float middle = (low + high) / 2;
                if (Coverage(pixels, middle) < coverage)
                {
                    low = middle;
                }
                else
                {
                    high = middle;
                }
            }
            float scale = Coverage(pixels, 1) >= coverage ? 1 : high;
            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i].a = (byte)Mathf.Min(255, Mathf.RoundToInt(pixels[i].a * scale));
            }
        }

        void OnPreprocessTexture()
        {
            if (OpacityOf(assetPath) == null)
            {
                return;
            }
            var importer = (TextureImporter)assetImporter;
            importer.alphaSource = TextureImporterAlphaSource.FromGrayScale;
            importer.alphaIsTransparency = false;
        }

        // Called before the texture is compressed.
        void OnPostprocessTexture(Texture2D texture)
        {
            string beside = OpacityOf(assetPath);
            if (beside == null)
            {
                return;
            }
            context.DependsOnSourceAsset(beside);
            // The opacity file, read here with every smaller level of its own.
            var opacity = new Texture2D(2, 2, TextureFormat.RGBA32, true, true);
            try
            {
                if (!opacity.LoadImage(File.ReadAllBytes(beside)))
                {
                    throw new InvalidDataException($"{beside} is not a picture");
                }
                // The colour may be imported smaller than its file: then its first level is one
                // of the opacity's smaller ones.
                int first = 0;
                while (opacity.width >> first > texture.width)
                {
                    first++;
                }
                if (opacity.width >> first != texture.width || opacity.height >> first != texture.height)
                {
                    throw new InvalidDataException($"{beside} is {opacity.width} x {opacity.height} and {assetPath} is imported at {texture.width} x {texture.height}: not the same picture at another size");
                }
                float coverage = -1;
                for (int mip = 0; mip < texture.mipmapCount; mip++)
                {
                    Color32[] pixels = texture.GetPixels32(mip);
                    Color32[] theirs = opacity.GetPixels32(Mathf.Min(first + mip, opacity.mipmapCount - 1));
                    if (theirs.Length != pixels.Length)
                    {
                        break;
                    }
                    for (int i = 0; i < pixels.Length; i++)
                    {
                        pixels[i].a = theirs[i].r;
                    }
                    if (coverage < 0)
                    {
                        coverage = Coverage(pixels, 1);
                    }
                    else
                    {
                        Keep(pixels, coverage);
                    }
                    texture.SetPixels32(pixels, mip);
                }
            }
            finally
            {
                Object.DestroyImmediate(opacity);
            }
        }
    }
}
