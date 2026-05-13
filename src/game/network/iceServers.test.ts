import { describe, expect, it } from "vitest";
import { normalizeIceServers } from "./iceServers";

describe("ice server configuration", () => {
  it("accepts Cloudflare's generated iceServers response", () => {
    const servers = normalizeIceServers({
      iceServers: [
        { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
        {
          urls: [
            "turn:turn.cloudflare.com:3478?transport=udp",
            "turn:turn.cloudflare.com:53?transport=udp",
            "turns:turn.cloudflare.com:443?transport=tcp",
          ],
          username: "user",
          credential: "pass",
        },
      ],
    });

    expect(servers).toEqual([
      { urls: "stun:stun.cloudflare.com:3478" },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
        username: "user",
        credential: "pass",
      },
    ]);
  });

  it("rejects incompatible shapes", () => {
    expect(() => normalizeIceServers({ nope: true })).toThrow("iceServers");
  });
});
