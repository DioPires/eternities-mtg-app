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
    // the printing's `large` image on its face and the card back, or the card's other face, behind.
    // Both faces are drawn on the isolated path, from two textures of their own. The camera moves
    // inside the stand's apron over 0.6 s to where the card is 60% of the view's height, to the
    // left of the middle, which leaves the right for the printings panel. The world behind the card
    // takes a little depth of field; the card takes none. Nothing in the world pauses.
    public sealed class CardViewer : MonoBehaviour
    {
        public const float BlendSeconds = 0.6f, ReducedBlendSeconds = 0.3f;
        public const float CardFraction = 0.6f, PanelFraction = 0.34f, TiltDegrees = 12, FlipSeconds = 0.35f;
        public const float CardHeight = StandImages.SurfaceHeight, CardWidth = CardHeight * 672 / 936, Thickness = 0.006f, Lift = 0.05f;
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
        readonly List<Vector2> swatchUv = new List<Vector2>(), slotUv = new List<Vector2>();
        Texture2D front, back;
        string frontUrl, backUrl;
        float turn, turnVelocity, turned;       // the flip: 0 the front, 180 the back
        Vector2 tilt, tiltVelocity;
        float changedAt;

        public int Stand { get; private set; } = -1;
        public int Printing { get; private set; }
        public bool ShowingBack { get; private set; }
        public bool Active => Stand >= 0;
        public bool ReducedMotion;
        public string Notice { get; private set; }      // one line when an image could not be shown
        public bool FrontShown => front != null;
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
            Destroy(front);
            Destroy(back);
            front = back = null;
            Destroy(card);
            Destroy(faces);
            Destroy(body);
            card = null;
            Stand = -1;
        }

        // The solid, in the world's own frame so the main camera sees a card there, and the two
        // faces on the exhibit layer.
        void Build(Vector3 centre, Quaternion facing)
        {
            card = new GameObject("Card");
            card.transform.SetPositionAndRotation(centre, facing);

            float w = CardWidth / 2, h = CardHeight / 2, d = Thickness / 2;
            body = new Mesh { name = "card" };
            var corners = new List<Vector3>();
            var triangles = new List<int>();
            foreach (Vector3 face in new[] { Vector3.forward, Vector3.back, Vector3.right, Vector3.left, Vector3.up, Vector3.down })
            {
                Vector3 u = face.y != 0 ? Vector3.right : Vector3.up, v = Vector3.Cross(face, u);
                int first = corners.Count;
                foreach ((int su, int sv) in new[] { (-1, -1), (1, -1), (1, 1), (-1, 1) })
                {
                    corners.Add(Vector3.Scale(face + su * u + sv * v, new Vector3(w + 0.003f, h + 0.003f, d)));
                }
                triangles.AddRange(new[] { first, first + 1, first + 2, first, first + 2, first + 3 });
            }
            body.SetVertices(corners);
            body.SetTriangles(triangles, 0);
            body.RecalculateNormals();
            var solid = new GameObject("Solid");
            solid.transform.SetParent(card.transform, false);
            solid.AddComponent<MeshFilter>().sharedMesh = body;
            solid.AddComponent<MeshRenderer>().sharedMaterial = BodyMaterial;

            // Front: seen from the apron, bottom left, top left, top right, bottom right. The back the
            // same from behind.
            faces = new Mesh { name = "card faces" };
            faces.MarkDynamic();
            float z = d + 0.0005f;
            faces.SetVertices(new List<Vector3>
            {
                new Vector3(w, -h, z), new Vector3(w, h, z), new Vector3(-w, h, z), new Vector3(-w, -h, z),
                new Vector3(-w, -h, -z), new Vector3(-w, h, -z), new Vector3(w, h, -z), new Vector3(w, -h, -z),
            });
            faces.SetUVs(1, new List<Vector2>
            {
                new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1), new Vector2(1, 0),
                new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1), new Vector2(1, 0),
            });
            faces.SetTriangles(new List<int> { 0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7 }, 0);
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
            for (int corner = 0; corner < 4; corner++)
            {
                bool swatch = front == null && slot < 0;
                swatchUv.Add(swatch ? images.SwatchCorner(Stand, corner) : cut);
                slotUv.Add(new Vector2(front != null ? -2 : slot, 1));
            }
            for (int corner = 0; corner < 4; corner++)
            {
                swatchUv.Add(cut);
                slotUv.Add(new Vector2(back != null ? -3 : -1, 1));
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
                // PRD v4 7.4.3: an uncached card offline shows its swatch and a one-line notice.
                if (isFront)
                {
                    Notice = "This printing's image could not be loaded. The card's swatch is shown.";
                    Changed?.Invoke();
                }
                return;
            }
            texture.filterMode = FilterMode.Trilinear;
            texture.wrapMode = TextureWrapMode.Clamp;
            if (isFront)
            {
                Destroy(front);
                front = texture;
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
            focus.weight = Mathf.MoveTowards(focus.weight, Active ? 1 : 0, Time.deltaTime / blend);
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
                Active = Printing, Artist = shown.Printings[Printing].Artist, CanFlip = shown.HasBackImage, Notice = Notice,
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
