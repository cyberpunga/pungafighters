import type { BattleConfig, FighterPose, PlayerInputSnapshot, PlayerSlot } from "../../types/game";
import { createEmptyActions } from "../input/actions";

const ARENA_WIDTH = 960;
const GROUND_Y = 430;
const PLAYER_WIDTH = 96;
const PLAYER_HEIGHT = 160;
const MOVE_SPEED = 250;
const JUMP_SPEED = -650;
const GRAVITY = 1800;

export const BATTLE_TICK_RATE = 60;
export const BATTLE_TICK_SECONDS = 1 / BATTLE_TICK_RATE;

type AttackKind = "punch" | "kick" | "special";

interface AttackDef {
  kind: AttackKind;
  pose: FighterPose;
  damage: number;
  reach: number;
  activeStart: number;
  activeEnd: number;
  duration: number;
  cooldown: number;
}

const ATTACKS: Record<AttackKind, AttackDef> = {
  punch: {
    kind: "punch",
    pose: "punch",
    damage: 8,
    reach: 90,
    activeStart: 0.08,
    activeEnd: 0.18,
    duration: 0.32,
    cooldown: 0.14,
  },
  kick: {
    kind: "kick",
    pose: "kick",
    damage: 12,
    reach: 115,
    activeStart: 0.11,
    activeEnd: 0.24,
    duration: 0.42,
    cooldown: 0.2,
  },
  special: {
    kind: "special",
    pose: "punch",
    damage: 18,
    reach: 145,
    activeStart: 0.16,
    activeEnd: 0.34,
    duration: 0.62,
    cooldown: 0.45,
  },
};

export interface FighterRuntime {
  slot: PlayerSlot;
  id: string;
  name: string;
  x: number;
  y: number;
  velocityY: number;
  facing: 1 | -1;
  health: number;
  roundsWon: number;
  pose: FighterPose;
  blocking: boolean;
  attack?: AttackDef;
  attackElapsed: number;
  cooldown: number;
  hasHitThisAttack: boolean;
  hitStun: number;
}

export interface BattleState {
  frame: number;
  status: "countdown" | "running" | "roundOver" | "matchOver";
  arenaWidth: number;
  groundY: number;
  config: BattleConfig;
  fighters: Record<PlayerSlot, FighterRuntime>;
  round: number;
  timer: number;
  countdown: number;
  winner?: PlayerSlot;
  roundWinner?: PlayerSlot;
  message: string;
  lastHit?: { attacker: PlayerSlot; defender: PlayerSlot; damage: number; at: number };
}

export function createBattleState(
  config: BattleConfig,
  fighters: Record<PlayerSlot, { id: string; name: string }>,
): BattleState {
  return {
    frame: 0,
    status: "countdown",
    arenaWidth: ARENA_WIDTH,
    groundY: GROUND_Y,
    config,
    round: 1,
    timer: config.timerSeconds,
    countdown: 2,
    message: "Ready",
    fighters: {
      p1: createRuntime("p1", fighters.p1, 250, 1),
      p2: createRuntime("p2", fighters.p2, 710, -1),
    },
  };
}

export function stepBattle(state: BattleState, inputs: PlayerInputSnapshot, deltaSeconds: number): BattleState {
  const frameCount = Math.max(0, Math.round(Math.min(deltaSeconds, 0.25) / BATTLE_TICK_SECONDS));
  let next = state;
  for (let frame = 0; frame < frameCount; frame += 1) {
    next = stepBattleFrame(next, inputs);
  }
  return next;
}

export function stepBattleFrame(state: BattleState, inputs: PlayerInputSnapshot): BattleState {
  const next = cloneState(state);
  const dt = BATTLE_TICK_SECONDS;

  if (next.status === "countdown") {
    next.countdown -= dt;
    next.message = next.countdown > 0.7 ? "Ready" : "Fight";
    if (next.countdown <= 0) {
      next.status = "running";
      next.message = "";
    }
    return advanceFrame(next);
  }

  if (next.status === "roundOver") {
    next.countdown -= dt;
    if (next.countdown <= 0) {
      if (next.winner) {
        next.status = "matchOver";
        next.message = `${next.fighters[next.winner].name} wins`;
      } else {
        resetRound(next);
      }
    }
    return advanceFrame(next);
  }

  if (next.status !== "running") {
    return advanceFrame(next);
  }

  next.timer = Math.max(0, next.timer - dt);
  updateFighter(next.fighters.p1, next.fighters.p2, inputs.p1 ?? createEmptyActions(), dt);
  updateFighter(next.fighters.p2, next.fighters.p1, inputs.p2 ?? createEmptyActions(), dt);
  resolveAttack(next, "p1", "p2");
  resolveAttack(next, "p2", "p1");

  if (next.fighters.p1.health <= 0 || next.fighters.p2.health <= 0 || next.timer <= 0) {
    finishRound(next);
  }

  return advanceFrame(next);
}

export function restartMatch(state: BattleState): BattleState {
  return createBattleState(state.config, {
    p1: { id: state.fighters.p1.id, name: state.fighters.p1.name },
    p2: { id: state.fighters.p2.id, name: state.fighters.p2.name },
  });
}

export function getBattleChecksum(state: BattleState): string {
  const p1 = state.fighters.p1;
  const p2 = state.fighters.p2;
  const source = [
    state.frame,
    state.status,
    state.round,
    fixed(state.timer),
    state.winner ?? "",
    state.roundWinner ?? "",
    fighterChecksum(p1),
    fighterChecksum(p2),
  ].join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createRuntime(
  slot: PlayerSlot,
  fighter: { id: string; name: string },
  x: number,
  facing: 1 | -1,
): FighterRuntime {
  return {
    slot,
    id: fighter.id,
    name: fighter.name,
    x,
    y: GROUND_Y,
    velocityY: 0,
    facing,
    health: 100,
    roundsWon: 0,
    pose: "idle",
    blocking: false,
    attackElapsed: 0,
    cooldown: 0,
    hasHitThisAttack: false,
    hitStun: 0,
  };
}

function cloneState(state: BattleState): BattleState {
  return {
    ...state,
    fighters: {
      p1: { ...state.fighters.p1, attack: state.fighters.p1.attack && { ...state.fighters.p1.attack } },
      p2: { ...state.fighters.p2, attack: state.fighters.p2.attack && { ...state.fighters.p2.attack } },
    },
    lastHit: state.lastHit && { ...state.lastHit },
  };
}

function updateFighter(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  input: ReturnType<typeof createEmptyActions>,
  dt: number,
) {
  fighter.facing = fighter.x <= opponent.x ? 1 : -1;
  fighter.cooldown = Math.max(0, fighter.cooldown - dt);
  fighter.hitStun = Math.max(0, fighter.hitStun - dt);
  fighter.blocking = input.block && fighter.hitStun <= 0 && !fighter.attack;

  if (fighter.attack) {
    fighter.attackElapsed += dt;
    fighter.pose = fighter.attack.pose;
    if (fighter.attackElapsed >= fighter.attack.duration) {
      fighter.attack = undefined;
      fighter.attackElapsed = 0;
      fighter.cooldown = 0.12;
      fighter.hasHitThisAttack = false;
    }
  } else if (fighter.hitStun > 0) {
    fighter.pose = "hit";
  } else {
    const requestedAttack = input.special ? ATTACKS.special : input.kick ? ATTACKS.kick : input.punch ? ATTACKS.punch : undefined;
    if (requestedAttack && fighter.cooldown <= 0) {
      fighter.attack = requestedAttack;
      fighter.attackElapsed = 0;
      fighter.cooldown = requestedAttack.duration + requestedAttack.cooldown;
      fighter.hasHitThisAttack = false;
      fighter.pose = requestedAttack.pose;
    } else {
      fighter.pose = "idle";
    }
  }

  if (!fighter.attack && fighter.hitStun <= 0) {
    const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    fighter.x += move * MOVE_SPEED * dt;
    if (input.jump && fighter.y >= GROUND_Y) {
      fighter.velocityY = JUMP_SPEED;
    }
  }

  fighter.velocityY += GRAVITY * dt;
  fighter.y += fighter.velocityY * dt;
  if (fighter.y >= GROUND_Y) {
    fighter.y = GROUND_Y;
    fighter.velocityY = 0;
  }
  fighter.x = clamp(fighter.x, 80, ARENA_WIDTH - 80);
}

function resolveAttack(state: BattleState, attackerSlot: PlayerSlot, defenderSlot: PlayerSlot) {
  const attacker = state.fighters[attackerSlot];
  const defender = state.fighters[defenderSlot];
  const attack = attacker.attack;
  if (!attack || attacker.hasHitThisAttack) {
    return;
  }

  const active = attacker.attackElapsed >= attack.activeStart && attacker.attackElapsed <= attack.activeEnd;
  const horizontalDistance = Math.abs(attacker.x - defender.x);
  const verticalDistance = Math.abs(attacker.y - defender.y);
  const facingDefender = attacker.facing === 1 ? defender.x >= attacker.x : defender.x <= attacker.x;

  if (active && facingDefender && horizontalDistance <= PLAYER_WIDTH + attack.reach && verticalDistance < PLAYER_HEIGHT) {
    const damage = defender.blocking ? Math.ceil(attack.damage * 0.35) : attack.damage;
    defender.health = Math.max(0, defender.health - damage);
    defender.hitStun = defender.blocking ? 0.08 : 0.24;
    defender.pose = "hit";
    attacker.hasHitThisAttack = true;
    state.lastHit = { attacker: attackerSlot, defender: defenderSlot, damage, at: state.frame };
  }
}

function finishRound(state: BattleState) {
  const p1 = state.fighters.p1;
  const p2 = state.fighters.p2;
  const roundWinner: PlayerSlot = p1.health === p2.health ? (p1.x < p2.x ? "p1" : "p2") : p1.health > p2.health ? "p1" : "p2";
  state.status = "roundOver";
  state.roundWinner = roundWinner;
  state.fighters[roundWinner].roundsWon += 1;
  state.message = `${state.fighters[roundWinner].name} takes the round`;
  state.countdown = 2.25;

  if (state.fighters[roundWinner].roundsWon >= Math.ceil(state.config.roundCount / 2)) {
    state.winner = roundWinner;
  }
}

function resetRound(state: BattleState) {
  const p1Wins = state.fighters.p1.roundsWon;
  const p2Wins = state.fighters.p2.roundsWon;
  const p1 = createRuntime("p1", state.fighters.p1, 250, 1);
  const p2 = createRuntime("p2", state.fighters.p2, 710, -1);
  p1.roundsWon = p1Wins;
  p2.roundsWon = p2Wins;
  state.fighters = { p1, p2 };
  state.round += 1;
  state.timer = state.config.timerSeconds;
  state.countdown = 1.6;
  state.status = "countdown";
  state.roundWinner = undefined;
  state.lastHit = undefined;
  state.message = "Ready";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function advanceFrame(state: BattleState): BattleState {
  state.frame += 1;
  return state;
}

function fighterChecksum(fighter: FighterRuntime) {
  return [
    fighter.slot,
    fighter.id,
    fixed(fighter.x),
    fixed(fighter.y),
    fixed(fighter.velocityY),
    fighter.facing,
    fighter.health,
    fighter.roundsWon,
    fighter.pose,
    fighter.blocking ? 1 : 0,
    fighter.attack?.kind ?? "",
    fixed(fighter.attackElapsed),
    fixed(fighter.cooldown),
    fighter.hasHitThisAttack ? 1 : 0,
    fixed(fighter.hitStun),
  ].join(",");
}

function fixed(value: number) {
  return Math.round(value * 1000) / 1000;
}
