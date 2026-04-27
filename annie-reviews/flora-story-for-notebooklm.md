# Flora: Building a Design Tool for Native Plant Landscapes

*A story about the last two weeks of work — written for Annie*

---

## The Problem We're Solving

Right now, designing a native plant landscape plan is a patchwork of tools that don't talk to each other.

You start in a browser, manually looking up the property parcel on a GIS website, copying the boundary coordinates, and tracing it into Illustrator by hand. That alone takes 30–60 minutes before you've placed a single plant. Then you draw the beds, place the plants, write out the plant schedule in a separate spreadsheet, and assemble the client proposal in yet another application. When a client asks "what will this look like in five years?", there's no good answer — you'd have to redraw everything at larger circle sizes.

And if a plant gets moved, the count in the spreadsheet is wrong. If a bed gets reshaped, the area calculation is wrong. Everything is disconnected.

Annie has been doing this work in Adobe Illustrator — a tool built for graphic designers, not landscape architects. It's powerful, but it doesn't know what a plant is. It doesn't know what a native species needs, how far apart oaks should be spaced, or what the soil at 123 Main Street looks like. It's a blank canvas that Annie has learned to coax into doing something it was never designed for.

**Flora is the tool that should have existed all along.**

---

## What Flora Is

Flora is a landscape design application built specifically for native plant professionals. It combines a professional-grade drawing canvas with a plant intelligence layer — a species database, ecological rules, automated fill algorithms, and professional document generation — all in one place.

A designer imports a real property by typing an address. Flora connects to GIS services and pulls in the parcel boundary, the building footprints, the aerial photo, the soil zone data. The drawing canvas is already set to the right scale. You start drawing, not searching.

You draw your planting beds with a pen tool or freehand tool — the same way you'd draw in Illustrator, with full bezier curve control. You open the plant library, search by name or filter by sun exposure, water need, bloom month, or soil compatibility. You select a species and click to place plants, or you select a bed and let Flora fill it automatically with a naturalistic scatter or a formal grid. Plant counts update live. Bed areas update live. The spacing is always right because Flora knows what "right" means for each species.

When you're done, you export a professional site plan PDF — the kind a landscape architect would be proud to hand to a client. You export a plant schedule. You show the client what the garden looks like today, and what it will look like in five years when everything has grown in.

---

## Who This Is For

The primary user is someone like Annie: a native plant nursery owner and designer in Sarasota, Florida who designs residential and small commercial landscapes. She's design-savvy — comfortable with Illustrator-class tools — but she's not a software engineer. She cares deeply about aesthetics and expects the tool to feel polished and professional.

Her clients are homeowners and small businesses who want beautiful, ecologically appropriate native plantings. They want to see a professional plan. They want to know what they're getting and roughly what it will cost. They want confidence that the designer knows what she's doing.

Flora gives Annie a way to spend her time on the design — the creative, expert part — instead of on administrative overhead.

---

## The Last Two Weeks: Proving the Foundation

Before writing a single line of the real application, we spent two weeks answering one critical question: **can a web browser run a professional-grade landscape design canvas?**

This isn't obvious. Adobe Illustrator runs as a native desktop application with access to the full power of the computer. A web application runs inside a browser with different constraints. The previous version of Flora (called flora-uxp) required Adobe Illustrator to be installed and running on the same machine — the software literally lived inside Illustrator as a plugin. That approach worked but it meant every user had to own and maintain a full Adobe CC subscription just to use Flora.

We wanted to build Flora as a standalone web application. But we needed to know: can a web canvas actually do everything Illustrator does for a landscape plan? Drawing bezier curves with full anchor point control. Handling 300+ plant symbols on screen at once without slowing down. Snapping shapes to each other. Boolean path operations (merging two overlapping beds into one). Exporting a print-quality PDF.

To answer these questions, we built a series of test prototypes — small, focused experiments that each proved one risky capability. We call this "derisking": identifying what could go wrong and proving it won't before committing to the full build.

---

## What We Proved

### The Drawing Engine Runs Fast

The most fundamental question: can we put 300 plants on screen — each one a circle with a botanical illustration inside, a species label, and a leader line — and have it feel instant?

Yes. The plant renderer runs at 120 frames per second. Pan and zoom are smooth. As you zoom out far enough that individual plants would be too small to read, they simplify automatically — this is called level-of-detail rendering, borrowed from video game engines. It means Flora will never get slow as your designs get larger.

### The Pen Tool Works Like Illustrator

The pen tool is the heart of any vector drawing application. In Illustrator, it's the tool landscape designers use to trace bed boundaries — click for a corner, click-drag for a curve, alt-click to break the handle symmetry, close the path to make a filled shape.

We built an exact equivalent. Corner anchors, smooth anchors, asymmetric handles — the same three anchor types Illustrator has, with the same interaction model. A landscape designer who knows Illustrator's pen tool can pick up Flora's pen tool immediately.

### Freehand Drawing Smooths Automatically

Illustrator's pencil tool lets you sketch a rough path freehand and it cleans it up automatically into smooth bezier curves. Flora does the same thing. You draw a wobbly outline of a planting area, release the mouse, and the path snaps into a clean professional curve. The algorithm underneath is called Ramer-Douglas-Peucker simplification followed by Schneider's bezier fitting — the same mathematics used in professional CAD software.

### Beds Can Be Measured Precisely

Landscape architects need to measure things precisely. How wide is this path? How many square feet is this bed? How long is the curved edge of this planting area?

Flora has a measurement tool with three modes: click two points to read the distance in feet and inches; click around an area to read the square footage live as you draw; hover over a curved bed edge to read its exact arc length. The drawing scale (for example, "1 inch equals 20 feet") is adjustable, and all measurements update instantly.

### Beds Can Be Cut and Split

In Illustrator, a landscape designer might draw a large planting area and then need to divide it into two zones — one for sun, one for shade. The knife tool does this: drag a line across a shape, and it splits into two independent pieces that can each be styled differently.

We proved this works in Flora's canvas engine. The math underneath is called de Casteljau subdivision — the classic algorithm for splitting bezier curves — and it works correctly on complex curved shapes, not just simple rectangles.

### Boolean Operations Work

Two planting beds that overlap can be merged into one clean outline (union). A driveway shape can be subtracted from a lawn area to leave the correct boundary (difference). These operations, called boolean path operations, are essential for professional site plan drawing. They work.

### Snapping Works

When placing plants and drawing beds, a designer needs shapes to snap precisely to each other — a bed edge to align exactly with a patio boundary, a plant circle to sit exactly on a grid. Flora has snap-to-grid, snap-to-vertex (the corners of shapes), and snap-to-edge (the midpoints and edges of shapes). All three work.

### Text Can Be Placed Directly on the Canvas

Dimension annotations, plant labels, notes to the client — in Illustrator these are text objects you place with the type tool. Flora's canvas supports the same thing: click anywhere on the drawing, type your annotation, and it appears as a crisp label at that location. You can click it again to edit it, drag it to move it, or clear it to delete it.

### The Export Question Is Solved

Exporting a professional PDF from a WebGL canvas (the technology that makes the drawing engine fast) is a genuinely hard problem — the kind of thing that has tripped up other tools. We researched how every major design tool (Figma, Excalidraw, tldraw, Canva) handles this, and the answer is clear.

Flora will maintain a complete structured record of every object in the drawing — every plant, every bed, every label — in a way that's completely separate from how those objects appear on screen. When you export, Flora reconstructs the entire drawing from that record, generating clean, precise SVG (the vector format Illustrator uses) and then converting it to PDF through a professional-grade rendering engine. The exported file will be fully editable in Illustrator if the designer wants to do final production work there.

---

## What the Canvas Looks Like Today

The current test application has 18 different test panels, each proving a specific capability:

- **Plant Renderer** — 300 plants with botanical illustrations, species labels, and draggable leader lines, running at 120fps on a site plan background
- **Pen Tool** — Full Illustrator-equivalent bezier drawing with all anchor types
- **Freehand** — Sketch a rough outline; it smooths automatically to clean curves
- **Knife Tool** — Drag to split a bed shape into two
- **Measure** — Three-mode measurement tool (distance, area, path length)
- **Boolean Ops** — Merge, subtract, and intersect bed shapes
- **Snapping** — Grid, vertex, and edge snapping
- **Selection** — Click, shift-click multi-select, lasso, group drag
- **Text Annotation** — Click to place, edit, and move text labels
- **Transform Gizmo** — Scale and rotate handles on selected shapes
- **Dashed Lines** — Every stroke style a landscape plan needs
- **Marching Ants** — The animated selection outline designers expect
- **MSDF Text** — Crisp, zoom-stable labels using GPU font rendering

Each panel is a focused proof. None of these are finished product — they're demonstrations that the technology works. The next phase is assembling them into the actual Flora application.

---

## What Comes Next

The derisking phase is nearly complete. The critical questions have answers. The canvas engine is proven.

The next phase is building the real product:

1. **The site import flow** — type an address, Flora pulls the parcel boundary, aerial photo, and soil data from the GIS backend (which already exists and works)
2. **The plant library** — 300+ native Florida species, searchable and filterable by sun, water, soil compatibility, bloom month, and wildlife value
3. **The bed fill algorithms** — select a bed and a species, set a spacing, and Flora scatters plants naturally throughout the bed
4. **The layer system** — organize the design into named layers (site reference, beds, plants, labels) with visibility and lock controls, exactly like Illustrator
5. **The export pipeline** — professional PDF, plant schedule, cost estimate

The foundation is solid. The hard parts are proven. Now we build.

---

## Why This Matters

There are thousands of native plant landscape designers like Annie. They all face the same friction. The tools exist for large commercial landscape firms — AutoCAD, Land F/X, DynaSCAPE — but they cost thousands of dollars per year, require training, and are overkill for a sole practitioner or small studio.

For the residential and small commercial market, the choice today is "use Illustrator and suffer" or "use something worse." Flora is designed to close that gap: professional capability, built for the way these designers actually work, priced accessibly.

The plant intelligence layer is what makes Flora different from every other drawing tool. Flora knows what *Quercus virginiana* looks like at 20 years. It knows that the Live Oak in the front yard is going to need 40 feet of clearance from the foundation. It knows the SSURGO soil data for the specific parcel, and it knows which species in Annie's palette will thrive there. That knowledge is embedded in the tool, so the designer can focus on the design.

---

*This document was written in April 2026 to accompany a demonstration of the Flora canvas engine prototype.*
