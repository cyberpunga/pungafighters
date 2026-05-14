import { describe, expect, it } from "vitest";
import type { FighterProfile, LoadedFighter } from "../../types/game";
import { FIGHTER_POSES } from "../../types/game";
import { createAssetChunkEnvelope, parseAssetChunkEnvelope } from "./assetChunks";
import {
  NetworkFighterAssetReceiver,
  serializeFighterForNetwork,
  type NetworkFighterTransferAsset,
} from "./fighterTransfer";

const FRAME_DATA_URLS = [
  "data:image/png;base64,AAECAwQFBgcICQ==",
  "data:image/png;base64,CgsMDQ4PEBES",
  "data:image/png;base64,ExQVFhcYGRob",
  "data:image/png;base64,HB0eHyAhIiMk",
  "data:image/png;base64,JSYnKCkqKywt",
] as const;

const VOICE_DATA_URL = "data:audio/webm;base64,AQIDBAUGBwgJCg==";

describe("fighter network transfer", () => {
  it("creates a metadata-only manifest without embedded data urls", async () => {
    const transfer = await serializeFighterForNetwork(createLoadedFighter({ withVoice: true }));

    expect(JSON.stringify(transfer.manifest)).not.toContain("data:");
    expect(transfer.manifest.totalBytes).toBe(transfer.totalBytes);
    expect(transfer.assets).toHaveLength(FIGHTER_POSES.length + 1);
    expect(Object.values(transfer.manifest.frames).every((frame) => frame.assetId && frame.byteLength > 0)).toBe(true);
    expect(transfer.manifest.voiceClips.attack?.byteLength).toBeGreaterThan(0);
  });

  it("reassembles chunked fighter assets into a loaded remote fighter", async () => {
    const transfer = await serializeFighterForNetwork(createLoadedFighter({ withVoice: true }));
    const receiver = new NetworkFighterAssetReceiver(transfer.manifest);

    await receiveAllAssets(receiver, transfer.assets, 3);

    expect(receiver.isComplete()).toBe(true);
    const loaded = receiver.createLoadedFighter();
    expect(loaded.fighter.name).toBe("Chunk Champ");
    expect(Object.keys(loaded.fighter.frameUrls).sort()).toEqual([...FIGHTER_POSES].sort());
    expect(loaded.fighter.voiceUrls.attack).toMatch(/^blob:/);
    loaded.revoke();
  });

  it("rejects out-of-order chunks", async () => {
    const transfer = await serializeFighterForNetwork(createLoadedFighter());
    const receiver = new NetworkFighterAssetReceiver(transfer.manifest);
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

  it("rejects incomplete transfers before creating a loaded fighter", async () => {
    const transfer = await serializeFighterForNetwork(createLoadedFighter());
    const receiver = new NetworkFighterAssetReceiver(transfer.manifest);
    const asset = transfer.assets[0];
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    const payload = bytes.slice(0, 3);

    receiver.receiveChunk(
      {
        type: "assetChunk",
        assetId: asset.assetId,
        offset: 0,
        chunkIndex: 0,
        chunkCount: Math.ceil(asset.byteLength / 3),
        totalBytes: asset.byteLength,
        byteLength: payload.byteLength,
      },
      payload,
    );

    expect(receiver.isComplete()).toBe(false);
    expect(() => receiver.createLoadedFighter()).toThrow("incomplete");
  });
});

async function receiveAllAssets(receiver: NetworkFighterAssetReceiver, assets: NetworkFighterTransferAsset[], chunkBytes: number) {
  for (const asset of assets) {
    await receiveAsset(receiver, asset, chunkBytes);
  }
}

async function receiveAsset(receiver: NetworkFighterAssetReceiver, asset: NetworkFighterTransferAsset, chunkBytes: number) {
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

function createLoadedFighter(input: { withVoice?: boolean } = {}): LoadedFighter {
  const frameUrls = Object.fromEntries(FIGHTER_POSES.map((pose, index) => [pose, FRAME_DATA_URLS[index]])) as LoadedFighter["frameUrls"];
  const frames = Object.fromEntries(
    FIGHTER_POSES.map((pose) => [
      pose,
      {
        pose,
        dataUrl: frameUrls[pose],
        anchor: { x: 0.5, y: 0.9 },
        width: 384,
        height: 384,
      },
    ]),
  ) as FighterProfile["frames"];

  return {
    id: "test-fighter",
    name: "Chunk Champ",
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    frames,
    frameUrls,
    voiceClips: input.withVoice ? { attack: "voice:attack" } : {},
    voiceUrls: input.withVoice ? { attack: VOICE_DATA_URL } : {},
    movesetId: "basic-v1",
  };
}
