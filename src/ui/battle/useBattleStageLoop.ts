import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { NetworkInputController } from "../../game/network/networkInputController";
import { BATTLE_TICK_SECONDS, stepBattleFrame, type BattleState } from "../../game/simulation/battle";
import type { PlayerSlot, PlayerInputSnapshot } from "../../types/game";
import { createHitSplash, type HitSplashBurst } from "./hitSplash";
import { readStageInputs } from "./stageInput";
import { afterStageSimulationFrame, processStageNetworkEvents } from "./stageNetwork";

type BattleStageLoopCopy = {
  connectionClosed: string;
  opponentLeft: string;
  syncError: string;
  syncingFrame: (frame: number) => string;
};

type BattleStageLoopInput = {
  battleState: BattleState;
  checksumHistoryRef: MutableRefObject<Map<number, string>>;
  haltedMessage?: string;
  localSlot: PlayerSlot;
  mode: "local" | "online";
  networkController?: NetworkInputController;
  onlineCopy: BattleStageLoopCopy;
  onlineStatus?: string;
  pendingRemoteChecksumsRef: MutableRefObject<Map<number, string>>;
  pressedCodesRef: MutableRefObject<Set<string>>;
  setBattleState: (state: BattleState) => void;
  setHaltedMessage: (message: string | undefined) => void;
  setOnlineStatus: (message: string | undefined) => void;
  onRemoteRestart: () => void;
};

export function useBattleStageLoop(input: BattleStageLoopInput) {
  const accumulatorRef = useRef(0);
  const battleStateRef = useRef(input.battleState);
  const onlineStatusRef = useRef<string | undefined>(input.onlineStatus);
  const haltedMessageRef = useRef<string | undefined>(input.haltedMessage);
  const lastSplashHitAtRef = useRef(-1);
  const splashCleanupTimeoutsRef = useRef<number[]>([]);
  const [hitSplashes, setHitSplashes] = useState<HitSplashBurst[]>([]);

  useEffect(() => {
    battleStateRef.current = input.battleState;
    if (input.battleState.frame === 0) {
      accumulatorRef.current = 0;
      lastSplashHitAtRef.current = -1;
      setHitSplashes([]);
    }
  }, [input.battleState]);

  useEffect(() => {
    onlineStatusRef.current = input.onlineStatus;
  }, [input.onlineStatus]);

  useEffect(() => {
    haltedMessageRef.current = input.haltedMessage;
  }, [input.haltedMessage]);

  useEffect(
    () => () => {
      splashCleanupTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout));
      splashCleanupTimeoutsRef.current = [];
    },
    [],
  );

  useFrame((_, deltaSeconds) => {
    processStageNetworkEvents({
      checksumHistory: input.checksumHistoryRef.current,
      haltedMessageRef,
      networkController: input.networkController,
      onHalt: input.setHaltedMessage,
      onRemoteRestart: input.onRemoteRestart,
      copy: input.onlineCopy,
      pendingRemoteChecksums: input.pendingRemoteChecksumsRef.current,
    });

    if (haltedMessageRef.current) {
      return;
    }

    accumulatorRef.current += Math.min(deltaSeconds, 0.1);
    let next = battleStateRef.current;
    let steps = 0;
    while (accumulatorRef.current >= BATTLE_TICK_SECONDS && steps < 6) {
      const inputs = readInputsForFrame(input, next, onlineStatusRef);
      if (!inputs) {
        accumulatorRef.current = Math.min(accumulatorRef.current, BATTLE_TICK_SECONDS);
        break;
      }
      next = stepBattleFrame(next, inputs);
      afterStageSimulationFrame({
        checksumHistory: input.checksumHistoryRef.current,
        mode: input.mode,
        networkController: input.networkController,
        onHalt: input.setHaltedMessage,
        haltedMessageRef,
        syncError: input.onlineCopy.syncError,
        pendingRemoteChecksums: input.pendingRemoteChecksumsRef.current,
        state: next,
      });
      accumulatorRef.current -= BATTLE_TICK_SECONDS;
      steps += 1;
    }
    if (next !== battleStateRef.current) {
      battleStateRef.current = next;
      input.setBattleState(next);
    }

    queueHitSplash(next, lastSplashHitAtRef, splashCleanupTimeoutsRef, setHitSplashes);
  });

  return { hitSplashes };
}

function readInputsForFrame(
  input: BattleStageLoopInput,
  state: BattleState,
  onlineStatusRef: MutableRefObject<string | undefined>,
): PlayerInputSnapshot | undefined {
  return readStageInputs({
    localSlot: input.localSlot,
    mode: input.mode,
    networkController: input.networkController,
    onlineCopy: input.onlineCopy,
    onOnlineStatus: (message) => {
      if (message !== onlineStatusRef.current) {
        onlineStatusRef.current = message;
        input.setOnlineStatus(message);
      }
    },
    pressedCodes: input.pressedCodesRef.current,
    state,
  });
}

function queueHitSplash(
  state: BattleState,
  lastSplashHitAtRef: MutableRefObject<number>,
  splashCleanupTimeoutsRef: MutableRefObject<number[]>,
  setHitSplashes: Dispatch<SetStateAction<HitSplashBurst[]>>,
) {
  const hit = state.lastHit;
  if (!hit || hit.at === lastSplashHitAtRef.current) {
    return;
  }
  lastSplashHitAtRef.current = hit.at;
  const splash = createHitSplash(state);
  if (!splash) {
    return;
  }
  setHitSplashes((current) => [...current, splash].slice(-5));
  const timeout = window.setTimeout(() => {
    setHitSplashes((current) => current.filter((currentSplash) => currentSplash.id !== splash.id));
  }, 1250);
  splashCleanupTimeoutsRef.current.push(timeout);
}
