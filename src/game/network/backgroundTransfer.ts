import type { RuntimeBattleBackground } from "../../types/game";
import type { NetworkAssetChunkHeader, NetworkBattleBackgroundManifest } from "./protocol";

export const NETWORK_BACKGROUND_ASSET_ID = "stage:background";
export const NETWORK_BACKGROUND_MAX_BYTES = 10 * 1024 * 1024;

const SUPPORTED_BACKGROUND_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface NetworkBackgroundTransferAsset {
  assetId: string;
  blob: Blob;
  mimeType: string;
  byteLength: number;
}

export interface NetworkBackgroundTransfer {
  manifest: NetworkBattleBackgroundManifest;
  assets: NetworkBackgroundTransferAsset[];
  totalBytes: number;
}

interface ManifestAssetDescriptor {
  assetId: string;
  mimeType: string;
  byteLength: number;
}

export async function serializeBattleBackgroundForNetwork(background?: RuntimeBattleBackground): Promise<NetworkBackgroundTransfer> {
  if (!background?.imageUrl) {
    return {
      manifest: {
        id: "default",
        name: "Default Arena",
        totalBytes: 0,
      },
      assets: [],
      totalBytes: 0,
    };
  }

  const blob = await urlToBlob(background.imageUrl);
  const mimeType = blob.type || background.mimeType;
  const asset = createTransferAsset(NETWORK_BACKGROUND_ASSET_ID, blob, mimeType);
  if (asset.byteLength <= 0) {
    throw new Error("Could not prepare the battle background for online play.");
  }
  if (!isSupportedBackgroundMimeType(asset.mimeType)) {
    throw new Error("Online battle backgrounds must be PNG, JPEG, or WebP images.");
  }
  if (asset.byteLength > NETWORK_BACKGROUND_MAX_BYTES) {
    throw new Error(`Online battle backgrounds must be under ${formatBytes(NETWORK_BACKGROUND_MAX_BYTES)}.`);
  }

  return {
    manifest: {
      id: "custom",
      name: cleanBackgroundName(background.name),
      updatedAt: background.updatedAt,
      totalBytes: asset.byteLength,
      asset: {
        assetId: asset.assetId,
        mimeType: asset.mimeType,
        byteLength: asset.byteLength,
      },
    },
    assets: [asset],
    totalBytes: asset.byteLength,
  };
}

export class NetworkBackgroundAssetReceiver {
  readonly manifest: NetworkBattleBackgroundManifest;
  private assembler?: AssetAssembler;

  constructor(manifest: NetworkBattleBackgroundManifest) {
    validateBackgroundManifest(manifest);
    this.manifest = manifest;
    if (manifest.asset) {
      this.assembler = new AssetAssembler(manifest.asset);
    }
  }

  hasAsset(assetId: string) {
    return this.assembler?.asset.assetId === assetId;
  }

  receiveChunk(header: NetworkAssetChunkHeader, payload: Uint8Array) {
    if (!this.assembler || this.assembler.asset.assetId !== header.assetId) {
      throw new Error("Received an unknown background asset chunk.");
    }
    this.assembler.receive(header, payload);
  }

  isComplete() {
    return !this.assembler || this.assembler.isComplete();
  }

  getProgress() {
    return {
      receivedBytes: this.assembler?.receivedBytes ?? 0,
      totalBytes: this.manifest.totalBytes,
    };
  }

  createRuntimeBackground(): { background?: RuntimeBattleBackground; revoke: () => void } {
    if (this.manifest.id === "default") {
      return { background: undefined, revoke: () => undefined };
    }
    if (!this.assembler?.isComplete() || !this.manifest.asset) {
      throw new Error("Host background asset is incomplete.");
    }

    const url = URL.createObjectURL(this.assembler.createBlob());
    return {
      background: {
        id: "remote",
        name: this.manifest.name,
        imageUrl: url,
        mimeType: this.manifest.asset.mimeType,
        size: this.manifest.asset.byteLength,
        updatedAt: this.manifest.updatedAt ?? new Date().toISOString(),
      },
      revoke: () => URL.revokeObjectURL(url),
    };
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
      throw new Error("Received extra background asset data.");
    }
    if (header.totalBytes !== this.asset.byteLength || header.byteLength !== payload.byteLength) {
      throw new Error("Received a malformed background asset chunk.");
    }
    if (header.chunkIndex !== this.chunks.length || header.offset !== this.receivedBytes) {
      throw new Error("Received background asset chunks out of order.");
    }
    if (this.chunkCount !== undefined && header.chunkCount !== this.chunkCount) {
      throw new Error("Received a malformed background asset chunk.");
    }
    if (header.offset + payload.byteLength > this.asset.byteLength) {
      throw new Error("Received too much background asset data.");
    }

    this.chunkCount = header.chunkCount;
    this.chunks.push(new Uint8Array(payload));
    this.receivedBytes += payload.byteLength;

    if (this.receivedBytes < this.asset.byteLength && this.chunks.length >= header.chunkCount) {
      throw new Error("Received incomplete background asset data.");
    }
    if (this.receivedBytes === this.asset.byteLength && this.chunks.length !== header.chunkCount) {
      throw new Error("Received incomplete background asset data.");
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

function validateBackgroundManifest(manifest: NetworkBattleBackgroundManifest) {
  if (!manifest || typeof manifest !== "object" || typeof manifest.name !== "string") {
    throw new Error("Host background manifest is invalid.");
  }
  if (manifest.id === "default") {
    if (manifest.totalBytes !== 0 || manifest.asset) {
      throw new Error("Host background manifest is invalid.");
    }
    return;
  }
  if (manifest.id !== "custom" || !manifest.asset || manifest.totalBytes !== manifest.asset.byteLength) {
    throw new Error("Host background manifest is invalid.");
  }
  if (manifest.asset.assetId !== NETWORK_BACKGROUND_ASSET_ID || !isManifestAsset(manifest.asset)) {
    throw new Error("Host background manifest is invalid.");
  }
  if (!isSupportedBackgroundMimeType(manifest.asset.mimeType)) {
    throw new Error("Host background image type is unsupported.");
  }
  if (manifest.totalBytes > NETWORK_BACKGROUND_MAX_BYTES) {
    throw new Error(`Host background is ${formatBytes(manifest.totalBytes)}. Online battle backgrounds must be under ${formatBytes(NETWORK_BACKGROUND_MAX_BYTES)}.`);
  }
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

function createTransferAsset(assetId: string, blob: Blob, fallbackMimeType: string): NetworkBackgroundTransferAsset {
  return {
    assetId,
    blob,
    mimeType: blob.type || fallbackMimeType || "image/png",
    byteLength: blob.size,
  };
}

function isSupportedBackgroundMimeType(mimeType: string) {
  return SUPPORTED_BACKGROUND_MIME_TYPES.has(mimeType);
}

function cleanBackgroundName(name: string) {
  const cleaned = name.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, 48) : "Custom Background";
}

async function urlToBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Could not load battle background.");
  }
  return response.blob();
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
