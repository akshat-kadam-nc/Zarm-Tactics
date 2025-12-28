import Phaser from "phaser";
import type { Unit } from "../core/types";

export class Hud {
  private gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics();
    this.gfx.setScrollFactor(0);
    this.gfx.setDepth(1000);
  }

  draw(scene: Phaser.Scene, unit: Unit): void {
    this.gfx.clear();
    // draw bars here (same code you already have)
    const x = 20;
    const y = scene.scale.height - 85;
    const w = 320;
    const h = 18;
    const gap = 10;

    // Panel
    this.gfx.fillStyle(0x0b0f14, 0.75);
    this.gfx.fillRoundedRect(x - 10, y - 18, w + 20, 70, 8);
    this.gfx.lineStyle(1, 0x31445f, 1);
    this.gfx.strokeRoundedRect(x - 10, y - 18, w + 20, 70, 8);

    const hpPct = unit.maxHp > 0 ? unit.hp / unit.maxHp : 0;
    this.drawBar(x, y, w, h, hpPct, 0x2b2b2b, 0x4cff4c);

    const eMax = 1000;
    const ePct = eMax > 0 ? unit.energy / eMax : 0;
    this.drawBar(x, y + h + gap, w, h, ePct, 0x2b2b2b, 0xffe14c);
  }

  private drawBar(
    x: number,
    y: number,
    w: number,
    h: number,
    pct: number,
    bg: number,
    fg: number
  ): void {
    const p = Phaser.Math.Clamp(pct, 0, 1);

    this.gfx.fillStyle(bg, 1);
    this.gfx.fillRoundedRect(x, y, w, h, 6);

    this.gfx.fillStyle(fg, 1);
    this.gfx.fillRoundedRect(x, y, Math.floor(w * p), h, 6);

    this.gfx.lineStyle(1, 0xd6e2ff, 0.5);
    this.gfx.strokeRoundedRect(x, y, w, h, 6);
  }
}