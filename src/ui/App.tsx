import { Camera, Gamepad2, Settings, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BattleConfig, FighterPose, LoadedFighter, VoiceClipType } from "../types/game";
import { FIGHTER_POSES, VOICE_CLIPS } from "../types/game";
import { canvasToPngBlob, normalizeCanvas, videoToSourceCanvas } from "../creator/imageProcessing";
import {
  DEFAULT_SEGMENTATION_PROVIDER_ID,
  getSegmentationProvider,
  isSegmentationProviderId,
  SEGMENTATION_PROVIDERS,
} from "../creator/segmentation/providerRegistry";
import type { SegmentationProvider, SegmentationProviderId, SegmentationProviderState } from "../creator/segmentation/types";
import { startVoiceRecording, type RecorderSession } from "../creator/audio";
import { deleteFighter, getSetting, listLoadedFighters, saveFighterDraft, setSetting } from "../storage/db";
import { DEFAULT_FIGHTER_IDS } from "../game/content/defaultFighters";
import { createBattleGame, type BattleGameHandle } from "../phaser/bridge/createBattleGame";

type View = "menu" | "creator" | "select" | "settings" | "battle";

const DEFAULT_BATTLE_CONFIG: Omit<BattleConfig, "playerOneFighterId" | "playerTwoFighterId"> = {
  roundCount: 3,
  timerSeconds: 60,
  stageId: "dojo-v1",
};

const SEGMENTATION_PROVIDER_SETTING_KEY = "segmentation.providerId";
const CAPTURE_DELAYS = [0, 5, 10, 15] as const;
type CaptureDelay = (typeof CAPTURE_DELAYS)[number];

export function App() {
  const [view, setView] = useState<View>("menu");
  const [fighters, setFighters] = useState<LoadedFighter[]>([]);
  const [selected, setSelected] = useState<{ p1: string; p2: string }>({
    p1: DEFAULT_FIGHTER_IDS[0],
    p2: DEFAULT_FIGHTER_IDS[1],
  });
  const [loading, setLoading] = useState(true);

  const refreshFighters = useCallback(async () => {
    setLoading(true);
    const loaded = await listLoadedFighters();
    setFighters(loaded);
    setLoading(false);
    setSelected((current) => ({
      p1: loaded.some((fighter) => fighter.id === current.p1) ? current.p1 : loaded[0]?.id ?? DEFAULT_FIGHTER_IDS[0],
      p2: loaded.some((fighter) => fighter.id === current.p2) ? current.p2 : loaded[1]?.id ?? loaded[0]?.id ?? DEFAULT_FIGHTER_IDS[1],
    }));
  }, []);

  useEffect(() => {
    void refreshFighters();
  }, [refreshFighters]);

  const battleFighters = useMemo(() => {
    const p1 = fighters.find((fighter) => fighter.id === selected.p1);
    const p2 = fighters.find((fighter) => fighter.id === selected.p2);
    return p1 && p2 ? { p1, p2 } : undefined;
  }, [fighters, selected]);

  return (
    <main className="app-shell">
      {view !== "battle" && (
        <header className="topbar">
          <button className="brand-button" type="button" onClick={() => setView("menu")}>
            <span className="brand-mark">PF</span>
            <span>Punga Fighters</span>
          </button>
          <nav className="nav-cluster" aria-label="Primary">
            <button className={view === "creator" ? "icon-button active" : "icon-button"} type="button" onClick={() => setView("creator")} title="Create fighter">
              <Camera size={19} />
            </button>
            <button className={view === "select" ? "icon-button active" : "icon-button"} type="button" onClick={() => setView("select")} title="Select fighters">
              <Gamepad2 size={19} />
            </button>
            <button className={view === "settings" ? "icon-button active" : "icon-button"} type="button" onClick={() => setView("settings")} title="Settings">
              <Settings size={19} />
            </button>
          </nav>
        </header>
      )}

      {view === "menu" && <MenuView fighters={fighters} loading={loading} onCreate={() => setView("creator")} onSelect={() => setView("select")} />}
      {view === "creator" && <CreatorView onSaved={refreshFighters} />}
      {view === "select" && (
        <FighterSelectView
          fighters={fighters}
          selected={selected}
          onSelected={setSelected}
          onDelete={async (id) => {
            await deleteFighter(id);
            await refreshFighters();
          }}
          onFight={() => battleFighters && setView("battle")}
        />
      )}
      {view === "settings" && <SettingsView />}
      {view === "battle" && battleFighters && (
        <BattleView
          config={{ ...DEFAULT_BATTLE_CONFIG, playerOneFighterId: selected.p1, playerTwoFighterId: selected.p2 }}
          fighters={battleFighters}
          onExit={() => setView("select")}
        />
      )}
    </main>
  );
}

function MenuView(props: { fighters: LoadedFighter[]; loading: boolean; onCreate: () => void; onSelect: () => void }) {
  const savedCount = props.fighters.filter((fighter) => !fighter.isDefault).length;
  return (
    <section className="menu-stage">
      <div className="hero-copy">
        <p className="eyebrow">Local webcam fighter</p>
        <h1>Punga Fighters</h1>
        <p>
          Build cutout fighters from your camera, save them locally, and settle the argument on one keyboard.
        </p>
        <div className="action-row">
          <button className="primary-button" type="button" onClick={props.onCreate}>
            <Camera size={19} />
            Create
          </button>
          <button className="secondary-button" type="button" onClick={props.onSelect}>
            <Gamepad2 size={19} />
            Fight
          </button>
        </div>
      </div>
      <div className="fighter-marquee" aria-label="Fighter gallery">
        {props.fighters.slice(0, 4).map((fighter) => (
          <div className="fighter-card marquee-card" key={fighter.id}>
            <img src={fighter.frameUrls.idle} alt="" />
            <strong>{fighter.name}</strong>
          </div>
        ))}
      </div>
      <footer className="status-strip">
        <span>{props.loading ? "Loading fighters" : `${savedCount} saved custom fighters`}</span>
        <span>Local-only IndexedDB saves</span>
        <span>Best of 3 rounds</span>
      </footer>
    </section>
  );
}

function CreatorView(props: { onSaved: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
  const [providerStatus, setProviderStatus] = useState<SegmentationProviderState>("idle");
  const [providerError, setProviderError] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureDelay, setCaptureDelay] = useState<CaptureDelay>(5);
  const [countdown, setCountdown] = useState(0);
  const [saving, setSaving] = useState(false);
  const selectedProvider = useMemo(() => getSegmentationProvider(providerId), [providerId]);
  const captureBusy = isCapturing || countdown > 0;

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
    void getSetting<unknown>(SEGMENTATION_PROVIDER_SETTING_KEY, DEFAULT_SEGMENTATION_PROVIDER_ID).then((savedProviderId) => {
      if (!cancelled && isSegmentationProviderId(savedProviderId)) {
        setProviderId(savedProviderId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadProvider = useCallback(async (provider: SegmentationProvider) => {
    const loadId = providerLoadIdRef.current + 1;
    providerLoadIdRef.current = loadId;
    setProviderStatus("loading");
    setProviderError("");
    try {
      await provider.load();
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
      void loadProvider(nextProvider);
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
      await loadProvider(selectedProvider);
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
      const cutout = await selectedProvider.segment(source);
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
      frameBlobs: Object.fromEntries(FIGHTER_POSES.map((pose) => [pose, frames[pose]!.blob])),
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

  return (
    <section className="creator-grid">
      <div className="creator-camera">
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="camera-actions">
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

function FighterSelectView(props: {
  fighters: LoadedFighter[];
  selected: { p1: string; p2: string };
  onSelected: (next: { p1: string; p2: string }) => void;
  onDelete: (id: string) => Promise<void>;
  onFight: () => void;
}) {
  return (
    <section className="select-view">
      <div className="duel-header">
        <div>
          <p className="eyebrow">Choose your corners</p>
          <h2>Fighter Select</h2>
        </div>
        <button className="primary-button" type="button" onClick={props.onFight}>
          <Gamepad2 size={18} />
          Start Battle
        </button>
      </div>
      <div className="select-columns">
        <FighterColumn slot="p1" fighters={props.fighters} selectedId={props.selected.p1} onSelect={(id) => props.onSelected({ ...props.selected, p1: id })} onDelete={props.onDelete} />
        <FighterColumn slot="p2" fighters={props.fighters} selectedId={props.selected.p2} onSelect={(id) => props.onSelected({ ...props.selected, p2: id })} onDelete={props.onDelete} />
      </div>
    </section>
  );
}

function FighterColumn(props: {
  slot: "p1" | "p2";
  fighters: LoadedFighter[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <div className="fighter-column">
      <h3>{props.slot === "p1" ? "Player 1" : "Player 2"}</h3>
      <div className="fighter-list">
        {props.fighters.map((fighter) => (
          <article className={props.selectedId === fighter.id ? "fighter-card selected" : "fighter-card"} key={`${props.slot}-${fighter.id}`}>
            <button type="button" className="fighter-pick" onClick={() => props.onSelect(fighter.id)}>
              <img src={fighter.frameUrls.idle} alt="" />
              <span>{fighter.name}</span>
            </button>
            {!fighter.isDefault && (
              <button className="icon-button danger" type="button" onClick={() => void props.onDelete(fighter.id)} title="Delete fighter">
                <Trash2 size={17} />
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function SettingsView() {
  return (
    <section className="settings-view">
      <p className="eyebrow">Prototype settings</p>
      <h2>Local Defaults</h2>
      <div className="settings-grid">
        <div>
          <strong>Rounds</strong>
          <span>Best of 3</span>
        </div>
        <div>
          <strong>Timer</strong>
          <span>60 seconds</span>
        </div>
        <div>
          <strong>Saves</strong>
          <span>IndexedDB only</span>
        </div>
        <div>
          <strong>Segmentation</strong>
          <span>MediaPipe, in-browser</span>
        </div>
      </div>
    </section>
  );
}

function BattleView(props: { config: BattleConfig; fighters: { p1: LoadedFighter; p2: LoadedFighter }; onExit: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<BattleGameHandle | null>(null);

  useEffect(() => {
    if (!mountRef.current) {
      return;
    }
    gameRef.current = createBattleGame({
      parent: mountRef.current,
      config: props.config,
      fighters: props.fighters,
      onExit: props.onExit,
    });
    return () => {
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, [props]);

  return <section className="battle-mount" ref={mountRef} aria-label="Battle arena" />;
}
