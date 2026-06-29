import { Mic, Pause, Play, Trash2, Volume2 } from "lucide-react";
import { voiceClipLabel } from "../../i18n";
import { useI18n } from "../../i18n/react";
import type { VoiceClipType } from "../../types/game";
import { VOICE_CLIPS } from "../../types/game";
import type { VoiceDrafts } from "./draftAssets";

export function VoiceClipGrid(props: {
  operationBusy: boolean;
  playingClip?: VoiceClipType;
  recording?: VoiceClipType;
  voiceDrafts: VoiceDrafts;
  onDeleteVoiceClip: (clip: VoiceClipType) => void;
  onToggleRecording: (clip: VoiceClipType) => Promise<void>;
  onToggleVoicePlayback: (clip: VoiceClipType) => Promise<void>;
}) {
  const { t } = useI18n();

  return (
    <section className="sound-section" aria-label={t("common.sounds")}>
      <div className="sound-section-header">
        <Volume2 size={18} />
        <span className="field-label-text">{t("common.sounds")}</span>
      </div>
      <div className="sound-grid">
        {VOICE_CLIPS.map((clip) => {
          const draft = props.voiceDrafts[clip];
          const isRecording = props.recording === clip;
          const isPlaying = props.playingClip === clip;
          const clipText = voiceClipLabel(t, clip);
          return (
            <div className="sound-card" key={clip}>
              <div className="sound-card-title">
                <strong>{clipText}</strong>
                <span>{isRecording ? t("common.recording") : draft ? t("common.recorded") : t("common.empty")}</span>
              </div>
              <div className="sound-actions">
                <button
                  className={isRecording ? "icon-button danger" : "icon-button"}
                  type="button"
                  onClick={() => void props.onToggleRecording(clip)}
                  title={
                    isRecording
                      ? t("creator.stopRecordingClip", { clip: clipText })
                      : t("creator.recordClip", { clip: clipText })
                  }
                  disabled={props.operationBusy || Boolean(props.recording && props.recording !== clip)}
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
                  onClick={() => void props.onToggleVoicePlayback(clip)}
                  title={isPlaying ? t("creator.pauseClip", { clip: clipText }) : t("creator.playClip", { clip: clipText })}
                  disabled={props.operationBusy || Boolean(props.recording) || !draft}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                  <span className="sr-only">
                    {isPlaying ? t("creator.pauseClip", { clip: clipText }) : t("creator.playClip", { clip: clipText })}
                  </span>
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  onClick={() => props.onDeleteVoiceClip(clip)}
                  title={t("creator.removeClip", { clip: clipText })}
                  disabled={props.operationBusy || Boolean(props.recording) || !draft}
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
  );
}
