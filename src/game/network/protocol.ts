import type {
  ActionSnapshot,
  BattleBackgroundDepthLayerId,
  FighterFrameCollision,
  FighterPose,
  FrameAnchor,
  PlayerSlot,
  VoiceClipType,
} from "../../types/game";

export const NETPLAY_PROTOCOL_VERSION = 4;
export const NETPLAY_INPUT_DELAY = 10;
export const NETPLAY_REPEAT_FRAMES = 24;
export const NETPLAY_CHECKSUM_INTERVAL = 30;

export type OnlineRole = "host" | "guest";

export interface SignalCodePayload {
  version: typeof NETPLAY_PROTOCOL_VERSION;
  role: OnlineRole;
  description: RTCSessionDescriptionInit;
}

export interface NetworkFighterFrameAsset {
  pose: FighterPose;
  assetId: string;
  mimeType: string;
  byteLength: number;
  anchor: FrameAnchor;
  width: number;
  height: number;
  collision?: FighterFrameCollision;
}

export interface NetworkVoiceClipAsset {
  clip: VoiceClipType;
  assetId: string;
  mimeType: string;
  byteLength: number;
}

export interface NetworkFighterManifest {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  movesetId: "basic-v1";
  isDefault?: boolean;
  totalBytes: number;
  frames: Record<FighterPose, NetworkFighterFrameAsset>;
  voiceClips: Partial<Record<VoiceClipType, NetworkVoiceClipAsset>>;
}

export interface NetworkBattleBackgroundAsset {
  assetId: string;
  mimeType: string;
  byteLength: number;
}

export interface NetworkBattleBackgroundLayerAsset extends NetworkBattleBackgroundAsset {
  layerId: BattleBackgroundDepthLayerId;
  source: "depth-bands-v2";
  depth: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

export interface NetworkBattleBackgroundManifest {
  id: "default" | "custom";
  name: string;
  totalBytes: number;
  updatedAt?: string;
  asset?: NetworkBattleBackgroundAsset;
  layers?: NetworkBattleBackgroundLayerAsset[];
}

export interface NetworkAssetChunkHeader {
  type: "assetChunk";
  assetId: string;
  offset: number;
  chunkIndex: number;
  chunkCount: number;
  totalBytes: number;
  byteLength: number;
}

export interface NetworkAssetChunkMessage {
  header: NetworkAssetChunkHeader;
  payload: Uint8Array;
}

export type SetupMessage =
  | { type: "hello"; version: typeof NETPLAY_PROTOCOL_VERSION; role: OnlineRole; slot: PlayerSlot }
  | { type: "stageManifest"; background: NetworkBattleBackgroundManifest }
  | { type: "fighterManifest"; fighter: NetworkFighterManifest }
  | { type: "ready" }
  | { type: "checksum"; frame: number; checksum: string }
  | { type: "restart"; frame: number }
  | { type: "exit"; reason?: string }
  | { type: "error"; message: string };

export interface InputFramePayload {
  frame: number;
  slot: PlayerSlot;
  actions: ActionSnapshot;
}

export interface InputMessage {
  type: "input";
  frames: InputFramePayload[];
}

export type NetworkGameEvent =
  | { type: "checksum"; frame: number; checksum: string }
  | { type: "restart"; frame: number }
  | { type: "exit"; reason?: string }
  | { type: "error"; message: string }
  | { type: "closed" };

export function slotForRole(role: OnlineRole): PlayerSlot {
  return role === "host" ? "p1" : "p2";
}

export function oppositeSlot(slot: PlayerSlot): PlayerSlot {
  return slot === "p1" ? "p2" : "p1";
}
