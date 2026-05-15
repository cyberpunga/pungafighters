import Phaser from "phaser";
import type { BattleDisplayEffect } from "../../types/game";

export const CRT_POST_FX_PIPELINE_KEY = "CrtPostFxPipeline";

interface CrtPostFxConfig {
  warp: number;
  scanline: number;
  mask: number;
  vignette: number;
  brightness: number;
  contrast: number;
  saturation: number;
  flicker: number;
}

type CrtDisplayEffect = Extract<BattleDisplayEffect, "crt-soft" | "crt-strong">;

const CRT_POST_FX_FRAGMENT_SHADER = `
#define SHADER_NAME PUNGA_CRT_POST_FX
precision mediump float;

uniform sampler2D uMainSampler;
uniform vec2 resolution;
uniform float time;
uniform float warp;
uniform float scanline;
uniform float mask;
uniform float vignette;
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform float flicker;

varying vec2 outTexCoord;

vec2 curveUv(vec2 uv) {
  vec2 centered = uv * 2.0 - 1.0;
  float radius = dot(centered, centered);
  centered *= 1.0 + warp * radius;
  return centered * 0.5 + 0.5;
}

void main() {
  vec2 uv = curveUv(outTexCoord);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.02, 0.018, 0.026, 1.0);
    return;
  }

  vec4 color = texture2D(uMainSampler, uv);

  float line = 1.0 - scanline * (0.5 + 0.5 * sin(uv.y * resolution.y * 3.14159265));
  float maskSlot = mod(floor(uv.x * resolution.x), 3.0);
  vec3 maskColor = vec3(1.0 - mask * 0.5);
  if (maskSlot < 1.0) {
    maskColor.r += mask;
  } else if (maskSlot < 2.0) {
    maskColor.g += mask;
  } else {
    maskColor.b += mask;
  }

  color.rgb *= line * maskColor;
  color.rgb = (color.rgb - 0.5) * contrast + 0.5 + brightness;
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(luma), color.rgb, saturation);

  vec2 vignetteUv = outTexCoord * (1.0 - outTexCoord.yx);
  float vignetteShape = pow(max(vignetteUv.x * vignetteUv.y * 16.0, 0.0), vignette);
  float flickerPulse = 1.0 + flicker * sin(time * 58.0);

  gl_FragColor = vec4(color.rgb * vignetteShape * flickerPulse, color.a);
}
`;

const DEFAULT_CRT_CONFIG: CrtPostFxConfig = {
  warp: 0,
  scanline: 0,
  mask: 0,
  vignette: 0,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  flicker: 0,
};

const CRT_CONFIGS: Record<CrtDisplayEffect, CrtPostFxConfig> = {
  "crt-soft": {
    warp: 0.018,
    scanline: 0.11,
    mask: 0.045,
    vignette: 0.18,
    brightness: -0.015,
    contrast: 1.04,
    saturation: 1.08,
    flicker: 0.008,
  },
  "crt-strong": {
    warp: 0.035,
    scanline: 0.19,
    mask: 0.08,
    vignette: 0.28,
    brightness: -0.035,
    contrast: 1.1,
    saturation: 1.16,
    flicker: 0.014,
  },
};

export class CrtPostFxPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      fragShader: CRT_POST_FX_FRAGMENT_SHADER,
    });
  }

  onDraw(renderTarget: Phaser.Renderer.WebGL.RenderTarget) {
    const pipelineTarget = this.gameObject as { postPipelineData?: Partial<CrtPostFxConfig> } | undefined;
    const config = {
      ...DEFAULT_CRT_CONFIG,
      ...pipelineTarget?.postPipelineData,
    };

    this.set2f("resolution", renderTarget.width, renderTarget.height);
    this.set1f("time", this.game.loop.time / 1000);
    this.set1f("warp", config.warp);
    this.set1f("scanline", config.scanline);
    this.set1f("mask", config.mask);
    this.set1f("vignette", config.vignette);
    this.set1f("brightness", config.brightness);
    this.set1f("contrast", config.contrast);
    this.set1f("saturation", config.saturation);
    this.set1f("flicker", config.flicker);
    this.bindAndDraw(renderTarget);
  }
}

export function getCrtPostFxConfig(effect: BattleDisplayEffect): CrtPostFxConfig | undefined {
  return isCrtDisplayEffect(effect) ? CRT_CONFIGS[effect] : undefined;
}

function isCrtDisplayEffect(effect: BattleDisplayEffect): effect is CrtDisplayEffect {
  return effect === "crt-soft" || effect === "crt-strong";
}
