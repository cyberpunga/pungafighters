import { describe, expect, it } from "vitest";
import type { BattleConfig, PlayerInputSnapshot } from "../../types/game";
import { createEmptyActions } from "../input/actions";
import { createBattleState, getBattleChecksum, stepBattleFrame } from "./battle";

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
  it("advances one deterministic frame at a time", () => {
    const state = createBattleState(config, fighters);
    const next = stepBattleFrame(state, emptyInputs());

    expect(state.frame).toBe(0);
    expect(next.frame).toBe(1);
    expect(getBattleChecksum(next)).toBe(getBattleChecksum(stepBattleFrame(state, emptyInputs())));
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
});

function emptyInputs(): PlayerInputSnapshot {
  return { p1: createEmptyActions(), p2: createEmptyActions() };
}
