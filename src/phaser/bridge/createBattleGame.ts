import Phaser from "phaser";
import type { BattleConfig, LoadedFighter, RuntimeBattleBackground } from "../../types/game";
import type { NetworkInputController } from "../../game/network/networkInputController";
import { BattleScene, type BattleSceneOptions } from "../scenes/BattleScene";

export interface BattleGameHandle {
  game: Phaser.Game;
  destroy: () => void;
}

export function createBattleGame(input: {
  parent: HTMLElement;
  config: BattleConfig;
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  background?: RuntimeBattleBackground;
  onExit: () => void;
  mode?: BattleSceneOptions["mode"];
  localSlot?: BattleSceneOptions["localSlot"];
  networkController?: NetworkInputController;
}): BattleGameHandle {
  const scene = new BattleScene(input.config, input.fighters, input.onExit, {
    background: input.background,
    mode: input.mode,
    localSlot: input.localSlot,
    networkController: input.networkController,
  });
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
