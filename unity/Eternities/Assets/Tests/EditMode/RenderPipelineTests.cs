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
    }
}
