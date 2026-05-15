import { CircleOff, ScanLine, TvMinimal, Zap } from "lucide-react";
import type { BattleDisplayEffect } from "../types/game";

const DISPLAY_EFFECT_OPTIONS = [
  { value: "clean", label: "Clean", Icon: CircleOff },
  { value: "crt-soft", label: "CRT Soft", Icon: TvMinimal },
  { value: "crt-strong", label: "CRT Max", Icon: ScanLine },
  { value: "bad-tv", label: "Bad TV", Icon: Zap },
] as const satisfies ReadonlyArray<{
  value: BattleDisplayEffect;
  label: string;
  Icon: typeof CircleOff;
}>;

export function SettingsView(props: {
  battleDisplayEffect: BattleDisplayEffect;
  onBattleDisplayEffectChange: (effect: BattleDisplayEffect) => void;
}) {
  return (
    <section className="settings-view">
      <p className="eyebrow">Prototype settings</p>
      <h2>Local Defaults</h2>
      <div className="settings-grid">
        <div className="settings-control-card">
          <strong>Battle Display</strong>
          <div className="segmented-control settings-effect-control" role="group" aria-label="Battle display effect">
            {DISPLAY_EFFECT_OPTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                className={props.battleDisplayEffect === value ? "segment-option active" : "segment-option"}
                type="button"
                aria-pressed={props.battleDisplayEffect === value}
                onClick={() => props.onBattleDisplayEffectChange(value)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
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
