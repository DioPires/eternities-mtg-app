using System;

namespace Eternities.EditorTools
{
    // Reads the arguments a batchmode entry point was started with. The editor passes through any
    // argument it does not recognise, so `-executeMethod` targets take theirs from the same line.
    internal static class CommandLine
    {
        public static string Require(string name)
        {
            return Optional(name) ?? throw new ArgumentException($"{name} <value> is required");
        }

        public static string Optional(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            int at = Array.IndexOf(args, name);
            return at < 0 || at + 1 >= args.Length ? null : args[at + 1];
        }
    }
}
