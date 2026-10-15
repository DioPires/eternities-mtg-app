using System;
using System.Collections.Generic;
using System.Globalization;

namespace Eternities.Layout
{
    // The keyword rule of PRD v4 5.4.3, as a reader of the pack recomputes it (4.13.3): a card's
    // selected keyword is the first keyword of the keyword table, in table order, that the name of
    // any face holds as a whole word, case-insensitive. A word boundary is the string's start or
    // end, or a code point whose Unicode general category is a separator (Z*) or punctuation (P*);
    // a letter, a digit, a combining mark, a symbol such as `+` and a control character are not.
    public static class Keywords
    {
        // A keyword's word and the region it names, a row of `lore/<slug>.json`'s `keywords`.
        public readonly struct Row
        {
            public readonly string Word, Region;

            public Row(string word, string region)
            {
                Word = word;
                Region = region;
            }
        }

        // The first row whose word a face's name holds as a whole word, or null.
        public static Row? Selected(IReadOnlyList<string> names, IReadOnlyList<Row> keywords)
        {
            var folded = new string[names.Count];
            for (int i = 0; i < names.Count; i++)
            {
                folded[i] = Fold(names[i]);
            }
            foreach (Row row in keywords)
            {
                string sought = Fold(row.Word);
                foreach (string name in folded)
                {
                    if (HoldsWord(name, sought))
                    {
                        return row;
                    }
                }
            }
            return null;
        }

        // 5.4.3 compares the two strings after Unicode full case folding, the pipeline's
        // `str.casefold` (Unicode 15.1). .NET has no full case folding call, so this is the simple
        // lower-case mapping. On dataset a5846bec28d1447e the two agree on each of the 29,357 face
        // names and on Dominaria's keywords, so the decisions are the pipeline's on this dataset
        // only (DEC-1004, fix round 1, step 11). The test over every Dominaria stand
        // (`KeywordTests`) is what 5.4.3 asks where a runtime lacks the tables; it also covers the
        // category table below, which is the runtime's own Unicode version and not 15.1.
        public static string Fold(string text) => text.ToLowerInvariant();

        // Whether `text` holds `word` with a boundary on each side. Both are already folded.
        public static bool HoldsWord(string text, string word)
        {
            if (word.Length == 0)
            {
                return false;
            }
            int start = text.IndexOf(word, StringComparison.Ordinal);
            while (start >= 0)
            {
                int end = start + word.Length;
                if ((start == 0 || SplitsWords(text, Before(text, start))) && (end == text.Length || SplitsWords(text, end)))
                {
                    return true;
                }
                start = text.IndexOf(word, start + 1, StringComparison.Ordinal);
            }
            return false;
        }

        // The index of the code point that ends just before `index`: one unit back, or two when the
        // two units are a surrogate pair.
        static int Before(string text, int index)
        {
            if (index >= 2 && char.IsSurrogatePair(text[index - 2], text[index - 1]))
            {
                return index - 2;
            }
            return index - 1;
        }

        // Whether the code point at `index` is a word boundary. The category is read per code
        // point: at the high unit of a surrogate pair, `GetUnicodeCategory` reads the pair, so a
        // punctuation mark outside the Basic Multilingual Plane is punctuation and not two
        // surrogates (DEC-1091 N5).
        public static bool SplitsWords(string text, int index)
        {
            switch (CharUnicodeInfo.GetUnicodeCategory(text, index))
            {
                case UnicodeCategory.SpaceSeparator:
                case UnicodeCategory.LineSeparator:
                case UnicodeCategory.ParagraphSeparator:
                case UnicodeCategory.ConnectorPunctuation:
                case UnicodeCategory.DashPunctuation:
                case UnicodeCategory.OpenPunctuation:
                case UnicodeCategory.ClosePunctuation:
                case UnicodeCategory.InitialQuotePunctuation:
                case UnicodeCategory.FinalQuotePunctuation:
                case UnicodeCategory.OtherPunctuation:
                    return true;
                default:
                    return false;
            }
        }
    }
}
