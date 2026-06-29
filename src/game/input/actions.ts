import type { ActionSnapshot, InputAction, PlayerSlot } from "../../types/game";

export const ACTIONS: InputAction[] = [
  "left",
  "right",
  "up",
  "down",
  "jump",
  "block",
  "punch",
  "kick",
  "pause",
];

export const EMPTY_ACTIONS: ActionSnapshot = {
  left: false,
  right: false,
  up: false,
  down: false,
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
    KeyW: "up",
    KeyS: "down",
    KeyI: "block",
    KeyJ: "punch",
    KeyK: "kick",
    KeyL: "jump",
    Escape: "pause",
  },
  p2: {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    Digit0: "block",
    Digit1: "punch",
    Digit2: "kick",
    Digit3: "jump",
    Escape: "pause",
  },
};

export function createEmptyActions(): ActionSnapshot {
  return { ...EMPTY_ACTIONS };
}
