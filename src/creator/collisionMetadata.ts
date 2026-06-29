import type { CollisionBox, FighterFrameCollision, FighterPose } from "../types/game";
import { decodeImageBlob, NORMALIZED_FRAME_SIZE } from "./imageProcessing";

const ALPHA_COLLISION_THRESHOLD = 12;
const MIN_FOREGROUND_PIXELS = 48;
const MIN_BOX_AREA = 48;
const MIN_ATTACK_AREA = 36;
const FORWARD_WINDOW_PIXELS = 70;
const BODY_PADDING_X = 8;
const BODY_PADDING_Y = 6;

export interface CollisionImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | readonly number[];
}

interface PixelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  pixels: number;
}

const FALLBACK_COLLISION: Record<FighterPose, FighterFrameCollision> = {
  idle: {
    source: "alpha-v1",
    hurtboxes: [{ x: 136, y: 92, width: 112, height: 190 }],
  },
  punch: {
    source: "alpha-v1",
    hurtboxes: [{ x: 132, y: 92, width: 118, height: 190 }],
    attackBoxes: [{ x: 238, y: 120, width: 76, height: 58 }],
  },
  kick: {
    source: "alpha-v1",
    hurtboxes: [{ x: 132, y: 92, width: 118, height: 190 }],
    attackBoxes: [{ x: 236, y: 214, width: 94, height: 54 }],
  },
  hit: {
    source: "alpha-v1",
    hurtboxes: [{ x: 122, y: 92, width: 124, height: 190 }],
  },
  victory: {
    source: "alpha-v1",
    hurtboxes: [{ x: 128, y: 72, width: 128, height: 210 }],
  },
};

export function getFallbackFrameCollision(pose: FighterPose): FighterFrameCollision {
  return cloneCollision(FALLBACK_COLLISION[pose]);
}

export async function createFrameCollisionMetadataFromBlob(blob: Blob, pose: FighterPose): Promise<FighterFrameCollision> {
  const image = await decodeImageBlob(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width || NORMALIZED_FRAME_SIZE;
    canvas.height = image.height || NORMALIZED_FRAME_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return getFallbackFrameCollision(pose);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    return createFrameCollisionMetadata(ctx.getImageData(0, 0, canvas.width, canvas.height), pose);
  } catch {
    return getFallbackFrameCollision(pose);
  } finally {
    image.close();
  }
}

export function createFrameCollisionMetadata(imageData: CollisionImageData, pose: FighterPose): FighterFrameCollision {
  const foreground = getAlphaBounds(imageData);
  if (!foreground || foreground.pixels < MIN_FOREGROUND_PIXELS) {
    return getFallbackFrameCollision(pose);
  }

  const hurtboxes = buildHurtboxes(foreground, imageData.width, imageData.height);
  const collision: FighterFrameCollision = {
    source: "alpha-v1",
    hurtboxes: hurtboxes.length ? hurtboxes : getFallbackFrameCollision(pose).hurtboxes,
  };

  const attackBoxes = buildAttackBoxes(imageData, pose, foreground);
  if (attackBoxes.length) {
    collision.attackBoxes = attackBoxes;
  } else if (pose === "punch" || pose === "kick") {
    collision.attackBoxes = getFallbackFrameCollision(pose).attackBoxes;
  }

  return collision;
}

function buildHurtboxes(bounds: PixelBounds, width: number, height: number): CollisionBox[] {
  const padded = sanitizeBox(
    {
      x: bounds.left - BODY_PADDING_X,
      y: bounds.top - BODY_PADDING_Y,
      width: bounds.right - bounds.left + 1 + BODY_PADDING_X * 2,
      height: bounds.bottom - bounds.top + 1 + BODY_PADDING_Y * 2,
    },
    width,
    height,
  );
  return padded && padded.width * padded.height >= MIN_BOX_AREA ? [padded] : [];
}

function buildAttackBoxes(imageData: CollisionImageData, pose: FighterPose, foreground: PixelBounds): CollisionBox[] {
  if (pose !== "punch" && pose !== "kick") {
    return [];
  }

  const bodyCenterX = (foreground.left + foreground.right) / 2;
  const forwardStart = Math.max(Math.floor(bodyCenterX), foreground.right - FORWARD_WINDOW_PIXELS);
  const yStart = pose === "punch" ? foreground.top : Math.floor(foreground.top + (foreground.bottom - foreground.top) * 0.55);
  const yEnd = pose === "punch" ? Math.floor(foreground.top + (foreground.bottom - foreground.top) * 0.58) : foreground.bottom;
  const attackBounds = getAlphaBounds(imageData, {
    minX: forwardStart,
    maxX: foreground.right,
    minY: yStart,
    maxY: yEnd,
  });

  if (!attackBounds || attackBounds.pixels < MIN_ATTACK_AREA || attackBounds.right <= bodyCenterX) {
    return [];
  }

  const paddingX = pose === "kick" ? 8 : 6;
  const paddingY = pose === "kick" ? 7 : 6;
  const box = sanitizeBox(
    {
      x: attackBounds.left - paddingX,
      y: attackBounds.top - paddingY,
      width: attackBounds.right - attackBounds.left + 1 + paddingX * 2,
      height: attackBounds.bottom - attackBounds.top + 1 + paddingY * 2,
    },
    imageData.width,
    imageData.height,
  );

  if (!box || box.width * box.height < MIN_ATTACK_AREA) {
    return [];
  }
  return [box];
}

function getAlphaBounds(
  imageData: CollisionImageData,
  window: { minX: number; maxX: number; minY: number; maxY: number } = {
    minX: 0,
    maxX: imageData.width - 1,
    minY: 0,
    maxY: imageData.height - 1,
  },
): PixelBounds | undefined {
  let left = imageData.width;
  let right = -1;
  let top = imageData.height;
  let bottom = -1;
  let pixels = 0;

  const minX = clamp(Math.floor(window.minX), 0, imageData.width - 1);
  const maxX = clamp(Math.ceil(window.maxX), minX, imageData.width - 1);
  const minY = clamp(Math.floor(window.minY), 0, imageData.height - 1);
  const maxY = clamp(Math.ceil(window.maxY), minY, imageData.height - 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];
      if (alpha <= ALPHA_COLLISION_THRESHOLD) {
        continue;
      }
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      pixels += 1;
    }
  }

  return right >= left && bottom >= top ? { left, right, top, bottom, pixels } : undefined;
}

function sanitizeBox(box: CollisionBox, width: number, height: number): CollisionBox | undefined {
  const x = clamp(Math.round(box.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.round(box.y), 0, Math.max(0, height - 1));
  const right = clamp(Math.round(box.x + box.width), x + 1, width);
  const bottom = clamp(Math.round(box.y + box.height), y + 1, height);
  const sanitized = { x, y, width: right - x, height: bottom - y };
  return sanitized.width > 0 && sanitized.height > 0 ? sanitized : undefined;
}

function cloneCollision(collision: FighterFrameCollision): FighterFrameCollision {
  return {
    source: collision.source,
    hurtboxes: collision.hurtboxes.map((box) => ({ ...box })),
    attackBoxes: collision.attackBoxes?.map((box) => ({ ...box })),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
