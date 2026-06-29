import type { BattleConfig, CollisionBox, FighterFrame, FighterPose, PlayerInputSnapshot, PlayerSlot } from "../../types/game";
import { createEmptyActions } from "../input/actions";

const BASE_ARENA_WIDTH = 960;
const ARENA_WIDTH = 1800;
const ARENA_DEPTH = 420;
const GROUND_Y = 430;
const MOVE_SPEED = 315;
const DEPTH_MOVE_SPEED = 230;
const JUMP_SPEED = -710;
const GRAVITY = 2050;
const ARENA_EDGE_PADDING = 80;
const ARENA_DEPTH_PADDING = 44;
const P1_START_X = (ARENA_WIDTH * 250) / BASE_ARENA_WIDTH;
const P2_START_X = (ARENA_WIDTH * 710) / BASE_ARENA_WIDTH;
const START_Z = ARENA_DEPTH / 2;

const HURTBOX = {
  halfWidth: 78,
  height: 138,
  bottomOffset: 10,
} as const;
const FIGHTER_BODY_SEPARATION = 230;
const ATTACK_DEPTH_REACH = 115;
const COLLISION_PIXEL_TO_BATTLE = 0.86;

export const BATTLE_TICK_RATE = 60;
export const BATTLE_TICK_SECONDS = 1 / BATTLE_TICK_RATE;
export const SUPER_HITS_REQUIRED = 0;
const SUPER_FREEZE_FRAMES = 42;
const MAX_SUPER_HITS = 4;
const SUPER_HIT_INTERVAL = 0.08;

type AttackKind = "punch" | "kick" | "special";

interface AttackDef {
  kind: AttackKind;
  pose: FighterPose;
  damage: number;
  hitbox: {
    reach: number;
    height: number;
    centerYOffset: number;
  };
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
    hitbox: {
      reach: 86,
      height: 74,
      centerYOffset: -94,
    },
    activeStart: 0.08,
    activeEnd: 0.18,
    duration: 0.32,
    cooldown: 0.14,
  },
  kick: {
    kind: "kick",
    pose: "kick",
    damage: 12,
    hitbox: {
      reach: 116,
      height: 78,
      centerYOffset: -72,
    },
    activeStart: 0.11,
    activeEnd: 0.24,
    duration: 0.42,
    cooldown: 0.2,
  },
  special: {
    kind: "special",
    pose: "punch",
    damage: 5,
    hitbox: {
      reach: 144,
      height: 106,
      centerYOffset: -96,
    },
    activeStart: 0.16,
    activeEnd: 0.46,
    duration: 0.72,
    cooldown: 0.45,
  },
};

export interface FighterRuntime {
  slot: PlayerSlot;
  id: string;
  name: string;
  x: number;
  z: number;
  y: number;
  velocityY: number;
  facing: 1 | -1;
  health: number;
  superMeter: number;
  roundsWon: number;
  pose: FighterPose;
  blocking: boolean;
  attack?: AttackDef;
  attackElapsed: number;
  cooldown: number;
  hasHitThisAttack: boolean;
  superHitsDelivered: number;
  hitStun: number;
  frames?: FighterCollisionFrames;
}

export interface SuperFreezeState {
  attacker: PlayerSlot;
  remainingFrames: number;
  startedAt: number;
}

export type BattleMessage =
  | { type: "ready" }
  | { type: "fight" }
  | { type: "match-winner"; winner: PlayerSlot }
  | { type: "round-winner"; winner: PlayerSlot };

export interface BattleState {
  frame: number;
  status: "countdown" | "running" | "roundOver" | "matchOver";
  arenaWidth: number;
  arenaDepth: number;
  groundY: number;
  config: BattleConfig;
  fighters: Record<PlayerSlot, FighterRuntime>;
  round: number;
  timer: number;
  countdown: number;
  winner?: PlayerSlot;
  roundWinner?: PlayerSlot;
  message?: BattleMessage;
  lastHit?: { attacker: PlayerSlot; defender: PlayerSlot; damage: number; at: number };
  lastSuper?: { attacker: PlayerSlot; at: number };
  superFreeze?: SuperFreezeState;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type FighterCollisionFrame = Pick<FighterFrame, "anchor" | "width" | "height" | "collision">;
type FighterCollisionFrames = Record<FighterPose, FighterCollisionFrame>;

export interface BattleDebugBox extends Box {
  slot: PlayerSlot;
  kind: "hurtbox" | "attack";
}

export function createBattleState(
  config: BattleConfig,
  fighters: Record<PlayerSlot, { id: string; name: string; frames?: FighterCollisionFrames }>,
): BattleState {
  return {
    frame: 0,
    status: "countdown",
    arenaWidth: ARENA_WIDTH,
    arenaDepth: ARENA_DEPTH,
    groundY: GROUND_Y,
    config,
    round: 1,
    timer: config.timerSeconds,
    countdown: 2,
    message: { type: "ready" },
    fighters: {
      p1: createRuntime("p1", fighters.p1, P1_START_X, 1),
      p2: createRuntime("p2", fighters.p2, P2_START_X, -1),
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
    next.message = next.countdown > 0.7 ? { type: "ready" } : { type: "fight" };
    if (next.countdown <= 0) {
      next.status = "running";
      next.message = undefined;
    }
    return advanceFrame(next);
  }

  if (next.status === "roundOver") {
    next.countdown -= dt;
    if (next.countdown <= 0) {
      if (next.winner) {
        next.status = "matchOver";
        next.message = { type: "match-winner", winner: next.winner };
      } else {
        resetRound(next);
      }
    }
    return advanceFrame(next);
  }

  if (next.status !== "running") {
    return advanceFrame(next);
  }

  if (next.superFreeze) {
    next.superFreeze.remainingFrames -= 1;
    if (next.superFreeze.remainingFrames <= 0) {
      next.superFreeze = undefined;
    }
    return advanceFrame(next);
  }

  next.timer = Math.max(0, next.timer - dt);
  const p1Attack = updateFighter(next.fighters.p1, next.fighters.p2, inputs.p1 ?? createEmptyActions(), dt);
  const p2Attack = updateFighter(next.fighters.p2, next.fighters.p1, inputs.p2 ?? createEmptyActions(), dt);
  resolveFighterBodyCollision(next);
  faceFighters(next);
  if (p1Attack === "special") {
    startSuperFreeze(next, "p1");
  } else if (p2Attack === "special") {
    startSuperFreeze(next, "p2");
  }
  resolveAttack(next, "p1", "p2");
  resolveAttack(next, "p2", "p1");

  if (next.fighters.p1.health <= 0 || next.fighters.p2.health <= 0 || next.timer <= 0) {
    finishRound(next);
  }

  return advanceFrame(next);
}

export function restartMatch(state: BattleState): BattleState {
  return createBattleState(state.config, {
    p1: { id: state.fighters.p1.id, name: state.fighters.p1.name, frames: state.fighters.p1.frames },
    p2: { id: state.fighters.p2.id, name: state.fighters.p2.name, frames: state.fighters.p2.frames },
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
    state.lastSuper ? `${state.lastSuper.attacker}:${state.lastSuper.at}` : "",
    state.superFreeze ? `${state.superFreeze.attacker}:${state.superFreeze.remainingFrames}:${state.superFreeze.startedAt}` : "",
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
  fighter: { id: string; name: string; frames?: FighterCollisionFrames },
  x: number,
  facing: 1 | -1,
): FighterRuntime {
  return {
    slot,
    id: fighter.id,
    name: fighter.name,
    x,
    z: START_Z,
    y: GROUND_Y,
    velocityY: 0,
    facing,
    health: 100,
    superMeter: 0,
    roundsWon: 0,
    pose: "idle",
    blocking: false,
    attackElapsed: 0,
    cooldown: 0,
    hasHitThisAttack: false,
    superHitsDelivered: 0,
    hitStun: 0,
    frames: fighter.frames,
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
    lastSuper: state.lastSuper && { ...state.lastSuper },
    superFreeze: state.superFreeze && { ...state.superFreeze },
  };
}

function updateFighter(
  fighter: FighterRuntime,
  opponent: FighterRuntime,
  input: ReturnType<typeof createEmptyActions>,
  dt: number,
): AttackKind | undefined {
  let startedAttack: AttackKind | undefined;

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
      fighter.superHitsDelivered = 0;
    }
  } else if (fighter.hitStun > 0) {
    fighter.pose = "hit";
  } else {
    const requestedAttack = getRequestedAttack(fighter, input);
    if (requestedAttack && fighter.cooldown <= 0) {
      fighter.attack = requestedAttack;
      fighter.attackElapsed = 0;
      fighter.cooldown = requestedAttack.duration + requestedAttack.cooldown;
      fighter.hasHitThisAttack = false;
      fighter.pose = requestedAttack.pose;
      startedAttack = requestedAttack.kind;
      if (requestedAttack.kind === "special") {
        fighter.superMeter = 0;
      }
    } else {
      fighter.pose = "idle";
    }
  }

  if (!fighter.attack && fighter.hitStun <= 0) {
    const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const depthMove = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    fighter.x += move * MOVE_SPEED * dt;
    fighter.z += depthMove * DEPTH_MOVE_SPEED * dt;
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
  fighter.x = clamp(fighter.x, ARENA_EDGE_PADDING, ARENA_WIDTH - ARENA_EDGE_PADDING);
  fighter.z = clamp(fighter.z, ARENA_DEPTH_PADDING, ARENA_DEPTH - ARENA_DEPTH_PADDING);

  return startedAttack;
}

function resolveAttack(state: BattleState, attackerSlot: PlayerSlot, defenderSlot: PlayerSlot) {
  const attacker = state.fighters[attackerSlot];
  const defender = state.fighters[defenderSlot];
  const attack = attacker.attack;
  if (!attack) {
    return;
  }

  const isSpecial = attack.kind === "special";
  if (!isSpecial && attacker.hasHitThisAttack) {
    return;
  }

  const depthAligned = Math.abs(attacker.z - defender.z) <= ATTACK_DEPTH_REACH;
  const active = attacker.attackElapsed >= attack.activeStart && attacker.attackElapsed <= attack.activeEnd;
  const facingDefender = attacker.facing === 1 ? defender.x >= attacker.x : defender.x <= attacker.x;

  if (depthAligned && active && facingDefender && anyBoxesOverlap(getAttackBoxes(attacker, attack), getHurtboxes(defender))) {
    if (isSpecial) {
      if (attacker.superHitsDelivered >= MAX_SUPER_HITS) {
        return;
      }
      const nextHitTime = attack.activeStart + attacker.superHitsDelivered * SUPER_HIT_INTERVAL;
      if (attacker.attackElapsed < nextHitTime) {
        return;
      }
      attacker.superHitsDelivered += 1;
      if (attacker.superHitsDelivered >= MAX_SUPER_HITS) {
        attacker.hasHitThisAttack = true;
      }
    } else {
      attacker.hasHitThisAttack = true;
    }

    const damage = defender.blocking ? Math.ceil(attack.damage * 0.35) : attack.damage;
    defender.health = Math.max(0, defender.health - damage);
    defender.hitStun = defender.blocking ? 0.08 : 0.24;
    defender.pose = "hit";
    attacker.superMeter = Math.min(SUPER_HITS_REQUIRED, attacker.superMeter + 1);
    state.lastHit = { attacker: attackerSlot, defender: defenderSlot, damage, at: state.frame };
  }
}

function resolveFighterBodyCollision(state: BattleState) {
  const p1 = state.fighters.p1;
  const p2 = state.fighters.p2;
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= FIGHTER_BODY_SEPARATION) {
    return;
  }

  const fallbackDirection = p1.x <= p2.x ? 1 : -1;
  const normalX = distance > 0.001 ? dx / distance : fallbackDirection;
  const normalZ = distance > 0.001 ? dz / distance : 0;
  const push = (FIGHTER_BODY_SEPARATION - distance) / 2;

  p1.x = clamp(p1.x - normalX * push, ARENA_EDGE_PADDING, state.arenaWidth - ARENA_EDGE_PADDING);
  p1.z = clamp(p1.z - normalZ * push, ARENA_DEPTH_PADDING, state.arenaDepth - ARENA_DEPTH_PADDING);
  p2.x = clamp(p2.x + normalX * push, ARENA_EDGE_PADDING, state.arenaWidth - ARENA_EDGE_PADDING);
  p2.z = clamp(p2.z + normalZ * push, ARENA_DEPTH_PADDING, state.arenaDepth - ARENA_DEPTH_PADDING);

  const nextDistance = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  if (nextDistance >= FIGHTER_BODY_SEPARATION - 0.001) {
    return;
  }

  const extra = FIGHTER_BODY_SEPARATION - nextDistance;
  if (p1.x <= p2.x) {
    p2.x = clamp(p2.x + extra, ARENA_EDGE_PADDING, state.arenaWidth - ARENA_EDGE_PADDING);
  } else {
    p1.x = clamp(p1.x + extra, ARENA_EDGE_PADDING, state.arenaWidth - ARENA_EDGE_PADDING);
  }
}

function faceFighters(state: BattleState) {
  state.fighters.p1.facing = 1;
  state.fighters.p2.facing = -1;
}

function getRequestedAttack(fighter: FighterRuntime, input: ReturnType<typeof createEmptyActions>): AttackDef | undefined {
  const wantsSuper = input.punch && input.kick;
  if (wantsSuper) {
    return fighter.superMeter >= SUPER_HITS_REQUIRED ? ATTACKS.special : undefined;
  }
  return input.kick ? ATTACKS.kick : input.punch ? ATTACKS.punch : undefined;
}

function getHurtboxes(fighter: FighterRuntime): Box[] {
  const frame = fighter.frames?.[fighter.pose] ?? fighter.frames?.idle;
  const boxes = frame?.collision?.hurtboxes.flatMap((box) => frameBoxToBattleBox(fighter, frame, box)) ?? [];
  return boxes.length ? boxes : [getFallbackHurtbox(fighter)];
}

function getFallbackHurtbox(fighter: FighterRuntime): Box {
  const bottom = fighter.y - HURTBOX.bottomOffset;
  return {
    left: fighter.x - HURTBOX.halfWidth,
    right: fighter.x + HURTBOX.halfWidth,
    top: bottom - HURTBOX.height,
    bottom,
  };
}

function getAttackBoxes(attacker: FighterRuntime, attack: AttackDef): Box[] {
  const frame = attacker.frames?.[getAttackCollisionPose(attack)];
  const boxes = frame?.collision?.attackBoxes?.flatMap((box) => frameBoxToBattleBox(attacker, frame, box)) ?? [];
  return boxes.length ? boxes : [getFallbackAttackBox(attacker, attack)];
}

function getFallbackAttackBox(attacker: FighterRuntime, attack: AttackDef): Box {
  const bodyEdge = attacker.x + attacker.facing * HURTBOX.halfWidth;
  const reachEdge = bodyEdge + attacker.facing * attack.hitbox.reach;
  const centerY = attacker.y + attack.hitbox.centerYOffset;
  return {
    left: Math.min(bodyEdge, reachEdge),
    right: Math.max(bodyEdge, reachEdge),
    top: centerY - attack.hitbox.height / 2,
    bottom: centerY + attack.hitbox.height / 2,
  };
}

function getAttackCollisionPose(attack: AttackDef): FighterPose {
  return attack.kind === "kick" ? "kick" : "punch";
}

function frameBoxToBattleBox(fighter: FighterRuntime, frame: FighterCollisionFrame, box: CollisionBox): Box[] {
  if (!isCollisionBox(box) || !isCollisionFrame(frame)) {
    return [];
  }
  const anchorX = frame.anchor.x * frame.width;
  const anchorY = frame.anchor.y * frame.height;
  const localCenterX = (box.x + box.width / 2 - anchorX) * COLLISION_PIXEL_TO_BATTLE;
  const localCenterY = (box.y + box.height / 2 - anchorY) * COLLISION_PIXEL_TO_BATTLE;
  const width = box.width * COLLISION_PIXEL_TO_BATTLE;
  const height = box.height * COLLISION_PIXEL_TO_BATTLE;
  const centerX = fighter.x + fighter.facing * localCenterX;
  const centerY = fighter.y + localCenterY;
  return [
    {
      left: centerX - width / 2,
      right: centerX + width / 2,
      top: centerY - height / 2,
      bottom: centerY + height / 2,
    },
  ];
}

function anyBoxesOverlap(a: Box[], b: Box[]): boolean {
  return a.some((boxA) => b.some((boxB) => boxesOverlap(boxA, boxB)));
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

export function getBattleDebugBoxes(state: BattleState): BattleDebugBox[] {
  const boxes: BattleDebugBox[] = [];
  (["p1", "p2"] as const).forEach((slot) => {
    const fighter = state.fighters[slot];
    getHurtboxes(fighter).forEach((box) => boxes.push({ ...box, slot, kind: "hurtbox" }));
    if (fighter.attack) {
      const active = fighter.attackElapsed >= fighter.attack.activeStart && fighter.attackElapsed <= fighter.attack.activeEnd;
      if (active) {
        getAttackBoxes(fighter, fighter.attack).forEach((box) => boxes.push({ ...box, slot, kind: "attack" }));
      }
    }
  });
  return boxes;
}

function finishRound(state: BattleState) {
  const p1 = state.fighters.p1;
  const p2 = state.fighters.p2;
  const roundWinner: PlayerSlot = p1.health === p2.health ? (p1.x < p2.x ? "p1" : "p2") : p1.health > p2.health ? "p1" : "p2";
  state.status = "roundOver";
  state.roundWinner = roundWinner;
  state.fighters[roundWinner].roundsWon += 1;
  state.message = { type: "round-winner", winner: roundWinner };
  state.countdown = 2.25;
  state.superFreeze = undefined;

  if (state.fighters[roundWinner].roundsWon >= Math.ceil(state.config.roundCount / 2)) {
    state.winner = roundWinner;
  }
}

function resetRound(state: BattleState) {
  const p1Wins = state.fighters.p1.roundsWon;
  const p2Wins = state.fighters.p2.roundsWon;
  const p1 = createRuntime("p1", state.fighters.p1, P1_START_X, 1);
  const p2 = createRuntime("p2", state.fighters.p2, P2_START_X, -1);
  p1.roundsWon = p1Wins;
  p2.roundsWon = p2Wins;
  state.fighters = { p1, p2 };
  state.round += 1;
  state.timer = state.config.timerSeconds;
  state.countdown = 1.6;
  state.status = "countdown";
  state.roundWinner = undefined;
  state.lastHit = undefined;
  state.lastSuper = undefined;
  state.superFreeze = undefined;
  state.message = { type: "ready" };
}

function startSuperFreeze(state: BattleState, attacker: PlayerSlot) {
  state.superFreeze = {
    attacker,
    remainingFrames: SUPER_FREEZE_FRAMES,
    startedAt: state.frame,
  };
  state.lastSuper = { attacker, at: state.frame };
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
    fixed(fighter.z),
    fixed(fighter.y),
    fixed(fighter.velocityY),
    fighter.facing,
    fighter.health,
    fighter.superMeter,
    fighter.roundsWon,
    fighter.pose,
    fighter.blocking ? 1 : 0,
    fighter.attack?.kind ?? "",
    fixed(fighter.attackElapsed),
    fixed(fighter.cooldown),
    fighter.hasHitThisAttack ? 1 : 0,
    fighter.superHitsDelivered,
    fixed(fighter.hitStun),
    collisionChecksum(fighter.frames),
  ].join(",");
}

function fixed(value: number) {
  return Math.round(value * 100) / 100;
}

function collisionChecksum(frames: FighterCollisionFrames | undefined) {
  if (!frames) {
    return "";
  }
  return (["idle", "punch", "kick", "hit", "victory"] as const)
    .map((pose) => {
      const frame = frames[pose];
      const collision = frame?.collision;
      return [
        pose,
        frame ? `${fixed(frame.anchor.x)}:${fixed(frame.anchor.y)}:${frame.width}:${frame.height}` : "",
        collision?.source ?? "",
        boxesChecksum(collision?.hurtboxes),
        boxesChecksum(collision?.attackBoxes),
      ].join("/");
    })
    .join(";");
}

function boxesChecksum(boxes: CollisionBox[] | undefined) {
  return boxes?.map((box) => `${fixed(box.x)}:${fixed(box.y)}:${fixed(box.width)}:${fixed(box.height)}`).join("+") ?? "";
}

function isCollisionFrame(frame: FighterCollisionFrame): boolean {
  return (
    frame.width > 0 &&
    frame.height > 0 &&
    Number.isFinite(frame.anchor.x) &&
    Number.isFinite(frame.anchor.y) &&
    frame.anchor.x >= 0 &&
    frame.anchor.x <= 1 &&
    frame.anchor.y >= 0 &&
    frame.anchor.y <= 1
  );
}

function isCollisionBox(box: CollisionBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0
  );
}
