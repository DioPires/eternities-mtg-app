using System;

namespace Eternities.EditorTools
{
    // Reads the arguments a batchmode entry point was started with. The editor passes through any
    // argument it does not recognise, so `-executeMethod` targets take theirs from the same line.
    internal static class CommandLine
    {
        public static string Require(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            int at = Array.IndexOf(args, name);
            if (at < 0 || at + 1 >= args.Length)
            {
                throw new ArgumentException($"{name} <value> is required");
            }
            return args[at + 1];
        }
    }
}
