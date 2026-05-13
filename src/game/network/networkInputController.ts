import type { ActionSnapshot, PlayerInputSnapshot, PlayerSlot } from "../../types/game";
import { NetplayInputBuffer } from "./inputBuffer";
import type { InputMessage, NetworkGameEvent, SetupMessage } from "./protocol";

export class DataChannelNetworkInputController {
  readonly localSlot: PlayerSlot;
  readonly remoteSlot: PlayerSlot;
  private readonly buffer: NetplayInputBuffer;
  private readonly setupChannel: RTCDataChannel;
  private readonly inputChannel: RTCDataChannel;
  private readonly events: NetworkGameEvent[] = [];
  private destroyed = false;

  constructor(input: {
    localSlot: PlayerSlot;
    setupChannel: RTCDataChannel;
    inputChannel: RTCDataChannel;
    onDestroy?: () => void;
  }) {
    this.localSlot = input.localSlot;
    this.buffer = new NetplayInputBuffer({ localSlot: input.localSlot });
    this.remoteSlot = this.buffer.remoteSlot;
    this.setupChannel = input.setupChannel;
    this.inputChannel = input.inputChannel;
    this.onDestroy = input.onDestroy;
  }

  private readonly onDestroy?: () => void;

  queueLocalInput(currentFrame: number, actions: ActionSnapshot) {
    const message = this.buffer.queueLocalInput(currentFrame, actions);
    this.sendInputMessage(message);
  }

  receiveInputMessage(message: InputMessage) {
    this.buffer.queueRemoteInput(message);
  }

  getInputsForFrame(frame: number): PlayerInputSnapshot | undefined {
    return this.buffer.getInputsForFrame(frame);
  }

  getMissingFrame(frame: number): number | undefined {
    return this.buffer.getMissingFrame(frame);
  }

  resetSync() {
    this.buffer.reset();
  }

  receiveSetupMessage(message: SetupMessage) {
    if (message.type === "checksum") {
      this.events.push({ type: "checksum", frame: message.frame, checksum: message.checksum });
    } else if (message.type === "restart") {
      this.events.push({ type: "restart", frame: message.frame });
    } else if (message.type === "exit") {
      this.events.push({ type: "exit", reason: message.reason });
    } else if (message.type === "error") {
      this.events.push({ type: "error", message: message.message });
    }
  }

  notifyClosed() {
    this.events.push({ type: "closed" });
  }

  sendChecksum(frame: number, checksum: string) {
    this.sendSetupMessage({ type: "checksum", frame, checksum });
  }

  requestRestart(frame: number) {
    this.sendSetupMessage({ type: "restart", frame });
  }

  sendExit(reason?: string) {
    this.sendSetupMessage({ type: "exit", reason });
  }

  sendError(message: string) {
    this.sendSetupMessage({ type: "error", message });
  }

  pollEvents(): NetworkGameEvent[] {
    return this.events.splice(0);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.onDestroy?.();
  }

  private sendSetupMessage(message: SetupMessage) {
    if (this.setupChannel.readyState === "open") {
      this.setupChannel.send(JSON.stringify(message));
    }
  }

  private sendInputMessage(message: InputMessage) {
    if (this.inputChannel.readyState === "open") {
      this.inputChannel.send(JSON.stringify(message));
    }
  }
}

export type NetworkInputController = DataChannelNetworkInputController;
