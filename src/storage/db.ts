import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { FighterPose, FighterProfile, LoadedFighter, VoiceClipType } from "../types/game";
import { FIGHTER_POSES } from "../types/game";
import { getDefaultFighters } from "../game/content/defaultFighters";

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
