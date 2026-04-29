import {
  Assets,
  Cache,
  Container,
  Graphics,
  Circle,
  Sprite,
  BitmapText,
  BitmapFont,
  TextStyle,
  Texture,
} from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { Plant, Bed } from '@/stores/docStore';

const PX_PER_INCH = 96;
const WORLD_W = 120 * PX_PER_INCH;
const WORLD_H = 180 * PX_PER_INCH;
const SPRITE_SIZE = 512;

// Leader line constants (from FloraLeaderLineDrawing.cpp)
const NEARNESS_THRESHOLD = 2;
const STROKE_WIDTH = 1.5;
const ARROW_LENGTH_FACTOR = 10;
const ARROW_HALF_WIDTH_FACTOR = 3;

// LOD thresholds — tuned empirically for 300 plants
// At zoom < LOD_INVISIBLE: plant circles are < 2px screen radius — hide entirely
// At zoom < LOD_SIMPLE:    botanical sprite + label are < 7px — colored circle sufficient
// At zoom >= LOD_SIMPLE:   full detail (circle + sprite + label + leader line)
const LOD_INVISIBLE = 0.05;
const LOD_SIMPLE    = 0.12;

const SPECIES_COLORS: Record<string, number> = {
  oak: 0x4a7c59,
  magnolia: 0xc8a2c8,
  azalea: 0xff6b9d,
  fern: 0x7ec8a0,
};

const KNOWN_SPECIES = ['oak', 'magnolia', 'azalea', 'fern'];

interface Pt { x: number; y: number }
interface Rect { x: number; y: number; w: number; h: number }

/** Where a ray from `inside` toward `target` exits the bounding rect. */
function rayRectExit(rect: Rect, inside: Pt, target: Pt): Pt {
  const dx = target.x - inside.x;
  const dy = target.y - inside.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return inside;
  const { x: left, y: top } = rect;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  let tMin = 1e18;
  if (Math.abs(dx) > 1e-9) {
    for (const edge of [left, right]) {
      const t = (edge - inside.x) / dx;
      if (t > 0 && t < tMin) {
        const y = inside.y + t * dy;
        if (y >= top && y <= bottom) tMin = t;
      }
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const edge of [top, bottom]) {
      const t = (edge - inside.y) / dy;
      if (t > 0 && t < tMin) {
        const x = inside.x + t * dx;
        if (x >= left && x <= right) tMin = t;
      }
    }
  }
  if (tMin >= 1e17) return inside;
  return { x: inside.x + tMin * dx, y: inside.y + tMin * dy };
}

/** Point on the circle edge nearest to `from`. */
function circleEdgePoint(center: Pt, radius: number, from: Pt): Pt {
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x: center.x + radius, y: center.y };
  return { x: center.x + (dx / dist) * radius, y: center.y + (dy / dist) * radius };
}

async function svgToTexture(url: string): Promise<Texture> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  canvas.getContext('2d')!.drawImage(img, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return Texture.from(canvas);
}

export class PixiRenderer {
  private plantLayer: Container;
  private bedLayer: Container;
  private bgLayer: Container;
  private plantContainers = new Map<string, Container>();
  private labelOffsets = new Map<string, Pt>();
  private textureCache = new Map<string, Texture>();
  private currentLod = 2;
  private selectedIds = new Set<string>();

  constructor(
    private viewport: Viewport,
    private emit: (event: string, ...args: unknown[]) => void,
  ) {
    this.bgLayer = new Container();
    this.bedLayer = new Container();
    this.plantLayer = new Container();
    viewport.addChild(this.bgLayer, this.bedLayer, this.plantLayer);
  }

  async init(): Promise<void> {
    if (!Cache.has('plant-label-bitmap')) {
      BitmapFont.install({
        name: 'plant-label',
        style: new TextStyle({
          fontFamily: 'Times New Roman, Times, serif',
          fontSize: 96,
          fill: '#ffffff',
          fontWeight: 'bold',
        }),
        chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
        resolution: 2,
      });
    }

    await Promise.all(
      KNOWN_SPECIES.map(async (species) => {
        const texture = await svgToTexture(`/sprites/${species}.svg`);
        this.textureCache.set(species, texture);
      }),
    );
  }

  async setBackground(): Promise<void> {
    try {
      // resolution:5 rasterizes the SVG at 5× its native viewBox size (792×612 → 3960×3060),
      // giving crisp detail at typical zoom levels. autoGenerateMipmaps prevents aliasing
      // when zoomed out. Sprite width is set to WORLD_W; height is derived from the texture's
      // natural aspect ratio so the SVG is never stretched.
      const texture = await Assets.load({
        src: '/site-plan.svg',
        data: { resolution: 5, autoGenerateMipmaps: true },
      });
      const sprite = new Sprite(texture);
      sprite.width = WORLD_W;
      sprite.height = WORLD_W * (texture.height / texture.width);
      this.bgLayer.addChild(sprite);
    } catch {
      const bg = new Graphics();
      bg.rect(0, 0, WORLD_W, WORLD_H).fill({ color: 0xe8f5e9 });
      bg.rect(0, 0, WORLD_W, WORLD_H).stroke({ color: 0x2d5a1b, width: 4 });
      this.bgLayer.addChild(bg);
    }
  }

  syncPlants(plants: Plant[]): void {
    const toKeep = new Set(plants.map((p) => p.id));

    for (const [id, container] of this.plantContainers) {
      if (!toKeep.has(id)) {
        this.plantLayer.removeChild(container);
        container.destroy();
        this.plantContainers.delete(id);
        this.labelOffsets.delete(id);
      }
    }

    for (const plant of plants) {
      const cx = plant.position.x * PX_PER_INCH;
      const cy = plant.position.y * PX_PER_INCH;
      const r = plant.radius * PX_PER_INCH;

      let container = this.plantContainers.get(plant.id);

      if (!container) {
        container = new Container();
        container.eventMode = 'static';
        container.cursor = 'pointer';
        container.hitArea = new Circle(0, 0, r);

        const circle = new Graphics();
        circle.label = 'circle';
        circle.eventMode = 'none';

        const texture = this.textureCache.get(plant.speciesType) ?? Texture.WHITE;
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.eventMode = 'none';
        sprite.label = 'sprite';

        const leaderGfx = new Graphics();
        leaderGfx.eventMode = 'none';
        leaderGfx.label = 'leader';

        const label = new BitmapText({
          text: plant.label,
          style: { fontFamily: 'plant-label', fontSize: Math.max(8, r * 0.5) },
        });
        label.anchor.set(0.5, 0.5);
        label.eventMode = 'static';
        label.cursor = 'grab';
        label.label = 'label';

        // Default label offset: upper-right of plant
        const offset: Pt = { x: r * 1.6, y: -r * 0.8 };
        label.position.set(offset.x, offset.y);
        this.labelOffsets.set(plant.id, offset);

        container.addChild(circle, sprite, leaderGfx, label);
        this.setupPlantDrag(container, plant.id);
        this.setupLabelDrag(label, plant.id);
        this.applyLOD(container, this.currentLod);
        this.plantLayer.addChild(container);
        this.plantContainers.set(plant.id, container);
      }

      container.x = cx;
      container.y = cy;
      container.hitArea = new Circle(0, 0, r);

      const circle = container.getChildByLabel('circle') as Graphics;
      circle.clear();
      circle.circle(0, 0, r).fill({ color: SPECIES_COLORS[plant.speciesType] ?? 0xaaaaaa, alpha: 0.7 });

      const sprite = container.getChildByLabel('sprite') as Sprite;
      sprite.width = r * 1.6;
      sprite.height = r * 1.6;

      const label = container.getChildByLabel('label') as BitmapText;
      label.style.fontSize = Math.max(8, r * 0.5);

      this.drawLeaderLine(plant.id, r);
    }
  }

  private drawLeaderLine(plantId: string, r: number): void {
    const container = this.plantContainers.get(plantId);
    if (!container) return;

    const leaderGfx = container.getChildByLabel('leader') as Graphics;
    const label = container.getChildByLabel('label') as BitmapText;
    if (!leaderGfx || !label) return;

    leaderGfx.clear();

    const lx = label.x;
    const ly = label.y;
    const labelCenter: Pt = { x: lx, y: ly };
    const circleCenter: Pt = { x: 0, y: 0 };

    const lw = label.width + 8;
    const lh = label.height + 4;
    const labelRect: Rect = { x: lx - lw / 2, y: ly - lh / 2, w: lw, h: lh };

    const dxC = lx - circleCenter.x;
    const dyC = ly - circleCenter.y;
    const distToCenter = Math.sqrt(dxC * dxC + dyC * dyC);
    if (distToCenter <= r) return;

    const labelEdgePt = rayRectExit(labelRect, labelCenter, circleCenter);
    const circleEdgePt = circleEdgePoint(circleCenter, r, labelCenter);

    const dx = labelEdgePt.x - circleEdgePt.x;
    const dy = labelEdgePt.y - circleEdgePt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= NEARNESS_THRESHOLD) return;

    const arrowLen = STROKE_WIDTH * ARROW_LENGTH_FACTOR;
    if (dist <= arrowLen * 2) {
      leaderGfx
        .moveTo(labelEdgePt.x, labelEdgePt.y)
        .lineTo(circleEdgePt.x, circleEdgePt.y)
        .stroke({ color: 0xe0e0e0, width: STROKE_WIDTH });
      return;
    }

    const adx = circleEdgePt.x - labelEdgePt.x;
    const ady = circleEdgePt.y - labelEdgePt.y;
    const aDist = Math.sqrt(adx * adx + ady * ady);
    const ux = adx / aDist;
    const uy = ady / aDist;
    const arrowBase: Pt = {
      x: circleEdgePt.x - ux * arrowLen,
      y: circleEdgePt.y - uy * arrowLen,
    };

    leaderGfx
      .moveTo(labelEdgePt.x, labelEdgePt.y)
      .lineTo(arrowBase.x, arrowBase.y)
      .stroke({ color: 0xe0e0e0, width: STROKE_WIDTH });

    const halfW = STROKE_WIDTH * ARROW_HALF_WIDTH_FACTOR;
    const px = -uy;
    const py = ux;
    leaderGfx
      .poly([
        circleEdgePt.x, circleEdgePt.y,
        arrowBase.x + px * halfW, arrowBase.y + py * halfW,
        arrowBase.x - px * halfW, arrowBase.y - py * halfW,
      ])
      .fill({ color: 0xe0e0e0 });
  }

  updateLOD(zoom: number): void {
    const lod = zoom < LOD_INVISIBLE ? 0 : zoom < LOD_SIMPLE ? 1 : 2;
    if (lod === this.currentLod) return;
    this.currentLod = lod;
    for (const container of this.plantContainers.values()) {
      this.applyLOD(container, lod);
    }
  }

  private applyLOD(container: Container, lod: number): void {
    container.visible = lod > 0;
    const sprite = container.getChildByLabel('sprite') as Sprite | null;
    const label  = container.getChildByLabel('label')  as BitmapText | null;
    const leader = container.getChildByLabel('leader') as Graphics | null;
    if (sprite) sprite.visible = lod >= 2;
    if (label)  label.visible  = lod >= 2;
    if (leader) leader.visible = lod >= 2;
  }

  syncBeds(beds: Bed[]): void {
    this.bedLayer.removeChildren();

    for (const bed of beds) {
      const g = new Graphics();
      const anchors = bed.anchors;

      g.moveTo(anchors[0].position.x * PX_PER_INCH, anchors[0].position.y * PX_PER_INCH);

      for (let i = 1; i < anchors.length; i++) {
        const prev = anchors[i - 1];
        const curr = anchors[i];
        g.bezierCurveTo(
          prev.handleOut.x * PX_PER_INCH, prev.handleOut.y * PX_PER_INCH,
          curr.handleIn.x * PX_PER_INCH,  curr.handleIn.y * PX_PER_INCH,
          curr.position.x * PX_PER_INCH,  curr.position.y * PX_PER_INCH,
        );
      }

      if (bed.closed) {
        const last = anchors[anchors.length - 1];
        const first = anchors[0];
        g.bezierCurveTo(
          last.handleOut.x * PX_PER_INCH,  last.handleOut.y * PX_PER_INCH,
          first.handleIn.x * PX_PER_INCH,  first.handleIn.y * PX_PER_INCH,
          first.position.x * PX_PER_INCH,  first.position.y * PX_PER_INCH,
        );
        g.closePath();
      }

      const colorHex = bed.fillColor.slice(1, 7);
      const alphaHex = bed.fillColor.length === 9 ? bed.fillColor.slice(7, 9) : 'ff';
      g.fill({ color: parseInt(colorHex, 16), alpha: parseInt(alphaHex, 16) / 255 });
      g.stroke({ color: 0x2d5a1b, width: 2 });
      this.bedLayer.addChild(g);
    }
  }

  setSelected(ids: Set<string>): void {
    this.selectedIds = ids;
    for (const [id, container] of this.plantContainers) {
      const isSelected = ids.has(id);
      container.alpha = isSelected ? 0.8 : 1.0;
      const sprite = container.getChildByLabel('sprite') as Sprite | null;
      if (sprite) sprite.tint = isSelected ? 0xffff99 : 0xffffff;
    }
  }

  setBackgroundVisible(visible: boolean): void {
    this.bgLayer.visible = visible;
  }

  getShapeCount(): number {
    return this.plantContainers.size + this.bedLayer.children.length + 1;
  }

  selectByLasso(lx: number, ly: number, rx: number, ry: number): void {
    const hits: string[] = [];
    for (const [id, container] of this.plantContainers) {
      if (container.x >= lx && container.x <= rx && container.y >= ly && container.y <= ry) {
        hits.push(id);
      }
    }
    if (hits.length > 0) this.emit('selectMany', hits);
  }

  private setupPlantDrag(container: Container, plantId: string): void {
    let active = false;
    let didDrag = false;
    let shiftOnDown = false;
    let startClient = { x: 0, y: 0 };
    type Snap = { id: string; c: Container; sx: number; sy: number };
    let snapshots: Snap[] = [];

    container.on('pointerdown', (e) => {
      active = true;
      didDrag = false;
      shiftOnDown = e.shiftKey;
      startClient = { x: e.clientX, y: e.clientY };

      // Drag the whole selection if this plant is part of it, otherwise just this plant
      const idsToMove = this.selectedIds.has(plantId) ? this.selectedIds : new Set([plantId]);
      snapshots = [...idsToMove].flatMap((id) => {
        const c = this.plantContainers.get(id);
        return c ? [{ id, c, sx: c.x, sy: c.y }] : [];
      });

      this.viewport.plugins.pause('drag');
      e.stopPropagation();
    });

    container.on('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - startClient.x;
      const dy = e.clientY - startClient.y;
      if (!didDrag && Math.sqrt(dx * dx + dy * dy) >= 4) didDrag = true;
      if (!didDrag) return;
      const z = this.viewport.scale.x;
      for (const { id, c, sx, sy } of snapshots) {
        c.x = sx + dx / z;
        c.y = sy + dy / z;
        this.drawLeaderLine(id, (c.hitArea as Circle)?.radius ?? 48);
      }
    });

    const onUp = () => {
      if (!active) return;
      active = false;
      this.viewport.plugins.resume('drag');
      if (didDrag) {
        for (const { id, c } of snapshots) {
          this.emit('dragEnd', id, { x: c.x / PX_PER_INCH, y: c.y / PX_PER_INCH });
        }
      } else {
        this.emit(shiftOnDown ? 'toggleSelect' : 'select', plantId);
      }
    };

    container.on('pointerup', onUp);
    container.on('pointerupoutside', onUp);
  }

  private setupLabelDrag(label: BitmapText, plantId: string): void {
    let active = false;
    let startClient = { x: 0, y: 0 };
    let startLabelPos = { x: 0, y: 0 };

    label.on('pointerdown', (e) => {
      e.stopPropagation();
      active = true;
      startClient = { x: e.clientX, y: e.clientY };
      startLabelPos = { x: label.x, y: label.y };
      this.viewport.plugins.pause('drag');
      label.cursor = 'grabbing';
    });

    label.on('pointermove', (e) => {
      if (!active) return;
      const z = this.viewport.scale.x;
      const dx = (e.clientX - startClient.x) / z;
      const dy = (e.clientY - startClient.y) / z;
      label.x = startLabelPos.x + dx;
      label.y = startLabelPos.y + dy;
      this.labelOffsets.set(plantId, { x: label.x, y: label.y });

      const container = this.plantContainers.get(plantId);
      const r = (container?.hitArea as Circle)?.radius ?? 48;
      this.drawLeaderLine(plantId, r);
    });

    const onUp = () => {
      if (!active) return;
      active = false;
      this.viewport.plugins.resume('drag');
      label.cursor = 'grab';
    };

    label.on('pointerup', onUp);
    label.on('pointerupoutside', onUp);
  }
}
