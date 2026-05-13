import type { LoadedFighter } from "../../types/game";
import { loadRemoteFighterFromPayload, serializeFighterForNetwork } from "./fighterTransfer";
import { getRtcConfiguration } from "./iceServers";
import { DataChannelNetworkInputController, type NetworkInputController } from "./networkInputController";
import {
  NETPLAY_PROTOCOL_VERSION,
  slotForRole,
  type InputMessage,
  type NetworkFighterPayload,
  type OnlineRole,
  type SetupMessage,
} from "./protocol";
import { decodeSignalCode, encodeSignalCode } from "./signalCode";

export interface OnlineReadyMatch {
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  localSlot: "p1" | "p2";
  controller: NetworkInputController;
}

export interface OnlineSessionCallbacks {
  onStatus: (message: string) => void;
  onReady: (match: OnlineReadyMatch) => void;
  onError: (message: string) => void;
}

export interface HostInviteSession {
  offerCode: string;
  acceptAnswerCode: (answerCode: string) => Promise<void>;
  destroy: () => void;
}

export interface GuestInviteSession {
  answerCode: string;
  destroy: () => void;
}

export async function createHostInviteSession(localFighter: LoadedFighter, callbacks: OnlineSessionCallbacks): Promise<HostInviteSession> {
  const session = new InviteMatchSession("host", localFighter, callbacks, await getRtcConfiguration());
  const offerCode = await session.createOfferCode();
  return {
    offerCode,
    acceptAnswerCode: (answerCode) => session.acceptAnswerCode(answerCode),
    destroy: () => session.destroy(),
  };
}

export async function createGuestInviteSession(
  offerCode: string,
  localFighter: LoadedFighter,
  callbacks: OnlineSessionCallbacks,
): Promise<GuestInviteSession> {
  const offer = decodeSignalCode(offerCode);
  if (offer.role !== "host" || offer.description.type !== "offer") {
    throw new Error("Expected a host offer code.");
  }
  const session = new InviteMatchSession("guest", localFighter, callbacks, await getRtcConfiguration());
  const answerCode = await session.createAnswerCode(offer.description);
  return {
    answerCode,
    destroy: () => session.destroy(),
  };
}

class InviteMatchSession {
  private readonly role: OnlineRole;
  private readonly localSlot: "p1" | "p2";
  private readonly localFighter: LoadedFighter;
  private readonly callbacks: OnlineSessionCallbacks;
  private readonly pc: RTCPeerConnection;
  private setupChannel?: RTCDataChannel;
  private inputChannel?: RTCDataChannel;
  private controller?: DataChannelNetworkInputController;
  private remoteFighter?: LoadedFighter;
  private revokeRemoteFighter?: () => void;
  private localReadySent = false;
  private remoteReady = false;
  private announced = false;
  private readyStarted = false;
  private destroyed = false;
  private waitingForHostToAcceptAnswer = false;
  private channelOpened = false;

  constructor(role: OnlineRole, localFighter: LoadedFighter, callbacks: OnlineSessionCallbacks, rtcConfiguration: RTCConfiguration) {
    this.role = role;
    this.localSlot = slotForRole(role);
    this.localFighter = localFighter;
    this.callbacks = callbacks;
    this.pc = new RTCPeerConnection(rtcConfiguration);
    this.pc.addEventListener("connectionstatechange", () => {
      if (this.pc.connectionState === "connected") {
        this.waitingForHostToAcceptAnswer = false;
        this.callbacks.onStatus("Peer connection established.");
      } else if (this.pc.connectionState === "failed") {
        if (this.role === "guest" && this.waitingForHostToAcceptAnswer && !this.channelOpened) {
          this.callbacks.onStatus("Answer ready. Waiting for host to connect...");
          return;
        }
        this.fail("WebRTC connection failed. A TURN server may be needed for this network.");
      } else if (this.pc.connectionState === "disconnected" || this.pc.connectionState === "closed") {
        this.controller?.notifyClosed();
      }
    });
    this.pc.addEventListener("datachannel", (event) => {
      this.assignChannel(event.channel);
    });
  }

  async createOfferCode(): Promise<string> {
    this.callbacks.onStatus("Creating invite offer...");
    this.assignChannel(this.pc.createDataChannel("setup"));
    this.assignChannel(
      this.pc.createDataChannel("inputs", {
        ordered: false,
        maxRetransmits: 0,
      }),
    );
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(this.pc);
    if (!this.pc.localDescription) {
      throw new Error("Could not create invite offer.");
    }
    this.callbacks.onStatus("Offer ready. Send it to your opponent.");
    return encodeSignalCode("host", this.pc.localDescription);
  }

  async acceptAnswerCode(answerCode: string) {
    const answer = decodeSignalCode(answerCode);
    if (answer.role !== "guest" || answer.description.type !== "answer") {
      throw new Error("Expected a guest answer code.");
    }
    this.callbacks.onStatus("Connecting to guest...");
    await this.pc.setRemoteDescription(answer.description);
  }

  async createAnswerCode(offer: RTCSessionDescriptionInit): Promise<string> {
    this.callbacks.onStatus("Reading host invite...");
    this.waitingForHostToAcceptAnswer = true;
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.pc);
    if (!this.pc.localDescription) {
      throw new Error("Could not create invite answer.");
    }
    this.callbacks.onStatus("Answer ready. Send it back to the host.");
    return encodeSignalCode("guest", this.pc.localDescription);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.setupChannel?.close();
    this.inputChannel?.close();
    this.pc.close();
    this.revokeRemoteFighter?.();
  }

  private assignChannel(channel: RTCDataChannel) {
    if (channel.label === "setup") {
      this.setupChannel = channel;
      this.wireSetupChannel(channel);
    } else if (channel.label === "inputs") {
      this.inputChannel = channel;
      this.wireInputChannel(channel);
    }
    this.ensureController();
  }

  private wireSetupChannel(channel: RTCDataChannel) {
    channel.addEventListener("open", () => {
      this.channelOpened = true;
      this.waitingForHostToAcceptAnswer = false;
      this.callbacks.onStatus("Setup channel open. Exchanging fighters...");
      void this.announceLocalFighter();
      this.maybeStartMatch();
    });
    channel.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      this.receiveSetupMessage(event.data);
    });
    channel.addEventListener("close", () => this.controller?.notifyClosed());
  }

  private wireInputChannel(channel: RTCDataChannel) {
    channel.addEventListener("open", () => {
      this.channelOpened = true;
      this.waitingForHostToAcceptAnswer = false;
      this.callbacks.onStatus("Input channel open.");
      this.maybeStartMatch();
    });
    channel.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      this.receiveInputMessage(event.data);
    });
    channel.addEventListener("close", () => this.controller?.notifyClosed());
  }

  private ensureController() {
    if (this.controller || !this.setupChannel || !this.inputChannel) {
      return;
    }
    this.controller = new DataChannelNetworkInputController({
      localSlot: this.localSlot,
      setupChannel: this.setupChannel,
      inputChannel: this.inputChannel,
      onDestroy: () => this.destroy(),
    });
  }

  private async announceLocalFighter() {
    if (this.announced || !this.setupChannel || this.setupChannel.readyState !== "open") {
      return;
    }
    this.announced = true;
    this.sendSetupMessage({
      type: "hello",
      version: NETPLAY_PROTOCOL_VERSION,
      role: this.role,
      slot: this.localSlot,
    });
    try {
      const fighter = await serializeFighterForNetwork(this.localFighter);
      this.sendSetupMessage({ type: "fighterPayload", fighter });
      this.sendSetupMessage({ type: "ready" });
      this.localReadySent = true;
      this.callbacks.onStatus("Local fighter sent. Waiting for opponent...");
      this.maybeStartMatch();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not send fighter.");
    }
  }

  private receiveSetupMessage(raw: string) {
    const message = parseSetupMessage(raw);
    if (!message) {
      this.fail("Received an incompatible setup message.");
      return;
    }
    if (message.type === "fighterPayload") {
      void this.receiveFighter(message.fighter);
      return;
    }
    if (message.type === "ready") {
      this.remoteReady = true;
      this.callbacks.onStatus("Opponent ready.");
      this.maybeStartMatch();
      return;
    }
    if (message.type === "hello") {
      return;
    }
    this.controller?.receiveSetupMessage(message);
  }

  private receiveInputMessage(raw: string) {
    const message = parseInputMessage(raw);
    if (message) {
      this.controller?.receiveInputMessage(message);
    }
  }

  private async receiveFighter(fighter: NetworkFighterPayload) {
    try {
      const loaded = await loadRemoteFighterFromPayload(fighter);
      this.remoteFighter = loaded.fighter;
      this.revokeRemoteFighter = loaded.revoke;
      this.callbacks.onStatus("Opponent fighter received.");
      this.maybeStartMatch();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Could not load remote fighter.");
    }
  }

  private maybeStartMatch() {
    if (
      this.readyStarted ||
      !this.controller ||
      !this.remoteFighter ||
      !this.localReadySent ||
      !this.remoteReady ||
      this.setupChannel?.readyState !== "open" ||
      this.inputChannel?.readyState !== "open"
    ) {
      return;
    }
    this.readyStarted = true;
    this.callbacks.onStatus("Both fighters ready. Starting match...");
    this.callbacks.onReady({
      localSlot: this.localSlot,
      controller: this.controller,
      fighters:
        this.localSlot === "p1"
          ? { p1: this.localFighter, p2: this.remoteFighter }
          : { p1: this.remoteFighter, p2: this.localFighter },
    });
  }

  private sendSetupMessage(message: SetupMessage) {
    if (this.setupChannel?.readyState === "open") {
      this.setupChannel.send(JSON.stringify(message));
    }
  }

  private fail(message: string) {
    this.callbacks.onError(message);
    this.controller?.sendError(message);
  }
}

function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 8000): Promise<void> {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") {
        done();
      }
    };
    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function parseSetupMessage(raw: string): SetupMessage | undefined {
  try {
    const parsed = JSON.parse(raw) as SetupMessage;
    return typeof parsed?.type === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseInputMessage(raw: string): InputMessage | undefined {
  try {
    const parsed = JSON.parse(raw) as InputMessage;
    return parsed?.type === "input" && Array.isArray(parsed.frames) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
