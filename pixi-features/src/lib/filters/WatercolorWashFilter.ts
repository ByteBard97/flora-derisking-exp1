import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'
import { GLSL_HASH21_VNOISE } from './glslNoise'

const DEFAULT_WETNESS = 0.75
const DEFAULT_SPECIES_COLOR: [number, number, number] = [0.35, 0.55, 0.30]

const WATERCOLOR_FRAG = `
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform vec3  uSpeciesColor;
uniform float uWetness;
` + GLSL_HASH21_VNOISE + `
// 5-octave fbm with rotation — richer pigment granulation
float fbm(vec2 p) {
  const mat2 R = mat2(0.80, -0.60, 0.60, 0.80);
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p  = R * p * 2.02;
    a *= 0.5;
  }
  return v;
}

vec3 saturateColor(vec3 c, float amount) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, amount);
}

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a < 0.001) { finalColor = vec4(0.0); return; }

  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 c  = uInputSize.xy * 0.5;
  vec2 d  = px - c;
  float R = min(c.x, c.y);
  float r = length(d) / max(R, 1.0);

  float lighten   = smoothstep(1.0, 0.05, r);
  vec3  base      = uSpeciesColor;
  vec3  centreCol = mix(base, vec3(1.0), 0.35 * lighten);
  vec3  rimCol    = saturateColor(base, 1.25);
  vec3  wash      = mix(rimCol, centreCol, lighten);

  vec2  nUV   = vTextureCoord * 6.0;
  float pig   = fbm(nUV);
  float pigMod = mix(1.0, 0.55 + pig * 0.9, uWetness);

  float edgeBand = smoothstep(0.78, 0.99, r) * (1.0 - smoothstep(0.99, 1.02, r));
  float rimNoise = fbm(vTextureCoord * 12.0 + 17.0) - 0.5;
  edgeBand *= 0.7 + 0.6 * (rimNoise + 0.5);
  vec3 fringeCol = base * 0.55;
  wash = mix(wash, fringeCol, clamp(edgeBand * (0.55 + 0.45 * uWetness), 0.0, 1.0));

  vec2  paperUV = vTextureCoord * uInputSize.xy * 0.05;
  float paper   = vnoise(paperUV) * 0.6 + vnoise(paperUV * 2.13 + 5.0) * 0.4;
  float grain   = (paper - 0.5) * 0.18;
  wash *= 1.0 + grain;

  float alpha = src.a * mix(1.0, pigMod, 0.55);
  alpha *= mix(1.0, 0.92, uWetness);
  finalColor = vec4(wash * alpha, alpha);
}
`

export class WatercolorWashFilter extends Filter {
  constructor(speciesColor: [number, number, number] = DEFAULT_SPECIES_COLOR) {
    const watercolorUniforms = new UniformGroup({
      uSpeciesColor: { value: new Float32Array(speciesColor), type: 'vec3<f32>' },
      uWetness:      { value: DEFAULT_WETNESS,                type: 'f32' },
    })
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: WATERCOLOR_FRAG }),
      resources: { watercolorUniforms },
    })
  }
}
