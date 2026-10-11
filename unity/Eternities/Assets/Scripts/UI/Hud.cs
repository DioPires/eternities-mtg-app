using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Eternities.UI
{
    // What card view shows beside the card (PRD v4 5.10.3): the card as text, and its printings.
    public sealed class CardSheet
    {
        public string Name, ManaCost, TypeLine, Text, Identity, Rarity;
        public string BackName, BackTypeLine, BackText;     // a second face, or null
        public readonly List<string> Printings = new List<string>();    // set name, year, rarity, artist; by release date
        public int Active;
        public string Artist;       // the credit of the image that is shown
        public bool CanFlip;
        public string Notice;       // one line, or null: the image could not be fetched
    }

    // Every overlay of the slice, in UI Toolkit (PRD v4 8.1.2): the stand's hover label, the
    // printings panel of card view, the travel menu and a one-line notice. It is built in code; the
    // only assets are the panel settings and the theme they name.
    public sealed class Hud : MonoBehaviour
    {
        static readonly Color Ink = new Color(0.93f, 0.92f, 0.88f), Dim = new Color(0.70f, 0.69f, 0.66f);
        static readonly Color Paper = new Color(0.07f, 0.07f, 0.09f, 0.90f), Accent = new Color(0.30f, 0.50f, 0.72f, 0.55f);

        UIDocument document;
        Label hover;
        VisualElement panel, travel;
        public PanelSettings Settings { get; private set; }

        public bool CardShown => panel.style.display == DisplayStyle.Flex;
        public bool TravelOpen => travel.style.display == DisplayStyle.Flex;
        public string HoverText => hover.style.display == DisplayStyle.Flex ? hover.text : null;
        public CardSheet Sheet { get; private set; }

        public static Hud Create(PanelSettings settings, Transform parent)
        {
            var holder = new GameObject("HUD");
            holder.transform.SetParent(parent, false);
            var hud = holder.AddComponent<Hud>();
            // The settings are copied, so a bench that draws the overlays into a texture changes no asset.
            hud.Settings = Instantiate(settings);
            hud.document = holder.AddComponent<UIDocument>();
            hud.document.panelSettings = hud.Settings;
            VisualElement root = hud.document.rootVisualElement;
            root.style.flexGrow = 1;
            root.pickingMode = PickingMode.Ignore;

            hud.hover = Text("", 18, Ink);
            hud.hover.style.position = Position.Absolute;
            hud.hover.style.backgroundColor = Paper;
            Pad(hud.hover, 6, 12);
            hud.hover.style.display = DisplayStyle.None;
            hud.hover.pickingMode = PickingMode.Ignore;
            root.Add(hud.hover);

            hud.panel = Side(right: true);
            root.Add(hud.panel);
            hud.travel = Side(right: false);
            root.Add(hud.travel);
            return hud;
        }

        void OnDestroy()
        {
            Destroy(Settings);
        }

        static Label Text(string text, int size, Color colour)
        {
            var label = new Label(text);
            label.style.fontSize = size;
            label.style.color = colour;
            label.style.whiteSpace = WhiteSpace.Normal;
            return label;
        }

        static void Pad(VisualElement element, float vertical, float horizontal)
        {
            element.style.paddingTop = element.style.paddingBottom = vertical;
            element.style.paddingLeft = element.style.paddingRight = horizontal;
        }

        static VisualElement Side(bool right)
        {
            var side = new VisualElement();
            side.style.position = Position.Absolute;
            side.style.top = side.style.bottom = 0;
            if (right)
            {
                side.style.right = 0;
            }
            else
            {
                side.style.left = 0;
            }
            side.style.width = Length.Percent(34);
            side.style.backgroundColor = Paper;
            Pad(side, 24, 24);
            side.style.display = DisplayStyle.None;
            return side;
        }

        static Button Action(string text, Action clicked)
        {
            var button = new Button(clicked) { text = text };
            button.style.fontSize = 16;
            button.style.marginTop = 10;
            return button;
        }

        // The hover label of a stand within reach (PRD v4 5.5.3), above a point of the screen given
        // in pixels from its bottom left. Null hides it.
        public void Hover(string text, Vector2 screenPoint)
        {
            if (text == null)
            {
                hover.style.display = DisplayStyle.None;
                return;
            }
            hover.text = text;
            hover.style.display = DisplayStyle.Flex;
            Vector2 at = RuntimePanelUtils.ScreenToPanel(hover.panel, new Vector2(screenPoint.x, Screen.height - screenPoint.y));
            hover.style.left = at.x - hover.resolvedStyle.width / 2;
            hover.style.top = at.y - hover.resolvedStyle.height - 8;
        }

        // The printings panel (PRD v4 5.10.3). `choose` is told the row that was clicked.
        public void ShowCard(CardSheet sheet, Action<int> choose, Action flip, Action open, Action leave)
        {
            Sheet = sheet;
            panel.Clear();
            panel.Add(Text(sheet.Name, 28, Ink));
            panel.Add(Text($"{sheet.ManaCost}   {sheet.TypeLine}", 16, Dim));
            panel.Add(Text(sheet.Text, 16, Ink));
            if (sheet.BackName != null)
            {
                Label back = Text(sheet.BackName, 20, Ink);
                back.style.marginTop = 12;
                panel.Add(back);
                panel.Add(Text(sheet.BackTypeLine, 16, Dim));
                panel.Add(Text(sheet.BackText, 16, Ink));
            }
            Label facts = Text($"Colour identity: {sheet.Identity}   Rarity: {sheet.Rarity}", 14, Dim);
            facts.style.marginTop = 12;
            panel.Add(facts);
            if (sheet.Notice != null)
            {
                Label notice = Text(sheet.Notice, 14, new Color(0.95f, 0.78f, 0.45f));
                notice.style.marginTop = 8;
                panel.Add(notice);
            }

            Label heading = Text($"Printings ({sheet.Printings.Count})", 16, Dim);
            heading.style.marginTop = 16;
            panel.Add(heading);
            var rows = new ScrollView();
            rows.style.flexGrow = 1;
            for (int i = 0; i < sheet.Printings.Count; i++)
            {
                int row = i;
                var entry = new Button(() => choose(row)) { text = sheet.Printings[i], name = $"printing-{i}" };
                entry.style.fontSize = 15;
                entry.style.unityTextAlign = TextAnchor.MiddleLeft;
                entry.style.color = Ink;
                entry.style.backgroundColor = i == sheet.Active ? Accent : new Color(0, 0, 0, 0);
                entry.style.borderTopWidth = entry.style.borderBottomWidth = entry.style.borderLeftWidth = entry.style.borderRightWidth = 0;
                rows.Add(entry);
            }
            panel.Add(rows);

            panel.Add(Text($"Illustrated by {sheet.Artist}", 14, Dim));
            if (sheet.CanFlip)
            {
                panel.Add(Action("Flip", flip));
            }
            panel.Add(Action("Open on Scryfall", open));
            panel.Add(Action("Back", leave));
            panel.style.display = DisplayStyle.Flex;
        }

        public void HideCard()
        {
            Sheet = null;
            panel.style.display = DisplayStyle.None;
        }

        // The slice's travel menu (PRD v4 6.6.1, 9.5): this world's sites, and the cards of the one
        // chosen. `choose` is told the site and the card's place in that site's list.
        public void ShowTravel(string world, List<string> sites, Func<int, List<string>> cardsOf, Action<int, int> choose, Action close)
        {
            travel.Clear();
            travel.Add(Text($"Travel · {world}", 24, Ink));
            var columns = new VisualElement();
            columns.style.flexDirection = FlexDirection.Row;
            columns.style.flexGrow = 1;
            columns.style.marginTop = 12;
            var cards = new ListView { fixedItemHeight = 24, makeItem = () => Text("", 15, Ink), selectionType = SelectionType.Single };
            cards.style.flexGrow = 1;
            cards.style.flexBasis = 0;
            int chosenSite = -1;
            List<string> names = new List<string>();
            cards.bindItem = (element, index) => ((Label)element).text = names[index];
            cards.itemsChosen += _ => { };
            cards.selectionChanged += _ =>
            {
                if (cards.selectedIndex >= 0 && chosenSite >= 0)
                {
                    choose(chosenSite, cards.selectedIndex);
                }
            };
            var list = new ListView(sites, 24, () => Text("", 15, Ink), (element, index) => ((Label)element).text = sites[index]) { selectionType = SelectionType.Single };
            list.style.flexGrow = 1;
            list.style.flexBasis = 0;
            list.selectionChanged += _ =>
            {
                chosenSite = list.selectedIndex;
                names = chosenSite >= 0 ? cardsOf(chosenSite) : new List<string>();
                cards.itemsSource = names;
                cards.ClearSelection();
                cards.Rebuild();
            };
            columns.Add(list);
            columns.Add(cards);
            travel.Add(columns);
            travel.Add(Action("Close", close));
            travel.style.display = DisplayStyle.Flex;
        }

        public void HideTravel()
        {
            travel.style.display = DisplayStyle.None;
        }
    }
}
