import type { ActionSnapshot, PlayerInputSnapshot, PlayerSlot } from "../../types/game";
import { createEmptyActions } from "../input/actions";
import { NETPLAY_INPUT_DELAY, NETPLAY_REPEAT_FRAMES, oppositeSlot, type InputMessage } from "./protocol";

export class NetplayInputBuffer {
  readonly localSlot: PlayerSlot;
  readonly remoteSlot: PlayerSlot;
  private readonly inputDelay: number;
  private readonly repeatFrameCount: number;
  private readonly localFrames = new Map<number, ActionSnapshot>();
  private readonly remoteFrames = new Map<number, ActionSnapshot>();

  constructor(input: { localSlot: PlayerSlot; inputDelay?: number; repeatFrameCount?: number }) {
    this.localSlot = input.localSlot;
    this.remoteSlot = oppositeSlot(input.localSlot);
    this.inputDelay = input.inputDelay ?? NETPLAY_INPUT_DELAY;
    this.repeatFrameCount = input.repeatFrameCount ?? NETPLAY_REPEAT_FRAMES;
    this.reset();
  }

  reset() {
    this.localFrames.clear();
    this.remoteFrames.clear();
    for (let frame = 0; frame < this.inputDelay; frame += 1) {
      this.localFrames.set(frame, createEmptyActions());
      this.remoteFrames.set(frame, createEmptyActions());
    }
  }

  queueLocalInput(currentFrame: number, actions: ActionSnapshot): InputMessage {
    const targetFrame = currentFrame + this.inputDelay;
    this.localFrames.set(targetFrame, cloneActions(actions));
    this.pruneBefore(currentFrame - this.repeatFrameCount * 2);
    return {
      type: "input",
      frames: this.getRecentLocalFrames(targetFrame),
    };
  }

  queueRemoteInput(message: InputMessage) {
    message.frames.forEach((frame) => {
      if (frame.slot === this.remoteSlot) {
        this.remoteFrames.set(frame.frame, cloneActions(frame.actions));
      }
    });
  }

  getInputsForFrame(frame: number): PlayerInputSnapshot | undefined {
    const local = this.localFrames.get(frame);
    const remote = this.remoteFrames.get(frame);
    if (!local || !remote) {
      return undefined;
    }
    return this.localSlot === "p1"
      ? { p1: cloneActions(local), p2: cloneActions(remote) }
      : { p1: cloneActions(remote), p2: cloneActions(local) };
  }

  getMissingFrame(frame: number): number | undefined {
    if (!this.localFrames.has(frame) || !this.remoteFrames.has(frame)) {
      return frame;
    }
    return undefined;
  }

  private getRecentLocalFrames(targetFrame: number) {
    const frames = [];
    for (let frame = targetFrame; frame > targetFrame - this.repeatFrameCount; frame -= 1) {
      const actions = this.localFrames.get(frame);
      if (actions) {
        frames.push({ frame, slot: this.localSlot, actions: cloneActions(actions) });
      }
    }
    return frames;
  }

  private pruneBefore(frame: number) {
    this.localFrames.forEach((_, key) => {
      if (key < frame) {
        this.localFrames.delete(key);
      }
    });
    this.remoteFrames.forEach((_, key) => {
      if (key < frame) {
        this.remoteFrames.delete(key);
      }
    });
  }
}

function cloneActions(actions: ActionSnapshot): ActionSnapshot {
  return { ...actions };
}
