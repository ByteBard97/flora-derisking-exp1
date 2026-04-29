# Flora-Studio Canvas Architecture

Patterns extracted from RAPID (Pixi.js v8) study + flora-uxp reference + derisking experiments.
This is the design blueprint for the main canvas before writing production code.

---

## Core Invariants

1. **Pinia is the source of truth.** Pixi is a write-only cache. Never read reactive state back from Pixi objects.
2. **World coordinates are page inches.** Convert to screen pixels only at render time. Never store pixels in the store.
3. **Vue owns the canvas lifecycle.** Vue mounts/unmounts the `<canvas>`, creates the PIXI.Application, and drives prop sync. Pixi knows nothing about Vue.

---

## Scene Graph

```
PIXI.Application.stage
  └── origin: Container          ← pan/zoom transform lives here
        ├── [0] siteAnalysis: Container
        │     ├── aerial: Sprite
        │     ├── parcel: Graphics
        │     ├── buildings: Graphics
        │     ├── topo: Graphics
        │     └── soils: Graphics
        ├── [1] beds: Container
        │     └── BedFeature[]
        ├── [2] hardscape: Container
        ├── [3] groundcover: Container   ← grass, fern, wildflower, groundcover
        ├── [4] understory: Container    ← small_tree, shrub, large_shrub, small_shrub, cycad, vine, edible_herb
        ├── [5] canopy: Container        ← canopy_tree, palm
        ├── [6] annotations: Container
        └── [7] ui: Container            ← lasso rect, selection halos, leader lines
```

**Why `origin` container:**
Stage scale drives zoom (zoom = stage.scale.x). Stage position drives pan. All world-space content
lives under `origin`, which stays at position [0,0] — it's the coordinate anchor. This cleanly
separates viewport math from content layout. Borrowed from RAPID's `PixiScene.js`.

**Plant layer routing by category:**
```
canopy_tree, palm                              → canopy layer
small_tree, large_shrub, small_shrub,
  cycad, vine, edible_herb                    → understory layer
grass, fern, wildflower, groundcover          → groundcover layer
```
The backend does not need to know which layer a plant renders in. The canvas reads `plant.category`
and routes automatically.

---

## Coordinate System

- Origin [0, 0] is the **top-left corner of the page** (matches SVG convention).
- All store positions are in **page inches** (world space).
- Screen pixels = world inches × stage.scale.x + stage.position.
- The backend SVG uses the same coordinate system — positions in the SVG directly correspond to
  world-space inches.
- The user cannot move the origin. It is fixed at the page corner.

**Conversion helpers (live in a shared util, not in components):**
```ts
function worldToScreen(wx, wy, stage) {
  return { x: wx * stage.scale.x + stage.position.x,
           y: wy * stage.scale.y + stage.position.y }
}
function screenToWorld(sx, sy, stage) {
  return { x: (sx - stage.position.x) / stage.scale.x,
           y: (sy - stage.position.y) / stage.scale.y }
}
```

---

## Vue ↔ Pixi Boundary

```
App.vue / CanvasView.vue
  └── <PixiCanvas> (Vue component)
        │  Props in:  plants[], beds[], selectedIds, layerVisibility, ...
        │  Emits out: select(id), dragEnd(id, pos), ready(ttiMs)
        │
        └── PixiRenderer (plain TS class, no Vue)
              ├── init(app) → sets up scene graph
              ├── syncPlants(plants[]) → create/update/destroy PlantFeature objects
              ├── syncBeds(beds[]) → create/update/destroy BedFeature objects
              ├── setSelected(ids: Set<string>)
              ├── setLayerVisible(layer, visible)
              └── destroy()
```

**What Vue owns:**
- Canvas mount/unmount lifecycle
- Pointer event listeners (wheel, keydown, pointerdown/move/up)
- Pan + zoom state machine (space+drag, M3, pinch)
- Lasso drawing (a Graphics child of stage)
- Prop watches that call `renderer.sync*()`

**What Pixi owns:**
- Scene graph
- Feature objects (PlantFeature, BedFeature)
- Texture atlas loading
- LOD decisions
- Hit area geometry

**What neither owns (Pinia):**
- Plant positions, selection state, undo history, layer visibility

---

## Render Loop

Adopt RAPID's custom render loop pattern. Disable Pixi's autoStart; drive rendering from a manual
rAF loop with a 250ms throttle after each draw.

```ts
class PixiRenderer {
  private _dirty = false
  private _throttleUntil = 0

  init(app: Application) {
    app.ticker.autoStart = false
    requestAnimationFrame(this._loop)
  }

  markDirty() { this._dirty = true }

  private _loop = (now: number) => {
    requestAnimationFrame(this._loop)
    if (!this._dirty) return
    if (now < this._throttleUntil) return
    this._dirty = false
    this._app.render()
    this._throttleUntil = now + 250
  }
}
```

**Why throttle:** Rapid pointer events (e.g. fast drag) would otherwise trigger hundreds of Pixi
render calls per second. 250ms throttle means max ~4 redraws/sec during heavy input, with the final
position always rendered when input stops (dirty flag catches it).

**Exception:** For drag feedback, bypass the throttle and render every frame. The throttle is only
for "background" scene changes (style updates, LOD changes, sync).

Actually — reconsider. RAPID's throttle is for *geometry recalculation*, not for the WebGL draw
call itself. We should separate:
- `_geometryDirty` — needs expensive scene rebuild (sync, style, LOD): throttled at 250ms
- `_renderDirty` — needs WebGL draw: runs every frame during drag

---

## Plant Feature

Each plant in the store gets a `PlantFeature` object:

```
PlantFeature
  └── container: Container        ← positioned at (plant.position.x, plant.position.y) in world px
        ├── circle: Graphics      ← colored fill circle, r = plant.radius * WORLD_TO_PX
        ├── sprite: Sprite        ← SVG species sprite, centered
        ├── label: BitmapText     ← ref-designator text (e.g. "QV-3")
        └── labelLeader: Graphics ← leader line (visible only when label is dragged off-plant)
```

**Label as child of plant container:**
The label lives inside the plant container. Its position is relative to the plant. When the user
drags the label, we update `label.position` (local to container). The leader line is redrawn on
every label move.

**Leader line geometry** (from FloraLeaderLineDrawing.cpp):
- Line from: `RayRectExit(labelBounds, labelCenter, circleCenter)` — exits the label rect in the
  direction of the circle center
- Line to: `CircleEdgePoint(circleCenter, radius, labelCenter)` — the point on the circle edge
  nearest the label
- Suppress when: label center is inside the circle OR distance < 2pt
- Arrowhead: filled triangle at circle edge, length = 4 × strokeWidth, half-width = 1 × strokeWidth

**LOD:** (thresholds TBD from measurement, roughly):
- `lod=0` (zoom < 0.05): plant container invisible
- `lod=1` (zoom 0.05–0.15): circle only, no sprite, no label
- `lod=2` (zoom > 0.15): circle + sprite + label

**Event handling:**
- `container.eventMode = 'static'`
- `container.on('pointerdown', ...)` — select + start drag
- Label has its own `eventMode = 'static'` and separate drag handler
- `container.on('pointerdown', e => e.stopPropagation())` — prevents bgGfx deselect

---

## Bed Feature

Each bed gets a `BedFeature`:

```
BedFeature
  └── container: Container
        └── stroke: Graphics      ← bezier path drawn with curveTo
```

**Hit area:** Approximate the bezier curve as a Polygon by sampling ~8 points per segment.
Apply as `container.hitArea = new Polygon(sampledPoints)`. Borrowed from RAPID's `PixiFeatureLine.js`.

---

## Label Collision (Phase 2, after basic rendering works)

Use RBush spatial index over all label bounding boxes. On sync, run a placement pass:
1. For each plant (sorted by priority — canopy first, then understory, then groundcover):
   - Try placing label at default position (right of circle)
   - If collision: try 8 candidate positions around the circle
   - If still colliding: mark label as suppressed (still rendered, just overlapping — RAPID suppresses entirely; our choice TBD)
2. Update `label.position` to the chosen placement

This runs at sync time, not every frame.

---

## Selection + Multi-Select

- Store: `selectedIds: Set<string>` in Pinia
- Selection halo: `Graphics` child in the `ui` layer, drawn around each selected plant's circle
- Lasso: temporary `Graphics` on stage, drawn during drag; on release, check AABB overlap with
  all plant containers → bulk-select matching plants

Multi-select drag:
- Stage-level `pointermove` during drag
- Track `dragStartPositions: Map<id, {x,y}>` at drag-start
- On move: apply delta to all selected plants
- On `pointerup`: emit `dragEnd` for each moved plant with new position

---

## Texture Atlas

Two atlases:
1. **Plant sprites** — pre-rasterized SVGs for each species type (loaded at init, packed by Pixi's
   Assets.addBundle)
2. **UI icons** — tool icons, arrow heads (static spritesheet)

Atlas loading:
```ts
await Assets.addBundle('plants', { quercusVirginia: '/sprites/quercus-virginia.svg', ... })
await Assets.loadBundle('plants')
```

Sprites are keyed by species `common_type` field. Plants with unrecognized species fall back to
a generic circle.

---

## Background (Site Plan SVG)

Loaded as a Pixi Sprite, placed in `siteAnalysis` container at world position [0, 0]:

```ts
const texture = await Assets.load('/site-plan.svg')
const bg = new Sprite(texture)
bg.width = PAGE_WIDTH_PX
bg.height = PAGE_HEIGHT_PX
siteAnalysis.addChildAt(bg, 0)
```

Visibility toggled via `siteAnalysis.visible` or per-layer child visibility.

---

## Export (SVG / PDF)

**Decision: reconstruct from store data. This question is resolved.**

Pixi is a WebGL rasterizer. There is no Pixi→SVG path (the community-cited `graphicsContextToSvg`
is unverified; the Pixi maintainers explicitly do not provide SVG export). Figma, tldraw, Excalidraw,
and Lucidchart all reconstruct from their data model. deck.gl's reply to an SVG export request was
simply "No. WebGL and SVG run on completely different logics." The parallel-DOM approach is
over-engineered; rasterize+PDF is disqualified by the print constraint.

### Architecture

Ship a `packages/plan-svg` module with a single pure function:
```ts
function planToSvg(store: PlanStore, opts: ExportOpts): string
```
Zero Pixi imports, zero DOM, zero `window`. Runs identically in browser and Node.js.

- **Browser**: call `planToSvg()`, trigger Blob download → instant offline SVG
- **Server**: `POST /api/export-pdf` → call same function → pipe through Inkscape CLI → stream PDF

### SVG structure

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="8.5in" height="11in" viewBox="0 0 612 792">

  <!-- absolute units on root: SVG px = 1/96in, Illustrator assumes 72ppi
       using absolute units (in) + matching viewBox in pt eliminates the ambiguity -->

  <defs>
    <!-- one <symbol> per plant species — reused via <use> -->
    <symbol id="sp-quercus-rubra" viewBox="0 0 100 100">...</symbol>
    <style>@font-face { font-family: "TimesNewRoman"; src: url("data:...woff2") }</style>
  </defs>

  <!-- Site analysis layer -->
  <g id="layer-site-analysis" inkscape:groupmode="layer" inkscape:label="Site Analysis">
    <image x="0" y="0" width="..." height="..." href="data:image/jpeg;base64,..." />
    <!-- parcel, topo, buildings as <path> -->
  </g>

  <!-- Plant layers — bottom to top -->
  <g id="layer-groundcover" inkscape:groupmode="layer" inkscape:label="Groundcover">
    <!-- for each plant: -->
    <g id="plant-{id}" transform="translate(x, y)">
      <circle r="..." fill="..." />
      <use href="#sp-quercus-rubra" x="-r" y="-r" width="2r" height="2r" />
      <text ...>QV-3</text>   <!-- or <path d="..."> if outlined -->
      <line ... />             <!-- leader line if label offset -->
    </g>
  </g>

  <g id="layer-understory" inkscape:groupmode="layer" inkscape:label="Understory">...</g>
  <g id="layer-canopy"     inkscape:groupmode="layer" inkscape:label="Canopy">...</g>
  <g id="layer-beds"       inkscape:groupmode="layer" inkscape:label="Beds">...</g>
  <g id="layer-annotations" inkscape:groupmode="layer" inkscape:label="Annotations">...</g>
</svg>
```

Illustrator reads `inkscape:groupmode="layer"` as its own layer system — landscape architects get
a fully layered file ready for post-processing.

### Known failure modes and mitigations

**1. Text (the hard problem)**
Pixi BitmapText is rasterized glyphs baked into a texture atlas. It has no SVG equivalent.
- **Default (print)**: outline text to `<path>` at export time using opentype.js or fontkit.
  Produces glyph vectors — crisp at any scale, works in all Illustrator versions.
- **Optional (editable)**: emit `<text>` with `@font-face` data-URI WOFF2. Warn the user that
  Illustrator may substitute fonts if the machine doesn't have the same font installed.

**2. Stroke alignment**
SVG strokes are always center-aligned. Pixi v8 supports `alignment: 0 | 0.5 | 1` (inner/center/outer).
A 2pt inner stroke on a circle in Pixi produces a circle of the expected size. The same stroke in
SVG centered produces a circle 1pt larger. At 24"×36" this is a real dimensioning error.
- **Mitigation**: at export time, offset the path geometry so a centered SVG stroke is geometrically
  equivalent. For circles: trivial arithmetic (shrink radius by strokeWidth/2). For bezier beds:
  use `paper.js` `offsetPath()` (bezier offsetting is not algebraically closed; needs numerical approx).

**3. Aerial photo**
- Embed as base64 data-URI for portability (self-contained SVG, works offline, Illustrator-compatible)
- Offer a "linked file" option for smaller SVG at the cost of requiring the image to travel with the file
- Downsample to 150ppi on export (24"×36" at 150ppi = 3600×5400px — sufficient for wide-format plotter)

**4. Elements that have no SVG equivalent**
We don't use any of these, so they're not a problem:
- GLSL shaders → would need selective rasterization (not applicable)
- Blend modes beyond normal/multiply → not applicable
- Conic gradients → not applicable

### SVG → PDF

| Option | Quality | Notes |
|--------|---------|-------|
| **Inkscape CLI** (server) | Best | True vector PDF, layer OCGs, Illustrator-compatible. ~500MB container, 1–3s. |
| **jsPDF + svg2pdf.js** (client) | Good | Vector paths and text remain editable in Illustrator if fonts added via `doc.addFont()`. Fails on filters. |
| **PDFKit + svg-to-pdfkit** (server) | Good | Only library with RGB→CMYK mapping. Better for commercial print. |
| **Puppeteer `page.pdf()`** (server) | Avoid | Rasterizes WebGL canvas. If fed the generated SVG as HTML, works but font embedding is unreliable. |
| **resvg-js** (server) | PNG only | Fast previews only, not vector PDF. |

**Recommended**: jsPDF + svg2pdf.js for client-side (instant, no backend round-trip). Inkscape CLI
for high-quality PDF when the user explicitly requests it (or for server-side batch export).

### Illustrator compatibility rules

- Use **presentation attributes**, not CSS classes — Illustrator silently drops `class=` styles on import
- Include both `xmlns` and `xmlns:xlink` — Illustrator's `textPath` still needs `xlink:href`
- Absolute units on `<svg>` root (`width="8.5in"`) — eliminates the 96ppi vs 72ppi Illustrator ambiguity
- Embed raster images as base64 data-URIs for self-contained files
- For final print SVG: expand any `<use>` tags that reference external URLs (keep local defs fine)
- Group layer metadata: `inkscape:groupmode="layer" inkscape:label="Plants - Canopy"` → Illustrator reads `id` as layer name

---

## Pan/Zoom State Machine

Handled in `PixiCanvas.vue` (Vue layer), not in PixiRenderer:

| Input | Action |
|-------|--------|
| Space + pointer drag | Pan (space-pan) |
| Middle mouse drag | Pan (M3-pan) |
| Trackpad pinch (ctrlKey + wheel) | Zoom to pointer |
| Scroll wheel | Zoom to pointer |
| Two-finger scroll | Pan |

Pan: update `stage.position`.
Zoom: update `stage.scale`, adjust `stage.position` to zoom toward pointer.

No CSS transform trick needed at our scale (RAPID uses it for maps with infinite scroll; our canvas
has a fixed 8.5"×11" page).

---

## Key Differences from RAPID

| RAPID | Flora-Studio |
|-------|--------------|
| Vanilla JS | Vue 3 + TypeScript |
| Map (infinite world) | Fixed page (letter/A4) |
| ~8 feature types (node, way, relation, etc.) | ~3 feature types (plant, bed, annotation) |
| Geometry is fetched tile-by-tile | Geometry is loaded at session start |
| Labels must handle 20+ placement positions | Labels have drag-to-position (explicit placement) |
| Culls features outside viewport | Plants always on-screen (small page) |
| OSM data model | Flora store (Pinia) |
| Rotation support in scene graph | No rotation (axis-aligned page) |
| CSS transform trick for pan jank | Not needed — fixed page, no jank |
| Destroy features after 20 off-screen frames | Keep all features alive (small count, always visible) |

---

## NPR Rendering Integration (Resolved 2026-04-29)

All questions from Track 4 answered by the derisking experiments. Recording decisions here.

### Does NPR affect layer architecture?

**Answer: No for structure; yes for filter attachment.**

The layer hierarchy (siteAnalysis → beds → groundcover → understory → canopy → annotations → ui)
is unchanged. NPR is a rendering *mode* applied on top of the existing structure, not a parallel hierarchy.

**Filter attachment strategy (proven in TabNPRRenderer):**

| Filter | Applied to | Why |
|--------|-----------|-----|
| `WatercolorWashFilter` | each layer Container | wash blends across all plants in the layer together |
| `CrosshatchFilter` | each layer Container | world-stable hatching must tile continuously across the layer |
| `WobbleFilter` | background SVG Sprite | wobbles the site plan diagram |
| `WobblyCircleFilter` | each `PlantFeature.container` | per-plant: each circle needs its own random wobble seed |
| `RisographFilter` | each layer Container | posterize + halftone applied to the layer as a whole |

Filter chains are set once at NPR mode change, not per-frame. The `CrosshatchFilter`'s
`uWorldMatrix` uniform must be updated every frame in the ticker (see followup-C research doc).

**Why container-level, not stage-level?**
Applying one filter to the whole stage would flatten everything into one pass. Container-level
lets each layer retain independent alpha compositing — canopy plants composite over understory
correctly before the NPR pass.

**`RenderLayer`:** Pixi v8's `RenderLayer` API is for advanced compositing (e.g., separate depth
buffers). We don't need it. Standard `Container.filters = [...]` is sufficient.

### NPR rendering modes

Three modes proven in `TabNPRRenderer`:

| Mode | Active filters | Notes |
|------|---------------|-------|
| `technical` | none (clean vector) | default canvas mode |
| `watercolor` | WatercolorWashFilter per layer + WobblyCircleFilter per plant | `uSeed` set per-plant for variety |
| `sketch` | CrosshatchFilter per layer + uWorldMatrix ticker update | species-specific presets per plant |
| `risograph` | RisographFilter per layer | per-layer color variant |

Mode is stored in Pinia: `canvasStore.nprMode: 'technical' | 'watercolor' | 'sketch' | 'risograph'`.
On mode change: `PixiRenderer.setNPRMode(mode)` swaps filter arrays on each layer container.

The `WobbleFilter` (background SVG wobble) is controlled by a separate boolean: `canvasStore.wobbleBackground`.

### Data model additions required

**Plant** (additions to existing backend model):

```ts
interface Plant {
  // ... existing backend fields ...
  
  // Canvas-only, not persisted to backend:
  labelOffset?: { x: number; y: number }  // world inches, relative to plant center
                                           // null = default position (right of circle)
}
```

`growthFactor` is **not** in the data model — it's a per-session animation state managed
entirely by `PlantFeature`. It starts at 0 on session load and ramps to 1 via the critically-damped
spring shader. On reload it starts at 0 again (growth plays on every session start — it's an effect,
not persistent state).

**Bed** (additions to existing backend model):

```ts
interface Bed {
  // ... existing backend fields (path: BezierPath, materialType: string, ...) ...
  
  // fillStyle and strokeStyle are canvas rendering params, backend-agnostic:
  fillStyle?:   'solid' | 'hatched' | 'empty'   // default: 'solid'
  fillColor?:   string                            // hex, default from materialType lookup
  strokeColor?: string
  strokeWeight?: number                           // world inches
}
```

NPR style params (kernel size, wetness, crosshatch angle) are **not** per-bed or per-plant. They
are global canvas settings in `canvasStore.nprParams`. Annie adjusts them once for the whole design,
not per-plant.

### How layers map to Pixi v8 `RenderLayer`

**They don't.** Standard named `Container` children of `origin` are all we need. The Pixi v8
`RenderLayer` API is for render ordering tricks and advanced compositing that doesn't apply to a
fixed-page CAD tool. The named containers (groundcover, understory, canopy, etc.) are exactly what
Pixi's normal scene graph is designed for.

---

## Open Questions (Pre-Build Blockers)

1. ~~**Label drag conflict**~~ — **Resolved 2026-04-22.** Label as child of plant container
   works cleanly: `e.stopPropagation()` in the label's `pointerdown` prevents the plant's drag
   from firing; `viewport.plugins.pause('drag')` prevents pixi-viewport panning. Verified in
   `pixi-features/src/tabs/TabLeaderLine.vue`.

2. **MSDF text at zoom**: BitmapText looks soft at 5-10× zoom. Decision: is soft text acceptable,
   or do we need MSDF font atlas generation? The export answer (outline text to paths) is separate
   from this — export uses opentype.js regardless of what the canvas renders. → Spike needed (TODO #5).

3. **LOD thresholds**: exact zoom values for lod=0/1/2 to be determined from measurement at 300
   plants. Guess: lod=0 < 0.05, lod=1 < 0.12, lod=2 ≥ 0.12.

4. **Bed stroke alignment at export**: bezier offsetting with paper.js needs to be tested against
   real bed shapes. If paper.js offsetPath() introduces artifacts on tight curves, fall back to
   center-aligned stroke (accept the 1pt dimension error) or double-width + clip mask.

5. **AnisotropicKuwahara multi-pass filter**: `TabKuwahara.vue` is currently disabled with a
   "multi-pass cross-context program bug". Likely cause: `GlProgram.from({ vertex, fragment })` with
   the same source is cached; two `Filter` instances sharing the same `GlProgram` object may conflict
   when `filterManager.applyFilter()` is called on each separately. Workaround to investigate:
   (a) use unique program source per filter (append a comment), or
   (b) lazy-initialize the inner filters inside `apply()` rather than in the constructor, so they
   compile fresh against the renderer that's actually calling `apply()`.
   This is a nice-to-have (watercolor pass in TabNPRRenderer already provides a simpler painterly
   effect). Investigate after production baseline is working.

## Resolved Questions

- **Export architecture**: reconstruct-from-store with `planToSvg(store): string`. Settled.
  Figma, tldraw, Excalidraw all use this. WebGL inversion is not viable. (April 2026)
- **Coordinate system origin**: fixed at page top-left, matches SVG convention. User cannot move it.
- **Plant layer routing**: by `category` field, canvas-only concern, backend-agnostic.
- **Pan/zoom**: `pixi-viewport` library with `drag() + wheel() + decelerate() + pinch()`.
  Momentum-based panning, industry-standard feel, already used across the derisking-experiments
  (`TabViewport`, `TabLeaderLine`).
- **Label drag architecture**: labels are children of plant containers with independent
  `eventMode='static'` and `stopPropagation()` on pointerdown. (April 2026)
- **Fonts**: MSDF BitmapText, atlases generated at build time with AssetPack's `msdfFont()` pipe.
  See `/Users/ceres/Desktop/flora/flora-studio/docs/fonts-and-text.md`.
