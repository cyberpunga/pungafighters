import { X } from "lucide-react";
import type {
  MediaPipeSegmentationOptions,
  SegmentationProvider,
  SegmentationProviderId,
  SegmentationProviderOptions,
  TransformersModelId,
} from "../../creator/segmentation/types";
import { SEGMENTATION_PROVIDERS } from "../../creator/segmentation/providerRegistry";
import { TRANSFORMERS_MODELS } from "../../creator/segmentation/transformersBackgroundRemovalProvider";
import { useI18n } from "../../i18n/react";
import {
  getSegmentationProviderDescription,
  getSegmentationProviderLabel,
  getTransformersModelDescription,
} from "./segmentationLabels";

export function CutoutSettingsDrawer(props: {
  creatorBusy: boolean;
  providerId: SegmentationProviderId;
  selectedProvider: SegmentationProvider;
  segmentationOptions: SegmentationProviderOptions;
  onClose: () => void;
  onMediaPipeOptionsChange: (patch: Partial<MediaPipeSegmentationOptions>) => void;
  onProviderSelect: (providerId: SegmentationProviderId) => void;
  onTransformersModelSelect: (modelId: TransformersModelId) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="creator-drawer-shell">
      <button
        className="creator-drawer-backdrop"
        type="button"
        onClick={props.onClose}
        aria-label={t("creator.closeCutoutSettings")}
      />
      <aside
        className="creator-settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t("creator.cutoutSettings")}
      >
        <div className="drawer-header">
          <strong>{t("creator.cutoutSettings")}</strong>
          <button
            className="icon-button"
            type="button"
            onClick={props.onClose}
            title={t("creator.closeCutoutSettings")}
          >
            <X size={18} />
            <span className="sr-only">{t("creator.closeCutoutSettings")}</span>
          </button>
        </div>
        <div className="provider-control" aria-label={t("creator.segmentationProvider")}>
          <span className="field-label-text">{t("creator.cutoutEngine")}</span>
          <div className="segmented-control">
            {SEGMENTATION_PROVIDERS.map((provider) => (
              <button
                className={provider.id === props.providerId ? "segment-option active" : "segment-option"}
                key={provider.id}
                type="button"
                onClick={() => props.onProviderSelect(provider.id)}
                disabled={props.creatorBusy}
                title={getSegmentationProviderDescription(t, provider)}
              >
                {getSegmentationProviderLabel(t, provider)}
              </button>
            ))}
          </div>
          <p className="helper-text">{getSegmentationProviderDescription(t, props.selectedProvider)}</p>
        </div>

        {props.providerId === "mediapipe-selfie" && (
          <div className="provider-control" aria-label={t("creator.mediaPipeMaskControls")}>
            <span className="field-label-text">{t("creator.maskTuning")}</span>
            <label className="range-field">
              <span>{t("creator.foregroundEdge")}</span>
              <input
                type="range"
                min="0.05"
                max="0.65"
                step="0.01"
                value={props.segmentationOptions["mediapipe-selfie"].maskLow}
                onChange={(event) => props.onMediaPipeOptionsChange({ maskLow: Number(event.target.value) })}
                disabled={props.creatorBusy}
              />
              <strong>{props.segmentationOptions["mediapipe-selfie"].maskLow.toFixed(2)}</strong>
            </label>
            <label className="range-field">
              <span>{t("creator.backgroundCutoff")}</span>
              <input
                type="range"
                min="0.25"
                max="0.95"
                step="0.01"
                value={props.segmentationOptions["mediapipe-selfie"].maskHigh}
                onChange={(event) => props.onMediaPipeOptionsChange({ maskHigh: Number(event.target.value) })}
                disabled={props.creatorBusy}
              />
              <strong>{props.segmentationOptions["mediapipe-selfie"].maskHigh.toFixed(2)}</strong>
            </label>
          </div>
        )}

        {props.providerId === "transformers-background-removal" && (
          <div className="provider-control" aria-label={t("creator.transformersModel")}>
            <span className="field-label-text">{t("creator.model")}</span>
            <div className="segmented-control">
              {TRANSFORMERS_MODELS.map((model) => (
                <button
                  className={
                    props.segmentationOptions["transformers-background-removal"].modelId === model.id
                      ? "segment-option active"
                      : "segment-option"
                  }
                  key={model.id}
                  type="button"
                  onClick={() => props.onTransformersModelSelect(model.id)}
                  disabled={props.creatorBusy}
                  title={getTransformersModelDescription(t, model.id)}
                >
                  {model.label}
                </button>
              ))}
            </div>
            <p className="helper-text">
              {getTransformersModelDescription(t, props.segmentationOptions["transformers-background-removal"].modelId)}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
