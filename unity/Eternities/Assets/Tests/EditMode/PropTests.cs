using System;
using System.Collections.Generic;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using NUnit.Framework;
using UnityEngine;

namespace Eternities.Tests
{
    // PRD v4 8.4.2: a world's prop scatter is seeded, runs after the pack is read, and keeps the
    // 1 m prop clearance of 5.4.1 from stands, aprons, corridors, paths and pads. And 5.6.3: what
    // grows says which wedge a visitor is in.
    //
    // The distances here are this file's own, to shapes rebuilt from the layout as the checker
    // rebuilds them, and against every shape: nothing of the scatter's buckets is trusted.
    public class PropTests
    {
        static WorldLayout layout;
        static GroundPlan ground;
        static PropPlan props;

        [OneTimeSetUp]
        public void PlanDominaria()
        {
            layout = Layout("dominaria");
            ground = GroundPlan.Compute(layout);
            props = PropPlan.Compute(layout, ground);
        }

        static WorldLayout Layout(string slug)
        {
            var pack = new Pack(TestPack.Directory);
            PackPlane plane = pack.Plane(slug);
            return Allocator.Run(LayoutInputs.From(plane, pack.Cards(plane)));
        }

        // From a point to the rectangle `from` to `to` along `forward` and `half` to each side of it.
        static double ToRect(double x, double z, double originX, double originZ, double forwardX, double forwardZ, double from, double to, double half)
        {
            double along = (x - originX) * forwardX + (z - originZ) * forwardZ, across = Math.Abs((x - originX) * forwardZ - (z - originZ) * forwardX);
            double beyond = Math.Max(Math.Max(from - along, along - to), 0), aside = Math.Max(across - half, 0);
            return Math.Sqrt(beyond * beyond + aside * aside);
        }

        static double ToSegment(double x, double z, P2 a, P2 b)
        {
            double ax = a.X / 1000.0, az = a.Z / 1000.0, ex = b.X / 1000.0 - ax, ez = b.Z / 1000.0 - az;
            double t = Math.Max(0, Math.Min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
            return Math.Sqrt((x - ax - ex * t) * (x - ax - ex * t) + (z - az - ez * t) * (z - az - ez * t));
        }

        // How far a point is from the nearest thing the allocator placed, and what that is.
        static double Room(WorldLayout world, double x, double z, out string nearest)
        {
            double r = Math.Sqrt(x * x + z * z);
            double room = r - world.PlazaRadius / 1000.0;
            nearest = "the plaza";
            void Take(double distance, string what, ref string named)
            {
                if (distance < room)
                {
                    room = distance;
                    named = what;
                }
            }
            foreach (LayoutPath path in world.Paths)
            {
                if (path.Kind == PathKind.Ring)
                {
                    Take(Math.Max(Math.Max(path.Inner / 1000.0 - r, r - path.Outer / 1000.0), 0), $"ring path {path.Id}", ref nearest);
                }
                else if (path.Kind == PathKind.Radial)
                {
                    double angle = path.Angle / 1e6 * Math.PI / 180;
                    Take(ToRect(x, z, 0, 0, Math.Sin(angle), Math.Cos(angle), path.Inner / 1000.0, path.Outer / 1000.0, LayoutConstants.PathWidth / 2000.0), $"radial path {path.Id}", ref nearest);
                }
                else
                {
                    // A spur is thin and the point is outside it or the stands' test fails first:
                    // the distance to its outline.
                    for (int i = 0; i < path.Quad.Length; i++)
                    {
                        Take(ToSegment(x, z, path.Quad[i], path.Quad[(i + 1) % path.Quad.Length]), $"spur {path.Id}", ref nearest);
                    }
                }
            }
            foreach (LayoutPad pad in world.Pads)
            {
                double dx = x - pad.Centre.X / 1000.0, dz = z - pad.Centre.Z / 1000.0;
                Take(Math.Sqrt(dx * dx + dz * dz) - pad.Radius / 1000.0, $"a {pad.Kind} pad", ref nearest);
            }
            double footprintHalfDepth = LayoutConstants.FootprintHalfDepth / 1000.0, front = footprintHalfDepth + LayoutConstants.ApronDepth / 1000.0;
            for (int i = 0; i < world.Stands.Count; i++)
            {
                LayoutStand stand = world.Stands[i];
                double sx = stand.Position.X / 1000.0, sz = stand.Position.Z / 1000.0;
                double yaw = stand.Yaw / 1e6 * Math.PI / 180, fx = Math.Sin(yaw), fz = Math.Cos(yaw);
                double length = (stand.PathPoint.X / 1000.0 - sx) * fx + (stand.PathPoint.Z / 1000.0 - sz) * fz;
                if (Math.Abs(x - sx) > length + 10 || Math.Abs(z - sz) > length + 10)
                {
                    continue;
                }
                Take(ToRect(x, z, sx, sz, fx, fz, -footprintHalfDepth, footprintHalfDepth, LayoutConstants.FootprintHalfWidth / 1000.0), $"the footprint of stand {i}", ref nearest);
                Take(ToRect(x, z, sx, sz, fx, fz, footprintHalfDepth, front, LayoutConstants.ApronHalfWidth / 1000.0), $"the apron of stand {i}", ref nearest);
                Take(ToRect(x, z, sx, sz, fx, fz, front, length, LayoutConstants.CorridorHalfWidth / 1000.0), $"the corridor of stand {i}", ref nearest);
            }
            return room;
        }

        static void AssertClear(WorldLayout world, GroundPlan plan, PropPlan scatter, out double tightest)
        {
            tightest = double.PositiveInfinity;
            foreach (Prop prop in scatter.Props)
            {
                PropKind kind = Temperate.Kinds[prop.Kind];
                double room = Room(world, prop.X, prop.Z, out string nearest) - kind.Footprint * prop.Scale;
                tightest = Math.Min(tightest, room);
                Assert.That(room, Is.GreaterThanOrEqualTo(LayoutConstants.PropClearance / 1000.0 - 1e-3),
                    $"a {kind.Model} at ({prop.X:F2}, {prop.Z:F2}), {kind.Footprint * prop.Scale:F2} m in radius, is {room:F3} m from {nearest}");
                Assert.That(prop.Scale, Is.InRange(kind.ScaleFrom, kind.ScaleTo));
                Assert.That(prop.Y, Is.EqualTo(plan.HeightAt(prop.X, prop.Z)), "a prop stands on the ground");
                Assert.That(Mathf.Max(Mathf.Abs(prop.X), Mathf.Abs(prop.Z)), Is.LessThan(plan.Side / 2 - PropPlan.Cell), "and on the terrain, a cell from its edge");
            }
        }

        [Test]
        public void EveryPropKeepsTheClearanceFromEverythingTheAllocatorPlaced()
        {
            AssertClear(layout, ground, props, out double tightest);
            Debug.Log($"PropTests: {props.Props.Count} props on Dominaria; the nearest keeps {tightest:F3} m of clearance");
            Assert.That(tightest, Is.LessThan(1.5), "the scatter uses the ground it may: something stands near the limit");
        }

        // A tree does not grow out of a rock (DEC-953): no trunk stands inside a rock's footprint.
        // The first scatter had a pine through a boulder beside the stand of the bench's site
        // capture. Every rock is tried against every tree, with this file's own distances.
        [Test]
        public void NoTreeGrowsOutOfARock()
        {
            int rocks = 0, trees = 0;
            double nearest = double.PositiveInfinity;
            foreach (Prop rock in props.Props)
            {
                PropKind stone = Temperate.Kinds[rock.Kind];
                if (!stone.Block)
                {
                    continue;
                }
                rocks++;
                trees = 0;
                foreach (Prop tree in props.Props)
                {
                    PropKind wood = Temperate.Kinds[tree.Kind];
                    if (wood.Trunk <= 0)
                    {
                        continue;
                    }
                    trees++;
                    double apart = Math.Sqrt((rock.X - tree.X) * (double)(rock.X - tree.X) + (rock.Z - tree.Z) * (double)(rock.Z - tree.Z));
                    double room = apart - stone.Footprint * rock.Scale - wood.Trunk * tree.Scale;
                    nearest = Math.Min(nearest, room);
                    Assert.That(room, Is.GreaterThanOrEqualTo(-1e-3),
                        $"a {wood.Model} at ({tree.X:F2}, {tree.Z:F2}) stands {-room:F2} m inside a {stone.Model} at ({rock.X:F2}, {rock.Z:F2})");
                }
            }
            Debug.Log($"PropTests: {rocks} rocks and {trees} trees; {props.GaveWay} props gave way to another; the nearest trunk is {nearest:F2} m from a rock's footprint");
            Assert.That(rocks, Is.GreaterThan(500));
            Assert.That(trees, Is.GreaterThan(2000));
            Assert.That(props.GaveWay, Is.GreaterThan(0), "somewhere a rock and a tree asked for the same ground, or this test proves nothing");
        }

        [Test]
        public void TheWaterHasReedsAtItsEdgeAndNothingElse()
        {
            int reeds = 0;
            foreach (Prop prop in props.Props)
            {
                float bed = ground.Bed(prop.X, prop.Z);
                if (prop.Kind == Temperate.Reeds)
                {
                    reeds++;
                    Assert.That(bed, Is.InRange(Temperate.ReedsFrom, Temperate.ReedsTo), "reeds stand at the water's edge");
                    Assert.That(new Vector2(prop.X, prop.Z).magnitude, Is.GreaterThan(layout.WorldRadius / 1000f + 1), "and beyond the rim");
                }
                else
                {
                    Assert.That(bed, Is.EqualTo(0), $"a {Temperate.Kinds[prop.Kind].Model} stands in the water's bed or on its bank");
                }
            }
            Assert.That(reeds, Is.GreaterThan(20));
        }

        // PRD v4 5.1.5: the world's edge is natural. Across the lake the first build showed the
        // terrain's own edge as the horizon: the lake reached to 8 m from it, and the scatter left
        // that ground bare. A wood now stands behind the far shore, from end to end of it.
        [Test]
        public void AWoodStandsBehindTheLakesFarShore()
        {
            Vector2 lake = ground.LakeCentre, outward = lake.normalized, along = new Vector2(outward.y, -outward.x);
            float shoreline = GroundPlan.LakeRadius + GroundPlan.Bank;
            Assert.That(ground.Side / 2 - (Mathf.Max(Mathf.Abs(lake.x), Mathf.Abs(lake.y)) + shoreline), Is.GreaterThan(Temperate.LakesideWood - PropPlan.Cell),
                "the ground behind the far shore is as deep as the wood");
            // The far shore in six sectors of 30 degrees, from one end to the other.
            var trees = new int[6];
            int near = 0;
            foreach (Prop prop in props.Props)
            {
                Vector2 from = new Vector2(prop.X, prop.Z) - lake;
                float shore = from.magnitude - shoreline;
                if (Temperate.Kinds[prop.Kind].Trunk <= 0 || shore <= 0 || shore >= Temperate.LakesideWood)
                {
                    continue;
                }
                if (Vector2.Dot(from, outward) <= 0)
                {
                    near++;
                    continue;
                }
                float bearing = Mathf.Atan2(Vector2.Dot(from, outward), Vector2.Dot(from, along)) * Mathf.Rad2Deg;      // 0 to 180 along the far shore
                trees[Mathf.Clamp((int)(bearing / 30), 0, 5)]++;
            }
            Debug.Log($"PropTests: trees behind the lake's far shore, by sector: {string.Join(", ", trees)}; on the near side, in the same depth: {near}");
            Assert.That(trees, Has.All.GreaterThanOrEqualTo(8), "trees in every sector of the far shore");
        }

        [Test]
        public void TheScatterIsSeededByThePlaneAndTheSameEveryTime()
        {
            PropPlan again = PropPlan.Compute(layout, ground);
            Assert.That(again.Props, Is.EqualTo(props.Props));
            Assert.That(again.ByKind, Is.EqualTo(props.ByKind));

            // Another plane, another scatter, and as clear: Rabiah is a small world on the 513 heightmap.
            WorldLayout rabiah = Layout("rabiah");
            GroundPlan rabiahGround = GroundPlan.Compute(rabiah);
            PropPlan rabiahProps = PropPlan.Compute(rabiah, rabiahGround);
            Assert.That(rabiahProps.Props.Count, Is.GreaterThan(50));
            AssertClear(rabiah, rabiahGround, rabiahProps, out _);
            var here = new HashSet<(float, float)>();
            foreach (Prop prop in props.Props)
            {
                here.Add((prop.X, prop.Z));
            }
            Assert.That(rabiahProps.Props.Exists(prop => here.Contains((prop.X, prop.Z))), Is.False, "no prop of Rabiah's is where one of Dominaria's is");
        }

        [Test]
        public void ALowerDensityDrawsSomeOfTheSameProps()
        {
            var all = new HashSet<Prop>(props.Props);
            int last = props.Props.Count;
            foreach (string level in new[] { "medium", "low" })
            {
                float density = Temperate.Density(level);
                PropPlan fewer = PropPlan.Compute(layout, ground, density);
                Assert.That(fewer.Props.TrueForAll(all.Contains), $"every prop at {level} is one of the props at high");
                Assert.That(fewer.Props.Count, Is.InRange(0.8f * density * props.Props.Count, 1.2f * density * props.Props.Count));
                Assert.That(fewer.Props.Count, Is.LessThan(last));
                last = fewer.Props.Count;
            }
            Assert.That(Temperate.Density("high"), Is.EqualTo(1));
            Assert.That(PropPlan.Compute(layout, ground, 0).Props, Is.Empty);
        }

        [Test]
        public void WhatGrowsSaysWhichWedgeAVisitorIsIn()
        {
            float world = layout.WorldRadius / 1000f, ring = layout.RingInner / 1000f;
            var byClass = new int[ColourClasses.WedgeCount + 1, Temperate.Kinds.Length];
            int margin = 0, marginTrees = 0;
            foreach (Prop prop in props.Props)
            {
                float r = new Vector2(prop.X, prop.Z).magnitude;
                if (r > world)
                {
                    margin++;
                    marginTrees += prop.Kind <= Temperate.Pine ? 1 : 0;
                    continue;
                }
                var zone = PropPlan.ClassAt(layout, prop.X, prop.Z, r > ring);
                Dressing dressing = Temperate.Wedges[(int)zone];
                Assert.That(Array.IndexOf(dressing.Mix, prop.Kind) >= 0 || Array.IndexOf(dressing.Avenue, prop.Kind) >= 0,
                    $"a {Temperate.Kinds[prop.Kind].Model} stands in the {zone} zone, which does not grow it");
                byClass[(int)zone, prop.Kind]++;
            }
            int Trees(ColourClass zone) => byClass[(int)zone, Temperate.Oak] + byClass[(int)zone, Temperate.Birch] + byClass[(int)zone, Temperate.Pine];
            Assert.That(Trees(ColourClass.Red), Is.EqualTo(0), "the red wedge is badlands");
            Assert.That(Trees(ColourClass.Colourless), Is.EqualTo(0), "the ring is bare stone");
            Assert.That(byClass[(int)ColourClass.Green, Temperate.Oak], Is.GreaterThan(50), "the green wedge is an oak wood");
            Assert.That(byClass[(int)ColourClass.Blue, Temperate.Birch], Is.GreaterThan(20));
            Assert.That(byClass[(int)ColourClass.Black, Temperate.Pine], Is.GreaterThan(20));
            Assert.That(byClass[(int)ColourClass.Red, Temperate.Boulder], Is.GreaterThan(20));
            Assert.That(marginTrees, Is.GreaterThan(1000), "the world ends in a wood");

            // PRD v4 5.4.16: a wedge boundary is a line of what grows on each side. Along the north
            // radial path, between the white wedge and the gold, both sides have their line.
            int east = 0, west = 0;
            foreach (Prop prop in props.Props)
            {
                if (prop.Z > layout.PlazaRadius / 1000f && prop.Z < world && Mathf.Abs(prop.X) >= PropPlan.AvenueFrom && Mathf.Abs(prop.X) <= PropPlan.AvenueTo)
                {
                    east += prop.X > 0 ? 1 : 0;
                    west += prop.X < 0 ? 1 : 0;
                }
            }
            Assert.That(east, Is.GreaterThan(20), "the white side of the north radial path");
            Assert.That(west, Is.GreaterThan(20), "the gold side of the north radial path");

            var counts = new List<string>();
            for (int kind = 0; kind < Temperate.Kinds.Length; kind++)
            {
                counts.Add($"{Temperate.Kinds[kind].Model} {props.ByKind[kind]}");
            }
            Debug.Log($"PropTests: {string.Join(", ", counts)}; {props.Props.Count - margin} inside the rim, {margin} beyond it; the north avenue {west} west and {east} east");
            Assert.That(props.Props.Count, Is.InRange(3000, 14000), "enough to dress the world, few enough to draw");
        }
    }
}
