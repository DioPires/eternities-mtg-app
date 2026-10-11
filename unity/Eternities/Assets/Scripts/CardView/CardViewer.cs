using System;
using System.Collections.Generic;
using Eternities.Data;
using Eternities.Kits;
using Eternities.Layout;
using Eternities.UI;
using Unity.Cinemachine;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.CardView
{
    // Card view (PRD v4 5.10). Entering it puts a card in front of its stand: a thin dark solid with
    // rounded corners, the printing's `large` image on its face and the card back, or the card's
    // other face, behind.
    // Both faces are drawn on the isolated path, from two textures of their own. The camera moves
    // inside the stand's apron over 0.6 s to where the card is 60% of the view's height, to the
    // left of the middle, which leaves the right for the printings panel. The world behind the card
    // takes a little depth of field; the card takes none. Nothing in the world pauses.
    public sealed class CardViewer : MonoBehaviour
    {
        public const float BlendSeconds = 0.6f, ReducedBlendSeconds = 0.3f;
        public const float CardFraction = 0.6f, PanelFraction = 0.34f, TiltDegrees = 12, FlipSeconds = 0.35f;
        public const float CardHeight = StandImages.SurfaceHeight, CardWidth = CardHeight * 672 / 936, Thickness = 0.006f, Lift = 0.05f;
        // The card's corner is a stand's: the solid's shape is what leaves the image file's white
        // corners out.
        public const float CornerFraction = StandImages.CornerFraction, Edge = 0.003f;
        const int CornerSteps = 6;
        // PRD v4 7.4.3: one line when the printing's image is not to be had, by what the face shows instead.
        public const string NoImage = "This printing's image could not be loaded. The card's swatch is shown.";
        public const string NoLargeImage = "This printing's large image could not be loaded. The stand's image is shown.";
        public const string NoImageOfThis = "This printing's image could not be loaded. The image shown is another printing's.";
        static readonly int FrontId = Shader.PropertyToID("_ExhibitCardFront"), BackId = Shader.PropertyToID("_ExhibitCardBack");

        Camera view;
        CinemachineBrain brain;
        CinemachineCamera rig;
        Volume focus;
        WorldData world;
        StandImages images;
        IImageSource source;
        GameObject card;
        Mesh faces, body;
        readonly List<Vector2> faceUv = new List<Vector2>(), swatchUv = new List<Vector2>(), slotUv = new List<Vector2>();
        Texture2D front, back;
        string frontUrl, backUrl;
        int frontPrinting = -1;     // the printing whose `large` image the face holds, or -1
        bool frontRefused;          // the source has said the wanted image is not coming this session
        float turn, turnVelocity, turned;       // the flip: 0 the front, 180 the back
        Vector2 tilt, tiltVelocity;
        float changedAt;

        public int Stand { get; private set; } = -1;
        public int Printing { get; private set; }
        public bool ShowingBack { get; private set; }
        public bool Active => Stand >= 0;
        public bool ReducedMotion;
        public string Notice { get; private set; }      // one line when an image could not be shown
        public bool FrontShown => front != null && frontPrinting == Printing;
        public bool BackShown => back != null;
        public PackCard Card => world.Cards[world.Layout.Stands[Stand].Card];
        public Transform CardTransform => card != null ? card.transform : null;
        public event Action Changed;

        // The camera has arrived, at the card or back at the avatar.
        public bool Settled => Time.time - changedAt >= (ReducedMotion ? ReducedBlendSeconds : BlendSeconds) && !brain.IsBlending;

        public static CardViewer Create(Camera view)
        {
            var holder = new GameObject("Card view");
            var viewer = holder.AddComponent<CardViewer>();
            viewer.view = view;
            viewer.brain = view.GetComponent<CinemachineBrain>();
            var rigHolder = new GameObject("Card view camera");
            rigHolder.transform.SetParent(holder.transform, false);
            viewer.rig = rigHolder.AddComponent<CinemachineCamera>();
            viewer.rig.Lens.FieldOfView = view.fieldOfView;
            viewer.rig.Lens.NearClipPlane = view.nearClipPlane;
            viewer.rig.Lens.FarClipPlane = view.farClipPlane;
            viewer.rig.Priority = new PrioritySettings { Enabled = true, Value = -10 };

            // A subtle depth of field on the world behind the card (PRD v4 5.10.1). The card is
            // composited after it, so it takes none.
            viewer.focus = holder.AddComponent<Volume>();
            viewer.focus.isGlobal = true;
            viewer.focus.priority = 10;
            viewer.focus.weight = 0;
            viewer.focus.profile = ScriptableObject.CreateInstance<VolumeProfile>();
            DepthOfField blur = viewer.focus.profile.Add<DepthOfField>();
            blur.focusMode.Override(DepthOfFieldMode.Manual);
            blur.nearFocusStart.Override(0);
            blur.nearFocusEnd.Override(0);
            blur.farFocusStart.Override(3);
            blur.farFocusEnd.Override(14);
            return viewer;
        }

        // Depth of field for a few frames with nothing to show: the pipeline readies it once, and the
        // caller does this where no one sees.
        public void Warm(bool on)
        {
            warming = on;
        }

        bool warming;

        // The world whose stands this views. Called when a world is loaded, and with nulls when it is left.
        public void Bind(WorldData data, StandImages standImages, IImageSource imageSource)
        {
            if (Active)
            {
                Close();
            }
            world = data;
            images = standImages;
            source = imageSource;
        }

        public void Enter(int stand)
        {
            if (Active)
            {
                Close();
            }
            Stand = stand;
            Printing = 0;
            ShowingBack = false;
            turn = turned = 0;
            Notice = null;
            frontPrinting = -1;
            frontRefused = false;
            LayoutStand placed = world.Layout.Stands[stand];
            Quaternion facing = StandField.Facing(placed);
            Vector3 centre = StandField.Ground(placed.Position) + new Vector3(0, StandField.PlinthHeight + CardHeight / 2, 0) + facing * Vector3.forward * (StandField.SlabDepth / 2 + Lift);

            Build(centre, facing);
            // Where the card is `CardFraction` of the view's height, in the middle of what the panel leaves.
            float distance = CardHeight / (CardFraction * 2 * Mathf.Tan(view.fieldOfView * Mathf.Deg2Rad / 2));
            float viewWidth = 2 * distance * Mathf.Tan(view.fieldOfView * Mathf.Deg2Rad / 2) * view.aspect;
            // Seen from the apron the viewer's right is the stand's left.
            Vector3 eye = centre + facing * Vector3.forward * distance - facing * Vector3.right * (viewWidth * PanelFraction / 2);
            rig.transform.SetPositionAndRotation(eye, facing * Quaternion.Euler(0, 180, 0));
            brain.DefaultBlend = new CinemachineBlendDefinition(CinemachineBlendDefinition.Styles.EaseInOut, ReducedMotion ? ReducedBlendSeconds : BlendSeconds);
            rig.Priority = new PrioritySettings { Enabled = true, Value = 20 };
            changedAt = Time.time;
            Fetch();
            Changed?.Invoke();
        }

        public void Leave()
        {
            if (Active)
            {
                Close();
                changedAt = Time.time;
                Changed?.Invoke();
            }
        }

        // The card's face becomes another printing (PRD v4 5.10.3).
        public void Show(int printing)
        {
            if (!Active || printing == Printing || printing < 0 || printing >= Card.Printings.Length)
            {
                return;
            }
            Printing = printing;
            Fetch();
            Changed?.Invoke();
        }

        public void Flip()
        {
            if (Active && Card.HasBackImage)
            {
                ShowingBack = !ShowingBack;
                turn = ShowingBack ? 180 : 0;
                Changed?.Invoke();
            }
        }

        void Close()
        {
            rig.Priority = new PrioritySettings { Enabled = true, Value = -10 };
            if (frontUrl != null && front == null)
            {
                source?.Cancel(frontUrl);
            }
            if (backUrl != null && back == null)
            {
                source?.Cancel(backUrl);
            }
            frontUrl = backUrl = null;
            frontPrinting = -1;
            Destroy(front);
            Destroy(back);
            front = back = null;
            Destroy(card);
            Destroy(faces);
            Destroy(body);
            card = null;
            Stand = -1;
        }

        // The outline of a rounded rectangle about the origin, in the card's own plane. It runs
        // anticlockwise with x to the right and y up, which is the card seen from behind.
        static List<Vector2> Outline(float halfWidth, float halfHeight, float radius) => StandImages.Outline(halfWidth, halfHeight, radius, CornerSteps);

        // The solid, in the world's own frame so the main camera sees a card there, and the two
        // faces on the exhibit layer. Both are rounded rectangles (PRD v4 5.10.2): the solid is
        // the faces' shape and a dark edge more.
        void Build(Vector3 centre, Quaternion facing)
        {
            card = new GameObject("Card");
            card.transform.SetPositionAndRotation(centre, facing);

            float w = CardWidth / 2, h = CardHeight / 2, d = Thickness / 2, radius = CardWidth * CornerFraction;
            body = new Mesh { name = "card" };
            var corners = new List<Vector3>();
            var triangles = new List<int>();
            List<Vector2> edge = Outline(w + Edge, h + Edge, radius + Edge);
            foreach (float side in new[] { 1f, -1f })
            {
                int middle = corners.Count;
                corners.Add(new Vector3(0, 0, side * d));
                foreach (Vector2 point in edge)
                {
                    corners.Add(new Vector3(point.x, point.y, side * d));
                }
                for (int i = 0; i < edge.Count; i++)
                {
                    int a = middle + 1 + i, b = middle + 1 + (i + 1) % edge.Count;
                    triangles.AddRange(side > 0 ? new[] { middle, a, b } : new[] { middle, b, a });
                }
            }
            int strip = corners.Count;
            foreach (Vector2 point in edge)
            {
                corners.Add(new Vector3(point.x, point.y, d));
                corners.Add(new Vector3(point.x, point.y, -d));
            }
            for (int i = 0; i < edge.Count; i++)
            {
                int a = strip + 2 * i, b = strip + 2 * ((i + 1) % edge.Count);
                triangles.AddRange(new[] { a, a + 1, b, b, a + 1, b + 1 });
            }
            body.SetVertices(corners);
            body.SetTriangles(triangles, 0);
            body.RecalculateNormals();
            var solid = new GameObject("Solid");
            solid.transform.SetParent(card.transform, false);
            solid.AddComponent<MeshFilter>().sharedMesh = body;
            solid.AddComponent<MeshRenderer>().sharedMaterial = BodyMaterial;

            // The front, which faces the apron, and then the back. An image's left is the viewer's
            // left: the card's own +x seen from the front, its -x seen from behind.
            faces = new Mesh { name = "card faces" };
            faces.MarkDynamic();
            float z = d + 0.0005f;
            List<Vector2> outline = Outline(w, h, radius);
            var points = new List<Vector3>();
            var faceTriangles = new List<int>();
            faceUv.Clear();
            foreach (float side in new[] { 1f, -1f })
            {
                int middle = points.Count;
                points.Add(new Vector3(0, 0, side * z));
                faceUv.Add(new Vector2(0.5f, 0.5f));
                foreach (Vector2 point in outline)
                {
                    points.Add(new Vector3(point.x, point.y, side * z));
                    faceUv.Add(new Vector2(0.5f - side * point.x / (2 * w), 0.5f + point.y / (2 * h)));
                }
                for (int i = 0; i < outline.Count; i++)
                {
                    int a = middle + 1 + i, b = middle + 1 + (i + 1) % outline.Count;
                    faceTriangles.AddRange(side > 0 ? new[] { middle, a, b } : new[] { middle, b, a });
                }
            }
            faces.SetVertices(points);
            faces.SetUVs(1, faceUv);
            faces.SetTriangles(faceTriangles, 0);
            faces.RecalculateBounds();
            Faces();
            var surface = new GameObject("Faces") { layer = Exhibit.Layer };
            surface.transform.SetParent(card.transform, false);
            surface.AddComponent<MeshFilter>().sharedMesh = faces;
            var renderer = surface.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = images.SurfaceMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
        }

        public Material BodyMaterial;

        // What each face shows now: its own texture when it has arrived. Until the front's does, the
        // stand's own image if the stand has one, and the stand's swatch if it has none.
        void Faces()
        {
            swatchUv.Clear();
            slotUv.Clear();
            int slot = images.SlotOf(Stand);
            Vector2 cut = images.CutOut;
            bool swatch = front == null && slot < 0;
            Vector2 from = images.SwatchCorner(Stand, 0), across = images.SwatchCorner(Stand, 2) - from;
            for (int vertex = 0; vertex < faceUv.Count; vertex++)
            {
                bool isFront = vertex < faceUv.Count / 2;
                swatchUv.Add(isFront && swatch ? from + Vector2.Scale(across, faceUv[vertex]) : cut);
                slotUv.Add(new Vector2(isFront ? (front != null ? -2 : slot) : (back != null ? -3 : -1), 1));
            }
            faces.SetUVs(0, swatchUv);
            faces.SetUVs(2, slotUv);
        }

        // The `large` image of the printing that is shown, and of what is behind it: the card's
        // other face when it has a back image, the card back when it has not.
        void Fetch()
        {
            PackCard shown = Card;
            PackPrinting printing = shown.Printings[Printing];
            string wantFront = ImageUrls.Face(printing.Id, printing.ImageTs, ImageSize.Large);
            string wantBack = ImageUrls.Back(shown, printing, ImageSize.Large) ?? ImageUrls.CardBack;
            int stand = Stand;
            if (wantFront != frontUrl)
            {
                if (frontUrl != null && front == null)
                {
                    source?.Cancel(frontUrl);
                }
                frontUrl = wantFront;
                frontRefused = false;
                source?.Request(wantFront, 0, texture => Arrived(stand, wantFront, texture, isFront: true));
            }
            if (wantBack != backUrl)
            {
                if (backUrl != null && back == null)
                {
                    source?.Cancel(backUrl);
                }
                backUrl = wantBack;
                source?.Request(wantBack, 0, texture => Arrived(stand, wantBack, texture, isFront: false));
            }
        }

        void Arrived(int stand, string url, Texture2D texture, bool isFront)
        {
            if (this == null || Stand != stand || url != (isFront ? frontUrl : backUrl))
            {
                Destroy(texture);
                return;
            }
            if (texture == null)
            {
                // The image is not coming this session. What is on the face stays (PRD v4 7.4.2),
                // and `Update` says so.
                frontRefused |= isFront;
                return;
            }
            texture.filterMode = FilterMode.Trilinear;
            texture.wrapMode = TextureWrapMode.Clamp;
            if (isFront)
            {
                Destroy(front);
                front = texture;
                frontPrinting = Printing;
                Shader.SetGlobalTexture(FrontId, front);
            }
            else
            {
                Destroy(back);
                back = texture;
                Shader.SetGlobalTexture(BackId, back);
            }
            Faces();
            Changed?.Invoke();
        }

        void Update()
        {
            float blend = ReducedMotion ? ReducedBlendSeconds : BlendSeconds;
            focus.weight = warming ? 1 : Mathf.MoveTowards(focus.weight, Active ? 1 : 0, Time.deltaTime / blend);
            if (!Active)
            {
                return;
            }
            // The card tilts toward the pointer, up to 12 degrees, with a spring, and settles when
            // the pointer leaves the window (PRD v4 5.10.2). Reduced motion keeps it still.
            Vector2 want = Vector2.zero;
            UnityEngine.InputSystem.Mouse mouse = UnityEngine.InputSystem.Mouse.current;
            Vector2 pointer = mouse != null && !ReducedMotion && Application.isFocused ? mouse.position.ReadValue() : new Vector2(-1, -1);
            if (pointer.x >= 0 && pointer.y >= 0 && pointer.x <= Screen.width && pointer.y <= Screen.height)
            {
                want = new Vector2((pointer.x / Screen.width - 0.5f) * 2, (pointer.y / Screen.height - 0.5f) * 2) * TiltDegrees;
            }
            tilt = Vector2.SmoothDamp(tilt, want, ref tiltVelocity, 0.15f);
            turned = ReducedMotion ? turn : Mathf.SmoothDamp(turned, turn, ref turnVelocity, FlipSeconds / 3);
            LayoutStand placed = world.Layout.Stands[Stand];
            card.transform.rotation = StandField.Facing(placed) * Quaternion.Euler(tilt.y, turned - tilt.x, 0);

            // PRD v4 7.4.3: while the printing's image is not to be had, one line says so, and says
            // what the face shows instead. With the network down the source goes on trying and
            // never answers, so it is asked. The line goes when the image comes.
            string notice = null;
            if (frontPrinting != Printing && (frontRefused || (source != null && source.Failing(frontUrl))))
            {
                bool standImage = front == null && images.SlotOf(Stand) >= 0;
                notice = front == null && !standImage ? NoImage : standImage && Printing == 0 ? NoLargeImage : NoImageOfThis;
            }
            if (notice != Notice)
            {
                Notice = notice;
                Changed?.Invoke();
            }
        }

        // The card as text and its printings, for the panel (PRD v4 5.10.3).
        public CardSheet Sheet()
        {
            PackCard shown = Card;
            var sheet = new CardSheet
            {
                Name = shown.Name, ManaCost = shown.ManaCost, TypeLine = shown.TypeLine, Text = shown.OracleText,
                Identity = shown.ColourIdentity.Length == 0 ? "colourless" : shown.ColourIdentity,
                Rarity = new[] { "common", "uncommon", "rare", "mythic" }[Mathf.Clamp(shown.Rarity, 0, 3)],
                // The credit is of the image on the face (PRD v4 5.10.3): the last `large` image that
                // came, or the stand's own, which is the first printing's.
                Active = Printing, Artist = shown.Printings[front != null ? frontPrinting : images.SlotOf(Stand) >= 0 ? 0 : Printing].Artist,
                CanFlip = shown.HasBackImage, Notice = Notice,
            };
            if (shown.Back != null)
            {
                sheet.BackName = shown.Back.Name;
                sheet.BackTypeLine = shown.Back.TypeLine;
                sheet.BackText = shown.Back.OracleText;
            }
            foreach (PackPrinting printing in shown.Printings)
            {
                world.Sets.TryGetValue(printing.SetId, out PackSet set);
                string rarity = printing.Rarity == 'c' ? "common" : printing.Rarity == 'u' ? "uncommon" : printing.Rarity == 'r' ? "rare" : "mythic";
                sheet.Printings.Add($"{set?.Name ?? "Unknown set"} · {set?.Year} · {rarity} · {printing.Artist}");
            }
            return sheet;
        }

        // The printing's page on Scryfall, both halves percent-encoded (docs/data-contract.md, section 9).
        public string PageUrl()
        {
            PackPrinting printing = Card.Printings[Printing];
            world.Sets.TryGetValue(printing.SetId, out PackSet set);
            return $"https://scryfall.com/card/{Uri.EscapeDataString(set?.Code ?? "")}/{Uri.EscapeDataString(printing.CollectorNumber)}";
        }

        // The hover label of a stand (PRD v4 5.5.3): card name, set, year and artist.
        public static string Label(WorldData data, int stand)
        {
            PackCard card = data.Cards[data.Layout.Stands[stand].Card];
            data.Sets.TryGetValue(card.Printings[0].SetId, out PackSet set);
            return $"{card.Name} · {set?.Name}, {set?.Year} · {card.Printings[0].Artist}";
        }

        void OnDestroy()
        {
            if (Active)
            {
                Close();
            }
            Destroy(focus.profile);
        }
    }
}
