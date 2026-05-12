import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import type { SegmentationProvider } from "./types";

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
  segment: async (source) => {
    if (!segmenter) {
      await mediapipeSelfieProvider.load();
    }
    if (!segmenter) {
      throw new Error("MediaPipe segmentation is not ready.");
    }
    return segmentWithMediaPipe(source, segmenter);
  },
  dispose: () => {
    segmenter?.close();
    segmenter = undefined;
    segmenterPromise = undefined;
  },
};

function segmentWithMediaPipe(source: HTMLCanvasElement, imageSegmenter: ImageSegmenter): HTMLCanvasElement {
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) {
    throw new Error("Could not read the camera frame.");
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
    const confidence = smoothMask(mask[index]);
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

function smoothMask(value: number): number {
  const low = 0.18;
  const high = 0.72;
  const normalized = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return normalized * normalized * (3 - 2 * normalized);
}
