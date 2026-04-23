---
name: Pixi.js derisking experiments — current progress
description: What's been spiked, what's next, and key decisions in derisking-experiments/pixi-features
type: project
originSessionId: bba44de7-19c8-42a9-90e3-2598db8a45ac
---
All derisking work lives in `/Users/ceres/Desktop/flora/derisking-experiments/`. The main spike app is `pixi-features/` — a tabbed Vite/Vue 3 SPA at http://localhost:5174/. Git repo initialized on master branch.

**Why:** Proving out Pixi.js v8 as the rendering foundation for flora-studio before writing production code.

## Completed spikes (as of 2026-04-23)

| Spike | Tab | Result |
|---|---|---|
| Plant rendering (circle + SVG sprite + BitmapText label) | Plant Renderer | ✅ Works |
| Bezier bed rendering | Plant Renderer | ✅ Works |
| Background SVG (site plan) | Plant Renderer | ✅ Works — loaded via `Assets.load` with `resolution:5, autoGenerateMipmaps:true`, height from texture aspect ratio |
| Pan/zoom via pixi-viewport | Plant Renderer + Leader Line | ✅ Buttery smooth — `drag().wheel({smooth:8}).decelerate({friction:0.93}).pinch()` |
| Click-to-select + drag-to-move | Plant Renderer | ✅ Works |
| Multi-select: lasso + Shift+click + group drag | Plant Renderer | ✅ Works |
| LOD (level of detail) | Plant Renderer | ✅ Works — lod2 (≥0.15): full; lod1 (0.05–0.15): circle only; lod0 (<0.05): invisible |
| Draggable label + leader line | Leader Line | ✅ SPIKED — geometry ported from FloraLeaderLineDrawing.cpp |
| Leader lines on all 300 plants | Plant Renderer | ✅ Integrated — each plant has independently draggable label + live leader line |

## In progress (2026-04-23, left off here)

**MSDF text spike** — `TabMsdfText.vue` just created. MSDF atlas generated from Times New Roman at 48px/range 6:
- Atlas: `pixi-features/public/fonts/times-new-roman.png`
- Descriptor: `pixi-features/public/fonts/Times New Roman.fnt`
- Tab renders 300 labels at 3 mixed font sizes to test the old batcher bug
- **Still needs to be visually verified** — open the MSDF Text tab, zoom in/out, confirm labels are crisp at all zoom levels and no glyph corruption

## What's next after MSDF verification

1. **MSDF result**: if crisp → mark resolved in TODO.md, update fonts-and-text.md decision doc. If broken → fall back to regular BitmapText at fontSize:200.
2. **Bed hit testing + node editing** (Medium Risk) — click to select a bed, drag anchor nodes to reshape, click edge to insert node
3. **Performance benchmark** (Medium Risk) — formal fps measurement at 300+ plants with all layers during pan/zoom/drag; record in `measurements/renderer-pixi/`
4. **Bed fill / auto-scatter** — algorithm research done (2026-04-22), stack decided (fast-2d-poisson-disk-sampling + honeycomb-grid + @turf/boolean-point-in-polygon + bezier-js + simplex-noise); not building yet

## Key architecture decisions locked in

- **Viewport**: pixi-viewport with `drag({mouseButtons default}) + wheel + decelerate + pinch` — lasso selection uses `viewport.plugins.pause('drag')` on background pointerdown
- **SVG background**: `Assets.load({ src, data: { resolution: 5, autoGenerateMipmaps: true } })`, sprite height from `texture.height/texture.width` ratio
- **Leader lines**: rayRectExit + circleEdgePoint geometry from FloraLeaderLineDrawing.cpp; ARROW_LENGTH_FACTOR=10, ARROW_HALF_WIDTH_FACTOR=3 for screen (vs 4/1 for print)
- **LOD thresholds**: LOD_INVISIBLE=0.05, LOD_SIMPLE=0.15 — named constants in PixiRenderer.ts, TBD adjustment after measurement
- **MSDF fonts**: build-time generation via AssetPack `msdfFont()` pipe in production (flora-studio); spike uses msdf-bmfont-xml CLI directly
- **Bed fill**: two modes (Natural scatter via Poisson disk, Grid via hex lattice); not building until after LOD + collision are proven

## File locations

| File | Purpose |
|---|---|
| `pixi-features/src/canvas/PixiRenderer.ts` | Core plant/bed/bg renderer, LOD, leader lines, multi-select drag |
| `pixi-features/src/canvas/PixiCanvas.vue` | Pixi app init, viewport, lasso, event routing |
| `pixi-features/src/tabs/TabPlantRenderer.vue` | Main renderer test tab with HUD |
| `pixi-features/src/tabs/TabLeaderLine.vue` | Original single-plant leader line spike |
| `pixi-features/src/tabs/TabMsdfText.vue` | MSDF verification spike (just created, needs visual check) |
| `pixi-features/src/stores/selectionStore.ts` | `selectedIds: Set<string>`, togglePlant, selectMany |
| `derisking-experiments/TODO.md` | Full spike checklist with research notes |
| `derisking-experiments/ARCHITECTURE.md` | Full design decisions doc |
| `flora-studio/docs/fonts-and-text.md` | MSDF font pipeline decision |
