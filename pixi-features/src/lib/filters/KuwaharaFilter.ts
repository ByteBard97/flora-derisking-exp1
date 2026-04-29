/**
 * Single-pass isotropic Kuwahara filter — Pixi v8.
 *
 * Replaces the 3-pass AnisotropicKuwaharaFilter (disabled: multi-pass cross-context
 * program bug in Pixi v8 FilterSystem when calling filterManager.applyFilter()
 * recursively from an overridden apply()).
 *
 * This version: for each pixel, computes mean and variance in 4 axis-aligned quadrant
 * windows; outputs the mean of the window with lowest variance.
 * Result: painterly, oil-paint-like blobs — less edge-following than anisotropic,
 * but stable, single-pass, and visually compelling.
 *
 * Drop into sprite.filters = [new KuwaharaFilter({ radius: 6 })].
 */
import { Filter, GlProgram, UniformGroup, defaultFilterVert } from 'pixi.js'

// #version 300 es required: shader uses dynamic loop bounds (uRadius is a uniform).
// Without it Pixi compiles as GLSL ES 1.0 where dynamic bounds are rejected.
const KUWAHARA_FRAG = `#version 300 es
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4      uInputSize;   // xy = size in px; zw = 1/px

uniform float uRadius;          // quadrant window radius in pixels; default 6

// Luminance weight for variance (perceptual)
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 d  = uInputSize.zw;   // one texel
  float r = uRadius;
  vec2 uv = vTextureCoord;

  // 4 quadrant means and variances
  // Quadrant offsets: NW(-x,-y), NE(+x,-y), SE(+x,+y), SW(-x,+y)
  vec3  mean[4];
  float var_[4];
  for (int q = 0; q < 4; q++) {
    mean[q] = vec3(0.0);
    var_[q] = 0.0;
  }

  // Accumulate each quadrant independently
  // q=0: x in [-r,0], y in [-r,0]   (NW)
  // q=1: x in [ 0,r], y in [-r,0]   (NE)
  // q=2: x in [ 0,r], y in [ 0,r]   (SE)
  // q=3: x in [-r,0], y in [ 0,r]   (SW)
  float n = (r + 1.0) * (r + 1.0);   // samples per quadrant

  for (float y = -r; y <= 0.0; y += 1.0) {
    for (float x = -r; x <= 0.0; x += 1.0) {
      vec3 c = texture(uTexture, uv + vec2(x, y) * d).rgb;
      mean[0] += c; var_[0] += luma(c) * luma(c);
    }
    for (float x = 0.0; x <= r; x += 1.0) {
      vec3 c = texture(uTexture, uv + vec2(x, y) * d).rgb;
      mean[1] += c; var_[1] += luma(c) * luma(c);
    }
  }
  for (float y = 0.0; y <= r; y += 1.0) {
    for (float x = -r; x <= 0.0; x += 1.0) {
      vec3 c = texture(uTexture, uv + vec2(x, y) * d).rgb;
      mean[3] += c; var_[3] += luma(c) * luma(c);
    }
    for (float x = 0.0; x <= r; x += 1.0) {
      vec3 c = texture(uTexture, uv + vec2(x, y) * d).rgb;
      mean[2] += c; var_[2] += luma(c) * luma(c);
    }
  }

  // Normalise, compute variance as E[x²] - E[x]²
  float minVar = 1e9;
  vec3  result = vec3(0.0);
  for (int q = 0; q < 4; q++) {
    mean[q] /= n;
    float l   = luma(mean[q]);
    var_[q]   = var_[q] / n - l * l;
    if (var_[q] < minVar) {
      minVar = var_[q];
      result = mean[q];
    }
  }

  float srcAlpha = texture(uTexture, uv).a;
  finalColor = vec4(result * srcAlpha, srcAlpha);
}
`

export interface KuwaharaOptions {
  /** Quadrant window radius in pixels. Higher = more painterly. Default: 6 */
  radius?: number
}

export class KuwaharaFilter extends Filter {
  constructor({ radius = 6 }: KuwaharaOptions = {}) {
    const uniforms = new UniformGroup({
      uRadius: { value: radius, type: 'f32' },
    })
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: KUWAHARA_FRAG }),
      resources: { uniforms },
      padding: radius,
    })
  }

  get radius(): number { return this.resources.uniforms.uniforms.uRadius as number }
  set radius(v: number) {
    this.resources.uniforms.uniforms.uRadius = v
    this.padding = v
  }
}
