import type { BackgroundRemovalPipeline } from "@huggingface/transformers";
import type { AnySegmentationProviderOptions, SegmentationProvider, TransformersModelId, TransformersSegmentationOptions } from "./types";

export const TRANSFORMERS_MODELS: Array<{ id: TransformersModelId; label: string; description: string }> = [
  {
    id: "onnx-community/ormbg-ONNX",
    label: "ORMBG",
    description: "General background removal. Worth testing for full-body cutouts.",
  },
  {
    id: "Xenova/modnet",
    label: "MODNet",
    description: "Portrait matting. Best for closer portrait-style subjects.",
  },
];

const MODEL_LABELS = Object.fromEntries(TRANSFORMERS_MODELS.map((model) => [model.id, model.label])) as Record<
  TransformersModelId,
  string
>;

const pipelines = new Map<TransformersModelId, Promise<BackgroundRemovalPipeline>>();
const loadedPipelines = new Map<TransformersModelId, BackgroundRemovalPipeline>();

export const transformersBackgroundRemovalProvider: SegmentationProvider = {
  id: "transformers-background-removal",
  label: "Transformers.js",
  description: "Local ONNX background-removal models. Slower first load, useful for model bakeoffs.",
  load: async (options) => {
    const modelId = normalizeOptions(options).modelId;
    if (!pipelines.has(modelId)) {
      pipelines.set(modelId, createBackgroundRemovalPipeline(modelId));
    }
    loadedPipelines.set(modelId, await pipelines.get(modelId)!);
  },
  segment: async (source, options) => {
    const modelId = normalizeOptions(options).modelId;
    let removeBackground = loadedPipelines.get(modelId);
    if (!removeBackground) {
      await transformersBackgroundRemovalProvider.load({ modelId });
      removeBackground = loadedPipelines.get(modelId);
    }
    if (!removeBackground) {
      throw new Error(`${MODEL_LABELS[modelId]} is not ready.`);
    }
    const output = await removeBackground(source);
    const image = Array.isArray(output) ? output[0] : output;
    const canvas = image.toCanvas() as HTMLCanvasElement;
    if (!canvas) {
      throw new Error("Transformers.js did not return a cutout canvas.");
    }
    return canvas;
  },
  dispose: () => {
    loadedPipelines.forEach((pipeline) => pipeline.dispose());
    loadedPipelines.clear();
    pipelines.clear();
  },
};

function normalizeOptions(options: AnySegmentationProviderOptions | undefined): TransformersSegmentationOptions {
  if (!options || !("modelId" in options)) {
    return { modelId: "onnx-community/ormbg-ONNX" };
  }
  return options;
}

async function createBackgroundRemovalPipeline(model: TransformersModelId): Promise<BackgroundRemovalPipeline> {
  const { pipeline } = await import("@huggingface/transformers");

  if (supportsWebGpu()) {
    try {
      return await pipeline("background-removal", model, {
        dtype: "fp32",
        device: "webgpu",
      });
    } catch (error) {
      console.warn(`WebGPU ${MODEL_LABELS[model]} load failed; falling back to default Transformers.js backend.`, error);
    }
  }

  return pipeline("background-removal", model, {
    dtype: "fp32",
  });
}

function supportsWebGpu(): boolean {
  return Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}
