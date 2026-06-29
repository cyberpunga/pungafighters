import { createEmptyActions, KEYBOARD_BINDINGS } from "../../game/input/actions";
import { createCpuActions } from "../../game/input/cpu";
import type { NetworkInputController } from "../../game/network/networkInputController";
import type { BattleMessage, BattleState } from "../../game/simulation/battle";
import type { Translate } from "../../i18n";
import type { ActionSnapshot, BattleConfig, LoadedFighter, PlayerInputSnapshot, PlayerSlot } from "../../types/game";
import { PLAYER_SLOTS } from "./constants";

export function selectStageFighters(fighters: LoadedFighter[], selected: { p1: string; p2: string }) {
  const p1 = fighters.find((fighter) => fighter.id === selected.p1) ?? fighters[0];
  const p2 = fighters.find((fighter) => fighter.id === selected.p2 && fighter.id !== p1?.id) ?? fighters.find((fighter) => fighter.id !== p1?.id) ?? p1;
  return p1 && p2 ? { p1, p2 } : undefined;
}

export function readStageInputs(input: {
  localSlot: PlayerSlot;
  mode: "local" | "online";
  networkController?: NetworkInputController;
  onlineCopy: {
    syncingFrame: (frame: number) => string;
  };
  onOnlineStatus: (message: string | undefined) => void;
  pressedCodes: Set<string>;
  state: BattleState;
}): PlayerInputSnapshot | undefined {
  if (input.mode === "online" && input.networkController) {
    const localInput = readOnlineSlotActions(input.pressedCodes, input.localSlot);
    input.networkController.queueLocalInput(input.state.frame, localInput);
    const inputs = input.networkController.getInputsForFrame(input.state.frame);
    if (!inputs) {
      const missingFrame = input.networkController.getMissingFrame(input.state.frame) ?? input.state.frame;
      input.onOnlineStatus(input.onlineCopy.syncingFrame(missingFrame));
      return undefined;
    }
    input.onOnlineStatus(undefined);
    return inputs;
  }

  const state = input.state;
  const controls = state.config.playerControls;
  return {
    p1: controls?.p1 === "cpu" ? createCpuActions(state, "p1") : readSlotActions(input.pressedCodes, "p1"),
    p2: controls?.p2 === "cpu" ? createCpuActions(state, "p2") : readSlotActions(input.pressedCodes, "p2"),
  };
}

export function readSlotActions(pressedCodes: Set<string>, slot: PlayerSlot): ActionSnapshot {
  const actions = createEmptyActions();
  Object.entries(KEYBOARD_BINDINGS[slot]).forEach(([code, action]) => {
    actions[action] ||= pressedCodes.has(code);
  });
  return actions;
}

export function readOnlineSlotActions(pressedCodes: Set<string>, slot: PlayerSlot): ActionSnapshot {
  const actions = readSlotActions(pressedCodes, slot);
  if (slot === "p2") {
    Object.entries(KEYBOARD_BINDINGS.p1).forEach(([code, action]) => {
      actions[action] ||= pressedCodes.has(code);
    });
  }
  return actions;
}

export function isStageControlCode(code: string) {
  return PLAYER_SLOTS.some((slot) => code in KEYBOARD_BINDINGS[slot]);
}

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function formatBattleMessage(state: BattleState, t: Translate, override?: string) {
  if (override) {
    return override;
  }
  const message = state.message;
  if (!message) {
    return state.status === "running" ? t("battle.fight") : "";
  }
  return getBattleMessageText(message, state, t);
}

export function formatStageControls(config: BattleConfig, t: Translate) {
  const controls = config.playerControls;
  if (controls?.p1 === "cpu" && controls.p2 === "cpu") {
    return t("battleStage.controlsCpu");
  }
  if (controls?.p1 === "cpu" && controls.p2 !== "cpu") {
    return t("battleStage.controlsP2");
  }
  if (controls?.p2 === "cpu") {
    return t("battleStage.controlsP1");
  }
  return t("battleStage.controlsP1P2");
}

function getBattleMessageText(message: BattleMessage, state: BattleState, t: Translate) {
  switch (message.type) {
    case "ready":
      return t("battle.ready");
    case "fight":
      return t("battle.fight");
    case "match-winner":
      return t("battle.wins", { name: state.fighters[message.winner].name });
    case "round-winner":
      return t("battle.takesRound", { name: state.fighters[message.winner].name });
  }
}
