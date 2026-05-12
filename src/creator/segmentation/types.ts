export type SegmentationProviderId = "mediapipe-selfie" | "transformers-modnet";

export type SegmentationProviderState = "idle" | "loading" | "ready" | "error";

export interface SegmentationProvider {
  id: SegmentationProviderId;
  label: string;
  description: string;
  load: () => Promise<void>;
  segment: (source: HTMLCanvasElement) => Promise<HTMLCanvasElement>;
  dispose?: () => void;
}
