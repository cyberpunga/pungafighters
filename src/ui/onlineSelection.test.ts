import { describe, expect, it } from "vitest";
import type { FighterProfile, LoadedFighter } from "../types/game";
import { FIGHTER_POSES } from "../types/game";
import { selectOnlineLocalFighter } from "./onlineSelection";

describe("online fighter selection", () => {
  it("uses the local Player 1 selection for online matches", () => {
    const hostOrGuestFighter = createFighter("custom-local", "Custom Local");
    const fighters = [createFighter("default-p1", "Default P1"), createFighter("default-p2", "Default P2"), hostOrGuestFighter];

    expect(selectOnlineLocalFighter(fighters, { p1: "custom-local", p2: "default-p2" })).toBe(hostOrGuestFighter);
  });

  it("sends an imported fighter selected into Player 1 instead of the Player 2 slot", () => {
    const importedFighter = createFighter("imported-guest", "Imported Guest");
    const playerTwoSlotFighter = createFighter("default-p2", "Default P2");
    const fighters = [createFighter("default-p1", "Default P1"), playerTwoSlotFighter, importedFighter];

    expect(selectOnlineLocalFighter(fighters, { p1: "imported-guest", p2: "default-p2" })).toBe(importedFighter);
    expect(selectOnlineLocalFighter(fighters, { p1: "imported-guest", p2: "default-p2" })).not.toBe(playerTwoSlotFighter);
  });

  it("falls back to the first loaded fighter when the Player 1 selection is missing", () => {
    const fallback = createFighter("default-p1", "Default P1");
    const fighters = [fallback, createFighter("default-p2", "Default P2")];

    expect(selectOnlineLocalFighter(fighters, { p1: "deleted-fighter", p2: "default-p2" })).toBe(fallback);
  });
});

function createFighter(id: string, name: string): LoadedFighter {
  const frameUrls = Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, `data:image/png;base64,${pose}`])) as LoadedFighter["frameUrls"];
  const frames = Object.fromEntries(
    FIGHTER_POSES.map((pose) => [
      pose,
      {
        pose,
        dataUrl: frameUrls[pose],
        anchor: { x: 0.5, y: 0.9 },
        width: 384,
        height: 384,
      },
    ]),
  ) as FighterProfile["frames"];

  return {
    id,
    name,
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    frames,
    frameUrls,
    voiceClips: {},
    voiceUrls: {},
    movesetId: "basic-v1",
  };
}
