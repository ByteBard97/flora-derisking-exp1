# Flora Architecture Derisking Experiments — v2

**Status:** Gates required before committing to production build
**Date:** April 2026
**Supersedes:** v1 (April 2026)
**Context:** This document defines the experiments needed to validate the proposed Flora architecture (Vue 3 + Konva + Pinia + rbush + Turf.js worker + backend-assembled GIS) before writing production code.

**Changes from v1:** Incorporates review findings. Key changes: the ESLint rule now enforces import boundaries (not method calls), the coordinate conversion unit tests were added to Experiment 0, the consistency assertion was strengthened to check ID membership, the dragend read is explicitly named as the single permitted exception, @odiak/fit-curve is committed to, self-intersecting paths are addressed in Experiment 2, Experiment 3 separates PDF-for-printing from SVG-for-editing, and hardware target is now required.

The architecture has three identified risks that cannot be resolved by research alone — only by building something and measuring it. Each experiment targets one risk. Each has a clear go/no-go decision point. Running the experiments out of order is tempting and wrong: Experiment 1 is cheap and resolves the architecture's deepest structural risk; Experiments 2 and 3 are only worth running if Experiment 1 succeeds.

---

## Experiment 0: Prerequisites (Do This First)

**Goal:** Before any canvas code is written, establish the mechanical enforcement of the Konva write-only discipline and validate that coordinate conversions are numerically stable.

**Why first:** The architecture's entire claim to fix flora-uxp's split-brain pattern rests on two constraints being structural, not cultural: (a) Konva state cannot leak into application code, and (b) the drawing↔canvas coordinate system conversions are correct and round-trip cleanly. If either invariant is wrong, every subsequent experiment is built on sand.

### 0a: Import-Boundary Lint Rule

**The mechanism:** Ban importing from `konva` (and `vue-konva`'s canvas-adjacent APIs) outside two allowlisted directories. If a file cannot import Konva, it cannot call Konva methods. This is faster, more reliable, and simpler than trying to detect Konva method calls via AST matching — `no-restricted-syntax` operates on syntactic patterns and cannot tell whether a `.x()` call targets a Konva node or a panel coordinate object.

**Implementation:** Use `eslint-plugin-boundaries` (or equivalent). Configure import restrictions:

```
Allowed to import 'konva' and 'konva/*':
  - src/canvas/projection/**
  - src/canvas/tools/**

All other files: disallowed at error level.
CI must fail on violation.
```

**The tool-file allowlist is NOT a free pass.** Write in `src/canvas/tools/README.md`:

> Tool files may read Konva state only at gesture-end events (`dragend`, `pointerup`, `mouseup`). Reads during an in-progress gesture (`dragmove`, `pointermove`) are not permitted. Any value read from a Konva node must, in the same function, be converted to drawing coordinates via `viewportStore` and dispatched to Pinia. There is no case where a tool file holds Konva-sourced state across event boundaries. Violations of this rule must not be merged.

This constraint is not enforceable by lint; it is enforceable by code review. The README makes it explicit so that a code review comment can cite a written rule.

**Deliverable:** A committed `.eslintrc`, a committed README in `src/canvas/tools/`, and a CI job that fails on a deliberate test violation.

### 0b: Coordinate Conversion Unit Tests

**The mechanism:** The entire architecture rests on `drawingToCanvas` and `canvasToDrawing` being correct, composable, and stable under floating-point arithmetic. These are pure functions. They must have unit tests before any canvas code is written.

**Required test cases:**
- Round-trip identity: for a representative set of drawing points (e.g., 20 hand-chosen values including 0, integers, fractions like 4.5, edge cases like 0.1 + 0.2), assert `canvasToDrawing(drawingToCanvas(p)) === p` to within a specified epsilon (e.g., 0.0001 inches).
- Scale invariance: the same drawing point at different zoom levels produces different canvas points but always round-trips back to the same drawing point.
- Pan invariance: same property, under pan offsets.
- Known-value assertions: at zoom=1, pxPerInch=96, panX=0, panY=0, verify `drawingToCanvas({x: 1, y: 1}) === {x: 96, y: 96}`. These are hand-computed and pin down the math.
- Zero and negative coordinates (parcels may have origins that aren't top-left).

**What this catches:** Floating-point drift that causes "my plant moved 0.02 inches after undo-redo" bugs six months in. Silent off-by-one errors in the transform math. Regressions if someone modifies the conversion later.

**Deliverable:** A test file at `src/canvas/viewport/__tests__/coordinates.spec.ts` with passing tests. Run in CI.

**Time budget for all of Experiment 0:** 6–10 hours.

**Success criteria:** Both the lint rule and the unit tests exist in the repo and pass in CI. No go/no-go gate — this is infrastructure, not an experiment.

---

## Experiment 1: The Rendering & Interaction POC

**Goal:** Prove that Konva + Vue 3 can render Flora's target load at 60fps on representative user hardware with responsive interactions, and that the Pinia-as-source-of-truth pattern holds through a realistic drag interaction.

**Why this experiment:** Three debate concerns converge here:
- Konva Canvas2D performance ceiling with Flora-shaped content (groups with circle + sprite + label, not bare shapes)
- Live-drag architecture — does the local-buffer-then-commit pattern actually feel smooth?
- Rendering a large rasterized background layer alongside interactive shapes

If this experiment fails, the architecture is wrong and needs to change before PDF export even matters.

### Hardware Target (Required Before Measurement)

The pass thresholds below are meaningless without naming the measurement machine. Before running the experiment:

- **Primary target:** Annie's actual working computer. If she's the primary user, that's the floor.
- **If Annie's machine is unavailable, fallback spec:** a 4-to-5-year-old Intel or AMD laptop with integrated graphics, 8GB RAM, a 1080p display. This represents the realistic lower bound of professional landscape architecture hardware.
- **Do NOT primarily measure on an M-series Mac.** The engineer's M-series will pass everything and hide problems.
- If Annie's machine passes but the fallback spec fails, document that as a product-defined minimum hardware requirement.

### Scope

**Build a single Vue 3 + Konva page with no backend, no auth, no routing.** Just an HTML page demonstrating the core rendering loop and one real interaction.

**What to include:**

1. **A Pinia `docStore`** with a Map of ~300 plants and ~5 beds. Plant shape: `{ id, speciesType, position: {x,y}, rotation, radius }` in drawing-inches coordinates. Bed shape: `{ id, path: { anchors } }` with 2–4 hand-written closed bezier beds.

2. **A `ViewportStore`** with `pxPerInch`, `zoom`, `panX`, `panY`, and centralized `drawingToCanvas`/`canvasToDrawing` conversion functions. These are the functions already unit-tested in Experiment 0.

3. **A single Konva Stage with three layers:**
   - Background layer (cached, `listening: false`) — load a real backend-generated composite site plan PNG for a real lot. Not a placeholder.
   - Bed layer — renders beds as `Konva.Path` with SVG `d` strings generated from anchor data.
   - Plant layer — each plant as a `Konva.Group` containing a `Konva.Circle` + a `Konva.Image` from one of ~4 distinct sprite SVGs (shared across plants to test the common case) + a `Konva.Text` label.

4. **A `CanvasProjection` service** that subscribes to `docStore` mutations and reconciles Konva. No data stored on Konva nodes except `plantId` / `bedId` back-references. Every shape is created, updated, and destroyed exclusively by the projection in response to Pinia mutations.

5. **Pan/zoom** driven by viewport store. Wheel to zoom, space+drag or middle-mouse to pan. Background layer stays cached during pan.

6. **Click-to-select** using Konva's native hit-test. On click, dispatch to a `selectionStore`. Show a `Konva.Transformer` bound to the selected node.

7. **The live-drag implementation — this is the critical part.**
   - On `dragstart`, capture the plant ID and starting position *from the doc store* (not Konva).
   - During `dragmove`, let Konva update the node's position locally — **do not dispatch Pinia**.
   - On `dragend`, **perform the drag-harvest read**: call `node.position()` once, convert to drawing coordinates, dispatch a single `docStore.updatePlantPosition(id, {x,y})` action. The projection's subscription is a no-op because the node is already in the right place (optional optimization: projection checks target vs. current before writing).

8. **An 8–10 step undo stack** using a simple command pattern over the `updatePlantPosition` action. Cmd+Z reverts the last drag. Proves undo works end-to-end.

9. **Dev-mode consistency assertion — ID membership, not count.**

```typescript
// Runs after every Pinia mutation in development mode
function assertCanvasConsistency() {
  // Every document plant has exactly one node
  for (const id of docStore.plants.keys()) {
    console.assert(
      plantIdToNode.has(id),
      `Missing Konva node for plant ${id}`
    )
  }
  // Every node maps to a valid document plant
  for (const node of plantLayer.getChildren()) {
    const plantId = node.getAttr('plantId')
    console.assert(
      plantId && docStore.plants.has(plantId),
      `Orphaned node: plantId=${plantId}`
    )
  }
  // No duplicate nodes per plantId
  const ids = plantLayer.getChildren().map(n => n.getAttr('plantId'))
  console.assert(
    new Set(ids).size === ids.length,
    `Duplicate nodes detected`
  )
}
```

This runs in O(n) and catches the real failure modes (orphans, duplicates, drift) that a simple count-equality check would miss.

### The One Permitted Konva Read — Name It Explicitly

Step 7's `node.position()` call at `dragend` is **the drag-harvest pattern**. It is definitionally a Konva state read, which the architecture prohibits everywhere else. It is justified because:

- Native Konva drag updated the node's position without Pinia's knowledge (by design — it's what makes drag feel smooth).
- At gesture end, the final position must be harvested once to close the loop.
- The read is immediately followed by drawing-coordinate conversion and a Pinia dispatch in the same function.

**Write in `src/canvas/tools/README.md` the drag-harvest pattern is the single permitted Konva state read.** Any other engineer proposing "just one more read" must explain why their case is analogous, not treat the drag-harvest as a precedent for general reads.

### What to deliberately skip

- No species library UI
- No bed drawing tool (beds are hardcoded)
- No labels edit UI
- No save/load (state resets on refresh)
- No Django backend calls
- No Tauri wrapper
- No tooltips, hover effects, snapping, alignment tools
- No PDF export (Experiment 3)
- No freehand-to-bezier (Experiment 2)

### Measurements

**1. Sustained FPS during pan/zoom**
- Chrome DevTools Performance tab. Record 10s of continuous pan at moderate speed across the viewport, then 10s of zoom in/out.
- **Pass:** 55+ fps sustained on the named hardware target, no frame spikes > 33ms.
- **Fail:** Sustained dip below 45fps, or frequent frames > 50ms.
- **If fail:** Try `perfectDrawEnabled: false` on plant groups, `listening: false` on non-interactive layers, sprite caching via `node.cache()`. Document which optimizations were required — they become permanent requirements.

**2. Drag responsiveness**
- Drag a plant across the canvas for 5 seconds continuously.
- **Pass:** Cursor-to-shape lag imperceptible. Shape follows pointer smoothly.
- **Fail:** Visible lag, stutter, or shape lagging cursor.
- **If fail:** Verify `dragmove` isn't triggering Pinia dispatches. If still laggy with pure Konva-native drag, that's a Konva performance finding — architecture may need Pixi.js instead.

**3. Single-commit correctness**
- Drag a plant. Check `docStore.plants.get(id).position` matches final visible position. Count mutations.
- **Pass:** Exactly 1 mutation, final position correct.
- **Fail:** Multiple mutations, or position mismatched.

**4. Time-to-interactive on initial load**
- Hard refresh. Measure from page load to "all 300 plants visible and canvas responds to input."
- **Pass:** < 2 seconds on named hardware target.
- **Fail:** > 4 seconds, or visible layout jank during load.

**5. Memory stability**
- Chrome DevTools Memory tab. Heap snapshot. Pan/zoom/drag for 2 minutes. Second snapshot.
- **Pass:** Heap growth < 10MB between snapshots. No detached DOM nodes accumulating.
- **Fail:** Growing heap, detached node leak, or > 50MB steady-state for 300 shapes.

**6. Undo roundtrip**
- Drag 5 plants in sequence. Cmd+Z five times.
- **Pass:** All positions return to originals to the pixel. Rendering matches Pinia.
- **Fail:** Any drift or mismatch.

**7. Consistency assertion**
- Dev-console during 5 minutes of normal interaction.
- **Pass:** Zero assertion failures.
- **Fail:** Any assertion failure. Investigate and fix before declaring experiment complete.

### Go/No-Go Decision

**Go:** All seven measurements pass on the named hardware target. Proceed to Experiment 2.

**Conditional Go:** Measurements 1–2 pass with specific Konva optimizations applied. Document the optimizations as required baseline and note which scenarios would invalidate them.

**No-Go:** Measurements 1 or 2 fail persistently even with optimizations. Stack needs rethinking. Most likely path: re-evaluate Pixi.js with a thin Vue wrapper, or the SVG + daybrush alternative from the debate.

### Time budget

**5–8 engineer days** for someone fluent in Vue 3. Add 2–3 days if learning Konva from scratch.

---

## Experiment 2: The Bed Drawing Tool

**Goal:** Prove that a custom freehand-to-bezier tool can produce editable `BedShape` data through the Pinia-owned architecture, and that the Turf.js worker pattern delivers geometry operations (area, containment, self-intersection detection) without blocking the UI.

**Why this experiment:** Planting beds are the primary drawing operation. The debate identified Turf.js as the right geometry substrate over Paper.js, but we haven't proven that Turf + fit-curve + the worker pattern delivers the UX a landscape architect needs. And we haven't proven that a custom Konva tool can produce bezier shapes cleanly inside the projection discipline.

**Prerequisite:** Experiment 1 must pass.

### Committed Dependencies

- **Bezier fitting: `@odiak/fit-curve`**, vendored into `src/canvas/worker/vendor/fit-curve/`. The team owns the source. Not "fit-curve or equivalent" — this is the committed choice. If a specific operation requires a different library later, revisit then; do not hedge now.
- **Geometry operations: `@turf/turf`** (or tree-shaken individual `@turf/*` packages).
- **Self-intersection detection: `@turf/kinks`**.

### Scope

Extend Experiment 1's app with:

1. **A `BedPenTool` as a Konva-native tool class.** Activates on toolbar click. Captures raw pointer points during drag. Renders a live preview polyline on a temporary Konva layer. On `pointerup`, passes raw points to the worker.

2. **A Web Worker (`geometry.worker.ts`) bundling:**
   - `@odiak/fit-curve` for polyline → cubic bezier anchors
   - `@turf/turf` for area, centroid, simplify, union, intersection
   - `@turf/kinks` for self-intersection detection
   - Stable message API: `{ type, payload }` → `{ type, result }`

3. **The fit-curve flow:**
   - Tool sends raw points + tolerance to worker
   - Worker runs `kinks()` on the input polyline first; if self-intersection detected, return both the fit result AND a `selfIntersecting: true` flag with the number of intersections
   - Worker returns bezier anchors
   - Tool detects auto-close if endpoint is near start
   - If self-intersecting, log to console for the experiment measurement (product decision on behavior comes later)
   - Tool dispatches `docStore.addBed({ path: { anchors, closed }, meta: { selfIntersecting } })`
   - Projection creates a `Konva.Path` with generated `d` string

4. **Live area display.** When a bed is selected, dispatch `worker.computeArea(bed.path.anchors)`. Display returned area (in sq ft) in a HUD. Recompute on geometry change.

5. **One anchor-drag interaction.** Select a bed; expose square handles on each anchor. Dragging an anchor updates `docStore.updateBedAnchor(bedId, anchorId, {x,y})`. Validates that editing works through the architecture — not building the full pen tool, just proving one editing operation.

### Self-Intersection Handling

This experiment does NOT commit to a product behavior for self-intersecting paths. It commits to **detection and visibility**. Behavior decision (reject with user message / auto-resolve / accept silently) is a product decision that requires Annie's input and real usage data — not an engineering decision made mid-experiment.

The experiment's job: establish the detection mechanism and measure how frequently self-intersection occurs in natural freehand bed drawing. If it's rare (< 5% of beds drawn), a user-facing message on detection is sufficient. If it's common, a more sophisticated auto-resolve (via `turf.unkinkPolygon`) is needed. The data from this experiment drives that decision.

### Measurements

**1. Fit quality**
- Draw 10 representative planting bed shapes (organic, 3–4 inflection points each).
- **Pass:** Fitted beziers visually match freehand input within ~2px tolerance. Output has 4–12 anchors per bed.
- **Fail:** Visibly wrong curves, missed corners, or 50+ anchors per bed.

**2. Worker latency**
- Time from `pointerup` to bed on canvas.
- **Pass:** < 150ms for typical bed (200–500 input points).
- **Fail:** > 300ms or UI freezes during fit.

**3. Area calculation accuracy**
- Draw a bed with known dimensions (e.g., rough 10ft × 10ft square). Compare reported area.
- **Pass:** Within 5% of expected. Units are sq ft (not sq pixels).
- **Fail:** Wildly wrong numbers or wrong units.

**4. Worker doesn't block main thread**
- While fitting, attempt to pan the canvas.
- **Pass:** Pan smooth during fit. UI never freezes.
- **Fail:** Any UI stall during geometry computation.

**5. Anchor-drag maintains Pinia source of truth**
- Drag an anchor. Check Pinia matches visible position. Verify consistency assertion holds.
- **Pass:** One mutation on release, position correct, no desync.
- **Fail:** Multiple mutations, drift, or consistency failure.

**6. Undo works on bed creation and anchor drag**
- Create a bed, drag an anchor. Cmd+Z twice.
- **Pass:** Both operations reversible, canvas matches Pinia at each step.
- **Fail:** Any step doesn't reverse correctly.

**7. Self-intersection detection rate**
- Across the 10 test beds plus 10 additional naturalistic freehand beds, count how many trigger self-intersection detection.
- **Data-only measurement:** No pass/fail threshold. Record the number.
- **Used by product to decide:** user-message vs. auto-resolve vs. silent-accept.

### Go/No-Go Decision

**Go:** Measurements 1–6 pass. Geometry worker architecture validated. Record measurement 7. Proceed to Experiment 3.

**Conditional Go:** Measurement 1 (fit quality) acceptable but not great — tunable via tolerance. Document current tolerance; note full pen tool (v1.1) adds click-vertex authoring as alternative.

**No-Go:** Measurement 4 fails (worker blocks UI) — architecture broken, worker messaging wrong. Measurement 5 fails — projection pattern leaking. Either must be fixed before proceeding.

### Time budget

**4–6 engineer days.** Fit-curve integration and worker setup dominate; rest reuses Experiment 1.

---

## Experiment 3: The Export Gates

**Goal:** Prove that Flora's export paths produce output meeting landscape architect deliverable standards. This is the debate's second-biggest identified risk and the product's final-mile use case.

**Why this experiment:** A clean editor that can't produce usable deliverables is a failed product. There are two distinct downstream workflows, and a single export format cannot serve both:

- **PDF for printing/viewing/contractor handoff** — must be scale-accurate, print-ready, text-embedded, and openable in Adobe Reader by anyone.
- **SVG for downstream editing** — Annie and her collaborators currently hand off editable vectors for print shops and sign-makers. If Flora kills this capability, it replaces their existing Illustrator workflow but removes a feature.

These are separate measurements against separate format goals.

**Prerequisite:** Experiments 1 and 2 must pass. Real Flora content is needed to export.

### Scope

Using the app from Experiments 1+2:

1. **Hand-assemble a realistic target deliverable** from Annie's existing work, a reference published drawing, or a public-domain construction document. Required features:
   - Plant circles with SVG sprites at correct sizes
   - Plant labels (ref designators + optional species names)
   - Bed outlines (curved, filled with hatching or solid tint)
   - Dimension annotations (lines with arrows and measurement text)
   - Title block with project metadata
   - Property boundary
   - Background aerial or site plan
   - Drawing scale indicator (`1/8" = 1'-0"`)
   - Sheet size markers (ANSI D = 24"×36")

2. **Implement two separate `ExportService` methods:**
   - `exportPDF(doc, paperSize, scale)`: produces a scale-correct PDF via `stage.toSVG()` or projection iteration → `svg2pdf.js` → `jsPDF` with target paper size. Font embedding required.
   - `exportSVG(doc, paperSize, scale)`: produces a clean SVG with scale-correct viewBox, semantic grouping (plants / beds / labels as `<g>` groups with meaningful IDs), text-as-text (not paths).

3. **Print the PDF on a physical large-format printer at 1:1 scale.** Do NOT skip this. "Looks right on screen" does not validate print output.

### PDF Measurements

**1. Dimensional accuracy**
- Measure a known dimension on printed output with a ruler. Verify against declared drawing scale.
- **Pass:** Within 1% (a 120" bed measures 119.0"–121.0").
- **Fail:** Any scale drift > 2%.

**2. Line weight fidelity**
- Compare printed line weights across beds, dimensions, label leaders.
- **Pass:** Consistent, readable, neither hairline-invisible nor blobby.
- **Fail:** Lines disappear, rasterize, or wildly vary.

**3. Hatched fill reproduction**
- If target has hatched bed fills, check printed output.
- **Pass:** Hatches are vector, scalable, visible at print size.
- **Fail:** Hatches rasterize to ugly pixels, disappear, or render as solid fills.
- **Note:** If svg2pdf.js can't handle SVG patterns, known mitigation is rendering hatches as dense line patterns in the source SVG.

**4. Text legibility**
- Labels, dimension text, title block at print size.
- **Pass:** Text sharp, correct font, at design-size (not rasterized).
- **Fail:** Text rasterized, wrong font, or scaled wrong.

**5. Color accuracy**
- If the deliverable uses color, check print output.
- **Pass:** Colors print recognizably; semantic coding preserved.
- **Fail:** Colors shift, appear greyscale, or lose distinction.

**6. Font embedding**
- Generate PDF using the Flora design fonts. Open the PDF on a machine that does NOT have those fonts installed.
- **Pass:** Text renders correctly with the design fonts.
- **Fail:** Fonts substitute to system defaults, fall back to garbled glyphs, or disappear.
- **If this fails, the product decision is:** (a) bundle design fonts with the app and load via `jsPDF.addFont` — licensing implications, bundle size cost, but preserves text-select-ability — or (b) convert text to paths before export — loses text-select-ability, bloats file size. Document which path is chosen.

**7. Scale and print fidelity in Adobe Reader**
- Open the PDF in Adobe Reader. Verify document properties show correct page dimensions (24" × 36" for ANSI D). Zoom to 100% — verify the rendered scale matches declaration (at 96dpi screen, 10ft bed at `1/8" = 1'` scale should measure ~15px per foot × 10 = 150px).
- Text must be selectable (not rasterized).
- **Pass:** Page dimensions correct, zoom-to-100% renders at declared scale, text selects.
- **Fail:** Any of the above.
- **Note:** This replaces v1's "opens as editable vectors in Illustrator" measurement. That was the wrong bar — it conflated PDF-for-viewing with PDF-for-editing, which should never share a format.

**8. File size and generation time**
- PDF file size and time-to-generate for realistic project (200 plants + 5 beds + full annotations).
- **Pass:** File size < 10MB, generation time < 5 seconds.
- **Fail:** Multi-hundred-MB files, multi-minute generation, or browser freezes during export.

### SVG Measurements

**9. SVG structure and editability**
- Open exported SVG in Adobe Illustrator (or Inkscape for a free-software option).
- **Pass:** Shapes, text, and colors import as editable vectors. Plants grouped semantically (e.g., `<g id="plants">` containing `<g id="plant-01H...">`). Text is `<text>`, not paths. Bed fills and strokes are styled in ways downstream editors can modify.
- **Fail:** Everything imports flat, text is rasterized or path-ified, layer/group structure is incomprehensible.

**10. SVG dimensional correctness**
- The SVG should declare `viewBox`, `width`, and `height` such that importing at `1:1` in Illustrator produces the correct physical drawing size.
- **Pass:** Imports at correct physical size without manual scaling.
- **Fail:** Imports at wrong size or requires scale-factor input.

### Go/No-Go Decision

**Go:** All ten measurements pass. Both export paths validated. Lock in client-side generation.

**Conditional Go on PDF:** Measurements 1–2 and 6–7 pass but hatching (3) is weak. Document the hatch-as-dense-lines workaround and proceed.

**Conditional Go on SVG:** Measurement 9 passes for shapes but text is path-ified. Consider acceptable if PDF measurement 6 (font embedding) is solid, since the editable-SVG use case typically involves re-typesetting anyway.

**No-Go on PDF measurements 1, 2, or 7:** These are fatal. Client-side PDF generation insufficient. Alternatives:
- Server-side Cairo or ReportLab via Django (POST the SVG, return PDF)
- A paid library like `pdfkit.com` or `docraptor`
- Generating scaled SVG client-side and relying on browser "Print to PDF" at Actual Size
- Building on `pdf-lib` with hand-assembled page content

**No-Go on SVG measurement 9:** Less fatal than PDF failures. Mitigation: document the limitation, offer "Export to Illustrator-compatible SVG" as a paid/future feature, note that Flora is now a terminal tool (export = printable deliverable only, no downstream editing).

### Time budget

**5–10 engineer days.** Large variance because unknown what svg2pdf will choke on until tried. Reserve a full week minimum; expect at least one day fighting hatching and one day fighting fonts.

---

## Running Order and Total Budget

| Experiment | Days | Gates if failed |
|---|---|---|
| 0a: Lint rule (import boundaries) | 0.25–0.5 | Infrastructure; no gate |
| 0b: Coordinate conversion unit tests | 0.25–0.5 | Infrastructure; no gate |
| 1: Rendering & drag | 5–8 | Stack fails; pivot to Pixi.js or SVG+daybrush |
| 2: Bed tool + worker | 4–6 | Geometry architecture fails |
| 3: Export gates (PDF + SVG) | 5–10 | Export path fails; revisit server-side generation |
| **Total** | **14.5–25** | |

**Realistic budget with contingencies:** 4–6 weeks including debugging, deliberate edge-case expansion, and Annie validation sessions between experiments.

---

## What the Experiments Do NOT Cover

Deliberately out of scope — important but not risk gates:

- Species library UI and backend integration
- Save/Load to `.flora` files
- Authentication, user accounts, cloud sync
- Tauri desktop packaging
- Full Illustrator-style pen tool with click-drag anchor authoring (v1.1)
- Real-time collaboration / multiplayer
- 3D walkthrough mode
- GIS integration with live map tiles (MapLibre)
- OpenCASCADE integration
- **Illustrator `.ai` import** — see migration note below

---

## Migration / Import Story (Affects Experiment 1 Schema)

**This question must be answered before Experiment 1 starts**, because it determines whether the `Plant` and `Bed` interfaces can be designed freely or must accommodate XMP field shapes from day one.

The Moderator's verdict flagged this as unresolved. Candidate answers:

- **Clean break (recommended default):** existing flora-uxp `.ai` files are not imported. Users of the Illustrator plugin continue with that plugin until they choose to migrate by rebuilding. The new schema is free. Experiment 1 can proceed with the schema in this document as-is.
- **One-way migration:** a separate tool reads XMP from `.ai` files and produces `.flora` JSON. Schema must accommodate this — add XMP fields to the schema where necessary.
- **Round-trip:** Flora can read and write `.ai` XMP. Rejected on principle — reintroduces the split-brain pattern this architecture was designed to eliminate.

**Required before Experiment 1 begins:** A one-sentence product decision. "We are making a clean break; existing `.ai` files remain in the old plugin." OR "We will ship a one-way migration tool; here are the XMP fields we must preserve in the new schema." Default recommendation is clean break unless Annie reports specific projects that must survive the transition.

---

## Anti-Pattern Warnings for Whoever Builds These

**Do not build the experiments inside a production Flora repo.** Start in `spikes/` or a scratch repo. The code will be wrong in ways you haven't predicted. Starting clean lets you make mistakes without carrying them forward.

**Do not skip the measurements.** "It feels fast" is not a result. Record numbers. When production Flora gets slow, you need a baseline to compare against.

**Do not optimize prematurely.** Experiment 1 uses the most naive Konva code that works. Only add `node.cache()`, `perfectDrawEnabled: false`, and `listening: false` when specific measurements fail. Optimizing upfront hides what was necessary.

**Do not let Annie (or any user) drive the experiments.** These are engineering gates, not user tests. User testing happens after the stack is proven. A user testing Experiment 1 will report "the UI is ugly and there's no species picker" — true but irrelevant.

**Do not build scope creep into the experiments.** Every additional feature doubles time cost and dilutes signal. If you find yourself building a feature, stop. Write it down. Move on.

**Do not declare victory on a conditional pass without documenting the conditions.** If Experiment 1 passes only with sprite caching, that condition is a permanent architecture requirement. It goes in the architecture spec, not in git history.

**Do not measure only on developer hardware.** The named hardware target exists because M-series Macs pass everything. A "pass" on developer hardware that fails on Annie's machine is a false positive.

---

## Output of Each Experiment

Each produces:

1. **A working code artifact** in `spikes/experimentN/`. Checked in. Reproducible.
2. **A measurements log** — actual numbers per measurement, not prose. Named hardware, named date.
3. **A brief writeup** (< 1 page) stating: pass/fail, conditional-pass conditions, findings to update the architecture spec, blockers for next experiment.
4. **A list of things learned** outside experiment scope — surprise findings worth noting before forgotten.

These artifacts become the evidence base. When a new engineer asks in month six "why Konva and not Pixi?" the answer is "Experiment 1 measurements log, here's the file."

---

## Final Note

The experiments are not optional. Architecture research concluded Konva + Pinia + Turf is the best available path, but "best available based on research" is not the same as "proven on Flora's actual workload." Skipping the experiments and going straight to production is the single most expensive mistake this project could make — the cost of discovering an architectural problem in month four is measured in months of rework, not weeks of spike work avoided upfront.

Run them. Measure. Decide from evidence.
