import type { BattleBackgroundDepthLayerId, RuntimeBattleBackgroundLayer } from "../types/game";
import { BATTLE_BACKGROUND_DEPTH_LAYERS } from "../types/game";
import { canvasToPngBlob, decodeImageBlob } from "./imageProcessing";

const MAX_LAYER_WIDTH = 1024;
const MAX_LAYER_HEIGHT = 576;
const MIN_VISIBLE_ALPHA = 4;

type LayerMaskMap = Record<BattleBackgroundDepthLayerId, Uint8ClampedArray>;

export interface BackgroundDepthImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array | readonly number[];
}

export interface GeneratedBattleBackgroundLayer extends Omit<RuntimeBattleBackgroundLayer, "blobId" | "imageUrl"> {
  blob: Blob;
}

const LAYER_RENDERING: Record<BattleBackgroundDepthLayerId, Pick<RuntimeBattleBackgroundLayer, "depth" | "scale" | "offsetX" | "offsetY" | "opacity">> = {
  far: { depth: 0.16, scale: 1.01, offsetX: 0, offsetY: 0.04, opacity: 1 },
  mid: { depth: 0.5, scale: 1.045, offsetX: 0, offsetY: 0, opacity: 1 },
  near: { depth: 0.86, scale: 1.09, offsetX: 0, offsetY: -0.05, opacity: 0.94 },
};

export async function createBattleBackgroundDepthLayersFromBlob(blob: Blob): Promise<GeneratedBattleBackgroundLayer[]> {
  const image = await decodeImageBlob(blob).catch(() => undefined);
  if (!image) {
    return [];
  }
  try {
    const scale = Math.min(1, MAX_LAYER_WIDTH / image.width, MAX_LAYER_HEIGHT / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return [];
    }

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image.source, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const masks = createBackgroundDepthLayerMasks(imageData);

    const layers = await Promise.all(
      BATTLE_BACKGROUND_DEPTH_LAYERS.map(async (id) => {
        const layerCanvas = document.createElement("canvas");
        layerCanvas.width = width;
        layerCanvas.height = height;
        const layerCtx = layerCanvas.getContext("2d");
        if (!layerCtx) {
          return undefined;
        }

        const output = layerCtx.createImageData(width, height);
        const mask = masks[id];
        let visiblePixels = 0;
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          const sourceIndex = pixel * 4;
          const alpha = imageData.data[sourceIndex + 3];
          const layerAlpha = Math.round((alpha * mask[pixel]) / 255);
          if (layerAlpha <= MIN_VISIBLE_ALPHA) {
            continue;
          }
          output.data[sourceIndex] = imageData.data[sourceIndex];
          output.data[sourceIndex + 1] = imageData.data[sourceIndex + 1];
          output.data[sourceIndex + 2] = imageData.data[sourceIndex + 2];
          output.data[sourceIndex + 3] = layerAlpha;
          visiblePixels += 1;
        }

        if (visiblePixels <= 0) {
          return undefined;
        }

        layerCtx.putImageData(output, 0, 0);
        const layerBlob = await canvasToPngBlob(layerCanvas);
        return {
          id,
          blob: layerBlob,
          mimeType: "image/png",
          size: layerBlob.size,
          ...LAYER_RENDERING[id],
        } satisfies GeneratedBattleBackgroundLayer;
      }),
    );

    return layers.filter((layer): layer is GeneratedBattleBackgroundLayer => Boolean(layer));
  } catch {
    return [];
  } finally {
    image.close();
  }
}

export function createBackgroundDepthLayerMasks(imageData: BackgroundDepthImageData): LayerMaskMap {
  const masks = Object.fromEntries(
    BATTLE_BACKGROUND_DEPTH_LAYERS.map((id) => [id, new Uint8ClampedArray(imageData.width * imageData.height)]),
  ) as LayerMaskMap;

  for (let y = 0; y < imageData.height; y += 1) {
    const yRatio = imageData.height <= 1 ? 0.5 : y / (imageData.height - 1);
    for (let x = 0; x < imageData.width; x += 1) {
      const pixel = y * imageData.width + x;
      const sourceIndex = pixel * 4;
      const alpha = imageData.data[sourceIndex + 3];
      if (alpha <= MIN_VISIBLE_ALPHA) {
        continue;
      }

      const red = imageData.data[sourceIndex] / 255;
      const green = imageData.data[sourceIndex + 1] / 255;
      const blue = imageData.data[sourceIndex + 2] / 255;
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const saturation = max === 0 ? 0 : (max - min) / max;
      const depthScore = clamp01(yRatio * 0.82 + (1 - luma) * 0.1 + saturation * 0.08);
      const weights = getLayerWeights(depthScore);

      masks.far[pixel] = Math.round(weights.far * 255);
      masks.mid[pixel] = Math.round(weights.mid * 255);
      masks.near[pixel] = Math.round(weights.near * 255);
    }
  }

  return masks;
}

function getLayerWeights(depthScore: number): Record<BattleBackgroundDepthLayerId, number> {
  const far = softBand(depthScore, 0.16, 0.39);
  const mid = softBand(depthScore, 0.5, 0.36);
  const near = softBand(depthScore, 0.86, 0.39);
  const total = far + mid + near;
  if (total <= 0) {
    return { far: 0, mid: 1, near: 0 };
  }
  return {
    far: far / total,
    mid: mid / total,
    near: near / total,
  };
}

function softBand(value: number, center: number, radius: number) {
  return clamp01(1 - Math.abs(value - center) / radius);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
