import { Camera, Upload, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startVoiceRecording, type RecorderSession } from "../creator/audio";
import { FIGHTER_IMPORT_ACCEPT, readFighterImportFile } from "../creator/fighterFiles";
import { canvasToPngBlob, normalizeCanvas, videoToSourceCanvas } from "../creator/imageProcessing";
import {
  DEFAULT_SEGMENTATION_OPTIONS,
  DEFAULT_SEGMENTATION_PROVIDER_ID,
  getSegmentationProvider,
  isSegmentationProviderId,
  SEGMENTATION_PROVIDERS,
} from "../creator/segmentation/providerRegistry";
import { TRANSFORMERS_MODELS } from "../creator/segmentation/transformersBackgroundRemovalProvider";
import type {
  MediaPipeSegmentationOptions,
  SegmentationProvider,
  SegmentationProviderId,
  SegmentationProviderOptions,
  SegmentationProviderState,
  TransformersModelId,
} from "../creator/segmentation/types";
import { saveFighterDraft, getSetting, setSetting } from "../storage/db";
import type { FighterPose, VoiceClipType } from "../types/game";
import { FIGHTER_POSES, VOICE_CLIPS } from "../types/game";

const SEGMENTATION_PROVIDER_SETTING_KEY = "segmentation.providerId";
const SEGMENTATION_OPTIONS_SETTING_KEY = "segmentation.options";
const CAPTURE_DELAYS = [0, 5, 10, 15] as const;
type CaptureDelay = (typeof CAPTURE_DELAYS)[number];

export function CreatorView(props: { onSaved: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<RecorderSession | null>(null);
  const framesRef = useRef<Partial<Record<FighterPose, { blob: Blob; url: string }>>>({});
  const providerLoadIdRef = useRef(0);
  const countdownTimeoutRef = useRef<number | undefined>();
  const countdownActiveRef = useRef(false);
  const [name, setName] = useState("New Fighter");
  const [activePose, setActivePose] = useState<FighterPose>("idle");
  const [frames, setFrames] = useState<Partial<Record<FighterPose, { blob: Blob; url: string }>>>({});
  const [voiceBlobs, setVoiceBlobs] = useState<Partial<Record<VoiceClipType, Blob>>>({});
  const [recording, setRecording] = useState<VoiceClipType | undefined>();
  const [cameraStatus, setCameraStatus] = useState("Camera is off.");
  const [providerId, setProviderId] = useState<SegmentationProviderId>(DEFAULT_SEGMENTATION_PROVIDER_ID);
  const [segmentationOptions, setSegmentationOptions] =
    useState<SegmentationProviderOptions>(DEFAULT_SEGMENTATION_OPTIONS);
  const [providerStatus, setProviderStatus] = useState<SegmentationProviderState>("idle");
  const [providerError, setProviderError] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureDelay, setCaptureDelay] = useState<CaptureDelay>(5);
  const [countdown, setCountdown] = useState(0);
  const [saving, setSaving] = useState(false);
  const selectedProvider = useMemo(() => getSegmentationProvider(providerId), [providerId]);
  const selectedOptions = segmentationOptions[providerId];
  const captureBusy = isCapturing || countdown > 0;

  const replaceFrames = useCallback((frameBlobs: Record<FighterPose, Blob>) => {
    setFrames((current) => {
      Object.values(current).forEach((frame) => {
        if (frame) {
          URL.revokeObjectURL(frame.url);
        }
      });

      return Object.fromEntries(
        FIGHTER_POSES.map((pose) => {
          const blob = frameBlobs[pose];
          return [pose, { blob, url: URL.createObjectURL(blob) }];
        }),
      ) as Partial<Record<FighterPose, { blob: Blob; url: string }>>;
    });
  }, []);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current?.cancel();
      countdownActiveRef.current = false;
      if (countdownTimeoutRef.current) {
        window.clearTimeout(countdownTimeoutRef.current);
      }
      Object.values(framesRef.current).forEach((frame) => frame && URL.revokeObjectURL(frame.url));
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getSetting<unknown>(SEGMENTATION_PROVIDER_SETTING_KEY, DEFAULT_SEGMENTATION_PROVIDER_ID),
      getSetting<unknown>(SEGMENTATION_OPTIONS_SETTING_KEY, DEFAULT_SEGMENTATION_OPTIONS),
    ]).then(([savedProviderId, savedOptions]) => {
      if (cancelled) {
        return;
      }
      if (isSegmentationProviderId(savedProviderId)) {
        setProviderId(savedProviderId);
      }
      setSegmentationOptions(normalizeSegmentationOptions(savedOptions));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProvider = useCallback(async (provider: SegmentationProvider, options: SegmentationProviderOptions[SegmentationProviderId]) => {
    const loadId = providerLoadIdRef.current + 1;
    providerLoadIdRef.current = loadId;
    setProviderStatus("loading");
    setProviderError("");
    try {
      await provider.load(options);
      if (providerLoadIdRef.current === loadId) {
        setProviderStatus("ready");
      }
    } catch (error) {
      if (providerLoadIdRef.current === loadId) {
        setProviderStatus("error");
        setProviderError(error instanceof Error ? error.message : "Segmentation provider failed to load.");
      }
    }
  }, []);

  const selectProvider = (nextProviderId: SegmentationProviderId) => {
    const nextProvider = getSegmentationProvider(nextProviderId);
    setProviderId(nextProvider.id);
    setProviderStatus("idle");
    setProviderError("");
    void setSetting(SEGMENTATION_PROVIDER_SETTING_KEY, nextProvider.id);
    if (streamRef.current) {
      void loadProvider(nextProvider, segmentationOptions[nextProvider.id]);
    }
  };

  const updateMediaPipeOptions = (patch: Partial<MediaPipeSegmentationOptions>) => {
    setSegmentationOptions((current) => {
      const next: SegmentationProviderOptions = {
        ...current,
        "mediapipe-selfie": {
          ...current["mediapipe-selfie"],
          ...patch,
        },
      };
      void setSetting(SEGMENTATION_OPTIONS_SETTING_KEY, next);
      return next;
    });
  };

  const selectTransformersModel = (modelId: TransformersModelId) => {
    const nextOptions: SegmentationProviderOptions = {
      ...segmentationOptions,
      "transformers-background-removal": {
        modelId,
      },
    };
    setSegmentationOptions(nextOptions);
    setProviderStatus(providerId === "transformers-background-removal" ? "idle" : providerStatus);
    setProviderError("");
    void setSetting(SEGMENTATION_OPTIONS_SETTING_KEY, nextOptions);
    if (providerId === "transformers-background-removal" && streamRef.current) {
      void loadProvider(selectedProvider, nextOptions["transformers-background-removal"]);
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 720 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraStatus("Camera ready.");
      await loadProvider(selectedProvider, selectedOptions);
    } catch (error) {
      setCameraStatus(error instanceof Error ? `Camera unavailable: ${error.message}` : "Camera unavailable.");
    }
  };

  const capturePose = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraStatus("Start the camera before capturing.");
      return;
    }
    if (providerStatus !== "ready") {
      setCameraStatus(providerStatus === "error" ? "Segmentation failed to load, so cutout capture is unavailable." : "Wait for segmentation before capturing.");
      return;
    }
    if (countdownActiveRef.current || isCapturing) {
      return;
    }

    if (captureDelay > 0) {
      countdownActiveRef.current = true;
      setCountdown(captureDelay);
      setCameraStatus(`Capturing ${activePose} in ${captureDelay} seconds.`);
      for (let remaining = captureDelay - 1; remaining >= 0; remaining -= 1) {
        await waitOneSecond();
        if (!countdownActiveRef.current) {
          return;
        }
        setCountdown(remaining);
        if (remaining > 0) {
          setCameraStatus(`Capturing ${activePose} in ${remaining} seconds.`);
        }
      }
      countdownActiveRef.current = false;
    }

    setIsCapturing(true);
    try {
      const source = videoToSourceCanvas(video);
      const cutout = await selectedProvider.segment(source, selectedOptions);
      const canvas = normalizeCanvas(cutout);
      const blob = await canvasToPngBlob(canvas);
      const url = URL.createObjectURL(blob);
      setFrames((current) => {
        const previous = current[activePose];
        if (previous) {
          URL.revokeObjectURL(previous.url);
        }
        return { ...current, [activePose]: { blob, url } };
      });
      setCameraStatus(`${activePose} cutout captured with ${selectedProvider.label}.`);
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not create a transparent cutout.");
    } finally {
      countdownActiveRef.current = false;
      setCountdown(0);
      setIsCapturing(false);
    }
  };

  const waitOneSecond = () =>
    new Promise<void>((resolve) => {
      countdownTimeoutRef.current = window.setTimeout(resolve, 1000);
    });

  const saveFighter = async () => {
    const complete = FIGHTER_POSES.every((pose) => frames[pose]);
    if (!complete) {
      setCameraStatus("Capture every required pose before saving.");
      return;
    }
    setSaving(true);
    await saveFighterDraft({
      name,
      frameBlobs: Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, frames[pose]!.blob])) as Record<FighterPose, Blob>,
      voiceBlobs,
    });
    setSaving(false);
    await props.onSaved();
    setCameraStatus("Fighter saved locally.");
  };

  const toggleRecording = async (clip: VoiceClipType) => {
    if (recording) {
      const blob = await recorderRef.current?.stop();
      recorderRef.current = null;
      if (blob) {
        setVoiceBlobs((current) => ({ ...current, [recording]: blob }));
      }
      setRecording(undefined);
      return;
    }
    recorderRef.current = await startVoiceRecording();
    setRecording(clip);
  };

  const importFighterDraft = async (file: File) => {
    try {
      setCameraStatus(`Importing ${file.name}...`);
      const imported = await readFighterImportFile(file);
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setRecording(undefined);
      replaceFrames(imported.frameBlobs);
      setVoiceBlobs(imported.voiceBlobs);
      setName(imported.name);
      setCameraStatus("Fighter draft imported. Press Save fighter when ready.");
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not import fighter.");
    }
  };

  return (
    <section className="creator-grid">
      <div className="creator-camera">
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="camera-actions">
          <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()} disabled={captureBusy}>
            <Upload size={18} />
            Import
          </button>
          <input
            ref={importInputRef}
            className="sr-only"
            type="file"
            accept={FIGHTER_IMPORT_ACCEPT}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void importFighterDraft(file);
              }
            }}
          />
          <button className="secondary-button" type="button" onClick={startCamera}>
            <Camera size={18} />
            Camera
          </button>
          <div className="capture-delay-control" aria-label="Capture delay">
            {CAPTURE_DELAYS.map((delay) => (
              <button
                className={captureDelay === delay ? "delay-option active" : "delay-option"}
                key={delay}
                type="button"
                onClick={() => setCaptureDelay(delay)}
                disabled={captureBusy}
                title={delay === 0 ? "Capture immediately" : `Capture after ${delay} seconds`}
              >
                {delay === 0 ? "Now" : `${delay}s`}
              </button>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={capturePose} disabled={providerStatus !== "ready" || captureBusy}>
            {countdown > 0 ? `${countdown}` : isCapturing ? "Cutting..." : `Capture ${activePose}`}
          </button>
        </div>
      </div>

      <aside className="creator-panel">
        <label className="field-label">
          Fighter name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} />
        </label>

        <div className="provider-control" aria-label="Segmentation provider">
          <span className="field-label-text">Cutout engine</span>
          <div className="segmented-control">
            {SEGMENTATION_PROVIDERS.map((provider) => (
              <button
                className={provider.id === providerId ? "segment-option active" : "segment-option"}
                key={provider.id}
                type="button"
                onClick={() => selectProvider(provider.id)}
                disabled={captureBusy}
                title={provider.description}
              >
                {provider.label}
              </button>
            ))}
          </div>
          <p className="helper-text">{selectedProvider.description}</p>
        </div>

        {providerId === "mediapipe-selfie" && (
          <div className="provider-control" aria-label="MediaPipe mask controls">
            <span className="field-label-text">Mask tuning</span>
            <label className="range-field">
              <span>Foreground edge</span>
              <input
                type="range"
                min="0.05"
                max="0.65"
                step="0.01"
                value={segmentationOptions["mediapipe-selfie"].maskLow}
                onChange={(event) => updateMediaPipeOptions({ maskLow: Number(event.target.value) })}
                disabled={captureBusy}
              />
              <strong>{segmentationOptions["mediapipe-selfie"].maskLow.toFixed(2)}</strong>
            </label>
            <label className="range-field">
              <span>Background cutoff</span>
              <input
                type="range"
                min="0.25"
                max="0.95"
                step="0.01"
                value={segmentationOptions["mediapipe-selfie"].maskHigh}
                onChange={(event) => updateMediaPipeOptions({ maskHigh: Number(event.target.value) })}
                disabled={captureBusy}
              />
              <strong>{segmentationOptions["mediapipe-selfie"].maskHigh.toFixed(2)}</strong>
            </label>
          </div>
        )}

        {providerId === "transformers-background-removal" && (
          <div className="provider-control" aria-label="Transformers.js model">
            <span className="field-label-text">Model</span>
            <div className="segmented-control">
              {TRANSFORMERS_MODELS.map((model) => (
                <button
                  className={segmentationOptions["transformers-background-removal"].modelId === model.id ? "segment-option active" : "segment-option"}
                  key={model.id}
                  type="button"
                  onClick={() => selectTransformersModel(model.id)}
                  disabled={captureBusy}
                  title={model.description}
                >
                  {model.label}
                </button>
              ))}
            </div>
            <p className="helper-text">
              {
                TRANSFORMERS_MODELS.find(
                  (model) => model.id === segmentationOptions["transformers-background-removal"].modelId,
                )?.description
              }
            </p>
          </div>
        )}

        <div className="pose-grid" aria-label="Required poses">
          {FIGHTER_POSES.map((pose) => (
            <button className={activePose === pose ? "pose-tile active" : "pose-tile"} key={pose} type="button" onClick={() => setActivePose(pose)} disabled={captureBusy}>
              {frames[pose] ? (
                <span className="cutout-preview">
                  <img src={frames[pose]!.url} alt="" />
                </span>
              ) : (
                <span>{pose}</span>
              )}
            </button>
          ))}
        </div>

        <div className="voice-row">
          {VOICE_CLIPS.map((clip) => (
            <button className={recording === clip ? "icon-button danger" : "icon-button"} key={clip} type="button" onClick={() => void toggleRecording(clip)} title={`Record ${clip}`}>
              <Volume2 size={18} />
              <span className="sr-only">{clip}</span>
            </button>
          ))}
        </div>

        <p className="helper-text">{cameraStatus}</p>
        <p className="helper-text">
          {providerStatus === "idle" && `${selectedProvider.label} is not loaded.`}
          {providerStatus === "loading" && `Loading ${selectedProvider.label}...`}
          {providerStatus === "ready" && `${selectedProvider.label} ready.`}
          {providerStatus === "error" && `Segmentation unavailable: ${providerError}`}
        </p>

        <button className="primary-button full-width" type="button" onClick={() => void saveFighter()} disabled={saving}>
          {saving ? "Saving..." : "Save fighter"}
        </button>
      </aside>
    </section>
  );
}

function normalizeSegmentationOptions(value: unknown): SegmentationProviderOptions {
  if (!value || typeof value !== "object") {
    return DEFAULT_SEGMENTATION_OPTIONS;
  }
  const saved = value as Partial<SegmentationProviderOptions>;
  const savedMediaPipe = saved["mediapipe-selfie"];
  const savedTransformers = saved["transformers-background-removal"];
  const modelId = savedTransformers?.modelId;
  const transformersModelId: TransformersModelId = isTransformersModelId(modelId)
    ? modelId
    : DEFAULT_SEGMENTATION_OPTIONS["transformers-background-removal"].modelId;

  return {
    "mediapipe-selfie": {
      maskLow:
        typeof savedMediaPipe?.maskLow === "number"
          ? clamp(savedMediaPipe.maskLow, 0.05, 0.65)
          : DEFAULT_SEGMENTATION_OPTIONS["mediapipe-selfie"].maskLow,
      maskHigh:
        typeof savedMediaPipe?.maskHigh === "number"
          ? clamp(savedMediaPipe.maskHigh, 0.25, 0.95)
          : DEFAULT_SEGMENTATION_OPTIONS["mediapipe-selfie"].maskHigh,
    },
    "transformers-background-removal": {
      modelId: transformersModelId,
    },
  };
}

function isTransformersModelId(value: unknown): value is TransformersModelId {
  return typeof value === "string" && TRANSFORMERS_MODELS.some((model) => model.id === value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
