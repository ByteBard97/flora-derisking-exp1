# Experiment 1: Rendering & Drag POC

**Status:** Scaffolded — ready to run, not yet measured
**Goal:** Prove Konva + Vue 3 renders 300 plants at 60fps with responsive drag

## Quick start

```bash
npm install
npm run dev
# → http://localhost:5173
```

## What's in the scaffold

- `src/stores/docStore.ts` — 300 procedurally placed plants, 5 hardcoded beds, 10-step undo
- `src/stores/viewportStore.ts` — zoom/pan with `drawingToCanvas`/`canvasToDrawing`
- `src/stores/selectionStore.ts` — selected plant ID
- `src/canvas/projection/CanvasProjection.ts` — Pinia → Konva reconciler (write-only)
- `src/App.vue` — Stage setup, pan/zoom handlers, drag-harvest, Cmd+Z undo

## Known placeholder

The background layer is a solid-color rectangle. Before measurement, replace it with
a real backend-generated composite site plan PNG for a real lot.
See `docs/FLORA_EXECUTION_PLAN.md` Week 0 task: "Identify the real aerial photo / parcel / DEM composite."

## Measurements (see v2 derisking doc)

Run all 7 measurements on the named hardware target (Annie's machine) before declaring go/no-go.
Record results in `../measurements/exp-1/`. One file per measurement.

## Lint rule

Konva imports are restricted to `src/canvas/projection/**` and `src/canvas/tools/**`.
Run `npm run lint` to verify.
