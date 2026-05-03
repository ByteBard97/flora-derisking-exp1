/**
 * WatercolorFillFilter — turns a flat-filled silhouette into a watercolor wash.
 *
 * Three effects, each independently dialable:
 *
 *   1. **Pigment variation** — fbm noise modulates lightness across the fill,
 *      so the interior reads as patches of slightly different value (the
 *      "wet-on-wet" pooling look in Annie's reference).
 *
 *   2. **Edge darkening** — pigment naturally pools where the wash dries.
 *      We detect proximity to the silhouette edge by sampling the alpha
 *      channel at small offsets, and darken the color where alpha drops.
 *
 *   3. **Paper grain** — a high-frequency multiplicative noise overlay,
 *      simulating cold-press watercolor paper texture.
 *
 * Applied to a Pixi `Graphics` filled solid, this turns it from poster-flat
 * into a textured wash. Outlines and drop shadows are NOT filtered — apply
 * this only to the fill layer of a plant symbol.
 */

import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'

const FRAG = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;

uniform float uPigmentStrength;     // 0..1 — how much fbm modulates lightness
uniform float uPigmentScale;        // ~3..12 — fbm frequency
uniform float uEdgeDarkenStrength;  // 0..1 — pigment pooling at silhouette edge
uniform float uEdgeDarkenRadius;    // pixels — how far in to look for edge
uniform float uPaperGrainStrength;  // 0..0.4 — multiplicative grain amplitude
uniform float uPaperGrainScale;     // ~40..120 — grain frequency

// Hash + value noise (cheap, deterministic).
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5-octave rotated fbm — gives the patchy, organic pigment look.
float fbm(vec2 p) {
  const mat2 R = mat2(0.80, -0.60, 0.60, 0.80);
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = R * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a < 0.001) { finalColor = vec4(0.0); return; }

  // Un-premultiply so we can manipulate color independent of alpha.
  vec3 base = src.rgb / src.a;

  // ── 1. Pigment variation ──────────────────────────────────────────
  float pig = fbm(vTextureCoord * uPigmentScale);
  // Map [0,1] noise to [0.55, 1.25] lightness multiplier — light patches
  // brighter than base, dark patches lower.
  float pigMul = mix(1.0, 0.55 + pig * 0.9, uPigmentStrength);
  vec3 color = base * pigMul;

  // ── 2. Edge darkening ─────────────────────────────────────────────
  // Sample alpha at four cardinal offsets; the lowest neighbor tells us
  // how close we are to the silhouette boundary.
  vec2 step = (uEdgeDarkenRadius / uInputSize.xy);
  float aN = texture(uTexture, vTextureCoord + vec2(0.0, -step.y)).a;
  float aS = texture(uTexture, vTextureCoord + vec2(0.0,  step.y)).a;
  float aE = texture(uTexture, vTextureCoord + vec2( step.x, 0.0)).a;
  float aW = texture(uTexture, vTextureCoord + vec2(-step.x, 0.0)).a;
  float minN = min(min(aN, aS), min(aE, aW));
  // edgeProx: 0 deep inside, 1 right at edge (noisified slightly)
  float edgeProx = clamp(1.0 - minN, 0.0, 1.0);
  edgeProx *= 0.7 + 0.6 * fbm(vTextureCoord * uPigmentScale * 1.7);
  vec3 fringe = base * 0.55;
  color = mix(color, fringe, clamp(edgeProx * uEdgeDarkenStrength, 0.0, 1.0));

  // ── 3. Paper grain ────────────────────────────────────────────────
  vec2 paperUV = vTextureCoord * uInputSize.xy * (uPaperGrainScale / 1000.0);
  float paper = vnoise(paperUV) * 0.6 + vnoise(paperUV * 2.13 + 5.0) * 0.4;
  float grain = (paper - 0.5) * uPaperGrainStrength;
  color *= 1.0 + grain;

  // Re-premultiply.
  finalColor = vec4(color * src.a, src.a);
}
`

export interface WatercolorFillParams {
  pigmentStrength: number
  pigmentScale: number
  edgeDarkenStrength: number
  edgeDarkenRadius: number
  paperGrainStrength: number
  paperGrainScale: number
}

export const DEFAULT_WATERCOLOR_FILL: WatercolorFillParams = {
  pigmentStrength: 0.55,
  pigmentScale: 7.0,
  edgeDarkenStrength: 0.65,
  edgeDarkenRadius: 4.0,
  paperGrainStrength: 0.18,
  paperGrainScale: 60.0,
}

export class WatercolorFillFilter extends Filter {
  constructor(params: WatercolorFillParams = DEFAULT_WATERCOLOR_FILL) {
    const watercolorUniforms = new UniformGroup({
      uPigmentStrength:    { value: params.pigmentStrength,    type: 'f32' },
      uPigmentScale:       { value: params.pigmentScale,       type: 'f32' },
      uEdgeDarkenStrength: { value: params.edgeDarkenStrength, type: 'f32' },
      uEdgeDarkenRadius:   { value: params.edgeDarkenRadius,   type: 'f32' },
      uPaperGrainStrength: { value: params.paperGrainStrength, type: 'f32' },
      uPaperGrainScale:    { value: params.paperGrainScale,    type: 'f32' },
    })
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: FRAG }),
      resources: { watercolorUniforms },
      // A bit of padding so the edge-detect kernel doesn't sample outside
      // the filter area and read back zeros that aren't part of the silhouette.
      padding: 6,
    })
  }
}
