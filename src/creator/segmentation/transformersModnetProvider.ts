import type { BackgroundRemovalPipeline } from "@huggingface/transformers";
import type { SegmentationProvider } from "./types";

let pipelinePromise: Promise<BackgroundRemovalPipeline> | undefined;
let removeBackground: BackgroundRemovalPipeline | undefined;

export const transformersModnetProvider: SegmentationProvider = {
  id: "transformers-modnet",
  label: "Transformers.js",
  description: "MODNet portrait matting. Slower first load, often cleaner person cutouts.",
  load: async () => {
    pipelinePromise ??= createBackgroundRemovalPipeline();
    removeBackground = await pipelinePromise;
  },
  segment: async (source) => {
    if (!removeBackground) {
      await transformersModnetProvider.load();
    }
    if (!removeBackground) {
      throw new Error("Transformers.js segmentation is not ready.");
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
    removeBackground?.dispose();
    removeBackground = undefined;
    pipelinePromise = undefined;
  },
};

async function createBackgroundRemovalPipeline(): Promise<BackgroundRemovalPipeline> {
  const { pipeline } = await import("@huggingface/transformers");
  const model = "Xenova/modnet";

  if (supportsWebGpu()) {
    try {
      return await pipeline("background-removal", model, {
        dtype: "fp32",
        device: "webgpu",
      });
    } catch (error) {
      console.warn("WebGPU MODNet load failed; falling back to default Transformers.js backend.", error);
    }
  }

  return pipeline("background-removal", model, {
    dtype: "fp32",
  });
}

function supportsWebGpu(): boolean {
  return Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
}
