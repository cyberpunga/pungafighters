import type { BattleState } from "../../game/simulation/battle";
import { mapBattleX, mapBattleZ, seededUnit } from "./math";

export interface HitSplashDroplet {
  angle: number;
  color: string;
  delay: number;
  radius: number;
  stretch: number;
  velocity: [number, number, number];
}

export interface HitSplashBurst {
  id: string;
  direction: 1 | -1;
  droplets: HitSplashDroplet[];
  origin: [number, number, number];
}

const CRIMSON = ["#7a1020", "#b0182e", "#d62839", "#4a0711"] as const;

export function createHitSplash(state: BattleState): HitSplashBurst | undefined {
  const hit = state.lastHit;
  if (!hit) {
    return undefined;
  }
  const attacker = state.fighters[hit.attacker];
  const defender = state.fighters[hit.defender];
  const direction: 1 | -1 = defender.x >= attacker.x ? 1 : -1;
  const origin: [number, number, number] = [
    mapBattleX(defender.x, state.arenaWidth) - direction * 0.14,
    1.18,
    mapBattleZ(defender.z, state.arenaDepth) + 0.16,
  ];
  const impactScale = Math.min(1.45, 0.85 + hit.damage / 18);

  return {
    id: `hit-splash-${hit.at}`,
    direction,
    origin,
    droplets: Array.from({ length: 22 }, (_, index) => {
      const seed = hit.at * 61 + index * 19;
      const lift = 0.36 + seededUnit(seed + 1) * 1.35;
      const outward = (0.34 + seededUnit(seed + 2) * 1.25) * impactScale;
      const backSpray = index % 6 === 0 ? -0.32 * seededUnit(seed + 3) : 0;
      const depth = (seededUnit(seed + 4) - 0.5) * 0.42;
      const radius = (0.026 + seededUnit(seed + 5) * 0.052) * impactScale;
      const angle = direction * (0.25 + seededUnit(seed + 6) * 0.65);
      return {
        angle,
        color: CRIMSON[index % CRIMSON.length],
        delay: seededUnit(seed + 7) * 0.08,
        radius,
        stretch: 1.2 + seededUnit(seed + 8) * 2.8,
        velocity: [direction * outward + backSpray, lift, depth],
      };
    }),
  };
}
