using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.HighDefinition;

namespace Eternities.CardView
{
    // The isolated image path of PRD v4 8.4.4, the exhibit-camera design.
    //
    // The main camera draws every image surface as an ordinary opaque object in its stand's swatch
    // colour, so depth, fog, exposure and depth of field treat a card as a solid thing.
    //
    // The exhibit camera is a second camera object, slaved to the main camera's pose and lens and
    // never jittered. It is not rendered as a camera of its own, which would run the whole pipeline
    // twice: inside the main camera's frame, HDRP's custom-pass API renders from it into two
    // buffers of this object's, at output resolution whatever the main camera's resolution scale
    // is. First the occluder depth, the opaque world within 60 m; then the image surfaces with
    // their exact texels, depth-tested against it, their alpha the surface's coverage.
    //
    // The composite blends that buffer over the main camera's target after the camera has
    // finished, post-processing and upscaling included. On the screen the overlays are drawn into
    // that target before it, so the composite leaves one rectangle alone, `Spared`: the hover
    // label's, which the images of the stands behind it covered (DEC-1130 N10). The label is
    // opaque, so it replaces every pixel of the placeholder there itself.
    public sealed class Exhibit : MonoBehaviour
    {
        public const int Layer = 6;                 // the image surfaces, and nothing else
        public const float OccluderDistance = 60;
        static readonly int ImagesId = Shader.PropertyToID("_ExhibitImages"), BufferId = Shader.PropertyToID("_ExhibitBuffer"), FlipId = Shader.PropertyToID("_ExhibitFlip");
        static readonly int SparedId = Shader.PropertyToID("_ExhibitSpared");

        Camera main, exhibitCamera;
        Material surface, composite;
        RTHandle colour, depth;
        CustomPassVolume volume;
        CommandBuffer blit;
        bool rendered;

        public bool CompositeEnabled = true;        // a test turns it off to see the main camera's own pixels
        public bool PassEnabled = true;             // the bench turns the whole path off to measure what it costs
        // Pixels of the view, from its bottom left, that the composite does not touch; empty for none.
        public Rect Spared;
        public RTHandle Buffer => colour;
        public static readonly ProfilingSampler OccluderSampler = new ProfilingSampler("Exhibit occluder depth"), SurfaceSampler = new ProfilingSampler("Exhibit surfaces");

        sealed class Pass : CustomPass
        {
            public Exhibit Owner;

            protected override void Execute(CustomPassContext ctx)
            {
                if (ctx.hdCamera.camera == Owner.main && Owner.PassEnabled)
                {
                    Owner.Render(ctx);
                }
            }
        }

        public static Exhibit Create(Camera main, Shader surface, Shader composite)
        {
            var exhibit = main.gameObject.AddComponent<Exhibit>();
            exhibit.main = main;
            exhibit.surface = CoreUtils.CreateEngineMaterial(surface);
            exhibit.composite = CoreUtils.CreateEngineMaterial(composite);

            var holder = new GameObject("Exhibit camera");
            holder.transform.SetParent(main.transform, false);
            exhibit.exhibitCamera = holder.AddComponent<Camera>();
            exhibit.exhibitCamera.enabled = false;
            var data = holder.AddComponent<HDAdditionalCameraData>();
            data.antialiasing = HDAdditionalCameraData.AntialiasingMode.None;
            data.allowDynamicResolution = false;

            exhibit.volume = main.gameObject.AddComponent<CustomPassVolume>();
            exhibit.volume.isGlobal = true;
            exhibit.volume.injectionPoint = CustomPassInjectionPoint.BeforePostProcess;
            exhibit.volume.customPasses.Add(new Pass { Owner = exhibit, name = "Exhibit", targetColorBuffer = CustomPass.TargetBuffer.None, targetDepthBuffer = CustomPass.TargetBuffer.None, clearFlags = ClearFlag.None });
            exhibit.blit = new CommandBuffer { name = "Exhibit composite" };
            RenderPipelineManager.endCameraRendering += exhibit.Composite;
            return exhibit;
        }

        public void SetImages(Texture images)
        {
            Shader.SetGlobalTexture(ImagesId, images);
        }

        void Render(in CustomPassContext ctx)
        {
            int width = main.pixelWidth, height = main.pixelHeight;
            if (colour == null || colour.rt.width != width || colour.rt.height != height)
            {
                colour?.Release();
                depth?.Release();
                colour = RTHandles.Alloc(width, height, colorFormat: GraphicsFormat.R8G8B8A8_SRGB, filterMode: FilterMode.Point, name: "Exhibit buffer");
                depth = RTHandles.Alloc(width, height, colorFormat: GraphicsFormat.None, depthBufferBits: DepthBits.Depth32, name: "Exhibit occluder depth");
            }
            exhibitCamera.fieldOfView = main.fieldOfView;
            exhibitCamera.aspect = (float)width / height;
            exhibitCamera.nearClipPlane = main.nearClipPlane;
            exhibitCamera.farClipPlane = OccluderDistance;

            using (new ProfilingScope(ctx.cmd, OccluderSampler))
            {
                CustomPassUtils.RenderDepthFromCamera(ctx, exhibitCamera, null, depth, ClearFlag.Depth, ~(1 << Layer));
            }
            using (new ProfilingScope(ctx.cmd, SurfaceSampler))
            {
                CustomPassUtils.RenderFromCamera(ctx, exhibitCamera, colour, depth, ClearFlag.Color, 1 << Layer, overrideMaterial: surface, overrideMaterialIndex: 0);
            }
            rendered = true;
        }

        void Composite(ScriptableRenderContext context, Camera camera)
        {
            if (camera != main || !rendered || !CompositeEnabled)
            {
                return;
            }
            rendered = false;
            blit.Clear();
            blit.SetGlobalTexture(BufferId, colour);
            // A render texture and the screen disagree about which row is first.
            blit.SetGlobalFloat(FlipId, camera.targetTexture == null && SystemInfo.graphicsUVStartsAtTop ? 1 : 0);
            // The overlays are in the frame only on the screen: a camera that draws into a texture
            // has none in it, and a capture lays them over afterwards (`Over`).
            blit.SetGlobalVector(SparedId, SparedInBuffer(camera.targetTexture == null ? Spared : Rect.zero, camera.pixelWidth, camera.pixelHeight));
            blit.SetRenderTarget(camera.targetTexture != null ? new RenderTargetIdentifier(camera.targetTexture) : new RenderTargetIdentifier(BuiltinRenderTextureType.CameraTarget));
            blit.DrawProcedural(Matrix4x4.identity, composite, 0, MeshTopology.Triangles, 3);
            context.ExecuteCommandBuffer(blit);
            context.Submit();
        }

        // A rectangle of the view in the buffer's texture coordinates, which run from the view's
        // bottom left as a render texture's do: x and y of its low corner, then of its high one. An
        // empty rectangle is one no coordinate lies in.
        public static Vector4 SparedInBuffer(Rect pixels, float width, float height)
        {
            if (pixels.width <= 0 || pixels.height <= 0 || width <= 0 || height <= 0)
            {
                return new Vector4(2, 2, -1, -1);
            }
            return new Vector4(pixels.xMin / width, pixels.yMin / height, pixels.xMax / width, pixels.yMax / height);
        }

        // Blends one texture over another by its alpha, at once: how a capture puts the overlays,
        // which are drawn into a texture of their own when there is no screen, over the frame.
        public void Over(Texture source, RenderTexture destination, bool flip)
        {
            blit.Clear();
            blit.SetGlobalTexture(BufferId, source);
            blit.SetGlobalFloat(FlipId, flip ? 1 : 0);
            blit.SetGlobalVector(SparedId, SparedInBuffer(Rect.zero, 0, 0));
            blit.SetRenderTarget(destination);
            blit.DrawProcedural(Matrix4x4.identity, composite, 0, MeshTopology.Triangles, 3);
            Graphics.ExecuteCommandBuffer(blit);
        }

        void OnDestroy()
        {
            RenderPipelineManager.endCameraRendering -= Composite;
            colour?.Release();
            depth?.Release();
            blit?.Release();
            CoreUtils.Destroy(surface);
            CoreUtils.Destroy(composite);
        }
    }
}
