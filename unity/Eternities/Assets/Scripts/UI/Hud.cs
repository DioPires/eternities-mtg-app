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

    // What a stone's overlay shows (PRD v4 5.13.1, 6.6.2): a reading stone's era, its years, its
    // place, its paragraphs, its sets and headline cards, its sources and its travel; a waystone's
    // name, years and count, and its travel. A set, a card or a choice of travel is a link when
    // `Link` is true.
    public sealed class StoneSheet
    {
        public string Name, Years, Place;
        public readonly List<string> Paragraphs = new List<string>();
        public readonly List<(string Text, bool Link)> Sets = new List<(string, bool)>(), Headlines = new List<(string, bool)>();
        public readonly List<string> Sources = new List<string>();
        public readonly List<string> Travel = new List<string>();
    }

    // A row of the travel menu (PRD v4 6.6.1): a section's heading, a site, an era's chapter or a
    // region. `Travels` is whether choosing it opens a travel portal; `Site` is the site whose
    // cards it can list, or -1.
    public sealed class TravelRow
    {
        public string Text;
        public bool Heading, Travels;
        public int Depth;
        public int Site = -1;
    }

    // Every overlay of the slice, in UI Toolkit (PRD v4 8.1.2): the stand's and the stone's hover
    // label, the printings panel of card view, a stone's overlay, the travel menu, the map, the
    // place line at the top left with a region's sentence beneath it, a one-line notice in the
    // panel and one line in the middle of the view. It is built in code; the only assets are the
    // panel settings and the theme they name.
    public sealed class Hud : MonoBehaviour
    {
        static readonly Color Ink = new Color(0.93f, 0.92f, 0.88f), Dim = new Color(0.70f, 0.69f, 0.66f);
        static readonly Color Paper = new Color(0.07f, 0.07f, 0.09f, 0.90f), Accent = new Color(0.30f, 0.50f, 0.72f, 0.55f);
        static readonly Color Veil = new Color(0.07f, 0.07f, 0.09f, 0.62f);
        // How long a region's sentence stays beneath the place line (PRD v4 5.13.7, 6.3.1).
        public const float SentenceSeconds = 4;

        UIDocument document;
        Label hover, line, place, sentence, mapCaption;
        VisualElement panel, travel, corner, map, stone;
        MapView mapView;
        float sentenceUntil = float.NegativeInfinity;
        public PanelSettings Settings { get; private set; }

        public bool CardShown => panel.style.display == DisplayStyle.Flex;
        public bool TravelOpen => travel.style.display == DisplayStyle.Flex;
        public bool MapOpen => map.style.display == DisplayStyle.Flex;
        public bool StoneOpen => stone.style.display == DisplayStyle.Flex;
        // The stone's overlay as it shows now, or null: its sheet, and the element that holds its text.
        public StoneSheet Stone { get; private set; }
        public VisualElement StoneBody { get; private set; }
        public string HoverText => hover.style.display == DisplayStyle.Flex ? hover.text : null;
        public string Line => line.style.display == DisplayStyle.Flex ? line.text : null;
        // The place line and the sentence beneath it, as they show now: null when hidden.
        public string PlaceText => place.style.display == DisplayStyle.Flex && corner.style.display == DisplayStyle.Flex ? place.text : null;
        public string SentenceText => sentence.style.display == DisplayStyle.Flex && corner.style.display == DisplayStyle.Flex ? sentence.text : null;
        public MapView Map => mapView;
        // The travel menu's list of sites and regions, while it is open.
        public ScrollView TravelList { get; private set; }
        public string MapCaption => mapCaption.text;
        // An overlay is open (PRD v4 6.2.1): card view's panel, a stone's overlay, the travel menu,
        // the map, or the line in the middle of the view. The pointer is the visitor's for as long
        // (`PointerLock`).
        public bool Open => CardShown || StoneOpen || TravelOpen || MapOpen || Line != null;
        public Rect HoverBounds => hover.worldBound;        // in the panel's units
        public Rect PanelBounds => document.rootVisualElement.worldBound;
        public Vector2 ViewToPanel(Vector2 viewPoint) => RuntimePanelUtils.ScreenToPanel(hover.panel, viewPoint);
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
            // The theme gives a label a margin, which would stand it off the point it is placed over.
            hud.hover.style.marginLeft = hud.hover.style.marginRight = hud.hover.style.marginTop = hud.hover.style.marginBottom = 0;
            // Its place is the middle of its bottom edge, by its own size as the layout has it now:
            // a place worked out from its size in the last frame's layout is wrong whenever the
            // text or the panel's scale has just changed.
            hud.hover.style.translate = new Translate(Length.Percent(-50), Length.Percent(-100));
            // Opaque: on the screen the stands' images leave the label's rectangle to it, and it
            // covers what the main camera drew there (DEC-1130 N10, PRD v4 8.4.4).
            hud.hover.style.backgroundColor = new Color(Paper.r, Paper.g, Paper.b, 1);
            Pad(hud.hover, 6, 12);
            hud.hover.style.display = DisplayStyle.None;
            hud.hover.pickingMode = PickingMode.Ignore;
            root.Add(hud.hover);

            // The line stands in the middle of the view, as wide as its text.
            var middle = new VisualElement();
            middle.style.position = Position.Absolute;
            middle.style.left = middle.style.right = 0;
            middle.style.top = Length.Percent(50);
            middle.style.alignItems = Align.Center;
            middle.pickingMode = PickingMode.Ignore;
            hud.line = Text("", 20, Ink);
            hud.line.style.backgroundColor = Paper;
            Pad(hud.line, 10, 18);
            hud.line.style.display = DisplayStyle.None;
            hud.line.pickingMode = PickingMode.Ignore;
            middle.Add(hud.line);
            root.Add(middle);

            // The place line at the top left, and the region's sentence beneath it (PRD v4 6.3.1).
            hud.corner = new VisualElement { pickingMode = PickingMode.Ignore };
            hud.corner.style.position = Position.Absolute;
            hud.corner.style.left = 24;
            hud.corner.style.top = 20;
            hud.corner.style.maxWidth = Length.Percent(40);
            hud.corner.style.alignItems = Align.FlexStart;
            hud.corner.style.display = DisplayStyle.Flex;
            hud.place = Text("", 20, Ink);
            hud.sentence = Text("", 16, Ink);
            foreach (Label label in new[] { hud.place, hud.sentence })
            {
                label.style.backgroundColor = Veil;
                label.style.marginLeft = label.style.marginRight = label.style.marginTop = 0;
                label.style.marginBottom = 6;
                Pad(label, 5, 10);
                label.style.display = DisplayStyle.None;
                label.pickingMode = PickingMode.Ignore;
                hud.corner.Add(label);
            }
            root.Add(hud.corner);

            hud.panel = Side(right: true);
            root.Add(hud.panel);
            hud.travel = Side(right: false);
            root.Add(hud.travel);

            // A stone's overlay (PRD v4 5.13.1): in the middle of the view, on its own scrim, so its
            // text reads against any sky (6.10.4).
            hud.stone = new VisualElement();
            hud.stone.style.position = Position.Absolute;
            hud.stone.style.left = Length.Percent(25);
            hud.stone.style.right = Length.Percent(25);
            hud.stone.style.top = Length.Percent(6);
            hud.stone.style.bottom = Length.Percent(6);
            hud.stone.style.backgroundColor = Paper;
            Pad(hud.stone, 24, 28);
            hud.stone.style.display = DisplayStyle.None;
            root.Add(hud.stone);

            // The map (PRD v4 6.3.4): over the whole view, the world in a square as tall as the
            // view allows, and a line beneath it that says what a click there does.
            hud.map = new VisualElement();
            hud.map.style.position = Position.Absolute;
            hud.map.style.left = hud.map.style.right = hud.map.style.top = hud.map.style.bottom = 0;
            hud.map.style.backgroundColor = Paper;
            hud.map.style.alignItems = Align.Center;
            hud.map.style.justifyContent = Justify.Center;
            hud.map.style.display = DisplayStyle.None;
            hud.mapView = new MapView();
            hud.map.Add(hud.mapView);
            hud.map.RegisterCallback<GeometryChangedEvent>(_ =>
            {
                float side = Mathf.Max(1, Mathf.Min(hud.map.contentRect.width * 0.96f, hud.map.contentRect.height * 0.86f));
                hud.mapView.style.width = hud.mapView.style.height = side;
            });
            hud.mapCaption = Text("", 16, Dim);
            hud.mapCaption.style.marginTop = 8;
            hud.mapCaption.pickingMode = PickingMode.Ignore;
            hud.mapView.Hovered = text => hud.mapCaption.text = text ?? MapHint;
            hud.map.Add(hud.mapCaption);
            root.Add(hud.map);
            PointerLock.Overlays(hud);
            return hud;
        }

        const string MapHint = "Click a site, its stone or a region to travel there. M or Esc closes the map.";

        void Update()
        {
            if (sentence.style.display == DisplayStyle.Flex && Time.unscaledTime >= sentenceUntil)
            {
                sentence.style.display = DisplayStyle.None;
            }
        }

        // The place line (PRD v4 6.3.1): "Dominaria · Shiv · The First Ages", or "The Hub". Null
        // hides it.
        public void Place(string text)
        {
            place.text = text ?? "";
            place.style.display = text != null ? DisplayStyle.Flex : DisplayStyle.None;
        }

        // A region's sentence beneath the place line, for `SentenceSeconds` (PRD v4 5.13.7). Null
        // takes it away at once.
        public void Sentence(string text)
        {
            sentence.text = text ?? "";
            sentence.style.display = text != null ? DisplayStyle.Flex : DisplayStyle.None;
            sentenceUntil = Time.unscaledTime + SentenceSeconds;
        }

        // The map over the view. `chosen` is told the site a click asks for.
        public void ShowMap(MapModel model, Action<int> chosen)
        {
            mapView.Chosen = chosen;
            mapView.Show(model);
            mapCaption.text = MapHint;
            map.style.display = DisplayStyle.Flex;
            PointerLock.Release();
        }

        public void HideMap()
        {
            map.style.display = DisplayStyle.None;
        }

        // The hover label's rectangle in pixels of the view, from its bottom left, padded by
        // `padding`: where the image surfaces must not be laid over the label (DEC-1130 N10). From
        // the point it is placed over and its size as the layout last had it, so it is this
        // frame's place even while the label moves. Empty when the label is hidden.
        public Rect HoverPixels(Vector2 viewPoint, float viewWidth, float viewHeight, float padding)
        {
            Rect panelBox = PanelBounds;
            if (HoverText == null || panelBox.width <= 0 || panelBox.height <= 0)
            {
                return Rect.zero;
            }
            float sx = viewWidth / panelBox.width, sy = viewHeight / panelBox.height;
            Vector2 at = RuntimePanelUtils.ScreenToPanel(hover.panel, viewPoint);
            float width = hover.resolvedStyle.width, height = hover.resolvedStyle.height;
            float left = at.x - width / 2, top = at.y - 8 - height;
            return Rect.MinMaxRect(left * sx - padding, viewHeight - (top + height) * sy - padding, (left + width) * sx + padding, viewHeight - top * sy + padding);
        }

        // Every size of text the overlays use, with every character a card is likely to carry, laid
        // out once where it cannot be seen: the font's atlas is made then, and not when the first
        // label or panel appears.
        public void Warm(bool on)
        {
            if (!on)
            {
                warm?.RemoveFromHierarchy();
                warm = null;
                return;
            }
            warm = new VisualElement();
            warm.style.position = Position.Absolute;
            warm.style.opacity = 0;
            warm.pickingMode = PickingMode.Ignore;
            var characters = new System.Text.StringBuilder();
            for (char c = ' '; c <= '~'; c++)
            {
                characters.Append(c);
            }
            characters.Append("·—–’“”…éáíóúâêôûäöüñç{}/");
            foreach (int size in new[] { 28, 24, 20, 18, 16, 15, 14, 11 })
            {
                warm.Add(Text(characters.ToString(), size, Ink));
            }
            warm.Add(Action("Flip", () => { }));
            warm.Add(Link("Sources", () => { }));
            warm.Add(new Foldout { text = "Sources", value = false });
            warm.Add(new ScrollView());
            document.rootVisualElement.Add(warm);
        }

        VisualElement warm;

        void OnDestroy()
        {
            Destroy(Settings);
        }

        // With the application's focus the pointer goes back to the visitor, for whatever else is
        // on the screen.
        void OnApplicationFocus(bool focused)
        {
            PointerLock.Focus(focused);
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

        // One line in the middle of the view: a portal still waiting for its world (PRD v4 5.9.2),
        // or why the application has stopped (PRD v4 7.4.1). Null takes it away.
        public void Say(string text)
        {
            line.text = text ?? "";
            line.style.display = text != null ? DisplayStyle.Flex : DisplayStyle.None;
            if (text != null)
            {
                PointerLock.Release();
            }
        }

        // The hover label of a stand within reach (PRD v4 5.5.3), above a point of the view given in
        // pixels from its top left. Null hides it. The view is the camera's, not the screen's: a
        // run without a screen draws into a texture of another size.
        public void Hover(string text, Vector2 viewPoint)
        {
            if (text == null)
            {
                hover.style.display = DisplayStyle.None;
                return;
            }
            hover.text = text;
            hover.style.display = DisplayStyle.Flex;
            Vector2 at = RuntimePanelUtils.ScreenToPanel(hover.panel, viewPoint);
            hover.style.left = at.x;
            hover.style.top = at.y - 8;
        }

        // The printings panel (PRD v4 5.10.3). `choose` is told the row that was clicked. The
        // place line hides with the rest of the HUD in card view (PRD v4 6.3.5).
        public void ShowCard(CardSheet sheet, Action<int> choose, Action flip, Action open, Action leave)
        {
            Sheet = sheet;
            corner.style.display = DisplayStyle.None;
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
            PointerLock.Release();
        }

        // A stone's overlay (PRD v4 5.13.1, 6.6.2). Each of `set`, `headline` and `travel` is told
        // the place in its list of the link chosen. Its first link takes the focus, so a keyboard
        // or a gamepad moves through it from there (6.10.2).
        public void ShowStone(StoneSheet sheet, Action<int> set, Action<int> headline, Action<int> travel, Action close)
        {
            Stone = sheet;
            corner.style.display = DisplayStyle.None;
            stone.Clear();
            var body = new ScrollView();
            body.style.flexGrow = 1;
            StoneBody = body;
            body.Add(Text(sheet.Name, 28, Ink));
            if (sheet.Years != null)
            {
                body.Add(Text(sheet.Years, 16, Dim));
            }
            if (sheet.Place != null)
            {
                body.Add(Text(sheet.Place, 16, Dim));
            }
            foreach (string paragraph in sheet.Paragraphs)
            {
                Label words = Text(paragraph, 18, Ink);
                words.style.marginTop = 12;
                body.Add(words);
            }
            Button first = null;
            void Links(string heading, List<(string Text, bool Link)> rows, Action<int> chosen)
            {
                if (rows.Count == 0)
                {
                    return;
                }
                Label title = Text(heading, 16, Dim);
                title.style.marginTop = 16;
                body.Add(title);
                for (int i = 0; i < rows.Count; i++)
                {
                    int row = i;
                    if (!rows[i].Link)
                    {
                        Label named = Text(rows[i].Text, 15, Dim);
                        Pad(named, 3, 6);
                        body.Add(named);
                        continue;
                    }
                    Button link = Link(rows[i].Text, () => chosen(row));
                    first ??= link;
                    body.Add(link);
                }
            }
            Links("Sets", sheet.Sets, set);
            Links("Headline cards", sheet.Headlines, headline);
            Links("Travel", sheet.Travel.ConvertAll(choice => (choice, true)), travel);
            if (sheet.Sources.Count > 0)
            {
                var sources = new Foldout { text = $"Sources ({sheet.Sources.Count})", value = false };
                sources.style.marginTop = 16;
                sources.style.color = Dim;
                sources.style.fontSize = 16;
                Visible(sources.Q<Toggle>());
                foreach (string source in sheet.Sources)
                {
                    Label line = Text(source, 14, Dim);
                    line.style.marginTop = 2;
                    sources.Add(line);
                }
                body.Add(sources);
            }
            stone.Add(body);
            Button closing = Action("Close", close);
            Visible(closing);
            stone.Add(closing);
            stone.style.display = DisplayStyle.Flex;
            PointerLock.Release();
            (first ?? closing).Focus();
        }

        public void HideStone()
        {
            Stone = null;
            StoneBody = null;
            stone.Clear();
            stone.style.display = DisplayStyle.None;
            corner.style.display = DisplayStyle.Flex;
        }

        // A link of an overlay: its words on the panel, as a row that a click, Enter or a gamepad's
        // button chooses.
        static Button Link(string text, Action chosen)
        {
            var link = new Button(chosen) { text = text };
            link.style.fontSize = 15;
            link.style.unityTextAlign = TextAnchor.MiddleLeft;
            link.style.whiteSpace = WhiteSpace.Normal;
            link.style.color = Ink;
            link.style.backgroundColor = new Color(0, 0, 0, 0);
            link.style.marginLeft = link.style.marginRight = 0;
            link.style.borderTopWidth = link.style.borderBottomWidth = link.style.borderLeftWidth = link.style.borderRightWidth = 0;
            Visible(link);
            return link;
        }

        // The focus shows (PRD v4 6.10.2): a focused control takes the accent and a light border.
        static void Visible(VisualElement control)
        {
            control.focusable = true;
            StyleColor background = control.style.backgroundColor;
            control.RegisterCallback<FocusInEvent>(_ =>
            {
                control.style.backgroundColor = Accent;
                control.style.borderTopWidth = control.style.borderBottomWidth = control.style.borderLeftWidth = control.style.borderRightWidth = 2;
                control.style.borderTopColor = control.style.borderBottomColor = control.style.borderLeftColor = control.style.borderRightColor = Ink;
            });
            control.RegisterCallback<FocusOutEvent>(_ =>
            {
                control.style.backgroundColor = background;
                control.style.borderTopWidth = control.style.borderBottomWidth = control.style.borderLeftWidth = control.style.borderRightWidth = 0;
            });
        }

        public void HideCard()
        {
            Sheet = null;
            panel.style.display = DisplayStyle.None;
            corner.style.display = DisplayStyle.Flex;
        }

        // The travel menu (PRD v4 6.6.1): the world's sites in trail order with an era's chapters,
        // then its regions, and the cards of a site whose cards are asked for. `travel` is told the
        // row chosen, `cardsOf` gives a site's cards, and `choose` is told the site and the card's
        // place in its list.
        public void ShowTravel(string world, List<TravelRow> rows, Func<int, List<string>> cardsOf, Action<int> travel, Action<int, int> choose, Action close)
        {
            this.travel.Clear();
            this.travel.Add(Text($"Travel · {world}", 24, Ink));
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
            cards.selectionChanged += _ =>
            {
                if (cards.selectedIndex >= 0 && chosenSite >= 0)
                {
                    choose(chosenSite, cards.selectedIndex);
                }
            };
            var list = new ScrollView();
            list.style.flexGrow = 1;
            list.style.flexBasis = 0;
            TravelList = list;
            Button first = null;
            for (int i = 0; i < rows.Count; i++)
            {
                int row = i;
                TravelRow line = rows[i];
                if (line.Heading)
                {
                    Label heading = Text(line.Text, 16, Dim);
                    heading.style.marginTop = i == 0 ? 0 : 14;
                    list.Add(heading);
                    continue;
                }
                var entry = new VisualElement();
                entry.style.flexDirection = FlexDirection.Row;
                entry.style.marginLeft = 16 * line.Depth;
                VisualElement named;
                if (line.Travels)
                {
                    Button go = Link(line.Text, () => travel(row));
                    first ??= go;
                    named = go;
                }
                else
                {
                    named = Text(line.Text, 15, Dim);
                    Pad(named, 3, 6);
                }
                named.style.flexGrow = 1;
                named.style.flexShrink = 1;
                entry.Add(named);
                if (line.Site >= 0)
                {
                    int site = line.Site;
                    Button listed = Link("Cards", () =>
                    {
                        chosenSite = site;
                        names = cardsOf(site);
                        cards.itemsSource = names;
                        cards.ClearSelection();
                        cards.Rebuild();
                    });
                    listed.style.flexGrow = 0;
                    listed.style.color = Dim;
                    entry.Add(listed);
                }
                list.Add(entry);
            }
            columns.Add(list);
            columns.Add(cards);
            this.travel.Add(columns);
            Button closing = Action("Close", close);
            Visible(closing);
            this.travel.Add(closing);
            this.travel.style.display = DisplayStyle.Flex;
            PointerLock.Release();
            (first ?? closing).Focus();
        }

        public void HideTravel()
        {
            travel.style.display = DisplayStyle.None;
        }
    }
}
