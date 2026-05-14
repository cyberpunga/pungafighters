import Phaser from "phaser";
import type { BattleConfig, BattleDisplayEffect, LoadedFighter, RuntimeBattleBackground } from "../../types/game";
import type { NetworkInputController } from "../../game/network/networkInputController";
import { CRT_POST_FX_PIPELINE_KEY, CrtPostFxPipeline } from "../effects/CrtPostFxPipeline";
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
  displayEffect?: BattleDisplayEffect;
}): BattleGameHandle {
  const scene = new BattleScene(input.config, input.fighters, input.onExit, {
    background: input.background,
    mode: input.mode,
    localSlot: input.localSlot,
    networkController: input.networkController,
    displayEffect: input.displayEffect,
  });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: input.parent,
    width: 960,
    height: 540,
    backgroundColor: "#17151f",
    pipeline: {
      [CRT_POST_FX_PIPELINE_KEY]: CrtPostFxPipeline as unknown as typeof Phaser.Renderer.WebGL.WebGLPipeline,
    },
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
