using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;

namespace Eternities.Tests
{
    public class GraphicsDeviceTests
    {
        // PRD v4 8.8.3: PlayMode runs in batchmode with graphics. Under `-nographics` the device is
        // Null and nothing in this suite renders.
        [Test]
        public void PlayModeHasAGraphicsDevice()
        {
            Assert.AreNotEqual(GraphicsDeviceType.Null, SystemInfo.graphicsDeviceType);
        }
    }
}
