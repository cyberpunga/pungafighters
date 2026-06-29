import type { ActionSnapshot, PlayerSlot } from "../../types/game";
import { SUPER_HITS_REQUIRED, type BattleState, type FighterRuntime } from "../simulation/battle";
import { createEmptyActions } from "./actions";

const APPROACH_DISTANCE = 222;
const RETREAT_DISTANCE = 128;
const BLOCK_DISTANCE = 268;
const PUNCH_DISTANCE = 240;
const KICK_DISTANCE = 270;
const SPECIAL_DISTANCE = 300;

export function createCpuActions(state: BattleState, slot: PlayerSlot): ActionSnapshot {
  const actions = createEmptyActions();
  if (state.status !== "running" || state.superFreeze) {
    return actions;
  }

  const fighter = state.fighters[slot];
  const opponentSlot = getOpponentSlot(slot);
  const opponent = state.fighters[opponentSlot];
  if (fighter.hitStun > 0) {
    return actions;
  }

  const distance = Math.abs(opponent.x - fighter.x);
  const offsetFrame = state.frame + (slot === "p1" ? 0 : 31);
  const toward = getHorizontalAction(fighter, opponent, "toward");
  const away = getHorizontalAction(fighter, opponent, "away");

  if (isThreatenedBy(opponent, distance)) {
    actions.block = true;
    if (distance < BLOCK_DISTANCE * 0.55 && offsetFrame % 90 < 26) {
      actions[away] = true;
    }
    return actions;
  }

  if (!fighter.attack) {
    if (distance > APPROACH_DISTANCE) {
      actions[toward] = true;
    } else if (distance < RETREAT_DISTANCE && offsetFrame % 70 < 18) {
      actions[away] = true;
    }
  }

  if (!fighter.attack && fighter.cooldown <= 0) {
    const cycle = offsetFrame % 96;
    if (distance < PUNCH_DISTANCE && cycle < 12) {
      actions.punch = true;
    } else if (distance < KICK_DISTANCE && cycle >= 28 && cycle < 40) {
      actions.kick = true;
    } else if (fighter.superMeter >= SUPER_HITS_REQUIRED && distance < SPECIAL_DISTANCE && cycle >= 64 && cycle < 70) {
      actions.punch = true;
      actions.kick = true;
    }
  }

  if (fighter.y >= state.groundY && distance > 220 && offsetFrame % 150 === 0) {
    actions.jump = true;
  }

  return actions;
}

function getOpponentSlot(slot: PlayerSlot): PlayerSlot {
  return slot === "p1" ? "p2" : "p1";
}

function getHorizontalAction(fighter: FighterRuntime, opponent: FighterRuntime, direction: "toward" | "away"): "left" | "right" {
  const opponentOnRight = opponent.x > fighter.x;
  if (direction === "toward") {
    return opponentOnRight ? "right" : "left";
  }
  return opponentOnRight ? "left" : "right";
}

function isThreatenedBy(opponent: FighterRuntime, distance: number): boolean {
  return Boolean(opponent.attack && opponent.attackElapsed < opponent.attack.activeEnd && distance < BLOCK_DISTANCE);
}
