import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BattleDisplayEffect,
  BattlePostEffect,
  FighterPose,
  FighterProfile,
  LoadedBattleBackground,
  LoadedFighter,
  VoiceClipType,
} from "../types/game";
import { BATTLE_POST_EFFECTS, FIGHTER_POSES } from "../types/game";
import { getDefaultFighters } from "../game/content/defaultFighters";

export const BATTLE_BACKGROUND_IMPORT_ACCEPT = "image/png,image/jpeg,image/webp";
export const DEFAULT_BATTLE_DISPLAY_EFFECT: BattleDisplayEffect = "crt-soft";
export const DEFAULT_BATTLE_POST_EFFECTS: BattlePostEffect[] = [DEFAULT_BATTLE_DISPLAY_EFFECT];

const BATTLE_BACKGROUND_SETTING_KEY = "battle-background";
const BATTLE_DISPLAY_EFFECT_SETTING_KEY = "battle-display-effect";
const BATTLE_POST_EFFECTS_SETTING_KEY = "battle-post-effects";
const BATTLE_BACKGROUND_BLOB_ID = "battle-background:current";
const BATTLE_BACKGROUND_MAX_BYTES = 10 * 1024 * 1024;
const BATTLE_BACKGROUND_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface BattleBackgroundRecord {
  id: "custom";
  name: string;
  blobId: string;
  mimeType: string;
  size: number;
  updatedAt: string;
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
  name: string;
  frameBlobs: Record<FighterPose, Blob>;
  voiceBlobs: Partial<Record<VoiceClipType, Blob>>;
}): Promise<FighterProfile> {
  return saveFighterAssets(input);
}

export async function saveImportedFighter(input: {
  name: string;
  frameBlobs: Record<FighterPose, Blob>;
  voiceBlobs?: Partial<Record<VoiceClipType, Blob>>;
}): Promise<FighterProfile> {
  return saveFighterAssets({
    name: input.name,
    frameBlobs: input.frameBlobs,
    voiceBlobs: input.voiceBlobs ?? {},
  });
}

async function saveFighterAssets(input: {
  name: string;
  frameBlobs: Record<FighterPose, Blob>;
  voiceBlobs: Partial<Record<VoiceClipType, Blob>>;
}): Promise<FighterProfile> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const tx = db.transaction(["fighters", "imageBlobs", "audioBlobs"], "readwrite");

  const frames = Object.fromEntries(
    await Promise.all(
      FIGHTER_POSES.map(async (pose) => {
        const blob = input.frameBlobs[pose];
        const blobId = `${id}:frame:${pose}`;
        await tx.objectStore("imageBlobs").put(blob, blobId);
        return [
          pose,
          {
            pose,
            blobId,
            anchor: { x: 0.5, y: 0.9 },
            width: 384,
            height: 384,
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

  const fighter: FighterProfile = {
    id,
    name: input.name.trim() || "New Fighter",
    createdAt: now,
    updatedAt: now,
    frames,
    voiceClips,
    movesetId: "basic-v1",
  };

  await tx.objectStore("fighters").put(fighter);
  await tx.done;
  return fighter;
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
  return blob ? loadBattleBackground(record, blob) : undefined;
}

export async function saveBattleBackgroundImage(file: File): Promise<LoadedBattleBackground> {
  if (!isSupportedBattleBackgroundFile(file)) {
    throw new Error("Choose a PNG, JPEG, or WebP background image.");
  }
  if (file.size > BATTLE_BACKGROUND_MAX_BYTES) {
    throw new Error("Choose a background image under 10 MB.");
  }

  const db = await getDb();
  const now = new Date().toISOString();
  const record: BattleBackgroundRecord = {
    id: "custom",
    name: cleanBackgroundName(file.name),
    blobId: BATTLE_BACKGROUND_BLOB_ID,
    mimeType: file.type || getImageMimeTypeFromName(file.name) || "image/png",
    size: file.size,
    updatedAt: now,
  };
  const tx = db.transaction(["imageBlobs", "settings"], "readwrite");
  await Promise.all([
    tx.objectStore("imageBlobs").put(file, BATTLE_BACKGROUND_BLOB_ID),
    tx.objectStore("settings").put(record, BATTLE_BACKGROUND_SETTING_KEY),
  ]);
  await tx.done;
  return loadBattleBackground(record, file);
}

export async function clearBattleBackgroundImage(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["imageBlobs", "settings"], "readwrite");
  await Promise.all([
    tx.objectStore("imageBlobs").delete(BATTLE_BACKGROUND_BLOB_ID),
    tx.objectStore("settings").delete(BATTLE_BACKGROUND_SETTING_KEY),
  ]);
  await tx.done;
}

export async function getBattleDisplayEffect(): Promise<BattleDisplayEffect> {
  const effects = await getBattlePostEffects();
  return effects[0] ?? "clean";
}

export async function getBattlePostEffects(): Promise<BattlePostEffect[]> {
  const db = await getDb();
  const effectsValue = await db.get("settings", BATTLE_POST_EFFECTS_SETTING_KEY);
  if (Array.isArray(effectsValue)) {
    const effects = dedupePostEffects(effectsValue);
    return effects.length > 0 ? effects : [];
  }

  const value = await db.get("settings", BATTLE_DISPLAY_EFFECT_SETTING_KEY);
  if (isBattlePostEffect(value)) {
    return [value];
  }
  if (value === "clean") {
    return [];
  }
  return DEFAULT_BATTLE_POST_EFFECTS;
}

export async function setBattleDisplayEffect(effect: BattleDisplayEffect): Promise<void> {
  await setBattlePostEffects(effect === "clean" ? [] : [effect]);
}

export async function setBattlePostEffects(effects: BattlePostEffect[]): Promise<void> {
  const db = await getDb();
  await db.put("settings", dedupePostEffects(effects), BATTLE_POST_EFFECTS_SETTING_KEY);
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

function loadBattleBackground(record: BattleBackgroundRecord, blob: Blob): LoadedBattleBackground {
  return {
    ...record,
    imageUrl: URL.createObjectURL(blob),
  };
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
    typeof record.updatedAt === "string"
  );
}
