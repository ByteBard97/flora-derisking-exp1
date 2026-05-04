# Plan — positioned soft-bloom secondary color

## Goal

Let the user (Annie) place a soft watercolor "bloom" of secondary color at a specific spot inside each plant — matching the Wild Ones references where one region of a plant has a distinct secondary hue (e.g., pink in upper-left of an otherwise-green mass), with a soft watercolor edge fading into the primary wash.

This replaces the current bloom-overlay pass that scatters secondary color via texture density across the whole silhouette, which produces specks rather than a localized region.

## Reference behavior

Looking at the Wild Ones screenshots:
1. Each plant has a primary wash covering most of its area.
2. A secondary color occupies a *localized* region with a soft, watercolor-feathered edge.
3. The two colors overlap in a transition zone with painterly mixing (paper grain visible, not a hard line).
4. Different plants in the same scene have their secondary in different positions — no two are identical.

## Algorithm change

Replace the current bloom pass (`source-over` overlay of `blooms-rose` texture sampled at hashed offset) with a **positioned soft radial blob**:

```
For each plant:
  1. Solid base fill (primary)
  2. Multiply-blend primary pigment pass (wash texture, darkened primary)   [unchanged]
  3. Inside silhouette clip:
     a. Build a radial gradient at (anchor.x, anchor.y) with radius R
     b. Color stops: bloomColor at full alpha (center) → bloomColor at zero alpha (edge),
        with `softness` controlling the gradient curve's S-shape
     c. Fill the silhouette path with this gradient (source-over)
     d. Apply bloom texture multiply *only inside the gradient's high-alpha region*
        (achieved by drawing the texture with destination-in-style masking, OR by
         pre-rendering the gradient onto a sub-canvas, multiplying texture into it,
         then drawing the sub-canvas onto the main canvas)
  4. Edge darken                                                             [unchanged]
  5. Outline                                                                 [unchanged]
```

The positioned blob covers a specific region with bloomColor; the texture multiply gives it watercolor character (paper grain, density variation) instead of a flat circle.

## Parameter additions

`PlantSymbolParams`:
- `bloomAnchor: { x: number; y: number }` — position in 0..1 normalized to plant bbox (center = `{0.5, 0.5}`)
- `bloomRadius: number` — fraction of `displayRadius` (default ~0.55)
- `bloomSoftness: number` — gradient curve sharpness, 0..1 (default ~0.7)

`bloomColor` already exists in `WatercolorParams`; stays.

## Per-plant variation

So 12 plants don't all bloom in the same spot, derive a default anchor from the plant's seed:
```ts
function defaultAnchor(seed: number): { x: number; y: number } {
  // Polar offset, magnitude 0.15..0.35 from center
  const angle = hashFract(seed) * Math.PI * 2
  const r = 0.15 + hashFract(seed * 7) * 0.20
  return { x: 0.5 + Math.cos(angle) * r, y: 0.5 + Math.sin(angle) * r }
}
```
This is the *default* if no user override exists; the playground UI can replace it.

## Playground UI

Three additions to `TabPlantStylePlayground.vue`:

1. **Click-on-plant to select.** Each rendered Sprite gets `eventMode = 'static'`. Click → marks that plantId as the active selection. A semi-transparent outline ring overlays the selected plant.

2. **Click-drag inside selected plant to set anchor.** Pointer events on the canvas:
   - `pointerdown` over the selected plant's bounds → start drag
   - `pointermove` while dragging → update that plant's anchor in local coords
   - `pointerup` → commit
   The Sprite re-renders on every pointermove (canvas pipeline, single plant, ~5ms).

3. **Two global sliders** in the toolbar:
   - `Bloom Radius` (0.2..1.5 of plant radius)
   - `Bloom Softness` (0..1)
   Apply to all plants. (Per-plant size/softness can come later if needed.)

**Anchor storage:**
```ts
const anchorOverrides = ref(new Map<number, { x: number; y: number }>())
```
Resolution: `anchorOverrides.get(plantId) ?? defaultAnchor(plantId)`.

When the user picks a new preset or changes colors → keep anchors. Anchors only reset on a "reset anchors" button (cheap to add).

## File changes

| File | Change |
|---|---|
| `src/lib/plantSymbol.ts` | Replace bloom-overlay pass with positioned-radial-gradient blob; add `bloomAnchor`, `bloomRadius`, `bloomSoftness` to `PlantSymbolParams` and `WatercolorParams`; add `defaultAnchor(seed)` helper |
| `src/tabs/TabPlantStylePlayground.vue` | Add: bloom radius + softness sliders; per-plant anchor map; sprite interactivity; pointer drag handlers; visual overlay for selected plant |

No other files affected. No new dependencies. No backend changes.

## Performance

Canvas re-render of one plant = ~5ms. Live drag of an anchor will fire pointermove at ~120 Hz; we throttle re-renders to once per animation frame via `requestAnimationFrame` so we don't queue work faster than we display it. Other 11 plants stay cached and their textures aren't touched.

## Edge cases / failure modes I've thought of

1. **Anchor outside silhouette.** A plant with an irregular shape (e.g., spiky agave) could have its anchor land in a "spike" region with very thin coverage. The gradient still draws — clipped to the silhouette — but the bloom may appear truncated. Acceptable; it's how watercolor wash actually behaves on irregular masses.
2. **Drag goes off-canvas.** Clamp anchor to [0..1] in both axes.
3. **Click on empty canvas.** Deselect (click handler bound to stage, not just sprites).
4. **Re-render storm during drag.** Throttle via rAF.
5. **Bloom radius 0 or softness 0.** Either should produce no visible bloom (or a hard-edged dot). Don't crash; allow.
6. **Anchor jitter for plants with seed=0.** `hashFract(0)` is deterministic but small; could be visually identical for plant 0 and plant N if they share a seed. Add a small constant offset to the seed before hashing.

## Out of scope (explicit non-goals)

- Multiple positionable blooms per plant — single blob only.
- Per-plant bloom color (everyone uses the global picker).
- Per-plant size/softness (everyone uses the global sliders).
- Saving/loading anchor positions to/from backend (live-only for now).
- Click-to-add-bloom-shape painting tool.

## Estimated effort

~40 minutes of focused work, broken down:
- 15 min: algorithm + param plumbing in `plantSymbol.ts`
- 10 min: sliders in toolbar + anchor map + per-plant override resolution
- 12 min: pointer interactivity (sprite eventMode, drag handlers, selection ring)
- 3 min: rAF throttling + edge case handling

## What I want Kimi to check

1. Is the radial-gradient + texture-multiply blend order correct, or should the texture be multiplied in a different stage (e.g., onto the bloom *before* drawing it onto the silhouette)?
2. Is the anchor-in-local-bbox-coords approach right, or should anchor be in plant world coords so it's stable across symbol scaling?
3. Anything I'm missing about Pixi v8 sprite event handling that'll bite when I implement the drag?
4. Is the click-drag interaction model correct, or is there a better UX pattern for "place a bloom in a plant"?
