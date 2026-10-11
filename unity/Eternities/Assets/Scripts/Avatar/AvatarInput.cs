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
        public int Step;            // in card view: -1 the printing before, 1 the one after

        public void Clear()
        {
            Move = default;
            WorldMove = default;
            Look = default;
            Zoom = 0;
            Step = 0;
            Run = Interact = Back = TravelMenu = false;
        }
    }

    public interface IAvatarInputSource
    {
        void Read(AvatarInput input);
    }

    // Keyboard and mouse, and a gamepad (PRD v4 6.1.2 to 6.1.5), read from the Input System's
    // devices. Either device is complete by itself.
    public sealed class PlayerInputSource : IAvatarInputSource
    {
        const float MouseDegrees = 0.15f, StickDegrees = 150, ScrollMetres = 0.5f, ShoulderMetres = 3;

        public void Read(AvatarInput input)
        {
            Keyboard keyboard = Keyboard.current;
            Mouse mouse = Mouse.current;
            Gamepad pad = Gamepad.current;
            Vector2 move = Vector2.zero, look = Vector2.zero;
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
            if (mouse != null)
            {
                // The mouse orbits the camera while its right button is held.
                look = mouse.rightButton.isPressed ? mouse.delta.ReadValue() * MouseDegrees : Vector2.zero;
                float scroll = mouse.scroll.ReadValue().y;
                input.Zoom -= scroll > 0 ? ScrollMetres : scroll < 0 ? -ScrollMetres : 0;
            }
            if (pad != null)
            {
                move += pad.leftStick.ReadValue();
                look += pad.rightStick.ReadValue() * (StickDegrees * Time.unscaledDeltaTime);
                input.Run |= pad.rightTrigger.ReadValue() > 0.5f || pad.leftTrigger.ReadValue() > 0.5f;
                input.Interact |= pad.buttonSouth.wasPressedThisFrame;
                input.Back |= pad.startButton.wasPressedThisFrame || pad.buttonEast.wasPressedThisFrame;
                input.TravelMenu |= pad.buttonNorth.wasPressedThisFrame;
                input.Zoom += ((pad.leftShoulder.isPressed ? 1 : 0) - (pad.rightShoulder.isPressed ? 1 : 0)) * ShoulderMetres * Time.unscaledDeltaTime;
                input.Step += (pad.dpad.right.wasPressedThisFrame ? 1 : 0) - (pad.dpad.left.wasPressedThisFrame ? 1 : 0);
            }
            input.Move = Vector2.ClampMagnitude(move, 1);
            input.Look = look;
        }
    }

    // The bench's hands: the path script sets these fields and the avatar reads them every frame.
    public sealed class ScriptedInputSource : IAvatarInputSource
    {
        public Vector3 WorldMove;
        public bool Run;
        public Vector2 Look;                        // degrees, passed on once
        public bool Interact, Back, TravelMenu;     // each is passed on once, then cleared

        public void Read(AvatarInput input)
        {
            input.WorldMove = WorldMove;
            input.Run = Run;
            input.Look = Look;
            Look = Vector2.zero;
            input.Interact = Interact;
            input.Back = Back;
            input.TravelMenu = TravelMenu;
            Interact = Back = TravelMenu = false;
        }
    }
}
