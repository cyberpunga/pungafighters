import type { FighterPose, FighterSpriteId } from "../types/game";
import { FIGHTER_POSES, FIGHTER_SPRITES } from "../types/game";
import { canvasToPngBlob, decodeImageBlob, NORMALIZED_FRAME_SIZE, type DecodedImage } from "./imageProcessing";

type PoseBlobRecord = Record<FighterPose, Blob>;
type SpriteBlobRecord = Partial<Record<FighterSpriteId, Blob>>;

interface SpriteTransform {
  pose: FighterPose;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  offsetX?: number;
  offsetY?: number;
}

const SPRITE_TRANSFORMS = {
  idle1: { pose: "idle" },
  idle2: { pose: "idle", scaleX: 1.015, scaleY: 0.985, offsetY: 4 },
  walk1: { pose: "idle", rotation: 0.055, scaleX: 0.99, scaleY: 1.02, offsetX: -10, offsetY: -2 },
  walk2: { pose: "idle", rotation: -0.04, scaleX: 1.02, scaleY: 0.985, offsetX: 5, offsetY: 3 },
  walk3: { pose: "idle", rotation: -0.055, scaleX: 0.99, scaleY: 1.02, offsetX: 10, offsetY: -2 },
  walk4: { pose: "idle", rotation: 0.04, scaleX: 1.02, scaleY: 0.985, offsetX: -5, offsetY: 3 },
  punchWindup: { pose: "punch", rotation: -0.08, scaleX: 0.965, scaleY: 1.01, offsetX: -12 },
  punchStrike: { pose: "punch", rotation: 0.035, scaleX: 1.025, scaleY: 0.995, offsetX: 8 },
  kickWindup: { pose: "kick", rotation: 0.08, scaleX: 0.98, scaleY: 1.015, offsetX: -9 },
  kickStrike: { pose: "kick", rotation: -0.035, scaleX: 1.025, scaleY: 0.995, offsetX: 8 },
  hit: { pose: "hit" },
  victory1: { pose: "victory" },
  victory2: { pose: "victory", rotation: -0.045, scaleX: 1.02, scaleY: 0.985, offsetY: -6 },
} as const satisfies Record<FighterSpriteId, SpriteTransform>;

export async function synthesizeMissingSpriteBlobs(
  frameBlobs: PoseBlobRecord,
  spriteBlobs: SpriteBlobRecord | undefined,
): Promise<SpriteBlobRecord | undefined> {
  const existing = spriteBlobs ?? {};
  const missingSprites = FIGHTER_SPRITES.filter((spriteId) => !existing[spriteId]);
  if (!missingSprites.length) {
    return spriteBlobs;
  }

  const sources = await loadPoseSources(frameBlobs);
  try {
    const generatedPairs = await Promise.all(
      missingSprites.map(async (spriteId) => {
        const transform = SPRITE_TRANSFORMS[spriteId];
        const canvas = drawSpriteVariant(sources[transform.pose].source, transform);
        return [spriteId, await canvasToPngBlob(canvas)] as const;
      }),
    );
    return { ...Object.fromEntries(generatedPairs), ...existing } as SpriteBlobRecord;
  } finally {
    FIGHTER_POSES.forEach((pose) => sources[pose].close());
  }
}

async function loadPoseSources(frameBlobs: PoseBlobRecord) {
  const entries = await Promise.all(
    FIGHTER_POSES.map(async (pose) => {
      const decoded = await decodeImageBlob(frameBlobs[pose]);
      return [pose, decoded] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<FighterPose, DecodedImage>;
}

function drawSpriteVariant(source: CanvasImageSource, transform: SpriteTransform) {
  const canvas = document.createElement("canvas");
  canvas.width = NORMALIZED_FRAME_SIZE;
  canvas.height = NORMALIZED_FRAME_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }

  const size = NORMALIZED_FRAME_SIZE;
  const anchorY = size * 0.9;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(size / 2 + (transform.offsetX ?? 0), anchorY + (transform.offsetY ?? 0));
  ctx.rotate(transform.rotation ?? 0);
  ctx.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
  ctx.drawImage(source, -size / 2, -anchorY, size, size);
  return canvas;
}
