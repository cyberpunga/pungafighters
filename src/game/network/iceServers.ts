const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

interface IceServersResponse {
  iceServers: RTCIceServer[];
}

type Env = Record<string, string | boolean | undefined>;

export async function getRtcConfiguration(): Promise<RTCConfiguration> {
  const iceServers = await getIceServers();
  return {
    iceServers,
    iceTransportPolicy: getEnvBoolean("VITE_RTC_FORCE_TURN") ? "relay" : "all",
  };
}

export async function getIceServers(): Promise<RTCIceServer[]> {
  const endpoint = getEnvString("VITE_RTC_ICE_SERVERS_URL");
  if (endpoint) {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error("Could not load TURN credentials.");
    }
    return normalizeIceServers(await response.json());
  }

  const inlineJson = getEnvString("VITE_RTC_ICE_SERVERS_JSON");
  if (inlineJson) {
    return normalizeIceServers(JSON.parse(inlineJson));
  }

  return DEFAULT_ICE_SERVERS;
}

export function normalizeIceServers(input: unknown): RTCIceServer[] {
  const rawServers = Array.isArray(input) ? input : isIceServersResponse(input) ? input.iceServers : undefined;
  if (!rawServers) {
    throw new Error("TURN configuration must be an iceServers array or an object with iceServers.");
  }

  const servers = rawServers
    .map((server) => normalizeIceServer(server))
    .filter((server): server is RTCIceServer => Boolean(server));

  return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
}

function normalizeIceServer(server: unknown): RTCIceServer | undefined {
  if (!server || typeof server !== "object") {
    return undefined;
  }
  const candidate = server as RTCIceServer;
  const urls = Array.isArray(candidate.urls) ? candidate.urls : typeof candidate.urls === "string" ? [candidate.urls] : [];
  const browserSafeUrls = urls.filter((url) => typeof url === "string" && !/:53(\?|$)/.test(url));
  if (browserSafeUrls.length === 0) {
    return undefined;
  }

  const normalized: RTCIceServer = {
    urls: browserSafeUrls.length === 1 ? browserSafeUrls[0] : browserSafeUrls,
  };
  if (candidate.username) {
    normalized.username = candidate.username;
  }
  if (candidate.credential) {
    normalized.credential = candidate.credential;
  }
  return normalized;
}

function isIceServersResponse(input: unknown): input is IceServersResponse {
  return Boolean(input && typeof input === "object" && Array.isArray((input as Partial<IceServersResponse>).iceServers));
}

function getEnvString(name: string): string | undefined {
  const value = getEnv()[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getEnvBoolean(name: string): boolean {
  const value = getEnv()[name];
  return value === true || value === "true" || value === "1";
}

function getEnv(): Env {
  return ((import.meta as ImportMeta & { env?: Env }).env ?? {}) as Env;
}
