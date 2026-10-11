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

        public void Clear()
        {
            Move = default;
            WorldMove = default;
            Look = default;
            Zoom = 0;
            Run = Interact = Back = TravelMenu = false;
        }
    }

    public interface IAvatarInputSource
    {
        void Read(AvatarInput input);
    }

    // Keyboard and mouse, and a gamepad (PRD v4 6.1.2 to 6.1.5), through the project's input actions.
    public sealed class PlayerInputSource : IAvatarInputSource
    {
        const float MouseDegrees = 0.15f, StickDegrees = 150, ScrollMetres = 0.5f, ShoulderMetres = 3;

        readonly InputAction move, look, sprint, interact;

        public PlayerInputSource()
        {
            InputActionAsset actions = InputSystem.actions;
            move = actions.FindAction("Player/Move", throwIfNotFound: true);
            look = actions.FindAction("Player/Look", throwIfNotFound: true);
            sprint = actions.FindAction("Player/Sprint", throwIfNotFound: true);
            interact = actions.FindAction("Player/Interact", throwIfNotFound: true);
            actions.FindActionMap("Player", throwIfNotFound: true).Enable();
        }

        public void Read(AvatarInput input)
        {
            input.Move = Vector2.ClampMagnitude(move.ReadValue<Vector2>(), 1);
            input.Run = sprint.IsPressed();
            input.Interact = interact.WasPressedThisFrame();

            Mouse mouse = Mouse.current;
            Keyboard keyboard = Keyboard.current;
            Gamepad pad = Gamepad.current;
            // The mouse orbits the camera while its right button is held; the right stick always does.
            Vector2 turn = look.ReadValue<Vector2>();
            if (look.activeControl != null && look.activeControl.device is Mouse)
            {
                input.Look = mouse.rightButton.isPressed ? turn * MouseDegrees : Vector2.zero;
            }
            else
            {
                input.Look = turn * (StickDegrees * Time.unscaledDeltaTime);
            }
            if (mouse != null)
            {
                float scroll = mouse.scroll.ReadValue().y;
                input.Zoom -= scroll > 0 ? ScrollMetres : scroll < 0 ? -ScrollMetres : 0;
            }
            if (pad != null)
            {
                input.Zoom += ((pad.leftShoulder.isPressed ? 1 : 0) - (pad.rightShoulder.isPressed ? 1 : 0)) * ShoulderMetres * Time.unscaledDeltaTime;
                input.Back |= pad.startButton.wasPressedThisFrame;
            }
            if (keyboard != null)
            {
                input.Back |= keyboard.escapeKey.wasPressedThisFrame;
                input.TravelMenu = keyboard.tKey.wasPressedThisFrame;
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
