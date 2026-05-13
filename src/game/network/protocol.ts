import type { ActionSnapshot, FighterPose, FrameAnchor, PlayerSlot, VoiceClipType } from "../../types/game";

export const NETPLAY_PROTOCOL_VERSION = 1;
export const NETPLAY_INPUT_DELAY = 10;
export const NETPLAY_REPEAT_FRAMES = 24;
export const NETPLAY_CHECKSUM_INTERVAL = 30;

export type OnlineRole = "host" | "guest";

export interface SignalCodePayload {
  version: typeof NETPLAY_PROTOCOL_VERSION;
  role: OnlineRole;
  description: RTCSessionDescriptionInit;
}

export interface NetworkFighterFrame {
  pose: FighterPose;
  dataUrl: string;
  anchor: FrameAnchor;
  width: number;
  height: number;
}

export interface NetworkVoiceClip {
  dataUrl: string;
}

export interface NetworkFighterPayload {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  movesetId: "basic-v1";
  isDefault?: boolean;
  frames: Record<FighterPose, NetworkFighterFrame>;
  voiceClips: Partial<Record<VoiceClipType, NetworkVoiceClip>>;
}

export type SetupMessage =
  | { type: "hello"; version: typeof NETPLAY_PROTOCOL_VERSION; role: OnlineRole; slot: PlayerSlot }
  | { type: "fighterPayload"; fighter: NetworkFighterPayload }
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
