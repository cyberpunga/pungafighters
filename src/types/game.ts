export const FIGHTER_POSES = ["idle", "punch", "kick", "hit", "victory"] as const;
export const VOICE_CLIPS = ["attack", "hit", "win"] as const;
export const BATTLE_POST_EFFECTS = ["pixel", "bad-tv", "static", "crt-soft", "crt-strong", "lens"] as const;
export const BATTLE_DISPLAY_EFFECTS = ["clean", ...BATTLE_POST_EFFECTS] as const;
export const BATTLE_BACKGROUND_DEPTH_LAYERS = ["far", "mid", "near"] as const;

export type FighterPose = (typeof FIGHTER_POSES)[number];
export type VoiceClipType = (typeof VOICE_CLIPS)[number];
export type BattlePostEffect = (typeof BATTLE_POST_EFFECTS)[number];
export type BattleDisplayEffect = (typeof BATTLE_DISPLAY_EFFECTS)[number];
export type BattleBackgroundDepthLayerId = (typeof BATTLE_BACKGROUND_DEPTH_LAYERS)[number];

export interface PixelPostEffectConfig {
  enabled: boolean;
  granularity: number;
}

export interface BadTvPostEffectConfig {
  enabled: boolean;
  chromaticOffsetX: number;
  chromaticOffsetY: number;
  chromaticOpacity: number;
  distortion: number;
  distortion2: number;
  speed: number;
  rollSpeed: number;
}

export interface StaticPostEffectConfig {
  enabled: boolean;
  amount: number;
  size: number;
}

export interface CrtPostEffectConfig {
  enabled: boolean;
  hardScan: number;
  hardPix: number;
  warpX: number;
  warpY: number;
  maskDark: number;
  maskLight: number;
  scanlineDensity: number;
  scanlineOpacity: number;
}

export interface CrtStrongPostEffectConfig extends CrtPostEffectConfig {
  chromaticOffsetX: number;
  chromaticOffsetY: number;
  chromaticOpacity: number;
  dotScale: number;
  dotOpacity: number;
}

export interface LensPostEffectConfig {
  enabled: boolean;
  focusRange: number;
  bokehBase: number;
  motionBoost: number;
  hitBoost: number;
  superBoost: number;
  cameraOrbitAmount: number;
  cameraOrbitSpeed: number;
  resolutionScale: number;
  vignetteOffset: number;
  vignetteDarkness: number;
  vignetteOpacity: number;
}

export interface BattlePostEffectConfigMap {
  pixel: PixelPostEffectConfig;
  "bad-tv": BadTvPostEffectConfig;
  static: StaticPostEffectConfig;
  "crt-soft": CrtPostEffectConfig;
  "crt-strong": CrtStrongPostEffectConfig;
  lens: LensPostEffectConfig;
}

export interface BattlePostEffectSettings {
  order: BattlePostEffect[];
  effects: BattlePostEffectConfigMap;
}

export type InputAction =
  | "left"
  | "right"
  | "jump"
  | "block"
  | "punch"
  | "kick"
  | "pause";

export type PlayerSlot = "p1" | "p2";
export type PlayerControl = "human" | "cpu";
export type PlayerControls = Record<PlayerSlot, PlayerControl>;
export type LocalBattleMode = "p1-vs-p2" | "p1-vs-cpu" | "cpu-vs-cpu";

export interface FrameAnchor {
  x: number;
  y: number;
}

export interface CollisionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FighterFrameCollision {
  source: "alpha-v1";
  hurtboxes: CollisionBox[];
  attackBoxes?: CollisionBox[];
}

export interface FighterFrame {
  pose: FighterPose;
  blobId?: string;
  dataUrl?: string;
  anchor: FrameAnchor;
  width: number;
  height: number;
  collision?: FighterFrameCollision;
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
  playerControls?: PlayerControls;
  roundCount: 3;
  timerSeconds: 60;
  stageId: "dojo-v1";
}

export interface LoadedBattleBackground {
  id: "custom";
  name: string;
  blobId: string;
  imageUrl: string;
  mimeType: string;
  size: number;
  updatedAt: string;
  layers?: LoadedBattleBackgroundLayer[];
}

export interface RuntimeBattleBackground {
  id: "custom" | "remote";
  name: string;
  imageUrl: string;
  mimeType: string;
  size: number;
  updatedAt: string;
  blobId?: string;
  layers?: RuntimeBattleBackgroundLayer[];
}

export interface BattleBackgroundLayerBase {
  id: BattleBackgroundDepthLayerId;
  imageUrl: string;
  mimeType: string;
  size: number;
  depth: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

export interface LoadedBattleBackgroundLayer extends BattleBackgroundLayerBase {
  blobId: string;
}

export interface RuntimeBattleBackgroundLayer extends BattleBackgroundLayerBase {
  blobId?: string;
}

export interface LoadedFighter extends FighterProfile {
  frameUrls: Record<FighterPose, string>;
  voiceUrls: Partial<Record<VoiceClipType, string>>;
}

export type ActionSnapshot = Record<InputAction, boolean>;
export type PlayerInputSnapshot = Record<PlayerSlot, ActionSnapshot>;
