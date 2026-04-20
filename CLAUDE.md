# CLAUDE.md — Flora Derisking Experiments

## Code quality

See `docs/ClaudeCodeRules.md` for the full rule list. Short version:

- One responsibility per file/function
- Files under 700 lines (target 500)
- No magic numbers — named constants
- No vague names (`data`, `result`, `temp`, `handler`)
- Explicit error handling — no silent failures

**Infrastructure code** (Experiment 0, `infrastructure/`) is production-bound. Apply rules strictly.

**Spike code** (Experiments 1–3) is deliberately throwaway. Apply rules loosely.
Unstyled buttons and `console.log` are fine. Do not polish what won't ship.

## Architecture rules (all experiments)

**Konva write-only rule:** Only `src/canvas/projection/` and `src/canvas/tools/` may import
from `konva` or `vue-konva`. All other files: forbidden. Enforced by ESLint.

**Drag-harvest pattern:** The ONE permitted Konva state read is `node.position()` at `dragend`,
immediately converted to drawing coordinates and dispatched to Pinia. See
`experiment-1/src/canvas/tools/README.md` for the canonical definition.

**Coordinates:** Always store and pass positions in drawing-space inches. Convert to canvas pixels
only at render time using `viewportStore.drawingToCanvas()`. Never store pixels in `docStore`.

## Repo rules

Do not start a later experiment until the previous one passes its go/no-go gate.
Every measurement is a file in `measurements/exp-N/`. No verbal passes.
