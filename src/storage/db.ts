import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BattleDisplayEffect,
  BattlePostEffect,
  BattlePostEffectSettings,
  FighterPose,
  FighterFrameCollision,
  FighterProfile,
  LoadedBattleBackground,
  LoadedBattleBackgroundLayer,
  LoadedFighter,
  VoiceClipType,
} from "../types/game";
import { BATTLE_BACKGROUND_DEPTH_LAYERS, BATTLE_POST_EFFECTS, FIGHTER_POSES, type BattleBackgroundDepthLayerId } from "../types/game";
import {
  createDefaultBattlePostEffectSettings,
  getEnabledBattlePostEffects,
  normalizeBattlePostEffectSettings,
} from "../game/render/postEffectSettings";
import { createFrameCollisionMetadataFromBlob } from "../creator/collisionMetadata";
import { createBattleBackgroundDepthLayersFromBlob, type GeneratedBattleBackgroundLayer } from "../creator/backgroundDepthLayers";
import { getDefaultFighters } from "../game/content/defaultFighters";
import { AppError, missingPoseImageError } from "../i18n/errors";

export const BATTLE_BACKGROUND_IMPORT_ACCEPT = "image/png,image/jpeg,image/webp";
export const DEFAULT_BATTLE_DISPLAY_EFFECT: BattleDisplayEffect = "clean";
export const DEFAULT_BATTLE_POST_EFFECTS: BattlePostEffect[] = [];
export const DEFAULT_BATTLE_POST_EFFECT_SETTINGS: BattlePostEffectSettings = createDefaultBattlePostEffectSettings(DEFAULT_BATTLE_POST_EFFECTS);

const BATTLE_BACKGROUND_SETTING_KEY = "battle-background";
const BATTLE_DISPLAY_EFFECT_SETTING_KEY = "battle-display-effect";
const BATTLE_POST_EFFECTS_SETTING_KEY = "battle-post-effects";
const BATTLE_POST_EFFECT_SETTINGS_KEY = "battle-post-effect-settings";
const BATTLE_BACKGROUND_BLOB_ID = "battle-background:current";
const BATTLE_BACKGROUND_LAYER_BLOB_ID_PREFIX = "battle-background:current:layer";
const BATTLE_BACKGROUND_MAX_BYTES = 10 * 1024 * 1024;
const BATTLE_BACKGROUND_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface BattleBackgroundLayerRecord {
  id: BattleBackgroundDepthLayerId;
  blobId: string;
  mimeType: string;
  size: number;
  depth: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

interface BattleBackgroundRecord {
  id: "custom";
  name: string;
  blobId: string;
  mimeType: string;
  size: number;
  updatedAt: string;
  layers?: BattleBackgroundLayerRecord[];
}

export interface EditableFighterDraft {
  id: string;
  name: string;
  isDefault: boolean;
  frameBlobs: Record<FighterPose, Blob>;
  voiceBlobs: Partial<Record<VoiceClipType, Blob>>;
}

interface PungaFightersDb extends DBSchema {
  fighters: {
    key: string;
    value: FighterProfile;
    indexes: { "by-updated": string };
  };
  imageBlobs: {
    key: string;
    value: Blob;
  };
  audioBlobs: {
    key: string;
    value: Blob;
  };
  settings: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<PungaFightersDb>> | undefined;

export function getDb() {
  dbPromise ??= openDB<PungaFightersDb>("punga-fighters", 1, {
    upgrade(db) {
      const fighters = db.createObjectStore("fighters", { keyPath: "id" });
      fighters.createIndex("by-updated", "updatedAt");
      db.createObjectStore("imageBlobs");
      db.createObjectStore("audioBlobs");
      db.createObjectStore("settings");
    },
  });
  return dbPromise;
}

export async function listLoadedFighters(): Promise<LoadedFighter[]> {
  const db = await getDb();
  const saved = await db.getAll("fighters");
  const loaded = await Promise.all(saved.map(loadFighterAssets));
  return [...getDefaultFighters(), ...loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))];
}

export async function getLoadedFighter(id: string): Promise<LoadedFighter | undefined> {
  const defaultFighter = getDefaultFighters().find((fighter) => fighter.id === id);
  if (defaultFighter) {
    return defaultFighter;
  }
  const db = await getDb();
  const fighter = await db.get("fighters", id);
  return fighter ? loadFighterAssets(fighter) : undefined;
}

export async function saveFighterDraft(input: {
  id?: string;
  name: string;
  frameBlobs: Record<FighterPose, Blob>;
  voiceBlobs: Partial<Record<VoiceClipType, Blob>>;
}): Promise<FighterProfile> {
  return saveFighterAssets(input);
}

export async function saveImportedFighter(input: {
  name: string;
  frameBlobs: Record<FighterPose, Blob>;
  frameCollisions?: Partial<Record<FighterPose, FighterFrameCollision>>;
  voiceBlobs?: Partial<Record<VoiceClipType, Blob>>;
}): Promise<FighterProfile> {
  return saveFighterAssets({
    name: input.name,
    frameBlobs: input.frameBlobs,
    frameCollisions: input.frameCollisions,
    voiceBlobs: input.voiceBlobs ?? {},
  });
}

async function saveFighterAssets(input: {
  id?: string;
  name: string;
  frameBlobs: Record<FighterPose, Blob>;
  frameCollisions?: Partial<Record<FighterPose, FighterFrameCollision>>;
  voiceBlobs: Partial<Record<VoiceClipType, Blob>>;
}): Promise<FighterProfile> {
  const db = await getDb();
  const existing = input.id ? await db.get("fighters", input.id) : undefined;
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(["fighters", "imageBlobs", "audioBlobs"], "readwrite");

  const frames = Object.fromEntries(
    await Promise.all(
      FIGHTER_POSES.map(async (pose) => {
        const blob = input.frameBlobs[pose];
        const blobId = `${id}:frame:${pose}`;
        const collision = input.frameCollisions?.[pose] ?? (await createFrameCollisionMetadataFromBlob(blob, pose));
        await tx.objectStore("imageBlobs").put(blob, blobId);
        return [
          pose,
          {
            pose,
            blobId,
            anchor: { x: 0.5, y: 0.9 },
            width: 384,
            height: 384,
            collision,
          },
        ];
      }),
    ),
  ) as FighterProfile["frames"];

  const voiceClips: FighterProfile["voiceClips"] = {};
  await Promise.all(
    Object.entries(input.voiceBlobs).map(async ([clip, blob]) => {
      if (!blob) {
        return;
      }
      const blobId = `${id}:voice:${clip}`;
      await tx.objectStore("audioBlobs").put(blob, blobId);
      voiceClips[clip as VoiceClipType] = blobId;
    }),
  );

  await Promise.all(
    Object.entries(existing?.voiceClips ?? {}).map(async ([clip, blobId]) => {
      if (blobId && !voiceClips[clip as VoiceClipType]) {
        await tx.objectStore("audioBlobs").delete(blobId);
      }
    }),
  );

  const fighter: FighterProfile = {
    id,
    name: input.name.trim() || "New Fighter",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    frames,
    voiceClips,
    movesetId: "basic-v1",
  };

  await tx.objectStore("fighters").put(fighter);
  await tx.done;
  return fighter;
}

export async function loadEditableFighterDraft(id: string): Promise<EditableFighterDraft | undefined> {
  const defaultFighter = getDefaultFighters().find((fighter) => fighter.id === id);
  if (defaultFighter) {
    return {
      id: defaultFighter.id,
      name: defaultFighter.name,
      isDefault: true,
      frameBlobs: Object.fromEntries(
        await Promise.all(FIGHTER_POSES.map(async (pose) => [pose, await fighterFrameToBlob(defaultFighter.frames[pose])] as const)),
      ) as Record<FighterPose, Blob>,
      voiceBlobs: {},
    };
  }

  const db = await getDb();
  const fighter = await db.get("fighters", id);
  if (!fighter) {
    return undefined;
  }

  const frameBlobs = Object.fromEntries(
    await Promise.all(
      FIGHTER_POSES.map(async (pose) => {
        const blob = await fighterFrameToBlob(fighter.frames[pose]);
        return [pose, blob] as const;
      }),
    ),
  ) as Record<FighterPose, Blob>;
  const voiceBlobs = Object.fromEntries(
    (
      await Promise.all(
        Object.entries(fighter.voiceClips).map(async ([clip, blobId]) => {
          if (!blobId) {
            return undefined;
          }
          const blob = await db.get("audioBlobs", blobId);
          return blob ? ([clip, blob] as const) : undefined;
        }),
      )
    ).filter(Boolean) as Array<readonly [string, Blob]>
  ) as Partial<Record<VoiceClipType, Blob>>;

  return {
    id: fighter.id,
    name: fighter.name,
    isDefault: false,
    frameBlobs,
    voiceBlobs,
  };
}

export async function deleteFighter(id: string) {
  const db = await getDb();
  const fighter = await db.get("fighters", id);
  if (!fighter) {
    return;
  }
  const tx = db.transaction(["fighters", "imageBlobs", "audioBlobs"], "readwrite");
  await Promise.all(
    Object.values(fighter.frames).map((frame) => (frame.blobId ? tx.objectStore("imageBlobs").delete(frame.blobId) : undefined)),
  );
  await Promise.all(
    Object.values(fighter.voiceClips).map((blobId) => (blobId ? tx.objectStore("audioBlobs").delete(blobId) : undefined)),
  );
  await tx.objectStore("fighters").delete(id);
  await tx.done;
}

export async function getLoadedBattleBackground(): Promise<LoadedBattleBackground | undefined> {
  const db = await getDb();
  const record = await db.get("settings", BATTLE_BACKGROUND_SETTING_KEY);
  if (!isBattleBackgroundRecord(record)) {
    return undefined;
  }

  const blob = await db.get("imageBlobs", record.blobId);
  if (!blob) {
    return undefined;
  }
  const layerBlobs = await loadBattleBackgroundLayerBlobs(record);
  return loadBattleBackground(record, blob, layerBlobs);
}

export async function saveBattleBackgroundImage(file: File): Promise<LoadedBattleBackground> {
  if (!isSupportedBattleBackgroundFile(file)) {
    throw new AppError("error.backgroundType");
  }
  if (file.size > BATTLE_BACKGROUND_MAX_BYTES) {
    throw new AppError("error.backgroundSize");
  }

  const db = await getDb();
  const now = new Date().toISOString();
  const layers = await createBackgroundDepthLayers(file);
  const record: BattleBackgroundRecord = {
    id: "custom",
    name: cleanBackgroundName(file.name),
    blobId: BATTLE_BACKGROUND_BLOB_ID,
    mimeType: file.type || getImageMimeTypeFromName(file.name) || "image/png",
    size: file.size,
    updatedAt: now,
    layers: layers.length
      ? layers.map((layer) => ({
          id: layer.id,
          blobId: getBattleBackgroundLayerBlobId(layer.id),
          mimeType: layer.mimeType,
          size: layer.size,
          depth: layer.depth,
          scale: layer.scale,
          offsetX: layer.offsetX,
          offsetY: layer.offsetY,
          opacity: layer.opacity,
        }))
      : undefined,
  };
  const tx = db.transaction(["imageBlobs", "settings"], "readwrite");
  const imageWrites: Promise<unknown>[] = [
    tx.objectStore("imageBlobs").put(file, BATTLE_BACKGROUND_BLOB_ID),
    tx.objectStore("settings").put(record, BATTLE_BACKGROUND_SETTING_KEY),
    ...BATTLE_BACKGROUND_DEPTH_LAYERS.map((id) => tx.objectStore("imageBlobs").delete(getBattleBackgroundLayerBlobId(id))),
    ...layers.map((layer) => tx.objectStore("imageBlobs").put(layer.blob, getBattleBackgroundLayerBlobId(layer.id))),
  ];
  await Promise.all(imageWrites);
  await tx.done;
  return loadBattleBackground(
    record,
    file,
    new Map(layers.map((layer) => [getBattleBackgroundLayerBlobId(layer.id), layer.blob])),
  );
}

export async function clearBattleBackgroundImage(): Promise<void> {
  const db = await getDb();
  const record = await db.get("settings", BATTLE_BACKGROUND_SETTING_KEY);
  const layerBlobIds = new Set([
    ...BATTLE_BACKGROUND_DEPTH_LAYERS.map((id) => getBattleBackgroundLayerBlobId(id)),
    ...(isBattleBackgroundRecord(record) ? (record.layers?.map((layer) => layer.blobId) ?? []) : []),
  ]);
  const tx = db.transaction(["imageBlobs", "settings"], "readwrite");
  await Promise.all([
    tx.objectStore("imageBlobs").delete(BATTLE_BACKGROUND_BLOB_ID),
    ...[...layerBlobIds].map((blobId) => tx.objectStore("imageBlobs").delete(blobId)),
    tx.objectStore("settings").delete(BATTLE_BACKGROUND_SETTING_KEY),
  ]);
  await tx.done;
}

export async function getBattleDisplayEffect(): Promise<BattleDisplayEffect> {
  const effects = await getBattlePostEffects();
  return effects[0] ?? "clean";
}

export async function getBattlePostEffects(): Promise<BattlePostEffect[]> {
  return getEnabledBattlePostEffects(await getBattlePostEffectSettings());
}

export async function getBattlePostEffectSettings(): Promise<BattlePostEffectSettings> {
  const db = await getDb();
  const settingsValue = await db.get("settings", BATTLE_POST_EFFECT_SETTINGS_KEY);
  const settings = normalizeBattlePostEffectSettings(settingsValue);
  if (settings) {
    return settings;
  }

  const effectsValue = await db.get("settings", BATTLE_POST_EFFECTS_SETTING_KEY);
  if (Array.isArray(effectsValue)) {
    const effects = dedupePostEffects(effectsValue);
    return createDefaultBattlePostEffectSettings(effects.length > 0 ? effects : []);
  }

  const value = await db.get("settings", BATTLE_DISPLAY_EFFECT_SETTING_KEY);
  if (isBattlePostEffect(value)) {
    return createDefaultBattlePostEffectSettings([value]);
  }
  if (value === "clean") {
    return createDefaultBattlePostEffectSettings([]);
  }
  return DEFAULT_BATTLE_POST_EFFECT_SETTINGS;
}

export async function setBattleDisplayEffect(effect: BattleDisplayEffect): Promise<void> {
  await setBattlePostEffects(effect === "clean" ? [] : [effect]);
}

export async function setBattlePostEffects(effects: BattlePostEffect[]): Promise<void> {
  await setBattlePostEffectSettings(createDefaultBattlePostEffectSettings(dedupePostEffects(effects)));
}

export async function setBattlePostEffectSettings(settings: BattlePostEffectSettings): Promise<void> {
  const db = await getDb();
  await db.put("settings", normalizeBattlePostEffectSettings(settings) ?? DEFAULT_BATTLE_POST_EFFECT_SETTINGS, BATTLE_POST_EFFECT_SETTINGS_KEY);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const value = await db.get("settings", key);
  return value === undefined ? fallback : (value as T);
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put("settings", value, key);
}

async function loadFighterAssets(fighter: FighterProfile): Promise<LoadedFighter> {
  const db = await getDb();
  const framePairs = await Promise.all(
    FIGHTER_POSES.map(async (pose) => {
      const frame = fighter.frames[pose];
      if (frame.dataUrl) {
        return [pose, frame.dataUrl] as const;
      }
      if (!frame.blobId) {
        return [pose, ""] as const;
      }
      const blob = await db.get("imageBlobs", frame.blobId);
      return [pose, blob ? URL.createObjectURL(blob) : ""] as const;
    }),
  );

  const voicePairs = await Promise.all(
    Object.entries(fighter.voiceClips).map(async ([clip, blobId]) => {
      if (!blobId) {
        return [clip, undefined] as const;
      }
      const blob = await db.get("audioBlobs", blobId);
      return [clip, blob ? URL.createObjectURL(blob) : undefined] as const;
    }),
  );

  return {
    ...fighter,
    frameUrls: Object.fromEntries(framePairs) as LoadedFighter["frameUrls"],
    voiceUrls: Object.fromEntries(voicePairs.filter(([, url]) => Boolean(url))) as Partial<Record<VoiceClipType, string>>,
  };
}

function loadBattleBackground(
  record: BattleBackgroundRecord,
  blob: Blob,
  layerBlobs: Map<string, Blob> = new Map(),
): LoadedBattleBackground {
  const layers = record.layers
    ?.map((layer): LoadedBattleBackgroundLayer | undefined => {
      const layerBlob = layerBlobs.get(layer.blobId);
      if (!layerBlob) {
        return undefined;
      }
      return {
        ...layer,
        imageUrl: URL.createObjectURL(layerBlob),
      };
    })
    .filter((layer): layer is LoadedBattleBackgroundLayer => Boolean(layer));
  return {
    ...record,
    imageUrl: URL.createObjectURL(blob),
    layers: layers?.length ? layers : undefined,
  };
}

async function loadBattleBackgroundLayerBlobs(record: BattleBackgroundRecord) {
  const db = await getDb();
  const pairs = await Promise.all(
    (record.layers ?? []).map(async (layer) => {
      const blob = await db.get("imageBlobs", layer.blobId);
      return blob ? ([layer.blobId, blob] as const) : undefined;
    }),
  );
  return new Map(pairs.filter((pair): pair is readonly [string, Blob] => Boolean(pair)));
}

function isSupportedBattleBackgroundFile(file: File) {
  return BATTLE_BACKGROUND_MIME_TYPES.has(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function isBattlePostEffect(value: unknown): value is BattlePostEffect {
  return typeof value === "string" && BATTLE_POST_EFFECTS.includes(value as BattlePostEffect);
}

function dedupePostEffects(values: unknown[]): BattlePostEffect[] {
  return values.filter(isBattlePostEffect).filter((effect, index, effects) => effects.indexOf(effect) === index);
}

function getImageMimeTypeFromName(filename: string) {
  if (/\.png$/i.test(filename)) {
    return "image/png";
  }
  if (/\.jpe?g$/i.test(filename)) {
    return "image/jpeg";
  }
  if (/\.webp$/i.test(filename)) {
    return "image/webp";
  }
  return undefined;
}

function cleanBackgroundName(filename: string) {
  const basename = filename.replace(/\.[^.]+$/, "");
  const cleaned = basename.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, 48) : "Custom Background";
}

async function createBackgroundDepthLayers(file: File): Promise<GeneratedBattleBackgroundLayer[]> {
  try {
    return await createBattleBackgroundDepthLayersFromBlob(file);
  } catch {
    return [];
  }
}

function getBattleBackgroundLayerBlobId(id: BattleBackgroundDepthLayerId) {
  return `${BATTLE_BACKGROUND_LAYER_BLOB_ID_PREFIX}:${id}`;
}

async function fighterFrameToBlob(frame: FighterProfile["frames"][FighterPose]): Promise<Blob> {
  if (frame.dataUrl) {
    return dataUrlToBlob(frame.dataUrl);
  }
  if (!frame.blobId) {
    throw missingPoseImageError(frame.pose);
  }
  const db = await getDb();
  const blob = await db.get("imageBlobs", frame.blobId);
  if (!blob) {
    throw missingPoseImageError(frame.pose);
  }
  return blob;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new AppError("error.fighterImageRead");
  }
  return response.blob();
}

function isBattleBackgroundRecord(value: unknown): value is BattleBackgroundRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.id === "custom" &&
    typeof record.name === "string" &&
    typeof record.blobId === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.size === "number" &&
    typeof record.updatedAt === "string" &&
    (record.layers === undefined || (Array.isArray(record.layers) && record.layers.every(isBattleBackgroundLayerRecord)))
  );
}

function isBattleBackgroundLayerRecord(value: unknown): value is BattleBackgroundLayerRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const layer = value as Partial<BattleBackgroundLayerRecord>;
  return (
    typeof layer.id === "string" &&
    BATTLE_BACKGROUND_DEPTH_LAYERS.includes(layer.id as BattleBackgroundDepthLayerId) &&
    typeof layer.blobId === "string" &&
    typeof layer.mimeType === "string" &&
    typeof layer.size === "number" &&
    typeof layer.depth === "number" &&
    typeof layer.scale === "number" &&
    typeof layer.offsetX === "number" &&
    typeof layer.offsetY === "number" &&
    typeof layer.opacity === "number"
  );
}
