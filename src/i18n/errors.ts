import { poseLabel, type MessageKey, type Translate } from "./index";
import type { FighterPose } from "../types/game";

type ErrorValues = Record<string, string | number>;

export class AppError extends Error {
  readonly key: MessageKey;
  readonly values: ErrorValues;

  constructor(key: MessageKey, values: ErrorValues = {}) {
    super(key);
    this.name = "AppError";
    this.key = key;
    this.values = values;
  }
}

export function missingPoseImageError(pose: FighterPose) {
  return new AppError("error.missingPoseImage", { pose });
}

export function localizeError(error: unknown, t: Translate, fallbackKey?: Parameters<Translate>[0]): string {
  if (error instanceof AppError) {
    return t(error.key, localizeErrorValues(error.key, error.values, t));
  }
  if (!(error instanceof Error)) {
    return fallbackKey ? t(fallbackKey) : "";
  }
  return fallbackKey ? t(fallbackKey) : error.message;
}

function localizeErrorValues(key: MessageKey, values: ErrorValues, t: Translate): ErrorValues {
  if (key === "error.missingPoseImage" && typeof values.pose === "string") {
    return { ...values, pose: poseLabel(t, values.pose as FighterPose) };
  }
  return values;
}
