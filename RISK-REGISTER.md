# Flora CAD v2 — Risk Register

Tracks every feature that was handled by Adobe Illustrator or flora-uxp (the Tauri/Illustrator plugin) and must be replaced by Pixi.js + Vue 3 in flora-studio. For each risk: current status, mitigation strategy, and whether a dedicated pixi-features spike is needed before building the real thing.

**Status legend:** ✅ Proven · 🔬 Spike needed · 🏗️ Architecture decided, not built · ⚠️ Open

---

## 1. High Risk — Pixi.js must prove these before architecture is locked

### 1.1 300–500 plants at 60fps with all layers active
**Was:** Illustrator + flora-uxp C++ plugin rendered a static Illustrator document. Frame rate was irrelevant.
**Risk:** Unknown GPU batch cost when plants + beds + aerial + labels + leader lines all render together during pan/zoom/drag.
**Status:** ✅ Proven in `TabPlantRenderer` — 300 plants + beds + SVG background + per-plant leader lines at 120fps. LOD thresholds measured. `GraphicsContext` sharing across same-species plants confirmed as the key pattern.
**Rapid steal:** `PixiFeaturePoint.js` LOD pattern (lod0/1/2), `AbstractFeature.js` dirty-flag architecture.

---

### 1.2 SVG / PDF export at print scale (24″ × 36″)
**Was:** Illustrator *is* SVG. Exporting was File → Save As → SVG or PDF. Landscape architects got a fully layered, editable Illustrator file.
**Risk:** High. WebGL is a raster pipeline. There is no Pixi → SVG exporter.
**Status:** 🏗️ Architecture decided and closed. See `flora-studio/docs/svg-pdf-export-architecture.md`.
**Decision:** Pure function `planToSvg(store, opts): string` with zero Pixi imports, reconstructs the drawing from the Pinia store. Client-side: SVG Blob download. Server-side: pipe through Inkscape CLI for PDF. Pixi v8 `graphicsContextToSvg()` handles bed bezier serialization. Text outlined to paths by default.
**Spike needed?** No new spike. `graphicsContextToSvg` is documented in Pixi v8 release notes. Build it when the data model is stable.

---

### 1.3 Freehand path → auto-smooth on release
**Was:** Illustrator's pencil tool / smooth tool.
**Risk:** Medium-high. The quality of the smoothed result determines whether beds look professional. RDP simplification + bezier fitting quality is not yet validated at real drawing scales.
**Status:** 🔬 `TabFreehand` exists and proves RenderTexture stroke accumulation works. Auto-smooth on release (RDP + bezier fit) is not yet implemented or quality-checked.
**Spike:** Add RDP simplification + bezier fitting to `TabFreehand`. Draw a bed boundary freehand, release, verify the smoothed result looks like Illustrator output. Tune tolerance.
**Libraries:** `simplify-js` (RDP), `bezier-js` (fit), or Paper.js `Path.simplify()` as reference implementation.

---

### 1.4 Knife / split tool
**Was:** Illustrator's knife tool — drag across a shape to split it into two.
**Risk:** Medium-high. Requires finding the intersection of the cut path with each bed segment (bezier–bezier intersection, non-trivial), then de Casteljau split at each intersection `t`.
**Status:** 🔬 Algorithm is fully researched. See `docs/research/Bezier pen tool in Pixi.js v8.md` for the exact de Casteljau formulas. Not yet implemented.
**Spike:** Add a `TabKnife` tab. Draw a closed bezier shape. Draw a straight cut line across it. Verify two independent closed paths result, each with correct control points. Confirm `bezier-js` `.split(t)` gives exact geometry.
**Algorithm:**
1. Nearest point on curve: LUT (100 samples) + 1–2 Newton iterations → parameter `t`
2. Bezier–line intersection: solve cubic for `t` values
3. `bezier-js` `.split(t)` at each intersection → two segments
4. Stitch into two closed paths

---

### 1.5 Rulers + guide lines
**Was:** Illustrator's rulers and draggable guides. Landscape architects use these constantly for alignment.
**Risk:** Medium. Rulers must stay legible across 3 orders of magnitude of zoom — tick density and label formatting are surprisingly tricky. Guides need to snap objects to them during drag.
**Status:** 🔬 Not spiked. Grid is proven (`TabSnapping`) but rulers are a different problem.
**Spike:** Add a `TabRulers` tab. Implement a ruler that redraws on every zoom tick with legible ticks at all zoom levels (zoom 0.05× to 10×). Verify labels don't collide and major/minor ticks stay proportional.
**Rapid steal:** `modules/core/MapSystem.js` has zoom-stable tick logic for map scale bars — directly portable.

---

### 1.6 Text annotation (in-canvas, editable)
**Was:** Illustrator's text tool. Click anywhere, type, drag to move.
**Risk:** Medium. Pixi has no text input. The pattern (Vue `<input>` overlay positioned over the canvas, commit on blur/Enter) is known but not validated in our stack.
**Status:** 🔬 MSDF text rendering is proven (`TabMsdfText`). In-canvas editing via Vue overlay is not spiked.
**Spike:** Add a `TabTextAnnotation` tab. Click on canvas → Vue `<input>` appears at that screen position → type → blur commits to Pixi `BitmapText`. Verify positioning stays correct during zoom/pan after commit. Verify text is included in the SVG export path (outlined to paths).
**Rapid steal:** None — Rapid has no text input. The Vue overlay pattern is the industry standard for canvas text editing (Figma, tldraw all do this).

---

## 2. Medium Risk — Architecture decided, implementation path clear

### 2.1 Layer system (visibility, lock, z-order)
**Was:** Illustrator layers were central to every landscape architect's workflow. Named layers, toggle visibility, lock to prevent accidental edits, reorder by drag.
**Risk:** Medium. The scene graph structure is already designed (see `derisking-experiments/ARCHITECTURE.md`). The layer panel is pure Vue UI. The risk is making sure `container.visible` and `container.interactiveChildren = false` (for locked layers) work correctly at runtime with the event system.
**Status:** 🏗️ Scene graph layer structure decided. No spike yet for the lock/visibility interaction.
**Rapid steal:** `AbstractLayer.js` + `PixiScene.js` — the entire enable/disable/dirty lifecycle is directly portable (~400 lines total).

---

### 2.2 Dimension lines + measurement annotations
**Was:** Illustrator's dimension lines (tick marks + distance label). Standard on every landscape drawing.
**Risk:** Low-medium. Geometry is simple. The risk is the label positioning and zoom-stability (leader lines must not scale with the world; tick size must stay fixed in screen space).
**Status:** ⚠️ Not started. No spike.
**Approach:** Dimension line is a world-space `<line>` with screen-space tick marks (inverse-scale pattern, same as anchor handles in `TabPenTool`). Label is a `BitmapText` child with zoom-stable sizing. Geometry from store (two world-space points), not read back from Pixi.

---

### 2.3 Stroke / fill style panel (color, weight, cap, join, gradient)
**Was:** Illustrator's Appearance panel and Stroke panel.
**Risk:** Low. Pixi `StrokeStyle` supports all of these. The risk is ensuring the style-per-object data model is correct (each object stores its own stroke/fill) and the Vue panel correctly writes to the store, which then re-renders via the Pixi dirty flag.
**Status:** ✅ Dash patterns proven (`TabDashedLines`). Solid color stroke/fill not yet in a dedicated tab but Pixi StrokeStyle is exercised throughout.
**Approach:** Store-driven — every path/shape object in the Pinia store has `{ strokeColor, strokeWeight, strokeDash, strokeCap, strokeJoin, fillColor, fillOpacity }`. The renderer reads these on each `syncX()` call.

---

### 2.4 Transform gizmo (scale + rotate handles)
**Was:** Illustrator's selection tool bounding box with corner scale handles and rotation handle.
**Risk:** Medium. The OBB (oriented bounding box) math for a rotated shape is non-trivial. Handle positions must stay at fixed screen size regardless of zoom.
**Status:** ✅ Proven in `TabTransformGizmo` — scale handles on all 8 corners/edges + rotation handle, hand-rolled for Pixi v8 (no @pixi-essentials/transformer which targets v7).

---

### 2.5 Spatial index for hit testing + label placement
**Was:** Illustrator handled hit testing natively via its own rendering model.
**Risk:** Low. RBush is the proven library.
**Status:** ✅ Proven in `TabSpatialIndex` — 1000+ objects, RBush query vs brute force comparison shows clear performance win. Ready to use for hit testing, conflict detection, and label collision avoidance.
**Rapid steal:** `PixiLayerLabels.js` (~930 lines) — the complete RBush-based label placement system with occlusion avoidance. Direct steal for plant labels.

---

### 2.6 Selection marquee + marching ants border
**Was:** Illustrator selection rectangle + animated dashed border on selected objects.
**Risk:** Low. Both proven.
**Status:** ✅ Lasso selection proven (`TabPlantRenderer`, `TabSelection`). Marching ants animation proven (`TabMarchingAnts`). The dash-offset-per-frame pattern is confirmed.

---

### 2.7 Bed fill algorithms (Poisson disk, hex grid, path planting)
**Was:** Not in Illustrator. Was manual placement. flora-uxp had `BatchPlacementOrchestrator.ts` and `ArrayPlacementOrchestrator.ts`.
**Risk:** Medium. The algorithms are decided (see `derisking-experiments/TODO.md` research section). The risk is performance on large beds — the fill runs once on confirm, not every frame, so should be acceptable. Offload to Web Worker for beds with >500 plants.
**Status:** 🏗️ Stack decided: `fast-2d-poisson-disk-sampling`, `honeycomb-grid`, `bezier-js` (flatten bed to polygon), `@turf/boolean-point-in-polygon`, `simplex-noise` (species clustering). Not built.
**flora-uxp steal:** `BatchPlacementOrchestrator.ts`, `ArrayPlacementOrchestrator.ts` — port the placement loop logic; replace Illustrator coordinate system with our store coordinates.

---

## 3. Low Risk — Clear path, just build it

### 3.1 Boolean path operations (union, difference, intersect)
**Was:** Illustrator's Pathfinder panel.
**Status:** ✅ Fully proven in `TabBooleanOps`. `polyclip-ts` confirmed working.

---

### 3.2 Bezier pen tool + anchor editing
**Was:** Illustrator's pen tool. The core drawing primitive.
**Status:** ✅ Fully proven in `TabPenTool` — corner/smooth/asymmetric anchors, handle mirroring, alt+drag to break symmetry, close path, FSM state machine. All Illustrator pen tool interactions working.

---

### 3.3 Snapping (grid, vertex, edge)
**Was:** Illustrator's smart guides.
**Status:** ✅ Proven in `TabSnapping`.

---

### 3.4 Rectangle + ellipse tools
**Was:** Illustrator's rectangle/ellipse tools.
**Risk:** Trivial — both are shortcuts that emit a closed bezier path into the same data model as the pen tool.
**Status:** ⚠️ Not built, but zero unknowns.

---

### 3.5 Plant labels, ref designators, leader lines
**Was:** flora-uxp `LabelOrchestrator.ts`, `LeaderLineOrchestrator.ts`. Labels were Illustrator text objects; leader lines were Illustrator path objects.
**Status:** ✅ Leader line geometry proven in `TabLeaderLine` (port of `FloraLeaderLineDrawing.cpp`). Label drag + leader line auto-appear on 300 plants proven in `TabPlantRenderer`.
**flora-uxp steal:** `LabelOrchestrator.ts` — ref designator assignment logic (prefix by category, auto-increment). `LeaderLineOrchestrator.ts` — label offset persistence.

---

### 3.6 Growth preview (year slider, circle scaling)
**Was:** Not in Illustrator. flora-uxp `GrowthPreviewOrchestrator.ts`.
**Risk:** Low. Ticker-driven lerp on plant circle radius. View-only mode — does not write to store.
**Status:** ⚠️ Not spiked, but zero unknowns. LOD proven, circle resize during animation is trivial.
**flora-uxp steal:** `GrowthPreviewOrchestrator.ts` — growth rate math and year-slider logic.

---

### 3.7 Plant spacing conflict detection
**Was:** Not in Illustrator. flora-uxp had no automatic conflict detection (was manual).
**Risk:** Low. RBush spatial index proven. AABB query → exact circle overlap check is simple arithmetic.
**Status:** ⚠️ Not built. Depends on RBush (`TabSpatialIndex` proven).

---

### 3.8 Title block + north arrow + scale bar
**Was:** flora-uxp `TitleBlockOrchestrator.ts`. Placed as Illustrator objects.
**Risk:** Low. Title block is a Vue overlay component, not a Pixi object. North arrow is a Sprite. Scale bar is a Graphics line with BitmapText label.
**flora-uxp steal:** `TitleBlockOrchestrator.ts` — data-binding pattern for project metadata fields.

---

### 3.9 BOM / plant schedule export (PDF, CSV, XLSX)
**Was:** flora-uxp `BOMExportService.ts`, `PlantReportService.ts`. Required Illustrator to count objects.
**Risk:** Low. Pure data aggregation from the Pinia store. No canvas involvement.
**flora-uxp steal:** Port `BOMExportService.ts` and `PlantReportService.ts` directly — the aggregation logic is Illustrator-independent.

---

### 3.10 GIS site import (parcel, aerial, soil zones)
**Was:** flora-uxp `SitePlanImportService.ts`, `SiteSearchService.ts`. Imported into Illustrator as locked reference layers.
**Risk:** Low for the data pipeline (already exists in flora-uxp + flora-backend). Medium for the viewport projection (mapping WGS84 → canvas inches).
**flora-uxp steal:** `SitePlanImportService.ts`, `SiteSearchService.ts`, `CoordinateOrchestrator.ts`.
**Rapid steal:** `modules/core/MapSystem.js` — viewport projection/unprojection, zoom-to-extent. `PixiLayerBackgroundTiles.js` — aerial tile loading (heavy but complete). `PixiLayerCustomData.js` — GeoJSON polygon overlay (for soil zones and parcel boundary).

---

## 4. Not risky — Pure Vue UI, no canvas work

These were either not in Illustrator at all, or are purely data/UI work with no Pixi involvement:

- Plant library browsing + search + filters
- Design palette (saved species collections)
- Species detail view (photos, care info, pricing)
- Undo/redo (Pinia store command pattern; Rapid's `EditSystem.js` is the steal)
- Project management (create, open, save, recent)
- Company defaults
- Cost estimate generation
- Soil zone compatibility filtering

---

## 5. Open spikes needed (priority order for next sessions)

| Priority | Spike | Tab to build | Risk if skipped |
|---|---|---|---|
| 1 | Freehand auto-smooth quality | `TabFreehand` (extend) | Beds look amateurish |
| 2 | Rulers at all zoom levels | `TabRulers` (new) | Spatial reference unusable |
| 3 | In-canvas text editing (Vue overlay) | `TabTextAnnotation` (new) | Annotations blocked |
| 4 | Knife / split tool | `TabKnife` (new) | Bed editing blocked |
| 5 | Layer lock/visibility + event isolation | Extend `TabPlantRenderer` | Illustrator workflow mismatch |
