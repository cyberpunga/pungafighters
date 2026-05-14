import type { LoadedFighter } from "../types/game";

export function selectOnlineLocalFighter(fighters: LoadedFighter[], selectedFighterId: string): LoadedFighter | undefined {
  return fighters.find((fighter) => fighter.id === selectedFighterId) ?? fighters[0];
}
