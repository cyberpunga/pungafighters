import { useEffect, useRef } from "react";
import type { BattleConfig, BattlePostEffect, LoadedFighter, PlayerSlot, RuntimeBattleBackground } from "../types/game";
import type { NetworkInputController } from "../game/network/networkInputController";
import { createBattleGame, type BattleGameHandle } from "../phaser/bridge/createBattleGame";
import { BattleDisplayEffectsControl } from "./BattleDisplayEffectsControl";

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
    });
    return () => {
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, [props.background, props.config, props.fighters, props.localSlot, props.mode, props.networkController, props.onExit]);

  useEffect(() => {
    gameRef.current?.setDisplayEffects(props.displayEffects);
  }, [props.displayEffects]);

  return (
    <section className="battle-mount" aria-label="Battle arena">
      <div className="battle-canvas-host" ref={mountRef} />
      <aside className="battle-fx-panel" aria-label="Battle display effects">
        <strong>FX</strong>
        <BattleDisplayEffectsControl compact effects={props.displayEffects} onChange={props.onDisplayEffectsChange} />
      </aside>
    </section>
  );
}
