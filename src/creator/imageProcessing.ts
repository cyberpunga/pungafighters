export const NORMALIZED_FRAME_SIZE = 384;

export interface NormalizeCanvasOptions {
  paddingScale?: number;
  anchorY?: number;
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
  const scale = Math.min(NORMALIZED_FRAME_SIZE / sourceWidth, NORMALIZED_FRAME_SIZE / sourceHeight) * (options.paddingScale ?? 0.92);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (NORMALIZED_FRAME_SIZE - width) / 2;
  const y = NORMALIZED_FRAME_SIZE * (options.anchorY ?? 0.9) - height;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, x, y, width, height);
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
