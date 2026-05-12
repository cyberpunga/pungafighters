export const FIGHTER_POSES = ["idle", "punch", "kick", "hit", "victory"] as const;
export const VOICE_CLIPS = ["attack", "hit", "win"] as const;

export type FighterPose = (typeof FIGHTER_POSES)[number];
export type VoiceClipType = (typeof VOICE_CLIPS)[number];

export type InputAction =
  | "left"
  | "right"
  | "jump"
  | "block"
  | "punch"
  | "kick"
  | "special"
  | "pause";

export type PlayerSlot = "p1" | "p2";

export interface FrameAnchor {
  x: number;
  y: number;
}

export interface FighterFrame {
  pose: FighterPose;
  blobId?: string;
  dataUrl?: string;
  anchor: FrameAnchor;
  width: number;
  height: number;
}

export interface FighterProfile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  frames: Record<FighterPose, FighterFrame>;
  voiceClips: Partial<Record<VoiceClipType, string>>;
  movesetId: "basic-v1";
  isDefault?: boolean;
}

export interface BattleConfig {
  playerOneFighterId: string;
  playerTwoFighterId: string;
  roundCount: 3;
  timerSeconds: 60;
  stageId: "dojo-v1";
}

export interface LoadedFighter extends FighterProfile {
  frameUrls: Record<FighterPose, string>;
  voiceUrls: Partial<Record<VoiceClipType, string>>;
}

export type ActionSnapshot = Record<InputAction, boolean>;
export type PlayerInputSnapshot = Record<PlayerSlot, ActionSnapshot>;
