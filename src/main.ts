import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";

/**
 * v0.3.0 goals:
 * - ...
 *
 * Next versions will add:
 * - ...
 */

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
