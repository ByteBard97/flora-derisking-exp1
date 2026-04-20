# Flora Architecture Debate — Socratic Review

**Date:** 2026-04-20
**Proposition:** "Flora should be built on Konva + Vue 3 + Pinia with Paper.js for geometry and rbush for spatial queries, with drawing coordinates stored in real-world inches and Konva treated as a stateless projection of Pinia state. Opencascade.js and MapLibre are deferred."

---

## ✅ FOR — Advocate in Favor

The central lesson of flora-uxp was not that Illustrator was the wrong host — it was that split-brain state is a category of bug that cannot be patched. When plant data lived simultaneously in XMP, circle name fields, and Pinia, the system had no canonical answer to the question "what is actually on the canvas right now?" Every sync operation was a bet that three sources had not drifted. They always drifted. The proposed architecture makes that bet structurally impossible: Pinia owns all document state, Konva owns zero of it. A Konva node is a dumb rectangle with a back-reference ID — it cannot go stale because it holds no truth to corrupt. This is not a convention or a lint rule; it is an enforcement mechanism built into the data model.

Konva is specifically right here because the problem domain is exactly what Konva was designed for: a bounded interactive canvas (a residential lot, not a city) with a few hundred discrete, individually interactive objects. The rbush R-tree spatial index means hit-testing 300 plants is a sub-millisecond lookup, not a full scene scan. Multi-layer caching — background raster locked, plant layer redrawn on interaction, label layer composited separately — means "pan the map" does not repaint every plant sprite. This is not theoretical headroom; it is the exact performance profile of the workload.

Storing coordinates in real-world inches is load-bearing precisely because landscape architects reason in feet and inches, not pixels. A plant spacing of 4'6" is a first-class value in the document. If that value were stored in pixels, every zoom change would require either lossy back-conversion or a stored zoom coefficient that must travel everywhere with the data — the same split-brain pattern in a different disguise. Typed conversions centralized in viewportStore mean the inch-to-pixel transform is applied exactly once, at render time, auditable in a single file.

Deferring opencascade.js and MapLibre is not laziness — it is prioritization by user. A residential lot landscape architect needs to place a Gregg's Mistflower 3 feet from a bed edge, not perform NURBS surface modeling or render global tile sets. OpenCASCADE's WASM bundle is 15 MB; MapLibre adds another 300 KB of concepts the user will never see. Both can be grafted onto this architecture later because the coordinate system is already world-space inches with a GIS bridge designed in. The absence of those libraries from v1 is a feature, not a gap.

Finally, Vue 3 plus Django is the existing stack. There is no framework seam, no React island, no adapter layer, no $6,000 annual license negotiation. The architecture earns the right to be boring.

**Boring is a compliment when the previous version set itself on fire.**

---

## ❌ AGAINST — Devil's Advocate

The discipline this architecture demands is not a design pattern — it is a social contract, and social contracts erode under deadlines.

Consider the drag interaction first, because it is the most common user action and the place where the architecture is most exposed. The proposed cycle is: `dragend` fires → convert pixels to inches → dispatch a Pinia action → mutation recorded → CanvasProjection subscriber wakes → find the Konva node by ID → update its position. On a fast machine with a trivial document this is imperceptible. But Konva subscribes to the store, which means every mutation during a drag — and if you implement live-drag (as users will demand, because snapping and collision hints require it) — fires the full reconciliation loop on every `dragmove` event, which fires at up to 60 times per second. You now have 60 Pinia dispatches per second, 60 subscriber wakes, 60 node lookups. Canvas2D compositing is CPU-bound; Konva has no WebGL path. The prior art here is Pixi.js, which the team already used in flora-cad and which runs on WebGL with a retained-mode scene graph that handles thousands of sprites at 60fps without a reconciliation layer. Konva's Canvas2D pipeline will hit a wall somewhere between 150 and 300 objects — exactly the document size this product targets.

The CanvasProjection service is described as mapping store mutations to Konva nodes. What this description obscures is that it is a hand-written reactive renderer: it must handle adds, removes, updates, z-order changes, selection state, hover state, and layer visibility — all the things Vue's virtual DOM and reactivity system already do for free when you bind to SVG. An SVG-based renderer with Vue's `v-for` and reactive transforms would give you the same single-source-of-truth guarantee, browser-native hit testing, CSS transitions, and zero reconciliation code. For 300 plants on a residential lot, SVG performance is entirely adequate, and the prior "SVG is slow" intuition comes from DOM thrashing, not from SVG's rendering model itself.

Paper.js as the geometry engine is the quietest risk. Its last release was November 2022, its maintainer has been largely absent, and "headless in a Web Worker" means you own the serialization boundary — every geometry operation crosses a `postMessage` with structured-clone overhead. If a Paper.js bug surfaces with a boolean operation on a complex bed polygon, there is no upstream to fix it. You will patch a dormant library or rewrite the worker. Turf.js is actively maintained, ships as composable ES modules, and handles the polygon operations this product actually needs.

The architecture is not wrong — it is over-engineered for the problem, and over-engineering is not neutral. It creates surface area for the discipline to fail, hires complexity that must be maintained, and defers the real question: for 300 plants on a single lot, do you need a reconciler, a Web Worker, and a spatial index, or do you need Vue bindings on an SVG canvas?

Build the simplest thing that could survive v1.5. Right now, this proposal builds the framework to survive v3.

---

## ⚖️ NEUTRAL — Objective Analysis

### Balanced Assessment

The proposition's core insight is sound: the single biggest failure mode in the prior Illustrator plugin was split-brain state (XMP + canvas + Pinia all holding partial truth). Making Pinia the sole authoritative source and Konva a dumb downstream renderer directly addresses the demonstrated root cause. That's not a stylistic preference — it's a structural fix to a known, costly bug class.

The real-world-inches coordinate system is also correct for the domain. Landscape architects think in feet and inches, GIS data arrives in real-world units, and PDF export requires resolution-independence. Storing in pixels and converting later is a trap that compounds every time a new consumer (PDF, GIS, labels, area calculations) is added.

**Genuine architectural risks:**

The CanvasProjection discipline risk is real. The temptation to read state back from Konva (position after drag, transformer bounds) rather than updating Pinia first is a single line of code that silently reintroduces split-brain. Without a hard enforcement mechanism — ideally a linting rule or strict code review gate — this will rot. The Illustrator plugin history is direct evidence this happens under deadline pressure.

The Konva performance ceiling is also real, though its severity depends on the actual node count. At 50–300 plants plus a handful of beds and labels, Canvas2D at 60fps is almost certainly fine. The stated concern about "500+ plants" is outside the stated product scope (300 max), which means this risk is largely theoretical for v1.

**Risks that are overstated:**

Paper.js dormancy is a genuine concern for a primary rendering library. As a headless geometry utility in a Web Worker, it is far less concerning — it either does bezier math correctly or it doesn't, and the API is stable. The rbush integration is straightforward and well-proven; this is not a meaningful risk.

### Key Tradeoffs Table

| Dimension | Proposition (Konva) | Best Alternative (Pixi.js) | Winner |
|---|---|---|---|
| Rendering performance (300 nodes) | Canvas2D, 60fps, adequate | WebGL, 60fps, headroom to spare | Pixi.js (margin the team doesn't need) |
| Rendering performance (500+ nodes) | Konva jank risk | Pixi.js comfortable | Pixi.js |
| Built-in selection / transformer | Konva.Transformer, built-in | Roll your own | Konva |
| State discipline enforcement | Requires team discipline | Same problem exists | Tie |
| Library health | Konva: active (2024 releases) | Pixi.js: active | Tie |
| Paper.js (geometry worker) | 2022 last release, stable API | Could use Turf.js instead | Marginal risk either way |
| PDF export path | jsPDF + svg2pdf.js, fragile for curves | Same | Tie |
| License cost | MIT across the board | MIT across the board | Tie |
| Build/integration time | Vue-native, fast | Requires more wiring | Konva |
| Escape hatch if Konva fails | Rewrite projection layer only | Rewrite projection layer only | Tie |

### Pivotal Decisions

**1. How is CanvasProjection write-only enforced, not just intended?**
This is the make-or-break question. "Treat Konva as write-only" as a cultural norm will erode within two months of the first hard deadline. The proposition needs a concrete enforcement mechanism: a linting rule that flags any Konva state reads outside the projection service, or an architectural wrapper that makes reading Konva state syntactically awkward. Without one of these, the architectural promise is aspirational, not structural.

**2. Is the PDF export path sufficient for the actual deliverable architects need?**
jsPDF + svg2pdf.js is adequate for simple geometry. Landscape architects producing client-facing construction documents expect precise line weights, accurate dimensions, and scalable output at ANSI/ISO sheet sizes. If the export path cannot reliably handle hatched bed fills, curved paths, and annotated dimensions, the product fails at its final-mile use case regardless of how clean the editor is. This needs a working prototype before the stack is locked.

**3. What is the actual migration / import story from Illustrator?**
If users have existing Illustrator projects they expect to continue working on, the import path from XMP into the new Pinia store is a constraint that affects schema design from day one. If there is no migration (clean break), the data model can be designed freely. If there is, it shapes every store decision. The proposition does not address this.

### Preliminary Verdict

**Adopt the proposition, with one non-negotiable precondition.**
**Confidence: Medium-High**

The stack is coherent, the licensing is clean, the coordinate system choice is correct, and the core architectural decision directly addresses the demonstrated failure mode of the prior system. The performance concerns are outside the stated product scope for v1. Paper.js as a headless geometry worker is a contained, replaceable component.

The single condition: the team must implement a concrete, mechanical enforcement mechanism for the Konva write-only rule before writing production code — not a README note, not a team agreement, a code-level constraint. Without it, this architecture has the same failure mode as the system it replaces, just with different library names.

---

## 🏛️ MODERATOR'S VERDICT

### The Proposition

Rebuild Flora as a Pinia-owned stateless-Konva canvas with Paper.js geometry in a Web Worker and rbush spatial indexing, storing all design coordinates in real-world inches.

---

### FOR argued (key points)

- Split-brain state is a category of bug, not a fixable defect — making Konva hold zero truth makes the prior bug class structurally impossible, not just conventionally avoided.
- Real-world inches as the storage unit is load-bearing: storing pixels and converting at read time reintroduces a zoom-coefficient dependency that must travel with every data consumer — the same split-brain pattern in different clothing.
- Konva's built-in Transformer, layer caching, and rbush hit-testing are exactly matched to the workload: bounded canvas, hundreds of discrete interactive objects, multi-layer compositing.
- Deferring OpenCASCADE and MapLibre is correct prioritization — a 15 MB WASM bundle and global tile rendering have no place in a residential lot tool at v1.

---

### AGAINST argued (key points)

- The write-only Konva discipline is a social contract, not a structural constraint — it will erode under deadline pressure exactly as the Illustrator plugin's XMP/Pinia/canvas discipline eroded.
- Live drag at 60 `dragmove` events per second forces 60 Pinia dispatches per second through the full reconciliation loop; Canvas2D is CPU-bound and Konva has no WebGL path, placing the performance ceiling exactly at the document size the product targets (150–300 objects).
- CanvasProjection is a hand-written reactive renderer that must handle adds, removes, z-order, selection, hover, and layer visibility — all things Vue's own reactivity gives for free over SVG, which is adequate for 300 plants.
- Paper.js has not been meaningfully maintained since November 2022; owning the serialization boundary to a dormant library in a Web Worker means owning any bugs that surface, with no upstream to fix them.

---

### NEUTRAL landed (key points)

- The single-source-of-truth fix directly addresses the demonstrated root cause; this is a structural answer to a known costly bug class, not a stylistic preference.
- The performance concern is real but overstated for the stated scope: 300 plants is within Canvas2D's comfortable operating range; the "500+ plants" scenario is outside the stated product boundary.
- The CanvasProjection discipline risk is the genuine make-or-break question — it requires a mechanical enforcement mechanism, not a cultural norm.
- Paper.js dormancy is materially less concerning as a headless geometry utility than as a rendering library; Turf.js is a viable, actively maintained alternative.

---

### Points of Agreement Across All Three

- Pinia as the single source of truth directly and correctly addresses the root cause of the prior system's failures — this point is not in dispute.
- Real-world inches as the canonical coordinate unit is correct for the domain.
- The CanvasProjection write-only rule will not hold as a convention alone — some mechanical enforcement is required.
- Paper.js dormancy is a risk; Turf.js is a credible and lower-risk substitute for the geometry operations actually needed.
- The product scope (residential lot, 300 plants max, handful of beds) is the appropriate frame for evaluating whether performance concerns are live or theoretical.

---

### Unresolved Questions (ranked by importance)

1. **How is the Konva write-only rule enforced mechanically, not culturally?** This is the architecture's single point of failure — without a code-level constraint, this proposal has the same failure mode as the system it replaces.
2. **Can the PDF export path handle the actual deliverable landscape architects produce?** jsPDF + svg2pdf.js must be prototyped against hatched fills, curved paths, and annotated dimensions at ANSI sheet sizes before the stack is locked.
3. **What is Paper.js replaced with if a bug surfaces in a dormant codebase?** The geometry worker interface should be abstracted so the implementation can be swapped to Turf.js or another library without touching callers.
4. **What is the import story for existing Illustrator documents?** If users have active `.ai` projects, the XMP-to-Pinia schema migration is a day-one constraint, not a deferred concern.
5. **Does live drag require the full reconciliation loop, or can Konva handle position locally during drag with a single Pinia commit on `dragend`?** The 60-dispatches-per-second concern dissolves if live-drag position is buffered locally and only committed on release.

---

### Verdict

**Recommendation:** Accept with modifications  
**Confidence:** Medium-High  
**Decisive factor:** The architecture directly and structurally fixes the demonstrated root cause of the prior system's failure, but only if the Konva write-only rule is enforced mechanically — without that, the proposal is aspirationally different from what it replaces and practically identical.

---

### Required follow-up decisions before committing:

1. Implement a concrete enforcement mechanism for the Konva write-only rule — an ESLint rule that flags any Konva node property reads outside the CanvasProjection service, or an architectural wrapper that makes reading Konva state a compile-time error — before any production code is written.
2. Build a PDF export prototype against a real landscape architecture deliverable (hatched bed fills, curved paths, dimension annotations, ANSI D sheet) and confirm jsPDF + svg2pdf.js is sufficient. This is a go/no-go gate.
3. Resolve the live-drag architecture: determine whether drag position is buffered locally in Konva during the move gesture and committed to Pinia only on `dragend`, making the 60-dispatch-per-second concern moot. Document this decision explicitly in the architecture spec.
4. Abstract the geometry worker interface behind a stable API so the underlying library (Paper.js or Turf.js) can be swapped without touching callers.

---

### If modifications are required, they are:

1. **Replace Paper.js with Turf.js** as the geometry implementation inside the Web Worker. The worker interface and the rest of the architecture are unchanged. Turf.js is actively maintained, ships as composable ES modules, and covers the polygon operations this product actually needs. Paper.js may be revisited if a specific capability gap is identified.
2. **Mandate a mechanical write-only enforcement mechanism** as a precondition to merging the first CanvasProjection implementation — not a follow-up task, not a TODO, a merge gate.
3. **Clarify the drag-gesture Pinia commit strategy** in the architecture spec: local Konva position during drag, single Pinia commit on `dragend`, with snapping and collision hints computed against the Pinia store state (not read back from Konva). This resolves the performance concern without changing the data model.

---

### If rejected, the most credible alternative is:

A Vue 3 + SVG renderer with the identical Pinia-as-single-source-of-truth model, replacing Konva and CanvasProjection entirely. Vue's `v-for` over reactive plant records with SVG `transform` bindings gives the same write-only guarantee enforced by the framework's own reactivity system rather than a hand-written reconciler, browser-native hit testing at 300 objects without rbush, and CSS transitions for selection state — with zero reconciliation code to write or maintain. The coordinate-in-inches model, the rbush spatial index for geometry queries, the Turf.js geometry worker, and the Django backend integration are all preserved unchanged. The trade is Konva's built-in Transformer (which would need to be implemented in SVG) for the structural elimination of the reconciliation discipline risk. For v1 at the stated scale, this trade is favorable; revisit Konva if SVG performance becomes a demonstrated problem rather than a theoretical one.
