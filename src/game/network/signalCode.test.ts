import { describe, expect, it } from "vitest";
import { NETPLAY_PROTOCOL_VERSION } from "./protocol";
import { decodeSignalCode, encodeSignalCode } from "./signalCode";

describe("signal codes", () => {
  it("round-trips a WebRTC description", () => {
    const description = {
      type: "offer" as const,
      sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n",
    };

    const code = encodeSignalCode("host", description);
    const decoded = decodeSignalCode(code);

    expect(decoded).toEqual({
      version: NETPLAY_PROTOCOL_VERSION,
      role: "host",
      description,
    });
  });

  it("rejects malformed codes", () => {
    expect(() => decodeSignalCode("not-an-invite")).toThrow("Invite code");
  });
});
