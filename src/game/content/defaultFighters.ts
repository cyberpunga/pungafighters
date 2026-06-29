import type { FighterPose, FighterProfile, FighterSpriteId, LoadedFighter } from "../../types/game";
import { FIGHTER_POSE_PRIMARY_SPRITES, FIGHTER_POSES, FIGHTER_SPRITES } from "../../types/game";
import { createFrameCollisionMetadata } from "../../creator/collisionMetadata";

const COLORS = {
  ember: {
    body: "#f45b69",
    trim: "#f7b267",
    ink: "#1a1d2b",
  },
  mint: {
    body: "#2ec4b6",
    trim: "#e8f7ee",
    ink: "#17252a",
  },
};

export const DEFAULT_FIGHTER_IDS = ["default-ember", "default-mint"] as const;

export function getDefaultFighters(): LoadedFighter[] {
  return [
    createDefaultFighter("default-ember", "Ember Frame", COLORS.ember),
    createDefaultFighter("default-mint", "Mint Guard", COLORS.mint),
  ];
}

function createDefaultFighter(id: string, name: string, colors: (typeof COLORS)["ember"]): LoadedFighter {
  const now = "default";
  const renderedFrames = Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, drawDefaultFrame(pose, colors)])) as Record<
    FighterPose,
    ReturnType<typeof drawDefaultFrame>
  >;
  const renderedSpriteFrames = Object.fromEntries(
    FIGHTER_SPRITES.map((spriteId) => [spriteId, drawDefaultFrame(getPoseForSprite(spriteId), colors, spriteId)]),
  ) as Record<FighterSpriteId, ReturnType<typeof drawDefaultFrame>>;
  const frameUrls = Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, renderedFrames[pose].dataUrl])) as Record<FighterPose, string>;
  const spriteFrameUrls = Object.fromEntries(FIGHTER_SPRITES.map((spriteId) => [spriteId, renderedSpriteFrames[spriteId].dataUrl])) as Record<
    FighterSpriteId,
    string
  >;
  const frames = Object.fromEntries(
    FIGHTER_POSES.map((pose) => [
      pose,
      {
        pose,
        dataUrl: frameUrls[pose],
        anchor: { x: 0.5, y: 0.9 },
        width: 384,
        height: 384,
        collision: renderedFrames[pose].collision,
      },
    ]),
  ) as FighterProfile["frames"];
  const spriteFrames = Object.fromEntries(
    FIGHTER_SPRITES.map((spriteId) => {
      const pose = getPoseForSprite(spriteId);
      return [
        spriteId,
        {
          pose,
          spriteId,
          dataUrl: spriteFrameUrls[spriteId],
          anchor: { x: 0.5, y: 0.9 },
          width: 384,
          height: 384,
          collision: FIGHTER_POSE_PRIMARY_SPRITES[pose] === spriteId ? renderedSpriteFrames[spriteId].collision : undefined,
        },
      ];
    }),
  ) as FighterProfile["spriteFrames"];

  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    frames,
    spriteFrames,
    frameUrls,
    spriteFrameUrls,
    voiceClips: {},
    voiceUrls: {},
    movesetId: "basic-v1",
    isDefault: true,
  };
}

function drawDefaultFrame(pose: FighterPose, colors: (typeof COLORS)["ember"], spriteId?: FighterSpriteId) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      dataUrl: "",
      collision: createFrameCollisionMetadata({ width: 384, height: 384, data: new Uint8ClampedArray(384 * 384 * 4) }, pose),
    };
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(192, 206);

  const spriteLean = spriteId === "walk1" || spriteId === "walk3" ? 0.08 : spriteId === "walk2" || spriteId === "walk4" ? -0.08 : 0;
  const lean = pose === "kick" ? -0.2 : pose === "punch" ? 0.15 : pose === "hit" ? -0.28 : spriteLean;
  ctx.rotate(lean);

  ctx.fillStyle = colors.ink;
  roundedRect(ctx, -54, -84, 108, 150, 34);
  ctx.fill();

  ctx.fillStyle = colors.body;
  roundedRect(ctx, -44, -74, 88, 130, 30);
  ctx.fill();

  ctx.fillStyle = colors.trim;
  ctx.beginPath();
  ctx.arc(0, -116, 46, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.ink;
  ctx.beginPath();
  ctx.arc(-16, -122, 5, 0, Math.PI * 2);
  ctx.arc(16, -122, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  ctx.strokeStyle = colors.ink;
  drawLimbs(ctx, pose, colors, spriteId);

  if (pose === "victory") {
    ctx.strokeStyle = colors.trim;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, -130, 62, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }

  ctx.restore();
  return {
    dataUrl: canvas.toDataURL("image/png"),
    collision: createFrameCollisionMetadata(ctx.getImageData(0, 0, canvas.width, canvas.height), pose),
  };
}

function drawLimbs(ctx: CanvasRenderingContext2D, pose: FighterPose, colors: (typeof COLORS)["ember"], spriteId?: FighterSpriteId) {
  ctx.strokeStyle = colors.ink;
  ctx.beginPath();
  if (spriteId === "punchWindup") {
    ctx.moveTo(40, -38);
    ctx.lineTo(18, -82);
    ctx.moveTo(-40, -30);
    ctx.lineTo(-92, -8);
  } else if (pose === "punch") {
    ctx.moveTo(40, -38);
    ctx.lineTo(130, -58);
    ctx.moveTo(-40, -30);
    ctx.lineTo(-78, 14);
  } else if (pose === "victory") {
    ctx.moveTo(36, -50);
    ctx.lineTo(78, -124);
    ctx.moveTo(-36, -50);
    ctx.lineTo(-78, -124);
  } else {
    ctx.moveTo(40, -38);
    ctx.lineTo(76, 8);
    ctx.moveTo(-40, -38);
    ctx.lineTo(-76, 8);
  }
  if (spriteId === "walk1" || spriteId === "walk3") {
    ctx.moveTo(26, 52);
    ctx.lineTo(82, 126);
    ctx.moveTo(-28, 52);
    ctx.lineTo(-82, 112);
  } else if (spriteId === "walk2" || spriteId === "walk4") {
    ctx.moveTo(26, 52);
    ctx.lineTo(72, 108);
    ctx.moveTo(-28, 52);
    ctx.lineTo(-34, 134);
  } else if (spriteId === "kickWindup") {
    ctx.moveTo(26, 52);
    ctx.lineTo(42, 122);
    ctx.moveTo(-28, 52);
    ctx.lineTo(-112, 90);
  } else if (pose === "kick") {
    ctx.moveTo(26, 52);
    ctx.lineTo(124, 88);
    ctx.moveTo(-28, 52);
    ctx.lineTo(-66, 118);
  } else {
    ctx.moveTo(26, 52);
    ctx.lineTo(54, 128);
    ctx.moveTo(-28, 52);
    ctx.lineTo(-56, 128);
  }
  ctx.stroke();
}

function getPoseForSprite(spriteId: FighterSpriteId): FighterPose {
  if (spriteId.startsWith("punch")) {
    return "punch";
  }
  if (spriteId.startsWith("kick")) {
    return "kick";
  }
  if (spriteId === "hit") {
    return "hit";
  }
  if (spriteId.startsWith("victory")) {
    return "victory";
  }
  return "idle";
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
