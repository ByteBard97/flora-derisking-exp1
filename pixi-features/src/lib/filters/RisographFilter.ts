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

// Two-ink riso: source is reduced to luminance, posterized into 2 tonal bands,
// each band printed as halftone dots in its assigned spot ink. The mid band
// gets a misregistered second pass to simulate plate misalignment.
const RISO_FRAG = `
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4      uInputSize;

uniform float uHalftoneScale;
uniform vec2  uMisregistration;
uniform float uGrainStrength;
uniform vec3  uInkA;     // dark ink — covers shadow band
uniform vec3  uInkB;     // light ink — covers mid band, prints offset
uniform vec3  uPaper;    // paper color — lightest band

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float luma(vec3 c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

// Halftone dot coverage at screen-space position fc, given tone (0=empty, 1=solid)
// and a rotation angle. Returns 0..1 coverage.
float halftone(vec2 fc, float scale, float angleRad, float tone) {
  float ca = cos(angleRad), sa = sin(angleRad);
  vec2 cell = vec2(ca * fc.x - sa * fc.y, sa * fc.x + ca * fc.y) / scale;
  vec2 g = fract(cell) - 0.5;
  // Dot radius grows with tone; 0.71 ~= sqrt(0.5) so at tone=1 the dot fills the cell.
  float r = sqrt(tone) * 0.71;
  return step(length(g), r);
}

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a < 0.001) { finalColor = vec4(0.0); return; }

  float L = luma(src.rgb);

  // Two-band posterize: coverageA for dark ink, coverageB for mid ink.
  // Dark ink only fires where the source is genuinely dark (L < 0.45).
  // Mid ink fills the midtones (0.35 < L < 0.8); they overlap slightly so
  // the bands feather into each other instead of banding hard.
  float coverageA = smoothstep(0.55, 0.15, L);
  float coverageB = smoothstep(0.85, 0.4, L) * (1.0 - smoothstep(0.25, 0.05, L));

  vec2 fc = gl_FragCoord.xy;
  float s = max(uHalftoneScale, 0.5);

  // Ink A printed first, on-register
  float dotsA = halftone(fc, s, 0.262, coverageA);                // ~15°

  // Ink B printed second, slightly offset in screen pixels — that's the misregistration
  vec2 fcB = fc + uMisregistration * vec2(1.0, -0.6);
  float dotsB = halftone(fcB, s * 1.15, -0.785, coverageB);       // -45°, slightly larger cell

  // Paper shows wherever no ink lands
  vec3 col = uPaper;
  col = mix(col, uInkB, dotsB);
  col = mix(col, uInkA, dotsA);

  // Screen-space grain
  float grain = (hash21(fc) - 0.5) * uGrainStrength;
  col = clamp(col + grain, 0.0, 1.0);

  float alpha = src.a;
  finalColor = vec4(col * alpha, alpha);
}
`

export const RISOGRAPH_PARAMS: ParamDef[] = [
  { label: 'Halftone Scale',  uniform: 'uHalftoneScale',   min: 1,  max: 10,  step: 0.5,  default: 4,    target: 'plant' },
  { label: 'Misregistration', uniform: 'uMisregistration', min: 0,  max: 4,   step: 0.1,  default: 1.2,  target: 'plant' },
  { label: 'Grain',           uniform: 'uGrainStrength',   min: 0,  max: 0.3, step: 0.01, default: 0.06, target: 'plant' },
]

const [htParam, misParam, grainParam] = RISOGRAPH_PARAMS

// Two-ink palettes per plant species — soy-ink-like spot colors that mix
// optically through the halftone overlap. Paper is uniform across species.
export const RISO_PAPER: [number, number, number] = [0.96, 0.93, 0.86]   // warm cream

export const RISO_INK_PALETTES: Record<string, { inkA: [number, number, number]; inkB: [number, number, number] }> = {
  oak:      { inkA: [0.10, 0.18, 0.28], inkB: [0.40, 0.62, 0.50] },   // navy + sage
  magnolia: { inkA: [0.45, 0.10, 0.25], inkB: [0.95, 0.55, 0.55] },   // burgundy + rose
  azalea:   { inkA: [0.60, 0.15, 0.45], inkB: [0.95, 0.65, 0.75] },   // plum + blush
  fern:     { inkA: [0.18, 0.30, 0.20], inkB: [0.75, 0.80, 0.40] },   // forest + chartreuse
}

export class RisographFilter extends Filter {
  constructor(inkA: [number, number, number], inkB: [number, number, number], paper: [number, number, number] = RISO_PAPER) {
    const risoUniforms = new UniformGroup({
      uHalftoneScale:   { value: htParam.default,                                      type: 'f32' },
      uMisregistration: { value: new Float32Array([misParam.default, 1.0]),            type: 'vec2<f32>' },
      uGrainStrength:   { value: grainParam.default,                                   type: 'f32' },
      uInkA:            { value: new Float32Array(inkA),                                type: 'vec3<f32>' },
      uInkB:            { value: new Float32Array(inkB),                                type: 'vec3<f32>' },
      uPaper:           { value: new Float32Array(paper),                               type: 'vec3<f32>' },
    })
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: RISO_FRAG }),
      resources: { risoUniforms },
    })
  }
}
