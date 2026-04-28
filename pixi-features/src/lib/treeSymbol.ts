/**
 * treeSymbol.ts — plan-view landscape tree symbol for Pixi.js v8
 *
 * PURPOSE
 * -------
 * Draws the *vector skeleton* of a landscape-architecture plan-view tree
 * symbol (circle, spokes, shadow, trunk dot). This is the input layer for
 * Flora's NPR pipeline — it is intentionally plain. The aesthetic
 * finishing (WatercolorWashFilter, AnisotropicKuwahara, colored-pencil
 * crosshatch, etc.) is applied by the shader chain in TabWatercolor /
 * TabSketch, not here.
 *
 * CACHING PATTERN
 * ---------------
 * Draw once, then cache each plant's Graphics leaf individually:
 *
 *   const gfx = new Graphics();
 *   drawTreeSymbol(gfx, 0, 0, radius, color, 'watercolor', seed);
 *   gfx.cacheAsTexture(true);           // ← method call, not property
 *   parent.addChild(gfx);
 *
 * For sharper results at high zoom levels, use the options form:
 *   gfx.cacheAsTexture({ resolution: window.devicePixelRatio });
 *
 * FOOT-GUN: Do NOT call cacheAsTexture() on the parent Container that
 * TabWatercolor or TabSketch applies filters to. Set it only on each
 * individual plant Graphics leaf. Caching a filtered Container captures
 * pre-filter pixels; the filter then runs on the stale cache, causing
 * double-application or incorrect results when shader uniforms change
 * (e.g. on pan / zoom). This is a real failure mode.
 *
 * WIND / GROWTH ANIMATION
 * -----------------------
 * Most plants are static geometry with shader-driven animation. Animate
 * via shader uniforms on the cached sprite — do NOT redraw the Graphics
 * each frame. Example pattern (wind sway via uniform, not redraw):
 *
 *   app.ticker.add((ticker) => {
 *     windFilter.resources.uniforms.uniforms.uWindTime = ticker.lastTime / 1000;
 *     // uWindVector, uGrowthFactor, etc. are also updated here
 *   });
 *
 * The only case where you would genuinely redraw every frame is if the
 * wobble itself animates over time (e.g. `seed` morphs as a function of
 * `t`). That is NOT in the current spec — if it becomes a requirement,
 * remove cacheAsTexture() from the affected plants and accept the cost.
 *
 * SPECIES COLORS
 * --------------
 * Values match SPECIES_COLORS in pixi-features/src/canvas/PixiRenderer.ts.
 * Placeholders from the user prompt differed for magnolia, azalea, fern:
 *   - oak      0x4a7c59  ← identical in both sources
 *   - magnolia 0xc8a2c8  ← real value (prompt had 0xe8d5b7)
 *   - azalea   0xff6b9d  ← real value (prompt had 0xc44569)
 *   - fern     0x7ec8a0  ← real value (prompt had 0x6b8e3d)
 *
 * FILE LOCATION: pixi-features/src/lib/treeSymbol.ts
 * FEEDS: TabWatercolor, TabSketch (spike tabs, not production code)
 */

import { Graphics, Container } from 'pixi.js';

// ---------------------------------------------------------------------------
// Species color constants — kept in sync with PixiRenderer.ts SPECIES_COLORS
// ---------------------------------------------------------------------------
export const SPECIES_COLORS = {
  oak:      0x4a7c59,
  magnolia: 0xc8a2c8,
  azalea:   0xff6b9d,
  fern:     0x7ec8a0,
} as const;

export type SpeciesName = keyof typeof SPECIES_COLORS;

// ---------------------------------------------------------------------------
// Seeded RNG — mulberry32 (~6 lines, public domain)
// Always construct fresh from seed at the top of each drawTreeSymbol call
// so same args → byte-identical output regardless of call order.
// ---------------------------------------------------------------------------
function makeMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff;
  };
}

// ---------------------------------------------------------------------------
// Style-specific constants
// ---------------------------------------------------------------------------
const SPOKE_COUNT_WATERCOLOR = 8;
const SPOKE_COUNT_SKETCH      = 6;
const SPOKE_COUNT_TECHNICAL   = 8;

const SHADOW_OFFSET_FACTOR = 0.25;  // shadow offset as fraction of radius
const SHADOW_SIZE_FACTOR   = 0.55;  // shadow circle radius as fraction of radius
const SHADOW_ALPHA         = 0.18;

const TRUNK_DOT_FACTOR     = 0.07;  // trunk dot radius as fraction of radius

const WOBBLE_POINT_COUNT   = 60;    // polygon vertex count for sketch outline
const WOBBLE_AMPLITUDE_PX  = 3;     // ±px noise on sketch outline radius

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Draw a plan-view landscape tree symbol onto `gfx`.
 *
 * The Graphics is drawn in local space centered at (x, y). Typically you
 * position the Graphics via its container transform instead of x/y, but
 * both work — x/y are included so a single shared Graphics can hold
 * multiple symbols for a static demo scene.
 *
 * @param gfx     Pixi v8 Graphics to draw into (not cleared — caller decides)
 * @param x       Center x in the Graphics's local coordinate space
 * @param y       Center y in the Graphics's local coordinate space
 * @param radius  Canopy radius in pixels (convert from inches before calling)
 * @param color   Hex species color (e.g. SPECIES_COLORS.oak)
 * @param style   'watercolor' | 'sketch' | 'technical'
 * @param seed    Seeded integer — use plant.id hash for stable per-plant wobble
 */
export function drawTreeSymbol(
  gfx: Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
  style: 'watercolor' | 'sketch' | 'technical',
  seed: number,
): void {
  // Fresh RNG per call — guarantees byte-identical output for same args.
  const rand = makeMulberry32(seed);

  if (style === 'watercolor') {
    _drawWatercolor(gfx, x, y, radius, color, rand);
  } else if (style === 'sketch') {
    _drawSketch(gfx, x, y, radius, color, rand);
  } else {
    _drawTechnical(gfx, x, y, radius, color);
  }
}

// ---------------------------------------------------------------------------
// Style implementations
// ---------------------------------------------------------------------------

/**
 * WATERCOLOR skeleton
 *
 * Soft filled circle (alpha ~0.6), 8 radial spokes with ±10% length jitter,
 * shadow circle offset SE drawn BEFORE canopy so it sits underneath, no
 * hard outline. Designed to look correct after WatercolorWash + Kuwahara.
 */
function _drawWatercolor(
  gfx: Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
  rand: () => number,
): void {
  const shadowOffsetX = radius * SHADOW_OFFSET_FACTOR;
  const shadowOffsetY = radius * SHADOW_OFFSET_FACTOR;
  const shadowRadius  = radius * SHADOW_SIZE_FACTOR;

  // Shadow FIRST — must be below canopy in z-order.
  gfx
    .circle(x + shadowOffsetX, y + shadowOffsetY, shadowRadius)
    .fill({ color: 0x000000, alpha: SHADOW_ALPHA });

  // Canopy fill.
  gfx
    .circle(x, y, radius)
    .fill({ color, alpha: 0.6 });

  // Spokes — each as its own moveTo/lineTo pair (clean stroke caps at center).
  const spokeColor = _darken(color, 0.55);
  for (let i = 0; i < SPOKE_COUNT_WATERCOLOR; i++) {
    const angle      = (i / SPOKE_COUNT_WATERCOLOR) * Math.PI * 2;
    // ±10% length jitter — rand() produces [0, 1), center at 0.5
    const lengthMult = 0.90 + rand() * 0.20;
    const spokeLen   = radius * lengthMult;
    const ex = x + Math.cos(angle) * spokeLen;
    const ey = y + Math.sin(angle) * spokeLen;

    gfx
      .moveTo(x, y)
      .lineTo(ex, ey)
      .stroke({ color: spokeColor, width: 1.0, alpha: 0.55, cap: 'round' });
  }
}

/**
 * SKETCH skeleton
 *
 * Unfilled wobbly circle outline (60-point polygon with ±3px radius noise),
 * 6 bold spokes to 80% of radius, trunk dot at center. Designed to look
 * correct after colored-pencil crosshatch + wobble filter.
 */
function _drawSketch(
  gfx: Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
  rand: () => number,
): void {
  // Wobbly outline — flat number[] of alternating x/y pairs.
  const outlinePoints: number[] = [];
  for (let i = 0; i < WOBBLE_POINT_COUNT; i++) {
    const angle    = (i / WOBBLE_POINT_COUNT) * Math.PI * 2;
    const wobble   = (rand() - 0.5) * 2 * WOBBLE_AMPLITUDE_PX;
    const r        = radius + wobble;
    outlinePoints.push(x + Math.cos(angle) * r);
    outlinePoints.push(y + Math.sin(angle) * r);
  }
  // poly() with close=true closes the polygon automatically.
  gfx
    .poly(outlinePoints, true)
    .stroke({ color, width: 1.8, alpha: 0.85, cap: 'round', join: 'round' });

  // Spokes to 80% of radius — each its own moveTo/lineTo pair.
  const spokeLen = radius * 0.80;
  for (let i = 0; i < SPOKE_COUNT_SKETCH; i++) {
    const angle = (i / SPOKE_COUNT_SKETCH) * Math.PI * 2;
    const ex    = x + Math.cos(angle) * spokeLen;
    const ey    = y + Math.sin(angle) * spokeLen;

    gfx
      .moveTo(x, y)
      .lineTo(ex, ey)
      .stroke({ color, width: 1.4, alpha: 0.70, cap: 'round' });
  }

  // Trunk dot at center.
  const trunkR = Math.max(2, radius * TRUNK_DOT_FACTOR);
  gfx
    .circle(x, y, trunkR)
    .fill({ color, alpha: 0.9 });
}

/**
 * TECHNICAL skeleton
 *
 * Clean circle outline, 8 uniform spokes to full radius, centered trunk dot.
 * Standard CAD output — no randomness, no alpha tricks.
 */
function _drawTechnical(
  gfx: Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
): void {
  // Circle outline.
  gfx
    .circle(x, y, radius)
    .stroke({ color, width: 1.0, alpha: 1.0 });

  // Spokes — each its own moveTo/lineTo pair.
  for (let i = 0; i < SPOKE_COUNT_TECHNICAL; i++) {
    const angle = (i / SPOKE_COUNT_TECHNICAL) * Math.PI * 2;
    const ex    = x + Math.cos(angle) * radius;
    const ey    = y + Math.sin(angle) * radius;

    gfx
      .moveTo(x, y)
      .lineTo(ex, ey)
      .stroke({ color, width: 0.8, alpha: 0.8 });
  }

  // Trunk dot.
  const trunkR = Math.max(2, radius * TRUNK_DOT_FACTOR);
  gfx
    .circle(x, y, trunkR)
    .fill({ color, alpha: 1.0 });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Darken a hex color by multiplying each channel by `factor` (0–1).
 * Used to derive spoke color from species color without importing a
 * full color library.
 */
function _darken(hex: number, factor: number): number {
  const r = ((hex >> 16) & 0xff) * factor;
  const g = ((hex >> 8)  & 0xff) * factor;
  const b = (hex         & 0xff) * factor;
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/**
 * Hash a string plant ID to a stable uint32 seed.
 * Use as: `drawTreeSymbol(gfx, x, y, r, color, style, hashId(plant.id))`
 */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Demo — four species in a row (eyeball check for TabWatercolor / TabSketch)
// ---------------------------------------------------------------------------

const DEMO_SPECIES: Array<{ name: SpeciesName; label: string }> = [
  { name: 'oak',      label: 'Oak'      },
  { name: 'azalea',   label: 'Azalea'   },
  { name: 'magnolia', label: 'Magnolia' },
  { name: 'fern',     label: 'Fern'     },
];

const DEMO_RADIUS    = 40;    // pixels
const DEMO_SPACING   = 110;   // pixels between centers
const DEMO_ROW_GAP   = 120;   // pixels between style rows

/**
 * Draw all three style rows for the four demo species into `parent`.
 *
 * Each plant gets its own Graphics leaf with cacheAsTexture(true) applied
 * per the Flora caching pattern (see file header). The parent Container
 * must NOT have cacheAsTexture() called on it — filters are applied there.
 *
 * @param parent Container to add the plants into (filters applied externally)
 * @param originX Left edge of the demo row in parent-local coords
 * @param originY Top of the first row in parent-local coords
 */
export function drawFourSpeciesDemo(
  parent: Container,
  originX = 60,
  originY = 60,
): void {
  const styles: Array<'watercolor' | 'sketch' | 'technical'> = [
    'watercolor',
    'sketch',
    'technical',
  ];

  for (let rowIdx = 0; rowIdx < styles.length; rowIdx++) {
    const style = styles[rowIdx];
    const rowY  = originY + rowIdx * DEMO_ROW_GAP + DEMO_RADIUS;

    for (let colIdx = 0; colIdx < DEMO_SPECIES.length; colIdx++) {
      const { name } = DEMO_SPECIES[colIdx];
      const cx = originX + colIdx * DEMO_SPACING + DEMO_RADIUS;
      const cy = rowY;

      // One Graphics per plant — required so cacheAsTexture() is per-leaf.
      const gfx = new Graphics();
      drawTreeSymbol(
        gfx,
        0, 0,               // draw at local origin; position via container transform
        DEMO_RADIUS,
        SPECIES_COLORS[name],
        style,
        hashId(`demo-${name}-${style}`),
      );
      gfx.x = cx;
      gfx.y = cy;

      // Cache each leaf individually.
      // NOTE: cacheAsTexture is a METHOD in Pixi v8, not a property.
      // The user prompt suggested `gfx.cacheAsTexture = true` (property form)
      // but the actual API is `gfx.cacheAsTexture(true)` (method form).
      // Use the options form for HiDPI sharpness at zoom:
      //   gfx.cacheAsTexture({ resolution: window.devicePixelRatio });
      gfx.cacheAsTexture(true);

      parent.addChild(gfx);
    }
  }
}
