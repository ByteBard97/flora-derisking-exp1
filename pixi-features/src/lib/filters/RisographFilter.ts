import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'

export interface ParamDef {
  label: string
  uniform: string
  min: number
  max: number
  step: number
  default: number
  target: 'plant' | 'container' | 'bg'
}

// Plain top-level uniforms — NO interface block, NO #version 300 es.
// Pixi v8 compiles this in WebGL1-compat mode and sets uniforms via
// gl.uniform* calls (not UBOs). Interface blocks cause
// "unbound uniform buffer" GL errors in Pixi's filter pipeline.
const RISO_FRAG = `
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4      uInputSize;

uniform float uHalftoneScale;
uniform vec2  uMisregistration;
uniform float uGrainStrength;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float posterize(float v, float levels) {
  return floor(v * levels + 0.5) / levels;
}

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a < 0.001) { finalColor = vec4(0.0); return; }

  // Red channel with misregistration offset (simulates plate misalignment)
  vec2 offsetUV = vTextureCoord + uMisregistration * uInputSize.zw;
  offsetUV = clamp(offsetUV, vec2(0.0), vec2(1.0));
  float rShifted = texture(uTexture, offsetUV).r;

  // Posterize each channel independently to 2-3 discrete levels
  float r = posterize(rShifted, 3.0);
  float g = posterize(src.g, 2.5);
  float b = posterize(src.b, 2.5);

  // Rotated halftone grids per channel to avoid moire
  vec2 fc = gl_FragCoord.xy;
  float s = uHalftoneScale;
  vec2 cellR = vec2( 0.866 * fc.x - 0.5   * fc.y,  0.5   * fc.x + 0.866 * fc.y) / s;
  vec2 cellG = fc / s;
  vec2 cellB = vec2( 0.966 * fc.x - 0.259 * fc.y,  0.259 * fc.x + 0.966 * fc.y) / s;

  float htR = step(length(fract(cellR) - 0.5) * 2.0, r * 1.25);
  float htG = step(length(fract(cellG) - 0.5) * 2.0, g * 1.25);
  float htB = step(length(fract(cellB) - 0.5) * 2.0, b * 1.25);

  const float BLEND = 0.6;
  float fr = mix(r, htR * r, BLEND);
  float fg = mix(g, htG * g, BLEND);
  float fb = mix(b, htB * b, BLEND);

  // Screen-space grain (stuck to screen, not world)
  float grain = (hash21(fc) - 0.5) * uGrainStrength;
  fr = clamp(fr + grain, 0.0, 1.0);
  fg = clamp(fg + grain, 0.0, 1.0);
  fb = clamp(fb + grain, 0.0, 1.0);

  // Premultiplied output (Pixi v8 requirement)
  float alpha = src.a;
  finalColor = vec4(vec3(fr, fg, fb) * alpha, alpha);
}
`

export class RisographFilter extends Filter {
  constructor() {
    const risoUniforms = new UniformGroup({
      uHalftoneScale:   { value: 4.0,                         type: 'f32' },
      uMisregistration: { value: new Float32Array([1.5, 1.0]), type: 'vec2<f32>' },
      uGrainStrength:   { value: 0.08,                        type: 'f32' },
    })
    super({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: RISO_FRAG,
      }),
      resources: { risoUniforms },
    })
  }
}

export const RISOGRAPH_PARAMS: ParamDef[] = [
  { label: 'Halftone Scale',  uniform: 'uHalftoneScale',   min: 1,  max: 10,  step: 0.5,  default: 4,    target: 'plant' },
  { label: 'Misregistration', uniform: 'uMisregistration', min: 0,  max: 4,   step: 0.1,  default: 1.5,  target: 'plant' },
  { label: 'Grain',           uniform: 'uGrainStrength',   min: 0,  max: 0.3, step: 0.01, default: 0.08, target: 'plant' },
]
