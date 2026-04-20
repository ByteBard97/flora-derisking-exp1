# Experiment 3: Export Gates

**Status:** Not started — blocked on Experiments 1 and 2 passing
**Goal:** Prove PDF-for-printing and SVG-for-editing meet landscape architect deliverable standards

## Prerequisite

Experiments 1 and 2 must both pass their go/no-go gates before starting here.

## What to build

See `docs/FLORA_DERISKING_EXPERIMENTS_v2.md` Experiment 3 section.

Key additions:
- `exportPDF(doc, paperSize, scale)` — jsPDF + svg2pdf.js, font embedding
- `exportSVG(doc, paperSize, scale)` — semantic grouping, text-as-text
- Physical large-format print at 1:1 scale (DO NOT SKIP)

## Required before starting

- A reference deliverable from Annie's existing work (or public-domain construction document)
- Access to a large-format printer for Measurement 3 (physical print)
