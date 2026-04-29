import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'
import { GLSL_HASH21_VNOISE } from './glslNoise'

const DEFAULT_SCALE = 6.0
const DEFAULT_BASE_FREQUENCY = 0.02

const WOBBLE_FRAG = `
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform float uScale;
uniform vec2  uBaseFrequency;
` + GLSL_HASH21_VNOISE + `
// 3-octave fbm — lightweight for background displacement
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vTextureCoord;
  vec2 noiseP = uv * uInputSize.xy * uBaseFrequency;
  float nx = fbm(noiseP) - 0.5;
  float ny = fbm(noiseP + vec2(43.17, 91.31)) - 0.5;
  vec2 dUV = vec2(nx, ny) * uScale * uInputSize.zw;
  vec2 displaced = clamp(uv + dUV, vec2(0.0), vec2(1.0));
  finalColor = texture(uTexture, displaced);
}
`

export class WobbleFilter extends Filter {
  constructor() {
    const wobbleUniforms = new UniformGroup({
      uScale:         { value: DEFAULT_SCALE,                                      type: 'f32' },
      uBaseFrequency: { value: new Float32Array([DEFAULT_BASE_FREQUENCY, DEFAULT_BASE_FREQUENCY]), type: 'vec2<f32>' },
    })
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: WOBBLE_FRAG }),
      resources: { wobbleUniforms },
    })
  }
}
