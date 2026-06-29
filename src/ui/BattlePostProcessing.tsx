import { ChromaticAberration, DepthOfField, DotScreen, EffectComposer, Pixelation, Scanline, Vignette } from "@react-three/postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useEffect, useMemo, useRef, type ReactElement } from "react";
import { BlendFunction, Effect, EffectAttribute, type DepthOfFieldEffect } from "postprocessing";
import { Uniform, Vector2, Vector3, type WebGLRenderer, type WebGLRenderTarget } from "three";
import type { BattleState } from "../game/simulation/battle";
import { getEnabledBattlePostEffects } from "../game/render/postEffectSettings";
import type { BattlePostEffect, BattlePostEffectConfigMap, BattlePostEffectSettings, PlayerSlot } from "../types/game";

const STAGE_X_RANGE = 5.1;
const STAGE_Z = 0.1;
const CAMERA_CLOSE_DISTANCE = 0.65;
const CAMERA_FAR_DISTANCE = 4.05;

export function BattlePostProcessing(props: { state: BattleState; displayEffectSettings: BattlePostEffectSettings; localSlot: PlayerSlot }) {
  const watchedHealth = props.state.fighters[props.localSlot].health;
  const lowHealthStrength = props.state.status === "running" && watchedHealth > 0 && watchedHealth <= 30 ? (30 - watchedHealth) / 30 : 0;
  const displayEffects = getEnabledBattlePostEffects(props.displayEffectSettings);
  if (displayEffects.length === 0 && lowHealthStrength <= 0) {
    return null;
  }
  const composerKey = displayEffects.join("|") || "clean";
  const passes: ReactElement[] = displayEffects.map((effect) => (
    <BattleEffectPass key={effect} effect={effect} settings={props.displayEffectSettings.effects[effect]} state={props.state} />
  ));
  if (lowHealthStrength > 0) {
    passes.push(<LowHealth key="low-health" strength={0.34 + lowHealthStrength * 0.5} />);
  }

  return (
    <EffectComposer key={composerKey} enableNormalPass={false} multisampling={0}>
      {passes}
    </EffectComposer>
  );
}

function BattleEffectPass(props: { effect: BattlePostEffect; settings: BattlePostEffectConfigMap[BattlePostEffect]; state: BattleState }) {
  switch (props.effect) {
    case "pixel":
      {
        const settings = props.settings as BattlePostEffectConfigMap["pixel"];
        return <Pixelation granularity={settings.granularity} />;
      }
    case "bad-tv":
      {
        const settings = props.settings as BattlePostEffectConfigMap["bad-tv"];
        return (
          <>
            <ChromaticAberration
              offset={new Vector2(settings.chromaticOffsetX, settings.chromaticOffsetY)}
              radialModulation={false}
              modulationOffset={0}
              opacity={settings.chromaticOpacity}
            />
            <BadTV distortion={settings.distortion} distortion2={settings.distortion2} speed={settings.speed} rollSpeed={settings.rollSpeed} />
          </>
        );
      }
    case "static":
      {
        const settings = props.settings as BattlePostEffectConfigMap["static"];
        return <Static amount={settings.amount} size={settings.size} />;
      }
    case "crt-soft":
      {
        const settings = props.settings as BattlePostEffectConfigMap["crt-soft"];
        return (
          <>
            <CRT hardScan={settings.hardScan} hardPix={settings.hardPix} warp={new Vector2(settings.warpX, settings.warpY)} maskDark={settings.maskDark} maskLight={settings.maskLight} />
            <Scanline blendFunction={BlendFunction.MULTIPLY} density={settings.scanlineDensity} opacity={settings.scanlineOpacity} />
          </>
        );
      }
    case "crt-strong":
      {
        const settings = props.settings as BattlePostEffectConfigMap["crt-strong"];
        return (
          <>
            <CRT hardScan={settings.hardScan} hardPix={settings.hardPix} warp={new Vector2(settings.warpX, settings.warpY)} maskDark={settings.maskDark} maskLight={settings.maskLight} />
            <Scanline blendFunction={BlendFunction.MULTIPLY} density={settings.scanlineDensity} opacity={settings.scanlineOpacity} />
            <ChromaticAberration
              offset={new Vector2(settings.chromaticOffsetX, settings.chromaticOffsetY)}
              radialModulation={false}
              modulationOffset={0}
              opacity={settings.chromaticOpacity}
            />
            <DotScreen blendFunction={BlendFunction.COLOR_BURN} angle={Math.PI * 0.5} scale={settings.dotScale} opacity={settings.dotOpacity} />
          </>
        );
      }
    case "lens":
      {
        const settings = props.settings as BattlePostEffectConfigMap["lens"];
        return <Lens settings={settings} state={props.state} />;
      }
    default:
      return null;
  }
}

function Lens(props: { settings: BattlePostEffectConfigMap["lens"]; state: BattleState }) {
  const { camera } = useThree();
  const depthOfFieldRef = useRef<DepthOfFieldEffect>(null);
  const focusTargetRef = useRef(new Vector3(0, 1.15, STAGE_Z));
  const previousCameraPositionRef = useRef<Vector3 | null>(null);
  const bokehScaleRef = useRef(0.72);
  const motionBlurRef = useRef(0);

  useFrame((_, deltaSeconds) => {
    const p1X = mapBattleX(props.state.fighters.p1.x, props.state.arenaWidth);
    const p2X = mapBattleX(props.state.fighters.p2.x, props.state.arenaWidth);
    const midpointX = (p1X + p2X) / 2;
    const distance = Math.abs(p2X - p1X);
    const spread = clamp((distance - CAMERA_CLOSE_DISTANCE) / (CAMERA_FAR_DISTANCE - CAMERA_CLOSE_DISTANCE), 0, 1);
    const superAge = props.state.lastSuper ? props.state.frame - props.state.lastSuper.at : Infinity;
    const hitAge = props.state.lastHit ? props.state.frame - props.state.lastHit.at : Infinity;
    const superPulse = superAge >= 0 && superAge < 58 ? 1 - superAge / 58 : 0;
    const hitPulse = hitAge >= 0 && hitAge < 16 ? 1 - hitAge / 16 : 0;
    const superFocusX =
      props.state.lastSuper && superAge >= 0 && superAge < 48
        ? mapBattleX(props.state.fighters[props.state.lastSuper.attacker].x, props.state.arenaWidth)
        : midpointX;
    const focusX = midpointX + (superFocusX - midpointX) * superPulse;
    focusTargetRef.current.set(focusX, 1.14 + spread * 0.12 + superPulse * 0.1, STAGE_Z);

    const previousCameraPosition = previousCameraPositionRef.current;
    const cameraVelocity = previousCameraPosition && deltaSeconds > 0 ? camera.position.distanceTo(previousCameraPosition) / deltaSeconds : 0;
    if (!previousCameraPositionRef.current) {
      previousCameraPositionRef.current = camera.position.clone();
    } else {
      previousCameraPositionRef.current.copy(camera.position);
    }
    const motionTarget = clamp(cameraVelocity * 0.075 * props.settings.motionBoost, 0, 0.72 * props.settings.motionBoost);
    motionBlurRef.current += addSmoothExp(motionBlurRef.current, motionTarget, motionTarget > motionBlurRef.current ? 8 : 4, deltaSeconds);

    const targetBokeh = clamp(
      props.settings.bokehBase + motionBlurRef.current + hitPulse * props.settings.hitBoost + superPulse * props.settings.superBoost + (props.state.superFreeze ? 0.5 : 0),
      0,
      6,
    );
    bokehScaleRef.current += addSmoothExp(bokehScaleRef.current, targetBokeh, 10, deltaSeconds);

    if (depthOfFieldRef.current) {
      depthOfFieldRef.current.target = focusTargetRef.current;
      depthOfFieldRef.current.bokehScale = bokehScaleRef.current;
    }
  });

  return (
    <>
      <DepthOfField
        ref={depthOfFieldRef}
        target={[0, 1.15, STAGE_Z]}
        focusRange={props.settings.focusRange}
        bokehScale={props.settings.bokehBase}
        resolutionScale={props.settings.resolutionScale}
      />
      <Vignette offset={props.settings.vignetteOffset} darkness={props.settings.vignetteDarkness} opacity={props.settings.vignetteOpacity} />
    </>
  );
}

type BadTVProps = {
  distortion?: number;
  distortion2?: number;
  speed?: number;
  rollSpeed?: number;
};

const BadTV = forwardRef<BadTVEffect, BadTVProps>((props, ref) => {
  const effect = useMemo(() => new BadTVEffect(props), [props.distortion, props.distortion2, props.speed, props.rollSpeed]);
  return <primitive ref={ref} object={effect} dispose={null} />;
});
BadTV.displayName = "BadTV";

class BadTVEffect extends Effect {
  private time = 0;

  constructor({ distortion = 3, distortion2 = 1.4, speed = 8.5, rollSpeed = 0.018 }: BadTVProps = {}) {
    super("BadTVEffect", badTVFragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["time", new Uniform(0)],
        ["distortion", new Uniform(distortion)],
        ["distortion2", new Uniform(distortion2)],
        ["speed", new Uniform(speed)],
        ["rollSpeed", new Uniform(rollSpeed)],
      ]),
      attributes: EffectAttribute.CONVOLUTION,
    });
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime = 0) {
    this.time += deltaTime;
    const timeUniform = this.uniforms.get("time");
    if (timeUniform) {
      timeUniform.value = this.time;
    }
  }
}

type StaticProps = {
  amount?: number;
  size?: number;
};

const Static = forwardRef<StaticEffect, StaticProps>((props, ref) => {
  const effect = useMemo(() => new StaticEffect(props), [props.amount, props.size]);
  return <primitive ref={ref} object={effect} dispose={null} />;
});
Static.displayName = "Static";

class StaticEffect extends Effect {
  private time = 0;

  constructor({ amount = 0.32, size = 1.65 }: StaticProps = {}) {
    super("StaticEffect", staticFragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["time", new Uniform(0)],
        ["amount", new Uniform(amount)],
        ["size", new Uniform(size)],
      ]),
      attributes: EffectAttribute.CONVOLUTION,
    });
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime = 0) {
    this.time += deltaTime;
    const timeUniform = this.uniforms.get("time");
    if (timeUniform) {
      timeUniform.value = this.time;
    }
  }
}

type CRTProps = {
  hardScan?: number;
  hardPix?: number;
  warp?: Vector2;
  maskDark?: number;
  maskLight?: number;
};

const CRT = forwardRef<CRTEffect, CRTProps>((props, ref) => {
  const effect = useMemo(
    () => new CRTEffect(props),
    [props.hardScan, props.hardPix, props.warp?.x, props.warp?.y, props.maskDark, props.maskLight],
  );
  return <primitive ref={ref} object={effect} dispose={null} />;
});
CRT.displayName = "CRT";

class CRTEffect extends Effect {
  private size = new Vector2();

  constructor({ hardScan = -10, hardPix = -2.6, warp = new Vector2(1 / 54, 1 / 42), maskDark = 0.68, maskLight = 1.22 }: CRTProps = {}) {
    super("CRTShaderEffect", crtFragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["hardScan", new Uniform(hardScan)],
        ["hardPix", new Uniform(hardPix)],
        ["warp", new Uniform(warp)],
        ["maskDark", new Uniform(maskDark)],
        ["maskLight", new Uniform(maskLight)],
        ["resolution", new Uniform(new Vector2(1, 1))],
      ]),
    });
  }

  update(renderer: WebGLRenderer) {
    renderer.getSize(this.size);
    this.uniforms.get("resolution")?.value.set(this.size.x, this.size.y);
  }
}

type LowHealthProps = {
  strength: number;
};

const LowHealth = forwardRef<LowHealthEffect, LowHealthProps>((props, ref) => {
  const effect = useMemo(() => new LowHealthEffect(props.strength), []);
  useEffect(() => {
    const strengthUniform = effect.uniforms.get("strength");
    if (strengthUniform) {
      strengthUniform.value = props.strength;
    }
  }, [effect, props.strength]);
  return <primitive ref={ref} object={effect} dispose={null} />;
});
LowHealth.displayName = "LowHealth";

class LowHealthEffect extends Effect {
  private time = 0;

  constructor(strength: number) {
    super("LowHealthEffect", lowHealthFragmentShader, {
      uniforms: new Map<string, Uniform>([
        ["time", new Uniform(0)],
        ["strength", new Uniform(strength)],
      ]),
      blendFunction: BlendFunction.NORMAL,
    });
  }

  update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, deltaTime = 0) {
    this.time += deltaTime;
    const timeUniform = this.uniforms.get("time");
    if (timeUniform) {
      timeUniform.value = this.time;
    }
  }
}

function mapBattleX(value: number, arenaWidth: number) {
  return (value / arenaWidth - 0.5) * STAGE_X_RANGE;
}

function addSmoothExp(current: number, target: number, speed: number, deltaSeconds: number) {
  return (target - current) * (1 - Math.exp(-speed * deltaSeconds));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const badTVFragmentShader = `
uniform float time;
uniform float distortion;
uniform float distortion2;
uniform float speed;
uniform float rollSpeed;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float yt = uv.y - time * speed;
  float offset = snoise(vec2(yt * 3.0, 0.0)) * 0.2;
  offset = offset * distortion * offset * distortion * offset;
  offset += snoise(vec2(yt * 50.0, 0.0)) * distortion2 * 0.001;
  vec2 newUv = vec2(fract(uv.x + offset), fract(uv.y - time * rollSpeed));
  outputColor = texture2D(inputBuffer, newUv);
}
`;

const staticFragmentShader = `
uniform float time;
uniform float amount;
uniform float size;

float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float xs = floor(gl_FragCoord.x / size);
  float ys = floor(gl_FragCoord.y / size);
  float snow = rand(vec2(xs * max(time, 0.001), ys * max(time, 0.001))) * amount;
  outputColor = vec4(inputColor.rgb + vec3(snow), inputColor.a);
}
`;

const crtFragmentShader = `
uniform vec2 resolution;
uniform float hardScan;
uniform float hardPix;
uniform vec2 warp;
uniform float maskDark;
uniform float maskLight;

float ToLinear1(float c) {
  return (c <= 0.04045) ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

vec3 ToLinear(vec3 c) {
  return vec3(ToLinear1(c.r), ToLinear1(c.g), ToLinear1(c.b));
}

float ToSrgb1(float c) {
  return (c < 0.0031308) ? c * 12.92 : 1.055 * pow(c, 0.41666) - 0.055;
}

vec3 ToSrgb(vec3 c) {
  return vec3(ToSrgb1(c.r), ToSrgb1(c.g), ToSrgb1(c.b));
}

vec3 Fetch(vec2 pos, vec2 off, vec2 res) {
  pos = floor(pos * res + off) / res;
  if (max(abs(pos.x - 0.5), abs(pos.y - 0.5)) > 0.5) {
    return vec3(0.0);
  }
  return ToLinear(texture2D(inputBuffer, pos.xy, -16.0).rgb);
}

vec2 Dist(vec2 pos, vec2 res) {
  pos = pos * res;
  return -((pos - floor(pos)) - vec2(0.5));
}

float Gaus(float pos, float scale) {
  return exp2(scale * pos * pos);
}

vec3 Horz3(vec2 pos, float off, vec2 res) {
  vec3 b = Fetch(pos, vec2(-1.0, off), res);
  vec3 c = Fetch(pos, vec2(0.0, off), res);
  vec3 d = Fetch(pos, vec2(1.0, off), res);
  float dst = Dist(pos, res).x;
  float wb = Gaus(dst - 1.0, hardPix);
  float wc = Gaus(dst, hardPix);
  float wd = Gaus(dst + 1.0, hardPix);
  return (b * wb + c * wc + d * wd) / (wb + wc + wd);
}

vec3 Horz5(vec2 pos, float off, vec2 res) {
  vec3 a = Fetch(pos, vec2(-2.0, off), res);
  vec3 b = Fetch(pos, vec2(-1.0, off), res);
  vec3 c = Fetch(pos, vec2(0.0, off), res);
  vec3 d = Fetch(pos, vec2(1.0, off), res);
  vec3 e = Fetch(pos, vec2(2.0, off), res);
  float dst = Dist(pos, res).x;
  float wa = Gaus(dst - 2.0, hardPix);
  float wb = Gaus(dst - 1.0, hardPix);
  float wc = Gaus(dst, hardPix);
  float wd = Gaus(dst + 1.0, hardPix);
  float we = Gaus(dst + 2.0, hardPix);
  return (a * wa + b * wb + c * wc + d * wd + e * we) / (wa + wb + wc + wd + we);
}

float Scan(vec2 pos, float off, vec2 res) {
  return Gaus(Dist(pos, res).y + off, hardScan);
}

vec3 Tri(vec2 pos, vec2 res) {
  vec3 a = Horz3(pos, -1.0, res);
  vec3 b = Horz5(pos, 0.0, res);
  vec3 c = Horz3(pos, 1.0, res);
  return a * Scan(pos, -1.0, res) + b * Scan(pos, 0.0, res) + c * Scan(pos, 1.0, res);
}

vec2 WarpFunc(vec2 pos) {
  pos = pos * 2.0 - 1.0;
  pos *= vec2(1.0 + (pos.y * pos.y) * warp.x, 1.0 + (pos.x * pos.x) * warp.y);
  return pos * 0.5 + 0.5;
}

vec3 Mask(vec2 pos) {
  pos.x += pos.y * 3.0;
  vec3 mask = vec3(maskDark);
  pos.x = fract(pos.x / 6.0);
  if (pos.x < 0.333) {
    mask.r = maskLight;
  } else if (pos.x < 0.666) {
    mask.g = maskLight;
  } else {
    mask.b = maskLight;
  }
  return mask;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 safeResolution = max(resolution, vec2(1.0));
  vec2 res = safeResolution / 6.0;
  vec2 fragCoord = uv * safeResolution;
  vec2 pos = WarpFunc(fragCoord / safeResolution);
  vec3 color = Tri(pos, res) * Mask(fragCoord);
  outputColor = vec4(ToSrgb(color), inputColor.a);
}
`;

const lowHealthFragmentShader = `
uniform float time;
uniform float strength;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 centered = uv * 2.0 - 1.0;
  float edge = smoothstep(0.42, 1.22, length(centered));
  float pulse = 0.72 + 0.28 * sin(time * 8.5);
  vec3 warning = vec3(1.0, 0.08, 0.1);
  vec3 color = mix(inputColor.rgb, warning, edge * strength * pulse);
  color *= 1.0 - edge * strength * 0.24;
  outputColor = vec4(color, inputColor.a);
}
`;
