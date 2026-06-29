import type { BattleState } from "../../game/simulation/battle";
import { STAGE_Z } from "./constants";
import { getSlotAccent, mapBattleX, seededUnit } from "./math";

export interface DebrisPiece {
  id: string;
  color: string;
  impulse: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  torque: [number, number, number];
}

export function createImpactDebris(state: BattleState): DebrisPiece[] {
  const hit = state.lastHit;
  if (!hit) {
    return [];
  }
  const attacker = state.fighters[hit.attacker];
  const defender = state.fighters[hit.defender];
  const direction = defender.x >= attacker.x ? 1 : -1;
  const origin: [number, number, number] = [mapBattleX(defender.x, state.arenaWidth), 1.05, STAGE_Z + 0.08];
  return Array.from({ length: 7 }, (_, index) => {
    const seed = hit.at * 31 + index * 17;
    const outward = 0.55 + seededUnit(seed) * 0.4;
    const lift = 0.55 + seededUnit(seed + 1) * 0.65;
    const depth = (seededUnit(seed + 2) - 0.5) * 0.34;
    return {
      id: `${hit.at}-${index}`,
      color: index % 3 === 0 ? "#8a603a" : index % 3 === 1 ? "#f7b267" : "#3a2a22",
      impulse: [direction * outward, lift, depth],
      position: [origin[0] + direction * 0.08 * index, origin[1] + seededUnit(seed + 3) * 0.2, origin[2] + depth * 0.2],
      rotation: [seededUnit(seed + 4) * Math.PI, seededUnit(seed + 5) * Math.PI, seededUnit(seed + 6) * Math.PI],
      size: [0.08 + seededUnit(seed + 7) * 0.09, 0.035 + seededUnit(seed + 8) * 0.05, 0.06 + seededUnit(seed + 9) * 0.08],
      torque: [(seededUnit(seed + 10) - 0.5) * 0.32, (seededUnit(seed + 11) - 0.5) * 0.4, direction * (0.22 + seededUnit(seed + 12) * 0.42)],
    };
  });
}

export function createSuperDebris(state: BattleState): DebrisPiece[] {
  const superEvent = state.lastSuper;
  if (!superEvent) {
    return [];
  }
  const attacker = state.fighters[superEvent.attacker];
  const side = superEvent.attacker === "p1" ? -1 : 1;
  const origin: [number, number, number] = [mapBattleX(attacker.x, state.arenaWidth), 0.62, STAGE_Z + 0.22];
  return Array.from({ length: 12 }, (_, index) => {
    const seed = superEvent.at * 47 + index * 23;
    const angle = -0.72 + (index / 11) * 1.44;
    const outward = 0.54 + seededUnit(seed) * 0.64;
    const lift = 0.72 + seededUnit(seed + 1) * 0.9;
    const depth = (seededUnit(seed + 2) - 0.5) * 0.62;
    return {
      id: `super-${superEvent.at}-${index}`,
      color: index % 3 === 0 ? getSlotAccent(superEvent.attacker) : index % 3 === 1 ? "#f8f4df" : "#f7b267",
      impulse: [side * Math.cos(angle) * outward, lift, depth],
      position: [origin[0] + side * seededUnit(seed + 3) * 0.42, origin[1] + seededUnit(seed + 4) * 0.24, origin[2] + depth * 0.2],
      rotation: [seededUnit(seed + 5) * Math.PI, seededUnit(seed + 6) * Math.PI, seededUnit(seed + 7) * Math.PI],
      size: [0.055 + seededUnit(seed + 8) * 0.1, 0.026 + seededUnit(seed + 9) * 0.05, 0.07 + seededUnit(seed + 10) * 0.12],
      torque: [(seededUnit(seed + 11) - 0.5) * 0.44, (seededUnit(seed + 12) - 0.5) * 0.5, side * (0.34 + seededUnit(seed + 13) * 0.58)],
    };
  });
}
