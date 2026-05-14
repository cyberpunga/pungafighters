import { canvasToPngBlob, NORMALIZED_FRAME_SIZE, normalizeCanvas } from "./imageProcessing";
import type { FighterPose, FrameAnchor, LoadedFighter, VoiceClipType } from "../types/game";
import { FIGHTER_POSES, VOICE_CLIPS } from "../types/game";

export const FIGHTER_IMPORT_ACCEPT = ".pungafighter.json,.json,application/json,image/png,image/jpeg,image/webp";
export const SPRITESHEET_IMPORT_ACCEPT = "image/png,image/jpeg,image/webp";

const CHARACTER_FILE_FORMAT = "punga-fighters.character";
const CHARACTER_FILE_VERSION = 1;

interface CharacterFileFrame {
  pose: FighterPose;
  dataUrl: string;
  anchor: FrameAnchor;
  width: number;
  height: number;
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
  voiceBlobs: Partial<Record<VoiceClipType, Blob>>;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
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
          },
        ] as const;
      }),
    ),
  ) as Record<FighterPose, CharacterFileFrame>;

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
  throw new Error("Choose a Punga fighter JSON file or a PNG, JPEG, or WebP spritesheet.");
}

export async function readSpritesheetFighterFile(file: File): Promise<ImportedFighterAssets> {
  const image = await decodeImageFile(file);
  try {
    const horizontal = image.width >= image.height;
    const columns = horizontal ? FIGHTER_POSES.length : 1;
    const rows = horizontal ? 1 : FIGHTER_POSES.length;
    const cellWidth = image.width / columns;
    const cellHeight = image.height / rows;

    if (cellWidth < 8 || cellHeight < 8) {
      throw new Error("Spritesheet cells are too small to import.");
    }

    const framePairs = await Promise.all(
      FIGHTER_POSES.map(async (pose, index) => {
        const cellCanvas = document.createElement("canvas");
        cellCanvas.width = Math.round(cellWidth);
        cellCanvas.height = Math.round(cellHeight);
        const ctx = cellCanvas.getContext("2d");
        if (!ctx) {
          throw new Error("Could not read spritesheet image.");
        }
        const sx = (index % columns) * cellWidth;
        const sy = Math.floor(index / columns) * cellHeight;
        ctx.drawImage(image.source, sx, sy, cellWidth, cellHeight, 0, 0, cellCanvas.width, cellCanvas.height);

        const normalized = normalizeCanvas(cellCanvas, { paddingScale: 1, anchorY: 0.9 });
        return [pose, await canvasToPngBlob(normalized)] as const;
      }),
    );

    return {
      name: nameFromFile(file.name),
      frameBlobs: Object.fromEntries(framePairs) as Record<FighterPose, Blob>,
      voiceBlobs: {},
    };
  } finally {
    image.close();
  }
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
    voiceBlobs: Object.fromEntries(voicePairs.filter(isDefined)) as Partial<Record<VoiceClipType, Blob>>,
  };
}

function getCharacterPayload(value: unknown): CharacterFilePayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.format === CHARACTER_FILE_FORMAT && value.version === CHARACTER_FILE_VERSION && isRecord(value.fighter)) {
    return isCharacterPayload(value.fighter) ? value.fighter : undefined;
  }

  return isCharacterPayload(value) ? value : undefined;
}

function isCharacterPayload(value: unknown): value is CharacterFilePayload {
  if (!isRecord(value) || typeof value.name !== "string" || !isRecord(value.frames)) {
    return false;
  }
  const frames = value.frames;
  return FIGHTER_POSES.every((pose) => isRecord(frames[pose]));
}

async function urlToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return url;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Could not load fighter asset.");
  }
  return blobToDataUrl(await response.blob());
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("Could not read fighter asset.")));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("Could not read fighter asset.");
  }
  return response.blob();
}

async function decodeImageFile(file: File): Promise<DecodedImage> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("Could not read spritesheet image.")), { once: true });
    image.src = url;
  });

  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    close: () => URL.revokeObjectURL(url),
  };
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
