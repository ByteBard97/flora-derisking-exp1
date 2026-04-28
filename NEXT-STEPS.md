# Flora Derisking — Next Steps

Last updated: 2026-04-28

---

## Status

The individual feature spikes are mostly proven in `pixi-features/`. The remaining work falls into four tracks:

1. **Testing** — verify every existing tab properly before building on top of them
2. **Research** — NPR shader research complete; follow-up prompts identified below
3. **Build** — new spike tabs for NPR rendering (can start now)
4. **Architecture** — unified canvas planning (after NPR spikes + testing done)

---

## Track 1: Complete Feature Testing

Every tab in `pixi-features/` needs to be gone through with a fine-toothed comb before we commit to the production architecture. "It loads" is not the same as "it works correctly."

**Not yet visually verified at all:**
- Marching Ants
- Viewport
- Transform Gizmo
- Spatial Index
- @pixi/ui

**Verified loading but need deeper testing:**
- Plant Renderer — 300 plants, leader lines, multi-select drag, LOD thresholds
- Pen Tool — add/delete vertices, close path, all anchor types, zoom behavior
- Freehand — auto-smooth quality: does the green bezier overlay look Illustrator-quality?
- Knife Tool — split algorithm edge cases (same segment, near endpoints, closed paths)
- Measure Tool — area math accuracy, arc length on curved beds, scale conversion
- Text Annotation — positioning correct after zoom/pan, drag stability
- Boolean Ops — edge cases on complex overlapping shapes
- Selection — group drag, lasso precision, shift+click toggle
- Snapping — vertex/edge snap at different zoom levels

**Freehand quality specifically** — draw a messy S-curve and a rough bed boundary, release, and assess whether the auto-smoothed bezier looks Illustrator-quality. Tune `fitError` in `pathFit.ts` if needed (currently 4).

---

## Track 2: NPR Shader Research ✅ ALL PASSES COMPLETE

### What we can build now (working code in hand)

#### Watercolor preset
**Source files:** `watercolor-glsl-shaders.md`, `watercolor-shader-impl-guide.md`

- **WatercolorWashFilter** (~90 lines, working): Radial SDF + 5-octave FBM pigment granulation + FBM-perturbed dark drying edge (`smoothstep(0.78, 0.99, r)`) + paper grain. `uWetness` drives all effects. Use doc `watercolor-glsl-shaders.md`.
- **WobblyCircleFilter** (~70 lines, working): FBM-perturbed SDF circle. Noise sampled on `(cos(ang), sin(ang)) * uNoiseScale` for seamless wrap. `uFillMode` switches disc vs outline ring. Set `uSeed = perPlantRandom` so adjacent plants differ.
- **AnisotropicKuwahara** (3-pass, working): Pass 1 (Sobel → structure tensor `vec4(Jxx,Jyy,Jxy,1)`), Pass 2 (BlurFilter), Pass 3 (8-sector polynomial). Wiring: `uTensorTex: tensorRT.source` as a second sampler resource.
- **Filter chain order:** Kuwahara → WatercolorWash → ProceduralWatercolor at `uIntensity ≈ 0.10–0.20`. Wobbly outline is a **separate display object** (not in the chain — it extends beyond sprite bounds).
- **Critical Pixi v8 rules:** Do NOT write `#version 300 es` (auto-injected). Do NOT redeclare `uTexture` in resources. Uniform block name in GLSL must exactly match JS `resources` key. Samplers must be top-level, not inside a block.

#### Colored pencil preset
**Source files:** `npr-colored-pencil-glsl.md`, `webgl-hatching-wobble.md`

- **World-stable crosshatch** (~100 lines, working): Recover world coords in shader:
  ```glsl
  vec2 screenPx = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
  vec2 worldP   = (uWorldMatrix * vec3(screenPx, 1.0)).xy;
  ```
  JS: `viewport.worldTransform.clone().invert()` packed into `mat3` uniform. Update every frame in ticker.
- **Wobble filter** (~90 lines, working): feTurbulence → GLSL port using Ashima simplex noise (MIT, inline from `webgl-noise`). For colored-pencil: `uBaseFrequency=0.02`, `uScale=2.0–4.0`, `uNumOctaves=2`, `uType=1` (turbulence mode).
- **Species presets** (use as shader uniforms):
  - Fine Grass: `scale=3.0, angle=90°, jitter=0.1, mode=parallel`
  - Broadleaf Shrub: `scale=0.8, angle=45°, jitter=0.7, mode=crosshatch`
  - Groundcover: `mode=stipple`
  - Paving/Hardscape: `scale=0.5, angle=0°, jitter=0.2, mode=grid`
- **Do NOT use** `mattdesl/glsl-crosshatch-filter` — GLSL ES 1.0, shower-door effect, `== 0.0` aliasing bug. Broken.
- Set `filter.padding ≈ uLineSpacing` to avoid edge clipping.
- Must use `out vec4 finalColor`, not `gl_FragColor` (issue #11441).
- UniformGroup types must be WGSL strings: `'f32'`, `'vec2<f32>'`, `'mat3x3<f32>'`.

#### Wind sway + growth animation
**Source files:** `gpu-instanced-wind-sway.md`

- **Complete `PlantField` TypeScript class** (~250 lines) — instanced `Geometry` with `{ buffer, instance: true }` attributes, `addPlant()`, swap-remove `removePlant()`, `grow()` for capacity doubling.
- **Critically damped growth** (copy-paste ready):
  ```glsl
  float criticallyDamped(float age, float omega, float cutoff) {
      if (age <= 0.0) return 0.0;
      float ot = omega * age;
      if (ot > cutoff) return 1.0;
      return 1.0 - (1.0 + ot) * exp(-ot);
  }
  ```
  `omega=6` → ~0.9s to 98% grown.
- **Wind**: two-frequency sway (prime-ish ratio ×1.731, ×1.317). `edgeMask = smoothstep(0, 1, length(aPosition))` anchors centre.
- **12 critical gotchas:**
  - Use base `Geometry` not `MeshGeometry` for custom attributes
  - `buffer.update(byteLength)` arg is BYTES not elements
  - `mat3` uniform crashes WebGPU on v8 (issue #10553) — avoid or guard
  - `instanceCount=0` bug fixed in Pixi 8.7+ — guard with `mesh.visible = count > 0` on older
  - `ParticleContainer` cannot hold custom attributes
  - Write into existing array for vector uniforms: `u.uWindVector[0] = vx` (replacing array reference may not propagate dirtiness)

---

## Track 2b: Follow-up Research Prompts Still Needed

Three specific gaps remain after all research passes. These are cheap — fire them off.

### Follow-up A: `drawTreeSymbol()` TypeScript implementation
**Gap:** The landscape tree symbol research (doc `landscape-tree-symbol.md`) had **zero runnable code**. We need the TypeScript function to draw plan-view tree symbols with Pixi `Graphics`.

**Context file to give agent:** `landscape-tree-symbol.md`

**Prompt:**
> I need a complete TypeScript function using Pixi.js v8 `Graphics` API that draws a traditional landscape architecture plan-view tree symbol — the kind seen in watercolor landscape plans (Supa Chan style) and colored pencil sketch plans (Nick Robinson Planting Design Handbook style).
>
> Write the complete function:
> ```typescript
> function drawTreeSymbol(
>   gfx: Graphics,
>   x: number, y: number,
>   radius: number,
>   color: number,        // hex species color
>   style: 'watercolor' | 'sketch' | 'technical'
> ): void
> ```
>
> For each style, the function should draw:
>
> **watercolor:** soft filled circle (alpha ~0.6), 8 radial spoke lines from center to edge (slightly varying length, ±10% random using a seed), small shadow circle offset southeast, no hard outline
>
> **sketch:** unfilled circle outline (wobbly, drawn as 60-point polygon with ±3px noise on radius), 6 bold spoke lines to 80% of radius, small trunk dot at center
>
> **technical:** clean circle outline, 8 uniform spokes to full radius, centered trunk dot
>
> Use Pixi v8 `Graphics` API: `.circle()`, `.fill()`, `.stroke()`, `.moveTo()`, `.lineTo()`. Show the complete function body including the spoke loop, shadow circle, and the seeded random for spoke length variation.
>
> Also show how to call it for 4 different species (oak, azalea, magnolia, fern) with their species colors.

### Follow-up B: Pixi v8 multi-pass filter orchestration
**Gap:** The Kuwahara watercolor requires 3 passes through RenderTextures. No code was provided for orchestrating this in Pixi v8. Specifically: how to override `apply()` on a custom `Filter` to run multiple passes.

**Context file to give agent:** `watercolor-glsl-shaders.md`

**Prompt:**
> I am implementing a 3-pass Anisotropic Kuwahara filter in Pixi.js v8. I have the GLSL for each pass (attached research). What I'm missing is the TypeScript orchestration.
>
> Show a complete TypeScript class `AnisotropicKuwaharaFilter extends Filter` that:
> 1. Overrides `apply(filterManager, input, output, clearMode)` to run 3 passes manually
> 2. Pass 1: renders `input → tensorRT` using `GlProgram` with the Sobel structure tensor shader
> 3. Pass 2: blurs `tensorRT → blurredTensorRT` using Pixi's built-in `BlurFilter`  
> 4. Pass 3: renders `input → output` using the Kuwahara shader, with `tensorRT` bound as a second sampler (`uTensorTex`)
>
> Show: how to create and reuse `RenderTexture` instances, how to bind a second sampler in resources, how to call `filterManager.applyFilter()` vs `renderer.render()` for intermediate passes, and how to release the RenderTextures.
>
> Use Pixi v8 API only (`Filter`, `FilterSystem`, `RenderTexture`, `GlProgram`).

### Follow-up C: `uWorldMatrix` per-frame update in a Pixi viewport
**Gap:** The crosshatch shader needs `uWorldMatrix` updated every frame as the camera pans/zooms. Doc #1 showed how to construct it once but not how to wire it into the Pixi ticker.

**Context file to give agent:** `npr-colored-pencil-glsl.md`

**Prompt:**
> I have a Pixi.js v8 application using `pixi-viewport` for pan/zoom. I am implementing a world-space-stable crosshatch filter where the GLSL recovers world coordinates using:
> ```glsl
> vec2 screenPx = vTextureCoord * uInputSize.xy + uOutputFrame.xy;
> vec2 worldP   = (uWorldMatrix * vec3(screenPx, 1.0)).xy;
> ```
>
> The attached research shows how to build `uWorldMatrix` once:
> `viewport.worldTransform.clone().invert()` packed into a `mat3x3<f32>` uniform resource.
>
> What I need:
> 1. Where in the Pixi ticker do I update this uniform? Before or after `app.ticker` renders?
> 2. Does `pixi-viewport`'s transform update synchronously in the ticker, or is there a race condition?
> 3. Show the complete ticker callback that reads the viewport transform and writes it to the filter uniform every frame, for a filter applied to a Container of 300 plant sprites.
> 4. Is there a more efficient approach — e.g. can the shader read the stage transform directly without a custom uniform?
>
> Use Pixi v8 API + pixi-viewport v6.

---

## Track 3: NPR Spike Tabs (ready to build once follow-ups land)

### TabWatercolor
**What to build:**
- Procedural tree symbol: wobbly circle outline (WobblyCircleFilter or drawn as Graphics polygon) + radial spokes (Graphics) + shadow circle offset SE + FBM wash fill (WatercolorWashFilter) + paper grain overlay (global filter on stage)
- Load a real plant SVG from `flora-firefly/plant-prompts/uploaded-svgs-json/` as comparison
- 4–5 species with different species colors
- Warm cream paper background
- Side-by-side: botanical SVG approach vs procedural watercolor symbol
- **Key decision after this spike:** botanical SVGs or procedural circles?

### TabSketch
**What to build:**
- World-stable crosshatch fill inside circles (species color)
- Wobbly ink outline on circles and beds
- Per-species preset toggle (fine grass / broadleaf / groundcover)
- Warm white background

### TabNPRPresets
**What to build:**
- Single canvas with 10–20 plants + 2–3 beds
- Toggle between: Watercolor / Colored Pencil / Technical
- Annie judges which one she wants as default

---

## Track 4: Architecture Planning (after testing + NPR spikes)

**Current state:** Each tab is its own isolated Pixi `Application`. Real app needs one canvas.

**Architecture direction:**
- Rapid's four-tier: `PixiRenderer` → `PixiScene` → `PixiLayer*` → `PixiFeature*`
- One `Application`, one `origin` Container, named layers, mode/behavior system
- Data model completely separate from Pixi — Pixi is the view only

**Open questions:**
1. Does the NPR rendering system affect layer architecture? (Filters applied at layer level, not per-object)
2. Data model for "plant": position, species, growth factor, label offset, layer assignment
3. Data model for "bed": bezier path, fill style, material type, NPR style params
4. How do layers map to Pixi v8's `RenderLayer`?

**When to start:** after TabWatercolor + TabSketch are done and Annie has reacted.

---

## Decisions Still Open

| Decision | Blocking | What we need |
|---|---|---|
| Botanical SVGs or procedural circles in watercolor mode? | TabWatercolor spike | Annie's reaction |
| Fork `@pixi-essentials/transformer` to v8 or rebuild? | Production architecture | 2–4 weeks either way |
| Fork `@pixi-essentials/svg` to v8 or parallel Canvas2D? | SVG basemap rendering | Depends on real basemap content |
| Style preset: shader-based or separate render paths? | TabNPRPresets spike | See what's feasible |

---

## Files to Reference

| File | Purpose |
|---|---|
| `derisking-experiments/RISK-REGISTER.md` | Illustrator feature proof status |
| `derisking-experiments/ARCHITECTURE.md` | Scene graph + coordinate system |
| `flora-studio/docs/landscape-cad-synthesized-report.md` | Full library survey |
| `flora-studio/docs/svg-pdf-export-architecture.md` | SVG/PDF export — closed |
| `flora-studio/docs/research/watercolor-glsl-shaders.md` | **PRIMARY** watercolor shaders (working code) |
| `flora-studio/docs/research/watercolor-shader-impl-guide.md` | Watercolor supplement (check for Kuwahara bug) |
| `flora-studio/docs/research/npr-colored-pencil-glsl.md` | **PRIMARY** crosshatch + wobble shaders (working code) |
| `flora-studio/docs/research/gpu-instanced-wind-sway.md` | **PRIMARY** PlantField class + wind/growth shaders |
| `flora-studio/docs/research/landscape-tree-symbol.md` | Tree symbol context (no code — see Follow-up A) |
| `flora-studio/docs/research/followup-research-prompts.md` | Original follow-up prompts (see Track 2b above for revised versions) |
| `derisking-experiments/annie-reviews/flora-story-for-notebooklm.md` | Annie narrative |
