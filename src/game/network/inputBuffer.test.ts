import { describe, expect, it } from "vitest";
import { createEmptyActions } from "../input/actions";
import { NetplayInputBuffer } from "./inputBuffer";

describe("NetplayInputBuffer", () => {
  it("seeds the input-delay window with empty inputs", () => {
    const buffer = new NetplayInputBuffer({ localSlot: "p1" });

    expect(buffer.getInputsForFrame(0)).toEqual({
      p1: createEmptyActions(),
      p2: createEmptyActions(),
    });
  });

  it("schedules local inputs into a delayed frame and accepts remote frames", () => {
    const buffer = new NetplayInputBuffer({ localSlot: "p1" });
    const local = { ...createEmptyActions(), right: true };
    const remote = { ...createEmptyActions(), left: true };

    const message = buffer.queueLocalInput(0, local);
    buffer.queueRemoteInput({ type: "input", frames: [{ frame: 4, slot: "p2", actions: remote }] });

    expect(message.frames[0]).toEqual({ frame: 4, slot: "p1", actions: local });
    expect(buffer.getInputsForFrame(4)).toEqual({ p1: local, p2: remote });
  });

  it("repeats recent local frames so packet loss can recover", () => {
    const buffer = new NetplayInputBuffer({ localSlot: "p2" });
    let message = buffer.queueLocalInput(0, createEmptyActions());
    message = buffer.queueLocalInput(1, { ...createEmptyActions(), punch: true });
    message = buffer.queueLocalInput(2, { ...createEmptyActions(), kick: true });

    expect(message.frames.map((frame) => frame.frame).slice(0, 3)).toEqual([6, 5, 4]);
    expect(message.frames.length).toBeLessThanOrEqual(8);
    expect(message.frames.every((frame) => frame.slot === "p2")).toBe(true);
  });
});
