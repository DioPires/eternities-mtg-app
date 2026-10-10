using System;
using System.Collections.Generic;
using System.IO;
using Eternities.Layout;

namespace Eternities.Data
{
    // What the allocator needs of a plane, from the contract v3 pack (PRD v4 5.4.2): a card's class
    // is its colour identity (one colour, gold for two or more, colourless for none), and its set is
    // the set of its first printing.
    public static class LayoutInputs
    {
        public static LayoutInput From(PackPlane plane, PackCard[] cards)
        {
            var setIndex = new Dictionary<int, int>();
            var codes = new string[plane.Sets.Length];
            for (int i = 0; i < plane.Sets.Length; i++)
            {
                setIndex[plane.Sets[i].Id] = i;
                codes[i] = plane.Sets[i].Code;
            }
            var layoutCards = new LayoutCard[cards.Length];
            for (int i = 0; i < cards.Length; i++)
            {
                PackCard card = cards[i];
                if (card.Printings.Length == 0 || !setIndex.TryGetValue(card.Printings[0].SetId, out int set))
                {
                    throw new InvalidDataException($"{card.Name} ({card.OracleId}) has no first printing in a set of {plane.Slug}");
                }
                layoutCards[i] = new LayoutCard { OracleId = card.OracleId, Set = set, Class = ClassOf(card.ColourIdentity) };
            }
            return new LayoutInput { PlaneSlug = plane.Slug, SetCodes = codes, Cards = layoutCards };
        }

        public static ColourClass ClassOf(string colourIdentity)
        {
            if (colourIdentity.Length == 0)
            {
                return ColourClass.Colourless;
            }
            if (colourIdentity.Length > 1)
            {
                return ColourClass.Gold;
            }
            int colour = "WUBRG".IndexOf(colourIdentity[0]);
            if (colour < 0)
            {
                throw new InvalidDataException($"'{colourIdentity}' is not a colour identity");
            }
            return (ColourClass)colour;
        }
    }
}
