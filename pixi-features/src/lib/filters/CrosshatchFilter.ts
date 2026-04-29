import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'

// #version 300 es required for fwidth(). Plain uniforms, no interface blocks.
const CROSSHATCH_FRAG = `#version 300 es
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4  uInputSize;
uniform vec4  uOutputFrame;

uniform mat3  uWorldMatrix;
uniform float uTone;
uniform vec3  uHatchColor;
uniform vec4  uPaperColor;
uniform float uSeed;
uniform float uLineSpacing;
uniform float uLineWidth;

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f*f*(3.0-2.0*f);
  return mix(mix(dot(hash22(i+vec2(0,0)),f-vec2(0,0)),
                 dot(hash22(i+vec2(1,0)),f-vec2(1,0)),u.x),
             mix(dot(hash22(i+vec2(0,1)),f-vec2(0,1)),
                 dot(hash22(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y);
}

float hatchLine(vec2 worldP, vec2 dir, float spacing, float halfW, float jitter) {
  vec2  perp = vec2(-dir.y, dir.x);
  float u = dot(worldP, perp);
  float v = dot(worldP, dir);
  float band = floor(u / spacing);
  vec2  s = vec2(band, uSeed);
  float offset   = vnoise(s * 1.7) * jitter * spacing * 0.25;
  float widthMod = 1.0 + vnoise(s * 3.1) * 0.35;
  float along    = vnoise(vec2(v/(spacing*4.0), band*0.13+uSeed)) * jitter * spacing * 0.30;
  float d  = abs(mod(u + offset + along, spacing) - spacing * 0.5);
  float w  = max(halfW * widthMod, 0.4);
  float aa = fwidth(u) + 0.5;
  return 1.0 - smoothstep(w - aa, w + aa, d);
}

void main() {
  vec2 screenPx = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 worldP   = (uWorldMatrix * vec3(screenPx, 1.0)).xy;

  vec2 d1 = vec2(0.7071, 0.7071);
  vec2 d2 = vec2(-0.7071, 0.7071);
  vec2 d3 = vec2(1.0, 0.0);
  float jitter = 1.0;

  float l1 = hatchLine(worldP, d1, uLineSpacing,       uLineWidth, jitter);
  float l2 = hatchLine(worldP, d2, uLineSpacing,       uLineWidth, jitter);
  float l3 = hatchLine(worldP, d3, uLineSpacing*0.55,  uLineWidth*0.85, jitter);

  float g1 = smoothstep(0.05, 0.40, uTone);
  float g2 = smoothstep(0.35, 0.70, uTone);
  float g3 = smoothstep(0.65, 0.95, uTone);
  float coverage = max(max(l1*g1, l2*g2), l3*g3);

  vec3  rgb   = mix(uPaperColor.rgb, uHatchColor, coverage);
  float alpha = max(uPaperColor.a, coverage);
  float mask  = texture(uTexture, vTextureCoord).a;
  finalColor  = vec4(rgb * alpha, alpha) * mask;
}
`

export class CrosshatchFilter extends Filter {
  constructor(
    tone: number = 0.5,
    hatchColor: [number, number, number] = [0.15, 0.25, 0.10],
    seed: number = 0.0,
  ) {
    const hatchUniforms = new UniformGroup({
      uWorldMatrix:  { value: new Float32Array([1,0,0, 0,1,0, 0,0,1]), type: 'mat3x3<f32>' },
      uTone:         { value: tone,                                      type: 'f32' },
      uHatchColor:   { value: new Float32Array(hatchColor),              type: 'vec3<f32>' },
      uPaperColor:   { value: new Float32Array([0.96, 0.94, 0.88, 0.0]), type: 'vec4<f32>' },
      uSeed:         { value: seed,                                       type: 'f32' },
      uLineSpacing:  { value: 8.0,                                        type: 'f32' },
      uLineWidth:    { value: 1.0,                                        type: 'f32' },
    })
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: CROSSHATCH_FRAG }),
      resources: { hatchUniforms },
    })
  }
}
