import Phaser from "phaser";
import type { BattleConfig, LoadedFighter } from "../../types/game";
import { BattleScene } from "../scenes/BattleScene";

export interface BattleGameHandle {
  game: Phaser.Game;
  destroy: () => void;
}

export function createBattleGame(input: {
  parent: HTMLElement;
  config: BattleConfig;
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  onExit: () => void;
}): BattleGameHandle {
  const scene = new BattleScene(input.config, input.fighters, input.onExit);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: input.parent,
    width: 960,
    height: 540,
    backgroundColor: "#17151f",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [scene],
    physics: {
      default: "arcade",
    },
  });

  return {
    game,
    destroy: () => game.destroy(true),
  };
}
