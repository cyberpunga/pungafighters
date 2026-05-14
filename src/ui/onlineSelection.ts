import type { LoadedFighter } from "../types/game";

export interface SelectedFighterIds {
  p1: string;
  p2: string;
}

export function selectOnlineLocalFighter(fighters: LoadedFighter[], selected: SelectedFighterIds): LoadedFighter | undefined {
  return fighters.find((fighter) => fighter.id === selected.p1) ?? fighters[0];
}
