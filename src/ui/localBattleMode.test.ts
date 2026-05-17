import { describe, expect, it } from "vitest";
import { getLocalPlayerControls } from "./localBattleMode";

describe("local battle mode", () => {
  it("maps 1 vs 2 to two human players", () => {
    expect(getLocalPlayerControls("p1-vs-p2")).toEqual({ p1: "human", p2: "human" });
  });

  it("maps 1 vs CPU to a CPU second player", () => {
    expect(getLocalPlayerControls("p1-vs-cpu")).toEqual({ p1: "human", p2: "cpu" });
  });

  it("maps CPU vs CPU to two CPU players", () => {
    expect(getLocalPlayerControls("cpu-vs-cpu")).toEqual({ p1: "cpu", p2: "cpu" });
  });
});
