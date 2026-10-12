using Eternities.UI;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Eternities.Avatar
{
    // What the visitor asks of the avatar and its camera in one frame (PRD v4 6.1). The controller
    // and the camera read this and nothing else, so the bench drives the avatar through the same
    // layer a keyboard does and never moves it by hand.
    public sealed class AvatarInput
    {
        public Vector2 Move;        // in the camera's frame: x to its right, y ahead; length at most 1
        public Vector3 WorldMove;   // or a direction on the ground in the world's frame; it wins when set
        public bool Run;
        public Vector2 Look;        // degrees to turn the camera this frame: x about the avatar, y up
        public float Zoom;          // metres to move the camera away this frame
        public bool Interact, Back, TravelMenu;     // pressed this frame
        public bool Click;          // the pointer was pressed this frame,
        public Vector2 Pointer;     // here: pixels from the view's bottom left
        public int Step;            // in card view: -1 the printing before, 1 the one after

        public void Clear()
        {
            Move = default;
            WorldMove = default;
            Look = default;
            Zoom = 0;
            Step = 0;
            Run = Interact = Back = TravelMenu = Click = false;
        }
    }

    public interface IAvatarInputSource
    {
        void Read(AvatarInput input);
    }

    // Keyboard and mouse, and a gamepad (PRD v4 6.1.2 to 6.1.5), read from the Input System's
    // devices. Either device is complete by itself.
    //
    // The mouse orbits the camera with no button held, so the camera holds the pointer
    // (`PointerLock`): it takes it on a click or a movement key, and an overlay or the loss of the
    // application's focus gives it back to the visitor. Under an overlay the camera stays where
    // it is: the pointer, the wheel and the right stick are the overlay's.
    public sealed class PlayerInputSource : IAvatarInputSource
    {
        public const float MouseDegrees = 0.15f, ScrollMetres = 0.5f, ScrollPause = 0.1f;
        public const float RunMetres = 0.15f, OwedMetres = 1, ZoomMetresPerSecond = 6, ZoomMetresAFrame = 0.2f;
        const float StickDegrees = 150, ShoulderMetres = 3;

        bool wanted;            // a click or a movement key asked for the pointer in the last frame
        bool wasOverlay;
        int changes = -1;       // `PointerLock.Changes` as the last frame found it
        float owed;             // metres a scroll has asked for that the camera has not moved yet
        float scrolled = float.NegativeInfinity;    // when the scroll was last not zero

        // The most a scroll moves the camera in a frame of this length: its pace, and in a long
        // frame no more than `ZoomMetresAFrame`, so that it never jumps. A frame of the high
        // level, 28 ms at the p90 of its bench run, is under that, so the pace is the same at
        // every level (DEC-978).
        public static float Pace(float seconds) => Mathf.Min(ZoomMetresPerSecond * seconds, ZoomMetresAFrame);

        public void Read(AvatarInput input)
        {
            Keyboard keyboard = Keyboard.current;
            Mouse mouse = Mouse.current;
            Gamepad pad = Gamepad.current;
            Vector2 move = Vector2.zero, look = Vector2.zero;
            bool overlay = PointerLock.Overlay, press = false;
            // The frame after the pointer changes hands, the application's focus changes or an
            // overlay closes, the mouse's delta is not the visitor's hand. It is dropped, so the
            // camera does not jump.
            bool settled = changes == PointerLock.Changes && !wasOverlay;
            changes = PointerLock.Changes;
            wasOverlay = overlay;
            if (keyboard != null)
            {
                move.x = (keyboard.dKey.isPressed || keyboard.rightArrowKey.isPressed ? 1 : 0) - (keyboard.aKey.isPressed || keyboard.leftArrowKey.isPressed ? 1 : 0);
                move.y = (keyboard.wKey.isPressed || keyboard.upArrowKey.isPressed ? 1 : 0) - (keyboard.sKey.isPressed || keyboard.downArrowKey.isPressed ? 1 : 0);
                input.Run = keyboard.leftShiftKey.isPressed || keyboard.rightShiftKey.isPressed;
                input.Interact = keyboard.eKey.wasPressedThisFrame;
                input.Back = keyboard.escapeKey.wasPressedThisFrame;
                input.TravelMenu = keyboard.tKey.wasPressedThisFrame;
                input.Step = (keyboard.rightBracketKey.wasPressedThisFrame || keyboard.pageDownKey.wasPressedThisFrame ? 1 : 0)
                    - (keyboard.leftBracketKey.wasPressedThisFrame || keyboard.pageUpKey.wasPressedThisFrame ? 1 : 0);
            }
            if (mouse != null && !overlay)
            {
                // The mouse orbits the camera, with no button held (PRD v4 6.1.2).
                look = settled ? mouse.delta.ReadValue() * MouseDegrees : Vector2.zero;
                // A click is E (PRD v4 6.1.3). In explore mode the pointer is the camera's, held
                // or about to be, so there is none to put on a stand: the stand a click means is
                // the one whose label shows. It is not passed on as `Click`, which is a press of
                // a pointer at a place.
                input.Interact |= mouse.leftButton.wasPressedThisFrame;
                press = mouse.leftButton.wasPressedThisFrame || mouse.rightButton.wasPressedThisFrame;
                // A notch of a wheel asks for half a metre. A trackpad's two fingers send a run
                // of parts, one a frame for as long as they move and for a while after they lift.
                // A part's size is what the system would scroll a page by: Unity's player on a
                // Mac divides the system's points by 20, so one point is a part of 0.05 and a
                // swipe's parts run from there to about 5.
                //
                // The first part after a pause is a notch, whatever its size, which is what a
                // wheel sends. The parts that follow it ask by their size, `RunMetres` for a part
                // of 1: about 530 points for the camera's whole range, where the web application
                // asks 690 for the same threefold (`ZOOM_PER_NOTCH` in
                // `web/src/camera/attachRig.ts`). So the camera goes as far as the fingers do,
                // and the tail after they lift, whose parts shrink, moves it less and less.
                // No more than `OwedMetres` is ever owed, so the camera stops soon after the
                // parts do, and it moves at its own pace (below).
                //
                // Taken as a notch each, as the parts once were, eight frames threw the camera
                // from one end of its range to the other. Asked at a notch for a part of 1 with
                // no more than a notch owed, as they were next, every swipe moved it at the one
                // pace of 3 m a second, however hard it was made: too slow (DEC-978). A drag of
                // 400 points a second, a slow one, still moves it at that pace, and a quicker
                // one moves it faster.
                float scroll = mouse.scroll.ReadValue().y;
                if (scroll != 0)
                {
                    ScrollLog.Part(scroll);
                    float asked = Time.unscaledTime - scrolled > ScrollPause ? ScrollMetres : Mathf.Abs(scroll) * RunMetres;
                    scrolled = Time.unscaledTime;
                    owed = Mathf.Clamp(owed - Mathf.Sign(scroll) * asked, -OwedMetres, OwedMetres);
                }
            }
            if (pad != null)
            {
                move += pad.leftStick.ReadValue();
                input.Run |= pad.rightTrigger.ReadValue() > 0.5f || pad.leftTrigger.ReadValue() > 0.5f;
                input.Interact |= pad.buttonSouth.wasPressedThisFrame;
                input.Back |= pad.startButton.wasPressedThisFrame || pad.buttonEast.wasPressedThisFrame;
                input.TravelMenu |= pad.buttonNorth.wasPressedThisFrame;
                input.Step += (pad.dpad.right.wasPressedThisFrame ? 1 : 0) - (pad.dpad.left.wasPressedThisFrame ? 1 : 0);
                if (!overlay)
                {
                    look += pad.rightStick.ReadValue() * (StickDegrees * Time.unscaledDeltaTime);
                    input.Zoom += ((pad.leftShoulder.isPressed ? 1 : 0) - (pad.rightShoulder.isPressed ? 1 : 0)) * ShoulderMetres * Time.unscaledDeltaTime;
                }
            }
            input.Move = Vector2.ClampMagnitude(move, 1);
            input.Look = look;
            if (overlay)
            {
                owed = 0;
            }
            float zoom = Mathf.MoveTowards(0, owed, Pace(Time.unscaledDeltaTime));
            owed -= zoom;
            input.Zoom += zoom;

            // The camera takes the pointer a frame after it is asked for: a click may have opened
            // card view, and then the pointer stays the visitor's, and where it was.
            if (overlay || PointerLock.Held)
            {
                wanted = false;
            }
            else if (wanted)
            {
                wanted = false;
                PointerLock.Take();
            }
            else
            {
                wanted = press || input.Move != Vector2.zero;
            }
        }
    }

    // The bench's hands: the path script sets these fields and the avatar reads them every frame.
    public sealed class ScriptedInputSource : IAvatarInputSource
    {
        public Vector3 WorldMove;
        public bool Run;
        public Vector2 Look;                        // degrees, passed on once
        public bool Interact, Back, TravelMenu;     // each is passed on once, then cleared
        public bool Click;                          // and so is a press of the pointer,
        public Vector2 Pointer;                     // here

        public void Read(AvatarInput input)
        {
            input.WorldMove = WorldMove;
            input.Run = Run;
            input.Look = Look;
            Look = Vector2.zero;
            input.Interact = Interact;
            input.Back = Back;
            input.TravelMenu = TravelMenu;
            input.Click = Click;
            input.Pointer = Pointer;
            Interact = Back = TravelMenu = Click = false;
        }
    }
}
