// Standalone port of RapiD's DashLine.js — non-texture mode only, no external deps.
// Original: github.com/facebook/Rapid (ISC license)
import { Graphics, Point } from 'pixi.js';

export interface DashLineOptions {
  dash?: number[];
  width?: number;
  color?: number;
  alpha?: number;
}

export class DashLine {
  private g: Graphics;
  private dash: number[];
  private dashSize: number;
  private width: number;
  private color: number;
  private alpha: number;
  private lineLength = 0;
  private cursor = new Point();

  constructor(graphics: Graphics, opts: DashLineOptions = {}) {
    this.g = graphics;
    this.dash = opts.dash ?? [10, 5];
    this.dashSize = this.dash.reduce((a, b) => a + b, 0);
    this.width = opts.width ?? 1;
    this.color = opts.color ?? 0xffffff;
    this.alpha = opts.alpha ?? 1;
  }

  moveTo(x: number, y: number): this {
    this.lineLength = 0;
    this.cursor.set(x, y);
    return this;
  }

  lineTo(x: number, y: number): this {
    const dx = x - this.cursor.x;
    const dy = y - this.cursor.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) return this;

    const cos = dx / length;
    const sin = dy / length;
    const phase = this.lineLength % this.dashSize;

    let segIdx = 0;
    let acc = 0;
    for (let i = 0; i < this.dash.length; i++) {
      if (acc + this.dash[i] > phase) { segIdx = i; break; }
      acc += this.dash[i];
    }
    let segRem = this.dash[segIdx] - (phase - acc);

    const x0 = this.cursor.x;
    const y0 = this.cursor.y;
    let t = 0;

    while (t < length) {
      const step = Math.min(segRem, length - t);
      if (segIdx % 2 === 0) {
        this.g
          .setStrokeStyle({ width: this.width, color: this.color, alpha: this.alpha })
          .moveTo(x0 + t * cos, y0 + t * sin)
          .lineTo(x0 + (t + step) * cos, y0 + (t + step) * sin)
          .stroke();
      }
      t += step;
      segIdx = (segIdx + 1) % this.dash.length;
      segRem = this.dash[segIdx];
    }

    this.lineLength += length;
    this.cursor.set(x, y);
    return this;
  }
}
