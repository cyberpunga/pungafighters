import type { FighterProfile, LoadedFighter, VoiceClipType } from "../../types/game";
import { FIGHTER_POSES, VOICE_CLIPS } from "../../types/game";
import type { NetworkFighterPayload } from "./protocol";

export async function serializeFighterForNetwork(fighter: LoadedFighter): Promise<NetworkFighterPayload> {
  const frames = Object.fromEntries(
    await Promise.all(
      FIGHTER_POSES.map(async (pose) => {
        const frame = fighter.frames[pose];
        const dataUrl = frame.dataUrl || (await urlToDataUrl(fighter.frameUrls[pose]));
        return [
          pose,
          {
            pose,
            dataUrl,
            anchor: frame.anchor,
            width: frame.width,
            height: frame.height,
          },
        ];
      }),
    ),
  ) as NetworkFighterPayload["frames"];

  const voiceClipPairs = await Promise.all(
    VOICE_CLIPS.map(async (clip) => {
      const url = fighter.voiceUrls[clip];
      return url ? ([clip, { dataUrl: await urlToDataUrl(url) }] as const) : undefined;
    }),
  );
  const voiceClips = Object.fromEntries(voiceClipPairs.filter(isDefined)) as Partial<Record<VoiceClipType, { dataUrl: string }>>;

  return {
    id: fighter.id,
    name: fighter.name,
    createdAt: fighter.createdAt,
    updatedAt: fighter.updatedAt,
    movesetId: fighter.movesetId,
    isDefault: fighter.isDefault,
    frames,
    voiceClips,
  };
}

export async function loadRemoteFighterFromPayload(payload: NetworkFighterPayload): Promise<{
  fighter: LoadedFighter;
  revoke: () => void;
}> {
  const objectUrls: string[] = [];
  const framePairs = await Promise.all(
    FIGHTER_POSES.map(async (pose) => {
      const url = URL.createObjectURL(await dataUrlToBlob(payload.frames[pose].dataUrl));
      objectUrls.push(url);
      return [pose, url] as const;
    }),
  );
  const voicePairs = await Promise.all(
    VOICE_CLIPS.map(async (clip) => {
      const voice = payload.voiceClips[clip];
      if (!voice) {
        return undefined;
      }
      const url = URL.createObjectURL(await dataUrlToBlob(voice.dataUrl));
      objectUrls.push(url);
      return [clip, url] as const;
    }),
  );

  const frames = Object.fromEntries(
    FIGHTER_POSES.map((pose) => [
      pose,
      {
        pose,
        dataUrl: payload.frames[pose].dataUrl,
        anchor: payload.frames[pose].anchor,
        width: payload.frames[pose].width,
        height: payload.frames[pose].height,
      },
    ]),
  ) as FighterProfile["frames"];

  return {
    fighter: {
      id: payload.id,
      name: payload.name,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      frames,
      frameUrls: Object.fromEntries(framePairs) as LoadedFighter["frameUrls"],
      voiceClips: {},
      voiceUrls: Object.fromEntries(voicePairs.filter(isDefined)) as LoadedFighter["voiceUrls"],
      movesetId: payload.movesetId,
      isDefault: payload.isDefault,
    },
    revoke: () => objectUrls.forEach((url) => URL.revokeObjectURL(url)),
  };
}

async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Could not load fighter asset.");
  }
  return blobToDataUrl(await response.blob());
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(new Error("Could not read fighter asset.")));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("Could not read remote fighter asset.");
  }
  return response.blob();
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
