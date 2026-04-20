# Canvas Tools — Konva Read Discipline

Files in this directory are allowed to import from `konva` and `vue-konva`.

## The rule

**Tool files may read Konva state only at gesture-end events (`dragend`, `pointerup`, `mouseup`).**

- Reads during an in-progress gesture (`dragmove`, `pointermove`) are not permitted.
- Any value read from a Konva node must, in the same function, be converted to drawing
  coordinates via `viewportStore.canvasToDrawing()` and dispatched to Pinia.
- There is no case where a tool file holds Konva-sourced state across event boundaries.
- Violations of this rule must not be merged.

## The drag-harvest pattern (the ONE permitted Konva state read)

```typescript
node.on('dragend', () => {
  // This is the drag-harvest: the only permitted Konva position read.
  // Justified because native Konva drag updated node position without Pinia's knowledge,
  // and we must harvest the final position once to close the loop.
  const canvasPos = node.position();
  const drawingPos = viewportStore.canvasToDrawing(canvasPos);
  docStore.updatePlantPosition(plantId, drawingPos);
  // The read is complete. We never store canvasPos or reference the node again.
});
```

Any engineer proposing another Konva state read must explain why their case is analogous
to drag-harvest, not treat this pattern as a precedent for general reads.
