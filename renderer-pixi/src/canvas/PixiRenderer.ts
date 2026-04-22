import {
  Application,
  Container,
  Graphics,
  Sprite,
  BitmapText,
  Texture,
} from 'pixi.js';
import type { Plant, Bed } from '@/stores/docStore';

const PX_PER_INCH = 96;
const WORLD_W = 120 * PX_PER_INCH;
const WORLD_H = 180 * PX_PER_INCH;

const SPECIES_COLORS: Record<string, number> = {
  oak: 0x4a7c59,
  magnolia: 0xc8a2c8,
  azalea: 0xff6b9d,
  fern: 0x7ec8a0,
};

/**
 * Pure Pixi rendering layer — no Vue reactivity.
 *
 * Sprite textures: the spec calls for /sprites/{species}.png.
 * The public/sprites/ directory currently contains .svg files.
 * Run `npm run rasterize` once to generate the PNGs before the first run.
 * If the PNG is missing, Pixi falls back to a white placeholder texture.
 */
export class PixiRenderer {
  private plantLayer: Container;
  private bedLayer: Container;
  private bgLayer: Container;
  private plantContainers = new Map<string, Container>();
  private textureCache = new Map<string, Texture>();

  constructor(
    private app: Application,
    private emit: (event: string, ...args: unknown[]) => void,
  ) {
    this.plantLayer = new Container();
    this.bedLayer = new Container();
    this.bgLayer = new Container();
    app.stage.addChild(this.bgLayer, this.bedLayer, this.plantLayer);
  }

  /**
   * Renders the site-plan SVG as the world background.
   * Pixi v8 can load SVGs directly via Assets; if loading fails (e.g. CORS or
   * unsupported format), falls back to a solid-color rectangle.
   */
  setBackground(): void {
    try {
      const texture = Texture.from('/site-plan.svg');
      const sprite = new Sprite(texture);
      sprite.width = WORLD_W;
      sprite.height = WORLD_H;
      sprite.x = 0;
      sprite.y = 0;
      this.bgLayer.addChild(sprite);
    } catch {
      // Fallback: solid light-green rect representing the lot boundary
      const bg = new Graphics();
      bg.rect(0, 0, WORLD_W, WORLD_H);
      bg.fill({ color: 0xe8f5e9 });
      bg.rect(0, 0, WORLD_W, WORLD_H);
      bg.stroke({ color: 0x2d5a1b, width: 4 });
      this.bgLayer.addChild(bg);
    }
  }

  syncPlants(plants: Plant[]): void {
    const toKeep = new Set(plants.map((p) => p.id));

    // Remove stale containers
    for (const [id, container] of this.plantContainers) {
      if (!toKeep.has(id)) {
        this.plantLayer.removeChild(container);
        container.destroy();
        this.plantContainers.delete(id);
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

        // Circle background
        const circle = new Graphics();
        circle.circle(0, 0, r);
        circle.fill({ color: SPECIES_COLORS[plant.speciesType] ?? 0xaaaaaa, alpha: 0.7 });
        circle.label = 'circle';

        // Sprite — PNG expected; see note at top of file about rasterize step
        const texture = this.getTexture(plant.speciesType);
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = r * 1.6;
        sprite.height = r * 1.6;
        sprite.label = 'sprite';

        // Label
        const label = new BitmapText({
          text: plant.label,
          style: { fontFamily: 'Arial', fontSize: 14 },
        });
        label.anchor.set(0.5, 0.5);
        label.label = 'label';

        container.addChild(circle, sprite, label);
        this.setupDrag(container, plant.id);
        this.plantLayer.addChild(container);
        this.plantContainers.set(plant.id, container);
      }

      container.x = cx;
      container.y = cy;

      // Always update radius so re-syncs after setPlantCount work correctly
      const circle = container.getChildByLabel('circle') as Graphics;
      const sprite = container.getChildByLabel('sprite') as Sprite;
      circle.clear();
      circle.circle(0, 0, r);
      circle.fill({ color: SPECIES_COLORS[plant.speciesType] ?? 0xaaaaaa, alpha: 0.7 });
      sprite.width = r * 1.6;
      sprite.height = r * 1.6;
    }
  }

  syncBeds(beds: Bed[]): void {
    this.bedLayer.removeChildren();

    for (const bed of beds) {
      const g = new Graphics();
      const anchors = bed.anchors;

      g.moveTo(
        anchors[0].position.x * PX_PER_INCH,
        anchors[0].position.y * PX_PER_INCH,
      );

      for (let i = 1; i < anchors.length; i++) {
        const prev = anchors[i - 1];
        const curr = anchors[i];
        g.bezierCurveTo(
          prev.handleOut.x * PX_PER_INCH,
          prev.handleOut.y * PX_PER_INCH,
          curr.handleIn.x * PX_PER_INCH,
          curr.handleIn.y * PX_PER_INCH,
          curr.position.x * PX_PER_INCH,
          curr.position.y * PX_PER_INCH,
        );
      }

      if (bed.closed) {
        const last = anchors[anchors.length - 1];
        const first = anchors[0];
        g.bezierCurveTo(
          last.handleOut.x * PX_PER_INCH,
          last.handleOut.y * PX_PER_INCH,
          first.handleIn.x * PX_PER_INCH,
          first.handleIn.y * PX_PER_INCH,
          first.position.x * PX_PER_INCH,
          first.position.y * PX_PER_INCH,
        );
        g.closePath();
      }

      // fillColor is a CSS hex string (e.g. "#2d5a1b44") — parse to Pixi number
      const colorHex = bed.fillColor.slice(1, 7);
      const alphaHex = bed.fillColor.length === 9 ? bed.fillColor.slice(7, 9) : 'ff';
      const fillColor = parseInt(colorHex, 16);
      const fillAlpha = parseInt(alphaHex, 16) / 255;

      g.fill({ color: fillColor, alpha: fillAlpha });
      g.stroke({ color: 0x2d5a1b, width: 2 });
      this.bedLayer.addChild(g);
    }
  }

  setSelected(id: string | null): void {
    for (const [containerId, container] of this.plantContainers) {
      if (containerId === id) {
        container.alpha = 0.8;
        // Tint the sprite to indicate selection
        const sprite = container.getChildByLabel('sprite') as Sprite | null;
        if (sprite) sprite.tint = 0xffff99;
      } else {
        container.alpha = 1.0;
        const sprite = container.getChildByLabel('sprite') as Sprite | null;
        if (sprite) sprite.tint = 0xffffff;
      }
    }
  }

  /** Total number of rendered Pixi objects (plants + bed paths + background). */
  getShapeCount(): number {
    return this.plantContainers.size + this.bedLayer.children.length + 1;
  }

  private getTexture(species: string): Texture {
    const cached = this.textureCache.get(species);
    if (cached) return cached;

    // PNG sprites must be generated first via `npm run rasterize`.
    // SVG files exist at public/sprites/{species}.svg if PNGs are absent.
    const texture = Texture.from(`/sprites/${species}.png`);
    this.textureCache.set(species, texture);
    return texture;
  }

  private setupDrag(container: Container, plantId: string): void {
    let dragging = false;
    let startClient = { x: 0, y: 0 };
    let startWorld = { x: 0, y: 0 };

    container.on('pointerdown', (e) => {
      dragging = true;
      startClient = { x: e.clientX, y: e.clientY };
      startWorld = { x: container.x, y: container.y };
      e.stopPropagation();
    });

    container.on('pointermove', (e) => {
      if (!dragging) return;
      const z = this.app.stage.scale.x;
      const dx = (e.clientX - startClient.x) / z;
      const dy = (e.clientY - startClient.y) / z;
      container.x = startWorld.x + dx;
      container.y = startWorld.y + dy;
    });

    container.on('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      this.emit('dragEnd', plantId, {
        x: container.x / PX_PER_INCH,
        y: container.y / PX_PER_INCH,
      });
    });

    container.on('pointerupoutside', () => {
      if (!dragging) return;
      dragging = false;
      this.emit('dragEnd', plantId, {
        x: container.x / PX_PER_INCH,
        y: container.y / PX_PER_INCH,
      });
    });
  }
}
