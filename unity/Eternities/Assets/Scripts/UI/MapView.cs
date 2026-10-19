using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UIElements;

namespace Eternities.UI
{
    // What the map draws (PRD v4 6.3.4), in metres on the world's ground plane, x east and y north.
    // The world builds it once; the map holds nothing of the world's own types.
    public sealed class MapModel
    {
        public sealed class Area
        {
            public string Name;
            public Vector2[] Outline;
            public Vector2 Label;
            public int Site = -1;           // the region's first site in site order, or -1 for a region with none
        }

        public sealed class Site
        {
            public string Name;
            public Vector2[] Outline;
            public Vector2 Stone, Pad;
            public Vector2[] Chapters;      // its chapter stones
        }

        public Vector2 Centre;
        public float HalfSide;              // metres from the centre to each edge of the square the map shows
        public Texture2D Ground;            // the ground and its water seen from above, over that square; or null
        public readonly List<Area> Regions = new List<Area>();
        public readonly List<Vector2[]> Trail = new List<Vector2[]>();
        public readonly List<Site> Sites = new List<Site>();     // in site order: a site's number is its place here, from 1
        public Vector2 ReturnPortal;
        public Vector2[] Dots = new Vector2[0];                  // the stands
        public Color[] DotColours = new Color[0];                // each one's class colour
    }

    // The map overlay's drawing (PRD v4 6.3.4): the ground from above with the regions as areas
    // named at their anchors, the trail as a line, the sites as outlines with their stones
    // numbered in site order and their chapter stones, the return portal, every stand as a dot in
    // its class colour, and the avatar. A click on a site or its stone asks for travel to that
    // site; a click on a region asks for its first site, and a region with no site asks for none.
    //
    // The still parts are drawn once, when the map is shown; the avatar is a child of its own that
    // moves without drawing them again.
    public sealed class MapView : VisualElement
    {
        static readonly Color Line = new Color(0.93f, 0.92f, 0.88f, 0.55f), Trail = new Color(0.86f, 0.74f, 0.52f, 0.95f);
        static readonly Color Outline = new Color(0.96f, 0.95f, 0.90f, 0.9f), Stone = new Color(0.12f, 0.12f, 0.14f, 0.95f);
        static readonly Color Portal = new Color(0.35f, 0.75f, 1f, 1f), Avatar = new Color(1f, 0.30f, 0.25f, 1f);
        public const float DotPixels = 2.5f, StonePixels = 9, ClickPixels = 12;

        readonly Image ground = new Image { scaleMode = ScaleMode.StretchToFill, pickingMode = PickingMode.Ignore };
        readonly VisualElement marks = new VisualElement { pickingMode = PickingMode.Ignore };
        readonly VisualElement avatar = new VisualElement { pickingMode = PickingMode.Ignore };
        readonly List<Label> names = new List<Label>();
        MapModel model;

        // A click asks for travel to a site, by its index; `Hovered` names what a click would do.
        public Action<int> Chosen;
        public Action<string> Hovered;

        public MapView()
        {
            style.position = Position.Relative;
            style.overflow = Overflow.Hidden;
            foreach (VisualElement layer in new[] { ground, marks })
            {
                layer.style.position = Position.Absolute;
                layer.style.left = layer.style.top = layer.style.right = layer.style.bottom = 0;
                Add(layer);
            }
            marks.generateVisualContent += Draw;
            // The avatar: an arrow 18 pixels long pointing up, turned to its heading.
            avatar.style.position = Position.Absolute;
            avatar.style.width = avatar.style.height = 18;
            avatar.style.translate = new Translate(Length.Percent(-50), Length.Percent(-50));
            avatar.generateVisualContent += context =>
            {
                Painter2D pen = context.painter2D;
                pen.fillColor = Avatar;
                pen.strokeColor = Color.white;
                pen.lineWidth = 1.5f;
                pen.BeginPath();
                pen.MoveTo(new Vector2(9, 0));
                pen.LineTo(new Vector2(17, 17));
                pen.LineTo(new Vector2(9, 12));
                pen.LineTo(new Vector2(1, 17));
                pen.ClosePath();
                pen.Fill();
                pen.Stroke();
            };
            Add(avatar);
            RegisterCallback<PointerDownEvent>(OnClick);
            RegisterCallback<PointerMoveEvent>(evt => Hovered?.Invoke(Describe(evt.localPosition)));
            RegisterCallback<PointerLeaveEvent>(_ => Hovered?.Invoke(null));
            RegisterCallback<GeometryChangedEvent>(_ => Place());
        }

        public MapModel Model => model;

        public void Show(MapModel shown)
        {
            model = shown;
            ground.image = shown.Ground;
            foreach (Label name in names)
            {
                name.RemoveFromHierarchy();
            }
            names.Clear();
            foreach (MapModel.Area area in shown.Regions)
            {
                if (area.Name != null)
                {
                    names.Add(Name(area.Name, 15, area.Label));
                }
            }
            for (int s = 0; s < shown.Sites.Count; s++)
            {
                names.Add(Name((s + 1).ToString(), 11, shown.Sites[s].Stone));
            }
            Place();
            marks.MarkDirtyRepaint();
        }

        Label Name(string text, int size, Vector2 at)
        {
            var label = new Label(text) { pickingMode = PickingMode.Ignore, userData = at };
            label.style.position = Position.Absolute;
            label.style.fontSize = size;
            label.style.color = new Color(0.97f, 0.96f, 0.92f);
            label.style.unityTextOutlineColor = new Color(0, 0, 0, 0.85f);
            label.style.unityTextOutlineWidth = 0.15f;
            label.style.marginLeft = label.style.marginRight = label.style.marginTop = label.style.marginBottom = 0;
            label.style.paddingLeft = label.style.paddingRight = label.style.paddingTop = label.style.paddingBottom = 0;
            label.style.translate = new Translate(Length.Percent(-50), Length.Percent(-50));
            Insert(IndexOf(avatar), label);
            return label;
        }

        // The labels sit at their places as the map's size has them now.
        void Place()
        {
            if (model == null)
            {
                return;
            }
            foreach (Label name in names)
            {
                Vector2 at = ToView((Vector2)name.userData);
                name.style.left = at.x;
                name.style.top = at.y;
            }
            marks.MarkDirtyRepaint();
        }

        // The avatar at a place of the ground, heading `degrees` clockwise from north.
        public void Walker(Vector2 metres, float degrees)
        {
            if (model == null)
            {
                return;
            }
            Vector2 at = ToView(metres);
            avatar.style.left = at.x;
            avatar.style.top = at.y;
            avatar.style.rotate = new Rotate(Angle.Degrees(degrees));
        }

        public Vector2 ToView(Vector2 metres)
        {
            Rect box = contentRect;
            float side = 2 * model.HalfSide;
            return new Vector2((metres.x - model.Centre.x + model.HalfSide) / side * box.width, (model.Centre.y + model.HalfSide - metres.y) / side * box.height);
        }

        public Vector2 ToMetres(Vector2 view)
        {
            Rect box = contentRect;
            float side = 2 * model.HalfSide;
            return new Vector2(model.Centre.x - model.HalfSide + view.x / box.width * side, model.Centre.y + model.HalfSide - view.y / box.height * side);
        }

        void Draw(MeshGenerationContext context)
        {
            if (model == null || contentRect.width <= 0)
            {
                return;
            }
            Painter2D pen = context.painter2D;
            pen.lineJoin = LineJoin.Round;
            pen.lineCap = LineCap.Round;
            // The regions' boundaries.
            pen.strokeColor = Line;
            pen.lineWidth = 1.5f;
            foreach (MapModel.Area area in model.Regions)
            {
                Path(pen, area.Outline, closed: true);
                pen.Stroke();
            }
            // The trail.
            pen.strokeColor = Trail;
            pen.lineWidth = 2.5f;
            foreach (Vector2[] leg in model.Trail)
            {
                Path(pen, leg, closed: false);
                pen.Stroke();
            }
            // The sites' outlines, and their chapter stones.
            pen.strokeColor = Outline;
            pen.lineWidth = 1.5f;
            foreach (MapModel.Site site in model.Sites)
            {
                Path(pen, site.Outline, closed: true);
                pen.Stroke();
            }
            pen.fillColor = Outline;
            foreach (MapModel.Site site in model.Sites)
            {
                foreach (Vector2 chapter in site.Chapters)
                {
                    Vector2 at = ToView(chapter);
                    pen.BeginPath();
                    pen.MoveTo(at + new Vector2(0, -3.5f));
                    pen.LineTo(at + new Vector2(3.5f, 0));
                    pen.LineTo(at + new Vector2(0, 3.5f));
                    pen.LineTo(at + new Vector2(-3.5f, 0));
                    pen.ClosePath();
                    pen.Fill();
                }
            }
            Dots(context);
            // The sites' stones, under their numbers.
            pen.fillColor = Stone;
            pen.strokeColor = Outline;
            pen.lineWidth = 1.2f;
            foreach (MapModel.Site site in model.Sites)
            {
                pen.BeginPath();
                pen.Arc(ToView(site.Stone), StonePixels, Angle.Degrees(0), Angle.Degrees(360));
                pen.Fill();
                pen.Stroke();
            }
            // The return portal.
            pen.strokeColor = Portal;
            pen.lineWidth = 3;
            pen.BeginPath();
            pen.Arc(ToView(model.ReturnPortal), 7, Angle.Degrees(0), Angle.Degrees(360));
            pen.Stroke();
        }

        void Path(Painter2D pen, Vector2[] points, bool closed)
        {
            pen.BeginPath();
            for (int i = 0; i < points.Length; i++)
            {
                if (i == 0)
                {
                    pen.MoveTo(ToView(points[i]));
                }
                else
                {
                    pen.LineTo(ToView(points[i]));
                }
            }
            if (closed)
            {
                pen.ClosePath();
            }
        }

        // Every stand as a square dot in its class colour: four vertices a dot, in batches the
        // 16-bit indices can address.
        void Dots(MeshGenerationContext context)
        {
            const int Batch = 16000;
            float half = DotPixels / 2;
            for (int first = 0; first < model.Dots.Length; first += Batch)
            {
                int count = Math.Min(Batch, model.Dots.Length - first);
                MeshWriteData mesh = context.Allocate(4 * count, 6 * count);
                for (int i = 0; i < count; i++)
                {
                    Vector2 at = ToView(model.Dots[first + i]);
                    Color32 tint = model.DotColours[first + i];
                    mesh.SetNextVertex(new Vertex { position = new Vector3(at.x - half, at.y - half, Vertex.nearZ), tint = tint });
                    mesh.SetNextVertex(new Vertex { position = new Vector3(at.x + half, at.y - half, Vertex.nearZ), tint = tint });
                    mesh.SetNextVertex(new Vertex { position = new Vector3(at.x + half, at.y + half, Vertex.nearZ), tint = tint });
                    mesh.SetNextVertex(new Vertex { position = new Vector3(at.x - half, at.y + half, Vertex.nearZ), tint = tint });
                    ushort v = (ushort)(4 * i);
                    mesh.SetNextIndex(v);
                    mesh.SetNextIndex((ushort)(v + 1));
                    mesh.SetNextIndex((ushort)(v + 2));
                    mesh.SetNextIndex(v);
                    mesh.SetNextIndex((ushort)(v + 2));
                    mesh.SetNextIndex((ushort)(v + 3));
                }
            }
        }

        // The site a click at a point of the map asks for, or -1: the nearest stone within
        // `ClickPixels`, then a site's outline, then a region's first site.
        public int SiteAt(Vector2 view)
        {
            if (model == null)
            {
                return -1;
            }
            int nearest = -1;
            float best = ClickPixels * ClickPixels;
            for (int s = 0; s < model.Sites.Count; s++)
            {
                float d = (ToView(model.Sites[s].Stone) - view).sqrMagnitude;
                if (d <= best)
                {
                    best = d;
                    nearest = s;
                }
            }
            if (nearest >= 0)
            {
                return nearest;
            }
            Vector2 metres = ToMetres(view);
            for (int s = 0; s < model.Sites.Count; s++)
            {
                if (Inside(metres, model.Sites[s].Outline))
                {
                    return s;
                }
            }
            MapModel.Area area = AreaAt(metres);
            return area != null ? area.Site : -1;
        }

        MapModel.Area AreaAt(Vector2 metres)
        {
            foreach (MapModel.Area area in model.Regions)
            {
                if (Inside(metres, area.Outline))
                {
                    return area;
                }
            }
            return null;
        }

        // What a click at a point does, in words: the site it travels to, or the region with no
        // site, which is named and offers no travel.
        public string Describe(Vector2 view)
        {
            if (model == null)
            {
                return null;
            }
            int site = SiteAt(view);
            if (site >= 0)
            {
                return $"{site + 1}. {model.Sites[site].Name}: click to travel";
            }
            MapModel.Area area = AreaAt(ToMetres(view));
            return area?.Name;
        }

        void OnClick(PointerDownEvent evt)
        {
            if (evt.button != 0)
            {
                return;
            }
            int site = SiteAt(evt.localPosition);
            if (site >= 0)
            {
                Chosen?.Invoke(site);
                evt.StopPropagation();
            }
        }

        // The even-odd rule.
        public static bool Inside(Vector2 point, Vector2[] polygon)
        {
            bool inside = false;
            for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
            {
                Vector2 a = polygon[i], b = polygon[j];
                if ((a.y > point.y) != (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x)
                {
                    inside = !inside;
                }
            }
            return inside;
        }
    }
}
