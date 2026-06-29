import type { Translate } from "../../i18n";
import type { SegmentationProvider, TransformersModelId } from "../../creator/segmentation/types";

export function getSegmentationProviderLabel(t: Translate, provider: SegmentationProvider) {
  switch (provider.id) {
    case "mediapipe-selfie":
      return t("segmentation.mediapipe.label");
    case "transformers-background-removal":
      return t("segmentation.transformers.label");
    default:
      return provider.label;
  }
}

export function getSegmentationProviderDescription(t: Translate, provider: SegmentationProvider) {
  switch (provider.id) {
    case "mediapipe-selfie":
      return t("segmentation.mediapipe.description");
    case "transformers-background-removal":
      return t("segmentation.transformers.description");
    default:
      return provider.description;
  }
}

export function getTransformersModelDescription(t: Translate, modelId: TransformersModelId) {
  switch (modelId) {
    case "onnx-community/ormbg-ONNX":
      return t("segmentation.model.ormbg.description");
    case "briaai/RMBG-1.4":
      return t("segmentation.model.rmbg.description");
    case "Xenova/modnet":
      return t("segmentation.model.modnet.description");
  }
}
