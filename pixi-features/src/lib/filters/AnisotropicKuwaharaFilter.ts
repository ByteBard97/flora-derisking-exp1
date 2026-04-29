/**
 * 3-pass Anisotropic Kuwahara filter — Pixi v8.
 * Source: flora-studio/docs/research/followup-B-multipass-filter.md
 *
 * Pass 1 — Sobel structure tensor  (input → tensorRT)
 * Pass 2 — Gaussian blur of tensor (tensorRT → blurredRT)   via BlurFilter
 * Pass 3 — Anisotropic Kuwahara    (input + blurredRT → output)
 *
 * Drop into sprite.filters = [new AnisotropicKuwaharaFilter({ kernelSize: 12 })].
 *
 * CRITICAL Pixi v8 filter rules applied here (from WatercolorWashFilter pattern):
 *  - defaultFilterVert as vertex shader (no custom vertex needed for filters)
 *  - No #version 300 es (Pixi injects it for filters)
 *  - Flat uniform declarations in GLSL — NO interface blocks/UBOs (cause GPU errors)
 *  - Sampler2D resources at top-level of resources, NOT inside a UniformGroup
 */
import { Filter, GlProgram, UniformGroup, BlurFilter, RenderTexture, defaultFilterVert } from 'pixi.js'
import type { FilterSystem, Texture, RenderSurface } from 'pixi.js'

// ---------------------------------------------------------------------------
// Pass 1: Sobel structure tensor
// Writes (Jxx, Jyy, Jxy, 1) into RGBA.
// ---------------------------------------------------------------------------
const SOBEL_FRAG = `
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4      uInputSize;

void main() {
  vec2 px = uInputSize.zw;
  vec2 uv = vTextureCoord;

  vec3 t00 = texture(uTexture, uv + vec2(-px.x, -px.y)).rgb;
  vec3 t01 = texture(uTexture, uv + vec2(-px.x,  0.0 )).rgb;
  vec3 t02 = texture(uTexture, uv + vec2(-px.x,  px.y)).rgb;
  vec3 t10 = texture(uTexture, uv + vec2( 0.0,  -px.y)).rgb;
  vec3 t12 = texture(uTexture, uv + vec2( 0.0,   px.y)).rgb;
  vec3 t20 = texture(uTexture, uv + vec2( px.x, -px.y)).rgb;
  vec3 t21 = texture(uTexture, uv + vec2( px.x,  0.0 )).rgb;
  vec3 t22 = texture(uTexture, uv + vec2( px.x,  px.y)).rgb;

  vec3 Sx = (-t00 - 2.0*t01 - t02 + t20 + 2.0*t21 + t22) / 4.0;
  vec3 Sy = (-t00 - 2.0*t10 - t20 + t02 + 2.0*t12 + t22) / 4.0;

  finalColor = vec4(dot(Sx, Sx), dot(Sy, Sy), dot(Sx, Sy), 1.0);
}
`

// ---------------------------------------------------------------------------
// Pass 3: Anisotropic Kuwahara
// Flat uniform declarations — no interface block (UBO blocks break Pixi filters).
// ---------------------------------------------------------------------------
const KUWAHARA_FRAG = `
precision highp float;

in  vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uTensorTex;
uniform vec4      uInputSize;

uniform float uKernelSize;
uniform float uHardness;
uniform float uSharpness;
uniform float uAlpha;
uniform float uZeroCrossing;
uniform float uZeta;

vec4 scalingFactor(vec4 t) {
  float disc    = sqrt(max(0.0, (t.x - t.y)*(t.x - t.y) + 4.0*t.z*t.z));
  float lambda1 = 0.5 * (t.x + t.y + disc);
  float lambda2 = 0.5 * (t.x + t.y - disc);
  vec2  v   = vec2(lambda1 - t.x, -t.z);
  vec2  n   = (length(v) > 1e-6) ? normalize(v) : vec2(0.0, 1.0);
  float phi = -atan(n.y, n.x);
  float A   = (lambda1 + lambda2 > 1e-6)
              ? (lambda1 - lambda2) / (lambda1 + lambda2) : 0.0;
  return vec4(n, phi, A);
}

vec4 kuwahara(vec2 n, float phi, float A, vec2 d, vec2 uv) {
  int   radius = int(uKernelSize) / 2;
  float a      = float(radius) * clamp((uAlpha + A) / uAlpha, 0.1, 2.0);
  float b      = float(radius) * clamp(uAlpha / (uAlpha + A), 0.1, 2.0);
  float cphi   = cos(phi), sphi = sin(phi);
  mat2  SR     = mat2(0.5/a, 0.0, 0.0, 0.5/b) * mat2(cphi, -sphi, sphi, cphi);
  int   max_x  = int(sqrt(a*a*cphi*cphi + b*b*sphi*sphi));
  int   max_y  = int(sqrt(a*a*sphi*sphi + b*b*cphi*cphi));
  float sinZC  = sin(uZeroCrossing);
  float eta    = (uZeta + cos(uZeroCrossing)) / (sinZC * sinZC);

  vec4 m[8]; vec3 s[8];
  for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }

  for (int y = -max_y; y <= max_y; y++) {
    for (int x = -max_x; x <= max_x; x++) {
      vec2  vv = SR * vec2(float(x), float(y));
      if (dot(vv, vv) > 0.25) continue;
      vec3  c  = clamp(texture(uTexture, uv + vec2(float(x), float(y)) * d).rgb, 0.0, 1.0);
      float w[8]; float sum = 0.0;
      float vxx = uZeta - eta*vv.x*vv.x, vyy = uZeta - eta*vv.y*vv.y, z;
      z = max(0.0,  vv.y + vxx); w[0]=z*z; sum+=w[0];
      z = max(0.0, -vv.x + vyy); w[2]=z*z; sum+=w[2];
      z = max(0.0, -vv.y + vxx); w[4]=z*z; sum+=w[4];
      z = max(0.0,  vv.x + vyy); w[6]=z*z; sum+=w[6];
      vec2  vr   = (sqrt(2.0)/2.0) * vec2(vv.x-vv.y, vv.x+vv.y);
      float vrxx = uZeta - eta*vr.x*vr.x, vryy = uZeta - eta*vr.y*vr.y;
      z = max(0.0,  vr.y + vrxx); w[1]=z*z; sum+=w[1];
      z = max(0.0, -vr.x + vryy); w[3]=z*z; sum+=w[3];
      z = max(0.0, -vr.y + vrxx); w[5]=z*z; sum+=w[5];
      z = max(0.0,  vr.x + vryy); w[7]=z*z; sum+=w[7];
      float g = exp(-3.125 * dot(vv,vv)) / max(sum, 1e-6);
      for (int k = 0; k < 8; k++) {
        float wk = w[k] * g;
        m[k] += vec4(c*wk, wk); s[k] += c*c*wk;
      }
    }
  }

  vec4 out_ = vec4(0.0);
  for (int k = 0; k < 8; k++) {
    if (m[k].w <= 0.0) continue;
    m[k].rgb /= m[k].w;
    s[k]      = abs(s[k]/m[k].w - m[k].rgb*m[k].rgb);
    float sigma2 = s[k].r + s[k].g + s[k].b;
    float wk = 1.0 / (1.0 + pow(uHardness * 1000.0 * sigma2, 0.5 * uSharpness));
    out_ += vec4(m[k].rgb * wk, wk);
  }
  return clamp(out_ / max(out_.w, 1e-6), 0.0, 1.0);
}

void main() {
  vec4  t   = texture(uTensorTex, vTextureCoord);
  vec4  fac = scalingFactor(t);
  vec4  col = kuwahara(fac.xy, fac.z, fac.w, uInputSize.zw, vTextureCoord);
  float a   = texture(uTexture, vTextureCoord).a;
  finalColor = vec4(col.rgb * a, a);
}
`

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AnisotropicKuwaharaOptions {
  /** Kernel diameter in pixels. O(k²) — keep ≤ 16 on integrated GPU. Default: 12 */
  kernelSize?:    number
  /** High-frequency suppression. Default: 8 */
  hardness?:      number
  /** Splotch sharpness. Default: 8 */
  sharpness?:     number
  /** Eccentricity intensity. Default: 1 */
  alpha?:         number
  /** Sector boundary threshold (rad). Default: 0.58 */
  zeroCrossing?:  number
  /** Polynomial weight bias. Default: 0.1 */
  zeta?:          number
  /** BlurFilter strength for tensor smoothing. Default: 2 */
  blurStrength?:  number
  /** BlurFilter quality (pass count). Default: 4 */
  blurQuality?:   number
}

// ---------------------------------------------------------------------------
// Filter class
// ---------------------------------------------------------------------------

export class AnisotropicKuwaharaFilter extends Filter {
  private readonly _sobelFilter:    Filter
  private readonly _blurFilter:     BlurFilter
  private readonly _kuwaharaFilter: Filter
  private _tensorRT:                RenderTexture | null = null
  private _blurredTensorRT:         RenderTexture | null = null

  constructor(options: AnisotropicKuwaharaOptions = {}) {
    const {
      kernelSize   = 12,
      hardness     = 8,
      sharpness    = 8,
      alpha        = 1,
      zeroCrossing = 0.58,
      zeta         = 0.1,
      blurStrength = 2,
      blurQuality  = 4,
    } = options

    // The outer shell is never applied directly (apply() is fully overridden).
    // We still need a valid glProgram for the base class constructor.
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: SOBEL_FRAG }),
      resources: {},
    })

    // Pass 1: Sobel
    this._sobelFilter = new Filter({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: SOBEL_FRAG }),
      resources: {},
    })

    // Pass 2: Gaussian blur of the tensor
    this._blurFilter = new BlurFilter({ strength: blurStrength, quality: blurQuality })

    // Pass 3: Kuwahara — kuwaharaUniforms flattened to plain uniforms on WebGL
    const kuwaharaUniforms = new UniformGroup({
      uKernelSize:   { value: kernelSize,   type: 'f32' },
      uHardness:     { value: hardness,     type: 'f32' },
      uSharpness:    { value: sharpness,    type: 'f32' },
      uAlpha:        { value: alpha,        type: 'f32' },
      uZeroCrossing: { value: zeroCrossing, type: 'f32' },
      uZeta:         { value: zeta,         type: 'f32' },
    })
    this._kuwaharaFilter = new Filter({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: KUWAHARA_FRAG }),
      resources: { kuwaharaUniforms },
      // padding ensures the neighbourhood kernel doesn't sample outside the frame
      padding: Math.ceil(kernelSize / 2),
    })
  }

  // Public accessors
  get kernelSize() { return this._kuwaharaFilter.resources.kuwaharaUniforms.uniforms.uKernelSize as number }
  set kernelSize(v: number) { this._kuwaharaFilter.resources.kuwaharaUniforms.uniforms.uKernelSize = v; this._kuwaharaFilter.padding = Math.ceil(v / 2) }
  get hardness()   { return this._kuwaharaFilter.resources.kuwaharaUniforms.uniforms.uHardness as number }
  set hardness(v)  { this._kuwaharaFilter.resources.kuwaharaUniforms.uniforms.uHardness = v }
  get sharpness()  { return this._kuwaharaFilter.resources.kuwaharaUniforms.uniforms.uSharpness as number }
  set sharpness(v) { this._kuwaharaFilter.resources.kuwaharaUniforms.uniforms.uSharpness = v }

  private _ensureRTs(width: number, height: number) {
    if (!this._tensorRT) {
      this._tensorRT       = RenderTexture.create({ width, height })
      this._blurredTensorRT = RenderTexture.create({ width, height })
    } else if (this._tensorRT.width !== width || this._tensorRT.height !== height) {
      this._tensorRT.resize(width, height)
      this._blurredTensorRT!.resize(width, height)
    }
  }

  public override apply(
    filterManager: FilterSystem,
    input: Texture,
    output: RenderSurface,
    clearMode: boolean,
  ): void {
    this._ensureRTs(input.source.width, input.source.height)
    const tensorRT        = this._tensorRT!
    const blurredTensorRT = this._blurredTensorRT!

    // Pass 1: Sobel → tensorRT
    filterManager.applyFilter(this._sobelFilter, input, tensorRT, true)

    // Pass 2: Blur tensorRT → blurredTensorRT (BlurFilter manages its own ping-pong)
    this._blurFilter.apply(filterManager, tensorRT as unknown as Texture, blurredTensorRT, true)

    // Pass 3: Inject blurred tensor as second sampler, then Kuwahara → output
    // Key: assign TextureSource (not RenderTexture) to resources under the sampler name
    this._kuwaharaFilter.resources.uTensorTex = blurredTensorRT.source
    filterManager.applyFilter(this._kuwaharaFilter, input, output, clearMode)
  }

  public override destroy(): void {
    this._tensorRT?.destroy(true);        this._tensorRT = null
    this._blurredTensorRT?.destroy(true); this._blurredTensorRT = null
    this._sobelFilter.destroy()
    this._blurFilter.destroy()
    this._kuwaharaFilter.destroy()
    super.destroy()
  }
}
