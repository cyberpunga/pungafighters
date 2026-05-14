import { describe, expect, it } from "vitest";
import type { RuntimeBattleBackground } from "../../types/game";
import { createAssetChunkEnvelope, parseAssetChunkEnvelope } from "./assetChunks";
import {
  NETWORK_BACKGROUND_ASSET_ID,
  NetworkBackgroundAssetReceiver,
  serializeBattleBackgroundForNetwork,
  type NetworkBackgroundTransferAsset,
} from "./backgroundTransfer";

const BACKGROUND_DATA_URL = "data:image/png;base64,AAECAwQFBgcICQ==";

describe("background network transfer", () => {
  it("sends default arena metadata without binary assets", async () => {
    const transfer = await serializeBattleBackgroundForNetwork(undefined);

    expect(transfer.manifest).toEqual({
      id: "default",
      name: "Default Arena",
      totalBytes: 0,
    });
    expect(transfer.assets).toHaveLength(0);
  });

  it("reassembles a chunked host background into a runtime background", async () => {
    const transfer = await serializeBattleBackgroundForNetwork(createBackground());
    const receiver = new NetworkBackgroundAssetReceiver(transfer.manifest);

    expect(JSON.stringify(transfer.manifest)).not.toContain("data:");
    expect(transfer.manifest.asset?.assetId).toBe(NETWORK_BACKGROUND_ASSET_ID);

    await receiveAsset(receiver, transfer.assets[0], 4);

    expect(receiver.isComplete()).toBe(true);
    const loaded = receiver.createRuntimeBackground();
    expect(loaded.background?.id).toBe("remote");
    expect(loaded.background?.name).toBe("Rooftop");
    expect(loaded.background?.imageUrl).toMatch(/^blob:/);
    loaded.revoke();
  });

  it("rejects out-of-order background chunks", async () => {
    const transfer = await serializeBattleBackgroundForNetwork(createBackground());
    const receiver = new NetworkBackgroundAssetReceiver(transfer.manifest);
    const asset = transfer.assets[0];
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    const payload = bytes.slice(2, 5);

    expect(() =>
      receiver.receiveChunk(
        {
          type: "assetChunk",
          assetId: asset.assetId,
          offset: 2,
          chunkIndex: 1,
          chunkCount: Math.ceil(asset.byteLength / 3),
          totalBytes: asset.byteLength,
          byteLength: payload.byteLength,
        },
        payload,
      ),
    ).toThrow("out of order");
  });

  it("rejects malformed default background manifests", () => {
    expect(
      () =>
        new NetworkBackgroundAssetReceiver({
          id: "default",
          name: "Default Arena",
          totalBytes: 1,
          asset: {
            assetId: NETWORK_BACKGROUND_ASSET_ID,
            mimeType: "image/png",
            byteLength: 1,
          },
        }),
    ).toThrow("invalid");
  });
});

async function receiveAsset(receiver: NetworkBackgroundAssetReceiver, asset: NetworkBackgroundTransferAsset, chunkBytes: number) {
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  const chunkCount = Math.ceil(bytes.byteLength / chunkBytes);
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const offset = chunkIndex * chunkBytes;
    const payload = bytes.slice(offset, offset + chunkBytes);
    const envelope = createAssetChunkEnvelope(
      {
        type: "assetChunk",
        assetId: asset.assetId,
        offset,
        chunkIndex,
        chunkCount,
        totalBytes: asset.byteLength,
        byteLength: payload.byteLength,
      },
      payload,
    );
    const parsed = await parseAssetChunkEnvelope(envelope);
    expect(parsed).toBeDefined();
    receiver.receiveChunk(parsed!.header, parsed!.payload);
  }
}

function createBackground(): RuntimeBattleBackground {
  return {
    id: "custom",
    name: "Rooftop",
    imageUrl: BACKGROUND_DATA_URL,
    mimeType: "image/png",
    size: 12,
    updatedAt: "2026-05-14T00:00:00.000Z",
  };
}
