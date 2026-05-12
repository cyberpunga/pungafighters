import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { normalizeCanvas } from "./imageProcessing";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

let segmenterPromise: Promise<ImageSegmenter> | undefined;

export async function loadImageSegmenter(): Promise<ImageSegmenter> {
  segmenterPromise ??= FilesetResolver.forVisionTasks(WASM_URL).then((vision) =>
    ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
      },
      runningMode: "IMAGE",
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    }),
  );
  return segmenterPromise;
}

export async function segmentVideoToCanvas(video: HTMLVideoElement, segmenter: ImageSegmenter): Promise<HTMLCanvasElement> {
  const source = document.createElement("canvas");
  source.width = video.videoWidth || 640;
  source.height = video.videoHeight || 480;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) {
    return normalizeCanvas(video);
  }
  sourceCtx.drawImage(video, 0, 0, source.width, source.height);
  const imageData = sourceCtx.getImageData(0, 0, source.width, source.height);
  const result = segmenter.segment(source);
  const mask = result.categoryMask?.getAsFloat32Array();
  if (!mask) {
    return normalizeCanvas(source);
  }

  for (let index = 0; index < mask.length; index += 1) {
    const alpha = mask[index] > 0.2 ? 255 : 0;
    imageData.data[index * 4 + 3] = alpha;
  }

  const cutout = document.createElement("canvas");
  cutout.width = source.width;
  cutout.height = source.height;
  cutout.getContext("2d")?.putImageData(imageData, 0, 0);
  return normalizeCanvas(cutout);
}
