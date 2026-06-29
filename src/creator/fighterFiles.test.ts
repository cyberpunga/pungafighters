import { describe, expect, it } from "vitest";
import type { FighterProfile, LoadedFighter } from "../types/game";
import { FIGHTER_POSES } from "../types/game";
import { createFighterExportBlob, readFighterCharacterFile } from "./fighterFiles";

const FRAME_DATA_URL = "data:image/png;base64,AAECAwQFBgcICQ==";

describe("fighter files", () => {
  it("round-trips optional collision metadata in character exports", async () => {
    const exportBlob = await createFighterExportBlob(createLoadedFighter());
    const parsed = JSON.parse(await exportBlob.text());

    expect(parsed.fighter.frames.punch.collision.attackBoxes[0]).toMatchObject({ x: 240, y: 124, width: 60, height: 42 });

    const imported = await readFighterCharacterFile(new File([exportBlob], "fighter.pungafighter.json", { type: "application/json" }));
    expect(imported.frameBlobs.punch.size).toBeGreaterThan(0);
    expect(imported.frameCollisions?.punch?.attackBoxes?.[0]).toMatchObject({ x: 240, y: 124, width: 60, height: 42 });
  });
});

function createLoadedFighter(): LoadedFighter {
  const frameUrls = Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, FRAME_DATA_URL])) as LoadedFighter["frameUrls"];
  const frames = Object.fromEntries(
    FIGHTER_POSES.map((pose) => [
      pose,
      {
        pose,
        dataUrl: frameUrls[pose],
        anchor: { x: 0.5, y: 0.9 },
        width: 384,
        height: 384,
        collision: {
          source: "alpha-v1",
          hurtboxes: [{ x: 140, y: 92, width: 110, height: 196 }],
          attackBoxes: pose === "punch" ? [{ x: 240, y: 124, width: 60, height: 42 }] : undefined,
        },
      },
    ]),
  ) as FighterProfile["frames"];

  return {
    id: "export-test",
    name: "Export Test",
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    frames,
    frameUrls,
    voiceClips: {},
    voiceUrls: {},
    movesetId: "basic-v1",
  };
}
