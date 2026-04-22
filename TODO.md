# Flora Studio — Pixi.js Derisking TODO

Proving out Pixi.js v8 as the rendering foundation for flora-studio before writing production code.
Reference implementations: RAPID (`/Rapid/modules/pixi/`) and flora-uxp (`/flora-uxp/`).

---

## Already Proven

- [x] Plant rendering — circle + SVG sprite + BitmapText label
- [x] Bezier bed rendering
- [x] Background SVG (site plan)
- [x] Pan — Space+drag, M3 press-drag
- [x] Zoom — trackpad pinch, scroll wheel, sensitivity sliders
- [x] Click-to-select plant
- [x] Drag-to-move plant (single)
- [x] Lasso box selection
- [x] Frame time performance graph
- [x] RAPID runs on Pixi.js v8 WebGL2 — confirms production viability

---

## High Risk — Must Spike Before Building

These are genuinely unknown or technically hard. Each needs a focused spike.

### 1. Draggable label + leader line ✅ SPIKED
**Resolved 2026-04-22** in `pixi-features/src/tabs/TabLeaderLine.vue`.

- Label lives as a child of the plant container, with `eventMode = 'static'` and its own drag handlers
- `e.stopPropagation()` in the label's `pointerdown` prevents the plant container's drag from starting
- `viewport.plugins.pause('drag')` during label drag prevents pixi-viewport from panning
- Leader line geometry (`rayRectExit`, `circleEdgePoint`) ported verbatim from `FloraLeaderLineDrawing.cpp`
- Verified: dragging the label moves only the label; dragging the plant moves both (label is a child)
- Arrowhead factors (4× / 1×) are tuned for print; on screen we bumped to 10× / 3× for visibility — flag this when productionizing so we can pick print vs screen factors contextually

### 2. LOD (Level of Detail)
Show different representations at different zoom levels. Plants at very low zoom should just be colored dots — rendering full SVG sprites for hundreds of off-screen plants is wasteful.
- RAPID pattern (`PixiFeatureLine.js`, `PixiFeaturePoint.js`):
  - lod=0: invisible / culled
  - lod=1: simplified (no texture, just colored circle)
  - lod=2: full detail (circle + sprite + label)
- Our thresholds TBD (look at flora-uxp's LOD logic as reference)
- Also: RAPID destroys feature display objects after 20 frames of not being visible — we should consider this for large plant counts

### 3. Bed fill / auto-scatter
Place plants inside a bed automatically in a natural scatter pattern, respecting a user-defined species mix (e.g. 60% Live Oak / 40% Muhly Grass).
- Input: bed shape + species mix percentages + plant spacing
- Output: real plant entities written to the store (same as manually placed plants)
- Algorithm: Poisson disk sampling inside the bed polygon is the standard approach — produces natural-looking spacing without grid artifacts
- Open questions: how to handle irregular bed shapes (ray-cast containment test); how to let the user re-scatter without losing manual edits; what the UI looks like (a "Fill bed" button in the Inspector?)
- This is a differentiating feature — nothing like it in general drawing tools

### 4. SVG export / canvas → print
**Architecture decided — no longer a blocker.** Reconstruct from Pinia store at export time.

- `planToSvg(store, opts): string` — pure function, zero Pixi imports, runs in browser and Node
- **Beds**: use Pixi v8's `graphicsContextToSvg(bedGraphics)` — serializes GraphicsContext as exact bezier `<path>`. Confirmed in v8.18.1.
- **Plants**: `<circle>` + `<use href="#sp-{species}">` from `<defs>/<symbol>` + `<text>` or outlined path for label
- **Text**: outline to paths by default (opentype.js); optional embedded-font mode for editable text
- **Aerial photo**: base64 data-URI `<image>`
- **PDF**: jsPDF + svg2pdf.js client-side; Inkscape CLI server-side for high-quality
- **Illustrator**: presentation attributes not CSS classes, absolute units on root, `inkscape:groupmode="layer"` metadata
- Remaining risk: stroke alignment (SVG centers strokes; inner/outer strokes on beds need path offset)

### 5. Label collision avoidance
When many plants are close together, labels overlap. Need to detect and resolve collisions.
- RAPID pattern (`PixiLayerLabels.js`): uses RBush spatial index, tracks placement boxes and avoidance boxes, skips labels that would overlap
- Our version: probably simpler (labels always shown, just need to not overlap each other)
- Spike: RBush + placement algorithm when syncing plants

### 5. Text quality at extreme zoom
BitmapText is pre-rasterized at a fixed resolution. At 5–10× zoom labels look pixelated.
- RAPID uses BitmapText for ASCII, falls back to PIXI.Text (live canvas texture) for Unicode
- Our option: MSDF font atlas from Times New Roman — infinite zoom, crisp at any scale — but needs custom atlas generation tooling
- Need to decide: acceptable to have soft labels at max zoom? Or is crisp text a requirement?

---

## Medium Risk — Important But Path Is Clear

### 6. Layer system
Multiple z-ordered containers with independent visibility toggles.
- RAPID pattern (`PixiScene.js`): 8 named groups with fixed zIndex, all children of an `origin` container that translates for pan
- Our layers: Canopy, Understory, Groundcover (plant layers by category), Beds, Hardscape, Annotations, Site Analysis (aerial, parcel, building, topo, soils), Title block
- Plant auto-routing: plant goes into layer based on its `category` field (canopy_tree/palm → Canopy; small_tree/shrub → Understory; grass/groundcover/wildflower → Groundcover)
- Spike: create all layers at init, verify visibility toggle and z-order work correctly

### 7. Multi-select + group move
Shift+click adds to selection. Dragging any selected plant moves all selected plants together.
- Currently: lasso selects only one plant (bug); no shift+click
- Needs: `selectedIds: Set<string>` in store, group drag tracking at stage level (not per-container)
- RAPID pattern: stage-level pointermove tracks drag delta, applies to all selected features

### 8. Bed hit testing + node editing
Clicking a bezier bed selects it. Dragging anchor nodes reshapes it. Clicking a bezier edge inserts a new node.
- RAPID pattern: approximates bezier curves as Polygon for hitArea, samples 8 points per segment
- Spike: click-to-select bed, drag anchor, live bezier redraw on each frame

### 9. Performance at 300+ plants with all layers
Need to formally measure fps during pan/zoom/drag with full scene (plants + beds + all site analysis layers).
- RAPID pattern: only loads entities in visible extent, culls outside viewport
- Our case is simpler — fixed site plan, not infinite scroll — but still need to benchmark
- Record measurements in `measurements/renderer-pixi/`

---

## Lower Risk — Known Path, Just Build It

### 10. Site analysis layers (read-only reference data)
The backend SVG already contains: aerial photo, parcel boundary, building footprint, DEM/topo contours, SSURGO soils. These are read-only overlays.
- Implementation: load as Sprite (aerial), Graphics (vector shapes), or SVG textures
- Visibility toggle per layer
- No interaction needed (click-through)

### 11. Annotations
User-drawn dimension lines, north arrow, scale bar, title block.
- Dimension line: user draws a line segment, length auto-computes from page scale (set in project wizard)
- Display: tick marks at each end, label rect with feet+inches value
- North arrow + scale bar: static sprites positioned at page coordinates
- Title block: text fields bound to project metadata (name, date, designer, scale)

### 12. Undo/redo
Store-level undo (already exists pattern in flora-uxp/flora-cad). Canvas reacts to store changes — no separate canvas undo needed.
- Plant move → store records previous position → Cmd+Z resets position → watch triggers canvas update
- Label move → same pattern

### 13. Snap to grid / alignment
Grid overlay drawn as Graphics lines at user-specified interval. Plants optionally snap to nearest grid point on drag-end.

### 14. Copy/paste plants
Copy selected plants to clipboard (store-side). Paste creates new plants offset by a fixed amount.

### 15. Page scale coordinate system
All canvas coordinates are in world-space inches. The page scale (e.g. 1" = 20') is set in the project wizard and stored in the project. Dimension line labels need to convert world inches to real-world feet.

---

## Out of Scope for Derisking (Handle Later)

- Reports/PDF export (plant schedule, BOM, cost breakdown) — server-side or html-to-pdf, not Pixi
- Species library browser — pure UI, no canvas
- SSURGO soil zone filtering — backend concern
- Authentication, project management, user accounts
- Growth preview (mature size scaling) — store + canvas update, low risk
- Array/grid plant duplication — store operation + canvas re-render, low risk

---

## Architecture Decisions to Make (from RAPID study)

1. **Scene graph structure**: Use RAPID's `origin` container pattern — all world-space content is a child of an `origin` Container that handles pan/translate. Stage scale handles zoom. This cleanly separates viewport from world content.

2. **Custom render loop**: RAPID disables Pixi's autoStart and uses its own rAF loop with a throttle (250ms) to avoid excessive geometry recalculation on rapid input. Worth adopting.

3. **CSS transform for pan feedback**: RAPID applies a CSS transform to the canvas div for instant visual pan, then recalculates geometry in the background. Eliminates pan jank. May be overkill for our scale but worth knowing about.

4. **Texture atlas**: RAPID uses a 3-atlas system (one per texture type). For us: one atlas for plant sprites (pre-rasterized SVGs), one for UI icons. Avoids texture swaps between draw calls.

5. **Feature destruction vs hiding**: RAPID destroys display objects after 20 frames off-screen. For us: plants are always on-screen (fixed site plan), so probably not needed — but LOD=0 should at minimum remove texture/sprite from container.

6. **RBush for label collision**: Worth bringing in as a dependency for label placement.

---

## Reference Files

| Topic | File |
|---|---|
| Leader line geometry | `flora-uxp/cpp-plugin/.../FloraLeaderLineDrawing.cpp` |
| Plant LOD / appearance | `flora-uxp/client/services/orchestration/PlantAppearanceOrchestrator.ts` |
| RAPID scene graph | `Rapid/modules/pixi/PixiScene.js` |
| RAPID LOD | `Rapid/modules/pixi/AbstractFeature.js`, `PixiFeaturePoint.js` |
| RAPID label system | `Rapid/modules/pixi/PixiLayerLabels.js` |
| RAPID hit testing | `Rapid/modules/pixi/PixiFeatureLine.js`, `PixiFeaturePolygon.js` |
| RAPID render loop | `Rapid/modules/core/GraphicsSystem.js` |
| Plant categories | `flora-backend/src/plants/models/choices.py` |
