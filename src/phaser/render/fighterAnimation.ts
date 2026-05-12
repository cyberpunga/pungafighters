import type { FighterPose } from "../../types/game";
import type { FighterRuntime } from "../../game/simulation/battle";

const CROSSFADE_SECONDS = 0.1;
const LAND_SQUASH_SECONDS = 0.18;

export interface FighterRenderState {
  currentPose: FighterPose;
  previousPose?: FighterPose;
  poseElapsed: number;
  crossfadeElapsed: number;
  previousX: number;
  previousY: number;
  velocityX: number;
  idleOffset: number;
  wasGrounded: boolean;
  landElapsed: number;
}

export interface FighterRenderTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  tint?: number;
}

export interface FighterRenderFrame {
  current: FighterRenderTransform;
  previous?: FighterRenderTransform;
  currentAlpha: number;
  previousAlpha: number;
}

export function createFighterRenderState(runtime: FighterRuntime, idleOffset: number): FighterRenderState {
  return {
    currentPose: runtime.pose,
    poseElapsed: 0,
    crossfadeElapsed: CROSSFADE_SECONDS,
    previousX: runtime.x,
    previousY: runtime.y,
    velocityX: 0,
    idleOffset,
    wasGrounded: true,
    landElapsed: LAND_SQUASH_SECONDS,
  };
}

export function updateFighterRenderState(
  renderState: FighterRenderState,
  runtime: FighterRuntime,
  deltaSeconds: number,
  groundY: number,
): FighterRenderFrame {
  const dt = Math.max(deltaSeconds, 1 / 120);
  const grounded = runtime.y >= groundY - 1 && Math.abs(runtime.velocityY) < 1;

  renderState.velocityX = (runtime.x - renderState.previousX) / dt;
  renderState.poseElapsed += deltaSeconds;
  renderState.crossfadeElapsed = Math.min(CROSSFADE_SECONDS, renderState.crossfadeElapsed + deltaSeconds);
  renderState.landElapsed = Math.min(LAND_SQUASH_SECONDS, renderState.landElapsed + deltaSeconds);

  if (runtime.pose !== renderState.currentPose) {
    renderState.previousPose = renderState.currentPose;
    renderState.currentPose = runtime.pose;
    renderState.poseElapsed = 0;
    renderState.crossfadeElapsed = 0;
  }

  if (!renderState.wasGrounded && grounded) {
    renderState.landElapsed = 0;
  }
  renderState.wasGrounded = grounded;
  renderState.previousX = runtime.x;
  renderState.previousY = runtime.y;

  const current = resolveTransform(renderState, runtime, groundY);
  const fadeProgress = easeOutCubic(clamp01(renderState.crossfadeElapsed / CROSSFADE_SECONDS));
  const previous =
    renderState.previousPose && fadeProgress < 1
      ? {
          ...current,
          scaleX: current.scaleX * (1 - 0.02 * fadeProgress),
          scaleY: current.scaleY * (1 + 0.02 * fadeProgress),
        }
      : undefined;

  return {
    current,
    previous,
    currentAlpha: previous ? fadeProgress : 1,
    previousAlpha: previous ? 1 - fadeProgress : 0,
  };
}

function resolveTransform(renderState: FighterRenderState, runtime: FighterRuntime, groundY: number): FighterRenderTransform {
  const forward = runtime.facing;
  const attackProgress = runtime.attack ? clamp01(runtime.attackElapsed / runtime.attack.duration) : 0;
  const activeAttack =
    runtime.attack && runtime.attackElapsed >= runtime.attack.activeStart && runtime.attackElapsed <= runtime.attack.activeEnd;
  const grounded = runtime.y >= groundY - 1 && Math.abs(runtime.velocityY) < 1;
  const moving = grounded && Math.abs(renderState.velocityX) > 24 && !runtime.attack && runtime.hitStun <= 0;

  let offsetX = 0;
  let offsetY = 0;
  let scaleX = 1;
  let scaleY = 1;
  let rotation = 0;
  let alpha = runtime.blocking ? 0.78 : 1;
  let tint: number | undefined;

  if (runtime.pose === "idle" && !moving && grounded) {
    const breath = Math.sin((renderState.poseElapsed + renderState.idleOffset) * 4.4);
    offsetY += breath * 2.4;
    scaleX += -breath * 0.01;
    scaleY += breath * 0.018;
    rotation += breath * 0.018;
  }

  if (moving) {
    const stride = Math.sin((runtime.x * 0.045 + renderState.idleOffset) * Math.PI);
    offsetY += Math.abs(stride) * -4;
    rotation += clamp(renderState.velocityX / 900, -0.09, 0.09);
    scaleX += 0.018;
    scaleY -= 0.018;
  }

  if (!grounded) {
    const rising = runtime.velocityY < 0;
    scaleX += rising ? -0.045 : 0.035;
    scaleY += rising ? 0.075 : -0.045;
    rotation += clamp(runtime.velocityY / 7000, -0.08, 0.1) * forward;
  }

  if (renderState.landElapsed < LAND_SQUASH_SECONDS) {
    const squash = 1 - easeOutCubic(renderState.landElapsed / LAND_SQUASH_SECONDS);
    scaleX += squash * 0.08;
    scaleY -= squash * 0.1;
    offsetY += squash * 8;
  }

  if (runtime.attack) {
    const windup = 1 - easeOutCubic(clamp01(attackProgress / 0.32));
    const snap = activeAttack ? 1 : 0;
    const recovery = easeInOutSine(clamp01((attackProgress - 0.54) / 0.46));

    offsetX += forward * (-10 * windup + 18 * snap - 7 * recovery);
    offsetY += runtime.attack.kind === "kick" ? -5 * snap : -2 * snap;
    rotation += forward * (runtime.attack.kind === "kick" ? -0.16 : 0.12) * (windup * 0.55 + snap - recovery * 0.35);
    scaleX += snap * 0.09 - windup * 0.025;
    scaleY -= snap * 0.045;

    if (runtime.attack.kind === "special") {
      scaleX += 0.04 * Math.sin(attackProgress * Math.PI);
      tint = activeAttack ? 0xf7b267 : undefined;
    }
  }

  if (runtime.hitStun > 0) {
    const recoil = clamp01(runtime.hitStun / 0.24);
    const shake = Math.sin(renderState.poseElapsed * 90) * recoil;
    offsetX -= forward * (18 * recoil + shake * 3);
    offsetY += shake * 2;
    rotation -= forward * 0.16 * recoil;
    scaleX += 0.035 * recoil;
    scaleY -= 0.03 * recoil;
    tint = 0xf8f4df;
  }

  if (runtime.blocking) {
    offsetX -= forward * 9;
    rotation -= forward * 0.055;
    scaleX -= 0.025;
    scaleY += 0.025;
    tint = 0xd9d2b6;
  }

  if (runtime.pose === "victory") {
    const bounce = Math.abs(Math.sin(renderState.poseElapsed * 6));
    offsetY -= bounce * 10;
    rotation += Math.sin(renderState.poseElapsed * 5) * 0.05;
    scaleX += bounce * 0.025;
    scaleY -= bounce * 0.02;
  }

  return {
    x: runtime.x + offsetX,
    y: runtime.y + offsetY,
    scaleX,
    scaleY,
    rotation,
    alpha,
    tint,
  };
}

function easeOutCubic(value: number) {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutSine(value: number) {
  const t = clamp01(value);
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
