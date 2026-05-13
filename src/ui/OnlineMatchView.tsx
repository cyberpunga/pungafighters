import { Check, Clipboard, Link2, RadioTower, Swords } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LoadedFighter } from "../types/game";
import {
  createGuestInviteSession,
  createHostInviteSession,
  type GuestInviteSession,
  type HostInviteSession,
  type OnlineReadyMatch,
} from "../game/network/inviteSession";

type OnlineSession = HostInviteSession | GuestInviteSession;

export function OnlineMatchView(props: {
  role: "host" | "guest";
  localFighter: LoadedFighter;
  onReady: (match: OnlineReadyMatch) => void;
  onCancel: () => void;
}) {
  const [offerCode, setOfferCode] = useState("");
  const [answerCode, setAnswerCode] = useState("");
  const [pastedOffer, setPastedOffer] = useState("");
  const [pastedAnswer, setPastedAnswer] = useState("");
  const [status, setStatus] = useState("Preparing invite...");
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
      setStatus("Creating invite...");
      void createHostInviteSession(props.localFighter, {
        onStatus: setStatus,
        onError: setError,
        onReady: (match) => {
          handedOffRef.current = true;
          onReadyRef.current(match);
        },
      })
        .then((session) => {
          sessionRef.current = session;
          setOfferCode(session.offerCode);
          setBusy(false);
        })
        .catch((nextError: unknown) => {
          setError(nextError instanceof Error ? nextError.message : "Could not create host invite.");
          setBusy(false);
        });
    } else {
      setStatus("Paste a host offer.");
      setBusy(false);
    }

    return () => {
      if (!handedOffRef.current) {
        sessionRef.current?.destroy();
      }
    };
  }, [props.role, props.localFighter]);

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
      setError(nextError instanceof Error ? nextError.message : "Could not accept answer.");
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
      });
      sessionRef.current = session;
      setAnswerCode(session.answerCode);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create guest answer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="online-view">
      <div className="online-header">
        <div>
          <p className="eyebrow">{props.role === "host" ? "Host invite" : "Join invite"}</p>
          <h2>Online Match</h2>
        </div>
        <button className="secondary-button" type="button" onClick={props.onCancel}>
          <Swords size={18} />
          Fighter Select
        </button>
      </div>

      <div className="online-grid">
        <section className="online-panel">
          <div className="online-fighter">
            <img src={props.localFighter.frameUrls.idle} alt="" />
            <div>
              <span>{props.role === "host" ? "Player 1" : "Player 2"}</span>
              <strong>{props.localFighter.name}</strong>
            </div>
          </div>
          <div className="connection-status">
            <RadioTower size={18} />
            <span>{error || status}</span>
          </div>
        </section>

        {props.role === "host" ? (
          <section className="online-panel invite-steps">
            <CodeBox label="Offer code" value={offerCode} onCopy={() => copyText(offerCode)} readonly />
            <label className="field-label">
              Paste guest answer
              <textarea value={pastedAnswer} onChange={(event) => setPastedAnswer(event.target.value)} spellCheck={false} />
            </label>
            <button className="primary-button" type="button" disabled={busy || !pastedAnswer.trim()} onClick={() => void acceptAnswer()}>
              <Link2 size={18} />
              Connect
            </button>
          </section>
        ) : (
          <section className="online-panel invite-steps">
            <label className="field-label">
              Paste host offer
              <textarea value={pastedOffer} onChange={(event) => setPastedOffer(event.target.value)} spellCheck={false} />
            </label>
            <button className="primary-button" type="button" disabled={busy || !pastedOffer.trim()} onClick={() => void createAnswer()}>
              <Link2 size={18} />
              Create Answer
            </button>
            <CodeBox label="Answer code" value={answerCode} onCopy={() => copyText(answerCode)} readonly />
          </section>
        )}
      </div>
    </section>
  );
}

function CodeBox(props: { label: string; value: string; readonly?: boolean; onCopy: () => Promise<void> }) {
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
        <button className="icon-button" type="button" title="Copy code" disabled={!props.value} onClick={() => void copy()}>
          {copied ? <Check size={17} /> : <Clipboard size={17} />}
        </button>
      </div>
    </label>
  );
}

async function copyText(value: string) {
  if (value) {
    await navigator.clipboard?.writeText(value);
  }
}
