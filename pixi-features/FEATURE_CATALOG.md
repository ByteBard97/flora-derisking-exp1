# Pixi-Features Catalog — Canonical Reference for flora-studio

> **Project:** `derisking-experiments/pixi-features`  
> **PixiJS version:** v8  
> **Last audited:** 2026-05-02

This document catalogs every proven tab (Vue component) and shared utility in the `pixi-features` derisking project. It is grouped by the same categories used in `App.vue`.

---

## Table of Contents

1. [Rendering](#group-rendering)
2. [Drawing Tools](#group-drawing-tools)
3. [Interaction](#group-interaction)
4. [Text & UI](#group-text--ui)
5. [Viewport](#group-viewport)
6. [Shared Infrastructure](#shared-infrastructure)
7. [Filters Library](#filters-library)

---

## Group: Rendering

### TabPlantRenderer.vue

| | |
|---|---|
| **Feature name** | Full plant-scene renderer with LOD, drag-to-move, lasso selection, leader lines, and bed rendering |
| **File path** | `src/tabs/TabPlantRenderer.vue` |
| **Key line ranges** | `14-68` (reactive controls + HUD), `72-80` (lifecycle), `85-95` (PixiCanvas integration) |
| **Pattern summary** | Thin Vue wrapper around `PixiCanvas.vue` + `PixiRenderer.ts`. Holds plant count slider, background toggle, FPS HUD, and keyboard shortcuts (⌘Z undo). Delegates all canvas work to the renderer class. |
| **Gotchas** | `pixiCanvas` ref is typed as `InstanceType<typeof PixiCanvas>` — the canvas exposes `setBackgroundVisible`, `setCamera`, `getShapeCount`, `setTickerMaxFPS`. The Vue component does **not** own the Pixi `Application`; it lives inside `PixiCanvas`. |
| **flora-studio relevance** | **Directly portable.** This is the canonical integration pattern: Vue owns reactive state, Pixi owns the render loop. The `docStore`/`selectionStore` pattern is the same one used in flora-studio. |
| **Dependencies** | `pixi.js`, `pixi-viewport`, `pinia` (via stores) |

**Consumers:** `PixiCanvas.vue`, `PixiRenderer.ts`, `docStore.ts`, `selectionStore.ts`

---

### TabLeaderLine.vue

| | |
|---|---|
| **Feature name** | Draggable label + auto-redrawing leader line anchored to a plant circle |
| **File path** | `src/tabs/TabLeaderLine.vue` |
| **Key line ranges** | `30-42` (SVG→Texture helper), `56-104` (rayRectExit / circleEdgePoint geometry), `124-158` (Pixi init + viewport), `160-172` (BitmapFont install), `178-214` (plant container + label setup), `222-293` (redrawLeader), `297-365` (label drag + plant drag + event isolation) |
| **Pattern summary** | Tests whether a child label inside a draggable plant container can be dragged independently. Uses `e.stopPropagation()` + `viewport.plugins.pause('drag')` to isolate events. Leader line geometry is a direct TypeScript port of `FloraLeaderLineDrawing.cpp` (ray-rect exit, arrowhead, suppression thresholds). |
| **Gotchas** | **Critical:** `viewport.plugins.pause('drag')` must be called on `pointerdown` for both label and plant, then `resume('drag')` on `pointerup`/`pointerupoutside`. Without this, the viewport swallows the drag. Label bounds are measured after one RAF (`await new Promise(r => requestAnimationFrame(r))`) because BitmapText width is 0 before layout. |
| **flora-studio relevance** | **Directly portable.** The same leader-line math lives in `PixiRenderer.ts` (lines 245-311). The event-isolation pattern is production-ready. |
| **Dependencies** | `pixi.js`, `pixi-viewport` |

---

### TabMsdfText.vue

| | |
|---|---|
| **Feature name** | MSDF (multi-channel signed distance field) text stress test at 300 labels × mixed font sizes |
| **File path** | `src/tabs/TabMsdfText.vue` |
| **Key line ranges** | `32-42` (App init), `47-57` (Viewport), `60-67` (Assets.load MSDF), `69-93` (label scatter loop) |
| **Pattern summary** | Loads an MSDF font atlas (`times-new-roman.fnt` + `.png`) via `Assets.load`, then scatters 300 `BitmapText` labels at three different font sizes. The old jakerdy/pixi-msdf-examples batcher bug only manifests when mixed scales appear in the same draw call — this tab intentionally mixes them. |
| **Gotchas** | MSDF fonts must be generated with `msdf-bmfont-xml` (or equivalent). The `.fnt` descriptor references the PNG atlas. If glyphs look corrupt at any zoom, the batcher bug is still present — but Pixi v8’s built-in MSDF support handles it correctly. Always `Assets.unload()` on unmount to prevent texture leaks. |
| **flora-studio relevance** | **Directly portable.** MSDF is the recommended text path for crisp labels at all zoom levels. BitmapText is a fallback for smaller/static labels. |
| **Dependencies** | `pixi.js`, `pixi-viewport` |

---

### TabBitmapText.vue

| | |
|---|---|
| **Feature name** | BitmapText vs CPU-rasterized `Text` comparison at variable zoom |
| **File path** | `src/tabs/TabBitmapText.vue` |
| **Key line ranges** | `30-49` (buildScene), `51-62` (App init), `67-72` (`BitmapFont.install` at resolution 4), `74-109` (viewport + divider + layers) |
| **Pattern summary** | Bakes a `BitmapFont` atlas at 64px × 4 resolution = 256px effective glyphs. Top half shows BitmapText (crisp at zoom), bottom half shows standard `Text` (blurry when zoomed in, re-rasterizes each frame). Demonstrates why MSDF is the third tier above both. |
| **Gotchas** | `BitmapFont.install` resolution is the atlas texture resolution multiplier. A 64px font at resolution 4 creates 256px glyphs — crisp up to ~5× zoom of a 48px label. Beyond that, raster pixelation becomes visible. The `chars` array must cover every glyph you intend to render. |
| **flora-studio relevance** | **Reference only.** flora-studio should use MSDF for labels and BitmapText only for small HUD elements where MSDF atlas generation is overkill. |
| **Dependencies** | `pixi.js`, `pixi-viewport` |

---

### TabNPRRenderer.vue

| | |
|---|---|
| **Feature name** | Non-photorealistic rendering pipeline: Risograph, Watercolor, Sketch, and Wobble filters on SVG plant sprites |
| **File path** | `src/tabs/TabNPRRenderer.vue` |
| **Key line ranges** | `40-137` (style params + SVG→Texture helper + grid builder), `139-211` (`applyStyle` — filter assignment per plant), `214-227` (`onSliderInput`), `229-254` (`watch` hooks for style/wobble), `256-316` (onMounted: App init, texture loading, sprite creation), `318-321` (onUnmounted) |
| **Pattern summary** | Loads 4 species SVGs into Sprites, arranges them in a 4×4 grid, then applies per-plant filters based on the active style. Each style has its own `Filter` subclass (`RisographFilter`, `WatercolorWashFilter`, `CrosshatchFilter`) with species-specific parameters. Wobble is a separate toggleable filter that stacks on top of any style. |
| **Gotchas** | **World-matrix uniforms:** `CrosshatchFilter` and `WobbleFilter` need the inverted viewport transform (`uWorldMatrix`) so their noise/grid patterns stay world-locked during pan/zoom. The ticker calls `updateWorldMatrix()` every frame when sketch or wobble is active — this is a necessary cost. Filters are assigned per-sprite (`sprite.filters = [f]`). Do **not** apply filters to a cached parent Container (see `treeSymbol.ts` header). |
| **flora-studio relevance** | **Directly portable.** The filter architecture (per-plant filter assignment, uniform updates, world-matrix injection) is the production NPR pipeline. The 4 styles are the approved aesthetic directions. |
| **Dependencies** | `pixi.js`, `pixi-viewport`, custom filters (`RisographFilter`, `WatercolorWashFilter`, `CrosshatchFilter`, `WobbleFilter`) |

---

### TabTreeSymbol.vue

| | |
|---|---|
| **Feature name** | Plan-view tree symbols in three hand-drawn styles (watercolor, sketch, technical) |
| **File path** | `src/tabs/TabTreeSymbol.vue` |
| **Key line ranges** | `20-107` (style draw functions: `drawWatercolor`, `drawSketch`, `drawTechnical`, `drawTreeSymbol`), `114-175` (scene layout: 4 species × 3 styles), `177-205` (onMounted: App init + buildScene) |
| **Pattern summary** | Draws vector skeletons (circle, spokes, shadow, trunk dot) directly into `Graphics` objects. Uses seeded random (`hash01` / `positionSeed`) so identical inputs produce identical outputs. Each style is self-contained and isolates paths with `beginPath()`. |
| **Gotchas** | Pixi v8 Graphics requires `beginPath()` before each new shape if you want to isolate strokes/fills — otherwise paths accumulate. The `drawTreeSymbol` API in `treeSymbol.ts` is the production version of this code; this tab is the visual proof. |
| **flora-studio relevance** | **Superseded by `treeSymbol.ts`.** This tab was the initial spike; `treeSymbol.ts` is the refined, documented, cache-aware production version. Use `treeSymbol.ts` in flora-studio. |
| **Dependencies** | `pixi.js` |

---

### TabWindSway.vue

| | |
|---|---|
| **Feature name** | GPU-instanced plant field: wind sway + critically-damped growth animation in one draw call |
| **File path** | `src/tabs/TabWindSway.vue` |
| **Key line ranges** | `33-98` (GLSL VERT + FRAG shaders), `104-236` (`PlantField` class: instanced Mesh with growable buffers), `242-248` (species presets), `254-284` (tick / addPlant / syncWind), `286-337` (onMounted) |
| **Pattern summary** | Uses `Mesh` + `Geometry` with `instance: true` attribute buffers (`aWorldPos`, `aPhase`, `aMatureRadius`, `aBirthTime`). The vertex shader computes growth via a critically-damped spring (`critDamped`) and wind sway via dual-frequency sinusoids. Fragment shader discards outside the circle mask + applies alpha fade. One draw call for any number of plants. |
| **Gotchas** | **Instancing:** `Geometry.instanceCount` must be set manually and kept in sync with buffer writes. `mesh.visible = false` guards against a Pixi v8 bug when `instanceCount = 0`. Buffer `update(bytes)` takes **bytes**, not elements. `Shader.from({ gl: { vertex, fragment } })` requires explicit `#version 300 es` (unlike `Filter`, which auto-injects it). Uniforms must be in named `UniformGroup`s — flat top-level uniforms silently fail in v8. WebGL is preferred over WebGPU for instancing (`preference: 'webgl'`). `setDataWithSize()` is used for buffer growth (double capacity). |
| **flora-studio relevance** | **Directly portable for animation layers.** The `PlantField` class is a self-contained instancing module. For static gardens, the simpler Sprite-based renderer in `PixiRenderer.ts` is sufficient. |
| **Dependencies** | `pixi.js` |

---

### TabKuwahara.vue

| | |
|---|---|
| **Feature name** | Single-pass isotropic Kuwahara filter — painterly oil-paint effect |
| **File path** | `src/tabs/TabKuwahara.vue` |
| **Key line ranges** | `18-26` (reactive controls), `28-64` (onMounted: App init + filter setup), `66-73` (onUnmounted) |
| **Pattern summary** | Loads a demo SVG image into a `Sprite`, applies `KuwaharaFilter` (from `src/lib/filters/KuwaharaFilter.ts`), and exposes radius + on/off controls. The filter computes mean/variance in 4 quadrant windows per pixel and outputs the lowest-variance mean. |
| **Gotchas** | The 3-pass anisotropic version (`AnisotropicKuwaharaFilter.ts`) exists but is **disabled** due to a Pixi v8 `FilterSystem` cross-context bug when calling `filterManager.applyFilter()` recursively from inside an overridden `apply()`. Use the single-pass isotropic version for stability. Radius directly controls `padding` on the filter (required so the kernel doesn’t sample outside the filter area). |
| **flora-studio relevance** | **Directly portable.** Kuwahara is intended as a post-process or per-plant filter in the NPR pipeline. |
| **Dependencies** | `pixi.js`, `KuwaharaFilter` |

---

## Group: Drawing Tools

### TabPenTool.vue

| | |
|---|---|
| **Feature name** | Full pen tool: cubic bezier path drawing with corner/smooth/asymmetric anchors, handle dragging, anchor insertion/deletion, and path closing |
| **File path** | `src/tabs/TabPenTool.vue` |
| **Key line ranges** | `14-45` (types + reactive state), `47-71` (Pixi objects + context templates), `88-124` (rebuildCommitted), `126-254` (rebuildHandles), `256-272` (rebuildPreview), `274-304` (hitTestCurves + insertAnchorOnSegment), `306-355` (deleteAnchor / toggleAnchorType / ensureHandles / closePath), `385-438` (applyDrag), `442-460` (onTick), `462-512` (pointer events), `514-532` (wheel zoom), `559-577` (panning), `580-663` (onMounted) |
| **Pattern summary** | Separates committed path (rebuilt only on anchor commit) from preview Graphics (rebuilt every ticker frame when dirty). Uses `GraphicsContext` templates for anchor/handle dots so they share geometry. All pointer events coalesce into a `dirty` flag; the ticker (`onTick`) does the actual rebuild. Hand-rolled camera (camX, camY, zoom) with inverse scaling for handle dots so they stay at fixed screen size. |
| **Gotchas** | **Ticker-synced dirty flag is mandatory** — never rebuild in `pointermove`. `stroke()` clones but does not clear the active path; use `beginPath()` to isolate shapes. `pixelLine: true` (cast via `as any`) makes 1px lines crisp at all zooms. `bezier-js` is used for hit-testing (`project`) and anchor insertion (`split`). Alt+click deletes anchors; alt+drag breaks handle symmetry. The `handleLineGfx` is `eventMode = 'none'` so handle children can capture pointer events. |
| **flora-studio relevance** | **Directly portable** as the bed-drawing tool. The architecture (committed vs preview, context templates, ticker dirty flag) should be copied exactly. |
| **Dependencies** | `pixi.js`, `bezier-js` |

---

### TabFreehand.vue

| | |
|---|---|
| **Feature name** | Freehand sketching with `perfect-freehand` stroke generation + cubic bezier curve fitting |
| **File path** | `src/tabs/TabFreehand.vue` |
| **Key line ranges** | `17-23` (reactive controls), `30-38` (getFreehandOpts), `40-51` (renderStrokeToGfx), `53-66` (burnToTexture / clearCanvas), `68-106` (pointer events), `108-149` (onMounted) |
| **Pattern summary** | Pointer events collect `[x, y, pressure]` triples. `perfect-freehand` generates an outline polygon from the raw points. The outline is rendered to a live `Graphics`. On pointer-up, the live stroke is "burned" into an accumulation `RenderTexture` via `app.renderer.render({ container: app.stage, target: accTex, clear: false })`, then the live Graphics is cleared. Optionally runs `fitBezierPath` (from `pathFit.ts`) to show a green fitted bezier overlay. |
| **Gotchas** | **RenderTexture accumulation:** `clear: false` is essential so previous strokes persist. The `accSprite` must be added **before** `liveGfx` in the stage so that burning captures both. `perfect-freehand` options (`thinning`, `smoothing`, `streamline`) are all reactive. Pressure is read from `e.pressure`; fallback is `0.5`. The fitted bezier overlay may not render if `currentPoints.length < 4`. |
| **flora-studio relevance** | **Directly portable** for freehand bed sketching. The `pathFit.ts` module converts the raw stroke into cubic beziers suitable for the `Bed` data model. |
| **Dependencies** | `pixi.js`, `perfect-freehand`, `pathFit.ts` |

---

### TabKnife.vue

| | |
|---|---|
| **Feature name** | Knife tool: split a closed bezier shape into two closed shapes by drawing a cut line |
| **File path** | `src/tabs/TabKnife.vue` |
| **Key line ranges** | `16-35` (Anchor / CubicSeg / ShapeObject types), `47-107` (buildSegments / drawClosedPath / makeShapeObject), `109-125` (resetShape), `127-170` (cut + OBB + handles), `172-200` (drawGizmo), `202-233` (hit testing), `235-360` (pointer events), `362-499` (performCut / splitSeg / splitPathAtHits), `501-546` (keyboard + onMounted) |
| **Pattern summary** | Creates a closed bezier shape from preset anchors. Knife mode: drag a line across the shape; on release, the line is intersected against every bezier segment using `bezier-js intersects()`. Two hits → split each hit segment at `t`, then walk the expanded segment array in two directions to form two new closed paths. Select mode: OBB transform gizmo with scale (8 handles) and rotate (1 handle). |
| **Gotchas** | **Split order matters:** split the higher-index hit first so lower indices remain stable. `hitB.segIndex === hitA.segIndex` requires `t` adjustment (`hitA.t / hitB.t`). `bezier-js` `intersects()` returns strings like `"0.25/0.75"` — parse with `split('/')[0]`. Container transforms (position, scale, rotation) must be applied/unapplied when converting between screen, world, and local coordinates. `toLocal`/`toGlobal` on Containers handle this. |
| **flora-studio relevance** | **Directly portable** for bed splitting. The `splitPathAtHits` algorithm is the production reference. |
| **Dependencies** | `pixi.js`, `bezier-js` |

---

### TabBooleanOps.vue

| | |
|---|---|
| **Feature name** | Boolean operations (union, intersection, difference) on closed bezier beds via flattening + polygon-clipping |
| **File path** | `src/tabs/TabBooleanOps.vue` |
| **Key line ranges** | `14-36` (types + presets BED_A / BED_B), `45-65` (flattenBed: bezier→polyline via `getLUT`), `67-91` (drawBed: fill then stroke), `93-123` (drawResult), `125-159` (runOp), `165-186` (camera + panning), `188-233` (onMounted) |
| **Pattern summary** | Two preset closed bezier paths are flattened to polylines using `bezier-js getLUT(samples)`. The rings are fed into `polygon-clipping` (martinez algorithm) for union/intersection/difference. Results are drawn as filled polygons. A slider controls `flattenSamples` (5–100) to show the accuracy/performance tradeoff. |
| **Gotchas** | `bezier-js` `getLUT(n)` returns `n+1` points. The last point of each segment is skipped (it’s the first point of the next). The ring must be explicitly closed by pushing `pts[0]`. `polygon-clipping` expects `[[[x,y],...]]` (multi-polygon with rings). `drawBed` must draw the path twice: once for fill, then `beginPath()` + re-draw for stroke — Pixi v8 does not support fill+stroke in one pass without re-drawing. |
| **flora-studio relevance** | **Directly portable** for bed boolean operations. The flatten-then-clip pattern is the recommended approach until a native bezier boolean library is available. |
| **Dependencies** | `pixi.js`, `bezier-js`, `polygon-clipping` |

---

### TabDashedLines.vue

| | |
|---|---|
| **Feature name** | Dashed line rendering: `DashLine` class, `pixelLine:true`, and world-space width comparison |
| **File path** | `src/tabs/TabDashedLines.vue` |
| **Key line ranges** | `19-28` (LINES spec array), `30-51` (draw), `53-91` (onMounted + onUnmounted), `93-119` (wheel zoom + panning) |
| **Pattern summary** | Draws 8 horizontal lines with varying dash patterns, widths, and `pixelLine` modes. Uses the `DashLine` utility (ported from RapiD) for dashed lines. Demonstrates that `pixelLine: true` lines stay 1px at any zoom, while world-space lines thicken. |
| **Gotchas** | `pixelLine: true` is a Pixi v8 stroke option but may require `as any` cast in TypeScript because the typings are not always exposed. `DashLine` walks the dash array segment-by-segment and calls `stroke()` for each dash — this is more draw calls than a native dashed stroke, but it works where Pixi has no built-in dash support. |
| **flora-studio relevance** | **Directly portable.** `DashLine.ts` is the canonical dashed-line utility. Use `pixelLine: true` for UI overlays (selection borders, HUD lines) and world-space width for geometry strokes. |
| **Dependencies** | `pixi.js`, `DashLine.ts` |

---

## Group: Interaction

### TabMeasure.vue

| | |
|---|---|
| **Feature name** | Measurement tool: line distance, polygon area, and path length with dimension lines, labels, and angle constraints |
| **File path** | `src/tabs/TabMeasure.vue` |
| **Key line ranges** | `13-27` (reactive controls: scale, mode, endCap, persistMode, angleMode, labelStyle), `41-66` (resetState / redrawBed), `80-90` (applyAngleConstraint), `92-135` (drawDimLine), `137-152` (makeLabelContainer), `154-172` (positionLabel), `174-195` (drawAreaGuide), `202-209` (isCursorNearBed), `211-249` (onMove), `251-309` (onClick), `328-393` (onMounted) |
| **Pattern summary** | Three modes: **Line** (click start → click end, with angle snap), **Area** (click vertices → close polygon), **Path** (hover bed to show total length). Uses `BitmapFont` for labels. Dimension lines support tick or arrow end caps. Labels can be rotated or horizontal. Sticky mode persists measurements; ephemeral mode clears on next measurement. |
| **Gotchas** | `BitmapFont.install` must happen before creating `BitmapText`. `makeLabelContainer` measures text width/height after setting text, then draws a rounded-rect badge. Angle constraint (`h`, `v`, `45°`) is applied to the rubber-band end point, not the cursor directly. `pxToFeet` and `polygonAreaPx` are from `measureUtils.ts`. |
| **flora-studio relevance** | **Directly portable.** The measurement overlay pattern (guide Graphics + label Container) is the production approach. |
| **Dependencies** | `pixi.js`, `measureUtils.ts`, `bezier-js` |

---

### TabSelection.vue

| | |
|---|---|
| **Feature name** | Selection interaction: click-to-select, shift multi-select, lasso box, drag-to-move, with custom hitArea |
| **File path** | `src/tabs/TabSelection.vue` |
| **Key line ranges** | `11-38` (types + reactive state), `44-91` (spawnShapes), `93-107` (drawShape / refreshShapes), `109-122` (drawLasso / selectByLasso), `135-195` (pointer events), `197-210` (wheel zoom), `216-268` (onMounted) |
| **Pattern summary** | Shapes are `Graphics` objects with explicit `hitArea` (`Circle` or `Rectangle`). `eventMode = 'static'` + `cursor = 'pointer'` enable interaction. Clicking a shape stops propagation; clicking the background starts a lasso. Lasso is a world-space rectangle drawn into a `Graphics`. Dragging selected shapes updates their `x`/`y` directly (no re-render needed). |
| **Gotchas** | **Hit area is essential:** without `hitArea`, thin strokes or transparent fills are not hittable in Pixi v8. `lastPointerDownOnShape` flag prevents lasso from starting when a shape click is intended. `selectedIds.value = new Set([id])` triggers Vue reactivity; `refreshShapes()` redraws all shapes with selection styling. Panning uses alt+drag or middle-click. |
| **flora-studio relevance** | **Directly portable.** The selection + lasso + drag pattern is the same one used in `PixiRenderer.ts` (which adds leader-line redraw on drag). |
| **Dependencies** | `pixi.js` |

---

### TabSnapping.vue

| | |
|---|---|
| **Feature name** | Snap system: grid snap, vertex snap, edge snap with visual indicators and strength modes |
| **File path** | `src/tabs/TabSnapping.vue` |
| **Key line ranges** | `15-21` (reactive controls), `24-31` (static scene verts/edges), `49-81` (applySnap: best-candidate selection), `83-92` (snapAllToGrid), `94-110` (updateGridUniforms), `112-125` (drawStatic), `127-155` (drawShape), `157-176` (onBgPD), `178-226` (onStagePM), `228-237` (onStagePU), `239-254` (onWheel), `256-319` (onMounted) |
| **Pattern summary** | Implements three snap targets (grid, vertex, edge) with a "best candidate" algorithm: compute the nearest snap point for each enabled target, then pick the closest overall. Two strength modes: **permissive** (only snap within threshold) and **strict** (always snap to nearest). A `GridFilter` shader draws an infinite analytical grid in screen space. |
| **Gotchas** | **GridFilter** uses `uWorldMatrix` (screen→world inverse) so grid lines stay world-locked during pan/zoom. The filter is applied to a full-screen black rectangle (`gridRect`). Snap indicators (crosshair + circle) are drawn at `14 / zoom` and `18 / zoom` so they stay at fixed screen size. Vertex-to-vertex snap is **excluded** when dragging existing vertices to prevent accidental merges. |
| **flora-studio relevance** | **Directly portable.** The `snapUtils.ts` module is the production snap math. `GridFilter` is the recommended infinite grid implementation (no geometry rebuild on zoom). |
| **Dependencies** | `pixi.js`, `snapUtils.ts`, `GridFilter` |

---

### TabTransformGizmo.vue

| | |
|---|---|
| **Feature name** | OBB (oriented bounding box) transform gizmo: translate, rotate, scale with 8 scale handles + 1 rotate handle |
| **File path** | `src/tabs/TabTransformGizmo.vue` |
| **Key line ranges** | `14-42` (types + state), `45-57` (coordinate helpers), `59-89` (OBB math: getOBBCorners / getHandlePositions), `91-125` (drawGizmo), `127-131` (applyPlantTransform), `133-152` (hitHandle), `157-189` (onPD), `192-246` (onPM), `248-251` (onPU), `253-262` (onWheel), `264-274` (onTick), `276-344` (onMounted) |
| **Pattern summary** | Hand-rolled gizmo because `@pixi-essentials/transformer` targets v7. Gizmo is drawn in screen space by applying `worldToScreen` to OBB corners. Scale handles compute an anchor (opposite handle) in world coords, then project the mouse delta onto the local axis. Rotation handle uses `atan2` from object center to mouse. |
| **Gotchas** | **Dirty flag + ticker pattern:** `dirty = true` on pointer move; `onTick` applies camera transform, object transform, and redraws gizmo. This decouples interaction from rendering. Scale handles must reposition the object center after scaling (the anchor stays fixed). `Math.max(0.1, newScale)` prevents negative or zero scale. |
| **flora-studio relevance** | **Directly portable.** The OBB math and gizmo drawing pattern should be copied for plant/bed transformation. |
| **Dependencies** | `pixi.js`, `treeSymbol.ts` (for demo plant drawing) |

---

### TabSpatialIndex.vue

| | |
|---|---|
| **Feature name** | rbush R-tree spatial index: marquee selection vs brute-force timing comparison |
| **File path** | `src/tabs/TabSpatialIndex.vue` |
| **Key line ranges** | `12-20` (reactive state), `26-38` (types), `46-78` (buildScene), `80-99` (runQuery), `101-111` (drawMarquee), `113-132` (spawnClickFx), `134-139` (pointPick), `141-185` (pointer events), `199-256` (onMounted) |
| **Pattern summary** | Generates 1000+ random circles, inserts their AABBs into `rbush`. Marquee selection uses `tree.search(queryRect)` (O(log n + k)) vs brute-force `items.filter()` (O(n)). Both paths are timed and displayed. Point-pick uses the same index. Selected objects switch `GraphicsContext` (normal → selected) without rebuilding geometry. |
| **Gotchas** | `rbush.load(items)` is bulk-insert (faster than individual `.insert()`). `GraphicsContext` switching (`gfx.context = ctxSelected`) is the Pixi v8 way to change appearance without clearing/redrawing. Marquee is drawn in screen space by manually applying zoom + camera to world coords. |
| **flora-studio relevance** | **Directly portable.** `rbush` is the approved spatial index for hit-testing and lasso queries at scale. |
| **Dependencies** | `pixi.js`, `rbush` |

---

### TabMarchingAnts.vue

| | |
|---|---|
| **Feature name** | Marching ants selection border via phase-math dashed polyline rebuild each frame |
| **File path** | `src/tabs/TabMarchingAnts.vue` |
| **Key line ranges** | `15-27` (reactive controls), `31-39` (drawObjects), `41-88` (drawDashedPolyline), `90-94` (getRectPoly), `96-106` (onTick) |
| **Pattern summary** | Pixi v8 has no `lineDashOffset`. This tab simulates it by redrawing the entire dashed path each frame with a shifted `offset`. Two passes per rectangle: white dashes, then black dashes shifted by `dashLen + gapLen` so they interleave. `drawDashedPolyline` walks each segment, computes phase along the path, and emits `moveTo`/`lineTo` only for dash portions. |
| **Gotchas** | **Float guard:** `if (nextT <= t) break;` prevents infinite loops when `step` is smaller than the ULP of `t`. `beginPath()` isolates each stroke call. `gfx.stroke()` is called once per color pass, not per segment. The phase math uses modulo with double-wrap protection: `((offset % period) + period) % period`. |
| **flora-studio relevance** | **Reference implementation.** The phase-math approach works for arbitrary polylines (not just rectangles) but rebuilds geometry each frame. Compare with TilingSprite and Davidfig approaches in the tabs below. |
| **Dependencies** | `pixi.js` |

---

### TabMarchingAntsTiling.vue

| | |
|---|---|
| **Feature name** | Marching ants via `TilingSprite` — no geometry rebuild, rectangles only |
| **File path** | `src/tabs/TabMarchingAntsTiling.vue` |
| **Key line ranges** | `15-37` (reactive controls + types), `39-49` (makeDashTexture), `51-59` (destroyMarquees), `61-93` (buildMarquees), `95-116` (onTick), `118-120` (watch), `122-149` (onMounted) |
| **Pattern summary** | Creates a tiny dash texture (`dash+gap` pixels) with `DOMAdapter.get().createCanvas()`. Four `TilingSprite`s per rectangle edge (top, bottom, left, right). Two sets (white + black) with tilePosition shifted each frame. `tilePosition.x/y` animates in opposing directions per edge so dashes appear to flow around the rectangle. |
| **Gotchas** | `tex.source.scaleMode = 'nearest'` is required so the tiny texture doesn’t blur. `TilingSprite` only works for rectangles (straight edges). Each edge needs its own sprite. The modulo on `currentTime` prevents float drift. Destroying and recreating textures on parameter changes is necessary because `dashLen`/`gapLen` affect the texture size. |
| **flora-studio relevance** | **Best for rectangle-only selections.** Fastest approach (no geometry rebuild), but limited to axis-aligned or rotated rectangles. Not suitable for arbitrary bezier paths. |
| **Dependencies** | `pixi.js` |

---

### TabMarchingAntsDavidfig.vue

| | |
|---|---|
| **Feature name** | Marching ants via davidfig’s segIdx/segRem algorithm — ported to Pixi v8 |
| **File path** | `src/tabs/TabMarchingAntsDavidfig.vue` |
| **Key line ranges** | `15-41` (reactive controls), `43-111` (drawDashedPolylineDavidfig), `113-125` (onTick), `127-135` (drawObjects), `137-155` (onMounted) |
| **Pattern summary** | Instead of phase arithmetic, tracks the current dash-segment index and remaining distance in that segment (`segIdx`, `segRem`). Walks the dash array while traversing each polyline segment. Supports arbitrary polylines. Rebuilds geometry each frame (same cost as phase-math approach) but avoids the gap-phase sign bug entirely. |
| **Gotchas** | `dashIndex % 2 === 0` means dash; odd means gap. `moveTo` repositions the cursor during gaps; `lineTo` extends the sub-path during dashes. One `stroke()` call per color pass. `lineLength` accumulates across segments so the dash pattern continues smoothly around corners. |
| **flora-studio relevance** | **Alternative to phase-math for arbitrary polylines.** Both approaches work; pick based on team preference. The Davidfig algorithm is slightly easier to debug because there is no modulo arithmetic on floating-point lengths. |
| **Dependencies** | `pixi.js` |

---

## Group: Text & UI

### TabTextAnnotation.vue

| | |
|---|---|
| **Feature name** | In-canvas text annotations with DOM `<input>` edit-in-place overlay |
| **File path** | `src/tabs/TabTextAnnotation.vue` |
| **Key line ranges** | `10-32` (reactive state + Annotation type), `39-50` (spawnBitmapText), `52-102` (addAnnotation), `104-127` (commitEdit / cancelEdit), `141-151` (onCanvasClick), `153-163` (onWindowMove), `165-213` (onMounted) |
| **Pattern summary** | Clicking the canvas creates a `BitmapText` label + an invisible `Graphics` hitArea. Clicking the hitArea enters edit mode: the Pixi text is hidden, a DOM `<input>` is absolutely positioned over it, and typing updates the text on blur/Enter. Empty text on commit deletes the annotation. Dragging moves the annotation. |
| **Gotchas** | **DOM overlay sync:** The `<input>` is positioned in screen pixels (not world), so it does **not** follow pan/zoom automatically — in a viewport-based app, you must re-position the input on every camera change (or close editing on zoom/pan). `nextTick(() => inputEl.value?.focus())` is required because Vue hasn’t rendered the input yet when `editing` becomes true. `e.stopPropagation()` on hitArea events prevents canvas clicks from creating new annotations. |
| **flora-studio relevance** | **Directly portable with modification.** The DOM-overlay pattern is the only sane way to get native text editing (spellcheck, emoji, copy/paste) in a canvas app. In flora-studio, the input must be re-positioned on viewport transform changes. |
| **Dependencies** | `pixi.js` |

---

### TabPixiUI.vue

| | |
|---|---|
| **Feature name** | In-canvas UI widgets via `@pixi/ui`: Button, Slider, CheckBox, ScrollBox |
| **File path** | `src/tabs/TabPixiUI.vue` |
| **Key line ranges** | `14-25` (reactive state), `27-38` (label/panel helpers), `40-51` (App init), `56-78` (Button), `80-111` (Slider), `113-133` (CheckBox), `135-152` (ScrollBox), `154-173` (event log ticker) |
| **Pattern summary** | Demonstrates `@pixi/ui` widgets built from `Graphics` + `Text` primitives. Button uses `Button` wrapper with `onPress.connect`. Slider uses track/fill/handle Graphics. CheckBox uses unchecked/checked Graphics states. ScrollBox uses `addItems()` with an array of Containers. |
| **Gotchas** | `@pixi/ui` widgets are **not** DOM elements — they live inside the Pixi scene graph and participate in Pixi’s event system. The Slider handle must be a `Graphics` with a circle. The event log is rebuilt every ticker frame (naïve but sufficient for a demo). |
| **flora-studio relevance** | **TBD / experimental.** `@pixi/ui` is useful for in-canvas toolbars or floating panels, but flora-studio’s UI is primarily Vue-based DOM. This tab proves the library works if needed for specialized canvas chrome. |
| **Dependencies** | `pixi.js`, `@pixi/ui` |

---

## Group: Viewport

### TabViewport.vue

| | |
|---|---|
| **Feature name** | `pixi-viewport` integration: drag, wheel zoom, decelerate, pinch, clampZoom, and Control+scroll panning |
| **File path** | `src/tabs/TabViewport.vue` |
| **Key line ranges** | `14-25` (reactive state), `29-59` (buildScene), `61-99` (onMounted: viewport setup), `101-126` (Control+scroll panning handlers) |
| **Pattern summary** | Standard `pixi-viewport` setup: `new Viewport({ screenWidth, screenHeight, worldWidth, worldHeight, events: app.renderer.events })`, then chain `.drag().wheel({ smooth: 8 }).decelerate({ friction: 0.93 }).clampZoom({ minScale, maxScale }).pinch()`. Content is batched into single `Graphics` objects (grid + circles) for performance. |
| **Gotchas** | `events: app.renderer.events` is **required** in Pixi v8 — the viewport must share the renderer’s event system. `viewport.fit()` + `viewport.moveCenter()` sets the initial camera. Control+scroll panning is implemented by listening to `window` keydown/keyup and canvas wheel, then calling `viewport.moveCenter()` manually when Control is held. |
| **flora-studio relevance** | **Directly portable.** This is the canonical viewport setup used in `PixiCanvas.vue` and `TabLeaderLine.vue`. |
| **Dependencies** | `pixi.js`, `pixi-viewport` |

---

## Shared Infrastructure

### PixiCanvas.vue

| | |
|---|---|
| **Pattern** | Vue ↔ Pixi bridge: owns the `Application`, `Viewport`, and background lasso logic; delegates rendering to `PixiRenderer` |
| **Key line ranges** | `39-43` (lasso state), `45-48` (screenToWorld), `50-151` (onMounted: App + Viewport init, bg click handler, lasso, renderer wiring), `153-162` (onBeforeUnmount), `165-181` (exposed API), `183-187` (keyboard), `189-224` (lasso pointer events), `227-229` (prop watches) |
| **Which tabs depend** | `TabPlantRenderer.vue` (direct parent) |
| **Notes** | Transparent background quad (`bgGfx`) intercepts clicks for lasso/deselect. `viewport.plugins.pause('drag')` on lasso start prevents viewport drag conflict. Watches `props.plants`, `props.beds`, `props.selectedIds` and forwards to renderer. Exposes `setCamera`, `getShapeCount`, `setTickerMaxFPS`, `setBackgroundVisible`. |

---

### PixiRenderer.ts

| | |
|---|---|
| **Pattern** | Production plant + bed renderer with LOD, leader lines, drag handling, and selection styling |
| **Key line ranges** | `16-39` (constants: LOD thresholds, species colors, leader line constants), `46-98` (geometry helpers + svgToTexture), `100-118` (class constructor), `120-141` (init: BitmapFont + texture loading), `143-163` (setBackground: SVG site plan or fallback), `165-243` (syncPlants), `245-311` (drawLeaderLine), `313-333` (LOD system), `335-370` (syncBeds), `373-381` (setSelected), `391-399` (lasso select), `401-455` (plant drag), `457-494` (label drag) |
| **Which tabs depend** | `TabPlantRenderer.vue` (via `PixiCanvas.vue`) |
| **Notes** | **LOD:** Three levels — invisible (`< 0.05`), simple circle only (`< 0.12`), full detail (sprite + label + leader). **Drag:** Plant drag moves the entire selection if the plant is selected; otherwise moves only itself. Label drag updates offset and redraws leader line. **Leader line:** Direct port of C++ geometry (rayRectExit, circleEdgePoint, arrowhead). **SVG→Texture:** Loads species SVGs into 512×512 textures via an offscreen canvas. |

---

### useFps.ts

| | |
|---|---|
| **Pattern** | Composable for FPS, frame time, and heap memory tracking |
| **Key line ranges** | `1-32` (entire file) |
| **Which tabs depend** | Almost every tab imports this: `TabBitmapText`, `TabNPRRenderer`, `TabTreeSymbol`, `TabWindSway`, `TabKuwahara`, `TabPenTool`, `TabFreehand`, `TabKnife`, `TabBooleanOps`, `TabDashedLines`, `TabMeasure`, `TabSelection`, `TabSnapping`, `TabTransformGizmo`, `TabSpatialIndex`, `TabMarchingAnts`, `TabMarchingAntsTiling`, `TabMarchingAntsDavidfig`, `TabTextAnnotation`, `TabPixiUI`, `TabViewport` |
| **Notes** | Uses `requestAnimationFrame` loop (not Pixi ticker) so it works even when Pixi ticker is paused. Updates every 500ms. `heapMB` reads `performance.memory.usedJSHeapSize` — Chrome only. |

---

### useViewportPanning.ts

| | |
|---|---|
| **Pattern** | Control+scroll to pan instead of zoom |
| **Key line ranges** | `1-41` (entire file) |
| **Which tabs depend** | `TabViewport.vue` (embedded inline), could be extracted for general use |
| **Notes** | Returns a cleanup function. Listens to `window` for keydown/keyup and `canvas` for wheel. When Control is held, wheel events pan the viewport by calling `viewport.moveCenter()`. |

---

### docStore.ts

| | |
|---|---|
| **Pattern** | Pinia store for document data: plants, beds, undo stack |
| **Key line ranges** | `5-33` (types: DrawingPoint, BezierAnchor, Plant, Bed), `35-68` (procedurePlants generator), `70-130` (hardcodedBeds), `132-162` (store definition) |
| **Which tabs depend** | `TabPlantRenderer.vue` (via `PixiCanvas.vue` + `PixiRenderer.ts`) |
| **Notes** | Positions are in **drawing-space inches**, never pixels. Conversion to pixels happens in `PixiRenderer.ts` (`PX_PER_INCH = 96`). Undo stack stores `{ id, oldPosition, newPosition }` and is capped at 10 entries. |

---

### selectionStore.ts

| | |
|---|---|
| **Pattern** | Pinia store for selection state |
| **Key line ranges** | `1-32` (entire file) |
| **Which tabs depend** | `TabPlantRenderer.vue` |
| **Notes** | `selectedIds` is a `Set<string>`. All mutations create a new Set to trigger Vue reactivity. `selectedPlantId` computed returns the first ID (or single ID) for single-selection UIs. |

---

### DashLine.ts

| | |
|---|---|
| **Pattern** | Standalone dashed line utility (RapiD port) |
| **Key line ranges** | `1-77` (entire file) |
| **Which tabs depend** | `TabDashedLines.vue` |
| **Notes** | Non-texture mode only. Walks the dash array segment-by-segment and calls `stroke()` for each dash. Supports arbitrary dash patterns (e.g., `[20, 5, 5, 5]`). Does **not** support curves — only straight segments. For curves, flatten first or use the marching-ants approaches. |

---

### measureUtils.ts

| | |
|---|---|
| **Pattern** | Measurement math: distance, area, bezier length, unit conversion, formatting |
| **Key line ranges** | `1-95` (entire file) |
| **Which tabs depend** | `TabMeasure.vue` |
| **Notes** | `pxToFeet(px, pxPerInch=96, ftPerInch=20)` — default scale is 1" = 20'. `polygonAreaPx` uses shoelace formula. `pathLengthPx` uses `bezier-js` adaptive length. `formatFeet` outputs `X' Y"` notation. |

---

### pathFit.ts

| | |
|---|---|
| **Pattern** | Raw point cloud → cubic bezier path via RDP simplification + fit-curve |
| **Key line ranges** | `1-60` (entire file) |
| **Which tabs depend** | `TabFreehand.vue` |
| **Notes** | Two-step pipeline: (1) `simplify-js` for RDP simplification, (2) `fit-curve` for cubic bezier fitting. Default tolerance = 2.5px (RDP), fitError = 4px. Returns `BezierTuple[]` which `drawFittedPath` renders into a `Graphics`. |

---

### snapUtils.ts

| | |
|---|---|
| **Pattern** | Snap math: grid, vertex, edge |
| **Key line ranges** | `1-36` (entire file) |
| **Which tabs depend** | `TabSnapping.vue` |
| **Notes** | `snapToGrid` uses `Math.round`. `snapToVertex` returns the nearest vertex within threshold. `snapToEdge` projects the point onto each edge segment (clamped to [0,1]) and returns the closest projection within threshold. |

---

### treeSymbol.ts

| | |
|---|---|
| **Pattern** | Production plan-view tree symbol drawer with caching guidance |
| **Key line ranges** | `60-145` (public API: `drawTreeSymbol`), `147-281` (style implementations), `283-310` (utilities: `_darken`, `hashId`), `312-382` (`drawFourSpeciesDemo`) |
| **Which tabs depend** | `TabTransformGizmo.vue`, `TabTreeSymbol.vue` (superseded by this file) |
| **Notes** | **Caching:** Call `gfx.cacheAsTexture(true)` (or with `{ resolution: devicePixelRatio }`) on each **individual** plant Graphics. **Never** cache the parent Container that filters are applied to. Uses `mulberry32` seeded RNG for stable per-plant wobble. `SPECIES_COLORS` matches `PixiRenderer.ts`. Three styles: watercolor (soft fill + spokes), sketch (wobbly outline + bold spokes), technical (clean CAD). |

---

### TodoPanel.vue

| | |
|---|---|
| **Pattern** | Sidebar todo/checklist panel with localStorage persistence and tab navigation |
| **Key line ranges** | `16-218` (DEFAULTS array — defines every tab’s verification checklist), `220-293` (CRUD + selection logic) |
| **Which tabs depend** | None (consumed by `App.vue`) |
| **Notes** | `STORAGE_KEY = 'pixi-features-todo-v4'`. Each item has an optional `tabId`; clicking an item navigates to that tab. Completed items are tracked in `localStorage`. The DEFAULTS array is a useful reference for what each tab is supposed to prove. |

---

## Filters Library

All filters live in `src/lib/filters/`.

### AnisotropicKuwaharaFilter.ts
- **3-pass filter:** Sobel structure tensor → Gaussian blur → anisotropic Kuwahara.
- **Status:** DISABLED in production due to Pixi v8 `FilterSystem` cross-context bug when recursively calling `filterManager.applyFilter()` inside an overridden `apply()`.
- **Key lines:** `26-53` (Sobel pass), `59-146` (Kuwahara pass), `175-276` (Filter class with `apply()` override).
- **Notes:** Uses `RenderTexture` ping-pong. Uniforms must be flat (no interface blocks). Sampler resources must be at top-level of `resources`, not inside `UniformGroup`.

### CrosshatchFilter.ts
- **Sketch / colored-pencil crosshatch effect.** World-space hatch lines using `uWorldMatrix`.
- **Key lines:** `4-78` (fragment shader with `hatchLine` function).
- **Notes:** Three hatch directions (diagonal ×2 + horizontal). Tone thresholds determine which layers fire. Un-premultiplies source sprite before darken blend.

### GridFilter.ts
- **Infinite analytical grid.** No geometry rebuild on zoom.
- **Key lines:** `5-47` (fragment shader).
- **Notes:** Uses analytical derivatives (`1 / minorPxPerCell`) instead of `fwidth()`. Minor lines fade when zoomed out. Major lines every 5 cells.

### KuwaharaFilter.ts
- **Single-pass isotropic Kuwahara.** Stable and production-ready.
- **Key lines:** `19-91` (fragment shader: 4 quadrant windows, lowest-variance mean).
- **Notes:** Dynamic loop bounds require `#version 300 es`. `padding` must equal `radius`.

### RisographFilter.ts
- **Two-ink risograph simulation:** halftone dots, misregistration, grain.
- **Key lines:** `16-88` (fragment shader), `90-107` (params + palettes).
- **Notes:** Per-species ink palettes (`RISO_INK_PALETTES`). Paper color is uniform. `uMisregistration` shifts the second ink layer in screen pixels.

### WatercolorWashFilter.ts
- **Watercolor wash:** species tint, wetness, pigment granulation, edge fringe, paper grain.
- **Key lines:** `7-78` (fragment shader with 5-octave fbm).
- **Notes:** Blends 45% wash + 55% original sprite to preserve botanical detail. Uses `GLSL_HASH21_VNOISE` from `glslNoise.ts`.

### WobbleFilter.ts
- **Displacement distortion:** 3-octave fbm noise offset in world space.
- **Key lines:** `7-45` (fragment shader).
- **Notes:** `uWorldMatrix` keeps distortion world-locked during pan/zoom. `uScale` controls displacement magnitude.

### glslNoise.ts
- **Shared GLSL utilities:** `hash21()` + `vnoise()` (value noise).
- **Key lines:** `4-18` (template string).
- **Notes:** Prefix this to any filter fragment shader that needs noise. Each filter defines its own `fbm()` since octave counts differ.

---

## Cross-Reference Matrix

| File | Used By |
|------|---------|
| `useFps.ts` | All tabs except `TabPlantRenderer` (has its own loop) |
| `PixiCanvas.vue` | `TabPlantRenderer.vue` |
| `PixiRenderer.ts` | `PixiCanvas.vue` |
| `docStore.ts` | `TabPlantRenderer.vue` |
| `selectionStore.ts` | `TabPlantRenderer.vue` |
| `DashLine.ts` | `TabDashedLines.vue` |
| `measureUtils.ts` | `TabMeasure.vue` |
| `pathFit.ts` | `TabFreehand.vue` |
| `snapUtils.ts` | `TabSnapping.vue` |
| `treeSymbol.ts` | `TabTransformGizmo.vue`, `TabTreeSymbol.vue` |
| `useViewportPanning.ts` | Inline in `TabViewport.vue` |
| `AnisotropicKuwaharaFilter.ts` | None (disabled) |
| `CrosshatchFilter.ts` | `TabNPRRenderer.vue` |
| `GridFilter.ts` | `TabSnapping.vue` |
| `KuwaharaFilter.ts` | `TabKuwahara.vue` |
| `RisographFilter.ts` | `TabNPRRenderer.vue` |
| `WatercolorWashFilter.ts` | `TabNPRRenderer.vue` |
| `WobbleFilter.ts` | `TabNPRRenderer.vue` |
| `glslNoise.ts` | `WatercolorWashFilter.ts`, `WobbleFilter.ts` |

---

## Architecture Decisions Recorded Here

1. **Text rendering tier:** `Text` (CPU rasterized) → `BitmapText` (GPU atlas, pixelates at high zoom) → **MSDF** (recommended for flora-studio labels).
2. **Event isolation:** `e.stopPropagation()` + `viewport.plugins.pause('drag')` is the proven pattern for nested drags (label inside plant).
3. **Ticker dirty flag:** Never rebuild Graphics in `pointermove`. Set `dirty = true` and rebuild in `app.ticker`.
4. **Instancing:** `Mesh` + `Geometry` with `instance: true` for GPU-instanced fields (wind sway). Prefer WebGL.
5. **Filter world matrix:** Filters that need world-locked patterns (grid, crosshatch, wobble) require `uWorldMatrix` updated from `viewport.localTransform.invert()` each frame.
6. **Spatial indexing:** `rbush` for hit-testing and lasso at scale.
7. **Boolean ops:** Flatten bezier → polyline via `bezier-js getLUT()`, then `polygon-clipping`.
8. **Freehand fitting:** `simplify-js` (RDP) → `fit-curve` → cubic bezier `Bed` data model.
9. **Marching ants:** Three proven approaches. Pick based on shape type: `TilingSprite` for rectangles, phase-math or Davidfig for arbitrary polylines.
10. **Caching:** `gfx.cacheAsTexture(true)` on individual leaf Graphics only. Never cache a parent Container that has active filters.

---

*End of catalog.*
