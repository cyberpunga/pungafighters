import { Check, Clipboard, Link2, RadioTower, Swords } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LoadedFighter, RuntimeBattleBackground } from "../types/game";
import {
  createGuestInviteSession,
  createHostInviteSession,
  type GuestInviteSession,
  type HostInviteSession,
  type OnlineSessionCopy,
  type OnlineReadyMatch,
} from "../game/network/inviteSession";
import { localizeError } from "../i18n/errors";
import type { Translate } from "../i18n";
import { useI18n } from "../i18n/react";

type OnlineSession = HostInviteSession | GuestInviteSession;

export function OnlineMatchView(props: {
  role: "host" | "guest";
  localFighter: LoadedFighter;
  background?: RuntimeBattleBackground;
  onReady: (match: OnlineReadyMatch) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [offerCode, setOfferCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [pastedOffer, setPastedOffer] = useState("");
  const [pastedAnswer, setPastedAnswer] = useState("");
  const [status, setStatus] = useState(() => t("online.preparingInvite"));
  const [busy, setBusy] = useState(props.role === "host");
  const [error, setError] = useState("");
  const sessionRef = useRef<OnlineSession | null>(null);
  const handedOffRef = useRef(false);
  const onReadyRef = useRef(props.onReady);

  useEffect(() => {
    onReadyRef.current = props.onReady;
  }, [props.onReady]);

  useEffect(() => {
    handedOffRef.current = false;
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setOfferCode("");
    setAnswerCode("");
    setPastedOffer("");
    setPastedAnswer("");
    setError("");
    if (props.role === "host") {
      setBusy(true);
      setStatus(t("online.creatingInvite"));
      void createHostInviteSession(props.localFighter, props.background, {
        onStatus: setStatus,
        onError: setError,
        onReady: (match) => {
          handedOffRef.current = true;
          onReadyRef.current(match);
        },
      }, createOnlineSessionCopy(t))
        .then((session) => {
          sessionRef.current = session;
          setOfferCode(session.offerCode);
          setBusy(false);
        })
        .catch((nextError: unknown) => {
          setError(localizeError(nextError, t, "online.createHostInviteFailed"));
          setBusy(false);
        });
    } else {
      setStatus(t("online.pasteHostOfferStatus"));
      setBusy(false);
    }

    return () => {
      if (!handedOffRef.current) {
        sessionRef.current?.destroy();
      }
    };
  }, [props.role, props.localFighter, props.background, t]);

  const acceptAnswer = async () => {
    const session = sessionRef.current;
    if (!session || !("acceptAnswerCode" in session)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await session.acceptAnswerCode(pastedAnswer);
    } catch (nextError) {
      setError(localizeError(nextError, t, "online.acceptAnswerFailed"));
    } finally {
      setBusy(false);
    }
  };

  const createAnswer = async () => {
    setBusy(true);
    setError("");
    try {
      const session = await createGuestInviteSession(pastedOffer, props.localFighter, {
        onStatus: setStatus,
        onError: setError,
        onReady: (match) => {
          handedOffRef.current = true;
          onReadyRef.current(match);
        },
      }, createOnlineSessionCopy(t));
      sessionRef.current = session;
      setAnswerCode(session.answerCode);
    } catch (nextError) {
      setError(localizeError(nextError, t, "online.createGuestAnswerFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="online-view">
      <div className="online-header">
        <div>
          <p className="eyebrow">{props.role === "host" ? t("online.hostInvite") : t("online.joinInvite")}</p>
          <h2>{t("online.onlineMatch")}</h2>
        </div>
        <button className="secondary-button" type="button" onClick={props.onCancel}>
          <Swords size={18} />
          {t("common.back")}
        </button>
      </div>

      <div className="online-grid">
        <section className="online-panel">
          <div className="online-fighter">
            <img src={props.localFighter.spriteFrameUrls?.idle1 || props.localFighter.frameUrls.idle} alt="" />
            <div>
              <span>{props.role === "host" ? t("common.player1") : t("common.player2")}</span>
              <strong>{props.localFighter.name}</strong>
            </div>
          </div>
          {props.role === "host" && (
            <div className="online-stage">
              {props.background ? <img src={props.background.imageUrl} alt="" /> : <div className="background-preview-default" />}
              <div>
                <span>{t("online.sharedArena")}</span>
                <strong>{props.background?.name ?? t("common.defaultArena")}</strong>
              </div>
            </div>
          )}
          <div className="connection-status">
            <RadioTower size={18} />
            <span>{error || status}</span>
          </div>
        </section>

        {props.role === "host" ? (
          <section className="online-panel invite-steps">
            <CodeBox label={t("online.offerCode")} value={offerCode} onCopy={() => copyText(offerCode)} readonly />
            <label className="field-label">
              {t("online.pasteGuestAnswer")}
              <textarea value={pastedAnswer} onChange={(event) => setPastedAnswer(event.target.value)} spellCheck={false} />
            </label>
            <button className="primary-button" type="button" disabled={busy || !pastedAnswer.trim()} onClick={() => void acceptAnswer()}>
              <Link2 size={18} />
              {t("common.connect")}
            </button>
          </section>
        ) : (
          <section className="online-panel invite-steps">
            <label className="field-label">
              {t("online.pasteHostOffer")}
              <textarea value={pastedOffer} onChange={(event) => setPastedOffer(event.target.value)} spellCheck={false} />
            </label>
            <button className="primary-button" type="button" disabled={busy || !pastedOffer.trim()} onClick={() => void createAnswer()}>
              <Link2 size={18} />
              {t("online.createAnswer")}
            </button>
            <CodeBox label={t("online.answerCode")} value={answerCode} onCopy={() => copyText(answerCode)} readonly />
          </section>
        )}
      </div>
    </section>
  );
}

function CodeBox(props: { label: string; value: string; readonly?: boolean; onCopy: () => Promise<void> }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await props.onCopy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <label className="field-label code-label">
      {props.label}
      <div className="code-box">
        <textarea value={props.value} readOnly={props.readonly} spellCheck={false} />
        <button className="icon-button" type="button" title={t("common.copyCode")} disabled={!props.value} onClick={() => void copy()}>
          {copied ? <Check size={17} /> : <Clipboard size={17} />}
        </button>
      </div>
    </label>
  );
}

function createOnlineSessionCopy(t: Translate): OnlineSessionCopy {
  return {
    expectedHostOffer: t("online.expectedHostOffer"),
    expectedGuestAnswer: t("online.expectedGuestAnswer"),
    peerEstablished: t("online.peerEstablished"),
    answerReadyWaiting: t("online.answerReadyWaiting"),
    connectionFailed: t("online.connectionFailed"),
    creatingInviteOffer: t("online.creatingInviteOffer"),
    inviteOfferFailed: t("online.inviteOfferFailed"),
    offerReady: t("online.offerReady"),
    connectingGuest: t("online.connectingGuest"),
    readingHostInvite: t("online.readingHostInvite"),
    inviteAnswerFailed: t("online.inviteAnswerFailed"),
    answerReady: t("online.answerReady"),
    setupChannelOpen: t("online.setupChannelOpen"),
    inputChannelOpen: t("online.inputChannelOpen"),
    sendingFighterManifest: t("online.sendingFighterManifest"),
    localFighterSent: t("online.localFighterSent"),
    sendFighterFailed: t("online.sendFighterFailed"),
    sendingBattleBackground: t("online.sendingBattleBackground"),
    backgroundManifestChannelClosed: t("online.backgroundManifestChannelClosed"),
    setupChannelClosedBeforeAssets: (label) => t("online.setupChannelClosedBeforeAssets", { label }),
    assetChunkTooLarge: (label) => t("online.assetChunkTooLarge", { label }),
    sendingAssetsProgress: (label, progress) => t("online.sendingAssetsProgress", { label, progress }),
    incompatibleSetupMessage: t("online.incompatibleSetupMessage"),
    opponentReady: t("online.opponentReady"),
    incompatibleProtocol: t("online.incompatibleProtocol"),
    receivingOpponentAssets: t("online.receivingOpponentAssets"),
    readOpponentManifestFailed: t("online.readOpponentManifestFailed"),
    onlyHostBackground: t("online.onlyHostBackground"),
    receivingHostBackground: t("online.receivingHostBackground"),
    readHostBackgroundManifestFailed: t("online.readHostBackgroundManifestFailed"),
    malformedAssetChunk: t("online.malformedAssetChunk"),
    receivingHostBackgroundProgress: (progress) => t("online.receivingHostBackgroundProgress", { progress }),
    fighterDataBeforeManifest: t("online.fighterDataBeforeManifest"),
    receivingOpponentAssetsProgress: (progress) => t("online.receivingOpponentAssetsProgress", { progress }),
    receiveSetupAssetFailed: t("online.receiveSetupAssetFailed"),
    opponentFighterReceived: t("online.opponentFighterReceived"),
    loadRemoteFighterFailed: t("online.loadRemoteFighterFailed"),
    hostBackgroundReceived: t("online.hostBackgroundReceived"),
    hostDefaultArena: t("online.hostDefaultArena"),
    loadHostBackgroundFailed: t("online.loadHostBackgroundFailed"),
    remoteTransferTimedOut: t("online.remoteTransferTimedOut"),
    localSetupReady: t("online.localSetupReady"),
    bothReady: t("online.bothReady"),
    sendSetupFailed: t("online.sendSetupFailed"),
    setupChannelClosedWhileSending: t("online.setupChannelClosedWhileSending"),
    sendFighterTimedOut: t("online.sendFighterTimedOut"),
    assetsTooLarge: t("online.assetsTooLarge"),
    fighterLabel: t("online.labelFighter"),
    backgroundLabel: t("online.labelBackground"),
  };
}

async function copyText(value: string) {
  if (value) {
    await navigator.clipboard?.writeText(value);
  }
}
