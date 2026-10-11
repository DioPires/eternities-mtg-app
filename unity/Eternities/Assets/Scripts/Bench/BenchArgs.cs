using System;
using System.Globalization;

namespace Eternities.Bench
{
    // The bench's command line (the bench design on DEC-953, section 1). The same arguments start a
    // run in a player build and in the editor's play mode.
    public sealed class BenchArgs
    {
        public string Mode;             // "warm", "cold" or "prices"; null when the process is not a bench run
        public string Quality;          // a quality level's name, or null for the project's default
        public float Scale = 1;         // the resolution scale: 1 or 0.75
        public string Out, Captures, Commit;
        public int Width, Height;       // the editor host's off-screen size; a player's, or 0 for its display's own

        public bool Present => Mode != null;

        // The total and the graphics part of a process's footprint, in bytes, from the text
        // `footprint -p <pid>` prints: its header's "Footprint: 187 MB", and the dirty column of
        // every category marked "(graphics)" and of IOSurface.
        public static (long Total, long Graphics) ParseFootprint(string output)
        {
            long Bytes(string number, string unit)
            {
                double value = double.Parse(number, CultureInfo.InvariantCulture);
                switch (unit)
                {
                    case "KB": return (long)(value * 1024);
                    case "MB": return (long)(value * 1024 * 1024);
                    case "GB": return (long)(value * 1024 * 1024 * 1024);
                    default: return (long)value;
                }
            }
            long total = 0, graphics = 0;
            foreach (string line in output.Split('\n'))
            {
                string[] words = line.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                int at = Array.IndexOf(words, "Footprint:");
                if (at >= 0 && at + 2 < words.Length && total == 0)
                {
                    total = Bytes(words[at + 1], words[at + 2]);
                }
                else if (words.Length >= 8 && (line.Contains("(graphics)") || line.TrimEnd().EndsWith("IOSurface")) && (words[1] == "B" || words[1].EndsWith("B")))
                {
                    graphics += Bytes(words[0], words[1]);
                }
            }
            return (total, graphics);
        }

        public static BenchArgs Parse(string[] args)
        {
            var parsed = new BenchArgs();
            for (int i = 0; i + 1 < args.Length; i++)
            {
                string value = args[i + 1];
                switch (args[i])
                {
                    case "-bench":
                        if (value != "warm" && value != "cold" && value != "prices")
                        {
                            throw new ArgumentException($"-bench is warm, cold or prices, not '{value}'");
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
