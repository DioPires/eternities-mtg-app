using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Eternities.Data
{
    // A reader for the pack's JSON files. The shards hold printings as tuples of mixed types
    // (docs/data-contract.md, section 9), which the engine's JsonUtility cannot read, and the project
    // carries no JSON package. An object is a Dictionary<string, object>, an array a List<object>, a
    // number a double, and the rest are string, bool and null.
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
        public static int Int(object value) => checked((int)(double)value);
        public static long Long(object value) => checked((long)(double)value);

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
                {
                    int start = at;
                    while (at < s.Length && "+-0123456789.eE".IndexOf(s[at]) >= 0)
                    {
                        at++;
                    }
                    if (at == start || !double.TryParse(s.Substring(start, at - start), NumberStyles.Float, CultureInfo.InvariantCulture, out double number))
                    {
                        throw Bad(s, start, "not a value");
                    }
                    return number;
                }
            }
        }

        static string Quoted(string s, ref int at)
        {
            Expect(s, ref at, '"');
            int start = at;
            while (at < s.Length && s[at] != '"' && s[at] != '\\')
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
                        if (at + 4 > s.Length || !ushort.TryParse(s.Substring(at, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out ushort unit))
                        {
                            throw Bad(s, at, "a \\u escape needs four hexadecimal digits");
                        }
                        text.Append((char)unit);
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
