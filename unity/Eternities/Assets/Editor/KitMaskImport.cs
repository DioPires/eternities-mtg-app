using System.IO;
using UnityEditor;
using UnityEngine;

namespace Eternities.EditorTools
{
    // A kit's `_arm_` texture holds ambient occlusion, roughness and metalness in R, G and B, which
    // is how its source publishes it (`Assets/Kits/<kit>/CREDITS.md`). HDRP's mask map wants
    // metallic, ambient occlusion, a detail mask (the height, on a terrain layer) and smoothness in
    // R, G, B and A. This repacks the pixels while the texture is imported, so the file keeps the
    // bytes `sources.yaml` pins and the imported texture is assigned as a mask map as it is.
    //
    // A source that publishes roughness and ambient occlusion as two grey files (ambientCG) has
    // them in the kit as `_rough_` and `_ao_` in the same name. The roughness file is then the
    // mask's source, and the occlusion is read from the file beside it; such a ground has no metal.
    //
    // A JPG has no alpha, and the importer drops the channel of a texture it reads as opaque. Alpha
    // from grey scale makes it keep one; every value in it is then overwritten below. Both import
    // settings are also in the committed `.meta`, so an import changes no file (the compile job
    // checks that the tree stays as committed).
    public sealed class KitMaskImport : AssetPostprocessor
    {
        // No kit texture carries a height, so every texel gets the same one and a height-based blend
        // between terrain layers has nothing to act on.
        public const byte Height = 128;

        // Raise it with any change to what `Repack` or `Pack` write: the editor then imports the
        // textures again.
        public override uint GetVersion() => 1;

        public static bool IsMaskSource(string assetPath)
        {
            return assetPath.StartsWith("Assets/Kits/") && (Path.GetFileName(assetPath).Contains("_arm_") || OcclusionOf(assetPath) != null);
        }

        // The ambient occlusion file beside a roughness file, or null: a kit's `<name>_rough_<size>.jpg`
        // has `<name>_ao_<size>.jpg`.
        public static string OcclusionOf(string assetPath)
        {
            string file = Path.GetFileName(assetPath);
            if (!assetPath.StartsWith("Assets/Kits/") || !file.Contains("_rough_"))
            {
                return null;
            }
            string beside = $"{Path.GetDirectoryName(assetPath)}/{file.Replace("_rough_", "_ao_")}".Replace('\\', '/');
            return File.Exists(beside) ? beside : null;
        }

        // In place. Smoothness is one minus roughness.
        public static void Repack(Color32[] pixels)
        {
            for (int i = 0; i < pixels.Length; i++)
            {
                Color32 arm = pixels[i];
                pixels[i] = new Color32(arm.b, arm.r, Height, (byte)(255 - arm.g));
            }
        }

        // In place, from two grey pictures of the same size: `pixels` holds the roughness.
        public static void Pack(Color32[] pixels, Color32[] occlusion)
        {
            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i] = new Color32(0, occlusion[i].r, Height, (byte)(255 - pixels[i].r));
            }
        }

        void OnPreprocessTexture()
        {
            if (!IsMaskSource(assetPath))
            {
                return;
            }
            var importer = (TextureImporter)assetImporter;
            importer.sRGBTexture = false;
            importer.alphaSource = TextureImporterAlphaSource.FromGrayScale;
        }

        // Called before the texture is compressed. Each mip level is repacked from its own pixels:
        // the repack is linear per channel, so that equals the mip chain of the repacked level 0.
        void OnPostprocessTexture(Texture2D texture)
        {
            if (!IsMaskSource(assetPath))
            {
                return;
            }
            string beside = OcclusionOf(assetPath);
            Texture2D occlusion = null;
            if (beside != null)
            {
                context.DependsOnSourceAsset(beside);
                // The occlusion file, read here with every smaller level of its own.
                occlusion = new Texture2D(2, 2, TextureFormat.RGBA32, true, true);
                if (!occlusion.LoadImage(File.ReadAllBytes(beside)) || occlusion.width != texture.width || occlusion.height != texture.height)
                {
                    Object.DestroyImmediate(occlusion);
                    throw new InvalidDataException($"{beside} is not a picture of the size {assetPath} is imported at, {texture.width} x {texture.height}");
                }
            }
            for (int mip = 0; mip < texture.mipmapCount; mip++)
            {
                Color32[] pixels = texture.GetPixels32(mip);
                if (occlusion == null)
                {
                    Repack(pixels);
                }
                else
                {
                    Pack(pixels, occlusion.GetPixels32(mip));
                }
                texture.SetPixels32(pixels, mip);
            }
            Object.DestroyImmediate(occlusion);
        }
    }
}
