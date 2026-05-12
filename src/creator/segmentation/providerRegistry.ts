import { mediapipeSelfieProvider } from "./mediaPipeSelfieProvider";
import { transformersModnetProvider } from "./transformersModnetProvider";
import type { SegmentationProvider, SegmentationProviderId } from "./types";

export const DEFAULT_SEGMENTATION_PROVIDER_ID: SegmentationProviderId = "mediapipe-selfie";

export const SEGMENTATION_PROVIDERS: SegmentationProvider[] = [
  mediapipeSelfieProvider,
  transformersModnetProvider,
];

export function getSegmentationProvider(id: string | undefined): SegmentationProvider {
  return (
    SEGMENTATION_PROVIDERS.find((provider) => provider.id === id) ??
    SEGMENTATION_PROVIDERS.find((provider) => provider.id === DEFAULT_SEGMENTATION_PROVIDER_ID) ??
    SEGMENTATION_PROVIDERS[0]
  );
}

export function isSegmentationProviderId(value: unknown): value is SegmentationProviderId {
  return typeof value === "string" && SEGMENTATION_PROVIDERS.some((provider) => provider.id === value);
}
