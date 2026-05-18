import { useEffect, useRef } from "react";
import type { BattleConfig, BattlePostEffect, LoadedFighter, PlayerSlot, RuntimeBattleBackground } from "../types/game";
import type { NetworkInputController } from "../game/network/networkInputController";
import { createBattleGame, type BattleGameHandle } from "../phaser/bridge/createBattleGame";
import type { BattleSceneCopy } from "../phaser/scenes/BattleScene";
import { BattleDisplayEffectsControl } from "./BattleDisplayEffectsControl";
import type { Translate } from "../i18n";
import { useI18n } from "../i18n/react";

export function BattleView(props: {
  config: BattleConfig;
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  background?: RuntimeBattleBackground;
  onExit: () => void;
  mode?: "local" | "online";
  localSlot?: PlayerSlot;
  networkController?: NetworkInputController;
  displayEffects: BattlePostEffect[];
  onDisplayEffectsChange: (effects: BattlePostEffect[]) => void;
}) {
  const { t } = useI18n();
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
      background: props.background,
      onExit: props.onExit,
      mode: props.mode,
      localSlot: props.localSlot,
      networkController: props.networkController,
      displayEffects: props.displayEffects,
      copy: createBattleSceneCopy(t),
    });
    return () => {
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, [props.background, props.config, props.fighters, props.localSlot, props.mode, props.networkController, props.onExit, t]);

  useEffect(() => {
    gameRef.current?.setDisplayEffects(props.displayEffects);
  }, [props.displayEffects]);

  return (
    <section className="battle-mount" aria-label={t("battle.ariaArena")}>
      <div className="battle-canvas-host" ref={mountRef} />
      <aside className="battle-fx-panel" aria-label={t("effects.battleDisplayEffects")}>
        <strong>{t("battle.fx")}</strong>
        <BattleDisplayEffectsControl compact effects={props.displayEffects} onChange={props.onDisplayEffectsChange} />
      </aside>
    </section>
  );
}

function createBattleSceneCopy(t: Translate): BattleSceneCopy {
  return {
    ready: t("battle.ready"),
    fight: t("battle.fight"),
    wins: (name) => t("battle.wins", { name }),
    takesRound: (name) => t("battle.takesRound", { name }),
    roundsWon: (count) => t("battle.roundsWon", { count }),
    max: t("battle.max"),
    restartHint: t("battle.restartHint"),
    syncingFrame: (frame) => t("battle.syncingFrame", { frame }),
    syncError: t("battle.syncError"),
    opponentMenu: t("battle.opponentMenu"),
    opponentLeft: t("battle.opponentLeft"),
    connectionClosed: t("battle.connectionClosed"),
    super: t("battle.super"),
  };
}
