import { NETPLAY_PROTOCOL_VERSION, type OnlineRole, type SignalCodePayload } from "./protocol";

export function encodeSignalCode(role: OnlineRole, description: RTCSessionDescriptionInit): string {
  return encodeBase64Url(
    JSON.stringify({
      version: NETPLAY_PROTOCOL_VERSION,
      role,
      description,
    } satisfies SignalCodePayload),
  );
}

export function decodeSignalCode(code: string): SignalCodePayload {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error("Invite code is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(trimmed));
  } catch {
    throw new Error("Invite code is not valid.");
  }

  if (!isSignalCodePayload(parsed)) {
    throw new Error("Invite code is not compatible with this version.");
  }
  return parsed;
}

function isSignalCodePayload(value: unknown): value is SignalCodePayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Partial<SignalCodePayload>;
  return (
    payload.version === NETPLAY_PROTOCOL_VERSION &&
    (payload.role === "host" || payload.role === "guest") &&
    Boolean(payload.description) &&
    typeof payload.description?.type === "string" &&
    typeof payload.description?.sdp === "string"
  );
}

function encodeBase64Url(value: string) {
  const encoded = btoa(unescape(encodeURIComponent(value)));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return decodeURIComponent(escape(atob(padded)));
}
