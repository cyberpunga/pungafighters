export type SegmentationProviderId = "mediapipe-selfie" | "transformers-background-removal";

export type SegmentationProviderState = "idle" | "loading" | "ready" | "error";

export type TransformersModelId = "Xenova/modnet" | "onnx-community/ormbg-ONNX" | "briaai/RMBG-1.4";

export interface MediaPipeSegmentationOptions {
  maskLow: number;
  maskHigh: number;
}

export interface TransformersSegmentationOptions {
  modelId: TransformersModelId;
}

export interface SegmentationProviderOptions {
  "mediapipe-selfie": MediaPipeSegmentationOptions;
  "transformers-background-removal": TransformersSegmentationOptions;
}

export type AnySegmentationProviderOptions = MediaPipeSegmentationOptions | TransformersSegmentationOptions;

export interface SegmentationProvider {
  id: SegmentationProviderId;
  label: string;
  description: string;
  load: (options: AnySegmentationProviderOptions) => Promise<void>;
  segment: (source: HTMLCanvasElement, options: AnySegmentationProviderOptions) => Promise<HTMLCanvasElement>;
  dispose?: () => void;
}
