using System.Linq;
using Eternities.Data;
using Eternities.Kits;
using NUnit.Framework;
using UnityEngine;

namespace Eternities.Tests
{
    // The greybox of PRD v4 9.6 (leg 1), built from the committed Dominaria fixture as the world's
    // load builds it from the pack.
    public class GreyboxTests
    {
        [Test]
        public void DominariasGreyboxHoldsEveryPathPadLineAndStone()
        {
            LayoutFixtures.Fixture fixture = LayoutFixtures.Named("dominaria");
            var pack = new Pack(fixture.Pack);
            PackPlane plane = pack.Plane("dominaria");
            var root = new GameObject("greybox test");
            var materials = Enumerable.Range(0, Greybox.Materials).Select(_ => new Material(Shader.Find("HDRP/Lit"))).ToArray();
            try
            {
                using (WorldData world = WorldData.Decode(pack.Planes, plane, pack.Cards(plane), fixture.Stands, WorldDocument.Read(fixture.World), LoreDocument.Read(fixture.Lore)))
                {
                    Greybox greybox = Greybox.Build(world, materials, root.transform);
                    // A strip for each site's path and approach, each trail leg and spur, and the
                    // plaza approach; a disc for each pad; a line for each of the 12 regions; a
                    // stone for each site and each chapter after a site's first.
                    Assert.That(greybox.Strips, Is.EqualTo(2 * 26 + 26 + 1));
                    Assert.That(greybox.Pads, Is.EqualTo(27));
                    Assert.That(greybox.Lines, Is.EqualTo(12));
                    Assert.That(greybox.Stones, Is.EqualTo(26 + 22));
                    Assert.That(greybox.GroundRadius, Is.EqualTo(838.394f + Greybox.GroundMargin).Within(1e-3f));
                    Mesh drawn = greybox.Ground.GetComponent<MeshFilter>().sharedMesh;
                    Assert.That(drawn.subMeshCount, Is.EqualTo(4));
                    Assert.That(greybox.Ground.sharedMaterials, Is.EqualTo(materials.Take(4).ToArray()));
                    for (int layer = 0; layer < 4; layer++)
                    {
                        Assert.That(drawn.GetIndexCount(layer), Is.GreaterThan(0), $"submesh {layer}");
                    }
                    // Everything drawn lies flat on the ground and within it.
                    Bounds bounds = drawn.bounds;
                    Assert.That(bounds.max.y, Is.LessThanOrEqualTo(Greybox.PadLift + 1e-4f));
                    Assert.That(bounds.extents.x, Is.LessThanOrEqualTo(greybox.GroundRadius + 1e-3f));
                    // The avatar stands on a flat box as wide as the ground, its top at the ground level.
                    var floor = greybox.Ground.GetComponent<BoxCollider>();
                    Assert.That(floor.center.y + floor.size.y / 2, Is.EqualTo(0).Within(1e-5f));
                    Assert.That(floor.size.x, Is.EqualTo(2 * greybox.GroundRadius).Within(1e-2f));
                    Assert.That(greybox.Ground.GetComponent<MeshCollider>(), Is.Null);
                    // A reading stone stands 2 m tall, the others 1 m.
                    Transform stone = greybox.transform.Find("stone of era:first-ages");
                    Assert.That(stone.GetComponent<Renderer>().bounds.size.y, Is.EqualTo(Greybox.ReadingHeight).Within(1e-3f));
                    Transform marker = greybox.transform.Find("stone of region:benalia");
                    Assert.That(marker.GetComponent<Renderer>().bounds.size.y, Is.EqualTo(Greybox.LowHeight).Within(1e-3f));
                }
            }
            finally
            {
                Object.DestroyImmediate(root);
                foreach (Material material in materials)
                {
                    Object.DestroyImmediate(material);
                }
            }
        }
    }
}
