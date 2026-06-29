import { describe, expect, it } from "vitest";
import type { BattleConfig, PlayerInputSnapshot } from "../../types/game";
import { createEmptyActions } from "../input/actions";
import { createBattleState, getBattleChecksum, stepBattleFrame, SUPER_HITS_REQUIRED, type BattleState } from "./battle";

const config: BattleConfig = {
  playerOneFighterId: "p1",
  playerTwoFighterId: "p2",
  roundCount: 3,
  timerSeconds: 60,
  stageId: "dojo-v1",
};

const fighters = {
  p1: { id: "p1", name: "One" },
  p2: { id: "p2", name: "Two" },
};

describe("battle simulation", () => {
  it("uses a widened arena with start positions derived from the original spacing", () => {
    const state = createBattleState(config, fighters);

    expect(state.arenaWidth).toBe(1200);
    expect(state.fighters.p1.x).toBeCloseTo(312.5);
    expect(state.fighters.p2.x).toBeCloseTo(887.5);
  });

  it("advances one deterministic frame at a time", () => {
    const state = createBattleState(config, fighters);
    const next = stepBattleFrame(state, emptyInputs());

    expect(state.frame).toBe(0);
    expect(state.message).toEqual({ type: "ready" });
    expect(next.frame).toBe(1);
    expect(getBattleChecksum(next)).toBe(getBattleChecksum(stepBattleFrame(state, emptyInputs())));
  });

  it("clamps fighters to deterministic widened arena edges", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 78, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 1122, y: state.groundY };

    state = stepBattleFrame(state, {
      p1: { ...createEmptyActions(), left: true },
      p2: { ...createEmptyActions(), right: true },
    });

    expect(state.fighters.p1.x).toBe(80);
    expect(state.fighters.p2.x).toBe(1120);
  });

  it("keeps fighters from walking through each other", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 560, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 640, y: state.groundY };

    for (let frame = 0; frame < 40; frame += 1) {
      state = stepBattleFrame(state, {
        p1: { ...createEmptyActions(), right: true },
        p2: { ...createEmptyActions(), left: true },
      });
    }

    expect(state.fighters.p1.x).toBeLessThan(state.fighters.p2.x);
    expect(state.fighters.p2.x - state.fighters.p1.x).toBeGreaterThanOrEqual(228);
    expect(state.fighters.p1.facing).toBe(1);
    expect(state.fighters.p2.facing).toBe(-1);
  });

  it("keeps body collision inside arena edges", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 86, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 104, y: state.groundY };

    state = stepBattleFrame(state, {
      p1: { ...createEmptyActions(), left: true },
      p2: { ...createEmptyActions(), left: true },
    });

    expect(state.fighters.p1.x).toBe(80);
    expect(state.fighters.p2.x).toBeGreaterThan(state.fighters.p1.x);
    expect(state.fighters.p2.x - state.fighters.p1.x).toBeGreaterThanOrEqual(228);
  });

  it("lets a punch connect from the body collision boundary", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 320, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 550, y: state.groundY };

    for (let frame = 0; frame < 20 && !state.lastHit; frame += 1) {
      state = stepBattleFrame(state, {
        p1: { ...createEmptyActions(), punch: frame === 0 },
        p2: createEmptyActions(),
      });
    }

    expect(state.lastHit).toMatchObject({ attacker: "p1", defender: "p2", damage: 8 });
  });

  it("resets new rounds to the widened arena start positions", () => {
    let state = createBattleState(config, fighters);
    state = {
      ...state,
      countdown: 0,
      round: 1,
      roundWinner: "p1",
      status: "roundOver",
      winner: undefined,
    };
    state.fighters.p1 = { ...state.fighters.p1, x: 80, roundsWon: 1 };
    state.fighters.p2 = { ...state.fighters.p2, x: 1120 };

    state = stepBattleFrame(state, emptyInputs());

    expect(state.round).toBe(2);
    expect(state.fighters.p1.x).toBeCloseTo(312.5);
    expect(state.fighters.p2.x).toBeCloseTo(887.5);
    expect(state.fighters.p1.roundsWon).toBe(1);
  });

  it("keeps frame-based hit events deterministic", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 320, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 380, y: state.groundY };

    for (let frame = 0; frame < 20 && !state.lastHit; frame += 1) {
      state = stepBattleFrame(state, {
        p1: { ...createEmptyActions(), punch: frame === 0 },
        p2: createEmptyActions(),
      });
    }

    expect(state.lastHit).toMatchObject({ attacker: "p1", defender: "p2", damage: 8 });
    expect(state.lastHit?.at).toBeGreaterThanOrEqual(0);
    expect(state.lastHit?.at).toBeLessThan(state.frame);
  });

  it("fills the super meter after five delivered hits", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 320, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 380, y: state.groundY };

    for (let hitCount = 1; hitCount <= SUPER_HITS_REQUIRED; hitCount += 1) {
      state = landPunch(state);
      expect(state.fighters.p1.superMeter).toBe(hitCount);
      state = waitUntilReady(state, "p1");
    }

    expect(state.fighters.p1.superMeter).toBe(SUPER_HITS_REQUIRED);
  });

  it("freezes the simulation when a charged punch-and-kick super starts before the active attack advances", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, superMeter: SUPER_HITS_REQUIRED };

    state = stepBattleFrame(state, {
      p1: { ...createEmptyActions(), punch: true, kick: true },
      p2: createEmptyActions(),
    });
    const attackElapsedAtFreezeStart = state.fighters.p1.attackElapsed;
    const timerAtFreezeStart = state.timer;

    expect(state.lastSuper).toMatchObject({ attacker: "p1", at: 0 });
    expect(state.superFreeze?.attacker).toBe("p1");
    expect(state.fighters.p1.attack?.kind).toBe("special");
    expect(state.fighters.p1.superMeter).toBe(0);

    state = stepBattleFrame(state, emptyInputs());

    expect(state.fighters.p1.attackElapsed).toBe(attackElapsedAtFreezeStart);
    expect(state.timer).toBe(timerAtFreezeStart);
    expect(state.superFreeze?.remainingFrames).toBeGreaterThan(0);
  });

  it("applies a charged super as four deterministic light hits", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 320, y: state.groundY, superMeter: SUPER_HITS_REQUIRED };
    state.fighters.p2 = { ...state.fighters.p2, x: 380, y: state.groundY };

    state = stepBattleFrame(state, {
      p1: { ...createEmptyActions(), punch: true, kick: true },
      p2: createEmptyActions(),
    });

    let previousHitAt = state.lastHit?.at ?? -1;
    const hitFrames: number[] = [];
    for (let frame = 0; frame < 140; frame += 1) {
      state = stepBattleFrame(state, emptyInputs());
      if (state.lastHit?.attacker === "p1" && state.lastHit.at !== previousHitAt) {
        hitFrames.push(state.lastHit.at);
        previousHitAt = state.lastHit.at;
        expect(state.lastHit.damage).toBe(5);
      }
    }

    expect(hitFrames).toHaveLength(4);
    expect(state.fighters.p2.health).toBe(80);
    expect(state.fighters.p1.superMeter).toBe(Math.min(4, SUPER_HITS_REQUIRED));
  });

  it("gates punch-and-kick super by the configured meter threshold", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };

    state = stepBattleFrame(state, {
      p1: { ...createEmptyActions(), punch: true, kick: true },
      p2: createEmptyActions(),
    });

    if (SUPER_HITS_REQUIRED <= 0) {
      expect(state.fighters.p1.attack?.kind).toBe("special");
      expect(state.lastSuper).toMatchObject({ attacker: "p1" });
    } else {
      expect(state.fighters.p1.attack).toBeUndefined();
      expect(state.lastSuper).toBeUndefined();
    }
  });

  it("does not hit through transparent fighter padding", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 320, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 610, y: state.groundY };

    for (let frame = 0; frame < 20 && !state.lastHit; frame += 1) {
      state = stepBattleFrame(state, {
        p1: { ...createEmptyActions(), punch: frame === 0 },
        p2: createEmptyActions(),
      });
    }

    expect(state.lastHit).toBeUndefined();
    expect(state.fighters.p2.health).toBe(100);
  });

  it("requires vertical overlap with the active attack box", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 320, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 390, y: state.groundY - 150 };

    state = stepBattleFrame(state, {
      p1: { ...createEmptyActions(), punch: true },
      p2: createEmptyActions(),
    });
    state.fighters.p1 = { ...state.fighters.p1, attackElapsed: 0.1 };
    state.fighters.p2 = { ...state.fighters.p2, y: state.groundY - 150, velocityY: 0 };
    state = stepBattleFrame(state, emptyInputs());

    expect(state.lastHit).toBeUndefined();
    expect(state.fighters.p2.health).toBe(100);
  });
});

function emptyInputs(): PlayerInputSnapshot {
  return { p1: createEmptyActions(), p2: createEmptyActions() };
}

function landPunch(state: BattleState): BattleState {
  const previousHitAt = state.lastHit?.at ?? -1;
  let next = state;
  for (let frame = 0; frame < 30; frame += 1) {
    next = stepBattleFrame(next, {
      p1: { ...createEmptyActions(), punch: frame === 0 },
      p2: createEmptyActions(),
    });
    if (next.lastHit?.at !== undefined && next.lastHit.at !== previousHitAt) {
      return next;
    }
  }
  throw new Error("Expected punch to land.");
}

function waitUntilReady(state: BattleState, slot: "p1" | "p2"): BattleState {
  let next = state;
  for (let frame = 0; frame < 60; frame += 1) {
    if (!next.fighters[slot].attack && next.fighters[slot].cooldown <= 0) {
      return next;
    }
    next = stepBattleFrame(next, emptyInputs());
  }
  throw new Error("Expected fighter to recover.");
}
