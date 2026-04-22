import {
  Application,
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
import type { Plant, Bed } from '@/stores/docStore';

const PX_PER_INCH = 96;
const WORLD_W = 120 * PX_PER_INCH;
const WORLD_H = 180 * PX_PER_INCH;
const SPRITE_SIZE = 512; // px — crisp up to ~5× zoom

const SPECIES_COLORS: Record<string, number> = {
  oak: 0x4a7c59,
  magnolia: 0xc8a2c8,
  azalea: 0xff6b9d,
  fern: 0x7ec8a0,
};

const KNOWN_SPECIES = ['oak', 'magnolia', 'azalea', 'fern'];

/** Rasterize an SVG URL to a square Pixi Texture at SPRITE_SIZE px using the browser renderer. */
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
   * Rasterize plant SVGs to high-res textures and install the label BitmapFont.
   * Must be awaited before syncPlants().
   */
  async init(): Promise<void> {
    // Guard against hot-reload double-install (cache key is "<name>-bitmap")
    if (!Cache.has('plant-label-bitmap')) {
      BitmapFont.install({
        name: 'plant-label',
        style: new TextStyle({
          fontFamily: 'Times New Roman, Times, serif',
          fontSize: 96,
          fill: '#000000',
          stroke: { color: '#ffffff', width: 12 },
          fontWeight: 'bold',
        }),
        chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
        resolution: 2,
      });
    }

    // Rasterize each species SVG at SPRITE_SIZE using the browser's native SVG renderer.
    // This preserves full color fidelity (CSS classes, gradients) and batches to one
    // draw call per frame — far cheaper than live GraphicsContext.svg() rendering.
    await Promise.all(
      KNOWN_SPECIES.map(async (species) => {
        const texture = await svgToTexture(`/sprites/${species}.svg`);
        this.textureCache.set(species, texture);
      }),
    );
  }

  async setBackground(): Promise<void> {
    try {
      const texture = await Assets.load('/site-plan.svg');
      const sprite = new Sprite(texture);
      sprite.width = WORLD_W;
      sprite.height = WORLD_H;
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
        circle.circle(0, 0, r);
        circle.fill({ color: SPECIES_COLORS[plant.speciesType] ?? 0xaaaaaa, alpha: 0.7 });
        circle.label = 'circle';

        const texture = this.textureCache.get(plant.speciesType) ?? Texture.WHITE;
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.width = r * 1.6;
        sprite.height = r * 1.6;
        sprite.eventMode = 'none';
        sprite.label = 'sprite';

        const label = new BitmapText({
          text: plant.label,
          style: { fontFamily: 'plant-label', fontSize: Math.max(8, r * 0.5) },
        });
        label.anchor.set(0.5, 0.5);
        label.eventMode = 'none';
        label.label = 'label';

        container.addChild(circle, sprite, label);
        this.setupDrag(container, plant.id);
        this.plantLayer.addChild(container);
        this.plantContainers.set(plant.id, container);
      }

      container.x = cx;
      container.y = cy;

      container.hitArea = new Circle(0, 0, r);

      const circle = container.getChildByLabel('circle') as Graphics;
      circle.clear();
      circle.circle(0, 0, r);
      circle.fill({ color: SPECIES_COLORS[plant.speciesType] ?? 0xaaaaaa, alpha: 0.7 });

      const sprite = container.getChildByLabel('sprite') as Sprite;
      sprite.width = r * 1.6;
      sprite.height = r * 1.6;

      const label = container.getChildByLabel('label') as BitmapText;
      label.style.fontSize = Math.max(8, r * 0.5);
    }
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

  setSelected(id: string | null): void {
    for (const [containerId, container] of this.plantContainers) {
      const isSelected = containerId === id;
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

  /** Select plants whose world-space center falls inside the lasso rectangle. */
  selectByLasso(lx: number, ly: number, rx: number, ry: number): void {
    for (const [id, container] of this.plantContainers) {
      if (container.x >= lx && container.x <= rx && container.y >= ly && container.y <= ry) {
        this.emit('select', id);
        return; // single-select: pick first hit (multi-select needs store changes)
      }
    }
  }

  private setupDrag(container: Container, plantId: string): void {
    let active = false;
    let didDrag = false;
    let startClient = { x: 0, y: 0 };
    let startWorld = { x: 0, y: 0 };

    container.on('pointerdown', (e) => {
      active = true;
      didDrag = false;
      startClient = { x: e.clientX, y: e.clientY };
      startWorld = { x: container.x, y: container.y };
      e.stopPropagation();
    });

    container.on('pointermove', (e) => {
      if (!active) return;
      const dx = e.clientX - startClient.x;
      const dy = e.clientY - startClient.y;
      if (!didDrag && Math.sqrt(dx * dx + dy * dy) >= 4) didDrag = true;
      if (!didDrag) return;
      const z = this.app.stage.scale.x;
      container.x = startWorld.x + dx / z;
      container.y = startWorld.y + dy / z;
    });

    const onUp = () => {
      if (!active) return;
      active = false;
      if (didDrag) {
        this.emit('dragEnd', plantId, {
          x: container.x / PX_PER_INCH,
          y: container.y / PX_PER_INCH,
        });
      } else {
        this.emit('select', plantId);
      }
    };

    container.on('pointerup', onUp);
    container.on('pointerupoutside', onUp);
  }
}
