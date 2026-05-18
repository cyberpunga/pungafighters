export interface Env {
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
  ALLOWED_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
  TURN_TTL_SECONDS?: string;
}

const CLOUDFLARE_TURN_API = "https://rtc.live.cloudflare.com/v1/turn/keys";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigin = getAllowedOrigin(origin, env);
    const corsHeaders = getCorsHeaders(allowedOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (origin && !allowedOrigin) {
      return json({ error: "Origin is not allowed" }, 403, getCorsHeaders(""));
    }

    const url = new URL(request.url);
    if (url.pathname !== "/ice-servers") {
      return json({ error: "Not found" }, 404, corsHeaders);
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, corsHeaders);
    }

    return getIceServers(env, corsHeaders);
  },
};

async function getIceServers(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return json({ error: "TURN credentials are not configured" }, 500, corsHeaders);
  }

  const ttl = Number(env.TURN_TTL_SECONDS ?? 86400);

  const response = await fetch(`${CLOUDFLARE_TURN_API}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl }),
  });

  if (!response.ok) {
    return json(
      {
        error: "Could not generate TURN credentials",
        status: response.status,
      },
      502,
      corsHeaders,
    );
  }

  const body = await response.json();

  return json(filterBrowserBlockedPort53(body), 200, {
    ...corsHeaders,
    "Cache-Control": "no-store",
  });
}

function getCorsHeaders(allowedOrigin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
}

function filterBrowserBlockedPort53(body: any) {
  if (!Array.isArray(body?.iceServers)) {
    return body;
  }

  return {
    ...body,
    iceServers: body.iceServers
      .map((server: any) => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        const filteredUrls = urls.filter((url: unknown) => typeof url === "string" && !/:53(\?|$)/.test(url));

        return filteredUrls.length > 0
          ? {
              ...server,
              urls: filteredUrls.length === 1 ? filteredUrls[0] : filteredUrls,
            }
          : undefined;
      })
      .filter(Boolean),
  };
}

function getAllowedOrigin(origin: string, env: Env) {
  const configured = splitOrigins(env.ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN);
  if (configured.length === 0) {
    return "*";
  }
  if (!origin) {
    return configured[0];
  }
  return configured.includes(origin) ? origin : "";
}

function splitOrigins(value?: string) {
  return value
    ? value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [];
}
