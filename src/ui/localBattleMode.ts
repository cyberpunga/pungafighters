import type { LocalBattleMode, PlayerControls } from "../types/game";

export const DEFAULT_LOCAL_BATTLE_MODE: LocalBattleMode = "p1-vs-p2";

export function getLocalPlayerControls(mode: LocalBattleMode): PlayerControls {
  switch (mode) {
    case "p1-vs-cpu":
      return { p1: "human", p2: "cpu" };
    case "cpu-vs-cpu":
      return { p1: "cpu", p2: "cpu" };
    case "p1-vs-p2":
    default:
      return { p1: "human", p2: "human" };
  }
}
