using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.Bench
{
    // The price list (DEC-953): what each thing in the frame is worth in milliseconds, on this
    // machine, at this quality level and resolution. A run started with `-bench prices` walks into
    // the world and, at two standing views, draws the same view with one thing switched off at a
    // time: each kind of the world's content, then each HDRP feature that is on, then the
    // anti-aliasing, then a quarter of the pixels' width and height. A price is the median frame
    // with the thing, measured just before, less the median without it. The volumetric fog, which
    // PRD v4 8.1.1 keeps on at every level, is also priced at each of its quality levels.
    //
    // Features are switched on the camera, through its own frame settings: no asset is written,
    // and the quality level's HDRP asset stays as the owner set it. The list says what a level is
    // spending; it fills no row of PRD v4 9.5.
    public sealed partial class BenchRunner
    {
        const double PriceSettle = 0.4, PriceSample = 1.2;

        // By name, so that a field this HDRP version does not have is a row that says so and not a
        // script that does not compile. The custom pass is not here: it is the isolated image path,
        // which has its own row.
        static readonly string[] PricedFeatures =
        {
            "ShadowMaps", "ContactShadows", "ScreenSpaceShadows", "SSAO", "SSR", "SSGI", "AtmosphericScattering", "Volumetrics",
            "VolumetricClouds", "Water", "SubsurfaceScattering", "Transmission", "Decals", "MotionVectors", "ObjectMotionVectors",
            "Postprocess", "Bloom", "MotionBlur", "Tonemapping", "ColorGrading", "ExposureControl", "ReflectionProbe", "SkyReflection",
            "ProbeVolume", "LightLayers", "TransparentObjects", "OpaqueObjects",
        };

        readonly List<Dictionary<string, object>> prices = new List<Dictionary<string, object>>();
        double priceMedian;

        // The median frame of the next `PriceSample` seconds, after what was switched has left the frame.
        IEnumerator Median()
        {
            var frames = new FrameSeries(1 << 12);
            yield return Wait(PriceSettle);
            segment.Block = frames;
            yield return Wait(PriceSample);
            segment.Block = null;
            priceMedian = frames.Percentile(50);
        }

        // One row: the view as it is, then with `off` applied, then put back by `on`.
        IEnumerator Price(List<Dictionary<string, object>> rows, string kind, string name, Action off, Action on)
        {
            yield return Median();
            double with = priceMedian;
            off();
            yield return Median();
            double without = priceMedian;
            on();
            rows.Add(new Dictionary<string, object>
            {
                ["kind"] = kind, ["name"] = name, ["state"] = "on", ["withP50Ms"] = Math.Round(with, 3), ["withoutP50Ms"] = Math.Round(without, 3),
                ["priceMs"] = Math.Round(with - without, 3),
            });
        }

        // The volumetric fog at each quality level the HDRP asset defines (its budget and depth
        // ratio by level), set on a volume of the run's own above every other: what the fog costs
        // at that level is the frame with it less the frame with no volumetric fog at all.
        IEnumerator FogQualities(List<Dictionary<string, object>> rows, Camera view, HDAdditionalCameraData data)
        {
            // The camera's own stack: the manager's is not the one this camera was last drawn with.
            HDCamera rendering = HDCamera.GetOrCreate(view);
            Fog inForce = rendering.volumeStack.GetComponent<Fog>();
            if (inForce == null || !inForce.enabled.value || !inForce.enableVolumetricFog.value || !rendering.frameSettings.IsEnabled(FrameSettingsField.Volumetrics))
            {
                rows.Add(Unpriced("fog quality", "low, medium, high", "off: there is no volumetric fog in this view"));
                yield break;
            }
            int levelInForce = inForce.quality.value;

            bool custom = data.customRenderingSettings;
            data.customRenderingSettings = true;
            data.renderingPathCustomFrameSettingsOverrideMask.mask[(uint)FrameSettingsField.Volumetrics] = true;
            data.renderingPathCustomFrameSettings.SetEnabled(FrameSettingsField.Volumetrics, false);
            yield return Median();
            double without = priceMedian;
            data.renderingPathCustomFrameSettingsOverrideMask.mask[(uint)FrameSettingsField.Volumetrics] = false;
            data.customRenderingSettings = custom;

            var holder = new GameObject("Bench fog quality");
            var volume = holder.AddComponent<Volume>();
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            volume.isGlobal = true;
            volume.priority = 1000;
            volume.sharedProfile = profile;
            Fog fog = profile.Add<Fog>();
            string[] names = { "low", "medium", "high" };
            for (int level = 0; level < names.Length; level++)
            {
                fog.quality.levelAndOverride = (level, false);
                fog.quality.overrideState = true;
                yield return Median();
                rows.Add(new Dictionary<string, object>
                {
                    ["kind"] = "fog quality", ["name"] = names[level], ["state"] = level == levelInForce ? "the level in force" : "on",
                    ["withP50Ms"] = Math.Round(priceMedian, 3), ["withoutP50Ms"] = Math.Round(without, 3), ["priceMs"] = Math.Round(priceMedian - without, 3),
                });
            }
            Destroy(holder);
            Destroy(profile);
        }

        static Dictionary<string, object> Unpriced(string kind, string name, string state) => new Dictionary<string, object>
        {
            ["kind"] = kind, ["name"] = name, ["state"] = state, ["withP50Ms"] = null, ["withoutP50Ms"] = null, ["priceMs"] = null,
        };

        IEnumerator Prices(string where)
        {
            Begin($"prices-{where}", null);
            Camera view = Camera.main;
            var data = view.GetComponent<HDAdditionalCameraData>();
            var rows = new List<Dictionary<string, object>>();

            // The world's content, a kind at a time, and then all of it: what is left is the sky,
            // the light and the pipeline's own work on every pixel.
            GameObject props = app.Props != null ? app.Props.gameObject : null, stands = app.Stands.gameObject, images = app.Images.gameObject;
            GameObject water = app.Water;
            void Ours(bool shown)
            {
                props?.SetActive(shown);
                stands.SetActive(shown);
                images.SetActive(shown);
                water?.SetActive(shown);
                app.Ground.enabled = shown;
                app.Avatar.Shown = shown;
                app.Exhibit.PassEnabled = shown;
            }
            if (props != null)
            {
                yield return Price(rows, "content", "props", () => props.SetActive(false), () => props.SetActive(true));
            }
            yield return Price(rows, "content", "stands", () => stands.SetActive(false), () => stands.SetActive(true));
            yield return Price(rows, "content", "image surfaces", () => images.SetActive(false), () => images.SetActive(true));
            yield return Price(rows, "content", "isolated image path", () => app.Exhibit.PassEnabled = false, () => app.Exhibit.PassEnabled = true);
            yield return Price(rows, "content", "ground", () => app.Ground.enabled = false, () => app.Ground.enabled = true);
            if (water != null)
            {
                yield return Price(rows, "content", "water surfaces", () => water.SetActive(false), () => water.SetActive(true));
            }
            yield return Price(rows, "content", "everything of the world's", () => Ours(false), () => Ours(true));
            double emptyWorld = priceMedian;

            // The HDRP features that are on for this camera, each switched off on the camera alone.
            FrameSettings inForce = HDCamera.GetOrCreate(view).frameSettings;
            bool custom = data.customRenderingSettings;
            data.customRenderingSettings = true;
            foreach (string name in PricedFeatures)
            {
                if (!Enum.TryParse(name, out FrameSettingsField field))
                {
                    rows.Add(Unpriced("feature", name, "not in this HDRP version"));
                    continue;
                }
                if (!inForce.IsEnabled(field))
                {
                    rows.Add(Unpriced("feature", name, "off"));
                    continue;
                }
                yield return Price(rows, "feature", name,
                    () =>
                    {
                        data.renderingPathCustomFrameSettingsOverrideMask.mask[(uint)field] = true;
                        data.renderingPathCustomFrameSettings.SetEnabled(field, false);
                    },
                    () => data.renderingPathCustomFrameSettingsOverrideMask.mask[(uint)field] = false);
            }
            data.customRenderingSettings = custom;

            yield return FogQualities(rows, view, data);

            HDAdditionalCameraData.AntialiasingMode antialiasing = data.antialiasing;
            if (antialiasing != HDAdditionalCameraData.AntialiasingMode.None)
            {
                yield return Price(rows, "camera", $"anti-aliasing ({antialiasing})",
                    () => data.antialiasing = HDAdditionalCameraData.AntialiasingMode.None, () => data.antialiasing = antialiasing);
            }
            else
            {
                rows.Add(Unpriced("camera", "anti-aliasing", "off"));
            }

            // Three quarters of the width and of the height: 56% of the pixels. A frame that gets
            // cheaper by nearly as much is spent on pixels, not on objects or on the CPU.
            // The row names the size the pipeline rendered at, read from it: a display may not take
            // the smaller size, and then there is no price.
            if (!Application.isEditor)
            {
                int width = Screen.width, height = Screen.height;
                yield return Median();
                double with = priceMedian;
                Screen.SetResolution(width * 3 / 4, height * 3 / 4, FullScreenMode.FullScreenWindow);
                yield return Wait(1);
                yield return Median();
                double without = priceMedian;
                HDCamera rendering = HDCamera.GetOrCreate(view);
                int smallerWidth = rendering.actualWidth, smallerHeight = rendering.actualHeight;
                Screen.SetResolution(width, height, FullScreenMode.FullScreenWindow);
                yield return Wait(1);
                if (smallerWidth < width)
                {
                    rows.Add(new Dictionary<string, object>
                    {
                        ["kind"] = "pixels", ["name"] = $"{width} x {height} against {smallerWidth} x {smallerHeight}", ["state"] = "on",
                        ["withP50Ms"] = Math.Round(with, 3), ["withoutP50Ms"] = Math.Round(without, 3), ["priceMs"] = Math.Round(with - without, 3),
                    });
                }
                else
                {
                    rows.Add(Unpriced("pixels", $"{width} x {height} against {width * 3 / 4} x {height * 3 / 4}", $"the display did not take the smaller size: the pipeline still rendered at {smallerWidth} x {smallerHeight}"));
                }
            }
            else
            {
                rows.Add(Unpriced("pixels", "three quarters of the width and height", "not in the editor host: its view is a texture of a fixed size"));
            }

            yield return Median();
            prices.Add(new Dictionary<string, object>
            {
                ["where"] = where, ["p50Ms"] = Math.Round(priceMedian, 3), ["emptyWorldP50Ms"] = Math.Round(emptyWorld, 3),
                ["sampleSeconds"] = PriceSample, ["rows"] = rows,
            });
        }
    }
}
