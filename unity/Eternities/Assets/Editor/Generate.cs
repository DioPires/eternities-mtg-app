using UnityEngine;

namespace Eternities.EditorTools
{
    // The batchmode scene generation entry point (PRD v4 8.2.5). It will build the hub scene and any
    // kit world from the pack and the kit. The skeleton only proves the entry point is reachable from
    // the command line: it reports the pack hash it was given. A missing argument throws, and the
    // editor turns an exception in an `-executeMethod` target into exit code 1.
    public static class Generate
    {
        public static void Run()
        {
            string packHash = CommandLine.Require("-packHash");
            Debug.Log($"Generate: pack hash {packHash}");
        }
    }
}
