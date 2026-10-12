using UnityEngine;

namespace Eternities.UI
{
    // Whose the pointer is (PRD v4 6.1.2). The mouse orbits the camera with no button held, so in
    // explore mode the camera holds the pointer: it stays where it is and is not drawn, and does
    // not run to the edge of the screen while the view turns. Under an overlay it is the
    // visitor's, free and drawn: card view tilts the card toward it (PRD v4 5.10.2), and a panel
    // or a menu is clicked with it. It is the visitor's too once the application loses the focus,
    // and stays theirs when the focus comes back. The camera takes it again on the visitor's next
    // click or movement key (`PlayerInputSource`).
    public static class PointerLock
    {
        static Hud overlays;

        // A run with no window has no pointer to hold: in batchmode the engine's lock state stays
        // `None` whatever it is set to. A test keeps the state here instead.
        internal static CursorLockMode? StateForTests;

        static CursorLockMode State
        {
            get => StateForTests ?? Cursor.lockState;
            set
            {
                if (StateForTests.HasValue)
                {
                    StateForTests = value;
                }
                else
                {
                    Cursor.lockState = value;
                }
            }
        }

        public static bool Held => State == CursorLockMode.Locked;

        // An overlay is open: the pointer, the wheel and the sticks are its, and the camera stays
        // where it is.
        public static bool Overlay => overlays != null && overlays.Open;

        // How often the pointer has changed hands or the application's focus has changed. In the
        // frame after either, the mouse's delta is not the visitor's hand: the system moves a
        // pointer it holds or lets go, and a mouse that was with another application comes back
        // from wherever it went. Whoever turns the camera by the mouse drops that frame's delta.
        public static int Changes { get; private set; }

        internal static void Overlays(Hud hud)
        {
            overlays = hud;
        }

        // The camera asks for the pointer. Under an overlay it does not get it.
        public static void Take()
        {
            if (!Overlay)
            {
                Set(CursorLockMode.Locked);
            }
        }

        public static void Release()
        {
            Set(CursorLockMode.None);
        }

        internal static void Focus(bool focused)
        {
            Changes++;
            if (!focused)
            {
                Release();
            }
        }

        static void Set(CursorLockMode mode)
        {
            if (State != mode)
            {
                State = mode;
                Changes++;
            }
        }
    }
}
