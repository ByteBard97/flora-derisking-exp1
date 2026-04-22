/**
 * CanvasProjection — the only place where Pinia state becomes Konva nodes.
 *
 * Coordinate contract:
 *   Nodes live in "drawing-pixel space": drawing inches × PX_PER_INCH.
 *   Zoom and pan are applied via a world Group on each layer, so repositioning
 *   300 nodes on every wheel event is never needed — just one group transform.
 *
 * Does NOT:
 *   - Store design data on Konva nodes (only plantId / bedId back-references)
 *   - Read Konva state except node.position() at dragend (drag-harvest pattern)
 *   - Communicate back to docStore
 */

import Konva from 'konva';
import type { Plant, Bed, DrawingPoint } from '@/stores/docStore';
import { getSprite } from './spriteLoader';

export const PX_PER_INCH = 96; // matches viewportStore

const SPECIES_COLORS: Record<string, string> = {
  oak: '#5c8a3c',
  magnolia: '#a0522d',
  azalea: '#d4508a',
  fern: '#2e7d32',
};

export class CanvasProjection {
  private plantLayer: Konva.Layer;
  private bedLayer: Konva.Layer;
  private plantWorld: Konva.Group; // zoom/pan transform lives here
  private bedWorld: Konva.Group;
  private plantIdToNode = new Map<string, Konva.Group>();
  private bedIdToNode = new Map<string, Konva.Path>();
  private onDragEnd: (plantId: string, node: Konva.Group) => void;
  private onSelect: (plantId: string) => void;

  constructor(
    plantLayer: Konva.Layer,
    bedLayer: Konva.Layer,
    onDragEnd: (plantId: string, node: Konva.Group) => void,
    onSelect: (plantId: string) => void,
  ) {
    this.plantLayer = plantLayer;
    this.bedLayer = bedLayer;
    this.plantWorld = new Konva.Group();
    this.bedWorld = new Konva.Group();
    plantLayer.add(this.plantWorld);
    bedLayer.add(this.bedWorld);
    this.onDragEnd = onDragEnd;
    this.onSelect = onSelect;
  }

  /** Apply pan/zoom to both world groups — O(1), no node iteration. */
  updateViewport(zoom: number, panX: number, panY: number): void {
    this.plantWorld.scale({ x: zoom, y: zoom });
    this.plantWorld.position({ x: panX, y: panY });
    this.bedWorld.scale({ x: zoom, y: zoom });
    this.bedWorld.position({ x: panX, y: panY });
    this.plantLayer.batchDraw();
    this.bedLayer.batchDraw();
  }

  reconcilePlants(plants: Map<string, Plant>): void {
    // Remove nodes for deleted plants
    for (const [id, node] of this.plantIdToNode) {
      if (!plants.has(id)) {
        node.destroy();
        this.plantIdToNode.delete(id);
      }
    }

    // Add or reposition
    for (const [id, plant] of plants) {
      const basePos = toBasePx(plant.position);

      if (this.plantIdToNode.has(id)) {
        this.plantIdToNode.get(id)!.position(basePos);
      } else {
        const node = this.createPlantNode(plant, basePos);
        this.plantIdToNode.set(id, node);
        this.plantWorld.add(node);
      }
    }

    this.plantLayer.batchDraw();
  }

  reconcileBeds(beds: Map<string, Bed>): void {
    for (const [id, node] of this.bedIdToNode) {
      if (!beds.has(id)) {
        node.destroy();
        this.bedIdToNode.delete(id);
      }
    }

    for (const [id, bed] of beds) {
      const d = this.anchorsToPath(bed.anchors);
      if (this.bedIdToNode.has(id)) {
        this.bedIdToNode.get(id)!.data(d);
      } else {
        const node = new Konva.Path({
          data: d,
          fill: bed.fillColor,
          stroke: '#ffffff',
          strokeWidth: 1,
          listening: false,
        });
        node.setAttr('bedId', id);
        this.bedIdToNode.set(id, node);
        this.bedWorld.add(node);
      }
    }

    this.bedLayer.batchDraw();
  }

  private createPlantNode(plant: Plant, basePos: { x: number; y: number }): Konva.Group {
    const baseRadius = plant.radius * PX_PER_INCH;

    const group = new Konva.Group({
      x: basePos.x,
      y: basePos.y,
      draggable: true,
      perfectDrawEnabled: false,
    });
    group.setAttr('plantId', plant.id);

    group.add(new Konva.Circle({
      radius: baseRadius,
      fill: SPECIES_COLORS[plant.speciesType] ?? '#888',
      opacity: 0.7,
    }));

    const spriteImg = getSprite(plant.speciesType);
    if (spriteImg) {
      const size = baseRadius * 1.6;
      group.add(new Konva.Image({
        image: spriteImg,
        x: -size / 2, y: -size / 2,
        width: size, height: size,
        opacity: 0.9,
        listening: false,
      }));
    }

    const label = new Konva.Text({
      text: plant.label,
      fontSize: Math.max(8, baseRadius * 0.5),
      fill: '#000000',
      stroke: '#ffffff',
      strokeWidth: 3,
      strokeScaleEnabled: false,
      align: 'center',
    });
    label.offsetX(label.width() / 2);
    label.offsetY(label.height() / 2);
    group.add(label);

    group.on('dragend', () => this.onDragEnd(plant.id, group));
    group.on('click tap', () => this.onSelect(plant.id));

    return group;
  }

  private anchorsToPath(
    anchors: Array<{ position: DrawingPoint; handleIn: DrawingPoint; handleOut: DrawingPoint }>,
  ): string {
    if (anchors.length < 2) return '';
    const px = (pt: DrawingPoint) => `${pt.x * PX_PER_INCH},${pt.y * PX_PER_INCH}`;
    const ofs = (a: DrawingPoint, o: DrawingPoint) => px({ x: a.x + o.x, y: a.y + o.y });

    const first = anchors[0];
    let d = `M ${px(first.position)}`;
    for (let i = 1; i < anchors.length; i++) {
      const prev = anchors[i - 1];
      const curr = anchors[i];
      d += ` C ${ofs(prev.position, prev.handleOut)} ${ofs(curr.position, curr.handleIn)} ${px(curr.position)}`;
    }
    const last = anchors[anchors.length - 1];
    d += ` C ${ofs(last.position, last.handleOut)} ${ofs(first.position, first.handleIn)} ${px(first.position)} Z`;
    return d;
  }

  /** Dev-mode consistency assertion — ID membership check, not just count. */
  assertConsistency(plants: Map<string, Plant>): void {
    for (const id of plants.keys()) {
      console.assert(this.plantIdToNode.has(id), `[Exp1] Missing Konva node for plant ${id}`);
    }
    for (const [id] of this.plantIdToNode) {
      const node = this.plantIdToNode.get(id)!;
      const plantId = node.getAttr('plantId');
      console.assert(plantId && plants.has(plantId), `[Exp1] Orphaned node: plantId=${plantId}`);
    }
    const ids = [...this.plantIdToNode.keys()];
    console.assert(new Set(ids).size === ids.length, '[Exp1] Duplicate nodes detected');
  }

  getNodeForPlant(id: string): Konva.Group | undefined {
    return this.plantIdToNode.get(id);
  }
}

function toBasePx(pt: DrawingPoint): { x: number; y: number } {
  return { x: pt.x * PX_PER_INCH, y: pt.y * PX_PER_INCH };
}
