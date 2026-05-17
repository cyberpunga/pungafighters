import { describe, expect, it } from "vitest";
import type { BattleConfig } from "../../types/game";
import { createBattleState, stepBattleFrame } from "../simulation/battle";
import { createEmptyActions } from "./actions";
import { createCpuActions } from "./cpu";

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

describe("CPU input", () => {
  it("moves toward the opponent while out of range", () => {
    const state = createBattleState(config, fighters);
    state.status = "running";

    expect(createCpuActions(state, "p1")).toMatchObject({ right: true, left: false });
    expect(createCpuActions(state, "p2")).toMatchObject({ left: true, right: false });
  });

  it("blocks nearby active attacks", () => {
    let state = createBattleState(config, fighters);
    state = { ...state, status: "running", countdown: 0 };
    state.fighters.p1 = { ...state.fighters.p1, x: 340, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 390, y: state.groundY };
    state = stepBattleFrame(state, {
      p1: createEmptyActions(),
      p2: { ...createEmptyActions(), punch: true },
    });

    expect(createCpuActions(state, "p1").block).toBe(true);
  });

  it("is deterministic for the same state", () => {
    const state = createBattleState(config, fighters);
    state.status = "running";
    state.frame = 64;
    state.fighters.p1 = { ...state.fighters.p1, x: 320, y: state.groundY };
    state.fighters.p2 = { ...state.fighters.p2, x: 430, y: state.groundY };

    expect(createCpuActions(state, "p1")).toEqual(createCpuActions(state, "p1"));
  });
});
