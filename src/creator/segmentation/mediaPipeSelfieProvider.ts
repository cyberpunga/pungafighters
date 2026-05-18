import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import type { AnySegmentationProviderOptions, MediaPipeSegmentationOptions, SegmentationProvider } from "./types";
import { AppError } from "../../i18n/errors";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let segmenterPromise: Promise<ImageSegmenter> | undefined;
let segmenter: ImageSegmenter | undefined;

export const mediapipeSelfieProvider: SegmentationProvider = {
  id: "mediapipe-selfie",
  label: "MediaPipe",
  description: "Fast local selfie segmentation. Best default for quick captures.",
  load: async () => {
    segmenterPromise ??= FilesetResolver.forVisionTasks(WASM_URL).then((vision) =>
      ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
        },
        runningMode: "IMAGE",
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      }),
    );
    segmenter = await segmenterPromise;
  },
  segment: async (source, options) => {
    if (!segmenter) {
      await mediapipeSelfieProvider.load(DEFAULT_MEDIAPIPE_OPTIONS);
    }
    if (!segmenter) {
      throw new Error("MediaPipe segmentation is not ready.");
    }
    return segmentWithMediaPipe(source, segmenter, normalizeOptions(options));
  },
  dispose: () => {
    segmenter?.close();
    segmenter = undefined;
    segmenterPromise = undefined;
  },
};

const DEFAULT_MEDIAPIPE_OPTIONS: MediaPipeSegmentationOptions = {
  maskLow: 0.18,
  maskHigh: 0.72,
};

function normalizeOptions(options: AnySegmentationProviderOptions | undefined): MediaPipeSegmentationOptions {
  if (!options || !("maskLow" in options) || !("maskHigh" in options)) {
    return DEFAULT_MEDIAPIPE_OPTIONS;
  }
  return options;
}

function segmentWithMediaPipe(
  source: HTMLCanvasElement,
  imageSegmenter: ImageSegmenter,
  options: MediaPipeSegmentationOptions,
): HTMLCanvasElement {
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) {
    throw new AppError("error.cameraFrameRead");
  }

  const imageData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const result = imageSegmenter.segment(source);
  const labels = imageSegmenter.getLabels();
  const foregroundIndex = findForegroundIndex(labels, result.confidenceMasks?.length ?? 0);
  const foregroundMask = foregroundIndex >= 0 ? result.confidenceMasks?.[foregroundIndex] : undefined;
  const mask = foregroundMask?.getAsFloat32Array();
  if (!mask || mask.length !== source.width * source.height) {
    throw new Error("MediaPipe did not return a usable foreground mask.");
  }

  for (let index = 0; index < mask.length; index += 1) {
    const confidence = smoothMask(mask[index], options);
    imageData.data[index * 4 + 3] = Math.round(confidence * 255);
  }

  const cutout = document.createElement("canvas");
  cutout.width = source.width;
  cutout.height = source.height;
  cutout.getContext("2d")?.putImageData(imageData, 0, 0);
  return cutout;
}

function findForegroundIndex(labels: string[], maskCount: number): number {
  const personIndex = labels.findIndex((label) => /person|human|selfie|foreground/i.test(label));
  if (personIndex >= 0 && personIndex < maskCount) {
    return personIndex;
  }
  return maskCount > 1 ? maskCount - 1 : 0;
}

function smoothMask(value: number, options: MediaPipeSegmentationOptions): number {
  const low = Math.min(options.maskLow, options.maskHigh - 0.01);
  const high = Math.max(options.maskHigh, low + 0.01);
  const normalized = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return normalized * normalized * (3 - 2 * normalized);
}
