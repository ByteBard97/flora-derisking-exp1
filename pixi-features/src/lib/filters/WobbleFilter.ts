import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'

const WOBBLE_FRAG = `
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform float uScale;
uniform vec2  uBaseFrequency;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1,0));
  float c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

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
      uScale:         { value: 6.0,                           type: 'f32' },
      uBaseFrequency: { value: new Float32Array([0.02, 0.02]), type: 'vec2<f32>' },
    })
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: WOBBLE_FRAG }),
      resources: { wobbleUniforms },
    })
  }
}
