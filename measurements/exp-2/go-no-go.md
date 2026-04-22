# Experiment 2 — Go/No-Go Record

**Date:** 2026-04-21  
**Stack:** tldraw v4.5.9 + Vue 3 + Pinia + veaury bridge  
**Machine:** M1 MacBook (dev), Playwright headed Chromium  

---

## Key Findings

### Performance (300 plants, Playwright headed Chromium)

| Scenario | FPS | p95 frame |
|---|---|---|
| Still, any plant count, any bg, z=0.08–3.0 | 120.5 | ~12ms |
| Pan, z≥0.3 (normal usage zoom) | 120.5 | ~10ms |
| Pan, z=0.08 (fully zoomed out) | 42–46 | ~42ms |
| Zoom oscillation 0.05–2.0 | 120.5 | ~58ms |

### What plant count affects: nothing
50 plants pans at the same FPS as 300 plants. tldraw's bottleneck is per-camera-update JS overhead, not per-shape rendering cost.

### What background textures affect: nothing
`none` vs `bg1` vs `bg3` (tiled 400px PNG) — identical FPS across all scenarios.

### What render mode affects: nothing
SVG `<image>` vs PNG `<image>` vs `<use>` instancing — identical FPS.

### Root cause of 42fps at z=0.08
tldraw recalculates transforms for all visible shapes on every camera frame. At z=0.08 all 300 plants are in-viewport simultaneously. At z≥0.3 viewport culling removes most shapes and panning is smooth.

**Fix applied:** default camera changed from `z: 0.08` → `z: 0.3`.

---

## Go/No-Go: GO ✓

**Rationale:**
- 120fps pan at normal usage zoom (z≥0.3) ✓
- SVG plants are crisp vectors at any zoom level ✓  
- Drag, multi-select, pinch-zoom work natively via tldraw ✓
- Vue ↔ React bridge (veaury) is stable ✓
- Only bad scenario (42fps at z=0.08) only occurs when plants are ~4px on screen

**Known limitations:**
- tldraw BSL 1.1 license — $6k/yr for commercial use
- 42fps pan when fully zoomed out (all 300 plants visible simultaneously)
- Benchmark requires headed browser (veaury React bridge doesn't mount in headless Chromium)

**Recommendation:** proceed with tldraw as the canvas layer for flora-cad.
