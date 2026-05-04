# Plan v2 — Bousseau-style watercolor with positioned bloom

## Why this plan replaces the previous one

The previous plan (radial-gradient bloom + texture multiply + blurred-alpha edge darken) was three independent mechanisms held together by guesswork. Reading the Bousseau et al. 2006 paper and the `thewatercolorist` reference implementation revealed a unified pipeline that's simpler AND solves the bloom-fringe problem natively.

Reference implementation: https://github.com/ugocapeto/thewatercolorist
Specifically `thewatercolorist_main.cpp`, `paper_texture.cpp`, `turbulent_flow.cpp`, `edge_darkening_2.cpp`, `modify_color_hsl.cpp`.

## Core insight

Bousseau's pipeline is **three passes of the same operation** with different inputs:

```
modify_color(image, grayscaleTexture, β):
    For each pixel:
        density = 1 + β * (texture - 0.5)        # texture<0.5 darkens, >0.5 lightens
        Cp = C * (1 - (1-C) * (density - 1))     # apply to L (and optionally S) in HSL
```

The three passes:
1. **Paper texture** — `modify_color(image, paperGrayscale, βpaper)` — cellulose grain
2. **Turbulent flow** — `modify_color(image, perlinNoise, βflow)` — natural patch variation
3. **Edge darkening** — `modify_color(image, sobelGradientMagnitude, βedge)` — pigment pooling at color boundaries

Critical: pass 3's gradient is computed on the COLOR image, not on alpha. This means it automatically darkens transitions between primary and secondary colors *inside* the silhouette, giving us the soft fringe between the two-color regions for free. No special bloom-edge handling.

## Algorithm

```
For each plant:
  Allocate offscreen canvas (size = displayRadius * 2 + padding).
  
  1. Drop shadow (existing — blurred filled silhouette, offset, low alpha)
  
  2. Solid primary fill across full silhouette (clipped to silhouette polygon)
  
  3. Solid secondary fill at anchor — bloom region
     SDF: d = length(p - anchorPx) / bloomRadius + (fbm(p * fbmScale) - 0.5) * fbmAmplitude
     alpha = 1 - smoothstep(0, bloomSoftness, d)
     Fill bloomColor at this alpha using source-over, still clipped to silhouette
     
  4. Pass 1 — paper texture (modify_color with paper grayscale)
  5. Pass 2 — turbulent flow (modify_color with multi-octave Perlin)
  6. Pass 3 — edge darkening (modify_color with Sobel of current image, inverted+normalized)
  
  7. Outline (jittered, on top of everything — unchanged)
  
  canvas → Pixi Texture → Sprite, anchor 0.5
```

## Parameter additions

`PlantSymbolParams` adds:
- `bloomAnchor: { x: number; y: number }` (0..1 normalized, default = `defaultAnchor(seed)`)
- `bloomRadius: number` (fraction of displayRadius, default 0.55)
- `bloomSoftness: number` (smoothstep range, 0..1, default 0.7)
- `bloomFbmAmplitude: number` (SDF perturbation strength, default 0.18)

Replace `WatercolorParams` with `BousseauParams`:
- `betaPaper: number` (default 0.45)
- `betaFlow: number` (default 0.55)
- `betaEdge: number` (default 0.7)
- `flowOctaves: number` (default 6)
- `flowFrequency0: number` (default 0.012)
- `bloomColor: number` (carried over)

Drop: all the old `primaryStrength`, `bloomStrength`, `edgeDarkenStrength`, etc. They were specific to the old multi-mechanism approach and don't map onto Bousseau.

## Per-plant variation

Same as before — `defaultAnchor(seed)` puts the bloom slightly off-center via polar offset hashed from the plant seed, so 12 plants don't all bloom at the same spot. Anchors live in a `Map<plantId, {x, y}>` in the playground component. Click-drag sets per-plant overrides.

## Bousseau passes — implementation in canvas

All three passes take the form:

```typescript
function modifyColor(
  imageData: ImageData,
  textureSampler: (x: number, y: number) => number,  // returns 0..1
  beta: number,
): void {
  const d = imageData.data
  const w = imageData.width
  for (let i = 0, n = d.length; i < n; i += 4) {
    const px = (i / 4) % w
    const py = Math.floor((i / 4) / w)
    const tex = textureSampler(px, py)
    const density = 1 + beta * (tex - 0.5)
    if (d[i + 3] === 0) continue
    
    // RGB → HSL → modulate L → HSL → RGB
    const [h, s, l] = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255)
    const lp = l * (1 - (1 - l) * (density - 1))
    const [r, g, b] = hslToRgb(h, s, clamp01(lp))
    d[i]     = Math.round(r * 255)
    d[i + 1] = Math.round(g * 255)
    d[i + 2] = Math.round(b * 255)
  }
}
```

Pass 1 — paper texture sampler:
```typescript
const paperBitmap = await loadPaperGrayscale()  // single asset, ~256KB
const sampler = (x, y) => sampleAlphaAtTiledOffset(paperBitmap, x, y, plantOffset, paperScale)
```

Pass 2 — turbulent flow sampler (procedural Perlin):
```typescript
import { createNoise2D } from 'simplex-noise'  // or our own seeded perlin
const noise2d = createNoise2D(rngFromSeed(plantId))
const sampler = (x, y) => {
  let total = 0, amplitude = 1, frequency = flowFrequency0, max = 0
  for (let i = 0; i < flowOctaves; i++) {
    total += amplitude * (noise2d(x * frequency, y * frequency) + 1) / 2
    max += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return total / max
}
```

Pass 3 — Sobel edge darkening:
```typescript
// Compute Sobel gradient magnitude over the current canvas
// kernel from edge_darkening_2.cpp (which is a 5x5-ish anti-aliased sobel)
const gradientMap = computeSobelGradient(imageData)   // returns Uint8ClampedArray, normalized
const sampler = (x, y) => {
  const grad = gradientMap[y * w + x] / 255
  return (1 - grad) / 2 + 0.5   // invert and remap so high gradient = dark
}
```

The Sobel kernel from `edge_darkening_2.cpp` is a constructed n×n kernel; for n=5 it gives smooth gradient detection. We can use a simpler 3×3 Sobel or replicate the exact kernel.

## Playground UI

Toolbar additions (replacing old multi-strength sliders):
- **β paper** (slider, 0..1, default 0.45)
- **β flow** (slider, 0..1, default 0.55)
- **β edge** (slider, 0..1, default 0.7)
- **Bloom radius** (slider, 0.2..1.5)
- **Bloom softness** (slider, 0..1)

Click-drag interactions:
- Click on a plant Sprite → marks plant as selected, shows ring overlay
- `globalpointermove` on stage while drag-active → updates selected plant's anchor (clamped to 0..1)
- `pointerup` → commits, removes drag state
- Render throttled to once per animation frame via a `pending: boolean` flag (debounce, not throttle)
- Visible 6px circle handle drawn at anchor on selected plant

`onUnmounted` removes pointer listeners.

## File changes

| File | Change |
|---|---|
| `src/lib/plantSymbol.ts` | Replace `paintPigmentPass` and `edgeDarkenInPlace` with `modifyColor` + three pass-specific samplers (`paperSampler`, `flowSampler`, `sobelSampler`). Add SDF bloom fill. Restore `rgbToHsl`/`hslToRgb` helpers. |
| `src/lib/perlinNoise.ts` (new) | Seeded 2D Perlin noise for turbulent flow. Either `simplex-noise` package or a small inline implementation. |
| `src/lib/sobelGradient.ts` (new) | Compute gradient magnitude image from RGBA ImageData. Normalize, return Uint8ClampedArray. |
| `src/tabs/TabPlantStylePlayground.vue` | Replace strength sliders with β sliders. Add bloom anchor click-drag with `globalpointermove`. Selection ring + handle dot. `onUnmounted` cleanup. |
| `public/textures/paper.png` (new) | Single grayscale paper texture asset (~512px, ~50 KB). The bloom-rose and wash-green textures are no longer needed (drop or keep for fallback). |

## Performance

- Three pixel-loop passes per plant @ 256×256 canvas = ~190K pixels × 3 = ~570K iterations.
- Each iteration: ~20 ops (RGB→HSL→modulate→HSL→RGB).
- Estimate ~10 ms per plant on a modern laptop. Three passes is more work than the existing single-pigment-pass approach (~3 ms), but still acceptable for 12 plants on slider change.
- Live drag: only the selected plant re-renders → 10 ms per drag frame, well within rAF budget.

## Edge cases / failure modes

1. **Anchor outside silhouette.** SDF fill clipped to silhouette → bloom truncated naturally. Fine.
2. **Bloom radius 0 or softness 0.** Smoothstep gives all-or-nothing alpha. No crash. Bloom may be invisible or hard-edged disc.
3. **HSL round-trip on near-neutral colors.** Gray colors have undefined hue; preserve hue from input or default to 0.
4. **Flow noise frequency too high.** Looks like static noise instead of patches. Default `flowFrequency0=0.012` gives ~5 patches across a 256px symbol. Verify visually.
5. **Sobel on color discontinuity at silhouette edge.** The clip means there's a hard transparent→opaque alpha edge. Sobel on the COLOR (not alpha) will read 0 there because both sides are essentially "no color." Compute Sobel only on opaque pixels, or use the colors at the edge correctly. Need to verify in implementation.
6. **Drag goes off-canvas.** Clamp anchor to [0..1].
7. **Re-render storm.** rAF debounce flag, not setTimeout-throttle.
8. **Selection lost on click-empty-space.** Stage-level pointerdown handler sets selection to null; sprite-level pointerdown stops propagation.

## Out of scope

- Multiple positionable blooms per plant (single per plant)
- Per-plant bloom color override (global picker only)
- Animated wind/ripple (passes are static)
- Saving anchor positions to backend
- True Curtis 1997 fluid simulation (Bousseau is the chosen approximation)

## Estimated effort

~70 min focused work:
- 20 min: plumb Bousseau passes + restore HSL helpers + perlin + sobel modules
- 15 min: SDF bloom fill at anchor with FBM perturbation
- 15 min: pointer drag interactivity (globalpointermove, selection state, handle dot)
- 10 min: replace toolbar sliders with β controls
- 10 min: edge case handling (clamping, opaque-only Sobel, rAF debounce, cleanup)

## Open questions for Kimi

1. Is the 3-pass Bousseau order correct (paper → flow → edge darken), or does running edge-darken before flow give a different look? In the reference: paper → flow → edge.

2. The Sobel pass on a clipped silhouette has alpha=0 just outside the polygon. When Sobel samples across that boundary it reads color from outside (background) which is meaningless. Should we mask Sobel input to opaque-pixels-only, or run Sobel before the silhouette clip and propagate properly?

3. Is HSL the right color space here, or should we use HSV (the Bousseau implementation has both, defaults to HSL but offers HSV as commented alternative)? Visual differences for our use case?

4. Performance — is per-pixel HSL conversion 3 times per plant going to bottleneck on slider drag? Should we batch the three textures into one combined map, then do one HSL round-trip with a single composed density value?

5. Have we missed a Bousseau pass? The paper mentions pigment dispersion as a separate effect; the reference repo has a `pigment_dispersion.cpp` that's identical to `turbulent_flow.cpp` (just different parameters). Worth a separate pass with different frequency or bake into one?

6. The bloom fill (step 3) drops in BEFORE the watercolor passes, so the secondary color gets paper grain + flow + edge darkening applied to it. This matches Bousseau's "abstract first, then apply effects" philosophy. Confirm this is the right place in the pipeline.
