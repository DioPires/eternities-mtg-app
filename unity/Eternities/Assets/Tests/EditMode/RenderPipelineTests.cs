using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.Tests
{
    // PRD v4 8.1.1: HDRP only, at three quality levels. The bench and the settings screen select a
    // level by name, so the names and their order are part of the project, not of the editor's UI.
    public class RenderPipelineTests
    {
        [Test]
        public void TheActivePipelineIsHdrp()
        {
            Assert.IsInstanceOf<HDRenderPipelineAsset>(GraphicsSettings.currentRenderPipeline);
        }

        [Test]
        public void TheQualityLevelsAreHighMediumLow()
        {
            CollectionAssert.AreEqual(new[] { "high", "medium", "low" }, QualitySettings.names);
        }

        // A level with no asset of its own falls back to the default pipeline asset, which would make
        // two levels render the same thing under different names.
        [Test]
        public void EveryQualityLevelHasAnHdrpAssetOfItsOwn()
        {
            RenderPipelineAsset[] assets = Enumerable.Range(0, QualitySettings.names.Length)
                .Select(QualitySettings.GetRenderPipelineAssetAt)
                .ToArray();
            CollectionAssert.AllItemsAreInstancesOfType(assets, typeof(HDRenderPipelineAsset));
            CollectionAssert.AllItemsAreUnique(assets);
        }

        static readonly string[] Levels = { "high", "medium", "low" };

        static HDRenderPipelineAsset AssetOf(string level) =>
            (HDRenderPipelineAsset)QualitySettings.GetRenderPipelineAssetAt(System.Array.IndexOf(QualitySettings.names, level));

        // PRD v4 8.1.1 and 5.7.1 fix four things about a level; the rest of a level is judged by
        // eye. With one of them off, what depends on it is not drawn and says nothing: no river
        // and no lake, no resolution scale for row R3 of 9.5 and for tests (e) and (f) of 8.4.4.

        // Water at every level: the river and the lake are HDRP water surfaces.
        [Test]
        public void WaterIsOnAtEveryLevel([ValueSource(nameof(Levels))] string level)
        {
            Assert.That(AssetOf(level).currentPlatformRenderPipelineSettings.supportWater, Is.True);
        }

        // Dynamic resolution enabled and not forced, from 75% to 100%: a level renders at full
        // resolution until something asks for less, and the bench can ask for 0.75.
        [Test]
        public void DynamicResolutionIsEnabledAndNotForcedAtEveryLevel([ValueSource(nameof(Levels))] string level)
        {
            GlobalDynamicResolutionSettings settings = AssetOf(level).currentPlatformRenderPipelineSettings.dynamicResolutionSettings;
            Assert.That(settings.enabled, Is.True);
            Assert.That(settings.forceResolution, Is.False);
            Assert.That(settings.minPercentage, Is.LessThanOrEqualTo(75f));
            Assert.That(settings.maxPercentage, Is.EqualTo(100f));
        }

        // Volumetric fog at every level. At low it is at the lowest quality whichever quality the
        // sky's fog asks for: every tier of the low asset has the budget of its lowest.
        [Test]
        public void VolumetricFogIsOnAtEveryLevelAndAtItsLowestQualityAtLow([ValueSource(nameof(Levels))] string level)
        {
            RenderPipelineSettings settings = AssetOf(level).currentPlatformRenderPipelineSettings;
            Assert.That(settings.supportVolumetrics, Is.True);
            if (level == "low")
            {
                float[] budget = settings.lightingQualitySettings.Fog_Budget;
                Assert.That(budget, Is.All.EqualTo(budget.Min()));
                Assert.That(budget[0], Is.LessThan(AssetOf("medium").currentPlatformRenderPipelineSettings.lightingQualitySettings.Fog_Budget.Min()));
            }
        }

        // Volumetric clouds at high and medium, a cloud layer in their place at low. The HDRP asset
        // holds whether the level can draw volumetric clouds; the level's own volume profile, which
        // the asset names, holds which kind of cloud the level has.
        [Test]
        public void CloudsAreVolumetricAtHighAndMediumAndALayerAtLow([ValueSource(nameof(Levels))] string level)
        {
            HDRenderPipelineAsset asset = AssetOf(level);
            VolumeProfile profile = asset.volumeProfile;
            Assert.That(profile, Is.Not.Null, "the level's HDRP asset names a volume profile");
            Assert.That(UnityEditor.AssetDatabase.GetAssetPath(profile), Is.EqualTo(EditorTools.Generate.LevelProfile(level)));
            bool volumetric = profile.TryGet(out VolumetricClouds clouds) && clouds.active && clouds.enable.overrideState && clouds.enable.value;
            bool layer = profile.TryGet(out VisualEnvironment environment) && environment.active && environment.cloudType.overrideState
                && environment.cloudType.value == (int)CloudType.CloudLayer;
            Assert.That(asset.currentPlatformRenderPipelineSettings.supportVolumetricClouds, Is.EqualTo(level != "low"));
            Assert.That(volumetric, Is.EqualTo(level != "low"), "volumetric clouds");
            Assert.That(layer, Is.EqualTo(level == "low"), "a cloud layer");
        }
    }
}
