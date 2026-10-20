using System;
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
        public bool Interact, Back, TravelMenu, Map;    // pressed this frame
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
            Run = Interact = Back = TravelMenu = Map = Click = false;
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
        public const float RunMetres = 0.06f, OwedMetres = 1, ZoomMetresAFrame = 0.3f;
        const float StickDegrees = 150, ShoulderMetres = 3;

        // The clock a scroll's pause is told by. A test puts a visitor's own in its place, to
        // replay their hand at its own times.
        internal Func<float> Clock = () => Time.unscaledTime;

        bool wanted;            // a click or a movement key asked for the pointer in the last frame
        bool wasOverlay;
        int changes = -1;       // `PointerLock.Changes` as the last frame found it
        float owed;             // metres a scroll has asked for that the camera has not moved yet
        float scrolled = float.NegativeInfinity;    // when a scroll last asked for a zoom, by `Clock`

        public void Read(AvatarInput input)
        {
            Keyboard keyboard = Keyboard.current;
            Mouse mouse = Mouse.current;
            Gamepad pad = Gamepad.current;
            Vector2 move = Vector2.zero, look = Vector2.zero, scroll = Vector2.zero;
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
                input.Map = keyboard.mKey.wasPressedThisFrame;
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
                // Mac divides the system's points by 20, so one point is a part of 0.05. The
                // owner's swipes sent parts from there to about 5, half of them 0.5 or less.
                //
                // The first part after a pause is a notch, whatever its size, which is what a
                // wheel sends. The parts that follow it ask by their size, `RunMetres` for a part
                // of 1: about 1,330 points for the camera's whole range, where an easy swipe of
                // the owner's is 1,000 to 1,650. The camera moves what a frame's part asks in
                // that frame, so it follows the fingers: as fast as they go, and still when they
                // are. The tail after they lift, whose parts shrink, moves it less and less.
                //
                // A frame moves it `ZoomMetresAFrame` at most, so that it never jumps, and what a
                // part asks beyond that is owed to the frames after it: a notch takes two. No
                // more than `OwedMetres` is ever owed, so the camera stops within three frames
                // of the last part.
                //
                // Taken as a notch each, as the parts once were, eight frames threw the camera
                // from one end of its range to the other. Moved at a pace of its own, 3 m a
                // second and then 6, the camera went at that one pace however the hand moved,
                // and reached the end of its range a third of a second or more after the
                // fingers had stopped: too slow, both times (DEC-978).
                scroll = mouse.scroll.ReadValue();
                if (scroll.y != 0)
                {
                    float now = Clock();
                    float asked = now - scrolled > ScrollPause ? ScrollMetres : Mathf.Abs(scroll.y) * RunMetres;
                    scrolled = now;
                    owed = Mathf.Clamp(owed - Mathf.Sign(scroll.y) * asked, -OwedMetres, OwedMetres);
                }
            }
            if (pad != null)
            {
                move += pad.leftStick.ReadValue();
                input.Run |= pad.rightTrigger.ReadValue() > 0.5f || pad.leftTrigger.ReadValue() > 0.5f;
                input.Interact |= pad.buttonSouth.wasPressedThisFrame;
                input.Back |= pad.startButton.wasPressedThisFrame || pad.buttonEast.wasPressedThisFrame;
                input.TravelMenu |= pad.buttonNorth.wasPressedThisFrame;
                input.Map |= pad.selectButton.wasPressedThisFrame;
                input.Step += (pad.dpad.right.wasPressedThisFrame ? 1 : 0) - (pad.dpad.left.wasPressedThisFrame ? 1 : 0);
                if (!overlay)
                {
                    look += pad.rightStick.ReadValue() * (StickDegrees * Time.unscaledDeltaTime);
                    input.Zoom += ((pad.leftShoulder.isPressed ? 1 : 0) - (pad.rightShoulder.isPressed ? 1 : 0)) * ShoulderMetres * Time.unscaledDeltaTime;
                }
            }
            input.Move = Vector2.ClampMagnitude(move, 1);
            input.Look = look;
            if (scroll != Vector2.zero)
            {
                ScrollLog.Part(scroll, input.Move != Vector2.zero, input.Run, PointerLock.Held);
            }
            if (overlay)
            {
                owed = 0;
            }
            float zoom = Mathf.Clamp(owed, -ZoomMetresAFrame, ZoomMetresAFrame);
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
        public bool Interact, Back, TravelMenu, Map;    // each is passed on once, then cleared
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
            input.Map = Map;
            input.Click = Click;
            input.Pointer = Pointer;
            Interact = Back = TravelMenu = Map = Click = false;
        }
    }
}
