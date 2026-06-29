export const NORMALIZED_FRAME_SIZE = 384;
const DEFAULT_FRAME_ANCHOR_Y = 0.9;
const DEFAULT_PADDING_SCALE = 0.92;
const ALPHA_TRIM_THRESHOLD = 12;
const CHROMA_GREEN_MIN = 130;
const CHROMA_GREEN_DOMINANCE = 1.35;

export interface NormalizeCanvasOptions {
  paddingScale?: number;
  anchorY?: number;
  trimTransparentPadding?: boolean;
}

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not encode canvas image."));
      }
    }, "image/png");
  });
}

export function normalizeCanvas(source: CanvasImageSource, options: NormalizeCanvasOptions = {}): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = NORMALIZED_FRAME_SIZE;
  canvas.height = NORMALIZED_FRAME_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const { width: sourceWidth, height: sourceHeight } = getCanvasSourceSize(source);
  const sourceBounds = getSourceDrawBounds(source, sourceWidth, sourceHeight, options.trimTransparentPadding ?? true);
  const anchorY = options.anchorY ?? DEFAULT_FRAME_ANCHOR_Y;
  const paddingScale = options.paddingScale ?? DEFAULT_PADDING_SCALE;
  const scale =
    Math.min(NORMALIZED_FRAME_SIZE / sourceBounds.width, (NORMALIZED_FRAME_SIZE * anchorY) / sourceBounds.height) *
    paddingScale;
  const width = sourceBounds.width * scale;
  const height = sourceBounds.height * scale;
  const x = (NORMALIZED_FRAME_SIZE - width) / 2;
  const y = NORMALIZED_FRAME_SIZE * anchorY - height;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sourceBounds.x, sourceBounds.y, sourceBounds.width, sourceBounds.height, x, y, width, height);
  return canvas;
}

export async function decodeImageBlob(blob: Blob, decodeError: Error | string = "Could not read image."): Promise<DecodedImage> {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(decodeError instanceof Error ? decodeError : new Error(decodeError)), {
        once: true,
      });
      image.src = url;
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }

  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    close: () => URL.revokeObjectURL(url),
  };
}

export function imageSourceToCanvas(source: CanvasImageSource): HTMLCanvasElement {
  const { width, height } = getCanvasSourceSize(source);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.drawImage(source, 0, 0, width, height);
  }
  return canvas;
}

export function chromaKeyGreenCanvas(source: CanvasImageSource): HTMLCanvasElement {
  const { width, height } = getCanvasSourceSize(source);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return canvas;
  }

  ctx.drawImage(source, 0, 0, width, height);
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      if (isChromaGreen(red, green, blue)) {
        imageData.data[index + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  } catch {
    return canvas;
  }
  return canvas;
}

export function videoToSourceCanvas(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function getCanvasSourceSize(source: CanvasImageSource) {
  const width =
    "videoWidth" in source
      ? source.videoWidth
      : "naturalWidth" in source
        ? source.naturalWidth
        : "width" in source
          ? Number(source.width)
          : NORMALIZED_FRAME_SIZE;
  const height =
    "videoHeight" in source
      ? source.videoHeight
      : "naturalHeight" in source
        ? source.naturalHeight
        : "height" in source
          ? Number(source.height)
          : NORMALIZED_FRAME_SIZE;

  return {
    width: Math.max(1, Math.round(width || NORMALIZED_FRAME_SIZE)),
    height: Math.max(1, Math.round(height || NORMALIZED_FRAME_SIZE)),
  };
}

function isChromaGreen(red: number, green: number, blue: number) {
  return green >= CHROMA_GREEN_MIN && green >= red * CHROMA_GREEN_DOMINANCE && green >= blue * CHROMA_GREEN_DOMINANCE;
}

function getSourceDrawBounds(source: CanvasImageSource, width: number, height: number, trimTransparentPadding: boolean) {
  const fallback = { x: 0, y: 0, width, height };
  if (!trimTransparentPadding) {
    return fallback;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return fallback;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  try {
    return getAlphaBounds(ctx.getImageData(0, 0, width, height), fallback) ?? fallback;
  } catch {
    return fallback;
  }
}

function getAlphaBounds(imageData: ImageData, fallback: { x: number; y: number; width: number; height: number }) {
  const { width, height, data } = imageData;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= ALPHA_TRIM_THRESHOLD) {
        continue;
      }
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    return undefined;
  }

  if (left === fallback.x && top === fallback.y && right === width - 1 && bottom === height - 1) {
    return fallback;
  }

  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}
