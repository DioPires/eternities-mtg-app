using UnityEngine;

namespace Eternities.Avatar
{
    // The mannequin's walk and run (PRD v4 9.3: footing that feels physical, no sliding). Its limbs
    // are capsules, so the gait is a stiff one, made here and not imported: the slice has no
    // animation set (PRD v4 8.5.3).
    //
    // A step is a stretch on one foot and then a short flight. While a foot is on the ground its
    // leg turns about the hip exactly as the body passes over it, and the hips sink as the leg
    // leans, so the foot stays where it was put. The other leg swings through to land half a
    // stance ahead. The gait's clock is the distance walked, not time, so it is the same at every
    // frame rate (PRD v4 5.11.1) and a foot cannot slide at any speed.
    public sealed class Gait : MonoBehaviour
    {
        const float Leg = Mannequin.Hip;
        // Metres a step and metres of it on the ground, walking (3 m/s) and running (6 m/s).
        const float WalkStep = 1.1f, WalkStance = 0.75f, RunStep = 1.7f, RunStance = 0.85f;
        const float Trail = 0.3f;           // how far a leg goes on back in the flight, as a part of the flight's length
        const float SwingLift = 0.1f;       // the swinging leg is this much shorter at mid-swing, to clear the ground
        const float WalkArm = 22, RunArm = 40, WalkLean = 3, RunLean = 9;      // degrees
        const float BlendSeconds = 0.15f, BreathMetres = 0.008f, BreathHertz = 0.25f;

        const float PaceSeconds = 0.08f, StillSeconds = 0.05f;

        AvatarController avatar;
        Transform upper;
        Transform[] legs, arms;
        float travelled, weight, speed, movedAt = float.NegativeInfinity;
        float along, step, stance;      // metres into this step, and the step's length and the part of it on the ground

        public int Step { get; private set; }               // counts steps; an even step stands on the left leg
        public bool Grounded { get; private set; }          // a foot is on the ground: the step is not in its flight
        public bool Walking => weight >= 1;
        // Where the standing leg's foot was, in the world, when this frame's pose was made.
        public Vector3 StanceFoot { get; private set; }
        public float LegDegrees(int side) => Mathf.DeltaAngle(0, legs[side].localEulerAngles.x);

        public void Bind(Transform upperBody, Transform[] legPivots, Transform[] armPivots)
        {
            upper = upperBody;
            legs = legPivots;
            arms = armPivots;
        }

        void Start()
        {
            avatar = GetComponentInParent<AvatarController>();
            Measure();
        }

        // A step's measures, taken from the pace as the step begins and kept until it ends: a foot
        // on the ground is not moved by a change of pace. Slower than a walk the steps are shorter
        // and the flight goes: a stroll has none.
        void Measure()
        {
            float pace = Mathf.InverseLerp(AvatarController.WalkSpeed, AvatarController.RunSpeed, speed);
            float slow = Mathf.Clamp01(speed / AvatarController.WalkSpeed);
            stance = Mathf.Lerp(WalkStance * Mathf.Lerp(0.6f, 1, slow), RunStance, pace);
            step = stance + Mathf.Lerp((WalkStep - WalkStance) * slow * slow, RunStep - RunStance, pace);
        }

        // After the controller has moved the avatar this frame.
        void LateUpdate()
        {
            if (avatar == null)
            {
                return;
            }
            // An arrival puts the avatar somewhere and starts its count again: that is not a step.
            float moved = Mathf.Max(0, avatar.Travelled - travelled);
            travelled = avatar.Travelled;
            // The pace is the speed over the last tenth of a second. One frame's is too coarse to
            // set a stride by where frames are short and the ground is far from the origin: the
            // hub is 4 km out, where a position has a quarter of a millimetre to its last bit.
            speed = Mathf.Lerp(speed, avatar.Speed, 1 - Mathf.Exp(-Time.deltaTime / PaceSeconds));
            if (moved > 0)
            {
                movedAt = Time.time;
            }
            weight = Mathf.MoveTowards(weight, Time.time - movedAt < StillSeconds ? 1 : 0, Time.deltaTime / BlendSeconds);
            if (weight <= 0)
            {
                along = 0;      // the next step starts from standing
                Measure();
            }
            for (along += moved; along >= step; Measure())
            {
                along -= step;
                Step++;
            }
            float flight = Mathf.Max(0, along - stance);        // metres of this step in the air
            Grounded = along <= stance;

            // The standing leg: its foot half a stance ahead of the hip at first, then behind, then
            // trailing through the flight. The swinging leg comes from where a flight leaves one.
            float planted = stance / 2 - Mathf.Min(along, stance);
            float standing = planted - Trail * flight;
            float trailing = -stance / 2 - Trail * (step - stance);
            float swing = along / step;
            // The swinging leg does most of its way early, so it is ahead of the body by the time
            // the standing foot leaves the ground, and waits there to land.
            float through = 1 - (1 - swing) * (1 - swing);
            float swinging = Mathf.Lerp(trailing, stance / 2, through * through * (3 - 2 * through));
            int standsOn = Step & 1;
            Pose(legs[standsOn], standing, 1);
            Pose(legs[1 - standsOn], swinging, 1 - SwingLift * Mathf.Sin(Mathf.PI * through));

            // The hips: down as the standing leg leans, and up a little in the flight, as a body
            // thrown that far at that speed rises.
            float sink = Leg * (1 - Mathf.Sqrt(1 - Mathf.Pow(Mathf.Clamp(planted / Leg, -0.95f, 0.95f), 2)));
            float airSeconds = speed > 0.2f ? (step - stance) / speed : 0;
            float inFlight = step > stance ? flight / (step - stance) : 0;
            float hop = 9.81f * airSeconds * airSeconds / 8 * 4 * inFlight * (1 - inFlight);
            transform.localPosition = new Vector3(0, weight * (hop - sink), 0);

            // The arms swing against the legs, the body leans into its pace, and it breathes.
            float pace = Mathf.InverseLerp(AvatarController.WalkSpeed, AvatarController.RunSpeed, speed);
            float arm = Mathf.Lerp(WalkArm, RunArm, pace) * Mathf.Cos(Mathf.PI * (Step + swing)) * weight;
            arms[0].localRotation = Quaternion.Euler(arm, 0, 0);
            arms[1].localRotation = Quaternion.Euler(-arm, 0, 0);
            upper.localRotation = Quaternion.Euler(Mathf.Lerp(WalkLean, RunLean, pace) * weight, 0, 0);
            upper.localPosition = new Vector3(0, Mannequin.Hip + BreathMetres * Mathf.Sin(2 * Mathf.PI * BreathHertz * Time.time), 0);
            StanceFoot = legs[standsOn].TransformPoint(0, -Leg, 0);
        }

        // A leg whose foot is `ahead` metres in front of its hip. A turn about the pivot's own x
        // axis by a positive angle carries the foot back.
        void Pose(Transform leg, float ahead, float length)
        {
            float lean = Mathf.Asin(Mathf.Clamp(ahead / Leg, -0.95f, 0.95f)) * Mathf.Rad2Deg;
            leg.localRotation = Quaternion.Euler(-lean * weight, 0, 0);
            leg.localScale = new Vector3(1, Mathf.Lerp(1, length, weight), 1);
        }
    }
}
