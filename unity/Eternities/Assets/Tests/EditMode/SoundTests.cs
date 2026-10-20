using Eternities.Audio;
using NUnit.Framework;
using UnityEngine;

namespace Eternities.Tests
{
    // The water's attenuation (PRD v4 5.12.3; the owner's walk on DEC-1005): a river is heard
    // before it is seen, and out of sight it is faint. The figures are a river's source, full
    // within 6 m and silent from 140 m (`App.BuildSound`).
    public class SoundTests
    {
        const float Near = 6, Far = 140;

        [Test]
        public void WaterFallsOffByTheInverseDistanceAndEndsAtItsFarDistance()
        {
            Assert.That(WorldSound.Level(0, Near, Far), Is.EqualTo(1));
            Assert.That(WorldSound.Level(Near, Near, Far), Is.EqualTo(1));
            Assert.That(WorldSound.Level(2 * Near, Near, Far), Is.EqualTo(0.5f).Within(1e-5f), "half the level at twice the near distance");
            Assert.That(WorldSound.Level(Far, Near, Far), Is.Zero);
            float before = 1;
            for (float distance = Near; distance <= Far; distance += 0.5f)
            {
                float level = WorldSound.Level(distance, Near, Far);
                Assert.That(level, Is.LessThanOrEqualTo(before), $"at {distance} m");
                before = level;
            }
            // Heard, and faint: at 70 m, out of sight behind a wood, a tenth of its level or less;
            // the linear fall it replaced played a half there.
            Assert.That(WorldSound.Level(70, Near, Far), Is.InRange(0.03f, 0.1f));
        }

        // The engine reads the law from a curve over the distance as a share of the far distance;
        // the curve is the law, between its keys too.
        [Test]
        public void TheRolloffCurveIsTheLaw()
        {
            AnimationCurve curve = WorldSound.Rolloff(Near, Far);
            for (float distance = 0; distance <= Far; distance += 0.25f)
            {
                Assert.That(curve.Evaluate(distance / Far), Is.EqualTo(WorldSound.Level(distance, Near, Far)).Within(0.02f), $"at {distance} m");
            }
        }
    }
}
