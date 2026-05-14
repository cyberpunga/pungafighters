import type { NetworkAssetChunkHeader, NetworkAssetChunkMessage } from "./protocol";

const HEADER_LENGTH_BYTES = 4;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createAssetChunkEnvelope(header: NetworkAssetChunkHeader, payload: Uint8Array): ArrayBuffer {
  const headerBytes = encoder.encode(JSON.stringify(header));
  const envelope = new Uint8Array(HEADER_LENGTH_BYTES + headerBytes.byteLength + payload.byteLength);
  const view = new DataView(envelope.buffer);
  view.setUint32(0, headerBytes.byteLength, false);
  envelope.set(headerBytes, HEADER_LENGTH_BYTES);
  envelope.set(payload, HEADER_LENGTH_BYTES + headerBytes.byteLength);
  return envelope.buffer;
}

export async function parseAssetChunkEnvelope(input: ArrayBuffer | Blob): Promise<NetworkAssetChunkMessage | undefined> {
  const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : new Uint8Array(input);
  if (bytes.byteLength < HEADER_LENGTH_BYTES) {
    return undefined;
  }

  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, HEADER_LENGTH_BYTES).getUint32(0, false);
  const payloadOffset = HEADER_LENGTH_BYTES + headerLength;
  if (headerLength <= 0 || payloadOffset > bytes.byteLength) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes.subarray(HEADER_LENGTH_BYTES, payloadOffset)));
  } catch {
    return undefined;
  }

  if (!isAssetChunkHeader(parsed)) {
    return undefined;
  }

  return {
    header: parsed,
    payload: bytes.subarray(payloadOffset),
  };
}

function isAssetChunkHeader(value: unknown): value is NetworkAssetChunkHeader {
  if (!value || typeof value !== "object") {
    return false;
  }
  const header = value as Partial<NetworkAssetChunkHeader>;
  return (
    header.type === "assetChunk" &&
    typeof header.assetId === "string" &&
    isSafeNonNegativeInteger(header.offset) &&
    isSafeNonNegativeInteger(header.chunkIndex) &&
    isSafePositiveInteger(header.chunkCount) &&
    isSafePositiveInteger(header.totalBytes) &&
    isSafePositiveInteger(header.byteLength)
  );
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
