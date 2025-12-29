import Phaser from "phaser";
import { IsoGrid } from "../core/IsoGrid";
import { 
  bfsReachable, 
  reconstructPath, 
  keyOf, 
  parseKey,
  manhattanLikeDiagDistance
 } from "../core/pathfinding";
import { 
  TurnPhase,
  type GridPos, 
  type Tile, 
  type Unit, 
  type Terrain,
  type TileKey,
  type Reachability,
} from "../core/types";
import { Hud } from "../ui/Hud";

const UNIT_SCALE = 0.40;
const UNIT_ORIGIN_Y = 0.75;
const UNIT_Y_OFFSET = -4;

export class GameScene extends Phaser.Scene {
  private grid!: IsoGrid;
  private tiles!: Map<TileKey, Tile>;
  private tileGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics;

  private unit!: Unit;
  private unitSprite!: Phaser.GameObjects.Sprite;

  private enemies: Unit[] = [];
  private phase: TurnPhase = TurnPhase.PlayerMove;

  private enemySprites = new Map<string, Phaser.GameObjects.Arc>();

  private selected = true;
  private reach: Reachability | null = null;

  private occupied = new Set<TileKey>();

  private hud!: Hud;

  private hoverGfx!: Phaser.GameObjects.Graphics;
  private hoverKey: string | null = null;
  private hoverPath: GridPos[] = [];

  constructor() {
    super("game");
  }

  preload(): void {
    this.load.atlas(
      "wheeler",
      "../assets/sprites/wheeler_atlas.png",
      "../assets/sprites/wheeler_atlas.json"
    );
    
    this.load.json(
      "wheeler_animmap",
      "../assets/sprites/wheeler_atlas.animmap.json"
    );

    this.load.atlas(
      "enemy_spewbot",
      "assets/sprites/spewbot_atlas.png",
      "assets/sprites/spewbot_atlas.json"
    );
    
    this.load.json(
      "enemy_spewbot_animmap",
      "assets/sprites/spewbot.animmap.json"
    );
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
        const terrain = this.pickTerrain(q, r);

        //this.tiles.set(keyOf(pos), { pos, walkable: true });
        this.tiles.set(keyOf(pos), {
          pos,
          walkable: true,
          terrain,
          polluted: false
        });

      }
    }

    // A couple of test obstacles (like rocks)
    this.setObstacle({ q: 6, r: 3 });
    this.setObstacle({ q: 6, r: 4 });
    this.setObstacle({ q: 7, r: 4 });

    this.tileGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics();
    this.hoverGfx = this.add.graphics();

    this.hud = new Hud(this);

    // Create a single Planeteer unit   
    this.unit = {
    id: "p1",
    name: "Wheeler",
    team: "player",
    pos: { q: 3, r: 4 },
    hp: 1500,
    maxHp: 1500,
    energy: 1000,
    moveRange: 2,
    attackRange: 1,
    attackDamage: 350,
    homeTerrains: ["lava", "sand"],
    isEnemy: false,
    downed: false,
    sprite: null as any // will be set later
    };

    this.enemies = [];

    /*const enemy: Unit = {
    id: "e1",
    name: "Ripper",
    pos: { q: 7, r: 4 },
    hp: 800,
    maxHp: 800,
    energy: 0,
    moveRange: 1,
    attackRange: 1,
    attackDamage: 350,
    homeTerrains: [],
    isEnemy: true,
    downed: false,
    team: "enemy",
    };*/

    //this.enemies.push(enemy);
    const enemy = this.spawnSpewbot({ q: 7, r: 4 });
    //this.spawnSpewbot({ q: 8, r: 3 });
    
    this.occupied.add(keyOf(enemy.pos));
    const eWorld = this.grid.gridToWorld(enemy.pos);
    const eSprite = this.add.circle(eWorld.x, eWorld.y - 10, 10, 0xff3b3b);
    this.enemySprites.set(enemy.id, eSprite);

    this.occupied.add(keyOf(this.unit.pos));
    // Simple placeholder sprite: circle positioned on tile center
    //const uWorld = this.grid.gridToWorld(this.unit.pos);
    //this.unitSprite = this.add.circle(uWorld.x, uWorld.y - 10, 10, 0x3ad0ff);
    this.ensureWheelerAnimations();

    console.log("wheeler texture?", this.textures.exists("wheeler"));
    console.log("atlas loaded?", this.textures.exists("wheeler"));
    const tex = this.textures.get("wheeler");
    console.log("source size", tex.getSourceImage()?.width, tex.getSourceImage()?.height);
    console.log("frames", Object.keys(tex.frames));
    
    const uWorld = this.grid.gridToWorld(this.unit.pos);
    this.unitSprite = this.add.sprite(uWorld.x, uWorld.y - 10, "wheeler", 0);
    //this.unitSprite.setOrigin(0.5, 0.5);
    this.unitSprite.play("wheeler_idle");
    this.unitSprite.setScale(UNIT_SCALE);
    this.unitSprite.setOrigin(0.5, UNIT_ORIGIN_Y);
    this.unitSprite.setY(this.unitSprite.y + UNIT_Y_OFFSET);

    // Input
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const gp = this.grid.worldToGrid(p.worldX, p.worldY);
      if (!gp) return;
      
      // Ignore clicks if unit is downed
      if (this.unit.downed) return;

      // Wait-in-place guard
      if (this.phase === TurnPhase.PlayerMove) {
        if (gp.q === this.unit.pos.q && gp.r === this.unit.pos.r) {
          console.log("Player waits in place.");
          this.applyEndOfMoveEffects();   // keep this if you want recovery on wait
          this.phase = TurnPhase.PlayerAttack;
          this.clearHover();
          this.reach = null;
          this.redraw();
          return;
        }
      }

      this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
        if (this.unit.downed) return;
        
        const gp = this.grid.worldToGrid(p.worldX, p.worldY);
        
        // Off-grid: clear hover preview
        if (!gp) {
          if (this.hoverKey !== null) {
            this.hoverKey = null;
            this.hoverPath = [];
            this.hoverGfx.clear();
          }
          return;
        }
        
        const k = keyOf(gp);
        if (k === this.hoverKey) return; // no-op if same tile
        
        this.hoverKey = k;
        this.updateHoverPreview(gp);
      });

      // Handle Attack First
      if (this.phase === TurnPhase.PlayerAttack) {
        
        /*const target = this.enemies.find(e => !e.downed &&
        Math.max(
            Math.abs(e.pos.q - gp.q), 
            Math.abs(e.pos.r - gp.r)
        ) <= this.unit.attackRange);*/
        const target = this.enemies.find(
          (e) => !e.downed && e.pos.q === gp.q && e.pos.r === gp.r
        );

        // Ignore clicks outside attack range entirely (do not consume turn)
        const clickDist = manhattanLikeDiagDistance(this.unit.pos, gp);
        if (clickDist > this.unit.attackRange) {
          return;
        }

        if (!target) {
            console.log("No enemy on clicked tile; consuming attack and ending turn.");
            this.endPlayerAttackAndStartEnemyTurn();
            return;
        }

        console.log("Clicked:", gp, "Enemy:", target.pos);

        console.log("Attacking enemy:", target.id);
        target.hp -= this.unit.attackDamage;

        if (target.hp <= 0) {
            target.hp = 0;
            target.downed = true;
            this.occupied.delete(keyOf(target.pos));
            console.log("Enemy downed");
        }

        this.endPlayerAttackAndStartEnemyTurn();

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
        this.applyEndOfMoveEffects();
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

  private pickTerrain(q: number, r: number): Terrain {
  // Simple deterministic bands for now (Option A)
  // Left: water, middle: grass/stone, right: sand/lava/ice
  if (q <= 2) return "water";
  if (q <= 5) return r % 3 === 0 ? "stone" : "grass";
  if (q <= 8) return r % 2 === 0 ? "sand" : "grass";
  return r % 3 === 0 ? "ice" : "lava";
  }

  private ensureWheelerAnimations(): void {
    // Prevent duplicate animation registration if the scene restarts
    if (this.anims.exists("wheeler_idle")) return;

    /*const map = this.cache.json.get("wheeler_animmap");
    const make = (key: string) => {
      const cfg = map.animations[key];
      this.anims.create({
        key,
        frames: cfg.frames.map((i: number) => ({ key: "wheeler", frame: i })),
        frameRate: cfg.frameRate,
        repeat: cfg.repeat
      });
    };*/

    const player_map = this.cache.json.get("wheeler_animmap");
    const player_make = (key: string) => {
      const cfg = player_map.animations[key];
      if (this.anims.exists(key)) return;
      
      this.anims.create({
        key,
        frames: cfg.frames.map((name: string) => ({ key: player_map.atlasKey, frame: name })),
        frameRate: cfg.frameRate,
        repeat: cfg.repeat
      });
    };
    player_make("wheeler_idle");
    player_make("wheeler_move");
    player_make("wheeler_attack");
    player_make("wheeler_hit");
    player_make("wheeler_death");

    const enemy_map = this.cache.json.get("enemy_spewbot_animmap");
    
    const enemy_make = (key: string) => {
      const cfg = enemy_map.animations[key];
      if (this.anims.exists(key)) return;
      
      this.anims.create({
        key,
        frames: cfg.frames.map((name: string) => ({ key: enemy_map.atlasKey, frame: name })),
        frameRate: cfg.frameRate,
        repeat: cfg.repeat
      });
    };
    enemy_make("enemy_spewbot_idle");
    enemy_make("enemy_spewbot_move");
    enemy_make("enemy_spewbot_attack");
    enemy_make("enemy_spewbot_hit");
    enemy_make("enemy_spewbot_death");

  }

  private terrainColor(terrain: Terrain, polluted: boolean): number {
    if (polluted) return 0x0a0a0a;
    
    switch (terrain) {
      case "water": return 0x123a66;
      case "grass": return 0x1f5a2a;
      case "sand":  return 0x7a6a2a;
      case "stone": return 0x4a4a4a;
      case "lava":  return 0x7a2a2a;
      case "ice":   return 0x6aa6a6;
    }
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
      //const fill = t.walkable ? 0x1a2433 : 0x2b2b2b;
      const fill = t.walkable ? this.terrainColor(t.terrain, t.polluted) : 0x2b2b2b;
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

    for (const e of this.enemies) {
      const sp = this.enemySprites.get(e.id);
      if (!sp) continue;
      
      if (e.downed) {
        sp.setVisible(false);
        continue;
      }
      
      const w = this.grid.gridToWorld(e.pos);
      sp.setVisible(true);
      sp.setPosition(w.x, w.y - 10);
    }

    // Update unit sprite position
    const uWorld = this.grid.gridToWorld(this.unit.pos);
    this.unitSprite.setPosition(uWorld.x, uWorld.y - 10);
    //this.unitSprite.setFillStyle(this.selected ? 0x3ad0ff : 0x7aa0b8);
    // Optional: tint for selection feedback (instead of fillStyle)
    this.unitSprite.clearTint();
    if (this.selected) this.unitSprite.setTint(0x9ecbff);

    // Position enemy sprites
    for (const e of this.enemies) {
      const ew = this.grid.gridToWorld(e.pos);
      e.sprite.setPosition(ew.x, ew.y - 10);
      e.sprite.setDepth(e.sprite.y);
    }

    //this.drawHud();
    this.hud.draw(this, this.unit);
  }

  private updateHoverPreview(gp: GridPos): void {
    this.hoverGfx.clear();
    this.hoverPath = [];

    // Only show move preview when selected + PlayerMove
    if (!(this.selected && this.phase === TurnPhase.PlayerMove)) {
      return;
    }

    // Ensure reachability exists
    if (!this.reach) {
      this.reach = bfsReachable(
        this.grid,
        this.tiles,
        this.unit.pos,
        this.unit.moveRange,
        this.occupied
      );
    }

    const destKey = keyOf(gp);

    // Unreachable: draw a faint invalid outline on hovered tile
    if (!this.reach.reachable.has(destKey)) {
      const w = this.grid.gridToWorld(gp);
      this.drawDiamond(this.hoverGfx, w.x, w.y, 0xffffff, 0.03, 0xff6b6b, 1);
      return;
    }

    // Reachable: reconstruct path and draw dotted markers
    const path = reconstructPath(this.reach.cameFrom, this.unit.pos, gp);
    this.hoverPath = path;

    // Draw dots for path steps (skip start tile)
    for (let i = 1; i < path.length; i++) {
      const w = this.grid.gridToWorld(path[i]);

      // Small dot slightly above tile center
      this.hoverGfx.fillStyle(0xffffff, 0.9);
      this.hoverGfx.fillCircle(w.x, w.y - 6, 3.2);

      // Subtle ring for readability
      this.hoverGfx.lineStyle(1, 0x9ecbff, 1);
      this.hoverGfx.strokeCircle(w.x, w.y - 6, 3.2);
    }

    // Emphasize destination a bit
    const wEnd = this.grid.gridToWorld(gp);
    this.hoverGfx.fillStyle(0xffffff, 1);
    this.hoverGfx.fillCircle(wEnd.x, wEnd.y - 6, 4.6);
    this.hoverGfx.lineStyle(2, 0x3ad0ff, 1);
    this.hoverGfx.strokeCircle(wEnd.x, wEnd.y - 6, 4.6);
  }

  private clearHover(): void {
    this.hoverKey = null;
    this.hoverPath = [];
    this.hoverGfx.clear();
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
    
    this.unitSprite.play("wheeler_move", true);

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

    this.unitSprite.play("wheeler_idle", true);
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

  private findPathEnemyToPlayer(start: GridPos, goal: GridPos): GridPos[] {
    const startK = keyOf(start);
    const goalK = keyOf(goal);
    
    const queue: TileKey[] = [startK];
    const cameFrom = new Map<TileKey, TileKey | null>();
    cameFrom.set(startK, null);

    while (queue.length) {
      const curK = queue.shift()!;
      if (curK === goalK) break;
      
      const cur = parseKey(curK);
      //for (const n of this.grid.neighbors8(cur)) {
      for (const n of this.grid.neighbors4(cur)) {
        const nk = keyOf(n);
        if (cameFrom.has(nk)) continue;
        
        const tile = this.tiles.get(nk);
        if (!tile || !tile.walkable) continue;
        
        // Blockers (other units)
        if (this.occupied.has(nk) && nk !== goalK) continue;
        
        cameFrom.set(nk, curK);
        queue.push(nk);
      }
    }

    // reconstruct
    if (!cameFrom.has(goalK)) return []; // no path
     
    const pathKeys: TileKey[] = [];
    let cur: TileKey | null = goalK;
    while (cur) {
      pathKeys.push(cur);
      cur = cameFrom.get(cur) ?? null;
    }
    pathKeys.reverse();
    
    return pathKeys.map(parseKey);
  }

  private spawnSpewbot(pos: GridPos): Unit {
    
    const w = this.grid.gridToWorld(pos);
    const s = this.add.sprite(w.x, w.y - 10, "enemy_spewbot", "idle_0");
    s.setScale(UNIT_SCALE);
    //s.setOrigin(UNIT_ORIGIN_Y, UNIT_Y_OFFSET);
    s.setOrigin(0.5, 0.70);
    s.play("enemy_spewbot_idle");

    const unit: Unit = {
      id: "e1",
      name: "Ripper",
      team: "enemy",
      pos,
      hp: 800,
      maxHp: 800,
      energy: 0,
      moveRange: 1,
      attackRange: 1,
      attackDamage: 350,
      homeTerrains: [],
      isEnemy: true,
      downed: false,
      sprite: s
    };
    
    // mark occupied so movement/pathing respects it
    this.occupied.add(keyOf(pos));
    
    // depth rule for iso
    //s.setDepth(s.y);
    //unit.sprite = s;

    //this.enemies.push({id: unit.id, name: "Spewbot", });
    
    this.enemies.push(unit);
    return unit;
  }

  private polluteTile(p: GridPos): void {
    const t = this.tiles.get(keyOf(p));
    if (!t) return;
    t.polluted = true;
  }

  private isAnyEnemyAlive(): boolean {
    return this.enemies.some(e => !e.downed);
  }

  private runEnemyTurn(): void {
    
    // If no enemies remain, end level immediately (prevents "weird after downed")
    if (!this.isAnyEnemyAlive()) {
      console.log("All enemies downed. Level complete.");
      this.phase = TurnPhase.PlayerMove;
      this.clearHover();
      this.selected = true;
      this.reach = null;
      this.redraw();
      return;
    }

    for (const e of this.enemies) {
        if (e.downed) continue;
        if (this.unit.downed) break;

        // 1) Move toward player
        const path = this.findPathEnemyToPlayer(e.pos, this.unit.pos);

        // path includes start tile; we want to move up to moveRange steps forward
        // Also, if already adjacent / in range, we might skip movement.
        const distNow = manhattanLikeDiagDistance(e.pos, this.unit.pos);
        if (distNow > e.attackRange && path.length > 1) {
          const steps = Math.min(e.moveRange, path.length - 1);

          // update occupancy: free old position
          this.occupied.delete(keyOf(e.pos));

          // walk steps 1..steps
          for (let i = 1; i <= steps; i++) {
            const stepPos = path[i];
            
            // if stepping onto player tile, stop before it
            if (stepPos.q === this.unit.pos.q && stepPos.r === this.unit.pos.r) {
              break;
            }
            
            e.pos = stepPos;
            
            // pollute tile stepped on
            this.polluteTile(stepPos);
          }
          
          // mark new position occupied
          this.occupied.add(keyOf(e.pos));
        }

        // 2) Attack if in range after movement
        const dist = manhattanLikeDiagDistance(e.pos, this.unit.pos);
        if (dist <= e.attackRange) {
          this.unit.hp = Math.max(0, this.unit.hp - e.attackDamage);
          if (this.unit.hp === 0) {
            this.unit.downed = true;
            console.log("Player unit downed!");
          }
        }

    }

    // End enemy turn -> player move
    this.phase = TurnPhase.PlayerMove;
    this.clearHover();
    this.selected = true;
    this.reach = null;
    this.redraw();
  }

  private endPlayerAttackAndStartEnemyTurn(): void {
    this.phase = TurnPhase.EnemyTurn;
    this.clearHover();
    this.selected = false;
    this.reach = null;
    this.redraw();
    
    console.log("Enemy turn starts");
    this.time.delayedCall(300, () => {
      this.runEnemyTurn();
    });
  }

  private applyEndOfMoveEffects(): void {
    const tile = this.tiles.get(keyOf(this.unit.pos));
    if (!tile) return;
    
    // Pollution penalty: -50 energy when standing on polluted tile
    if (tile.polluted) {
      this.unit.energy = Math.max(0, this.unit.energy - 50);
      return;
    }
    
    // Home terrain recovery
    if (this.unit.homeTerrains.includes(tile.terrain)) {
      this.unit.hp = Math.min(this.unit.maxHp, this.unit.hp + 200);
      this.unit.energy = Math.min(1000, this.unit.energy + 250);
    }
  }

}