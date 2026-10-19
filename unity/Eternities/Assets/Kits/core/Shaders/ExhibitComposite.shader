// The composite of PRD v4 8.4.4: the exhibit buffer over the main camera's finished output, where
// its alpha is set. It runs after the camera's post-processing and upscaling, so nothing the
// pipeline does to a frame reaches a card's pixels. The overlays are in that output already, and
// it leaves the hover label's rectangle, `_ExhibitSpared`, as it is (DEC-1130 N10).
Shader "Hidden/Eternities/ExhibitComposite"
{
    SubShader
    {
        Pass
        {
            Name "Composite"
            ZTest Always
            ZWrite Off
            Cull Off
            Blend SrcAlpha OneMinusSrcAlpha, Zero One

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex Vert
            #pragma fragment Frag

            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Common.hlsl"

            TEXTURE2D(_ExhibitBuffer);
            SamplerState exhibit_point_clamp_sampler;
            float _ExhibitFlip;
            float4 _ExhibitSpared;      // in the buffer's coordinates: the low corner, then the high one

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            Varyings Vert(uint vertexID : SV_VertexID)
            {
                Varyings output;
                output.positionCS = GetFullScreenTriangleVertexPosition(vertexID);
                output.uv = GetFullScreenTriangleTexCoord(vertexID);
                output.uv.y = lerp(output.uv.y, 1 - output.uv.y, _ExhibitFlip);
                return output;
            }

            float4 Frag(Varyings input) : SV_Target
            {
                if (all(input.uv >= _ExhibitSpared.xy) && all(input.uv <= _ExhibitSpared.zw))
                {
                    return 0;
                }
                return SAMPLE_TEXTURE2D(_ExhibitBuffer, exhibit_point_clamp_sampler, input.uv);
            }
            ENDHLSL
        }
    }
}
