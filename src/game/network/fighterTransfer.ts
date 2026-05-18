import type { FighterPose, FighterProfile, LoadedFighter, VoiceClipType } from "../../types/game";
import { FIGHTER_POSES, VOICE_CLIPS } from "../../types/game";
import { AppError } from "../../i18n/errors";
import type { NetworkAssetChunkHeader, NetworkFighterManifest } from "./protocol";

export const NETWORK_ASSET_CHUNK_BYTES = 16 * 1024;
export const NETWORK_FIGHTER_MAX_BYTES = 12 * 1024 * 1024;

export interface NetworkFighterTransferAsset {
  assetId: string;
  blob: Blob;
  mimeType: string;
  byteLength: number;
}

export interface NetworkFighterTransfer {
  manifest: NetworkFighterManifest;
  assets: NetworkFighterTransferAsset[];
  totalBytes: number;
}

interface ManifestAssetDescriptor {
  assetId: string;
  mimeType: string;
  byteLength: number;
}

export async function serializeFighterForNetwork(fighter: LoadedFighter): Promise<NetworkFighterTransfer> {
  const frameResults = await Promise.all(
    FIGHTER_POSES.map(async (pose) => {
      const frame = fighter.frames[pose];
      const rawBlob = await urlToBlob(frame.dataUrl || fighter.frameUrls[pose]);
      const blob = await maybeReencodeFrameBlob(rawBlob);
      if (blob.size <= 0) {
        throw new Error(`Could not prepare the ${pose} frame for online play.`);
      }
      const assetId = `frame:${pose}`;
      const asset = createTransferAsset(assetId, blob, "image/png");
      return {
        pose,
        asset,
        manifest: {
          pose,
          assetId,
          mimeType: asset.mimeType,
          byteLength: asset.byteLength,
          anchor: frame.anchor,
          width: frame.width,
          height: frame.height,
        },
      };
    }),
  );

  const voiceResults = (
    await Promise.all(
      VOICE_CLIPS.map(async (clip) => {
        const url = fighter.voiceUrls[clip];
        if (!url) {
          return undefined;
        }
        const blob = await urlToBlob(url);
        if (blob.size <= 0) {
          return undefined;
        }
        const assetId = `voice:${clip}`;
        const asset = createTransferAsset(assetId, blob, "audio/webm");
        return {
          clip,
          asset,
          manifest: {
            clip,
            assetId,
            mimeType: asset.mimeType,
            byteLength: asset.byteLength,
          },
        };
      }),
    )
  ).filter(isDefined);

  const assets = [...frameResults.map((result) => result.asset), ...voiceResults.map((result) => result.asset)];
  const totalBytes = assets.reduce((total, asset) => total + asset.byteLength, 0);
  if (totalBytes > NETWORK_FIGHTER_MAX_BYTES) {
    throw new Error(`This fighter is ${formatBytes(totalBytes)}. Online fighters must be under ${formatBytes(NETWORK_FIGHTER_MAX_BYTES)}.`);
  }

  const manifest: NetworkFighterManifest = {
    id: fighter.id,
    name: fighter.name,
    createdAt: fighter.createdAt,
    updatedAt: fighter.updatedAt,
    movesetId: fighter.movesetId,
    isDefault: fighter.isDefault,
    totalBytes,
    frames: Object.fromEntries(frameResults.map((result) => [result.pose, result.manifest])) as NetworkFighterManifest["frames"],
    voiceClips: Object.fromEntries(voiceResults.map((result) => [result.clip, result.manifest])) as NetworkFighterManifest["voiceClips"],
  };

  return {
    manifest,
    assets,
    totalBytes,
  };
}

export class NetworkFighterAssetReceiver {
  readonly manifest: NetworkFighterManifest;
  private readonly assemblers = new Map<string, AssetAssembler>();
  private receivedBytes = 0;

  constructor(manifest: NetworkFighterManifest) {
    validateFighterManifest(manifest);
    this.manifest = manifest;
    getManifestAssets(manifest).forEach((asset) => {
      this.assemblers.set(asset.assetId, new AssetAssembler(asset));
    });
  }

  hasAsset(assetId: string) {
    return this.assemblers.has(assetId);
  }

  receiveChunk(header: NetworkAssetChunkHeader, payload: Uint8Array) {
    const assembler = this.assemblers.get(header.assetId);
    if (!assembler) {
      throw new Error("Received an unknown fighter asset chunk.");
    }

    const before = assembler.receivedBytes;
    assembler.receive(header, payload);
    this.receivedBytes += assembler.receivedBytes - before;
  }

  isComplete() {
    return Array.from(this.assemblers.values()).every((assembler) => assembler.isComplete());
  }

  getProgress() {
    return {
      receivedBytes: this.receivedBytes,
      totalBytes: this.manifest.totalBytes,
    };
  }

  createLoadedFighter(): { fighter: LoadedFighter; revoke: () => void } {
    if (!this.isComplete()) {
      throw new Error("Opponent fighter assets are incomplete.");
    }

    const objectUrls: string[] = [];
    const frameUrlPairs = FIGHTER_POSES.map((pose) => {
      const frame = this.manifest.frames[pose];
      const url = URL.createObjectURL(this.getBlob(frame.assetId));
      objectUrls.push(url);
      return [pose, url] as const;
    });
    const voiceUrlPairs = VOICE_CLIPS.map((clip) => {
      const voice = this.manifest.voiceClips[clip];
      if (!voice) {
        return undefined;
      }
      const url = URL.createObjectURL(this.getBlob(voice.assetId));
      objectUrls.push(url);
      return [clip, url] as const;
    }).filter(isDefined);

    const frames = Object.fromEntries(
      FIGHTER_POSES.map((pose) => {
        const frame = this.manifest.frames[pose];
        return [
          pose,
          {
            pose,
            anchor: frame.anchor,
            width: frame.width,
            height: frame.height,
          },
        ] as const;
      }),
    ) as FighterProfile["frames"];

    return {
      fighter: {
        id: this.manifest.id,
        name: this.manifest.name,
        createdAt: this.manifest.createdAt,
        updatedAt: this.manifest.updatedAt,
        frames,
        frameUrls: Object.fromEntries(frameUrlPairs) as LoadedFighter["frameUrls"],
        voiceClips: {},
        voiceUrls: Object.fromEntries(voiceUrlPairs) as LoadedFighter["voiceUrls"],
        movesetId: this.manifest.movesetId,
        isDefault: this.manifest.isDefault,
      },
      revoke: () => objectUrls.forEach((url) => URL.revokeObjectURL(url)),
    };
  }

  private getBlob(assetId: string) {
    const assembler = this.assemblers.get(assetId);
    if (!assembler?.isComplete()) {
      throw new Error("Opponent fighter assets are incomplete.");
    }
    return assembler.createBlob();
  }
}

class AssetAssembler {
  readonly asset: ManifestAssetDescriptor;
  readonly chunks: Uint8Array[] = [];
  receivedBytes = 0;
  private chunkCount?: number;

  constructor(asset: ManifestAssetDescriptor) {
    this.asset = asset;
  }

  receive(header: NetworkAssetChunkHeader, payload: Uint8Array) {
    if (this.isComplete()) {
      throw new Error("Received extra fighter asset data.");
    }
    if (header.totalBytes !== this.asset.byteLength || header.byteLength !== payload.byteLength) {
      throw new Error("Received a malformed fighter asset chunk.");
    }
    if (header.chunkIndex !== this.chunks.length || header.offset !== this.receivedBytes) {
      throw new Error("Received fighter asset chunks out of order.");
    }
    if (this.chunkCount !== undefined && header.chunkCount !== this.chunkCount) {
      throw new Error("Received a malformed fighter asset chunk.");
    }
    if (header.offset + payload.byteLength > this.asset.byteLength) {
      throw new Error("Received too much fighter asset data.");
    }

    this.chunkCount = header.chunkCount;
    this.chunks.push(new Uint8Array(payload));
    this.receivedBytes += payload.byteLength;

    if (this.receivedBytes < this.asset.byteLength && this.chunks.length >= header.chunkCount) {
      throw new Error("Received incomplete fighter asset data.");
    }
    if (this.receivedBytes === this.asset.byteLength && this.chunks.length !== header.chunkCount) {
      throw new Error("Received incomplete fighter asset data.");
    }
  }

  isComplete() {
    return this.receivedBytes === this.asset.byteLength;
  }

  createBlob() {
    const parts: BlobPart[] = this.chunks.map((chunk) => Uint8Array.from(chunk).buffer as ArrayBuffer);
    return new Blob(parts, { type: this.asset.mimeType });
  }
}

function validateFighterManifest(manifest: NetworkFighterManifest) {
  if (!manifest || typeof manifest !== "object" || manifest.movesetId !== "basic-v1") {
    throw new Error("Opponent fighter manifest is invalid.");
  }
  if (!manifest.frames || !FIGHTER_POSES.every((pose) => isManifestAsset(manifest.frames[pose]) && manifest.frames[pose].pose === pose)) {
    throw new Error("Opponent fighter manifest is invalid.");
  }
  if (
    manifest.voiceClips &&
    !VOICE_CLIPS.every((clip) => {
      const voice = manifest.voiceClips[clip];
      return !voice || (isManifestAsset(voice) && voice.clip === clip);
    })
  ) {
    throw new Error("Opponent fighter manifest is invalid.");
  }
  const assets = getManifestAssets(manifest);
  if (assets.length < FIGHTER_POSES.length || manifest.totalBytes !== assets.reduce((total, asset) => total + asset.byteLength, 0)) {
    throw new Error("Opponent fighter manifest is invalid.");
  }
  if (manifest.totalBytes > NETWORK_FIGHTER_MAX_BYTES) {
    throw new Error(`Opponent fighter is ${formatBytes(manifest.totalBytes)}. Online fighters must be under ${formatBytes(NETWORK_FIGHTER_MAX_BYTES)}.`);
  }

  const assetIds = new Set<string>();
  assets.forEach((asset) => {
    if (!asset.assetId || !asset.mimeType || !Number.isSafeInteger(asset.byteLength) || asset.byteLength <= 0 || assetIds.has(asset.assetId)) {
      throw new Error("Opponent fighter manifest is invalid.");
    }
    assetIds.add(asset.assetId);
  });
}

function getManifestAssets(manifest: NetworkFighterManifest): ManifestAssetDescriptor[] {
  const frameAssets = FIGHTER_POSES.map((pose) => manifest.frames?.[pose]);
  const voiceAssets = VOICE_CLIPS.map((clip) => manifest.voiceClips?.[clip]).filter(isDefined);
  return [...frameAssets, ...voiceAssets].filter(isDefined).map((asset) => ({
    assetId: asset.assetId,
    mimeType: asset.mimeType,
    byteLength: asset.byteLength,
  }));
}

function isManifestAsset(value: unknown): value is ManifestAssetDescriptor {
  if (!value || typeof value !== "object") {
    return false;
  }
  const asset = value as Partial<ManifestAssetDescriptor>;
  return (
    typeof asset.assetId === "string" &&
    typeof asset.mimeType === "string" &&
    typeof asset.byteLength === "number" &&
    Number.isSafeInteger(asset.byteLength) &&
    asset.byteLength > 0
  );
}

function createTransferAsset(assetId: string, blob: Blob, fallbackMimeType: string): NetworkFighterTransferAsset {
  return {
    assetId,
    blob,
    mimeType: blob.type || fallbackMimeType,
    byteLength: blob.size,
  };
}

async function maybeReencodeFrameBlob(blob: Blob): Promise<Blob> {
  if (!blob.type.startsWith("image/") || typeof document === "undefined") {
    return blob;
  }

  try {
    const webp = await encodeImageBlob(blob, "image/webp", 0.88);
    return webp && webp.type === "image/webp" && webp.size > 0 && webp.size < blob.size ? webp : blob;
  } catch {
    return blob;
  }
}

async function encodeImageBlob(blob: Blob, mimeType: string, quality: number): Promise<Blob | undefined> {
  const image = await decodeImageBlob(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }
    ctx.drawImage(image.source, 0, 0);
    return await canvasToBlob(canvas, mimeType, quality);
  } finally {
    image.close();
  }
}

async function decodeImageBlob(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new AppError("error.fighterFrameRead")), { once: true });
    image.src = url;
  });
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    close: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), mimeType, quality);
  });
}

async function urlToBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError("error.fighterAssetLoad");
  }
  return response.blob();
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
