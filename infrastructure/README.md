# Infrastructure (Experiment 0)

This is the only code in the spike repo that ships to production.

## eslint-config/

Canonical ESLint configuration enforcing the Konva write-only discipline via import boundaries.
Copy this config into each experiment directory. When the production Flora repo is created,
copy it there directly — it needs no modification.

**Rule:** Only files in `src/canvas/projection/**` and `src/canvas/tools/**` may import
from `konva` or `vue-konva`. Any other file doing so is a CI failure.

## coordinate-tests/

Unit tests for the `drawingToCanvas` / `canvasToDrawing` conversion functions.
These functions are the foundation of the entire coordinate system.

Run: `npm test` inside `coordinate-tests/`.

Both must pass CI before any canvas code is written.
