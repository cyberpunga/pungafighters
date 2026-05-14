import { Camera, FileJson, Images, Mic, Pause, Play, Settings, Trash2, Upload, Volume2, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startVoiceRecording, type RecorderSession } from "../creator/audio";
import {
  FIGHTER_CHARACTER_IMPORT_ACCEPT,
  FIGHTER_IMAGE_IMPORT_ACCEPT,
  readFighterCharacterFile,
  readSpritesheetDraftFile,
  SPRITESHEET_IMPORT_ACCEPT,
} from "../creator/fighterFiles";
import { canvasToPngBlob, decodeImageBlob, imageSourceToCanvas, normalizeCanvas, videoToSourceCanvas } from "../creator/imageProcessing";
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

interface DraftAsset {
  blob: Blob;
  url: string;
}

interface PoseDraft {
  source?: DraftAsset;
  frame?: DraftAsset;
  processed: boolean;
}

type PoseDrafts = Partial<Record<FighterPose, PoseDraft>>;
type VoiceDrafts = Partial<Record<VoiceClipType, DraftAsset>>;

type CreatorOperation =
  | { type: "start-camera" | "capture" | "import" | "process"; pose: FighterPose }
  | { type: "import-character" | "import-spritesheet" | "process-all" };

export function CreatorView(props: { onSaved: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const characterImportInputRef = useRef<HTMLInputElement | null>(null);
  const spritesheetImportInputRef = useRef<HTMLInputElement | null>(null);
  const poseImportInputRefs = useRef<Partial<Record<FighterPose, HTMLInputElement | null>>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<RecorderSession | null>(null);
  const draftsRef = useRef<PoseDrafts>({});
  const voiceDraftsRef = useRef<VoiceDrafts>({});
  const providerLoadIdRef = useRef(0);
  const countdownTimeoutRef = useRef<number | undefined>();
  const countdownActiveRef = useRef(false);
  const [name, setName] = useState("New Fighter");
  const [drafts, setDrafts] = useState<PoseDrafts>({});
  const [voiceDrafts, setVoiceDrafts] = useState<VoiceDrafts>({});
  const [recording, setRecording] = useState<VoiceClipType | undefined>();
  const [playingClip, setPlayingClip] = useState<VoiceClipType | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Camera is off.");
  const [providerId, setProviderId] = useState<SegmentationProviderId>(DEFAULT_SEGMENTATION_PROVIDER_ID);
  const [segmentationOptions, setSegmentationOptions] =
    useState<SegmentationProviderOptions>(DEFAULT_SEGMENTATION_OPTIONS);
  const [providerStatus, setProviderStatus] = useState<SegmentationProviderState>("idle");
  const [providerError, setProviderError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [previewPose, setPreviewPose] = useState<FighterPose | undefined>();
  const [captureDelays, setCaptureDelays] = useState<Record<FighterPose, CaptureDelay>>(createDefaultCaptureDelays);
  const [countdown, setCountdown] = useState<{ pose: FighterPose; remaining: number } | undefined>();
  const [activeOperation, setActiveOperation] = useState<CreatorOperation | undefined>();
  const [saving, setSaving] = useState(false);
  const selectedProvider = useMemo(() => getSegmentationProvider(providerId), [providerId]);
  const selectedOptions = segmentationOptions[providerId];
  const operationBusy = Boolean(activeOperation) || Boolean(countdown) || saving;
  const creatorBusy = operationBusy || Boolean(recording);
  const hasProcessableSources = FIGHTER_POSES.some((pose) => Boolean(drafts[pose]?.source));
  const saveComplete = FIGHTER_POSES.every((pose) => Boolean(drafts[pose]?.frame));

  const replaceDrafts = useCallback((nextDrafts: PoseDrafts) => {
    setDrafts((current) => {
      revokeDrafts(current);
      return nextDrafts;
    });
  }, []);

  const replacePoseDraft = useCallback((pose: FighterPose, nextDraft: PoseDraft) => {
    setDrafts((current) => {
      revokeDraft(current[pose]);
      return { ...current, [pose]: nextDraft };
    });
  }, []);

  const replacePoseFrame = useCallback((pose: FighterPose, frameBlob: Blob, processed: boolean) => {
    const frame = createDraftAsset(frameBlob);
    setDrafts((current) => {
      const currentDraft = current[pose];
      if (!currentDraft?.source) {
        revokeDraftAsset(frame);
        return current;
      }
      revokeDraftAsset(currentDraft.frame);
      return { ...current, [pose]: { ...currentDraft, frame, processed } };
    });
  }, []);

  const replaceVoiceDrafts = useCallback((nextDrafts: VoiceDrafts) => {
    setVoiceDrafts((current) => {
      revokeVoiceDrafts(current);
      return nextDrafts;
    });
  }, []);

  const replaceVoiceDraft = useCallback((clip: VoiceClipType, blob: Blob) => {
    setVoiceDrafts((current) => {
      revokeDraftAsset(current[clip]);
      return { ...current, [clip]: createDraftAsset(blob) };
    });
  }, []);

  const removeVoiceDraft = useCallback((clip: VoiceClipType) => {
    setVoiceDrafts((current) => {
      revokeDraftAsset(current[clip]);
      const next = { ...current };
      delete next[clip];
      return next;
    });
  }, []);

  const attachCameraStream = useCallback((stream: MediaStream) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    void video.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    voiceDraftsRef.current = voiceDrafts;
  }, [voiceDrafts]);

  useEffect(() => {
    if (previewPose && streamRef.current) {
      attachCameraStream(streamRef.current);
    }
  }, [attachCameraStream, previewPose]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current?.cancel();
      countdownActiveRef.current = false;
      if (countdownTimeoutRef.current) {
        window.clearTimeout(countdownTimeoutRef.current);
      }
      audioRef.current?.pause();
      revokeDrafts(draftsRef.current);
      revokeVoiceDrafts(voiceDraftsRef.current);
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

  useEffect(() => {
    if (hasProcessableSources && providerStatus === "idle") {
      void loadProvider(selectedProvider, selectedOptions);
    }
  }, [hasProcessableSources, loadProvider, providerStatus, selectedOptions, selectedProvider]);

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
    if (streamRef.current) {
      attachCameraStream(streamRef.current);
      setCameraReady(true);
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 960, height: 720 }, audio: false });
      streamRef.current = stream;
      attachCameraStream(stream);
      setCameraReady(true);
      setCameraStatus("Camera ready.");
      void loadProvider(selectedProvider, selectedOptions);
      return true;
    } catch (error) {
      setCameraReady(false);
      setCameraStatus(error instanceof Error ? `Camera unavailable: ${error.message}` : "Camera unavailable.");
      return false;
    }
  };

  const capturePose = async (pose: FighterPose) => {
    if (creatorBusy) {
      return;
    }
    setPreviewPose(pose);
    if (!streamRef.current) {
      setActiveOperation({ type: "start-camera", pose });
      const started = await startCamera();
      setActiveOperation(undefined);
      if (started) {
        setCameraStatus(`${pose} camera ready. Press Capture again when your pose is set.`);
      } else {
        setPreviewPose(undefined);
      }
      return;
    }

    await waitForInlinePreview();
    attachCameraStream(streamRef.current);
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      if (video) {
        await waitForVideoReady(video);
      }
    }
    if (!video || !video.videoWidth) {
      setCameraStatus("Camera is warming up. Try Capture again in a moment.");
      return;
    }

    setActiveOperation({ type: "capture", pose });
    try {
      const captureDelay = captureDelays[pose];
      if (captureDelay > 0) {
        countdownActiveRef.current = true;
        setCountdown({ pose, remaining: captureDelay });
        setCameraStatus(`Capturing ${pose} in ${captureDelay} seconds.`);
        for (let remaining = captureDelay - 1; remaining >= 0; remaining -= 1) {
          await waitOneSecond();
          if (!countdownActiveRef.current) {
            return;
          }
          setCountdown(remaining > 0 ? { pose, remaining } : undefined);
          if (remaining > 0) {
            setCameraStatus(`Capturing ${pose} in ${remaining} seconds.`);
          }
        }
        countdownActiveRef.current = false;
      } else {
        setCameraStatus(`Capturing ${pose}.`);
      }

      const sourceCanvas = videoToSourceCanvas(video);
      const sourceBlob = await canvasToPngBlob(sourceCanvas);
      const frameBlob = await canvasToPngBlob(normalizeCanvas(sourceCanvas));
      replacePoseDraft(pose, createPoseDraft(sourceBlob, frameBlob, false));
      setCameraStatus(`${pose} source captured. Process it for a cutout or save it as-is.`);
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not capture this action.");
    } finally {
      countdownActiveRef.current = false;
      setCountdown(undefined);
      setPreviewPose(undefined);
      setActiveOperation(undefined);
    }
  };

  const waitOneSecond = () =>
    new Promise<void>((resolve) => {
      countdownTimeoutRef.current = window.setTimeout(resolve, 1000);
    });

  const waitForInlinePreview = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });

  const importPoseImage = async (pose: FighterPose, file: File) => {
    if (creatorBusy) {
      return;
    }
    setActiveOperation({ type: "import", pose });
    try {
      const image = await decodeImageBlob(file, "Could not read action image.");
      try {
        const frameBlob = await canvasToPngBlob(normalizeCanvas(image.source));
        replacePoseDraft(pose, createPoseDraft(file, frameBlob, false));
        setPreviewPose((current) => (current === pose ? undefined : current));
        setCameraStatus(`${pose} image imported. Process it for a cutout or save it as-is.`);
      } finally {
        image.close();
      }
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not import action image.");
    } finally {
      setActiveOperation(undefined);
    }
  };

  const importFighterDraft = async (file: File) => {
    if (creatorBusy) {
      return;
    }
    setActiveOperation({ type: "import-character" });
    try {
      setCameraStatus(`Importing ${file.name}...`);
      const imported = await readFighterCharacterFile(file);
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setRecording(undefined);
      replaceDrafts(createDraftsFromFrameBlobs(imported.frameBlobs, true));
      setPreviewPose(undefined);
      replaceVoiceDrafts(createVoiceDrafts(imported.voiceBlobs));
      setName(imported.name);
      setCameraStatus("Fighter draft imported. Press Save fighter when ready.");
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not import fighter.");
    } finally {
      setActiveOperation(undefined);
    }
  };

  const importSpritesheetDraft = async (file: File) => {
    if (creatorBusy) {
      return;
    }
    setActiveOperation({ type: "import-spritesheet" });
    try {
      setCameraStatus(`Importing ${file.name}...`);
      const imported = await readSpritesheetDraftFile(file);
      replaceDrafts(createDraftsFromSourceAndFrameBlobs(imported.sourceBlobs, imported.frameBlobs, false));
      setPreviewPose(undefined);
      replaceVoiceDrafts({});
      setName(imported.name);
      setCameraStatus("Spritesheet imported. Process actions for cutouts or save them as-is.");
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not import spritesheet.");
    } finally {
      setActiveOperation(undefined);
    }
  };

  const processPose = async (pose: FighterPose) => {
    if (creatorBusy) {
      return;
    }
    if (providerStatus !== "ready") {
      setCameraStatus(providerStatus === "error" ? "Segmentation failed to load, so processing is unavailable." : "Wait for segmentation before processing.");
      return;
    }
    const draft = draftsRef.current[pose];
    if (!draft?.source) {
      setCameraStatus(`Import or capture ${pose} before processing.`);
      return;
    }

    setActiveOperation({ type: "process", pose });
    try {
      const frameBlob = await processSourceBlob(draft.source.blob);
      replacePoseFrame(pose, frameBlob, true);
      setPreviewPose((current) => (current === pose ? undefined : current));
      setCameraStatus(`${pose} processed with ${selectedProvider.label}.`);
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not process this action.");
    } finally {
      setActiveOperation(undefined);
    }
  };

  const processAll = async () => {
    if (creatorBusy) {
      return;
    }
    if (providerStatus !== "ready") {
      setCameraStatus(providerStatus === "error" ? "Segmentation failed to load, so processing is unavailable." : "Wait for segmentation before processing.");
      return;
    }
    const posesWithSources = FIGHTER_POSES.filter((pose) => Boolean(draftsRef.current[pose]?.source));
    if (!posesWithSources.length) {
      setCameraStatus("Import or capture at least one action before processing.");
      return;
    }

    setActiveOperation({ type: "process-all" });
    try {
      for (const pose of posesWithSources) {
        const source = draftsRef.current[pose]?.source;
        if (!source) {
          continue;
        }
        const frameBlob = await processSourceBlob(source.blob);
        replacePoseFrame(pose, frameBlob, true);
      }
      setPreviewPose(undefined);
      setCameraStatus(`Processed ${posesWithSources.length} actions with ${selectedProvider.label}.`);
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not process every action.");
    } finally {
      setActiveOperation(undefined);
    }
  };

  const processSourceBlob = async (blob: Blob) => {
    const image = await decodeImageBlob(blob, "Could not read source image.");
    try {
      const sourceCanvas = imageSourceToCanvas(image.source);
      const cutout = await selectedProvider.segment(sourceCanvas, selectedOptions);
      const canvas = normalizeCanvas(cutout);
      return canvasToPngBlob(canvas);
    } finally {
      image.close();
    }
  };

  const saveFighter = async () => {
    const complete = FIGHTER_POSES.every((pose) => drafts[pose]?.frame);
    if (!complete) {
      setCameraStatus("Capture or import every required action before saving.");
      return;
    }
    setSaving(true);
    try {
      await saveFighterDraft({
        name,
        frameBlobs: Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, drafts[pose]!.frame!.blob])) as Record<FighterPose, Blob>,
        voiceBlobs: createVoiceBlobRecord(voiceDrafts),
      });
      await props.onSaved();
      setCameraStatus("Fighter saved locally.");
    } catch (error) {
      setCameraStatus(error instanceof Error ? error.message : "Could not save fighter.");
    } finally {
      setSaving(false);
    }
  };

  const toggleRecording = async (clip: VoiceClipType) => {
    if (recording) {
      const blob = await recorderRef.current?.stop();
      recorderRef.current = null;
      if (blob) {
        replaceVoiceDraft(recording, blob);
        setCameraStatus(`${recording} sound recorded.`);
      }
      setRecording(undefined);
      return;
    }
    recorderRef.current = await startVoiceRecording();
    setRecording(clip);
    setPlayingClip(undefined);
    audioRef.current?.pause();
    setCameraStatus(`Recording ${clip} sound.`);
  };

  const toggleVoicePlayback = async (clip: VoiceClipType) => {
    const draft = voiceDrafts[clip];
    if (!draft || recording) {
      return;
    }
    if (playingClip === clip) {
      audioRef.current?.pause();
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
      setPlayingClip(undefined);
      return;
    }

    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.pause();
    audio.src = draft.url;
    audio.currentTime = 0;
    audio.onended = () => setPlayingClip(undefined);
    audio.onerror = () => {
      setPlayingClip(undefined);
      setCameraStatus(`Could not play ${clip} sound.`);
    };
    try {
      await audio.play();
      setPlayingClip(clip);
    } catch (error) {
      setPlayingClip(undefined);
      setCameraStatus(error instanceof Error ? error.message : `Could not play ${clip} sound.`);
    }
  };

  const deleteVoiceClip = (clip: VoiceClipType) => {
    if (playingClip === clip) {
      audioRef.current?.pause();
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
      setPlayingClip(undefined);
    }
    removeVoiceDraft(clip);
    setCameraStatus(`${clip} sound removed.`);
  };

  const setPoseCaptureDelay = (pose: FighterPose, delay: CaptureDelay) => {
    setCaptureDelays((current) => ({ ...current, [pose]: delay }));
  };

  return (
    <section className="creator-grid">
      <div className="creator-workspace">
        <label className="field-label creator-name-field">
          Fighter name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} disabled={creatorBusy} />
        </label>

        <div className="creator-source-row" aria-label="Fighter source">
          <button className="secondary-button source-action" type="button" onClick={() => characterImportInputRef.current?.click()} disabled={creatorBusy}>
            <FileJson size={18} />
            Import fighter
          </button>
          <input
            ref={characterImportInputRef}
            className="sr-only"
            type="file"
            accept={FIGHTER_CHARACTER_IMPORT_ACCEPT}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void importFighterDraft(file);
              }
            }}
          />
          <button className="secondary-button source-action" type="button" onClick={() => spritesheetImportInputRef.current?.click()} disabled={creatorBusy}>
            <Images size={18} />
            Import strip
          </button>
          <input
            ref={spritesheetImportInputRef}
            className="sr-only"
            type="file"
            accept={SPRITESHEET_IMPORT_ACCEPT}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void importSpritesheetDraft(file);
              }
            }}
          />
          <button
            className="secondary-button source-action"
            type="button"
            onClick={() => void processAll()}
            disabled={creatorBusy || providerStatus !== "ready" || !hasProcessableSources}
          >
            <Wand2 size={18} />
            {activeOperation?.type === "process-all" ? "Processing..." : "Process all"}
          </button>
        </div>

        <div className="pose-grid" aria-label="Required actions">
          {FIGHTER_POSES.map((pose) => {
            const draft = drafts[pose];
            return (
              <div className={draft?.frame ? "pose-card complete" : "pose-card"} key={pose}>
                <div className={previewPose === pose ? "pose-frame-preview live" : "pose-frame-preview"}>
                  {previewPose === pose ? (
                    <video ref={videoRef} autoPlay muted playsInline />
                  ) : draft?.frame ? (
                    <img src={draft.frame.url} alt="" />
                  ) : (
                    <span>{pose}</span>
                  )}
                </div>
                <div className="pose-card-body">
                  <div className="pose-card-header">
                    <strong>{pose}</strong>
                    <span>{getPoseStatus(draft)}</span>
                  </div>
                  <div className="pose-delay-control" aria-label={`${pose} capture delay`}>
                    {CAPTURE_DELAYS.map((delay) => (
                      <button
                        className={captureDelays[pose] === delay ? "delay-option active" : "delay-option"}
                        key={delay}
                        type="button"
                        onClick={() => setPoseCaptureDelay(pose, delay)}
                        disabled={creatorBusy}
                        title={delay === 0 ? "Capture immediately" : `Capture after ${delay} seconds`}
                      >
                        {delay === 0 ? "Now" : `${delay}s`}
                      </button>
                    ))}
                  </div>
                  <div className="pose-action-row">
                    <button className="secondary-button pose-action-button" type="button" onClick={() => void capturePose(pose)} disabled={creatorBusy}>
                      <Camera size={16} />
                      {getCaptureButtonLabel(pose, countdown, activeOperation, cameraReady)}
                    </button>
                    <button className="secondary-button pose-action-button" type="button" onClick={() => poseImportInputRefs.current[pose]?.click()} disabled={creatorBusy}>
                      <Upload size={16} />
                      Import
                    </button>
                    <input
                      ref={(node) => {
                        poseImportInputRefs.current[pose] = node;
                      }}
                      className="sr-only"
                      type="file"
                      accept={FIGHTER_IMAGE_IMPORT_ACCEPT}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) {
                          void importPoseImage(pose, file);
                        }
                      }}
                    />
                    <button
                      className="secondary-button pose-action-button"
                      type="button"
                      onClick={() => void processPose(pose)}
                      disabled={creatorBusy || providerStatus !== "ready" || !draft?.source}
                    >
                      <Wand2 size={16} />
                      {activeOperation?.type === "process" && activeOperation.pose === pose ? "Wait" : "Process"}
                    </button>
                    <button
                      className="secondary-button pose-action-button pose-settings-button"
                      type="button"
                      onClick={() => setSettingsOpen(true)}
                      disabled={operationBusy}
                      title="Cutout settings"
                    >
                      <Settings size={16} />
                      <span className="sr-only">Cutout settings</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <section className="sound-section" aria-label="Sounds">
          <div className="sound-section-header">
            <Volume2 size={18} />
            <span className="field-label-text">Sounds</span>
          </div>
          <div className="sound-grid">
            {VOICE_CLIPS.map((clip) => {
              const draft = voiceDrafts[clip];
              const isRecording = recording === clip;
              const isPlaying = playingClip === clip;
              return (
                <div className="sound-card" key={clip}>
                  <div className="sound-card-title">
                    <strong>{clip}</strong>
                    <span>{isRecording ? "Recording" : draft ? "Recorded" : "Empty"}</span>
                  </div>
                  <div className="sound-actions">
                    <button
                      className={isRecording ? "icon-button danger" : "icon-button"}
                      type="button"
                      onClick={() => void toggleRecording(clip)}
                      title={`${isRecording ? "Stop recording" : "Record"} ${clip}`}
                      disabled={operationBusy || Boolean(recording && recording !== clip)}
                    >
                      <Mic size={18} />
                      <span className="sr-only">{isRecording ? `Stop recording ${clip}` : `Record ${clip}`}</span>
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => void toggleVoicePlayback(clip)}
                      title={`${isPlaying ? "Pause" : "Play"} ${clip}`}
                      disabled={operationBusy || Boolean(recording) || !draft}
                    >
                      {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                      <span className="sr-only">{isPlaying ? `Pause ${clip}` : `Play ${clip}`}</span>
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      onClick={() => deleteVoiceClip(clip)}
                      title={`Remove ${clip}`}
                      disabled={operationBusy || Boolean(recording) || !draft}
                    >
                      <Trash2 size={18} />
                      <span className="sr-only">Remove {clip}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="creator-footer">
          <div className="creator-status">
            <p className="helper-text">{cameraStatus}</p>
            <p className="helper-text">
              {providerStatus === "idle" && `${selectedProvider.label} is not loaded.`}
              {providerStatus === "loading" && `Loading ${selectedProvider.label}...`}
              {providerStatus === "ready" && `${selectedProvider.label} ready.`}
              {providerStatus === "error" && `Segmentation unavailable: ${providerError}`}
            </p>
          </div>
          <button className="primary-button" type="button" onClick={() => void saveFighter()} disabled={creatorBusy || !saveComplete}>
            {saving ? "Saving..." : "Save fighter"}
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="creator-drawer-shell">
          <button className="creator-drawer-backdrop" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close cutout settings" />
          <aside className="creator-settings-drawer" role="dialog" aria-modal="true" aria-label="Cutout settings">
            <div className="drawer-header">
              <strong>Cutout settings</strong>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} title="Close cutout settings">
                <X size={18} />
                <span className="sr-only">Close cutout settings</span>
              </button>
            </div>
        <div className="provider-control" aria-label="Segmentation provider">
          <span className="field-label-text">Cutout engine</span>
          <div className="segmented-control">
            {SEGMENTATION_PROVIDERS.map((provider) => (
              <button
                className={provider.id === providerId ? "segment-option active" : "segment-option"}
                key={provider.id}
                type="button"
                onClick={() => selectProvider(provider.id)}
                disabled={creatorBusy}
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
                disabled={creatorBusy}
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
                disabled={creatorBusy}
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
                  disabled={creatorBusy}
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
          </aside>
        </div>
      )}
    </section>
  );
}

function createDefaultCaptureDelays(): Record<FighterPose, CaptureDelay> {
  return Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, 5])) as Record<FighterPose, CaptureDelay>;
}

function createDraftAsset(blob: Blob): DraftAsset {
  return { blob, url: URL.createObjectURL(blob) };
}

function createPoseDraft(sourceBlob: Blob, frameBlob: Blob, processed: boolean): PoseDraft {
  return {
    source: createDraftAsset(sourceBlob),
    frame: createDraftAsset(frameBlob),
    processed,
  };
}

function createDraftsFromFrameBlobs(frameBlobs: Record<FighterPose, Blob>, processed: boolean): PoseDrafts {
  return Object.fromEntries(
    FIGHTER_POSES.map((pose) => {
      const blob = frameBlobs[pose];
      return [pose, createPoseDraft(blob, blob, processed)];
    }),
  ) as PoseDrafts;
}

function createDraftsFromSourceAndFrameBlobs(
  sourceBlobs: Record<FighterPose, Blob>,
  frameBlobs: Record<FighterPose, Blob>,
  processed: boolean,
): PoseDrafts {
  return Object.fromEntries(
    FIGHTER_POSES.map((pose) => [pose, createPoseDraft(sourceBlobs[pose], frameBlobs[pose], processed)]),
  ) as PoseDrafts;
}

function createVoiceDrafts(voiceBlobs: Partial<Record<VoiceClipType, Blob>>): VoiceDrafts {
  return Object.fromEntries(
    Object.entries(voiceBlobs).flatMap(([clip, blob]) => (blob ? [[clip, createDraftAsset(blob)]] : [])),
  ) as VoiceDrafts;
}

function createVoiceBlobRecord(voiceDrafts: VoiceDrafts): Partial<Record<VoiceClipType, Blob>> {
  return Object.fromEntries(
    VOICE_CLIPS.flatMap((clip) => {
      const draft = voiceDrafts[clip];
      return draft ? [[clip, draft.blob] as const] : [];
    }),
  ) as Partial<Record<VoiceClipType, Blob>>;
}

function revokeDrafts(drafts: PoseDrafts) {
  Object.values(drafts).forEach(revokeDraft);
}

function revokeVoiceDrafts(drafts: VoiceDrafts) {
  Object.values(drafts).forEach(revokeDraftAsset);
}

function revokeDraft(draft: PoseDraft | undefined) {
  revokeDraftAsset(draft?.source);
  if (draft?.frame?.url !== draft?.source?.url) {
    revokeDraftAsset(draft?.frame);
  }
}

function revokeDraftAsset(asset: DraftAsset | undefined) {
  if (asset) {
    URL.revokeObjectURL(asset.url);
  }
}

function getPoseStatus(draft: PoseDraft | undefined) {
  if (draft?.processed) {
    return "Processed";
  }
  if (draft?.frame) {
    return "Source ready";
  }
  return "Needs image";
}

function getCaptureButtonLabel(
  pose: FighterPose,
  countdown: { pose: FighterPose; remaining: number } | undefined,
  activeOperation: CreatorOperation | undefined,
  cameraReady: boolean,
) {
  if (countdown?.pose === pose) {
    return `${countdown.remaining}`;
  }
  if (
    (activeOperation?.type === "capture" || activeOperation?.type === "start-camera") &&
    activeOperation.pose === pose
  ) {
    return "Wait";
  }
  return cameraReady ? "Capture" : "Start";
}

function waitForVideoReady(video: HTMLVideoElement) {
  if (video.videoWidth) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      video.removeEventListener("loadedmetadata", resolveReady);
      resolve();
    }, 500);
    const resolveReady = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.addEventListener("loadedmetadata", resolveReady, { once: true });
  });
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
