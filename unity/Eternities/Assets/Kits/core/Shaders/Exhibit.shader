// The image surfaces as the exhibit camera draws them (PRD v4 8.4.4): the card's exact texels from
// the stand texture array, unlit, with no exposure, no fog and nothing after them. It is used as an
// override material from the exhibit pass, never on a renderer. A vertex carries the image's
// coordinates in its second set, and in its third the slot of the array and the coverage, which is
// the 200 ms fade of an arriving image; a surface without a slot draws nothing here and stays the
// swatch the main camera drew.
Shader "Hidden/Eternities/Exhibit"
{
    SubShader
    {
        Pass
        {
            Name "Exhibit"
            ZTest LEqual
            ZWrite On
            Cull Back
            Blend Off

            HLSLPROGRAM
            #pragma target 4.5
            #pragma vertex Vert
            #pragma fragment Frag
            // The engine draws renderers through its GPU-driven path, which asks every pass it is
            // handed, an override material's included, for this variant.
            #pragma multi_compile_instancing
            #pragma instancing_options renderinglayer
            #pragma multi_compile _ DOTS_INSTANCING_ON

            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Common.hlsl"
            #include "Packages/com.unity.render-pipelines.high-definition/Runtime/ShaderLibrary/ShaderVariables.hlsl"

            TEXTURE2D_ARRAY(_ExhibitImages);
            SamplerState exhibit_trilinear_clamp_sampler;

            struct Attributes
            {
                float3 positionOS : POSITION;
                float2 image : TEXCOORD1;
                float2 slot : TEXCOORD2;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 image : TEXCOORD0;
                float2 slot : TEXCOORD1;
            };

            Varyings Vert(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);
                output.positionCS = TransformWorldToHClip(TransformObjectToWorld(input.positionOS));
                output.image = input.image;
                output.slot = input.slot;
                return output;
            }

            float4 Frag(Varyings input) : SV_Target
            {
                clip(input.slot.x + 0.5);
                float3 colour = SAMPLE_TEXTURE2D_ARRAY(_ExhibitImages, exhibit_trilinear_clamp_sampler, input.image, round(input.slot.x)).rgb;
                return float4(colour, input.slot.y);
            }
            ENDHLSL
        }
    }
}
