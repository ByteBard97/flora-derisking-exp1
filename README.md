# Flora Architecture Derisking Experiments

Spike repository. Run experiments, measure, decide. Do not copy spike code to production.

## Canonical documents

- [`docs/FLORA_DERISKING_EXPERIMENTS_v2.md`](docs/FLORA_DERISKING_EXPERIMENTS_v2.md) — what to build and measure
- [`docs/FLORA_EXECUTION_PLAN.md`](docs/FLORA_EXECUTION_PLAN.md) — how to operate the spike period
- [`docs/FLORA_ARCHITECTURE_DEBATE.md`](docs/FLORA_ARCHITECTURE_DEBATE.md) — architecture decision record

## Structure

```
infrastructure/      Experiment 0: lint rule + coordinate unit tests (ports to production)
experiment-1/        Rendering & drag POC (Konva + Pinia, 300 plants)
experiment-2/        Bed drawing tool (freehand → bezier, Turf.js worker)
experiment-3/        Export gates (PDF + SVG)
measurements/        Numeric results per experiment — one file per measurement
annie-reviews/       Weekly review notes: what was shown, what she said, what changed
```

## Running order

Experiment 0 → 1 → 2 → 3. Do not start an experiment until the previous one passes its go/no-go.

## Code quality

Infrastructure code (Experiment 0) is production-bound — apply `ClaudeCodeRules.md` strictly.
Spike code (Experiments 1–3) is throwaway — apply rules loosely. No polish, no error states, console.log is fine.
