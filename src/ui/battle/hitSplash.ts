import { getBattleDebugBoxes, type BattleDebugBox, type BattleState } from "../../game/simulation/battle";
import { STAGE_JUMP_SCALE } from "./constants";
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
  const impact = getHitImpactPoint(state, hit.attacker, hit.defender);
  const origin: [number, number, number] = [
    mapBattleX(impact.x, state.arenaWidth) + direction * 0.08,
    Math.max(0.42, (state.groundY - impact.y) / STAGE_JUMP_SCALE),
    mapBattleZ(impact.z, state.arenaDepth) + 0.2,
  ];
  const impactScale = Math.min(1.9, 1.05 + hit.damage / 14);

  return {
    id: `hit-splash-${hit.at}`,
    direction,
    origin,
    droplets: Array.from({ length: 34 }, (_, index) => {
      const seed = hit.at * 61 + index * 19;
      const lift = 0.54 + seededUnit(seed + 1) * 1.8;
      const outward = (0.55 + seededUnit(seed + 2) * 1.65) * impactScale;
      const backSpray = index % 5 === 0 ? -0.42 * seededUnit(seed + 3) : 0;
      const depth = (seededUnit(seed + 4) - 0.5) * 0.58;
      const radius = (0.032 + seededUnit(seed + 5) * 0.068) * impactScale;
      const angle = direction * (0.18 + seededUnit(seed + 6) * 0.82);
      return {
        angle,
        color: CRIMSON[index % CRIMSON.length],
        delay: seededUnit(seed + 7) * 0.045,
        radius,
        stretch: 1.65 + seededUnit(seed + 8) * 3.8,
        velocity: [direction * outward + backSpray, lift, depth],
      };
    }),
  };
}

function getHitImpactPoint(state: BattleState, attackerSlot: "p1" | "p2", defenderSlot: "p1" | "p2") {
  const boxes = getBattleDebugBoxes(state);
  const attackBoxes = boxes.filter((box) => box.slot === attackerSlot && box.kind === "attack");
  const hurtboxes = boxes.filter((box) => box.slot === defenderSlot && box.kind === "hurtbox");
  const overlap = findLargestOverlap(attackBoxes, hurtboxes);
  const defender = state.fighters[defenderSlot];
  if (!overlap) {
    const direction = defender.x >= state.fighters[attackerSlot].x ? 1 : -1;
    return {
      x: defender.x - direction * 58,
      y: defender.y - 88,
      z: defender.z,
    };
  }
  return {
    x: (overlap.left + overlap.right) / 2,
    y: (overlap.top + overlap.bottom) / 2,
    z: defender.z,
  };
}

function findLargestOverlap(attackBoxes: BattleDebugBox[], hurtboxes: BattleDebugBox[]) {
  let best: { left: number; right: number; top: number; bottom: number; area: number } | undefined;
  attackBoxes.forEach((attackBox) => {
    hurtboxes.forEach((hurtbox) => {
      const left = Math.max(attackBox.left, hurtbox.left);
      const right = Math.min(attackBox.right, hurtbox.right);
      const top = Math.max(attackBox.top, hurtbox.top);
      const bottom = Math.min(attackBox.bottom, hurtbox.bottom);
      const area = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (area > 0 && (!best || area > best.area)) {
        best = { left, right, top, bottom, area };
      }
    });
  });
  return best;
}
