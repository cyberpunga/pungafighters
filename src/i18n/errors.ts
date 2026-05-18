import { poseLabel, type Translate } from "./index";
import type { FighterPose } from "../types/game";

export function localizeError(error: unknown, t: Translate, fallbackKey?: Parameters<Translate>[0]): string {
  if (!(error instanceof Error)) {
    return fallbackKey ? t(fallbackKey) : "";
  }
  return localizeErrorMessage(error.message, t) ?? (fallbackKey ? t(fallbackKey) : error.message);
}

export function localizeErrorMessage(message: string, t: Translate): string | undefined {
  const direct = ERROR_MESSAGE_KEYS[message];
  if (direct) {
    return t(direct);
  }

  const missingPose = /^Missing (idle|punch|kick|hit|victory) image\.$/.exec(message);
  if (missingPose) {
    return t("error.missingPoseImage", { pose: poseLabel(t, missingPose[1] as FighterPose) });
  }

  return undefined;
}

const ERROR_MESSAGE_KEYS: Record<string, Parameters<Translate>[0]> = {
  "Choose a PNG, JPEG, or WebP background image.": "error.backgroundType",
  "Choose a background image under 10 MB.": "error.backgroundSize",
  "Choose a Punga fighter JSON file or a PNG, JPEG, or WebP spritesheet.": "error.fighterImportType",
  "Choose a Punga fighter JSON file.": "error.fighterJsonType",
  "Choose a PNG, JPEG, or WebP spritesheet.": "error.spritesheetType",
  "Could not read spritesheet image.": "error.spritesheetRead",
  "Spritesheet cells are too small to import.": "error.spritesheetSmall",
  "Could not load fighter asset.": "error.fighterAssetLoad",
  "Could not read fighter asset.": "error.fighterAssetRead",
  "Could not read fighter image.": "error.fighterImageRead",
  "Could not read the camera frame.": "error.cameraFrameRead",
  "Could not load TURN credentials.": "error.turnCredentials",
  "Could not read fighter frame.": "error.fighterFrameRead",
  "Could not prepare the battle background for online play.": "error.backgroundPrepare",
  "Could not load battle background.": "error.backgroundLoad",
};
