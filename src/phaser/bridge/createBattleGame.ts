import Phaser from "phaser";
import type { BattleConfig, BattlePostEffect, LoadedFighter, RuntimeBattleBackground } from "../../types/game";
import type { NetworkInputController } from "../../game/network/networkInputController";
import { BAD_TV_POST_FX_PIPELINE_KEY, BadTvPostFxPipeline } from "../effects/BadTvPostFxPipeline";
import { CRT_POST_FX_PIPELINE_KEY, CrtPostFxPipeline } from "../effects/CrtPostFxPipeline";
import { BattleScene, type BattleSceneOptions } from "../scenes/BattleScene";

export interface BattleGameHandle {
  game: Phaser.Game;
  setDisplayEffects: (effects: BattlePostEffect[]) => void;
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
  displayEffects?: BattlePostEffect[];
}): BattleGameHandle {
  const scene = new BattleScene(input.config, input.fighters, input.onExit, {
    background: input.background,
    mode: input.mode,
    localSlot: input.localSlot,
    networkController: input.networkController,
    displayEffects: input.displayEffects,
  });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: input.parent,
    width: 960,
    height: 540,
    backgroundColor: "#17151f",
    pipeline: {
      [BAD_TV_POST_FX_PIPELINE_KEY]: BadTvPostFxPipeline as unknown as typeof Phaser.Renderer.WebGL.WebGLPipeline,
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
    setDisplayEffects: (effects) => scene.setDisplayEffects(effects),
    destroy: () => game.destroy(true),
  };
}
