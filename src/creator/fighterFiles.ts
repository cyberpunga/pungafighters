import { canvasToPngBlob, chromaKeyGreenCanvas, decodeImageBlob, NORMALIZED_FRAME_SIZE, normalizeCanvas } from "./imageProcessing";
import { AppError } from "../i18n/errors";
import type { CollisionBox, FighterFrameCollision, FighterPose, FighterSpriteId, FrameAnchor, LoadedFighter, VoiceClipType } from "../types/game";
import { FIGHTER_POSE_PRIMARY_SPRITES, FIGHTER_POSES, FIGHTER_SPRITES, VOICE_CLIPS } from "../types/game";

export const FIGHTER_CHARACTER_IMPORT_ACCEPT = ".pungafighter.json,.json,application/json";
export const FIGHTER_IMAGE_IMPORT_ACCEPT = "image/png,image/jpeg,image/webp";
export const FIGHTER_IMPORT_ACCEPT = `${FIGHTER_CHARACTER_IMPORT_ACCEPT},${FIGHTER_IMAGE_IMPORT_ACCEPT}`;
export const SPRITESHEET_IMPORT_ACCEPT = FIGHTER_IMAGE_IMPORT_ACCEPT;

const CHARACTER_FILE_FORMAT = "punga-fighters.character";
const CHARACTER_FILE_VERSION = 2;
const SPRITESHEET_ALPHA_THRESHOLD = 12;
const SPRITESHEET_COMPONENT_MIN_PIXELS = 80;
const SPRITESHEET_COMPONENT_MIN_AREA_RATIO = 0.00025;
const SPRITESHEET_COMPONENT_PADDING_RATIO = 0.08;
const SPRITESHEET_EXPECTED_COMPONENTS = FIGHTER_SPRITES.length;

interface CharacterFileFrame {
  pose: FighterPose;
  spriteId?: FighterSpriteId;
  dataUrl: string;
  anchor: FrameAnchor;
  width: number;
  height: number;
  collision?: FighterFrameCollision;
}

interface CharacterFileVoiceClip {
  dataUrl: string;
}

interface CharacterFilePayload {
  id?: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  movesetId?: "basic-v1";
  frames: Record<FighterPose, CharacterFileFrame>;
  spriteFrames?: Partial<Record<FighterSpriteId, CharacterFileFrame>>;
  voiceClips?: Partial<Record<VoiceClipType, CharacterFileVoiceClip>>;
}

interface CharacterFile {
  format: typeof CHARACTER_FILE_FORMAT;
  version: typeof CHARACTER_FILE_VERSION;
  exportedAt: string;
  fighter: CharacterFilePayload;
}

export interface ImportedFighterAssets {
  name: string;
  frameBlobs: Record<FighterPose, Blob>;
  spriteFrameBlobs?: Partial<Record<FighterSpriteId, Blob>>;
  frameCollisions?: Partial<Record<FighterPose, FighterFrameCollision>>;
  voiceBlobs: Partial<Record<VoiceClipType, Blob>>;
}

export interface ImportedSpritesheetAssets {
  name: string;
  sourceBlobs: Record<FighterPose, Blob>;
  frameBlobs: Record<FighterPose, Blob>;
  spriteSourceBlobs?: Partial<Record<FighterSpriteId, Blob>>;
  spriteFrameBlobs?: Partial<Record<FighterSpriteId, Blob>>;
}

export async function downloadFighterExport(fighter: LoadedFighter): Promise<void> {
  const blob = await createFighterExportBlob(fighter);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = getFighterExportFilename(fighter);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function createFighterExportBlob(fighter: LoadedFighter): Promise<Blob> {
  const frames = Object.fromEntries(
    await Promise.all(
      FIGHTER_POSES.map(async (pose) => {
        const frame = fighter.frames[pose];
        return [
          pose,
          {
            pose,
            dataUrl: frame.dataUrl || (await urlToDataUrl(fighter.frameUrls[pose])),
            anchor: frame.anchor,
            width: frame.width,
            height: frame.height,
            collision: frame.collision,
          },
        ] as const;
      }),
    ),
  ) as Record<FighterPose, CharacterFileFrame>;
  const spriteFrames = fighter.spriteFrames
    ? (Object.fromEntries(
        await Promise.all(
          FIGHTER_SPRITES.flatMap((spriteId) => {
            const frame = fighter.spriteFrames?.[spriteId];
            const url = fighter.spriteFrameUrls?.[spriteId];
            if (!frame || !url) {
              return [];
            }
            return [
              (async () => [
                spriteId,
                {
                  pose: frame.pose,
                  spriteId,
                  dataUrl: frame.dataUrl || (await urlToDataUrl(url)),
                  anchor: frame.anchor,
                  width: frame.width,
                  height: frame.height,
                  collision: frame.collision,
                },
              ])(),
            ];
          }),
        ),
      ) as Partial<Record<FighterSpriteId, CharacterFileFrame>>)
    : undefined;

  const voicePairs = await Promise.all(
    VOICE_CLIPS.map(async (clip) => {
      const url = fighter.voiceUrls[clip];
      return url ? ([clip, { dataUrl: await urlToDataUrl(url) }] as const) : undefined;
    }),
  );

  const file: CharacterFile = {
    format: CHARACTER_FILE_FORMAT,
    version: CHARACTER_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    fighter: {
      id: fighter.id,
      name: fighter.name,
      createdAt: fighter.createdAt,
      updatedAt: fighter.updatedAt,
      movesetId: "basic-v1",
      frames,
      ...(spriteFrames && Object.keys(spriteFrames).length ? { spriteFrames } : {}),
      voiceClips: Object.fromEntries(voicePairs.filter(isDefined)) as Partial<Record<VoiceClipType, CharacterFileVoiceClip>>,
    },
  };

  return new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
}

export async function readFighterImportFile(file: File): Promise<ImportedFighterAssets> {
  if (isJsonFile(file)) {
    return readCharacterJsonFile(file);
  }
  if (isImageFile(file)) {
    return readSpritesheetFighterFile(file);
  }
  throw new AppError("error.fighterImportType");
}

export async function readFighterCharacterFile(file: File): Promise<ImportedFighterAssets> {
  if (!isJsonFile(file)) {
    throw new AppError("error.fighterJsonType");
  }
  return readCharacterJsonFile(file);
}

export async function readSpritesheetFighterFile(file: File): Promise<ImportedFighterAssets> {
  const imported = await readSpritesheetDraftFile(file);
  return {
    name: imported.name,
    frameBlobs: imported.frameBlobs,
    spriteFrameBlobs: imported.spriteFrameBlobs,
    voiceBlobs: {},
  };
}

export async function readSpritesheetDraftFile(file: File): Promise<ImportedSpritesheetAssets> {
  if (!isImageFile(file)) {
    throw new AppError("error.spritesheetType");
  }
  const image = await decodeImageBlob(file, new AppError("error.spritesheetRead"));
  try {
    const keyedSheetCanvas = chromaKeyGreenCanvas(image.source);
    const componentCanvases = extractSpritesheetComponentCanvases(keyedSheetCanvas);
    if (componentCanvases.length >= FIGHTER_SPRITES.length) {
      const pairs = await Promise.all(
        FIGHTER_SPRITES.map(async (spriteId, index) => {
          const sourceCanvas = componentCanvases[index];
          const sourceBlob = await canvasToPngBlob(sourceCanvas);
          const normalized = normalizeCanvas(sourceCanvas, { paddingScale: 1, anchorY: 0.9 });
          return [spriteId, { sourceBlob, frameBlob: await canvasToPngBlob(normalized) }] as const;
        }),
      );
      return buildSpritesheetAssets(file, pairs);
    }

    const horizontal = image.width >= image.height;
    const inferredCells = getSpritesheetCellIds(image.width, image.height, horizontal);
    const columns = horizontal ? inferredCells.length : 1;
    const rows = horizontal ? 1 : inferredCells.length;
    const cellWidth = image.width / columns;
    const cellHeight = image.height / rows;

    if (cellWidth < 8 || cellHeight < 8) {
      throw new AppError("error.spritesheetSmall");
    }

    const pairs = await Promise.all(
      inferredCells.map(async (cellId, index) => {
        const cellCanvas = document.createElement("canvas");
        cellCanvas.width = Math.round(cellWidth);
        cellCanvas.height = Math.round(cellHeight);
        const ctx = cellCanvas.getContext("2d");
        if (!ctx) {
          throw new AppError("error.spritesheetRead");
        }
        const sx = (index % columns) * cellWidth;
        const sy = Math.floor(index / columns) * cellHeight;
        ctx.drawImage(image.source, sx, sy, cellWidth, cellHeight, 0, 0, cellCanvas.width, cellCanvas.height);

        const keyedCanvas = chromaKeyGreenCanvas(cellCanvas);
        const sourceBlob = await canvasToPngBlob(keyedCanvas);
        const normalized = normalizeCanvas(keyedCanvas, { paddingScale: 1, anchorY: 0.9 });
        return [cellId, { sourceBlob, frameBlob: await canvasToPngBlob(normalized) }] as const;
      }),
    );

    return buildSpritesheetAssets(file, pairs);
  } finally {
    image.close();
  }
}

function buildSpritesheetAssets(
  file: File,
  pairs: readonly (readonly [FighterPose | FighterSpriteId, { sourceBlob: Blob; frameBlob: Blob }])[],
): ImportedSpritesheetAssets {
  const cellIds = pairs.map(([cellId]) => cellId);
  const fullSpriteSheet = isFullSpriteSheet(cellIds);
  const sourcePairs = FIGHTER_POSES.map((pose) => {
    const sourceCellId = fullSpriteSheet ? FIGHTER_POSE_PRIMARY_SPRITES[pose] : pose;
    const blobs = pairs.find(([cellId]) => cellId === sourceCellId)?.[1];
    return [pose, blobs?.sourceBlob] as const;
  });
  const framePairs = FIGHTER_POSES.map((pose) => {
    const sourceCellId = fullSpriteSheet ? FIGHTER_POSE_PRIMARY_SPRITES[pose] : pose;
    const blobs = pairs.find(([cellId]) => cellId === sourceCellId)?.[1];
    return [pose, blobs?.frameBlob] as const;
  });
  const spriteSourcePairs = fullSpriteSheet ? pairs.map(([spriteId, blobs]) => [spriteId, blobs.sourceBlob] as const) : [];
  const spriteFramePairs = fullSpriteSheet ? pairs.map(([spriteId, blobs]) => [spriteId, blobs.frameBlob] as const) : [];

  return {
    name: nameFromFile(file.name),
    sourceBlobs: Object.fromEntries(sourcePairs) as Record<FighterPose, Blob>,
    frameBlobs: Object.fromEntries(framePairs) as Record<FighterPose, Blob>,
    ...(spriteSourcePairs.length
      ? { spriteSourceBlobs: Object.fromEntries(spriteSourcePairs) as Partial<Record<FighterSpriteId, Blob>> }
      : {}),
    ...(spriteFramePairs.length
      ? { spriteFrameBlobs: Object.fromEntries(spriteFramePairs) as Partial<Record<FighterSpriteId, Blob>> }
      : {}),
  };
}

function extractSpritesheetComponentCanvases(canvas: HTMLCanvasElement): HTMLCanvasElement[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return [];
  }

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return [];
  }

  const boxes = sortBoxesByReadingOrder(mergeNearbyComponents(findForegroundComponents(imageData), SPRITESHEET_EXPECTED_COMPONENTS));
  return boxes.slice(0, FIGHTER_SPRITES.length).map((box) => cropCanvasToBox(canvas, box));
}

function findForegroundComponents(imageData: ImageData) {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(width * height);
  const minPixels = Math.max(SPRITESHEET_COMPONENT_MIN_PIXELS, Math.floor(width * height * SPRITESHEET_COMPONENT_MIN_AREA_RATIO));
  const boxes: Array<{ left: number; right: number; top: number; bottom: number; pixels: number }> = [];

  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || data[start * 4 + 3] <= SPRITESHEET_ALPHA_THRESHOLD) {
      continue;
    }

    const stack = [start];
    visited[start] = 1;
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    let pixels = 0;

    while (stack.length) {
      const pixel = stack.pop()!;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      pixels += 1;

      visitNeighbor(pixel - 1, x > 0);
      visitNeighbor(pixel + 1, x < width - 1);
      visitNeighbor(pixel - width, y > 0);
      visitNeighbor(pixel + width, y < height - 1);
    }

    if (pixels >= minPixels) {
      boxes.push({ left, right, top, bottom, pixels });
    }

    function visitNeighbor(next: number, inBounds: boolean) {
      if (!inBounds || visited[next] || data[next * 4 + 3] <= SPRITESHEET_ALPHA_THRESHOLD) {
        return;
      }
      visited[next] = 1;
      stack.push(next);
    }
  }

  return boxes;
}

function mergeNearbyComponents(
  boxes: Array<{ left: number; right: number; top: number; bottom: number; pixels: number }>,
  targetCount: number,
) {
  const merged = boxes.map((box) => ({ ...box }));
  while (merged.length > targetCount) {
    let bestPair: [number, number] | undefined;
    let bestDistance = Infinity;
    for (let a = 0; a < merged.length; a += 1) {
      for (let b = a + 1; b < merged.length; b += 1) {
        const distance = boxGapDistance(merged[a], merged[b]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPair = [a, b];
        }
      }
    }
    if (!bestPair) {
      break;
    }
    const [a, b] = bestPair;
    merged[a] = unionBoxes(merged[a], merged[b]);
    merged.splice(b, 1);
  }
  return merged;
}

function boxGapDistance(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) {
  const gapX = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
  const gapY = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
  return Math.hypot(gapX, gapY);
}

function unionBoxes(
  a: { left: number; right: number; top: number; bottom: number; pixels: number },
  b: { left: number; right: number; top: number; bottom: number; pixels: number },
) {
  return {
    left: Math.min(a.left, b.left),
    right: Math.max(a.right, b.right),
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
    pixels: a.pixels + b.pixels,
  };
}

function sortBoxesByReadingOrder(boxes: Array<{ left: number; right: number; top: number; bottom: number }>) {
  const sorted = [...boxes].sort((a, b) => a.top - b.top);
  const rows: Array<Array<{ left: number; right: number; top: number; bottom: number }>> = [];

  sorted.forEach((box) => {
    const centerY = (box.top + box.bottom) / 2;
    const height = box.bottom - box.top + 1;
    const row = rows.find((candidate) => {
      const rowTop = Math.min(...candidate.map((item) => item.top));
      const rowBottom = Math.max(...candidate.map((item) => item.bottom));
      const rowCenterY = (rowTop + rowBottom) / 2;
      const rowHeight = rowBottom - rowTop + 1;
      return Math.abs(centerY - rowCenterY) <= Math.max(18, Math.min(height, rowHeight) * 0.7);
    });
    if (row) {
      row.push(box);
    } else {
      rows.push([box]);
    }
  });

  return rows.flatMap((row) => row.sort((a, b) => a.left - b.left));
}

function cropCanvasToBox(
  source: HTMLCanvasElement,
  box: { left: number; right: number; top: number; bottom: number },
): HTMLCanvasElement {
  const boxWidth = box.right - box.left + 1;
  const boxHeight = box.bottom - box.top + 1;
  const padding = Math.round(Math.max(boxWidth, boxHeight) * SPRITESHEET_COMPONENT_PADDING_RATIO);
  const left = Math.max(0, box.left - padding);
  const top = Math.max(0, box.top - padding);
  const right = Math.min(source.width, box.right + 1 + padding);
  const bottom = Math.min(source.height, box.bottom + 1 + padding);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, right - left);
  canvas.height = Math.max(1, bottom - top);
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function getFighterExportFilename(fighter: LoadedFighter) {
  return `${slugify(fighter.name)}.pungafighter.json`;
}

async function readCharacterJsonFile(file: File): Promise<ImportedFighterAssets> {
  const parsed = JSON.parse(await file.text()) as unknown;
  const payload = getCharacterPayload(parsed);
  if (!payload) {
    throw new Error("This is not a Punga fighter character file.");
  }

  const framePairs = await Promise.all(
    FIGHTER_POSES.map(async (pose) => {
      const frame = payload.frames[pose];
      if (!isRecord(frame) || typeof frame.dataUrl !== "string" || !frame.dataUrl.startsWith("data:image/")) {
        throw new Error(`The ${pose} frame is missing or invalid.`);
      }
      return [pose, await dataUrlToBlob(frame.dataUrl)] as const;
    }),
  );
  const spriteFramePairs = await Promise.all(
    FIGHTER_SPRITES.flatMap((spriteId) => {
      const frame = payload.spriteFrames?.[spriteId];
      if (!frame) {
        return [];
      }
      if (!isRecord(frame) || typeof frame.dataUrl !== "string" || !frame.dataUrl.startsWith("data:image/")) {
        throw new Error(`The ${spriteId} sprite is invalid.`);
      }
      return [(async () => [spriteId, await dataUrlToBlob(frame.dataUrl)] as const)()];
    }),
  );
  const frameCollisions = Object.fromEntries(
    FIGHTER_POSES.flatMap((pose) => {
      const collision = payload.frames[pose].collision;
      return collision ? [[pose, collision] as const] : [];
    }),
  ) as Partial<Record<FighterPose, FighterFrameCollision>>;

  const voicePairs = await Promise.all(
    VOICE_CLIPS.map(async (clip) => {
      const voice = payload.voiceClips?.[clip];
      if (!voice) {
        return undefined;
      }
      if (!isRecord(voice) || typeof voice.dataUrl !== "string" || !voice.dataUrl.startsWith("data:audio/")) {
        throw new Error(`The ${clip} voice clip is invalid.`);
      }
      return [clip, await dataUrlToBlob(voice.dataUrl)] as const;
    }),
  );

  return {
    name: cleanFighterName(payload.name),
    frameBlobs: Object.fromEntries(framePairs) as Record<FighterPose, Blob>,
    spriteFrameBlobs: spriteFramePairs.length
      ? (Object.fromEntries(spriteFramePairs) as Partial<Record<FighterSpriteId, Blob>>)
      : undefined,
    frameCollisions,
    voiceBlobs: Object.fromEntries(voicePairs.filter(isDefined)) as Partial<Record<VoiceClipType, Blob>>,
  };
}

function getCharacterPayload(value: unknown): CharacterFilePayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.format === CHARACTER_FILE_FORMAT && (value.version === 1 || value.version === CHARACTER_FILE_VERSION) && isRecord(value.fighter)) {
    return isCharacterPayload(value.fighter) ? value.fighter : undefined;
  }

  return isCharacterPayload(value) ? value : undefined;
}

function getSpritesheetCellIds(width: number, height: number, horizontal: boolean): readonly (FighterPose | FighterSpriteId)[] {
  const major = horizontal ? width : height;
  const minor = horizontal ? height : width;
  const ratio = major / Math.max(1, minor);
  return ratio > 8 ? FIGHTER_SPRITES : FIGHTER_POSES;
}

function isFullSpriteSheet(cells: readonly (FighterPose | FighterSpriteId)[]): cells is readonly FighterSpriteId[] {
  return cells.length === FIGHTER_SPRITES.length;
}

function isCharacterPayload(value: unknown): value is CharacterFilePayload {
  if (!isRecord(value) || typeof value.name !== "string" || !isRecord(value.frames)) {
    return false;
  }
  const frames = value.frames;
  return FIGHTER_POSES.every((pose) => {
    const frame = frames[pose];
    return isRecord(frame) && (frame.collision === undefined || isFrameCollision(frame.collision));
  });
}

function isFrameCollision(value: unknown): value is FighterFrameCollision {
  if (!isRecord(value) || value.source !== "alpha-v1" || !Array.isArray(value.hurtboxes)) {
    return false;
  }
  return value.hurtboxes.every(isCollisionBox) && (value.attackBoxes === undefined || (Array.isArray(value.attackBoxes) && value.attackBoxes.every(isCollisionBox)));
}

function isCollisionBox(value: unknown): value is CollisionBox {
  if (!isRecord(value)) {
    return false;
  }
  return ["x", "y", "width", "height"].every((key) => {
    const numberValue = value[key];
    return typeof numberValue === "number" && Number.isFinite(numberValue);
  });
}

async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return url;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError("error.fighterAssetLoad");
  }
  return blobToDataUrl(await response.blob());
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new AppError("error.fighterAssetRead")));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new AppError("error.fighterAssetRead");
  }
  return response.blob();
}

function isJsonFile(file: File) {
  return file.type === "application/json" || /\.json$/i.test(file.name);
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function nameFromFile(filename: string) {
  return cleanFighterName(filename.replace(/\.[^.]+$/, ""));
}

function cleanFighterName(value: string) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, 32) : "Imported Fighter";
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "fighter";
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
