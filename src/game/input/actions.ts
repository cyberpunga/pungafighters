import type { ActionSnapshot, InputAction, PlayerSlot } from "../../types/game";

export const ACTIONS: InputAction[] = [
  "left",
  "right",
  "jump",
  "block",
  "punch",
  "kick",
  "pause",
];

export const EMPTY_ACTIONS: ActionSnapshot = {
  left: false,
  right: false,
  jump: false,
  block: false,
  punch: false,
  kick: false,
  pause: false,
};

export const KEYBOARD_BINDINGS: Record<PlayerSlot, Record<string, InputAction>> = {
  p1: {
    KeyA: "left",
    KeyD: "right",
    KeyW: "jump",
    KeyS: "block",
    KeyJ: "punch",
    KeyK: "kick",
    Escape: "pause",
  },
  p2: {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "jump",
    ArrowDown: "block",
    Digit1: "punch",
    Digit2: "kick",
    Escape: "pause",
  },
};

export function createEmptyActions(): ActionSnapshot {
  return { ...EMPTY_ACTIONS };
}
