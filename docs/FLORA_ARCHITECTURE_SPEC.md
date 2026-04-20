# Flora Architecture Specification — For Socratic Debate Review

**Status:** Proposal — stress-tested and modified. See `FLORA_ARCHITECTURE_DEBATE.md` for verdict.
**Date:** April 2026
**Key modification from debate:** Paper.js replaced with Turf.js as geometry implementation.
See debate doc for full list of required modifications before committing to production.
**Purpose:** This document specifies a proposed architecture for Project Flora, a standalone web-based landscape architecture design tool. It is written to be handed to a Claude Code instance that will spin up four independent agents (FOR, AGAINST, NEUTRAL, MODERATOR) per the `socratic-debate` skill and stress-test the proposal.

**Instructions for the referee:** Read this entire document before invoking any debate agent. Each agent should be spawned as a separate subagent invocation with the role definitions from `socratic-debate/SKILL.md`. Do not let a single agent play multiple roles. After all four roles have produced their output independently, produce the Moderator's final verdict.

---

## 1. Background and Context

Flora is being rebuilt from its prior incarnation as an Adobe Illustrator CEP plugin (flora-uxp) into a standalone web application. The prior version stored metadata across Illustrator XMP, circle name fields, and Pinia stores — a split-brain data model that caused persistent bugs. The rebuild is a chance to fix those foundational issues.

The target users are landscape architects designing single residential lots: approximately 5,000–15,000 sq ft of property with 50–300 placed plants, a handful of planting beds, building outlines, and labels. The backend (Django REST, unchanged) handles GIS data assembly — it produces a composite SVG or raster of aerial photo + parcel boundary + DEM + soil zones for a given address, which the frontend treats as a static background layer.

The prior architectural research evaluated tldraw (rejected: $6K/year commercial license, React-only), Excalidraw (React-only), a full WASM stack (Vello, Graphite — too immature), and various headless canvas libraries. The proposal below is what emerged.

---

## 2. The Proposed Architecture

### 2.1 Technology Stack

| Layer | Library | License | Role |
|---|---|---|---|
| UI framework | Vue 3 + TypeScript | MIT | All panels, toolbar, dialogs, inspect, reports |
| State management | Pinia | MIT | Authoritative document model |
| Canvas rendering | Konva.js + vue-konva | MIT | Drawing, hit-testing, selection, pan/zoom |
| Spatial index | rbush (R-tree) | MIT | Fast spatial queries for validation and fill tools |
| Bezier/path math | Paper.js (headless, Web Worker) | MIT | Area calculation, path simplification, curve fitting, booleans |
| SVG rasterization | @resvg/resvg-wasm | MPL-2.0 | Pre-rasterizing large GIS SVGs for background layer |
| PDF export | jsPDF + svg2pdf.js | MIT | Print-to-scale output |
| Desktop shell (optional) | Tauri 2 | MIT/Apache | Native file dialogs, filesystem access |
| Backend | Django REST | BSD | Species library, GIS assembly, user accounts |
| CAD kernel (deferred) | opencascade.js | LGPL-2.1 | Reserved for v2 if exact geometry becomes a requirement |

**Explicitly NOT used:** tldraw, Excalidraw, Fabric.js, React, MapLibre GL JS.

### 2.2 Rationale for Key Choices

**Why Konva over alternatives:**
- MIT licensed, no commercial fees (vs. tldraw at ~$6K/year)
- Official Vue 3 binding (`vue-konva`) maintained by the core team
- Multi-layer architecture enables background/plants/beds separation with independent cache behavior
- Built-in `Transformer` node for selection handles
- Mature: ~10 years of production use, ClickUp and Padlet as reference deployments
- Canvas2D rendering avoids SVG DOM-node explosion at scale

**Why Pinia as single source of truth:**
- Fixes the flora-uxp split-brain pattern (metadata on Illustrator objects)
- Enables serialization to `.flora` JSON files without scanning the canvas
- Undo/redo becomes a standard pattern over store state
- Cloud sync, multiplayer, server-side rendering all become plausible futures

**Why Paper.js headless:**
- Best bezier math in the JS ecosystem (ported from Scriptographer)
- Pure computation in a Worker — never touches DOM, never renders
- Needed for area calculation, freehand-to-bezier curve fitting, path simplification

**Why no MapLibre:**
- Backend pre-assembles GIS data; the frontend sees a static composite image
- Flora works one lot at a time — no multi-site panning requirement
- MapLibre would add Mercator projection complexity for zero product value at current scope

**Why defer opencascade.js:**
- 8-12 MB gzipped bundle
- LGPL license requires separable WASM asset handling
- Paper.js geometry is accurate enough for landscape design tolerances
- Trigger for adoption: real customer accuracy complaints or DXF export feature

---

## 3. Data Architecture

### 3.1 Three-Layer Model

```
┌─────────────────────────────────────────────────┐
│ Layer 1: Pinia Document Store (AUTHORITATIVE)   │
│ - Plants, beds, labels, layers, project meta    │
│ - Drawing coordinates in inches                 │
│ - Serialized to .flora files                    │
└────────────────────┬────────────────────────────┘
                     │ subscriptions
      ┌──────────────┼──────────────┬─────────────┐
      ▼              ▼              ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Konva    │  │ rbush    │  │ Undo     │  │ Vue      │
│ Canvas   │  │ Spatial  │  │ Stack    │  │ Panels   │
│ (Layer 2)│  │ Index    │  │          │  │          │
│          │  │ (Layer 3)│  │          │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
   DERIVED      DERIVED       DERIVED       DERIVED
```

**The single rule:** Konva, rbush, undo stack, and Vue panels are all **downstream subscribers** to Pinia. Pinia subscribes to nothing. All mutations flow through Pinia actions.

### 3.2 Pinia Stores

**`useDocumentStore`** — the authoritative model:
```typescript
interface FloraDocument {
  meta: {
    id: string           // ulid
    title: string
    version: number
    scale: { inchesPerFoot: number }  // drawing scale
    createdAt: ISO8601
    updatedAt: ISO8601
  }
  plants: Map<PlantId, Plant>
  beds: Map<BedId, Bed>
  labels: Map<LabelId, Label>
  layers: Layer[]
  refCounters: Record<string, number>  // { TR: 5, SH: 3, ... }
  siteData: {
    aerialUrl: string
    parcelBoundary: SVGPathString
    soils: SoilZone[]
    siteTransform: { tx, ty, rotation, scale }
  }
}

interface Plant {
  id: PlantId                          // ulid
  speciesId: string                    // backend foreign key
  position: { x: number, y: number }   // DRAWING COORDS (inches)
  radius: number                       // inches, derived from species × growth
  rotation: number                     // degrees
  growthFactor: number                 // 0.0 - 1.0
  refDesignator: string                // "TR1"
  layerId: LayerId
  labelId?: LabelId
  svgVariantIndex?: number
  opacity: { circle, svg, label }
}

interface Bed {
  id: BedId
  name: string
  path: BezierPath                     // { anchors: Anchor[], closed: true }
  material: string
  depthInches: number
  layerId: LayerId
  notes?: string
}

interface Anchor {
  id: string
  x: number                            // DRAWING COORDS (inches)
  y: number
  handleIn?: { dx, dy }                // relative vector, inches
  handleOut?: { dx, dy }
  type: 'corner' | 'smooth' | 'asymmetric'
}

interface Label {
  id: LabelId
  plantId: PlantId                     // or bedId
  text: string
  offset: { dx, dy }                   // inches, from plant center
  hasLeader: boolean
  style: { font, size, color, outline }
}
```

**Other stores:**
- `useSpeciesStore` — cached backend species library
- `useSelectionStore` — current selection state (array of IDs)
- `useToolStore` — active tool, tool-specific state
- `useViewportStore` — pan, zoom, visible bounds
- `useUndoStore` — history stack of inverse actions
- `useUIStore` — panel visibility, theme, user preferences

### 3.3 The Canvas Projection Service

`CanvasProjection` is **not a store**. It is a service class instantiated once per Konva Stage, subscribed to Pinia mutations. Its job is to keep the Konva scene graph in sync with the document.

```typescript
class CanvasProjection {
  private plantIdToNode = new Map<PlantId, Konva.Group>()
  private bedIdToNode = new Map<BedId, Konva.Path>()

  constructor(stage: Konva.Stage, docStore: DocumentStore) {
    // Subscribe to every plant add/remove/update
    docStore.$subscribe((mutation, state) => {
      this.reconcile(mutation)
    })
  }

  private syncPlant(plantId: PlantId) {
    const plant = docStore.plants.get(plantId)
    let node = this.plantIdToNode.get(plantId)

    if (!plant && node) { node.destroy(); return }
    if (!node) { node = this.createNode(plant); this.plantIdToNode.set(plantId, node) }
    this.updateNode(node, plant)
  }

  private createNode(plant: Plant): Konva.Group {
    const group = new Konva.Group({ draggable: true })
    group.setAttr('plantId', plant.id)  // ONLY metadata on the node
    // add circle, sprite, label as children
    return group
  }
}
```

**Konva nodes store nothing except a back-reference to their document ID.** This is the discipline that was missing in flora-uxp.

### 3.4 The Spatial Index Service

`SpatialIndex` is also a service, not a store. It wraps rbush and subscribes to document mutations.

```typescript
class SpatialIndex {
  private tree = new RBush<IndexEntry>()

  constructor(docStore: DocumentStore) {
    docStore.$subscribe(this.reconcile)
  }

  findWithinRadius(x: number, y: number, r: number): PlantId[] { ... }
  findInRect(rect: Rect): PlantId[] { ... }

  rebuild() {
    this.tree.clear()
    for (const plant of docStore.plants.values()) {
      this.tree.insert(this.boundsFor(plant))
    }
  }
}
```

**Who needs rbush and when:**
- `ValidationService` — overlap/spacing checks: O(log N) vs O(N²)
- `FillPolygonService` — grid/poisson fill: avoids re-checking against all plants
- `MarqueeSelectTool` — "select all plants in rect"
- NOT needed for basic click-to-select (Konva's built-in hit-test is sufficient)
- NOT needed at v1 launch if plant count stays under ~200; add when first slow query appears

---

## 4. Coordinate Systems

Flora uses **three distinct coordinate systems**, and the translation between them is explicit and centralized.

### 4.1 Drawing Coordinates (inches)

**The authoritative coordinate system.** Every `Plant.position`, every `Bed.path.anchors[i]`, every `Label.offset` is stored in real-world inches relative to a document origin (typically the top-left of the drawing area).

**Why inches:**
- Landscape architecture tolerances are inches-to-feet, not pixels
- Scale changes become a pure view-layer concern (no data migration)
- Print-to-scale is a trivial multiplication at export time
- BOM math (area, spacing, coverage) operates in the unit the customer buys in
- Future DXF export to AutoCAD is direct

### 4.2 Canvas Coordinates (CSS pixels)

**The Konva Stage's internal coordinate system.** Used only at render time. Computed from drawing coordinates via the active drawing scale and viewport transform.

```typescript
// conversions centralized in viewportStore
drawingToCanvas({x, y}) {
  return {
    x: x * this.pxPerInch * this.zoom + this.panX,
    y: y * this.pxPerInch * this.zoom + this.panY
  }
}

canvasToDrawing({x, y}) {
  return {
    x: (x - this.panX) / (this.pxPerInch * this.zoom),
    y: (y - this.panY) / (this.pxPerInch * this.zoom)
  }
}
```

Every tool, every drag handler, every hit-test: convert at the boundary. The document model never sees canvas coordinates.

### 4.3 Geographic Coordinates (lat/lng)

**Used only at the backend boundary.** When the user enters an address, the backend geocodes, assembles the site plan, and returns a composite SVG/raster plus a `siteTransform` (scale + offset) that maps drawing inches back to real-world meters for GIS export if ever needed.

**The frontend does not know about lat/lng.** The site plan arrives pre-rectified; drawing coordinates are relative to its top-left corner.

---

## 5. Responsibility Matrix

### 5.1 Who Owns What Data

| Data | Owner | Subscribers |
|---|---|---|
| Plant positions, species, metadata | `useDocumentStore.plants` | CanvasProjection, SpatialIndex, BOMStore (derived), UndoStack |
| Bed geometry (bezier anchors) | `useDocumentStore.beds` | CanvasProjection, PaperJSWorker (on-demand), UndoStack |
| Labels | `useDocumentStore.labels` | CanvasProjection, UndoStack |
| Selection state | `useSelectionStore` | Konva Transformer, Inspect panel |
| Active tool | `useToolStore` | Konva event dispatcher, toolbar UI |
| Pan/zoom | `useViewportStore` | Konva Stage transform |
| Undo history | `useUndoStore` | Undo/Redo buttons |
| Species library cache | `useSpeciesStore` | Library panel, Placement tool |
| Konva scene graph | `CanvasProjection` service | (terminal; nothing subscribes to canvas) |
| Spatial index | `SpatialIndex` service | ValidationService, FillService, MarqueeTool |
| File persistence | `DocumentSerializer` service | Save/Open UI |

### 5.2 Who Owns What Behavior

| Behavior | Owner |
|---|---|
| Placing a plant on click | `PlantPlacementTool` (dispatches `docStore.addPlant` action) |
| Drawing a planting bed | `BedPenTool` (dispatches `docStore.addBed` action) |
| Click to select | Konva native hit-test → `useSelectionStore.setSelection` |
| Marquee select | Konva event + `SpatialIndex.findInRect` → `useSelectionStore.setSelection` |
| Drag a plant | Konva `dragend` → `docStore.updatePlant(id, { position })` |
| Resize selection | `Konva.Transformer` event → `docStore.updatePlant(ids, transforms)` |
| Compute bed area | `PaperWorker.computeArea(anchors)` called by `BedService` |
| Fit freehand to bezier | `PaperWorker.fitCurve(points, tolerance)` called by `BedPenTool` |
| Check spacing overlaps | `ValidationService` using `SpatialIndex` |
| Grid/Poisson fill | `FillPolygonService` using `SpatialIndex` + `PaperWorker` for polygon containment |
| Undo | `UndoStack.undo()` dispatches the inverse action |
| Save to .flora | `DocumentSerializer.save(docStore.$state)` |
| Render the canvas | `CanvasProjection` (subscribes; does not initiate) |
| Maintain spatial index | `SpatialIndex` (subscribes; does not initiate) |
| PDF export | `ExportService` calls `stage.toDataURL()` → `svg2pdf.js` → `jsPDF` |

### 5.3 Services vs. Stores

**Stores hold state. Services are stateless or hold only caches.**

- `CanvasProjection` — stateless mapping from document IDs to Konva nodes
- `SpatialIndex` — cache (rbush tree); can be rebuilt from doc at any time
- `PaperWorker` — stateless compute; Web Worker wrapping Paper.js
- `ValidationService` — stateless; uses SpatialIndex
- `BedService` — stateless; uses PaperWorker
- `DocumentSerializer` — stateless; reads/writes store state
- `ExportService` — stateless; reads store state + stage

---

## 6. Interaction Flows

### 6.1 Placing a Plant

```
1. User clicks species in Library panel
   └→ useToolStore.setTool('placement', { speciesId })

2. PlacementTool subscribes to Konva stage clicks
   User clicks canvas at (cx, cy)
   └→ toolStore reads current tool
   └→ viewportStore.canvasToDrawing({cx, cy}) → drawing coords

3. PlacementTool dispatches:
   docStore.addPlant({ speciesId, position: drawingCoords })

4. docStore action:
   - generates ulid
   - increments refCounters[prefix]
   - creates Plant object
   - plants.set(id, plant)
   - updates meta.updatedAt

5. Pinia emits mutation event. Subscribers react:
   ├→ CanvasProjection.syncPlant(id) → creates Konva group, adds to layer
   ├→ SpatialIndex inserts bounds
   ├→ UndoStack pushes { type: 'removePlant', id }
   └→ BOMStore re-derives counts (if subscribed)

6. Vue inspect panel sees new plant via reactive subscription
```

### 6.2 Drawing a Bezier Bed

```
1. User selects Bed tool
   └→ useToolStore.setTool('bed-pen')

2. User freehand-drags across canvas
   BedPenTool collects raw points (canvas coords)
   Renders a preview polyline on a temp Konva layer

3. User releases mouse
   BedPenTool:
   - converts points to drawing coords
   - dispatches PaperWorker.fitCurve(points, tolerance)
   - receives array of bezier anchors
   - detects auto-close if endpoint near start
   - dispatches docStore.addBed({ path: { anchors, closed } })

4. docStore action creates bed, mutation fires
   ├→ CanvasProjection creates Konva.Path with SVG d-string
   ├→ PaperWorker.computeArea() called async for inspect panel
   └→ UndoStack records inverse
```

### 6.3 Undo

```
1. User presses Cmd+Z
   └→ undoStore.undo()

2. UndoStack pops the last inverse action
   e.g., { type: 'removePlant', id: 'plant_01H...' }

3. Dispatches inverse to docStore
   └→ docStore.removePlant(id)

4. Cascade identical to normal removal:
   ├→ CanvasProjection destroys node
   ├→ SpatialIndex removes entry
   └→ Redo stack receives the original action
```

---

## 7. Primary Risks and Mitigations

### 7.1 Performance Risks

**Risk: Konva pan/zoom jank with 500+ plants + large background image**
- *Mitigation:* Multi-layer architecture. Background on its own cached layer (`layer.cache()`). Plants on interactive layer with `perfectDrawEnabled: false`. Drag-layer pattern (move dragged shape to top layer during drag).
- *Detection:* POC with 500 procedural plants measures sustained FPS during pan/zoom.
- *Escape hatch:* If Konva fails, Pixi.js v8 (WebGL) with a custom scene-graph wrapper. More work but proven to 10K+ shapes.

**Risk: Vue reactivity overhead on large plant Maps**
- *Mitigation:* Use `shallowRef` / `shallowReactive` at store boundaries. Mutations replace objects immutably rather than deep-patching. Never let Vue deep-proxy a 200-entry Map.
- *Detection:* Vue DevTools performance tab; any mutation > 5ms is suspect.

**Risk: Large GIS background SVG kills render performance**
- *Mitigation:* Rasterize server-side or at upload via `@resvg/resvg-wasm`. Display as single `Konva.Image` on cached layer. Never render GIS SVG as live vectors.
- *Detection:* POC loads a real aerial photo + parcel + DEM composite.

### 7.2 Data Integrity Risks

**Risk: Canvas scene graph drifts from Pinia state**
- *Mitigation:* The discipline that nothing stores data on Konva nodes except the document-ID back-reference. Periodic reconciliation pass (optional dev-mode assertion) compares `docStore.plants.size === plantIdToNode.size`.
- *Detection:* Integration tests that mutate the store and assert on canvas state.

**Risk: SpatialIndex desyncs from document**
- *Mitigation:* Treat it as a cache. `SpatialIndex.rebuild()` is always available. In dev mode, run a consistency check every N mutations.

**Risk: Coordinate confusion (drawing vs canvas vs geographic)**
- *Mitigation:* Centralize all conversions in `useViewportStore`. Type the coordinate systems distinctly (`DrawingPoint` vs `CanvasPoint` branded types). Never accept raw `{x, y}` at a tool boundary without a type.

### 7.3 Complexity Risks

**Risk: The bezier pen tool is a multi-week project**
- *Mitigation:* Ship freehand-plus-fit-curve in v1. Defer the full Illustrator-style click-drag-edit pen tool to v1.1 or v2. Both output the same `Bed.path.anchors` structure so no migration is required.
- *Detection:* User testing with a real landscape architect on v1.

**Risk: Paper.js is dormant (last release Nov 2022)**
- *Mitigation:* Use it headless for math only. Pin to current version. Vendor-fork if needed — it's stable, not evolving. Contingency: port specific algorithms to TypeScript if Paper.js ever breaks on a Node version.

**Risk: Scope creep into multi-site / parcel-scale planning**
- *Mitigation:* Architecture is explicitly single-lot. If the product pivots, MapLibre becomes the underlay and drawing coords become map-relative — a real migration, but bounded.

### 7.4 Business / Strategic Risks

**Risk: Konva stops being maintained**
- *Mitigation:* Low probability (active commits, commercial sponsors). MIT license means a fork is always viable. Document model is renderer-agnostic by design — swapping to Pixi, Fabric, or a WASM renderer is a CanvasProjection rewrite, not a data migration.

**Risk: Real-time collaboration becomes a required feature**
- *Mitigation:* Document model is serializable JSON. A CRDT layer (Yjs, Automerge) over Pinia is feasible but non-trivial (1-2 month project). If multiplayer is a hard requirement, revisit tldraw's `@tldraw/sync` tradeoff.

**Risk: License contamination from opencascade.js LGPL**
- *Mitigation:* Deferred to v2. Ship as separate .wasm asset loaded at runtime, never statically linked. Consult counsel before v2 integration.

---

## 8. What Is Explicitly Out of Scope (For This Debate)

The debate should focus on the architecture proposed above. These topics are intentionally excluded:

- Backend (Django) internals
- Authentication / user management
- Tauri vs. web-only packaging (covered in separate decision)
- Specific Vue component structure for side panels
- Plant species data modeling
- Cloud sync protocol design
- 3D walkthrough mode (future phase)

---

## 9. The Debate Questions

The four agents should address this proposition:

> **"Flora should be built on Konva + Vue 3 + Pinia with Paper.js for geometry and rbush for spatial queries, with drawing coordinates stored in real-world inches and Konva treated as a stateless projection of Pinia state. Opencascade.js and MapLibre are deferred."**

### Suggested framing for each agent:

**FOR agent should argue:** Why this is the right architecture for Flora specifically. Why Konva beats tldraw, Pixi, and Fabric for this use case. Why the three-layer data model is principled rather than over-engineered. Why the deferred complexity (Paper.js in Worker, rbush, OCCT) is responsible engineering.

**AGAINST agent should argue:** What is this architecture missing or getting wrong? Where is complexity hidden that will explode later? Is the Pinia-as-source-of-truth discipline actually achievable or will it rot? Are there hidden coupling problems? Is there a simpler path (e.g., just pay for tldraw, or just use SVG + daybrush, or just use Pixi without Konva)? What are the real build-time costs being underestimated?

**NEUTRAL agent should:** Identify where FOR and AGAINST agree. Surface the real tradeoffs table. Identify the two or three pivotal decisions that actually matter (as opposed to details). State which parts of the architecture are well-reasoned and which parts are under-specified. Give a preliminary verdict with confidence level.

**MODERATOR agent should:** Synthesize all three into a final recommendation: accept / accept-with-modifications / reject / defer. State the decisive factor. Identify any follow-up questions the team should answer before committing. Do NOT produce new arguments; only synthesize.

---

## 10. Scoring Guidance for the Referee

Good arguments in this debate will:
- Cite specific constraints from Flora's context (single lot, 200 plants, landscape architecture tolerances, existing Vue+Django stack)
- Reference concrete library behaviors, not vague "industry best practices"
- Distinguish v1-ship risks from v2+ risks
- Acknowledge when the other side has a strong point

Weak arguments to discount:
- Generic "microservices good / microservices bad"-style takes
- Arguments that ignore the $6K/year tldraw cost or the React constraint
- Arguments that assume Flora will pivot to a different product
- Strawmen (e.g., claiming Pinia can't handle 200 plants — it obviously can)

### Expected output structure from the MODERATOR:

```markdown
## Flora Architecture Debate — Verdict

### The Proposition
[One-sentence restatement]

### What FOR argued (key points)
- ...

### What AGAINST argued (key points)
- ...

### Where NEUTRAL landed
- ...

### Points of Agreement (across all three)
- ...

### Unresolved Questions
- ...

### Verdict
**Recommendation:** [accept / modify / reject / defer]
**Confidence:** [low / medium / high]
**Decisive factor:** [one sentence]

### If accepted, these follow-up decisions are required:
- ...

### If rejected, the most credible alternative is:
- ...
```

---

## 11. Context Documents

The following documents from Flora's project history provide additional background and should be available to the agents if they request them:

- `Project_Flora_Brief.md` — original product vision and market positioning
- `Flora Design Tool — Product Requirements Document` — the current PRD
- `ROADMAP.md` — the Illustrator CEP plugin roadmap (historical, shows what Flora was)
- `WEB_CAD_ROADMAP.md` — earlier Paper.js-based web migration plan (superseded)
- `Adobe-Illustrator-Bridge-Plan.md` — early architecture exploration (historical)

Prior research reports also exist covering:
- Tauri vs. web-only deployment tradeoffs
- tldraw license economics and React interop
- Bezier pen tool implementation complexity
- Alternative canvas libraries (the search that produced this proposal)

---

**End of specification. Referee should now invoke the four agents per the socratic-debate skill.**
