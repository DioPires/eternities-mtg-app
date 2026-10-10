using System;
using System.IO;
using Eternities.Data;
using Eternities.Layout;
using UnityEditor;
using UnityEngine;

namespace Eternities.EditorTools
{
    // The batchmode scene generation entry point (PRD v4 8.2.5). It makes everything a world needs
    // that is not committed, from the pinned pack and nothing else, so a reviewer reproduces the
    // slice's world from the command line:
    //
    // - the part of the pack the slice reads, copied from `web/public/data/<hash>/` to
    //   `StreamingAssets/data/<hash>/`, every file checked against the pack's manifest;
    // - each world's layout, `layout/<slug>.txt` in that directory: the slice has no contract v4
    //   pack (PRD v4 9.5), so the C# allocator runs here, where the pipeline's will, and the engine
    //   only reads the result (PRD v4 5.4). A layout the independent checker fails is not written.
    //
    // A missing argument or a failure throws, and the editor turns an exception in an
    // `-executeMethod` target into exit code 1.
    public static class Generate
    {
        // The slice has one world (PRD v4 9.5).
        public static readonly string[] Worlds = { "dominaria" };

        public sealed class World
        {
            public WorldLayout Layout;
            public Checker.Result Check;
            public string LayoutPath, Digest, Report;
        }

        public static void Run()
        {
            string packHash = CommandLine.Require("-packHash");
            string reportOut = CommandLine.Optional("-reportOut");
            foreach (string slug in Worlds)
            {
                World world = Build(packHash, slug);
                Debug.Log($"Generate: {slug} from pack {packHash}\n{world.Report}");
                if (reportOut != null)
                {
                    File.WriteAllText(reportOut, world.Report);
                }
            }
        }

        // The repository's copy of a pack, which the pipeline commits (PRD v4 8.2.1).
        public static string RepositoryPack(string packHash) =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "web", "public", "data", packHash));

        public static string ProjectPack(string packHash) => Path.Combine(Application.streamingAssetsPath, "data", packHash);

        public static World Build(string packHash, string slug)
        {
            var pack = new Pack(RepositoryPack(packHash));
            if (pack.Hash != packHash)
            {
                throw new InvalidDataException($"the pack in {pack.Directory} names itself {pack.Hash}");
            }
            PackPlane plane = pack.Plane(slug);

            string target = ProjectPack(packHash);
            Directory.CreateDirectory(Path.Combine(target, "planes"));
            Directory.CreateDirectory(Path.Combine(target, "layout"));
            File.Copy(Path.Combine(pack.Directory, "manifest.json"), Path.Combine(target, "manifest.json"), overwrite: true);
            foreach (string file in Pack.FilesOf(plane))
            {
                File.WriteAllBytes(Path.Combine(target, file), pack.Read(file));
            }

            LayoutInput input = LayoutInputs.From(plane, pack.Cards(plane));
            WorldLayout layout = Allocator.Run(input);
            Checker.Result check = Checker.Check(layout);
            string text = LayoutFile.Write(layout);
            var world = new World
            {
                Layout = layout, Check = check, Digest = LayoutFile.Digest(text),
                LayoutPath = Path.Combine(target, "layout", slug + ".txt"),
            };
            world.Report = LayoutReport.Write(layout, check, world.Digest);
            if (!check.Passed)
            {
                // PRD v4 5.4.10: a checker failure is a build failure naming the first violation.
                throw new LayoutException($"the layout of {slug} fails the checker: {check.Violations[0]} ({check.ViolationCount} violations)\n{world.Report}");
            }
            File.WriteAllText(world.LayoutPath, text);
            AssetDatabase.Refresh();
            return world;
        }
    }
}
