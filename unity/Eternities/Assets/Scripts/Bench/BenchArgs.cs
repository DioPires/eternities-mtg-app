using System;
using System.Globalization;

namespace Eternities.Bench
{
    // The bench's command line (the bench design on DEC-953, section 1). The same arguments start a
    // run in a player build and in the editor's play mode.
    public sealed class BenchArgs
    {
        public string Mode;             // "warm" or "cold"; null when the process is not a bench run
        public string Quality;          // a quality level's name, or null for the project's default
        public float Scale = 1;         // the resolution scale: 1 or 0.75
        public string Out, Captures, Commit;
        public int Width, Height;       // the editor host's off-screen size; 0 for a player

        public bool Present => Mode != null;

        public static BenchArgs Parse(string[] args)
        {
            var parsed = new BenchArgs();
            for (int i = 0; i + 1 < args.Length; i++)
            {
                string value = args[i + 1];
                switch (args[i])
                {
                    case "-bench":
                        if (value != "warm" && value != "cold")
                        {
                            throw new ArgumentException($"-bench is warm or cold, not '{value}'");
                        }
                        parsed.Mode = value;
                        break;
                    case "-benchQuality": parsed.Quality = value; break;
                    case "-benchScale": parsed.Scale = float.Parse(value, CultureInfo.InvariantCulture); break;
                    case "-benchOut": parsed.Out = value; break;
                    case "-benchCaptures": parsed.Captures = value; break;
                    case "-benchCommit": parsed.Commit = value; break;
                    case "-benchSize":
                    {
                        string[] size = value.Split('x');
                        if (size.Length != 2 || !int.TryParse(size[0], out parsed.Width) || !int.TryParse(size[1], out parsed.Height) || parsed.Width < 16 || parsed.Height < 16)
                        {
                            throw new ArgumentException($"-benchSize is <width>x<height>, not '{value}'");
                        }
                        break;
                    }
                }
            }
            if (parsed.Present && parsed.Out == null)
            {
                throw new ArgumentException("-benchOut <path> is required with -bench");
            }
            return parsed;
        }
    }
}
