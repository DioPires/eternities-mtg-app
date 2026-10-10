using System;
using Eternities.Data;

namespace Eternities.CardView
{
    public enum ImageSize
    {
        Normal,     // 488 x 680, for stands
        Large,      // 672 x 936, for card view
    }

    // The only URLs the application ever requests (PRD v4 4.15.1, 4.15.2): a card face on
    // `cards.scryfall.io` and the card back on `backs.scryfall.io`. A face's URL is derived from its
    // printing (docs/data-contract.md, section 9), over a validated UUID, because on these hostnames
    // a malformed path draws a 400 and a 400 pauses every request (PRD v4 4.15.4).
    public static class ImageUrls
    {
        public const string CardHost = "cards.scryfall.io", BackHost = "backs.scryfall.io";
        public const string CardBack = "https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg";

        // Each size's name, extension and pixels, in one table (PRD v4 4.15.2).
        public static string Name(ImageSize size) => size == ImageSize.Normal ? "normal" : "large";
        public const string Extension = "jpg";
        public static int Width(ImageSize size) => size == ImageSize.Normal ? 488 : 672;
        public static int Height(ImageSize size) => size == ImageSize.Normal ? 680 : 936;

        public static string Face(string printingId, long imageTs, ImageSize size, bool back = false)
        {
            if (!IsUuid(printingId))
            {
                throw new ArgumentException($"'{printingId}' is not a printing id");
            }
            if (imageTs < 0)
            {
                throw new ArgumentException($"{imageTs} is not an image timestamp");
            }
            return $"https://{CardHost}/{Name(size)}/{(back ? "back" : "front")}/{printingId[0]}/{printingId[1]}/{printingId}.{Extension}?{imageTs}";
        }

        // The front of the card's first printing: what its stand shows (PRD v4 5.5.1).
        public static string Front(PackCard card, ImageSize size) => Face(card.Printings[0].Id, card.Printings[0].ImageTs, size);

        // The back image of a printing of the card, or null when the card has none. A meld card's
        // back is the meld result, a printing of its own, whose image is a front.
        public static string Back(PackCard card, PackPrinting printing, ImageSize size)
        {
            if (!card.HasBackImage)
            {
                return null;
            }
            return card.Layout == "meld" ? Face(card.Back.Id, card.Back.ImageTs, size) : Face(printing.Id, printing.ImageTs, size, back: true);
        }

        public static bool IsUuid(string id)
        {
            if (id == null || id.Length != 36)
            {
                return false;
            }
            for (int i = 0; i < 36; i++)
            {
                char c = id[i];
                bool hyphen = i == 8 || i == 13 || i == 18 || i == 23;
                if (hyphen ? c != '-' : !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
                {
                    return false;
                }
            }
            return true;
        }

        // Is this one of the two hostnames, over https? The loader refuses a redirect anywhere else.
        public static bool Allowed(string url)
        {
            return Uri.TryCreate(url, UriKind.Absolute, out Uri uri) && uri.Scheme == Uri.UriSchemeHttps && (uri.Host == CardHost || uri.Host == BackHost);
        }
    }
}
