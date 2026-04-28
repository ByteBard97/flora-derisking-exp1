# Flora Derisking — Next Steps

Last updated: 2026-04-28

---

## Status

The individual feature spikes are mostly proven in `pixi-features/`. The remaining work falls into three tracks that must happen in roughly this order:

1. **Testing** — verify every existing tab properly before building on top of them
2. **Research** — NPR shader research passes in flight; wait for all results before building
3. **Build** — new spike tabs for NPR rendering + architecture planning for the unified canvas

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

**Freehand quality specifically** — this is the most important one to judge. Draw a messy S-curve and a rough bed boundary, release, and assess whether the auto-smoothed bezier looks like what Illustrator's pencil tool would produce. Tune `fitError` in `pathFit.ts` if needed (currently 4 — lower = tighter fit, higher = smoother/looser).

---

## Track 2: NPR Shader Research (in flight — do not build until all results are back)

Four research passes running in parallel. Wait for all four before starting any implementation.

### Research pass 1 — Watercolor & wet media ✅ COMPLETE
**File:** `flora-studio/docs/research/webgl-npr-watercolor.md`
**Key findings:**
- `markknol/wlGXRV` ShaderToy: 60 lines, sine/cosine UV iteration, no external textures — easiest starting point
- `gracelgilbert/watercolor-stylization`: 800+ lines, requires depth map + ID textures — too complex for 2D Pixi, skip it
- **Working Pixi v8 `Filter.from()` GLSL ES 3.0 code example** provided (uv perturbation + paper grain + color output)
- Anisotropic Kuwahara filter: 300 lines, no external textures, makes strokes follow edges
- Radial gradient fill: `float d = length(uv - 0.5)` + FBM noise modulation
- Wet edge fringe: SDF + power function on edge pixels
- Procedural paper grain: Simplex noise, 2-3 octaves, granulation formula: `pigment * (1.0 - granulation * paper_height)`
- Wash fills: object-space FBM for spatial coherence during pan/zoom + `blendMode = MULTIPLY`
- Expanded ShaderToy table: 8 IDs, most built-in only (no iChannel dependency)
- Three-step implementation order: SDF boundaries → FBM wash fills → global paper granulation
- `gracelgilbert` confirmed unusable for 2D Pixi (needs depth buffers + ID textures)
**No follow-up needed for this pass.**

### Research pass 2 — Sketch / pencil / crosshatch / ink NPR ✅ COMPLETE
**File:** `flora-studio/docs/research/npr-sketch-hatch-ink.md`
**Key findings:**
- Roberts Cross kernel for edge detection (4 samples, fastest, best for plan view)
- World-stable UV domain warping for hand-drawn wobble — critical: use world-space coordinates as noise input so lines don't crawl during pan/zoom
- Praun et al. (2001) Tonal Art Maps — 6 tone levels packed in 2 texture units, interpolate based on luminance. Per-species: fine grasses = high frequency parallel, coarse leaves = bold crosshatch
- Deterministic randomness: seeds tied to object IDs not frame time — each oak always has the same wobble. Essential for CAD stability.
- Full multi-pass pipeline: Scene → Shading/Hatch → Edge Detection → Displacement/Jitter → Paper Composite
- Stippling via Jump Flood Algorithm for ground covers (gravel, mulch)
- Specific GitHub Gists and URLs for Roberts Cross and depth-lerp stroke width
**No follow-up needed for this pass.**

### Research pass 3 — Organic animation (wind, growth, sway) ✅ COMPLETE
**File:** `flora-studio/docs/research/organic-plant-animation.md`
**Key findings:**
- Per-instance phase offset solved: store `aPhase` as vertex attribute in `MeshGeometry`, uploaded once to GPU, zero per-frame CPU cost
- 2D top-down wind: distance-from-center mask — edges sway, center stays fixed. Actual GLSL provided.
- Multi-layer wind: prime-numbered frequencies (0.2, 0.5, 1.2 Hz) to prevent mechanical repeating patterns
- Hash-based noise for gusts — no texture lookup overhead at 300+ instances
- Critically damped harmonic oscillator for growth "sprout" animation — URL: devslovecoffee.com/blog/spring-animation-with-glsl-shader
- MeshGeometry attribute layout: `aPosition`, `aUV`, `aBirthTime`, `aPhase`, `aMatureSize`
- GPU instancing via Pixi v8 Mesh system — 1 draw call per species
- Seasonal LUT: 1D texture, species hue as Y coord, season progress as X
- Dual-noise UV displacement for leaf rustling (nekotoarts.github.io)
- Specific Pixi v8 `Shader.from()` + `resources` code example provided
**One gap remaining:** exact TypeScript for marking attributes per-instance vs per-vertex in Pixi v8 MeshGeometry. Solvable at build time from Pixi source.
**No follow-up needed for this pass.**

### Research pass 4 — WebGL/browser NPR implementations
**Looking for:** Working code in the browser today — ShaderToy IDs with actual GLSL, Three.js post-processing ports, existing Pixi v8 filter packages, npm. Ends with a ranked top-5 list.

### Known gaps to address after research returns
These topics were shallow in the first research pass and will likely need follow-up:

- **`gracelgilbert/watercolor-stylization`** (GitHub) — cited in research pass 4 but not examined in depth. Need to know: is it real-time, what does the GLSL actually do, is it portable to Pixi v8?
- **Per-instance vertex shader in Pixi v8** — how to give each of 300 plant sprites a unique wind phase without per-frame CPU work. Pixi v8's internal sprite vertex shader may not be easily overridden.
- **World-space-stable crosshatch** — crosshatch lines must not crawl or swim during pan/zoom. Need a specific implementation that anchors to world coordinates.

---

## Track 3: NPR Spike Tabs (blocked on research)

Once research is back, build these new tabs in `pixi-features/`:

### TabWatercolor
**Goal:** Prove the watercolor plan symbol aesthetic works in Pixi.

What to build:
- Load a real plant SVG from `flora-firefly/plant-prompts/uploaded-svgs-json/`
- Render it with: radial spoke lines from center (Graphics), FBM watercolor wash fill (custom Filter), soft edge bleed, paper grain overlay
- Show species color variation across 4–5 different species
- Show the same plants two ways: current (botanical sprite + circle) vs watercolor symbol

**Annie's reference aesthetic** (images saved in session):
- Simple colored circles, watercolor wash fill, not flat
- Radial ink spokes from center (classic plan-view tree symbol)
- Soft drop shadow
- Loose slightly-wobbly circle outline
- Warm white paper background

**Key decision after this spike:** does the watercolor filter approach make the botanical SVGs look good, OR do we render plant circles procedurally (no SVGs at all)? Annie's references use no botanical illustration — just colored wash circles.

### TabSketch
**Goal:** Prove the colored-pencil plan aesthetic works.

Annie's colored pencil reference (her own Illustrator designs):
- Diagonal crosshatch hatching inside circles, in the species color
- Slightly wobbly ink outlines on beds and paths (not mechanical bezier)
- Warm white background

What to build:
- Circles with procedural crosshatch fill (world-space-stable)
- Jitter/wobble shader on the bed path outlines
- Compare: current Plant Renderer vs sketch mode

### TabNPRPresets
**Goal:** Wire 3 styles into a toggle so Annie can switch between them on the same data.

Proposed presets:
1. **Watercolor** — wash circles, soft fills, paper grain (client presentation mode)
2. **Colored Pencil** — hatched circles, sketchy outlines (Annie's working mode)
3. **Technical** — current clean vector rendering (contractor/export mode)

---

## Track 4: Architecture Planning (after tabs are tested + NPR spikes done)

The biggest open question: how do all the individual features coexist on one canvas with a shared mode/behavior system?

**Current state:** Each tab is its own isolated Pixi `Application`. The real app needs one canvas.

**Architecture direction** (from `ARCHITECTURE.md` and research):
- Rapid's four-tier pattern: `PixiRenderer` → `PixiScene` → `PixiLayer*` → `PixiFeature*`
- One `Application`, one `origin` Container for all world content
- Named layers (site reference, beds, plants, annotations, UI)
- Mode/behavior system: pen tool, selection, measurement, snapping become *modes* not separate canvases
- Data model completely separate from Pixi scene graph — Pixi is the view only

**Open questions to answer before writing architecture code:**
1. Which features from the individual tabs are truly "ready" vs need more work first?
2. Does the NPR rendering system affect the architecture? (Filters applied at layer level, not per-object)
3. What is the data model for a "plant" in the unified canvas? (position, species, growth factor, label offset, layer assignment)
4. What is the data model for a "bed"? (bezier path, fill style, material type, area calculation)
5. How do layers map to Pixi v8's `RenderLayer`?

**When to start architecture planning:** after TabWatercolor and TabSketch spikes are done and Annie has reacted to them. The visual rendering decision (watercolor vs technical) affects the architecture slightly (filter grouping, layer structure).

---

## Decisions Still Open

| Decision | Blocking | What we need |
|---|---|---|
| Use botanical SVGs or procedural circles in watercolor mode? | TabWatercolor spike | Annie's reaction to the demo |
| Per-instance wind phase offset in Pixi v8 | Research pass 3 result | Vertex shader specifics |
| Fork `@pixi-essentials/transformer` to v8 or clean-room rebuild? | Production architecture | 2–4 weeks either way |
| Fork `@pixi-essentials/svg` to v8 or use parallel Canvas2D overlay? | SVG basemap rendering | Depends on what real basemaps contain |
| Style preset system: shader-based or separate render paths? | TabNPRPresets spike | See what's feasible in GLSL |

---

## Files to Reference

| File | Purpose |
|---|---|
| `derisking-experiments/RISK-REGISTER.md` | What's proven vs open for each Illustrator feature |
| `derisking-experiments/ARCHITECTURE.md` | Planned scene graph and coordinate system |
| `flora-studio/docs/landscape-cad-synthesized-report.md` | Full library/reference survey |
| `flora-studio/docs/svg-pdf-export-architecture.md` | SVG/PDF export — decided and closed |
| `flora-studio/docs/research/webgl-npr-shader-research.md` | First NPR research pass results |
| `flora-studio/docs/research/npr-research-prompts.md` | All four research prompts + alternate prompt 1 |
| `derisking-experiments/annie-reviews/flora-story-for-notebooklm.md` | Annie narrative for context |
