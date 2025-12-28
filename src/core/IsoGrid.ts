import type { GridPos } from "./types";

export class IsoGrid {
  public readonly cols: number;
  public readonly rows: number;
  public readonly tileW: number;
  public readonly tileH: number;
  public readonly originX: number;
  public readonly originY: number;

  constructor(cols: number, rows: number, tileW: number, tileH: number, originX: number, originY: number) {
    this.cols = cols;
    this.rows = rows;
    this.tileW = tileW;
    this.tileH = tileH;
    this.originX = originX;
    this.originY = originY;
  }

  inBounds(p: GridPos): boolean {
    return p.q >= 0 && p.q < this.cols && p.r >= 0 && p.r < this.rows;
  }

  // Isometric diamond projection
  gridToWorld(p: GridPos): { x: number; y: number } {
    const x = (p.q - p.r) * (this.tileW / 2) + this.originX;
    const y = (p.q + p.r) * (this.tileH / 2) + this.originY;
    return { x, y };
  }

  // Approximate inverse mapping: world -> grid (then refine by nearest)
  worldToGridApprox(x: number, y: number): GridPos {
    const dx = x - this.originX;
    const dy = y - this.originY;
    const q = (dx / (this.tileW / 2) + dy / (this.tileH / 2)) / 2;
    const r = (dy / (this.tileH / 2) - dx / (this.tileW / 2)) / 2;
    return { q: Math.round(q), r: Math.round(r) };
  }

  // Refine click by checking nearby candidates and picking closest diamond center
  worldToGrid(x: number, y: number): GridPos | null {
    const approx = this.worldToGridApprox(x, y);
    let best: GridPos | null = null;
    let bestD = Number.POSITIVE_INFINITY;

    for (let dq = -1; dq <= 1; dq++) {
      for (let dr = -1; dr <= 1; dr++) {
        const p = { q: approx.q + dq, r: approx.r + dr };
        if (!this.inBounds(p)) continue;
        const w = this.gridToWorld(p);
        const d = Math.hypot(x - w.x, y - w.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    return best;
  }

  neighbors8(p: GridPos): GridPos[] {
    const deltas = [
      { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 },
      { q: 1, r: 1 }, { q: 1, r: -1 }, { q: -1, r: 1 }, { q: -1, r: -1 }
    ];
    const out: GridPos[] = [];
    for (const d of deltas) {
      const n = { q: p.q + d.q, r: p.r + d.r };
      if (this.inBounds(n)) out.push(n);
    }
    return out;
  }

    neighbors4(p: GridPos): GridPos[] {
    const deltas = [
      { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 },
    ];
    const out: GridPos[] = [];
    for (const d of deltas) {
      const n = { q: p.q + d.q, r: p.r + d.r };
      if (this.inBounds(n)) out.push(n);
    }
    return out;
  }
}