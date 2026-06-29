import type { MutableRefObject } from "react";
import type { NetworkInputController } from "../../game/network/networkInputController";
import { NETPLAY_CHECKSUM_INTERVAL } from "../../game/network/protocol";
import { getBattleChecksum, type BattleState } from "../../game/simulation/battle";

export function processStageNetworkEvents(input: {
  checksumHistory: Map<number, string>;
  copy: {
    connectionClosed: string;
    opponentLeft: string;
    syncError: string;
  };
  haltedMessageRef: MutableRefObject<string | undefined>;
  networkController?: NetworkInputController;
  onHalt: (message: string | undefined) => void;
  onRemoteRestart: () => void;
  pendingRemoteChecksums: Map<number, string>;
}) {
  if (!input.networkController) {
    return;
  }
  input.networkController.pollEvents().forEach((event) => {
    if (event.type === "checksum") {
      compareRemoteChecksum({
        checksum: event.checksum,
        checksumHistory: input.checksumHistory,
        frame: event.frame,
        haltedMessageRef: input.haltedMessageRef,
        networkController: input.networkController,
        onHalt: input.onHalt,
        pendingRemoteChecksums: input.pendingRemoteChecksums,
        syncError: input.copy.syncError,
      });
    } else if (event.type === "restart") {
      input.onRemoteRestart();
    } else if (event.type === "exit") {
      setStageHalt(input.haltedMessageRef, input.onHalt, event.reason || input.copy.opponentLeft);
    } else if (event.type === "error") {
      setStageHalt(input.haltedMessageRef, input.onHalt, event.message);
    } else if (event.type === "closed") {
      setStageHalt(input.haltedMessageRef, input.onHalt, input.copy.connectionClosed);
    }
  });
}

export function afterStageSimulationFrame(input: {
  checksumHistory: Map<number, string>;
  mode: "local" | "online";
  networkController?: NetworkInputController;
  onHalt: (message: string | undefined) => void;
  haltedMessageRef: MutableRefObject<string | undefined>;
  pendingRemoteChecksums: Map<number, string>;
  state: BattleState;
  syncError: string;
}) {
  if (input.mode !== "online" || !input.networkController || input.state.frame % NETPLAY_CHECKSUM_INTERVAL !== 0) {
    return;
  }
  const checksum = getBattleChecksum(input.state);
  input.checksumHistory.set(input.state.frame, checksum);
  input.networkController.sendChecksum(input.state.frame, checksum);
  const pending = input.pendingRemoteChecksums.get(input.state.frame);
  if (pending) {
    input.pendingRemoteChecksums.delete(input.state.frame);
    compareRemoteChecksum({
      checksum: pending,
      checksumHistory: input.checksumHistory,
      frame: input.state.frame,
      haltedMessageRef: input.haltedMessageRef,
      networkController: input.networkController,
      onHalt: input.onHalt,
      pendingRemoteChecksums: input.pendingRemoteChecksums,
      syncError: input.syncError,
    });
  }
}

function compareRemoteChecksum(input: {
  checksum: string;
  checksumHistory: Map<number, string>;
  frame: number;
  haltedMessageRef: MutableRefObject<string | undefined>;
  networkController?: NetworkInputController;
  onHalt: (message: string | undefined) => void;
  pendingRemoteChecksums: Map<number, string>;
  syncError: string;
}) {
  const localChecksum = input.checksumHistory.get(input.frame);
  if (!localChecksum) {
    input.pendingRemoteChecksums.set(input.frame, input.checksum);
    return;
  }
  if (localChecksum !== input.checksum) {
    const message = input.syncError;
    setStageHalt(input.haltedMessageRef, input.onHalt, message);
    input.networkController?.sendError(message);
  }
}

function setStageHalt(
  haltedMessageRef: MutableRefObject<string | undefined>,
  onHalt: (message: string | undefined) => void,
  message: string,
) {
  haltedMessageRef.current = message;
  onHalt(message);
}
