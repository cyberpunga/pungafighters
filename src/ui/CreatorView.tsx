import {
  Camera,
  FileJson,
  ImagePlus,
  Images,
  Mic,
  Pause,
  Play,
  Redo2,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startVoiceRecording, type RecorderSession } from "../creator/audio";
import { dataUrlToFile, fileToReferenceImage, generateCharacterSpritesheet } from "../creator/characterGeneration";
import {
  FIGHTER_CHARACTER_IMPORT_ACCEPT,
  FIGHTER_IMAGE_IMPORT_ACCEPT,
  readFighterCharacterFile,
  readSpritesheetDraftFile,
  SPRITESHEET_IMPORT_ACCEPT,
} from "../creator/fighterFiles";
import {
  canvasToPngBlob,
  decodeImageBlob,
  imageSourceToCanvas,
  normalizeCanvas,
  videoToSourceCanvas,
} from "../creator/imageProcessing";
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
import { loadEditableFighterDraft, saveFighterDraft, getSetting, setSetting } from "../storage/db";
import type { FighterPose, VoiceClipType } from "../types/game";
import { FIGHTER_POSES, VOICE_CLIPS } from "../types/game";
import { localizeError } from "../i18n/errors";
import { poseLabel, voiceClipLabel } from "../i18n";
import type { Translate } from "../i18n";
import { useI18n } from "../i18n/react";

const SEGMENTATION_PROVIDER_SETTING_KEY = "segmentation.providerId";
const SEGMENTATION_OPTIONS_SETTING_KEY = "segmentation.options";
const CAPTURE_DELAYS = [0, 5, 10, 15] as const;
const GENERATION_MODEL_OPTIONS = ["", "nano-banana-2", "nano-banana-pro", "nano-banana", "custom"] as const;
const POSE_FRAME_HISTORY_LIMIT = 12;

type CaptureDelay = (typeof CAPTURE_DELAYS)[number];
type GenerationModelOption = (typeof GENERATION_MODEL_OPTIONS)[number];

interface DraftAsset {
  blob: Blob;
  url: string;
}

interface PoseDraft {
  source?: DraftAsset;
  frame?: DraftAsset;
  processed: boolean;
}

interface PoseFrameSnapshot {
  blob: Blob;
  processed: boolean;
}

interface PoseFrameHistory {
  past: PoseFrameSnapshot[];
  future: PoseFrameSnapshot[];
}

type PoseDrafts = Partial<Record<FighterPose, PoseDraft>>;
type PoseFrameHistories = Partial<Record<FighterPose, PoseFrameHistory>>;
type VoiceDrafts = Partial<Record<VoiceClipType, DraftAsset>>;

type CreatorOperation =
  | { type: "start-camera" | "capture" | "import" | "process"; pose: FighterPose }
  | { type: "generate" | "import-character" | "import-spritesheet" | "load-fighter" | "process-all" };

export function CreatorView(props: { editFighterId?: string; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
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
  const previousEditIdRef = useRef<string | undefined>(props.editFighterId);
  const [name, setName] = useState(() => t("creator.newFighter"));
  const [editingFighterId, setEditingFighterId] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<PoseDrafts>({});
  const [poseFrameHistories, setPoseFrameHistories] = useState<PoseFrameHistories>({});
  const [voiceDrafts, setVoiceDrafts] = useState<VoiceDrafts>({});
  const [recording, setRecording] = useState<VoiceClipType | undefined>();
  const [playingClip, setPlayingClip] = useState<VoiceClipType | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generationModel, setGenerationModel] = useState<GenerationModelOption>("");
  const [generationCustomModel, setGenerationCustomModel] = useState("");
  const [generationReferenceFile, setGenerationReferenceFile] = useState<File | undefined>();
  const [cameraStatus, setCameraStatus] = useState(() => t("creator.cameraOff"));
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
    setPoseFrameHistories({});
    setDrafts((current) => {
      revokeDrafts(current);
      return nextDrafts;
    });
  }, []);

  const replacePoseDraft = useCallback((pose: FighterPose, nextDraft: PoseDraft) => {
    setPoseFrameHistories((current) => {
      if (!current[pose]) {
        return current;
      }
      const next = { ...current };
      delete next[pose];
      return next;
    });
    setDrafts((current) => {
      revokeDraft(current[pose]);
      return { ...current, [pose]: nextDraft };
    });
  }, []);

  const pushPoseFrameHistory = useCallback((pose: FighterPose, snapshot: PoseFrameSnapshot) => {
    setPoseFrameHistories((current) => {
      const history = current[pose] ?? { past: [], future: [] };
      return {
        ...current,
        [pose]: {
          past: [...history.past, snapshot].slice(-POSE_FRAME_HISTORY_LIMIT),
          future: [],
        },
      };
    });
  }, []);

  const applyPoseFrameSnapshot = useCallback((pose: FighterPose, snapshot: PoseFrameSnapshot) => {
    const frame = createDraftAsset(snapshot.blob);
    setDrafts((current) => {
      const currentDraft = current[pose];
      if (!currentDraft?.source) {
        revokeDraftAsset(frame);
        return current;
      }
      revokeDraftAsset(currentDraft.frame);
      return { ...current, [pose]: { ...currentDraft, frame, processed: snapshot.processed } };
    });
    setPreviewPose((current) => (current === pose ? undefined : current));
  }, []);

  const replacePoseFrame = useCallback(
    (pose: FighterPose, frameBlob: Blob, processed: boolean) => {
      const currentDraft = draftsRef.current[pose];
      if (!currentDraft?.source) {
        return;
      }
      if (currentDraft.frame) {
        pushPoseFrameHistory(pose, { blob: currentDraft.frame.blob, processed: currentDraft.processed });
      }
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
    },
    [pushPoseFrameHistory],
  );

  const undoPoseFrame = useCallback(
    (pose: FighterPose) => {
      if (creatorBusy) {
        return;
      }
      const draft = draftsRef.current[pose];
      const history = poseFrameHistories[pose];
      const previous = history?.past[history.past.length - 1];
      if (!draft?.frame || !previous) {
        return;
      }
      const currentSnapshot: PoseFrameSnapshot = { blob: draft.frame.blob, processed: draft.processed };
      setPoseFrameHistories((current) => {
        const currentHistory = current[pose];
        if (!currentHistory?.past.length) {
          return current;
        }
        return {
          ...current,
          [pose]: {
            past: currentHistory.past.slice(0, -1),
            future: [...currentHistory.future, currentSnapshot].slice(-POSE_FRAME_HISTORY_LIMIT),
          },
        };
      });
      applyPoseFrameSnapshot(pose, previous);
    },
    [applyPoseFrameSnapshot, creatorBusy, poseFrameHistories],
  );

  const redoPoseFrame = useCallback(
    (pose: FighterPose) => {
      if (creatorBusy) {
        return;
      }
      const draft = draftsRef.current[pose];
      const history = poseFrameHistories[pose];
      const nextFrame = history?.future[history.future.length - 1];
      if (!draft?.frame || !nextFrame) {
        return;
      }
      const currentSnapshot: PoseFrameSnapshot = { blob: draft.frame.blob, processed: draft.processed };
      setPoseFrameHistories((current) => {
        const currentHistory = current[pose];
        if (!currentHistory?.future.length) {
          return current;
        }
        return {
          ...current,
          [pose]: {
            past: [...currentHistory.past, currentSnapshot].slice(-POSE_FRAME_HISTORY_LIMIT),
            future: currentHistory.future.slice(0, -1),
          },
        };
      });
      applyPoseFrameSnapshot(pose, nextFrame);
    },
    [applyPoseFrameSnapshot, creatorBusy, poseFrameHistories],
  );

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
    if (!props.editFighterId) {
      if (previousEditIdRef.current) {
        previousEditIdRef.current = undefined;
        setEditingFighterId(undefined);
        setName(t("creator.newFighter"));
        replaceDrafts({});
        replaceVoiceDrafts({});
        setPreviewPose(undefined);
        setCameraStatus(t("creator.cameraOff"));
      }
      return;
    }

    let cancelled = false;
    previousEditIdRef.current = props.editFighterId;
    setActiveOperation({ type: "load-fighter" });
    setCameraStatus(t("creator.loadingFighter"));
    void loadEditableFighterDraft(props.editFighterId)
      .then((draft) => {
        if (cancelled) {
          return;
        }
        if (!draft) {
          setEditingFighterId(undefined);
          setCameraStatus(t("creator.fighterNotFound"));
          return;
        }
        recorderRef.current?.cancel();
        recorderRef.current = null;
        setRecording(undefined);
        setPlayingClip(undefined);
        audioRef.current?.pause();
        replaceDrafts(createDraftsFromFrameBlobs(draft.frameBlobs, true));
        replaceVoiceDrafts(createVoiceDrafts(draft.voiceBlobs));
        setName(draft.name);
        setPreviewPose(undefined);
        setEditingFighterId(draft.isDefault ? undefined : draft.id);
        setCameraStatus(draft.isDefault ? t("creator.defaultLoaded") : t("creator.fighterLoaded"));
      })
      .catch((error) => {
        if (!cancelled) {
          setEditingFighterId(undefined);
          setCameraStatus(localizeError(error, t, "creator.loadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setActiveOperation(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.editFighterId, replaceDrafts, replaceVoiceDrafts, t]);

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

  const loadProvider = useCallback(
    async (provider: SegmentationProvider, options: SegmentationProviderOptions[SegmentationProviderId]) => {
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
          setProviderError(localizeError(error, t, "creator.providerLoadFailed"));
        }
      }
    },
    [t],
  );

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
      setCameraStatus(t("creator.cameraReady"));
      void loadProvider(selectedProvider, selectedOptions);
      return true;
    } catch (error) {
      setCameraReady(false);
      setCameraStatus(
        error instanceof Error
          ? t("creator.cameraUnavailableWithReason", { reason: error.message })
          : t("creator.cameraUnavailable"),
      );
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
        setCameraStatus(t("creator.poseCameraReady", { pose: poseLabel(t, pose) }));
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
      setCameraStatus(t("creator.cameraWarming"));
      return;
    }

    setActiveOperation({ type: "capture", pose });
    try {
      const captureDelay = captureDelays[pose];
      if (captureDelay > 0) {
        countdownActiveRef.current = true;
        setCountdown({ pose, remaining: captureDelay });
        setCameraStatus(t("creator.capturingPoseIn", { pose: poseLabel(t, pose), seconds: captureDelay }));
        for (let remaining = captureDelay - 1; remaining >= 0; remaining -= 1) {
          await waitOneSecond();
          if (!countdownActiveRef.current) {
            return;
          }
          setCountdown(remaining > 0 ? { pose, remaining } : undefined);
          if (remaining > 0) {
            setCameraStatus(t("creator.capturingPoseIn", { pose: poseLabel(t, pose), seconds: remaining }));
          }
        }
        countdownActiveRef.current = false;
      } else {
        setCameraStatus(t("creator.capturingPose", { pose: poseLabel(t, pose) }));
      }

      const sourceCanvas = videoToSourceCanvas(video);
      const sourceBlob = await canvasToPngBlob(sourceCanvas);
      const frameBlob = await canvasToPngBlob(normalizeCanvas(sourceCanvas));
      replacePoseDraft(pose, createPoseDraft(sourceBlob, frameBlob, false));
      setCameraStatus(t("creator.poseSourceCaptured", { pose: poseLabel(t, pose) }));
    } catch (error) {
      setCameraStatus(localizeError(error, t, "creator.captureFailed"));
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
      const image = await decodeImageBlob(file, t("creator.actionImageReadFailed"));
      try {
        const frameBlob = await canvasToPngBlob(normalizeCanvas(image.source));
        replacePoseDraft(pose, createPoseDraft(file, frameBlob, false));
        setPreviewPose((current) => (current === pose ? undefined : current));
        setCameraStatus(t("creator.poseImageImported", { pose: poseLabel(t, pose) }));
      } finally {
        image.close();
      }
    } catch (error) {
      setCameraStatus(localizeError(error, t, "creator.actionImageImportFailed"));
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
      setCameraStatus(t("appStatus.importingFile", { name: file.name }));
      const imported = await readFighterCharacterFile(file);
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setRecording(undefined);
      replaceDrafts(createDraftsFromFrameBlobs(imported.frameBlobs, true));
      setPreviewPose(undefined);
      replaceVoiceDrafts(createVoiceDrafts(imported.voiceBlobs));
      setName(imported.name);
      setEditingFighterId(undefined);
      setCameraStatus(t("creator.fighterDraftImported"));
    } catch (error) {
      setCameraStatus(localizeError(error, t, "creator.fighterImportFailed"));
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
      setCameraStatus(t("appStatus.importingFile", { name: file.name }));
      const imported = await readSpritesheetDraftFile(file);
      replaceDrafts(createDraftsFromSourceAndFrameBlobs(imported.sourceBlobs, imported.frameBlobs, false));
      setPreviewPose(undefined);
      replaceVoiceDrafts({});
      setName(imported.name);
      setEditingFighterId(undefined);
      setCameraStatus(t("creator.spritesheetImported"));
    } catch (error) {
      setCameraStatus(localizeError(error, t, "creator.spritesheetImportFailed"));
    } finally {
      setActiveOperation(undefined);
    }
  };

  const generateFighterDraft = async () => {
    if (creatorBusy) {
      return;
    }
    if (!generationPrompt.trim() && !generationReferenceFile) {
      setCameraStatus(t("creator.generationNeedsPromptOrReference"));
      return;
    }

    setActiveOperation({ type: "generate" });
    try {
      setCameraStatus(t("creator.generatingStripStatus"));
      const referenceImage = generationReferenceFile ? await fileToReferenceImage(generationReferenceFile) : undefined;
      const result = await generateCharacterSpritesheet({
        prompt: generationPrompt.trim(),
        model: getSelectedGenerationModel(generationModel, generationCustomModel),
        images: referenceImage ? [referenceImage] : undefined,
      });
      const file = dataUrlToFile(result.image.dataUrl, "generated-fighter-strip.png");
      const imported = await readSpritesheetDraftFile(file);
      replaceDrafts(createDraftsFromSourceAndFrameBlobs(imported.sourceBlobs, imported.frameBlobs, false));
      setPreviewPose(undefined);
      replaceVoiceDrafts({});
      setName(createGeneratedFighterName(generationPrompt, t("creator.generatedFighterName")));
      setEditingFighterId(undefined);
      setGenerationOpen(false);
      setCameraStatus(t("creator.generatedStripLoaded", { model: result.model }));
    } catch (error) {
      setCameraStatus(localizeError(error, t, "creator.generateFailed"));
    } finally {
      setActiveOperation(undefined);
    }
  };

  const processPose = async (pose: FighterPose) => {
    if (creatorBusy) {
      return;
    }
    if (providerStatus !== "ready") {
      setCameraStatus(
        providerStatus === "error" ? t("creator.segmentationLoadUnavailable") : t("creator.waitForSegmentation"),
      );
      return;
    }
    const draft = draftsRef.current[pose];
    if (!draft?.source) {
      setCameraStatus(t("creator.importOrCapturePose", { pose: poseLabel(t, pose) }));
      return;
    }

    setActiveOperation({ type: "process", pose });
    try {
      const frameBlob = await processSourceBlob(draft.source.blob);
      replacePoseFrame(pose, frameBlob, true);
      setPreviewPose((current) => (current === pose ? undefined : current));
      setCameraStatus(
        t("creator.poseProcessed", {
          pose: poseLabel(t, pose),
          provider: getSegmentationProviderLabel(t, selectedProvider),
        }),
      );
    } catch (error) {
      setCameraStatus(localizeError(error, t, "creator.processFailed"));
    } finally {
      setActiveOperation(undefined);
    }
  };

  const processAll = async () => {
    if (creatorBusy) {
      return;
    }
    if (providerStatus !== "ready") {
      setCameraStatus(
        providerStatus === "error" ? t("creator.segmentationLoadUnavailable") : t("creator.waitForSegmentation"),
      );
      return;
    }
    const posesWithSources = FIGHTER_POSES.filter((pose) => Boolean(draftsRef.current[pose]?.source));
    if (!posesWithSources.length) {
      setCameraStatus(t("creator.importOrCaptureOne"));
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
      setCameraStatus(
        t("creator.processedActions", {
          count: posesWithSources.length,
          provider: getSegmentationProviderLabel(t, selectedProvider),
        }),
      );
    } catch (error) {
      setCameraStatus(localizeError(error, t, "creator.processAllFailed"));
    } finally {
      setActiveOperation(undefined);
    }
  };

  const processSourceBlob = async (blob: Blob) => {
    const image = await decodeImageBlob(blob, t("creator.sourceImageReadFailed"));
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
      setCameraStatus(t("creator.saveIncomplete"));
      return;
    }
    setSaving(true);
    try {
      const saved = await saveFighterDraft({
        id: editingFighterId,
        name,
        frameBlobs: Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, drafts[pose]!.frame!.blob])) as Record<
          FighterPose,
          Blob
        >,
        voiceBlobs: createVoiceBlobRecord(voiceDrafts),
      });
      await props.onSaved();
      setEditingFighterId(saved.id);
      setCameraStatus(editingFighterId ? t("creator.fighterUpdated") : t("creator.fighterSaved"));
    } catch (error) {
      setCameraStatus(localizeError(error, t, "creator.saveFailed"));
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
        setCameraStatus(t("creator.soundRecorded", { clip: voiceClipLabel(t, recording) }));
      }
      setRecording(undefined);
      return;
    }
    recorderRef.current = await startVoiceRecording();
    setRecording(clip);
    setPlayingClip(undefined);
    audioRef.current?.pause();
    setCameraStatus(t("creator.recordingSound", { clip: voiceClipLabel(t, clip) }));
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
      setCameraStatus(t("creator.playSoundFailed", { clip: voiceClipLabel(t, clip) }));
    };
    try {
      await audio.play();
      setPlayingClip(clip);
    } catch (error) {
      setPlayingClip(undefined);
      setCameraStatus(
        error instanceof Error ? error.message : t("creator.playSoundFailed", { clip: voiceClipLabel(t, clip) }),
      );
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
    setCameraStatus(t("creator.soundRemoved", { clip: voiceClipLabel(t, clip) }));
  };

  const setPoseCaptureDelay = (pose: FighterPose, delay: CaptureDelay) => {
    setCaptureDelays((current) => ({ ...current, [pose]: delay }));
  };

  return (
    <section className="creator-grid">
      <div className="creator-workspace">
        <label className="field-label creator-name-field">
          {t("creator.fighterName")}
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} disabled={creatorBusy} />
        </label>

        <div className="pose-grid" aria-label={t("creator.requiredActions")}>
          {FIGHTER_POSES.map((pose) => {
            const draft = drafts[pose];
            const frameHistory = poseFrameHistories[pose];
            const canUndoFrame = Boolean(draft?.frame && frameHistory?.past.length);
            const canRedoFrame = Boolean(draft?.frame && frameHistory?.future.length);
            const poseText = poseLabel(t, pose);
            return (
              <div className={draft?.frame ? "pose-card complete" : "pose-card"} key={pose}>
                <div className={previewPose === pose ? "pose-frame-preview live" : "pose-frame-preview"}>
                  {previewPose === pose ? (
                    <video ref={videoRef} autoPlay muted playsInline />
                  ) : draft?.frame ? (
                    <img src={draft.frame.url} alt="" />
                  ) : (
                    <span>{poseText}</span>
                  )}
                </div>
                <div className="pose-card-body">
                  <div className="pose-card-header">
                    <strong>{poseText}</strong>
                    <span>{getPoseStatus(t, draft)}</span>
                  </div>
                  <div className="pose-delay-control" aria-label={t("creator.captureDelay", { pose: poseText })}>
                    {CAPTURE_DELAYS.map((delay) => (
                      <button
                        className={captureDelays[pose] === delay ? "delay-option active" : "delay-option"}
                        key={delay}
                        type="button"
                        onClick={() => setPoseCaptureDelay(pose, delay)}
                        disabled={creatorBusy}
                        title={
                          delay === 0
                            ? t("creator.captureImmediately")
                            : t("creator.captureAfterSeconds", { seconds: delay })
                        }
                      >
                        {delay === 0 ? t("creator.now") : `${delay}s`}
                      </button>
                    ))}
                  </div>
                  <div className="pose-action-row">
                    <button
                      className="secondary-button pose-action-button"
                      type="button"
                      onClick={() => void capturePose(pose)}
                      disabled={creatorBusy}
                    >
                      <Camera size={16} />
                      {getCaptureButtonLabel(t, pose, countdown, activeOperation, cameraReady)}
                    </button>
                    <button
                      className="secondary-button pose-action-button"
                      type="button"
                      onClick={() => poseImportInputRefs.current[pose]?.click()}
                      disabled={creatorBusy}
                    >
                      <Upload size={16} />
                      {t("common.import")}
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
                      {activeOperation?.type === "process" && activeOperation.pose === pose
                        ? t("common.wait")
                        : t("common.process")}
                    </button>
                    <button
                      className="secondary-button pose-action-button pose-icon-action-button"
                      type="button"
                      onClick={() => undoPoseFrame(pose)}
                      disabled={creatorBusy || !canUndoFrame}
                      title={t("common.undo")}
                    >
                      <Undo2 size={16} />
                      <span className="sr-only">{t("common.undo")}</span>
                    </button>
                    <button
                      className="secondary-button pose-action-button pose-icon-action-button"
                      type="button"
                      onClick={() => redoPoseFrame(pose)}
                      disabled={creatorBusy || !canRedoFrame}
                      title={t("common.redo")}
                    >
                      <Redo2 size={16} />
                      <span className="sr-only">{t("common.redo")}</span>
                    </button>
                    <button
                      className="secondary-button pose-action-button pose-icon-action-button pose-settings-button"
                      type="button"
                      onClick={() => setSettingsOpen(true)}
                      disabled={operationBusy}
                      title={t("creator.cutoutSettings")}
                    >
                      <Settings size={16} />
                      <span className="sr-only">{t("creator.cutoutSettings")}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <section className="sound-section" aria-label={t("common.sounds")}>
          <div className="sound-section-header">
            <Volume2 size={18} />
            <span className="field-label-text">{t("common.sounds")}</span>
          </div>
          <div className="sound-grid">
            {VOICE_CLIPS.map((clip) => {
              const draft = voiceDrafts[clip];
              const isRecording = recording === clip;
              const isPlaying = playingClip === clip;
              const clipText = voiceClipLabel(t, clip);
              return (
                <div className="sound-card" key={clip}>
                  <div className="sound-card-title">
                    <strong>{clipText}</strong>
                    <span>
                      {isRecording ? t("common.recording") : draft ? t("common.recorded") : t("common.empty")}
                    </span>
                  </div>
                  <div className="sound-actions">
                    <button
                      className={isRecording ? "icon-button danger" : "icon-button"}
                      type="button"
                      onClick={() => void toggleRecording(clip)}
                      title={
                        isRecording
                          ? t("creator.stopRecordingClip", { clip: clipText })
                          : t("creator.recordClip", { clip: clipText })
                      }
                      disabled={operationBusy || Boolean(recording && recording !== clip)}
                    >
                      <Mic size={18} />
                      <span className="sr-only">
                        {isRecording
                          ? t("creator.stopRecordingClip", { clip: clipText })
                          : t("creator.recordClip", { clip: clipText })}
                      </span>
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => void toggleVoicePlayback(clip)}
                      title={
                        isPlaying
                          ? t("creator.pauseClip", { clip: clipText })
                          : t("creator.playClip", { clip: clipText })
                      }
                      disabled={operationBusy || Boolean(recording) || !draft}
                    >
                      {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                      <span className="sr-only">
                        {isPlaying
                          ? t("creator.pauseClip", { clip: clipText })
                          : t("creator.playClip", { clip: clipText })}
                      </span>
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      onClick={() => deleteVoiceClip(clip)}
                      title={t("creator.removeClip", { clip: clipText })}
                      disabled={operationBusy || Boolean(recording) || !draft}
                    >
                      <Trash2 size={18} />
                      <span className="sr-only">{t("creator.removeClip", { clip: clipText })}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="creator-source-row" aria-label={t("creator.fighterSource")}>
          <button
            className="secondary-button source-action"
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setGenerationOpen(true);
            }}
            disabled={creatorBusy}
          >
            <Sparkles size={18} />
            {t("creator.generate")}
          </button>
          <button
            className="secondary-button source-action"
            type="button"
            onClick={() => characterImportInputRef.current?.click()}
            disabled={creatorBusy}
          >
            <FileJson size={18} />
            {t("creator.importFighter")}
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
          <button
            className="secondary-button source-action"
            type="button"
            onClick={() => spritesheetImportInputRef.current?.click()}
            disabled={creatorBusy}
          >
            <Images size={18} />
            {t("creator.importStrip")}
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
            {activeOperation?.type === "process-all" ? t("common.processing") : t("creator.processAll")}
          </button>
        </div>

        <div className="creator-footer">
          <div className="creator-status">
            <p className="helper-text">{cameraStatus}</p>
            <p className="helper-text">
              {providerStatus === "idle" &&
                t("creator.providerIdle", { provider: getSegmentationProviderLabel(t, selectedProvider) })}
              {providerStatus === "loading" &&
                t("creator.providerLoading", { provider: getSegmentationProviderLabel(t, selectedProvider) })}
              {providerStatus === "ready" &&
                t("creator.providerReady", { provider: getSegmentationProviderLabel(t, selectedProvider) })}
              {providerStatus === "error" && t("creator.providerError", { error: providerError })}
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => void saveFighter()}
            disabled={creatorBusy || !saveComplete}
          >
            {saving
              ? editingFighterId
                ? t("creator.updating")
                : t("creator.saving")
              : editingFighterId
                ? t("creator.updateFighter")
                : t("creator.saveFighter")}
          </button>
        </div>
      </div>

      {generationOpen && (
        <div className="creator-drawer-shell">
          <button
            className="creator-drawer-backdrop"
            type="button"
            onClick={() => setGenerationOpen(false)}
            aria-label={t("creator.closeGenerator")}
          />
          <aside
            className="creator-settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={t("creator.generateFighter")}
          >
            <div className="drawer-header">
              <strong>{t("creator.generateFighter")}</strong>
              <button
                className="icon-button"
                type="button"
                onClick={() => setGenerationOpen(false)}
                title={t("creator.closeGenerator")}
              >
                <X size={18} />
                <span className="sr-only">{t("creator.closeGenerator")}</span>
              </button>
            </div>

            <label className="field-label">
              {t("creator.characterPrompt")}
              <textarea
                value={generationPrompt}
                onChange={(event) => setGenerationPrompt(event.target.value)}
                placeholder={t("creator.characterPromptPlaceholder")}
                disabled={creatorBusy}
                maxLength={700}
              />
            </label>

            <label className="field-label">
              {t("creator.model")}
              <select
                value={generationModel}
                onChange={(event) => setGenerationModel(event.target.value as GenerationModelOption)}
                disabled={creatorBusy}
              >
                {GENERATION_MODEL_OPTIONS.map((option) => (
                  <option key={option || "default"} value={option}>
                    {getGenerationModelLabel(t, option)}
                  </option>
                ))}
              </select>
            </label>

            {generationModel === "custom" && (
              <label className="field-label">
                {t("creator.modelId")}
                <input
                  value={generationCustomModel}
                  onChange={(event) => setGenerationCustomModel(event.target.value)}
                  placeholder="gemini-3-pro-image-preview"
                  disabled={creatorBusy}
                />
              </label>
            )}

            <label className="field-label">
              {t("creator.referenceImage")}
              <input
                type="file"
                accept={FIGHTER_IMAGE_IMPORT_ACCEPT}
                disabled={creatorBusy}
                onChange={(event) => {
                  setGenerationReferenceFile(event.currentTarget.files?.[0]);
                }}
              />
            </label>

            {generationReferenceFile && (
              <div className="generation-reference-row">
                <ImagePlus size={18} />
                <span>{generationReferenceFile.name}</span>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => setGenerationReferenceFile(undefined)}
                  disabled={creatorBusy}
                  title={t("creator.removeReference")}
                >
                  <X size={16} />
                  <span className="sr-only">{t("creator.removeReference")}</span>
                </button>
              </div>
            )}

            <button
              className="primary-button full-width"
              type="button"
              onClick={() => void generateFighterDraft()}
              disabled={creatorBusy}
            >
              <Sparkles size={18} />
              {activeOperation?.type === "generate" ? t("creator.generating") : t("creator.generateStrip")}
            </button>
          </aside>
        </div>
      )}

      {settingsOpen && (
        <div className="creator-drawer-shell">
          <button
            className="creator-drawer-backdrop"
            type="button"
            onClick={() => setSettingsOpen(false)}
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
                onClick={() => setSettingsOpen(false)}
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
                    className={provider.id === providerId ? "segment-option active" : "segment-option"}
                    key={provider.id}
                    type="button"
                    onClick={() => selectProvider(provider.id)}
                    disabled={creatorBusy}
                    title={getSegmentationProviderDescription(t, provider)}
                  >
                    {getSegmentationProviderLabel(t, provider)}
                  </button>
                ))}
              </div>
              <p className="helper-text">{getSegmentationProviderDescription(t, selectedProvider)}</p>
            </div>

            {providerId === "mediapipe-selfie" && (
              <div className="provider-control" aria-label={t("creator.mediaPipeMaskControls")}>
                <span className="field-label-text">{t("creator.maskTuning")}</span>
                <label className="range-field">
                  <span>{t("creator.foregroundEdge")}</span>
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
                  <span>{t("creator.backgroundCutoff")}</span>
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
              <div className="provider-control" aria-label={t("creator.transformersModel")}>
                <span className="field-label-text">{t("creator.model")}</span>
                <div className="segmented-control">
                  {TRANSFORMERS_MODELS.map((model) => (
                    <button
                      className={
                        segmentationOptions["transformers-background-removal"].modelId === model.id
                          ? "segment-option active"
                          : "segment-option"
                      }
                      key={model.id}
                      type="button"
                      onClick={() => selectTransformersModel(model.id)}
                      disabled={creatorBusy}
                      title={getTransformersModelDescription(t, model.id)}
                    >
                      {model.label}
                    </button>
                  ))}
                </div>
                <p className="helper-text">
                  {getTransformersModelDescription(t, segmentationOptions["transformers-background-removal"].modelId)}
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

function getPoseStatus(t: Translate, draft: PoseDraft | undefined) {
  if (draft?.processed) {
    return t("creator.poseStatusProcessed");
  }
  if (draft?.frame) {
    return t("creator.poseStatusSourceReady");
  }
  return t("creator.poseStatusNeedsImage");
}

function getCaptureButtonLabel(
  t: Translate,
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
    return t("common.wait");
  }
  return cameraReady ? t("creator.capture") : t("creator.start");
}

function getSegmentationProviderLabel(t: Translate, provider: SegmentationProvider) {
  switch (provider.id) {
    case "mediapipe-selfie":
      return t("segmentation.mediapipe.label");
    case "transformers-background-removal":
      return t("segmentation.transformers.label");
    default:
      return provider.label;
  }
}

function getSegmentationProviderDescription(t: Translate, provider: SegmentationProvider) {
  switch (provider.id) {
    case "mediapipe-selfie":
      return t("segmentation.mediapipe.description");
    case "transformers-background-removal":
      return t("segmentation.transformers.description");
    default:
      return provider.description;
  }
}

function getTransformersModelDescription(t: Translate, modelId: TransformersModelId) {
  switch (modelId) {
    case "onnx-community/ormbg-ONNX":
      return t("segmentation.model.ormbg.description");
    case "briaai/RMBG-1.4":
      return t("segmentation.model.rmbg.description");
    case "Xenova/modnet":
      return t("segmentation.model.modnet.description");
  }
}

function getGenerationModelLabel(t: Translate, model: GenerationModelOption) {
  switch (model) {
    case "":
      return t("creator.serverDefaultModel");
    case "custom":
      return t("creator.customModel");
    default:
      return model;
  }
}

function getSelectedGenerationModel(model: GenerationModelOption, customModel: string) {
  if (model === "custom") {
    return customModel.trim() || undefined;
  }
  return model || undefined;
}

function createGeneratedFighterName(prompt: string, fallbackName: string) {
  const words = prompt
    .trim()
    .replace(/[^a-z0-9\s-]/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  return words.length ? words.join(" ").slice(0, 32) : fallbackName;
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
