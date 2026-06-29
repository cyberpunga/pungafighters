import type { BattleBackgroundDepthLayerId, RuntimeBattleBackground } from "../../types/game";
import { BATTLE_BACKGROUND_DEPTH_LAYERS } from "../../types/game";
import { AppError } from "../../i18n/errors";
import type { NetworkAssetChunkHeader, NetworkBattleBackgroundLayerAsset, NetworkBattleBackgroundManifest } from "./protocol";

export const NETWORK_BACKGROUND_ASSET_ID = "stage:background";
export const NETWORK_BACKGROUND_LAYER_ASSET_ID_PREFIX = "stage:background:layer";
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
    throw new AppError("error.backgroundPrepare");
  }
  if (!isSupportedBackgroundMimeType(asset.mimeType)) {
    throw new Error("Online battle backgrounds must be PNG, JPEG, or WebP images.");
  }
  if (asset.byteLength > NETWORK_BACKGROUND_MAX_BYTES) {
    throw new Error(`Online battle backgrounds must be under ${formatBytes(NETWORK_BACKGROUND_MAX_BYTES)}.`);
  }

  const layerTransfers = await prepareLayerTransfers(background);
  const layeredTotalBytes = asset.byteLength + layerTransfers.reduce((total, layer) => total + layer.asset.byteLength, 0);
  const includedLayerTransfers = layeredTotalBytes <= NETWORK_BACKGROUND_MAX_BYTES ? layerTransfers : [];
  const totalBytes = asset.byteLength + includedLayerTransfers.reduce((total, layer) => total + layer.asset.byteLength, 0);

  return {
    manifest: {
      id: "custom",
      name: cleanBackgroundName(background.name),
      updatedAt: background.updatedAt,
      totalBytes,
      asset: {
        assetId: asset.assetId,
        mimeType: asset.mimeType,
        byteLength: asset.byteLength,
      },
      layers: includedLayerTransfers.length
        ? includedLayerTransfers.map(({ asset, layer }) => ({
            assetId: asset.assetId,
            mimeType: asset.mimeType,
            byteLength: asset.byteLength,
            layerId: layer.id,
            depth: layer.depth,
            scale: layer.scale,
            offsetX: layer.offsetX,
            offsetY: layer.offsetY,
            opacity: layer.opacity,
          }))
        : undefined,
    },
    assets: [asset, ...includedLayerTransfers.map((layer) => layer.asset)],
    totalBytes,
  };
}

export class NetworkBackgroundAssetReceiver {
  readonly manifest: NetworkBattleBackgroundManifest;
  private readonly assemblers = new Map<string, AssetAssembler>();

  constructor(manifest: NetworkBattleBackgroundManifest) {
    validateBackgroundManifest(manifest);
    this.manifest = manifest;
    if (manifest.asset) {
      this.addAssembler(manifest.asset);
    }
    manifest.layers?.forEach((layer) => this.addAssembler(layer));
  }

  hasAsset(assetId: string) {
    return this.assemblers.has(assetId);
  }

  receiveChunk(header: NetworkAssetChunkHeader, payload: Uint8Array) {
    const assembler = this.assemblers.get(header.assetId);
    if (!assembler) {
      throw new Error("Received an unknown background asset chunk.");
    }
    assembler.receive(header, payload);
  }

  isComplete() {
    return this.assetAssemblers.every((assembler) => assembler.isComplete());
  }

  getProgress() {
    return {
      receivedBytes: this.assetAssemblers.reduce((total, assembler) => total + assembler.receivedBytes, 0),
      totalBytes: this.manifest.totalBytes,
    };
  }

  createRuntimeBackground(): { background?: RuntimeBattleBackground; revoke: () => void } {
    if (this.manifest.id === "default") {
      return { background: undefined, revoke: () => undefined };
    }
    if (!this.mainAssembler?.isComplete() || !this.manifest.asset || !this.isComplete()) {
      throw new Error("Host background asset is incomplete.");
    }

    const urls: string[] = [];
    const url = URL.createObjectURL(this.mainAssembler.createBlob());
    urls.push(url);
    const layers = this.manifest.layers
      ?.map((layer) => {
        const assembler = this.assemblers.get(layer.assetId);
        if (!assembler?.isComplete()) {
          return undefined;
        }
        const layerUrl = URL.createObjectURL(assembler.createBlob());
        urls.push(layerUrl);
        return {
          id: layer.layerId,
          imageUrl: layerUrl,
          mimeType: layer.mimeType,
          size: layer.byteLength,
          depth: layer.depth,
          scale: layer.scale,
          offsetX: layer.offsetX,
          offsetY: layer.offsetY,
          opacity: layer.opacity,
        };
      })
      .filter((layer): layer is NonNullable<typeof layer> => Boolean(layer));
    return {
      background: {
        id: "remote",
        name: this.manifest.name,
        imageUrl: url,
        mimeType: this.manifest.asset.mimeType,
        size: this.manifest.asset.byteLength,
        updatedAt: this.manifest.updatedAt ?? new Date().toISOString(),
        layers: layers?.length ? layers : undefined,
      },
      revoke: () => urls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl)),
    };
  }

  private addAssembler(asset: ManifestAssetDescriptor) {
    this.assemblers.set(asset.assetId, new AssetAssembler(asset));
  }

  private get mainAssembler() {
    return this.manifest.asset ? this.assemblers.get(this.manifest.asset.assetId) : undefined;
  }

  private get assetAssemblers() {
    return [...this.assemblers.values()];
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
    if (manifest.totalBytes !== 0 || manifest.asset || manifest.layers) {
      throw new Error("Host background manifest is invalid.");
    }
    return;
  }
  if (manifest.id !== "custom" || !manifest.asset) {
    throw new Error("Host background manifest is invalid.");
  }
  if (manifest.asset.assetId !== NETWORK_BACKGROUND_ASSET_ID || !isManifestAsset(manifest.asset)) {
    throw new Error("Host background manifest is invalid.");
  }
  const layers = manifest.layers ?? [];
  const assetIds = new Set([manifest.asset.assetId]);
  const layerIds = new Set<BattleBackgroundDepthLayerId>();
  for (const layer of layers) {
    if (!isLayerManifestAsset(layer) || assetIds.has(layer.assetId) || layerIds.has(layer.layerId)) {
      throw new Error("Host background manifest is invalid.");
    }
    assetIds.add(layer.assetId);
    layerIds.add(layer.layerId);
  }
  const totalBytes = manifest.asset.byteLength + layers.reduce((total, layer) => total + layer.byteLength, 0);
  if (manifest.totalBytes !== totalBytes) {
    throw new Error("Host background manifest is invalid.");
  }
  if (!isSupportedBackgroundMimeType(manifest.asset.mimeType)) {
    throw new Error("Host background image type is unsupported.");
  }
  if (layers.some((layer) => !isSupportedBackgroundMimeType(layer.mimeType))) {
    throw new Error("Host background image type is unsupported.");
  }
  if (manifest.totalBytes > NETWORK_BACKGROUND_MAX_BYTES) {
    throw new Error(`Host background is ${formatBytes(manifest.totalBytes)}. Online battle backgrounds must be under ${formatBytes(NETWORK_BACKGROUND_MAX_BYTES)}.`);
  }
}

function isLayerManifestAsset(value: unknown): value is NetworkBattleBackgroundLayerAsset {
  if (!isManifestAsset(value)) {
    return false;
  }
  const asset = value as Partial<NetworkBattleBackgroundLayerAsset>;
  return (
    typeof asset.layerId === "string" &&
    BATTLE_BACKGROUND_DEPTH_LAYERS.includes(asset.layerId as BattleBackgroundDepthLayerId) &&
    asset.assetId === getLayerAssetId(asset.layerId as BattleBackgroundDepthLayerId) &&
    typeof asset.depth === "number" &&
    typeof asset.scale === "number" &&
    typeof asset.offsetX === "number" &&
    typeof asset.offsetY === "number" &&
    typeof asset.opacity === "number"
  );
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

async function prepareLayerTransfers(background: RuntimeBattleBackground) {
  const transfers = await Promise.all(
    (background.layers ?? []).map(async (layer) => {
      try {
        const blob = await urlToBlob(layer.imageUrl);
        const asset = createTransferAsset(getLayerAssetId(layer.id), blob, blob.type || layer.mimeType);
        if (asset.byteLength <= 0 || !isSupportedBackgroundMimeType(asset.mimeType)) {
          return undefined;
        }
        return { layer, asset };
      } catch {
        return undefined;
      }
    }),
  );
  return transfers.filter((transfer): transfer is NonNullable<typeof transfer> => Boolean(transfer));
}

function getLayerAssetId(id: BattleBackgroundDepthLayerId) {
  return `${NETWORK_BACKGROUND_LAYER_ASSET_ID_PREFIX}:${id}`;
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
    throw new AppError("error.backgroundLoad");
  }
  return response.blob();
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
