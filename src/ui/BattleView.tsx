import { useEffect, useRef } from "react";
import type { BattleConfig, LoadedFighter, PlayerSlot } from "../types/game";
import type { NetworkInputController } from "../game/network/networkInputController";
import { createBattleGame, type BattleGameHandle } from "../phaser/bridge/createBattleGame";

export function BattleView(props: {
  config: BattleConfig;
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  onExit: () => void;
  mode?: "local" | "online";
  localSlot?: PlayerSlot;
  networkController?: NetworkInputController;
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
      onExit: props.onExit,
      mode: props.mode,
      localSlot: props.localSlot,
      networkController: props.networkController,
    });
    return () => {
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, [props]);

  return <section className="battle-mount" ref={mountRef} aria-label="Battle arena" />;
}
