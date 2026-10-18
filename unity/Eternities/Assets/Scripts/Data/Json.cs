using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Numerics;
using System.Text;

namespace Eternities.Data
{
    // A reader for the pack's JSON files. The shards hold printings as tuples of mixed types
    // (docs/data-contract.md, section 9), which the engine's JsonUtility cannot read, and the project
    // carries no JSON package. An object is a Dictionary<string, object>, an array a List<object>, an
    // integer token a long, or a BigInteger when a long cannot hold it, any other number a double,
    // and the rest are string, bool and null. These are the types of Python's `json` (int and
    // float). It reads the grammar of RFC 8259 and refuses what Python's `json` refuses, so the
    // pipeline and the engine read one file one way (DEC-1186 N3). It follows Python on purpose in
    // two places: an integer token of more than 4,300 digits is refused, and a number beyond a
    // double reads as infinity with its sign. It differs in one place: it refuses `NaN`, `Infinity`
    // and `-Infinity`, which Python reads as a float. The checkers' token walks refuse those tokens
    // in the world and lore documents anyway (PRD v4 4.13.5, erratum 8).
    public static class Json
    {
        public static object Parse(string text)
        {
            int at = 0;
            object value = Value(text, ref at);
            Blank(text, ref at);
            if (at != text.Length)
            {
                throw Bad(text, at, "text after the value");
            }
            return value;
        }

        public static Dictionary<string, object> Object(object value) => (Dictionary<string, object>)value;
        public static List<object> Array(object value) => (List<object>)value;
        public static string Text(object value) => (string)value;
        public static int Int(object value) => checked((int)Whole(value));
        public static long Long(object value) => Whole(value);

        // A whole number: an integer token, or a number with no fraction within the range a double
        // holds exactly, as the checker's `Whole` reads one. Anything else is refused with the value
        // named, not cut to a whole number (PRD v4 7.4.1; DEC-1130 N4).
        static long Whole(object value)
        {
            if (value is long l)
            {
                return l;
            }
            if (value is double d && d == Math.Floor(d) && Math.Abs(d) <= 9_007_199_254_740_992d)
            {
                return (long)d;
            }
            string shown = value is double number ? number.ToString("R", CultureInfo.InvariantCulture) : value is string text ? $"'{text}'" : value?.ToString() ?? "null";
            throw new InvalidDataException($"JSON: {shown} is not a whole number");
        }

        // The same values as text: an object's members in the order they were added, two spaces a
        // level. A number is written the shortest way that reads back as itself.
        public static string Write(object value)
        {
            var text = new StringBuilder();
            Write(text, value, 0);
            return text.Append('\n').ToString();
        }

        static void Write(StringBuilder text, object value, int depth)
        {
            switch (value)
            {
                case null:
                    text.Append("null");
                    break;
                case string s:
                    Quote(text, s);
                    break;
                case bool b:
                    text.Append(b ? "true" : "false");
                    break;
                case Dictionary<string, object> members:
                {
                    text.Append('{');
                    int n = 0;
                    foreach (KeyValuePair<string, object> member in members)
                    {
                        text.Append(n++ == 0 ? "\n" : ",\n").Append(' ', 2 * depth + 2);
                        Quote(text, member.Key);
                        text.Append(": ");
                        Write(text, member.Value, depth + 1);
                    }
                    text.Append(n == 0 ? "}" : "\n" + new string(' ', 2 * depth) + "}");
                    break;
                }
                case System.Collections.IEnumerable items:
                {
                    text.Append('[');
                    int n = 0;
                    foreach (object item in items)
                    {
                        text.Append(n++ == 0 ? "\n" : ",\n").Append(' ', 2 * depth + 2);
                        Write(text, item, depth + 1);
                    }
                    text.Append(n == 0 ? "]" : "\n" + new string(' ', 2 * depth) + "]");
                    break;
                }
                case float f:
                    text.Append(float.IsNaN(f) || float.IsInfinity(f) ? "null" : ((double)(decimal)f).ToString("R", CultureInfo.InvariantCulture));
                    break;
                case double d:
                    text.Append(double.IsNaN(d) || double.IsInfinity(d) ? "null" : d.ToString("R", CultureInfo.InvariantCulture));
                    break;
                case IFormattable number:
                    text.Append(number.ToString(null, CultureInfo.InvariantCulture));
                    break;
                default:
                    throw new ArgumentException($"JSON: a {value.GetType().Name} is not a value");
            }
        }

        static void Quote(StringBuilder text, string s)
        {
            text.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': text.Append("\\\""); break;
                    case '\\': text.Append("\\\\"); break;
                    case '\n': text.Append("\\n"); break;
                    case '\r': text.Append("\\r"); break;
                    case '\t': text.Append("\\t"); break;
                    default:
                        if (c < ' ')
                        {
                            text.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            text.Append(c);
                        }
                        break;
                }
            }
            text.Append('"');
        }

        static object Value(string s, ref int at)
        {
            Blank(s, ref at);
            if (at >= s.Length)
            {
                throw Bad(s, at, "the text ends where a value should start");
            }
            switch (s[at])
            {
                case '{':
                {
                    var result = new Dictionary<string, object>();
                    at++;
                    Blank(s, ref at);
                    if (Take(s, ref at, '}'))
                    {
                        return result;
                    }
                    while (true)
                    {
                        Blank(s, ref at);
                        string key = Quoted(s, ref at);
                        Blank(s, ref at);
                        Expect(s, ref at, ':');
                        result[key] = Value(s, ref at);
                        Blank(s, ref at);
                        if (Take(s, ref at, '}'))
                        {
                            return result;
                        }
                        Expect(s, ref at, ',');
                    }
                }
                case '[':
                {
                    var result = new List<object>();
                    at++;
                    Blank(s, ref at);
                    if (Take(s, ref at, ']'))
                    {
                        return result;
                    }
                    while (true)
                    {
                        result.Add(Value(s, ref at));
                        Blank(s, ref at);
                        if (Take(s, ref at, ']'))
                        {
                            return result;
                        }
                        Expect(s, ref at, ',');
                    }
                }
                case '"':
                    return Quoted(s, ref at);
                case 't':
                    Word(s, ref at, "true");
                    return true;
                case 'f':
                    Word(s, ref at, "false");
                    return false;
                case 'n':
                    Word(s, ref at, "null");
                    return null;
                default:
                    return Number(s, ref at);
            }
        }

        // A number token of RFC 8259, `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`, so `+5`, `05`,
        // `5.` and `.5` are refused, as Python's `json` refuses them. A token with no `.`, `e` or `E`
        // is an integer, a long or else a BigInteger, and any other a double, so a reader can tell
        // `5` from `5.0` and `5e0` (PRD v4 4.13.5, erratum 8).
        static object Number(string s, ref int at)
        {
            int start = at;
            Take(s, ref at, '-');
            if (!Digit(s, at))
            {
                throw Bad(s, start, "not a value");
            }
            if (Take(s, ref at, '0'))
            {
                if (Digit(s, at))
                {
                    throw Bad(s, start, "a number has a leading zero");
                }
            }
            else
            {
                Digits(s, ref at, start);
            }
            bool integer = true;
            if (Take(s, ref at, '.'))
            {
                integer = false;
                Digits(s, ref at, start);
            }
            if (Take(s, ref at, 'e') || Take(s, ref at, 'E'))
            {
                integer = false;
                if (!Take(s, ref at, '+'))
                {
                    Take(s, ref at, '-');
                }
                Digits(s, ref at, start);
            }
            string token = s.Substring(start, at - start);
            if (integer)
            {
                if (long.TryParse(token, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long whole))
                {
                    return whole;
                }
                if (token.Length - (token[0] == '-' ? 1 : 0) > MostDigits)
                {
                    throw Bad(s, start, $"an integer has more than {MostDigits} digits, the limit of Python's `json`");
                }
                return BigInteger.Parse(token, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture);
            }
            // The grammar holds, so only the range can make the parse fail: a runtime that gives no
            // infinity for a number beyond a double (.NET Framework) then reads what Python and
            // .NET Core 3.0 and later read.
            if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double number))
            {
                return token[0] == '-' ? double.NegativeInfinity : double.PositiveInfinity;
            }
            return number;
        }

        // The most digits of an integer token, the sign not counted: Python's `json` refuses more
        // with a ValueError (`sys.int_info.default_max_str_digits`), as the lore's tables do
        // (`pipeline/src/eternities/lore/strict_json.py`).
        const int MostDigits = 4_300;

        static bool Digit(string s, int at) => at < s.Length && s[at] >= '0' && s[at] <= '9';

        // One digit or more, which a number's whole part, fraction and exponent each need.
        static void Digits(string s, ref int at, int start)
        {
            if (!Digit(s, at))
            {
                throw Bad(s, start, "a number lacks a digit");
            }
            while (Digit(s, at))
            {
                at++;
            }
        }

        static string Quoted(string s, ref int at)
        {
            Expect(s, ref at, '"');
            int start = at;
            while (at < s.Length && s[at] != '"' && s[at] != '\\' && s[at] >= ' ')
            {
                at++;
            }
            if (at < s.Length && s[at] == '"')
            {
                return s.Substring(start, at++ - start);    // no escape: the common case
            }
            var text = new StringBuilder(s, start, at - start, at - start + 16);
            while (true)
            {
                if (at >= s.Length)
                {
                    throw Bad(s, start, "a string does not end");
                }
                char c = s[at++];
                if (c == '"')
                {
                    return text.ToString();
                }
                if (c < ' ')
                {
                    throw Bad(s, at - 1, "a string holds a control character, which RFC 8259 writes as an escape");
                }
                if (c != '\\')
                {
                    text.Append(c);
                    continue;
                }
                if (at >= s.Length)
                {
                    throw Bad(s, at, "a string does not end");
                }
                c = s[at++];
                switch (c)
                {
                    case 'n': text.Append('\n'); break;
                    case 't': text.Append('\t'); break;
                    case 'r': text.Append('\r'); break;
                    case 'b': text.Append('\b'); break;
                    case 'f': text.Append('\f'); break;
                    case 'u':
                        if (!FourHex(s, at))
                        {
                            throw Bad(s, at, "a \\u escape needs four hexadecimal digits");
                        }
                        text.Append((char)ushort.Parse(s.Substring(at, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        at += 4;
                        break;
                    case '"':
                    case '\\':
                    case '/':
                        text.Append(c);
                        break;
                    default:
                        throw Bad(s, at - 1, "an unknown escape");
                }
            }
        }

        // Four hexadecimal digits and nothing else: `HexNumber` alone also takes white space at
        // either end, so `\u 041` read as `\u0041` (DEC-1186 N3).
        static bool FourHex(string s, int at)
        {
            if (at + 4 > s.Length)
            {
                return false;
            }
            for (int i = at; i < at + 4; i++)
            {
                if (!Uri.IsHexDigit(s[i]))
                {
                    return false;
                }
            }
            return true;
        }

        static void Blank(string s, ref int at)
        {
            while (at < s.Length && (s[at] == ' ' || s[at] == '\n' || s[at] == '\r' || s[at] == '\t'))
            {
                at++;
            }
        }

        static bool Take(string s, ref int at, char c)
        {
            if (at < s.Length && s[at] == c)
            {
                at++;
                return true;
            }
            return false;
        }

        static void Expect(string s, ref int at, char c)
        {
            if (!Take(s, ref at, c))
            {
                throw Bad(s, at, $"'{c}' expected");
            }
        }

        static void Word(string s, ref int at, string word)
        {
            if (string.CompareOrdinal(s, at, word, 0, word.Length) != 0)
            {
                throw Bad(s, at, "not a value");
            }
            at += word.Length;
        }

        static FormatException Bad(string s, int at, string what) => new FormatException($"JSON: {what}, at character {at} of {s.Length}");
    }
}
