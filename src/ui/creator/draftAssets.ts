import type { FighterPose, VoiceClipType } from "../../types/game";
import { FIGHTER_POSES, VOICE_CLIPS } from "../../types/game";

export const CAPTURE_DELAYS = [0, 5, 10, 15] as const;
export type CaptureDelay = (typeof CAPTURE_DELAYS)[number];

export interface DraftAsset {
  blob: Blob;
  url: string;
}

export interface PoseDraft {
  source?: DraftAsset;
  frame?: DraftAsset;
  processed: boolean;
}

export interface PoseFrameSnapshot {
  sourceBlob?: Blob;
  frameBlob: Blob;
  processed: boolean;
}

export interface PoseFrameHistory {
  past: PoseFrameSnapshot[];
  future: PoseFrameSnapshot[];
}

export type PoseDrafts = Partial<Record<FighterPose, PoseDraft>>;
export type PoseFrameHistories = Partial<Record<FighterPose, PoseFrameHistory>>;
export type VoiceDrafts = Partial<Record<VoiceClipType, DraftAsset>>;

export function createDefaultCaptureDelays(): Record<FighterPose, CaptureDelay> {
  return Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, 5])) as Record<FighterPose, CaptureDelay>;
}

export function createDraftAsset(blob: Blob): DraftAsset {
  return { blob, url: URL.createObjectURL(blob) };
}

export function createPoseDraft(sourceBlob: Blob, frameBlob: Blob, processed: boolean): PoseDraft {
  return {
    source: createDraftAsset(sourceBlob),
    frame: createDraftAsset(frameBlob),
    processed,
  };
}

export function createDraftsFromFrameBlobs(frameBlobs: Record<FighterPose, Blob>, processed: boolean): PoseDrafts {
  return Object.fromEntries(
    FIGHTER_POSES.map((pose) => {
      const blob = frameBlobs[pose];
      return [pose, createPoseDraft(blob, blob, processed)];
    }),
  ) as PoseDrafts;
}

export function createDraftsFromSourceAndFrameBlobs(
  sourceBlobs: Record<FighterPose, Blob>,
  frameBlobs: Record<FighterPose, Blob>,
  processed: boolean,
): PoseDrafts {
  return Object.fromEntries(
    FIGHTER_POSES.map((pose) => [pose, createPoseDraft(sourceBlobs[pose], frameBlobs[pose], processed)]),
  ) as PoseDrafts;
}

export function createVoiceDrafts(voiceBlobs: Partial<Record<VoiceClipType, Blob>>): VoiceDrafts {
  return Object.fromEntries(
    Object.entries(voiceBlobs).flatMap(([clip, blob]) => (blob ? [[clip, createDraftAsset(blob)]] : [])),
  ) as VoiceDrafts;
}

export function createVoiceBlobRecord(voiceDrafts: VoiceDrafts): Partial<Record<VoiceClipType, Blob>> {
  return Object.fromEntries(
    VOICE_CLIPS.flatMap((clip) => {
      const draft = voiceDrafts[clip];
      return draft ? [[clip, draft.blob] as const] : [];
    }),
  ) as Partial<Record<VoiceClipType, Blob>>;
}

export function revokeDrafts(drafts: PoseDrafts) {
  Object.values(drafts).forEach(revokeDraft);
}

export function revokeVoiceDrafts(drafts: VoiceDrafts) {
  Object.values(drafts).forEach(revokeDraftAsset);
}

export function revokeDraft(draft: PoseDraft | undefined) {
  revokeDraftAsset(draft?.source);
  if (draft?.frame?.url !== draft?.source?.url) {
    revokeDraftAsset(draft?.frame);
  }
}

export function revokeDraftAsset(asset: DraftAsset | undefined) {
  if (asset) {
    URL.revokeObjectURL(asset.url);
  }
}
