using System.IO;
using Eternities.Layout;

namespace Eternities.Data
{
    // What a world reads at run time and git does not hold: the part of the pack the slice uses and
    // the world's layout, both under `StreamingAssets/data/<hash>/`. The generation entry point
    // writes them (PRD v4 8.2.5), and so do the tests and the bench before they load a world.
    public static class WorldFiles
    {
        public sealed class Result
        {
            public WorldLayout Layout;
            public Checker.Result Check;
            public string LayoutPath, Digest, Report;
        }

        public static string LayoutPath(string packDirectory, string slug) => Path.Combine(packDirectory, "layout", slug + ".txt");

        // Copies the plane's files from the pack at `source` to `target`, each checked against the
        // pack's manifest, then allocates the plane and writes its layout there. The slice has no
        // contract v4 pack (PRD v4 9.5), so the C# allocator runs here, where the pipeline's will,
        // and the engine only reads the result (PRD v4 5.4). A layout the checker fails is not
        // written: PRD v4 5.4.10 makes that a build failure naming the first violation.
        public static Result Generate(string source, string target, string slug)
        {
            var pack = new Pack(source);
            PackPlane plane = pack.Plane(slug);
            Directory.CreateDirectory(Path.Combine(target, "planes"));
            Directory.CreateDirectory(Path.Combine(target, "layout"));
            File.Copy(Path.Combine(source, "manifest.json"), Path.Combine(target, "manifest.json"), overwrite: true);
            foreach (string file in Pack.FilesOf(plane))
            {
                File.WriteAllBytes(Path.Combine(target, file), pack.Read(file));
            }

            WorldLayout layout = Allocator.Run(LayoutInputs.From(plane, pack.Cards(plane)));
            Checker.Result check = Checker.Check(layout);
            string text = LayoutFile.Write(layout);
            var result = new Result { Layout = layout, Check = check, Digest = LayoutFile.Digest(text), LayoutPath = LayoutPath(target, slug) };
            result.Report = LayoutReport.Write(layout, check, result.Digest);
            if (!check.Passed)
            {
                throw new LayoutException($"the layout of {slug} fails the checker: {check.Violations[0]} ({check.ViolationCount} violations)\n{result.Report}");
            }
            File.WriteAllText(result.LayoutPath, text);
            return result;
        }
    }

    // One world as the engine holds it: the plane, its cards in star order, their swatches and the
    // layout, read from a pack directory that `WorldFiles.Generate` filled.
    public sealed class WorldData
    {
        public Pack Pack;
        public PackPlane Plane;
        public PackCard[] Cards;
        public WorldLayout Layout;
        byte[] swatches;

        public static WorldData Load(string packDirectory, string slug)
        {
            var pack = new Pack(packDirectory);
            PackPlane plane = pack.Plane(slug);
            var world = new WorldData
            {
                Pack = pack, Plane = plane, Cards = pack.Cards(plane), swatches = pack.Swatches(),
                Layout = LayoutFile.Read(File.ReadAllText(WorldFiles.LayoutPath(packDirectory, slug))),
            };
            if (world.Layout.Stands.Count != world.Cards.Length)
            {
                throw new InvalidDataException($"the layout of {slug} has {world.Layout.Stands.Count} stands for {world.Cards.Length} cards");
            }
            for (int i = 0; i < world.Cards.Length; i++)
            {
                if (world.Layout.Stands[i].Card != i || world.Layout.Input.Cards[i].OracleId != world.Cards[i].OracleId)
                {
                    throw new InvalidDataException($"stand {i} of the layout of {slug} is not card {world.Cards[i].OracleId}: the layout is of another pack");
                }
            }
            return world;
        }

        // The card's swatch (docs/data-contract.md, section 5.1): sample 0 to 3 of its art at 2 x 2,
        // in reading order, as 8-bit sRGB.
        public void Swatch(int card, int sample, out byte r, out byte g, out byte b)
        {
            int at = Pack.SwatchHeader + (Plane.StarOffset + card) * Pack.SwatchRecord + 2 * sample;
            int rgb565 = swatches[at] | swatches[at + 1] << 8;
            int r5 = rgb565 >> 11, g6 = (rgb565 >> 5) & 63, b5 = rgb565 & 31;
            r = (byte)(r5 << 3 | r5 >> 2);
            g = (byte)(g6 << 2 | g6 >> 4);
            b = (byte)(b5 << 3 | b5 >> 2);
        }
    }
}
