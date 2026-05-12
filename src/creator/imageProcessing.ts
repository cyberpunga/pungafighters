export const NORMALIZED_FRAME_SIZE = 384;

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

export function normalizeCanvas(source: CanvasImageSource): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = NORMALIZED_FRAME_SIZE;
  canvas.height = NORMALIZED_FRAME_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sourceWidth = "videoWidth" in source ? source.videoWidth : "naturalWidth" in source ? source.naturalWidth : "width" in source ? Number(source.width) : NORMALIZED_FRAME_SIZE;
  const sourceHeight = "videoHeight" in source ? source.videoHeight : "naturalHeight" in source ? source.naturalHeight : "height" in source ? Number(source.height) : NORMALIZED_FRAME_SIZE;
  const scale = Math.min(NORMALIZED_FRAME_SIZE / sourceWidth, NORMALIZED_FRAME_SIZE / sourceHeight) * 0.92;
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (NORMALIZED_FRAME_SIZE - width) / 2;
  const y = NORMALIZED_FRAME_SIZE * 0.9 - height;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, x, y, width, height);
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
