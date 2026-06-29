import type { LoadedFighter, PlayerSlot } from "../../types/game";
import { STAGE_X_RANGE } from "./constants";

export function mapBattleX(x: number, arenaWidth: number) {
  return (x / arenaWidth - 0.5) * STAGE_X_RANGE;
}

export function getFighterBillboardGeometry(fighter: LoadedFighter, height: number, pose: LoadedFighter["frames"]["idle"]["pose"]) {
  const frame = fighter.frames[pose];
  const width = height * Math.max(0.82, Math.min(1.16, frame.width / frame.height));
  const anchorY = Number.isFinite(frame.anchor.y) ? frame.anchor.y : 0.9;
  return { width, height, centerY: 0.08 + height * (anchorY - 0.5) };
}

export function getSlotAccent(slot: PlayerSlot) {
  return slot === "p1" ? "#f45b69" : "#2ec4b6";
}

export function addSmoothExp(current: number, target: number, speed: number, deltaSeconds: number) {
  return (target - current) * (1 - Math.exp(-speed * deltaSeconds));
}

export function easeOutBack(value: number) {
  const overshoot = 1.48;
  const shifted = value - 1;
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
}

export function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
