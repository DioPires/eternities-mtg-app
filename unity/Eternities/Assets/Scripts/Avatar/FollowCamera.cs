using Unity.Cinemachine;
using UnityEngine;

namespace Eternities.Avatar
{
    // The following camera (PRD v4 5.8.1, 8.5.2): a Cinemachine rig that orbits the avatar from 2 to
    // 6 m, with a collider that pulls it in front of whatever comes between. The orbit is in the
    // world's frame, so walking does not swing the view; left alone while the avatar walks, it
    // comes round behind the avatar again.
    public sealed class FollowCamera : MonoBehaviour
    {
        const float Distance = 4, MinDistance = 2, MaxDistance = 6, LookHeight = 1.5f;
        const float RecentreAfter = 1.5f, RecentreDegreesPerSecond = 60;

        AvatarController avatar;
        CinemachineCamera rig;
        CinemachineOrbitalFollow orbit;
        float sinceLook;

        public static FollowCamera Create(Camera view, AvatarController avatar)
        {
            CinemachineBrain brain = view.GetComponent<CinemachineBrain>();
            if (brain == null)
            {
                brain = view.gameObject.AddComponent<CinemachineBrain>();
            }
            brain.DefaultBlend = new CinemachineBlendDefinition(CinemachineBlendDefinition.Styles.EaseInOut, 0.6f);   // PRD v4 8.5.2

            var holder = new GameObject("Follow camera");
            var follow = holder.AddComponent<FollowCamera>();
            follow.avatar = avatar;
            follow.rig = holder.AddComponent<CinemachineCamera>();
            follow.rig.Target.TrackingTarget = avatar.transform;
            follow.rig.Lens.FieldOfView = view.fieldOfView;
            follow.rig.Lens.NearClipPlane = view.nearClipPlane;
            follow.rig.Lens.FarClipPlane = view.farClipPlane;

            follow.orbit = holder.AddComponent<CinemachineOrbitalFollow>();
            follow.orbit.OrbitStyle = CinemachineOrbitalFollow.OrbitStyles.Sphere;
            follow.orbit.Radius = Distance;
            follow.orbit.TargetOffset = new Vector3(0, LookHeight, 0);
            follow.orbit.TrackerSettings.BindingMode = Unity.Cinemachine.TargetTracking.BindingMode.WorldSpace;
            follow.orbit.TrackerSettings.PositionDamping = new Vector3(0.1f, 0.1f, 0.1f);
            follow.orbit.RadialAxis.Range = new Vector2(MinDistance / Distance, MaxDistance / Distance);
            follow.orbit.RadialAxis.Value = 1;
            follow.orbit.HorizontalAxis.Recentering.Enabled = false;
            follow.orbit.VerticalAxis.Recentering.Enabled = false;

            var aim = holder.AddComponent<CinemachineRotationComposer>();
            aim.TargetOffset = new Vector3(0, LookHeight, 0);
            aim.Damping = Vector2.zero;

            var collide = holder.AddComponent<CinemachineDeoccluder>();
            collide.CollideAgainst = 1;     // the Default layer: ground, stands, props. The avatar is not on it.
            collide.MinimumDistanceFromTarget = 0.5f;
            collide.AvoidObstacles.Enabled = true;
            collide.AvoidObstacles.CameraRadius = 0.2f;
            collide.AvoidObstacles.Strategy = CinemachineDeoccluder.ObstacleAvoidance.ResolutionStrategy.PullCameraForward;
            collide.AvoidObstacles.DampingWhenOccluded = 0.1f;
            collide.AvoidObstacles.Damping = 0.3f;

            avatar.View = view.transform;
            follow.Behind();
            return follow;
        }

        // Puts the camera behind the avatar at once: after an arrival, where nothing may swing.
        public void Behind()
        {
            orbit.HorizontalAxis.Value = avatar.transform.eulerAngles.y;
            orbit.VerticalAxis.Value = orbit.VerticalAxis.Center;
            rig.PreviousStateIsValid = false;
            sinceLook = 0;
        }

        void Update()
        {
            AvatarInput input = avatar.Input;
            orbit.HorizontalAxis.Value = Mathf.Repeat(orbit.HorizontalAxis.Value + input.Look.x + 180, 360) - 180;
            orbit.VerticalAxis.Value = Mathf.Clamp(orbit.VerticalAxis.Value - input.Look.y, orbit.VerticalAxis.Range.x, orbit.VerticalAxis.Range.y);
            orbit.RadialAxis.Value = Mathf.Clamp(orbit.RadialAxis.Value + input.Zoom / Distance, orbit.RadialAxis.Range.x, orbit.RadialAxis.Range.y);

            sinceLook = input.Look != Vector2.zero ? 0 : sinceLook + Time.deltaTime;
            if (sinceLook > RecentreAfter && avatar.Speed > 0.5f)
            {
                float behind = Mathf.MoveTowardsAngle(orbit.HorizontalAxis.Value, avatar.transform.eulerAngles.y, RecentreDegreesPerSecond * Time.deltaTime);
                orbit.HorizontalAxis.Value = Mathf.Repeat(behind + 180, 360) - 180;
            }
        }
    }
}
