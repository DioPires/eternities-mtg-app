using System.Collections;
using System.IO;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using Eternities.Travel;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace Eternities.Tests
{
    public class WorldTests
    {
        // CI checks out clean, so the world's files are made here the way the generation entry
        // point makes them: from the repository's copy of the pinned pack.
        [OneTimeSetUp]
        public void MakeTheWorldsFiles()
        {
            string target = App.PackDirectory();
            string source = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", Path.GetFileName(target)));
            WorldFiles.Generate(source, target, App.HomeWorld);
        }

        // PRD v4 8.8.3: a world loads and places the pack's stands.
        [UnityTest]
        public IEnumerator DominariaLoadsAndPlacesThePacksStands()
        {
            yield return SceneManager.LoadSceneAsync("Assets/Scenes/Hub.unity", LoadSceneMode.Single);
            float until = Time.realtimeSinceStartup + 60;
            while (App.Instance == null || !(App.Instance.WorldReady || App.Instance.Failure != null))
            {
                Assert.That(Time.realtimeSinceStartup, Is.LessThan(until), "the world did not load in 60 s");
                yield return null;
            }
            App app = App.Instance;
            Assert.That(app.Failure, Is.Null);
            Assert.That(app.Stands.Stands, Is.EqualTo(6271));
            Assert.That(app.Stands.Sites, Is.EqualTo(233));
            Assert.That(app.Ground.terrainData.heightmapResolution, Is.EqualTo(2049));
            Assert.That(app.Ground.terrainData.size.x, Is.GreaterThanOrEqualTo(2 * app.World.Layout.WorldRadius / 1000f));

            // A stand is where its layout says: straight down onto it is the top of its slab, and a
            // step in front of it, on its apron, is the ground.
            yield return new WaitForFixedUpdate();
            LayoutStand stand = app.World.Layout.Stands[0];
            Vector3 at = StandField.Ground(stand.Position);
            Assert.That(Physics.Raycast(at + 10 * Vector3.up, Vector3.down, out RaycastHit hit, 20));
            Assert.That(hit.point.y, Is.EqualTo(StandField.PlinthHeight + StandField.SurfaceHeight).Within(0.01f));
            Vector3 apron = at + StandField.Facing(stand) * Vector3.forward;
            Assert.That(Physics.Raycast(apron + 10 * Vector3.up, Vector3.down, out hit, 20));
            Assert.That(hit.point.y, Is.EqualTo(0).Within(0.01f));
        }
    }
}
