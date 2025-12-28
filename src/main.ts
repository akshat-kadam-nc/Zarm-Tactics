import Phaser from "phaser";

/**
 * v0.1.0 goals:
 * - Render isometric diamond grid
 * - Single unit selection
 * - BFS reachability (move range 2, diagonals allowed)
 * - Click reachable tile to move along shortest path
 *
 * Next versions will add:
 * - Obstacles, enemy units, turn manager, attacks, terrain, pollution
 */

enum TurnPhase {
  PlayerMove,
  PlayerAttack,
  EnemyTurn
}

type GridPos = { q: number; r: number }; // q = col, r = row
type TileKey = string;

function keyOf(p: GridPos): TileKey {
  return `${p.q},${p.r}`;
}

function parseKey(k: TileKey): GridPos {
  const [q, r] = k.split(",").map(Number);
  return { q, r };
}

function manhattanLikeDiagDistance(a: GridPos, b: GridPos): number {
  // Chebyshev distance for 8-direction movement where diagonal costs 1
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
}

class IsoGrid {
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
}

type Tile = {
  pos: GridPos;
  walkable: boolean;
};

type Unit = {
  id: string;
  name: string;
  pos: GridPos;
  hp: number;
  maxHp: number;
  energy: number;
  moveRange: number;
  attackRange: number;
  attackDamage: number;
  isEnemy: boolean;
  downed: boolean;
};


type Reachability = {
  reachable: Set<TileKey>;
  cameFrom: Map<TileKey, TileKey | null>;
};

function bfsReachable(grid: IsoGrid, tiles: Map<TileKey, Tile>, start: GridPos, maxSteps: number, occupied: Set<TileKey>): Reachability {
  const startKey = keyOf(start);
  const reachable = new Set<TileKey>();
  const cameFrom = new Map<TileKey, TileKey | null>();

  const q: TileKey[] = [];
  const dist = new Map<TileKey, number>();

  q.push(startKey);
  dist.set(startKey, 0);
  cameFrom.set(startKey, null);
  reachable.add(startKey);

  while (q.length > 0) {
    const curKey = q.shift()!;
    const cur = parseKey(curKey);
    const curDist = dist.get(curKey)!;

    if (curDist >= maxSteps) continue;

    for (const n of grid.neighbors8(cur)) {
      const nk = keyOf(n);
      if (dist.has(nk)) continue;

      const tile = tiles.get(nk);
      if (!tile || !tile.walkable) continue;

      // Occupied tiles are not walkable destinations, except the start tile
      if (occupied.has(nk) && nk !== startKey) continue;

      dist.set(nk, curDist + 1);
      cameFrom.set(nk, curKey);
      reachable.add(nk);
      q.push(nk);
    }
  }

  return { reachable, cameFrom };
}

function reconstructPath(cameFrom: Map<TileKey, TileKey | null>, start: GridPos, goal: GridPos): GridPos[] {
  const startK = keyOf(start);
  const goalK = keyOf(goal);
  if (!cameFrom.has(goalK)) return [];

  const pathKeys: TileKey[] = [];
  let cur: TileKey | null = goalK;
  while (cur) {
    pathKeys.push(cur);
    cur = cameFrom.get(cur) ?? null;
  }
  pathKeys.reverse();
  if (pathKeys[0] !== startK) return [];
  return pathKeys.map(parseKey);
}

class GameScene extends Phaser.Scene {
  private grid!: IsoGrid;
  private tiles!: Map<TileKey, Tile>;
  private tileGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;

  private unit!: Unit;
  private unitSprite!: Phaser.GameObjects.Arc;

  private enemies: Unit[] = [];
  private phase: TurnPhase = TurnPhase.PlayerMove;

  private selected = true;
  private reach: Reachability | null = null;

  private occupied = new Set<TileKey>();
  

  constructor() {
    super("game");
  }

  create(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // Grid tuned to feel similar to the original: compact diamonds
    this.grid = new IsoGrid(12, 10, 64, 32, Math.floor(W / 2), 90);

    // Build tiles
    this.tiles = new Map<TileKey, Tile>();
    for (let r = 0; r < this.grid.rows; r++) {
      for (let q = 0; q < this.grid.cols; q++) {
        const pos = { q, r };
        this.tiles.set(keyOf(pos), { pos, walkable: true });
      }
    }

    // A couple of test obstacles (like rocks)
    this.setObstacle({ q: 6, r: 3 });
    this.setObstacle({ q: 6, r: 4 });
    this.setObstacle({ q: 7, r: 4 });

    this.tileGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics();

    // Create a single Planeteer unit   
    this.unit = {
    id: "p1",
    name: "Wheeler",
    pos: { q: 3, r: 4 },
    hp: 1500,
    maxHp: 1500,
    energy: 1000,
    moveRange: 2,
    attackRange: 1,
    attackDamage: 350,
    isEnemy: false,
    downed: false
    };

    this.enemies = [];

    const enemy: Unit = {
    id: "e1",
    name: "Ripper",
    pos: { q: 7, r: 4 },
    hp: 800,
    maxHp: 800,
    energy: 0,
    moveRange: 1,
    attackRange: 1,
    attackDamage: 350,
    isEnemy: true,
    downed: false
    };

    this.enemies.push(enemy);
    this.occupied.add(keyOf(enemy.pos));

    const eWorld = this.grid.gridToWorld(enemy.pos);
    this.add.circle(eWorld.x, eWorld.y - 10, 10, 0xff3b3b);


    this.occupied.add(keyOf(this.unit.pos));

    // Simple placeholder sprite: circle positioned on tile center
    const uWorld = this.grid.gridToWorld(this.unit.pos);
    this.unitSprite = this.add.circle(uWorld.x, uWorld.y - 10, 10, 0x3ad0ff);

    // Input
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const gp = this.grid.worldToGrid(p.worldX, p.worldY);
      if (!gp) return;
      
      // Optional: ignore clicks if unit is downed
      if (this.unit.downed) return;

      // ✅ Handle Attack First
      if (this.phase === TurnPhase.PlayerAttack) {
        const target = this.enemies.find(e =>
        !e.downed &&
        Math.max(
            Math.abs(e.pos.q - gp.q), 
            Math.abs(e.pos.r - gp.r)
        ) <= this.unit.attackRange);

        console.log("Clicked:", gp, "Enemy:", target.pos);

        if (!target) {
            console.log("No enemy in attack range");
            return;
        }

        console.log("Attacking enemy:", target.id);

        target.hp -= this.unit.attackDamage;

        if (target.hp <= 0) {
            target.hp = 0;
            target.downed = true;
            this.occupied.delete(keyOf(target.pos));
            console.log("Enemy downed");
        }

        // End player turn immediately after attacking
        this.phase = TurnPhase.EnemyTurn;

        // Optional: small delay before enemy acts
        // ✅ Trigger enemy turn
        this.time.delayedCall(400, () => {
            console.log("Enemy turn starts");
            this.runEnemyTurn();
        });

        this.redraw();
        return;
      }

      // Lock movement to PlayerMove phase
      if (this.phase !== TurnPhase.PlayerMove) return;

      // Clicking near the unit toggles selection (simple UX)
      if (manhattanLikeDiagDistance(gp, this.unit.pos) === 0) {
        this.selected = !this.selected;
        if (!this.selected) this.reach = null;
        this.redraw();
        return;
      }

      if (!this.selected) return;

      // Compute reachability on demand
      this.reach = bfsReachable(this.grid, this.tiles, this.unit.pos, this.unit.moveRange, this.occupied);

      const destKey = keyOf(gp);
      if (!this.reach.reachable.has(destKey)) {
        this.redraw();
        return;
      }

      // Move along shortest path (tile-by-tile tween)
      const path = reconstructPath(this.reach.cameFrom, this.unit.pos, gp);
      if (path.length <= 1) {
        this.redraw();
        return;
      }

      this.selected = false; // lock during movement
      this.moveUnitAlong(path).then(() => {
        this.phase = TurnPhase.PlayerAttack;
        this.selected = true;
        this.reach = null;
        console.log("Phase after move:", this.phase);
        this.redraw();
      });

      this.redraw();
    });

    // Initial draw
    this.redraw();

    // Lightweight HUD
    this.add.text(12, 10, "v0.1.0  Click unit to toggle select. Click reachable tiles to move.", {
      fontFamily: "system-ui, Arial",
      fontSize: "14px",
      color: "#d6e2ff"
    });
    this.add.text(12, 30, "Move range: 2 (diagonal allowed). Obstacles block.", {
      fontFamily: "system-ui, Arial",
      fontSize: "14px",
      color: "#d6e2ff"
    });
  }

  private setObstacle(p: GridPos): void {
    const t = this.tiles.get(keyOf(p));
    if (t) t.walkable = false;
  }

  private redraw(): void {
    this.tileGfx.clear();
    this.overlayGfx.clear();

    // Draw tiles
    for (const t of this.tiles.values()) {
      const w = this.grid.gridToWorld(t.pos);
      const fill = t.walkable ? 0x1a2433 : 0x2b2b2b;
      const alpha = t.walkable ? 1 : 1;

      this.drawDiamond(this.tileGfx, w.x, w.y, fill, alpha, 0x31445f, 1);
    }

    // Overlay reachable tiles if selected
    if (this.selected && this.phase === TurnPhase.PlayerMove) {
      this.reach = bfsReachable(this.grid, this.tiles, this.unit.pos, this.unit.moveRange, this.occupied);
      for (const k of this.reach.reachable) {
        const p = parseKey(k);
        const w = this.grid.gridToWorld(p);
        // Do not overlay start tile strongly
        const isStart = (p.q === this.unit.pos.q && p.r === this.unit.pos.r);
        this.drawDiamond(this.overlayGfx, w.x, w.y, 0xffffff, isStart ? 0.10 : 0.22, 0x9ecbff, 1);
      }
    }

    // Attack range overlay only during PlayerAttack
    if (this.phase === TurnPhase.PlayerAttack && !this.unit.downed) {
      for (let dq = -this.unit.attackRange; dq <= this.unit.attackRange; dq++) {
        for (let dr = -this.unit.attackRange; dr <= this.unit.attackRange; dr++) {
          const p = {
            q: this.unit.pos.q + dq,
            r: this.unit.pos.r + dr
          };

          if (!this.grid.inBounds(p)) continue;

          const dist = Math.max(Math.abs(dq), Math.abs(dr));
          if (dist === 0 || dist > this.unit.attackRange) continue;

          const w = this.grid.gridToWorld(p);

          this.drawDiamond(
            this.overlayGfx,
            w.x,
            w.y,
            0xffffff,
            0.12,
            0xffa6a6,
            1
          );
        }
      }
    }

    // Update unit sprite position
    const uWorld = this.grid.gridToWorld(this.unit.pos);
    this.unitSprite.setPosition(uWorld.x, uWorld.y - 10);
    this.unitSprite.setFillStyle(this.selected ? 0x3ad0ff : 0x7aa0b8);
  }

  private drawDiamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number, fill: number, fillAlpha: number, stroke: number, strokeAlpha: number): void {
    const hw = this.grid.tileW / 2;
    const hh = this.grid.tileH / 2;

    g.lineStyle(1, stroke, strokeAlpha);
    g.fillStyle(fill, fillAlpha);

    g.beginPath();
    g.moveTo(cx, cy - hh);
    g.lineTo(cx + hw, cy);
    g.lineTo(cx, cy + hh);
    g.lineTo(cx - hw, cy);
    g.closePath();

    g.fillPath();
    g.strokePath();
  }

  private async moveUnitAlong(path: GridPos[]): Promise<void> {
    // path includes start tile, so skip index 0
    for (let i = 1; i < path.length; i++) {
      const from = this.unit.pos;
      const to = path[i];

      // Update occupancy
      this.occupied.delete(keyOf(from));
      this.occupied.add(keyOf(to));

      this.unit.pos = to;

      const w = this.grid.gridToWorld(to);
      await this.tweenTo(this.unitSprite, w.x, w.y - 10, 130);
      this.redraw();
    }
  }

  private tweenTo(obj: Phaser.GameObjects.GameObject, x: number, y: number, ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.tweens.add({
        targets: obj,
        x,
        y,
        duration: ms,
        ease: "Sine.easeInOut",
        onComplete: () => resolve()
      });
    });
  }

  private runEnemyTurn(): void {
    for (const e of this.enemies) {
        if (e.downed) continue;

        const dist = Math.max(
        Math.abs(e.pos.q - this.unit.pos.q),
        Math.abs(e.pos.r - this.unit.pos.r)
        );

        if (dist <= e.attackRange) {
          this.unit.hp -= e.attackDamage;
          if (this.unit.hp <= 0) {
            this.unit.hp = 0;
            this.unit.downed = true;
            console.log("Player unit downed!");
          }
        }
    }

    this.phase = TurnPhase.PlayerMove;
    this.selected = true;
    this.reach = null;
    this.redraw();
  }

}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: 1100,
  height: 650,
  backgroundColor: "#0b0f14",
  scene: [GameScene],
  render: {
    pixelArt: true,
    antialias: false
  }
};

new Phaser.Game(config);
