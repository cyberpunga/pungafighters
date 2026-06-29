import { SUPER_HITS_REQUIRED, type BattleState } from "../../game/simulation/battle";
import type { LoadedFighter, PlayerSlot } from "../../types/game";
import { useI18n } from "../../i18n/react";
import { formatBattleMessage } from "./stageInput";

export function BattleHudLayer(props: { fighters: { p1: LoadedFighter; p2: LoadedFighter }; state: BattleState; controlsHint: string; statusMessage?: string }) {
  const { t } = useI18n();
  const p1Runtime = props.state.fighters.p1;
  const p2Runtime = props.state.fighters.p2;
  const message = formatBattleMessage(props.state, t, props.statusMessage);
  const hint = props.state.status === "matchOver" ? t("battle.restartHint") : props.controlsHint;
  const seconds = Math.ceil(props.state.timer);

  return (
    <div className="battle-hud-layer" aria-hidden="true">
      <FighterHudPanel
        accent="p1"
        health={clampRatio(p1Runtime.health / 100)}
        name={props.fighters.p1.name}
        roundsWon={p1Runtime.roundsWon}
        slot="p1"
        superReady={p1Runtime.superMeter >= SUPER_HITS_REQUIRED}
        superRatio={SUPER_HITS_REQUIRED > 0 ? clampRatio(p1Runtime.superMeter / SUPER_HITS_REQUIRED) : 1}
        maxLabel={t("battle.max")}
      />
      <div className="battle-hud-center">
        <strong>{seconds}</strong>
        <span>{message}</span>
        <small>{hint}</small>
      </div>
      <FighterHudPanel
        accent="p2"
        health={clampRatio(p2Runtime.health / 100)}
        name={props.fighters.p2.name}
        roundsWon={p2Runtime.roundsWon}
        slot="p2"
        superReady={p2Runtime.superMeter >= SUPER_HITS_REQUIRED}
        superRatio={SUPER_HITS_REQUIRED > 0 ? clampRatio(p2Runtime.superMeter / SUPER_HITS_REQUIRED) : 1}
        maxLabel={t("battle.max")}
      />
    </div>
  );
}

function FighterHudPanel(props: {
  accent: "p1" | "p2";
  health: number;
  maxLabel: string;
  name: string;
  roundsWon: number;
  slot: PlayerSlot;
  superRatio: number;
  superReady: boolean;
}) {
  return (
    <div className={`battle-hud-fighter ${props.slot}`}>
      <div className="battle-hud-slot">
        <span>{props.slot.toUpperCase()}</span>
        <strong>{props.roundsWon}</strong>
      </div>
      <div className="battle-hud-bars">
        <strong className="battle-hud-name">{props.name}</strong>
        <ProgressBar accent={props.accent} ratio={props.health} />
        <div className="battle-hud-super-row">
          <ProgressBar accent="super" compact ratio={props.superRatio} />
          {props.superReady && <span>{props.maxLabel}</span>}
        </div>
      </div>
    </div>
  );
}

function ProgressBar(props: { accent: "p1" | "p2" | "super"; compact?: boolean; ratio: number }) {
  return (
    <div className={props.compact ? "battle-hud-progress compact" : "battle-hud-progress"}>
      <div className={`battle-hud-progress-fill ${props.accent}`} style={{ width: `${Math.round(clampRatio(props.ratio) * 100)}%` }} />
    </div>
  );
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}
