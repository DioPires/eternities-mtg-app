using System;
using UnityEngine;

namespace Eternities.Avatar
{
    // The avatar's own kinematic controller on `CharacterController` (PRD v4 8.5.1): it follows the
    // ground, keeps to the slope limit, and neither jumps nor falls. Walking is 3 m/s and running
    // 6 m/s, at no cost (PRD v4 5.8.3). Motion is by delta time (PRD v4 5.11.1).
    [RequireComponent(typeof(CharacterController))]
    public sealed class AvatarController : MonoBehaviour
    {
        public const float WalkSpeed = 3, RunSpeed = 6, TurnDegreesPerSecond = 720;
        public const float Height = 1.8f, Radius = 0.3f, EyeHeight = 1.6f;
        const float Grounding = 4;      // metres per second downward, to stay on the ground over a crest

        CharacterController body;

        public IAvatarInputSource Source;
        public readonly AvatarInput Input = new AvatarInput();
        public Transform View;                      // the camera, whose heading is the frame of `Move`
        public bool Locked;                         // a transition holds the visitor's input (PRD v4 5.9.2)
        public Vector3 Walk;                        // while locked, the velocity of an automatic walk
        public Func<Vector3, Vector3> Keep;         // keeps a position on the ground the visitor may walk
        public float Speed { get; private set; }
        public float Travelled { get; private set; }    // metres walked since the last `Place`

        public static AvatarController Create(Material material)
        {
            var avatar = new GameObject("Avatar") { layer = 2 };    // Ignore Raycast: the camera's collider looks past it
            var body = avatar.AddComponent<CharacterController>();
            body.height = Height;
            body.radius = Radius;
            body.center = new Vector3(0, Height / 2, 0);
            body.slopeLimit = 40;
            body.stepOffset = 0.3f;
            // The default ignores a move under a millimetre, which is every move above 3,000 frames
            // a second at walking pace: the avatar would stand still on a fast machine.
            body.minMoveDistance = 0;
            Mannequin.Build(material).transform.SetParent(avatar.transform, false);
            return avatar.AddComponent<AvatarController>();
        }

        void Awake()
        {
            body = GetComponent<CharacterController>();
        }

        // In card view the avatar steps out of the frame (PRD v4 5.10.1): it is not drawn.
        public bool Shown
        {
            set
            {
                foreach (Renderer part in GetComponentsInChildren<Renderer>(includeInactive: true))
                {
                    part.enabled = value;
                }
            }
        }

        // Puts the avatar somewhere without walking it there: an arrival.
        public void Place(Vector3 position, Quaternion facing)
        {
            body.enabled = false;
            transform.SetPositionAndRotation(position, facing);
            body.enabled = true;
            Travelled = 0;
            Speed = 0;
        }

        void Update()
        {
            Input.Clear();
            Vector3 velocity;
            if (Locked)
            {
                velocity = Walk;
            }
            else
            {
                Source?.Read(Input);
                Vector3 wish = Input.WorldMove;
                if (wish == Vector3.zero && Input.Move != Vector2.zero && View != null)
                {
                    Vector3 ahead = Vector3.ProjectOnPlane(View.forward, Vector3.up).normalized;
                    wish = Vector3.Cross(Vector3.up, ahead) * Input.Move.x + ahead * Input.Move.y;
                }
                wish.y = 0;
                velocity = Vector3.ClampMagnitude(wish, 1) * (Input.Run ? RunSpeed : WalkSpeed);
            }

            var ground = new Vector3(velocity.x, 0, velocity.z);
            if (ground.sqrMagnitude > 1e-4f)
            {
                transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(ground), TurnDegreesPerSecond * Time.deltaTime);
            }
            Vector3 before = transform.position;
            body.Move((ground + Vector3.down * Grounding) * Time.deltaTime);
            if (Keep != null)
            {
                Vector3 kept = Keep(transform.position);
                if (kept != transform.position)
                {
                    body.enabled = false;
                    transform.position = kept;
                    body.enabled = true;
                }
            }
            Vector3 moved = transform.position - before;
            moved.y = 0;
            Travelled += moved.magnitude;
            Speed = Time.deltaTime > 0 ? moved.magnitude / Time.deltaTime : 0;
        }
    }

    // The slice's placeholder avatar (PRD v4 5.8.4): a mannequin of capsules and a sphere, 1.8 m tall.
    public static class Mannequin
    {
        public static GameObject Build(Material material)
        {
            var root = new GameObject("Mannequin");
            Part(root, PrimitiveType.Capsule, material, new Vector3(0, 1.2f, 0), new Vector3(0.36f, 0.33f, 0.24f));         // torso
            Part(root, PrimitiveType.Sphere, material, new Vector3(0, 1.68f, 0), new Vector3(0.22f, 0.24f, 0.22f));         // head
            foreach (float side in new[] { -1f, 1f })
            {
                Part(root, PrimitiveType.Capsule, material, new Vector3(side * 0.1f, 0.45f, 0), new Vector3(0.15f, 0.45f, 0.15f));     // leg
                Part(root, PrimitiveType.Capsule, material, new Vector3(side * 0.25f, 1.15f, 0), new Vector3(0.1f, 0.33f, 0.1f));      // arm
            }
            return root;
        }

        static void Part(GameObject root, PrimitiveType shape, Material material, Vector3 at, Vector3 scale)
        {
            GameObject part = GameObject.CreatePrimitive(shape);
            UnityEngine.Object.Destroy(part.GetComponent<Collider>());
            part.layer = 2;
            part.transform.SetParent(root.transform, false);
            part.transform.localPosition = at;
            part.transform.localScale = scale;
            part.GetComponent<MeshRenderer>().sharedMaterial = material;
        }
    }
}
