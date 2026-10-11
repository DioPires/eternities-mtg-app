using Eternities.Bench;
using NUnit.Framework;
using UnityEngine;

namespace Eternities.Tests
{
    public class BenchRunTests
    {
        // A run is not paced by the display at any quality level (DEC-953). Each level carries a
        // vsync count of its own, 1 in this project, and entering a level puts it in force. The
        // test is a PlayMode one because it changes the level: in edit mode that marks the
        // project's quality settings as changed, and the editor then rewrites their file.
        [Test]
        public void ARunAtAnyQualityLevelIsNotPacedByTheDisplay([Values("high", "medium", "low", null)] string level)
        {
            int before = QualitySettings.GetQualityLevel(), frameRate = Application.targetFrameRate;
            int[] vsync = new int[QualitySettings.names.Length];
            for (int i = 0; i < vsync.Length; i++)
            {
                QualitySettings.SetQualityLevel(i, applyExpensiveChanges: false);
                vsync[i] = QualitySettings.vSyncCount;
            }
            QualitySettings.SetQualityLevel(before, applyExpensiveChanges: false);
            try
            {
                Assert.That(vsync, Has.Some.GreaterThan(0), "a level of this project asks for vsync, or this test proves nothing");
                Assert.That(BenchRunner.EnterLevel(level), Is.True);
                Assert.That(QualitySettings.names[QualitySettings.GetQualityLevel()], Is.EqualTo(level ?? QualitySettings.names[before]));
                Assert.That(QualitySettings.vSyncCount, Is.EqualTo(0));
                Assert.That(Application.targetFrameRate, Is.EqualTo(-1));
                Assert.That(BenchRunner.EnterLevel("ultra"), Is.False);
            }
            finally
            {
                for (int i = 0; i < vsync.Length; i++)
                {
                    QualitySettings.SetQualityLevel(i, applyExpensiveChanges: false);
                    QualitySettings.vSyncCount = vsync[i];
                }
                QualitySettings.SetQualityLevel(before, applyExpensiveChanges: false);
                Application.targetFrameRate = frameRate;
            }
        }
    }
}
