import { useEffect, useRef } from "react";
import type { BattleConfig, LoadedFighter } from "../types/game";
import { createBattleGame, type BattleGameHandle } from "../phaser/bridge/createBattleGame";

export function BattleView(props: { config: BattleConfig; fighters: { p1: LoadedFighter; p2: LoadedFighter }; onExit: () => void }) {
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
