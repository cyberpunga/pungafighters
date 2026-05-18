import type { LoadedFighter, RuntimeBattleBackground } from "../../types/game";
import { createAssetChunkEnvelope, parseAssetChunkEnvelope } from "./assetChunks";
import {
  NetworkBackgroundAssetReceiver,
  serializeBattleBackgroundForNetwork,
  type NetworkBackgroundTransferAsset,
} from "./backgroundTransfer";
import {
  NETWORK_ASSET_CHUNK_BYTES,
  NetworkFighterAssetReceiver,
  serializeFighterForNetwork,
  type NetworkFighterTransferAsset,
} from "./fighterTransfer";
import { getRtcConfiguration } from "./iceServers";
import { DataChannelNetworkInputController, type NetworkInputController } from "./networkInputController";
import {
  NETPLAY_PROTOCOL_VERSION,
  slotForRole,
  type InputMessage,
  type NetworkBattleBackgroundManifest,
  type NetworkFighterManifest,
  type OnlineRole,
  type SetupMessage,
} from "./protocol";
import { decodeSignalCode, encodeSignalCode } from "./signalCode";

const SETUP_BUFFER_HIGH_BYTES = 512 * 1024;
const SETUP_BUFFER_POLL_MS = 50;
const SETUP_BUFFER_TIMEOUT_MS = 15000;
const FIGHTER_TRANSFER_TIMEOUT_MS = 60000;
const MAX_CHUNK_HEADER_BYTES = 1024;

export interface OnlineReadyMatch {
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  background?: RuntimeBattleBackground;
  localSlot: "p1" | "p2";
  controller: NetworkInputController;
}

export interface OnlineSessionCallbacks {
  onStatus: (message: string) => void;
  onReady: (match: OnlineReadyMatch) => void;
  onError: (message: string) => void;
}

export interface OnlineSessionCopy {
  expectedHostOffer: string;
  expectedGuestAnswer: string;
  peerEstablished: string;
  answerReadyWaiting: string;
  connectionFailed: string;
  creatingInviteOffer: string;
  inviteOfferFailed: string;
  offerReady: string;
  connectingGuest: string;
  readingHostInvite: string;
  inviteAnswerFailed: string;
  answerReady: string;
  setupChannelOpen: string;
  inputChannelOpen: string;
  sendingFighterManifest: string;
  localFighterSent: string;
  sendFighterFailed: string;
  sendingBattleBackground: string;
  backgroundManifestChannelClosed: string;
  setupChannelClosedBeforeAssets: (label: string) => string;
  assetChunkTooLarge: (label: string) => string;
  sendingAssetsProgress: (label: string, progress: number) => string;
  incompatibleSetupMessage: string;
  opponentReady: string;
  incompatibleProtocol: string;
  receivingOpponentAssets: string;
  readOpponentManifestFailed: string;
  onlyHostBackground: string;
  receivingHostBackground: string;
  readHostBackgroundManifestFailed: string;
  malformedAssetChunk: string;
  receivingHostBackgroundProgress: (progress: number) => string;
  fighterDataBeforeManifest: string;
  receivingOpponentAssetsProgress: (progress: number) => string;
  receiveSetupAssetFailed: string;
  opponentFighterReceived: string;
  loadRemoteFighterFailed: string;
  hostBackgroundReceived: string;
  hostDefaultArena: string;
  loadHostBackgroundFailed: string;
  remoteTransferTimedOut: string;
  localSetupReady: string;
  bothReady: string;
  sendSetupFailed: string;
  setupChannelClosedWhileSending: string;
  sendFighterTimedOut: string;
  assetsTooLarge: string;
  fighterLabel: string;
  backgroundLabel: string;
}

const DEFAULT_ONLINE_SESSION_COPY: OnlineSessionCopy = {
  expectedHostOffer: "Expected a host offer code.",
  expectedGuestAnswer: "Expected a guest answer code.",
  peerEstablished: "Peer connection established.",
  answerReadyWaiting: "Answer ready. Waiting for host to connect...",
  connectionFailed: "WebRTC connection failed. A TURN server may be needed for this network.",
  creatingInviteOffer: "Creating invite offer...",
  inviteOfferFailed: "Could not create invite offer.",
  offerReady: "Offer ready. Send it to your opponent.",
  connectingGuest: "Connecting to guest...",
  readingHostInvite: "Reading host invite...",
  inviteAnswerFailed: "Could not create invite answer.",
  answerReady: "Answer ready. Send it back to the host.",
  setupChannelOpen: "Setup channel open. Exchanging setup assets...",
  inputChannelOpen: "Input channel open.",
  sendingFighterManifest: "Sending fighter manifest...",
  localFighterSent: "Local fighter sent. Waiting for setup...",
  sendFighterFailed: "Could not send fighter.",
  sendingBattleBackground: "Sending battle background...",
  backgroundManifestChannelClosed: "Setup channel closed before background manifest could be sent.",
  setupChannelClosedBeforeAssets: (label) => `Setup channel closed before ${label} assets could be sent.`,
  assetChunkTooLarge: (label) => `A ${label} asset chunk exceeded this browser's WebRTC message size limit.`,
  sendingAssetsProgress: (label, progress) => `Sending ${label} assets ${progress}%...`,
  incompatibleSetupMessage: "Received an incompatible setup message.",
  opponentReady: "Opponent ready.",
  incompatibleProtocol: "Opponent is using an incompatible online protocol version.",
  receivingOpponentAssets: "Receiving opponent fighter assets...",
  readOpponentManifestFailed: "Could not read opponent fighter manifest.",
  onlyHostBackground: "Only the host can choose the online battle background.",
  receivingHostBackground: "Receiving host battle background...",
  readHostBackgroundManifestFailed: "Could not read host background manifest.",
  malformedAssetChunk: "Received a malformed asset chunk.",
  receivingHostBackgroundProgress: (progress) => `Receiving host background ${progress}%...`,
  fighterDataBeforeManifest: "Received fighter asset data before the fighter manifest.",
  receivingOpponentAssetsProgress: (progress) => `Receiving opponent fighter assets ${progress}%...`,
  receiveSetupAssetFailed: "Could not receive setup asset.",
  opponentFighterReceived: "Opponent fighter received.",
  loadRemoteFighterFailed: "Could not load remote fighter.",
  hostBackgroundReceived: "Host background received.",
  hostDefaultArena: "Host is using the default arena.",
  loadHostBackgroundFailed: "Could not load host background.",
  remoteTransferTimedOut: "Timed out receiving opponent fighter assets. Try a smaller fighter or reconnect.",
  localSetupReady: "Local setup ready. Waiting for opponent...",
  bothReady: "Both fighters ready. Starting match...",
  sendSetupFailed: "Could not send setup message.",
  setupChannelClosedWhileSending: "Setup channel closed while sending fighter assets.",
  sendFighterTimedOut: "Timed out sending fighter assets. Try a smaller fighter or reconnect.",
  assetsTooLarge: "Setup assets are too large for this WebRTC connection. Try a smaller fighter, shorter voice clips, or a smaller background.",
  fighterLabel: "fighter",
  backgroundLabel: "background",
};

export interface HostInviteSession {
  offerCode: string;
  acceptAnswerCode: (answerCode: string) => Promise<void>;
  destroy: () => void;
}

export interface GuestInviteSession {
  answerCode: string;
  destroy: () => void;
}

export async function createHostInviteSession(
  localFighter: LoadedFighter,
  background: RuntimeBattleBackground | undefined,
  callbacks: OnlineSessionCallbacks,
  copy: OnlineSessionCopy = DEFAULT_ONLINE_SESSION_COPY,
): Promise<HostInviteSession> {
  const session = new InviteMatchSession("host", localFighter, background, callbacks, await getRtcConfiguration(), copy);
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
  copy: OnlineSessionCopy = DEFAULT_ONLINE_SESSION_COPY,
): Promise<GuestInviteSession> {
  const offer = decodeSignalCode(offerCode);
  if (offer.role !== "host" || offer.description.type !== "offer") {
    throw new Error(copy.expectedHostOffer);
  }
  const session = new InviteMatchSession("guest", localFighter, undefined, callbacks, await getRtcConfiguration(), copy);
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
  private readonly hostBackground?: RuntimeBattleBackground;
  private readonly callbacks: OnlineSessionCallbacks;
  private readonly copy: OnlineSessionCopy;
  private readonly pc: RTCPeerConnection;
  private setupChannel?: RTCDataChannel;
  private inputChannel?: RTCDataChannel;
  private controller?: DataChannelNetworkInputController;
  private remoteFighter?: LoadedFighter;
  private remoteTransfer?: NetworkFighterAssetReceiver;
  private remoteBackground?: RuntimeBattleBackground;
  private remoteBackgroundTransfer?: NetworkBackgroundAssetReceiver;
  private remoteTransferFinalizing = false;
  private remoteBackgroundTransferFinalizing = false;
  private remoteTransferTimeout?: ReturnType<typeof setTimeout>;
  private revokeRemoteFighter?: () => void;
  private revokeRemoteBackground?: () => void;
  private localAssetsSent = false;
  private localReadySent = false;
  private remoteReady = false;
  private remoteBackgroundReady = false;
  private announced = false;
  private readyStarted = false;
  private destroyed = false;
  private waitingForHostToAcceptAnswer = false;
  private channelOpened = false;

  constructor(
    role: OnlineRole,
    localFighter: LoadedFighter,
    hostBackground: RuntimeBattleBackground | undefined,
    callbacks: OnlineSessionCallbacks,
    rtcConfiguration: RTCConfiguration,
    copy: OnlineSessionCopy,
  ) {
    this.role = role;
    this.localSlot = slotForRole(role);
    this.localFighter = localFighter;
    this.hostBackground = role === "host" ? hostBackground : undefined;
    this.remoteBackgroundReady = role === "host";
    this.callbacks = callbacks;
    this.copy = copy;
    this.pc = new RTCPeerConnection(rtcConfiguration);
    this.pc.addEventListener("connectionstatechange", () => {
      if (this.pc.connectionState === "connected") {
        this.waitingForHostToAcceptAnswer = false;
        this.callbacks.onStatus(this.copy.peerEstablished);
      } else if (this.pc.connectionState === "failed") {
        if (this.role === "guest" && this.waitingForHostToAcceptAnswer && !this.channelOpened) {
          this.callbacks.onStatus(this.copy.answerReadyWaiting);
          return;
        }
        this.fail(this.copy.connectionFailed);
      } else if (this.pc.connectionState === "disconnected" || this.pc.connectionState === "closed") {
        this.controller?.notifyClosed();
      }
    });
    this.pc.addEventListener("datachannel", (event) => {
      this.assignChannel(event.channel);
    });
  }

  async createOfferCode(): Promise<string> {
    this.callbacks.onStatus(this.copy.creatingInviteOffer);
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
      throw new Error(this.copy.inviteOfferFailed);
    }
    this.callbacks.onStatus(this.copy.offerReady);
    return encodeSignalCode("host", this.pc.localDescription);
  }

  async acceptAnswerCode(answerCode: string) {
    const answer = decodeSignalCode(answerCode);
    if (answer.role !== "guest" || answer.description.type !== "answer") {
      throw new Error(this.copy.expectedGuestAnswer);
    }
    this.callbacks.onStatus(this.copy.connectingGuest);
    await this.pc.setRemoteDescription(answer.description);
  }

  async createAnswerCode(offer: RTCSessionDescriptionInit): Promise<string> {
    this.callbacks.onStatus(this.copy.readingHostInvite);
    this.waitingForHostToAcceptAnswer = true;
    await this.pc.setRemoteDescription(offer);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.pc);
    if (!this.pc.localDescription) {
      throw new Error(this.copy.inviteAnswerFailed);
    }
    this.callbacks.onStatus(this.copy.answerReady);
    return encodeSignalCode("guest", this.pc.localDescription);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.clearRemoteTransferTimeout();
    this.setupChannel?.close();
    this.inputChannel?.close();
    this.pc.close();
    this.revokeRemoteFighter?.();
    this.revokeRemoteBackground?.();
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
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => {
      this.channelOpened = true;
      this.waitingForHostToAcceptAnswer = false;
      this.callbacks.onStatus(this.copy.setupChannelOpen);
      void this.announceLocalFighter();
      this.maybeStartMatch();
    });
    channel.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        this.receiveSetupMessage(event.data);
        return;
      }
      void this.receiveAssetChunk(event.data);
    });
    channel.addEventListener("close", () => this.controller?.notifyClosed());
  }

  private wireInputChannel(channel: RTCDataChannel) {
    channel.addEventListener("open", () => {
      this.channelOpened = true;
      this.waitingForHostToAcceptAnswer = false;
      this.callbacks.onStatus(this.copy.inputChannelOpen);
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
    if (
      !this.sendSetupMessage({
        type: "hello",
        version: NETPLAY_PROTOCOL_VERSION,
        role: this.role,
        slot: this.localSlot,
      })
    ) {
      return;
    }
    try {
      if (this.role === "host") {
        await this.announceHostBackground();
      }
      const transfer = await serializeFighterForNetwork(this.localFighter);
      this.callbacks.onStatus(this.copy.sendingFighterManifest);
      if (!this.sendSetupMessage({ type: "fighterManifest", fighter: transfer.manifest })) {
        return;
      }
      await this.sendTransferAssets(transfer.assets, transfer.totalBytes, "fighter");
      this.localAssetsSent = true;
      this.callbacks.onStatus(this.copy.localFighterSent);
      this.maybeSendReady();
      this.maybeStartMatch();
    } catch (error) {
      this.fail(normalizeTransferError(error, this.copy.sendFighterFailed, this.copy));
    }
  }

  private async announceHostBackground() {
    const transfer = await serializeBattleBackgroundForNetwork(this.hostBackground);
    this.callbacks.onStatus(this.copy.sendingBattleBackground);
    if (!this.sendSetupMessage({ type: "stageManifest", background: transfer.manifest })) {
      throw new Error(this.copy.backgroundManifestChannelClosed);
    }
    await this.sendTransferAssets(transfer.assets, transfer.totalBytes, "background");
  }

  private async sendTransferAssets(
    assets: Array<NetworkFighterTransferAsset | NetworkBackgroundTransferAsset>,
    totalBytes: number,
    label: "fighter" | "background",
  ) {
    const channel = this.setupChannel;
    if (!channel || channel.readyState !== "open") {
      throw new Error(this.copy.setupChannelClosedBeforeAssets(this.getAssetLabel(label)));
    }

    const maxMessageBytes = getMaxDataChannelMessageBytes(this.pc);
    const chunkBytes = getChunkPayloadBytes(maxMessageBytes);
    let sentBytes = 0;
    let lastProgress = -1;

    for (const asset of assets) {
      const chunkCount = Math.ceil(asset.byteLength / chunkBytes);
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        const offset = chunkIndex * chunkBytes;
        const payload = new Uint8Array(await asset.blob.slice(offset, offset + chunkBytes).arrayBuffer());
        const envelope = createAssetChunkEnvelope(
          {
            type: "assetChunk",
            assetId: asset.assetId,
            offset,
            chunkIndex,
            chunkCount,
            totalBytes: asset.byteLength,
            byteLength: payload.byteLength,
          },
          payload,
        );

        if (maxMessageBytes && envelope.byteLength > maxMessageBytes) {
          throw new Error(this.copy.assetChunkTooLarge(this.getAssetLabel(label)));
        }

        await waitForSetupBuffer(channel, this.copy);
        channel.send(envelope);
        sentBytes += payload.byteLength;

        const progress = totalBytes > 0 ? Math.floor((sentBytes / totalBytes) * 100) : 100;
        if (progress >= lastProgress + 10 || progress === 100) {
          lastProgress = progress;
          this.callbacks.onStatus(this.copy.sendingAssetsProgress(this.getAssetLabel(label), progress));
        }
      }
    }
  }

  private receiveSetupMessage(raw: string) {
    const message = parseSetupMessage(raw);
    if (!message) {
      this.fail(this.copy.incompatibleSetupMessage);
      return;
    }
    if (message.type === "fighterManifest") {
      this.receiveFighterManifest(message.fighter);
      return;
    }
    if (message.type === "stageManifest") {
      this.receiveBackgroundManifest(message.background);
      return;
    }
    if (message.type === "ready") {
      this.remoteReady = true;
      this.callbacks.onStatus(this.copy.opponentReady);
      this.maybeStartMatch();
      return;
    }
    if (message.type === "hello") {
      if (message.version !== NETPLAY_PROTOCOL_VERSION) {
        this.fail(this.copy.incompatibleProtocol);
      }
      return;
    }
    this.controller?.receiveSetupMessage(message);
  }

  private receiveFighterManifest(fighter: NetworkFighterManifest) {
    try {
      this.remoteTransfer = new NetworkFighterAssetReceiver(fighter);
      this.remoteTransferFinalizing = false;
      this.startRemoteTransferTimeout();
      this.callbacks.onStatus(this.copy.receivingOpponentAssets);
    } catch (error) {
      this.fail(normalizeTransferError(error, this.copy.readOpponentManifestFailed, this.copy));
    }
  }

  private receiveBackgroundManifest(background: NetworkBattleBackgroundManifest) {
    if (this.role !== "guest") {
      this.fail(this.copy.onlyHostBackground);
      return;
    }
    try {
      this.remoteBackgroundTransfer = new NetworkBackgroundAssetReceiver(background);
      this.remoteBackgroundTransferFinalizing = false;
      if (this.remoteBackgroundTransfer.isComplete()) {
        this.finishRemoteBackgroundTransfer();
        return;
      }
      this.startRemoteTransferTimeout();
      this.callbacks.onStatus(this.copy.receivingHostBackground);
    } catch (error) {
      this.fail(normalizeTransferError(error, this.copy.readHostBackgroundManifestFailed, this.copy));
    }
  }

  private async receiveAssetChunk(data: unknown) {
    try {
      const chunk = data instanceof ArrayBuffer || data instanceof Blob ? await parseAssetChunkEnvelope(data) : undefined;
      if (!chunk) {
        throw new Error(this.copy.malformedAssetChunk);
      }

      if (this.remoteBackgroundTransfer?.hasAsset(chunk.header.assetId)) {
        this.remoteBackgroundTransfer.receiveChunk(chunk.header, chunk.payload);
        const progress = this.remoteBackgroundTransfer.getProgress();
        const percent = progress.totalBytes > 0 ? Math.floor((progress.receivedBytes / progress.totalBytes) * 100) : 100;
        this.callbacks.onStatus(this.copy.receivingHostBackgroundProgress(percent));
        if (this.remoteBackgroundTransfer.isComplete()) {
          this.finishRemoteBackgroundTransfer();
        }
        return;
      }

      if (!this.remoteTransfer) {
        throw new Error(this.copy.fighterDataBeforeManifest);
      }

      this.remoteTransfer.receiveChunk(chunk.header, chunk.payload);
      const progress = this.remoteTransfer.getProgress();
      const percent = progress.totalBytes > 0 ? Math.floor((progress.receivedBytes / progress.totalBytes) * 100) : 100;
      this.callbacks.onStatus(this.copy.receivingOpponentAssetsProgress(percent));

      if (this.remoteTransfer.isComplete()) {
        this.finishRemoteFighterTransfer();
      }
    } catch (error) {
      this.fail(normalizeTransferError(error, this.copy.receiveSetupAssetFailed, this.copy));
    }
  }

  private finishRemoteFighterTransfer() {
    if (!this.remoteTransfer || this.remoteTransferFinalizing) {
      return;
    }
    this.remoteTransferFinalizing = true;
    try {
      const loaded = this.remoteTransfer.createLoadedFighter();
      this.clearRemoteTransferTimeout();
      this.remoteFighter = loaded.fighter;
      this.revokeRemoteFighter = loaded.revoke;
      this.callbacks.onStatus(this.copy.opponentFighterReceived);
      this.maybeStartMatch();
    } catch (error) {
      this.fail(normalizeTransferError(error, this.copy.loadRemoteFighterFailed, this.copy));
    }
  }

  private finishRemoteBackgroundTransfer() {
    if (!this.remoteBackgroundTransfer || this.remoteBackgroundTransferFinalizing) {
      return;
    }
    this.remoteBackgroundTransferFinalizing = true;
    try {
      const loaded = this.remoteBackgroundTransfer.createRuntimeBackground();
      this.remoteBackground = loaded.background;
      this.revokeRemoteBackground = loaded.revoke;
      this.remoteBackgroundReady = true;
      this.callbacks.onStatus(this.remoteBackground ? this.copy.hostBackgroundReceived : this.copy.hostDefaultArena);
      this.maybeSendReady();
      this.maybeStartMatch();
    } catch (error) {
      this.fail(normalizeTransferError(error, this.copy.loadHostBackgroundFailed, this.copy));
    }
  }

  private startRemoteTransferTimeout() {
    this.clearRemoteTransferTimeout();
    this.remoteTransferTimeout = setTimeout(() => {
      this.fail(this.copy.remoteTransferTimedOut);
    }, FIGHTER_TRANSFER_TIMEOUT_MS);
  }

  private clearRemoteTransferTimeout() {
    if (this.remoteTransferTimeout) {
      clearTimeout(this.remoteTransferTimeout);
      this.remoteTransferTimeout = undefined;
    }
  }

  private receiveInputMessage(raw: string) {
    const message = parseInputMessage(raw);
    if (message) {
      this.controller?.receiveInputMessage(message);
    }
  }

  private maybeSendReady() {
    if (this.localReadySent || !this.localAssetsSent || !this.remoteBackgroundReady) {
      return;
    }
    if (!this.sendSetupMessage({ type: "ready" })) {
      return;
    }
    this.localReadySent = true;
    this.callbacks.onStatus(this.copy.localSetupReady);
  }

  private maybeStartMatch() {
    if (
      this.readyStarted ||
      !this.controller ||
      !this.remoteFighter ||
      !this.localReadySent ||
      !this.remoteReady ||
      !this.remoteBackgroundReady ||
      this.setupChannel?.readyState !== "open" ||
      this.inputChannel?.readyState !== "open"
    ) {
      return;
    }
    this.readyStarted = true;
    this.callbacks.onStatus(this.copy.bothReady);
    this.callbacks.onReady({
      localSlot: this.localSlot,
      controller: this.controller,
      background: this.role === "host" ? this.hostBackground : this.remoteBackground,
      fighters:
        this.localSlot === "p1"
          ? { p1: this.localFighter, p2: this.remoteFighter }
          : { p1: this.remoteFighter, p2: this.localFighter },
    });
  }

  private sendSetupMessage(message: SetupMessage): boolean {
    if (this.setupChannel?.readyState !== "open") {
      return false;
    }
    try {
      this.setupChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.fail(normalizeTransferError(error, this.copy.sendSetupFailed, this.copy));
      return false;
    }
  }

  private getAssetLabel(label: "fighter" | "background") {
    return label === "fighter" ? this.copy.fighterLabel : this.copy.backgroundLabel;
  }

  private fail(message: string) {
    this.clearRemoteTransferTimeout();
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

async function waitForSetupBuffer(channel: RTCDataChannel, copy: OnlineSessionCopy): Promise<void> {
  const startedAt = Date.now();
  while (channel.bufferedAmount > SETUP_BUFFER_HIGH_BYTES) {
    if (channel.readyState !== "open") {
      throw new Error(copy.setupChannelClosedWhileSending);
    }
    if (Date.now() - startedAt > SETUP_BUFFER_TIMEOUT_MS) {
      throw new Error(copy.sendFighterTimedOut);
    }
    await delay(SETUP_BUFFER_POLL_MS);
  }
}

function getMaxDataChannelMessageBytes(pc: RTCPeerConnection): number | undefined {
  const maxMessageSize = pc.sctp?.maxMessageSize;
  return typeof maxMessageSize === "number" && Number.isFinite(maxMessageSize) && maxMessageSize > 0 ? maxMessageSize : undefined;
}

function getChunkPayloadBytes(maxMessageBytes: number | undefined) {
  if (!maxMessageBytes) {
    return NETWORK_ASSET_CHUNK_BYTES;
  }
  return Math.max(1024, Math.min(NETWORK_ASSET_CHUNK_BYTES, maxMessageBytes - MAX_CHUNK_HEADER_BYTES));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTransferError(error: unknown, fallback: string, copy: OnlineSessionCopy) {
  if (!(error instanceof Error)) {
    return fallback;
  }
  if (/message size|too large|exceeded/i.test(error.message)) {
    return copy.assetsTooLarge;
  }
  return error.message || fallback;
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
