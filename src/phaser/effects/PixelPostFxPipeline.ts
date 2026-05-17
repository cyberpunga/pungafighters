import Phaser from "phaser";
import type { BattleDisplayEffect } from "../../types/game";

export const PIXEL_POST_FX_PIPELINE_KEY = "PixelPostFxPipeline";

interface PixelPostFxConfig {
  pixelSize: number;
}

type PixelDisplayEffect = Extract<BattleDisplayEffect, "pixel">;

const PIXEL_POST_FX_FRAGMENT_SHADER = `
#define SHADER_NAME PUNGA_PIXEL_POST_FX
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 resolution;
uniform float pixelSize;

varying vec2 outTexCoord;

void main() {
  float blockSize = max(pixelSize, 1.0);
  vec2 texelPosition = outTexCoord * resolution;
  vec2 blockCenter = floor(texelPosition / blockSize) * blockSize + blockSize * 0.5;
  vec2 pixelatedUv = clamp(blockCenter / resolution, vec2(0.0), vec2(1.0));

  gl_FragColor = texture2D(uMainSampler, pixelatedUv);
}
`;

const DEFAULT_PIXEL_CONFIG: PixelPostFxConfig = {
  pixelSize: 1,
};

const PIXEL_CONFIGS: Record<PixelDisplayEffect, PixelPostFxConfig> = {
  pixel: {
    pixelSize: 2,
  },
};

export class PixelPostFxPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private readonly effectConfig: PixelPostFxConfig;

  constructor(game: Phaser.Game, config: Partial<PixelPostFxConfig> = {}) {
    super({
      game,
      fragShader: PIXEL_POST_FX_FRAGMENT_SHADER,
    });
    this.effectConfig = {
      ...DEFAULT_PIXEL_CONFIG,
      ...config,
    };
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget) {
    this.set2f("resolution", renderTarget.width, renderTarget.height);
    this.set1f("pixelSize", this.effectConfig.pixelSize);
    this.bindAndDraw(renderTarget);
  }
}

export function getPixelPostFxConfig(effect: BattleDisplayEffect): PixelPostFxConfig | undefined {
  return effect === "pixel" ? PIXEL_CONFIGS[effect] : undefined;
}
