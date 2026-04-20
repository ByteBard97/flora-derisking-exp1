/**
 * CanvasProjection — the only place where Pinia state becomes Konva nodes.
 *
 * Responsibilities:
 * - Subscribe to docStore mutations (via watch)
 * - Create, update, and destroy Konva nodes in response
 * - Maintain a plantId → node map for O(1) lookup
 *
 * Does NOT:
 * - Store any design data on Konva nodes (only a plantId back-reference)
 * - Read Konva node state for anything other than drag-harvest (in useDragHarvest)
 * - Communicate back to docStore
 */

import Konva from 'konva';
import { watch } from 'vue';
import type { Plant, Bed } from '@/stores/docStore';
import type { DrawingPoint } from '@/stores/docStore';

const SPECIES_COLORS: Record<string, string> = {
  oak: '#5c8a3c',
  magnolia: '#a0522d',
  azalea: '#d4508a',
  fern: '#2e7d32',
};

export class CanvasProjection {
  private plantLayer: Konva.Layer;
  private bedLayer: Konva.Layer;
  private plantIdToNode = new Map<string, Konva.Group>();
  private bedIdToNode = new Map<string, Konva.Path>();
  private onDragEnd: (plantId: string, node: Konva.Group) => void;
  private onSelect: (plantId: string) => void;
  private scale: number;

  constructor(
    plantLayer: Konva.Layer,
    bedLayer: Konva.Layer,
    scale: number,
    onDragEnd: (plantId: string, node: Konva.Group) => void,
    onSelect: (plantId: string) => void,
  ) {
    this.plantLayer = plantLayer;
    this.bedLayer = bedLayer;
    this.scale = scale;
    this.onDragEnd = onDragEnd;
    this.onSelect = onSelect;
  }

  updateScale(scale: number): void {
    this.scale = scale;
  }

  reconcilePlants(plants: Map<string, Plant>, viewportFn: (pt: DrawingPoint) => { x: number; y: number }, radiusFn: (r: number) => number): void {
    const currentIds = new Set(plants.keys());

    // Remove nodes for deleted plants
    for (const [id, node] of this.plantIdToNode) {
      if (!currentIds.has(id)) {
        node.destroy();
        this.plantIdToNode.delete(id);
      }
    }

    // Add or update nodes
    for (const [id, plant] of plants) {
      const canvasPos = viewportFn(plant.position);
      const canvasRadius = radiusFn(plant.radius);

      if (this.plantIdToNode.has(id)) {
        const node = this.plantIdToNode.get(id)!;
        node.position(canvasPos);
        // Only re-render if position actually changed
      } else {
        const node = this.createPlantNode(plant, canvasPos, canvasRadius);
        this.plantIdToNode.set(id, node);
        this.plantLayer.add(node);
      }
    }

    this.plantLayer.batchDraw();
  }

  reconcileBeds(beds: Map<string, Bed>, viewportFn: (pt: DrawingPoint) => { x: number; y: number }, scale: number): void {
    const currentIds = new Set(beds.keys());

    for (const [id, node] of this.bedIdToNode) {
      if (!currentIds.has(id)) {
        node.destroy();
        this.bedIdToNode.delete(id);
      }
    }

    for (const [id, bed] of beds) {
      const d = this.anchorsToSvgPath(bed.anchors, viewportFn);
      if (this.bedIdToNode.has(id)) {
        const node = this.bedIdToNode.get(id)!;
        node.data(d);
      } else {
        const node = new Konva.Path({
          data: d,
          fill: bed.fillColor,
          stroke: '#ffffff',
          strokeWidth: 1,
          listening: false,
          // Store only the id back-reference — no design data
          id: `bed-${id}`,
        });
        node.setAttr('bedId', id);
        this.bedIdToNode.set(id, node);
        this.bedLayer.add(node);
      }
    }

    this.bedLayer.batchDraw();
  }

  private createPlantNode(plant: Plant, canvasPos: { x: number; y: number }, canvasRadius: number): Konva.Group {
    const group = new Konva.Group({
      x: canvasPos.x,
      y: canvasPos.y,
      draggable: true,
    });

    // Back-reference only — no design data stored on node
    group.setAttr('plantId', plant.id);

    const circle = new Konva.Circle({
      radius: canvasRadius,
      fill: SPECIES_COLORS[plant.speciesType] ?? '#888',
      stroke: '#ffffff',
      strokeWidth: 1,
      opacity: 0.7,
    });

    const label = new Konva.Text({
      text: plant.label,
      fontSize: Math.max(8, canvasRadius * 0.5),
      fill: '#ffffff',
      align: 'center',
    });
    label.offsetX(label.width() / 2);
    label.offsetY(label.height() / 2);

    group.add(circle, label);

    group.on('dragend', () => {
      this.onDragEnd(plant.id, group);
    });

    group.on('click tap', () => {
      this.onSelect(plant.id);
    });

    return group;
  }

  private anchorsToSvgPath(
    anchors: Array<{ position: DrawingPoint; handleIn: DrawingPoint; handleOut: DrawingPoint }>,
    viewportFn: (pt: DrawingPoint) => { x: number; y: number },
  ): string {
    if (anchors.length < 2) return '';

    const toAbs = (pt: DrawingPoint) => {
      const cp = viewportFn(pt);
      return `${cp.x},${cp.y}`;
    };

    const toAbsOffset = (anchor: DrawingPoint, offset: DrawingPoint) => {
      return toAbs({ x: anchor.x + offset.x, y: anchor.y + offset.y });
    };

    const first = anchors[0];
    const firstPos = viewportFn(first.position);
    let d = `M ${firstPos.x},${firstPos.y}`;

    for (let i = 1; i < anchors.length; i++) {
      const prev = anchors[i - 1];
      const curr = anchors[i];
      const cp1 = toAbsOffset(prev.position, prev.handleOut);
      const cp2 = toAbsOffset(curr.position, curr.handleIn);
      const end = toAbs(curr.position);
      d += ` C ${cp1} ${cp2} ${end}`;
    }

    // Close: cubic back to first anchor
    const last = anchors[anchors.length - 1];
    const cp1 = toAbsOffset(last.position, last.handleOut);
    const cp2 = toAbsOffset(first.position, first.handleIn);
    d += ` C ${cp1} ${cp2} ${toAbs(first.position)} Z`;

    return d;
  }

  /** Dev-mode consistency assertion — ID membership check, not just count. */
  assertConsistency(plants: Map<string, Plant>): void {
    if (!import.meta.env.DEV) return;

    for (const id of plants.keys()) {
      console.assert(this.plantIdToNode.has(id), `[Exp1] Missing Konva node for plant ${id}`);
    }

    for (const [id] of this.plantIdToNode) {
      const node = this.plantIdToNode.get(id)!;
      const plantId = node.getAttr('plantId');
      console.assert(
        plantId && plants.has(plantId),
        `[Exp1] Orphaned node: plantId=${plantId}`,
      );
    }

    const ids = [...this.plantIdToNode.keys()];
    console.assert(
      new Set(ids).size === ids.length,
      `[Exp1] Duplicate nodes detected`,
    );
  }

  getNodeForPlant(id: string): Konva.Group | undefined {
    return this.plantIdToNode.get(id);
  }
}
