import Phaser from "phaser";
import type { BattleDisplayEffect } from "../../types/game";

export const STATIC_POST_FX_PIPELINE_KEY = "StaticPostFxPipeline";

interface StaticPostFxConfig {
  amount: number;
  size: number;
}

type StaticDisplayEffect = Extract<BattleDisplayEffect, "static">;

const STATIC_POST_FX_FRAGMENT_SHADER = `
#define SHADER_NAME PUNGA_STATIC_POST_FX
precision mediump float;

uniform sampler2D uMainSampler;
uniform float time;
uniform float amount;
uniform float size;

varying vec2 outTexCoord;

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 color = texture2D(uMainSampler, outTexCoord);
  float cellSize = max(size, 1.0);
  float xs = floor(gl_FragCoord.x / cellSize);
  float ys = floor(gl_FragCoord.y / cellSize);
  float snow = rand(vec2(xs * time, ys * time)) * amount;

  gl_FragColor = vec4(color.rgb + vec3(snow), color.a);
}
`;

const DEFAULT_STATIC_CONFIG: StaticPostFxConfig = {
  amount: 0,
  size: 4,
};

const STATIC_CONFIGS: Record<StaticDisplayEffect, StaticPostFxConfig> = {
  static: {
    amount: 0.5,
    size: 4,
  },
};

export class StaticPostFxPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  private readonly effectConfig: StaticPostFxConfig;

  constructor(game: Phaser.Game, config: Partial<StaticPostFxConfig> = {}) {
    super({
      game,
      fragShader: STATIC_POST_FX_FRAGMENT_SHADER,
    });
    this.effectConfig = {
      ...DEFAULT_STATIC_CONFIG,
      ...config,
    };
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget) {
    this.set1f("time", this.game.loop.time / 1000);
    this.set1f("amount", this.effectConfig.amount);
    this.set1f("size", this.effectConfig.size);
    this.bindAndDraw(renderTarget);
  }
}

export function getStaticPostFxConfig(effect: BattleDisplayEffect): StaticPostFxConfig | undefined {
  return effect === "static" ? STATIC_CONFIGS[effect] : undefined;
}
