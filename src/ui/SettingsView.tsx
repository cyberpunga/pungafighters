import type { BattlePostEffect } from "../types/game";
import { BattleDisplayEffectsControl } from "./BattleDisplayEffectsControl";

export function SettingsView(props: {
  battlePostEffects: BattlePostEffect[];
  onBattlePostEffectsChange: (effects: BattlePostEffect[]) => void;
}) {
  return (
    <section className="settings-view">
      <p className="eyebrow">Prototype settings</p>
      <h2>Local Defaults</h2>
      <div className="settings-grid">
        <div className="settings-control-card">
          <strong>Battle Display</strong>
          <BattleDisplayEffectsControl effects={props.battlePostEffects} onChange={props.onBattlePostEffectsChange} />
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
