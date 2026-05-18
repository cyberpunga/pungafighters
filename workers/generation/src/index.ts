export interface Env {
  ALLOWED_ORIGIN?: string;
  ALLOWED_ORIGINS?: string;
  GEMINI_API_KEY?: string;
  GEMINI_IMAGE_MODEL?: string;
  GEMINI_IMAGE_ASPECT_RATIO?: string;
  GEMINI_IMAGE_SIZE?: string;
}

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const MAX_REFERENCE_IMAGES = 14;
const MAX_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;

const MODEL_ALIASES: Record<string, string> = {
  "nano-banana": "gemini-2.5-flash-image",
  "nano-banana-2": "gemini-3.1-flash-image-preview",
  "nano-banana-pro": "gemini-3-pro-image-preview",
};

interface GenerateCharacterRequest {
  prompt?: unknown;
  model?: unknown;
  images?: unknown;
  image?: unknown;
  aspectRatio?: unknown;
  imageSize?: unknown;
}

interface ReferenceImageInput {
  mimeType?: unknown;
  data?: unknown;
}

interface NormalizedReferenceImage {
  mimeType: string;
  data: string;
}

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
    if (url.pathname !== "/generate") {
      return json({ error: "Not found" }, 404, corsHeaders);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsHeaders);
    }

    return generateCharacterSpritesheet(request, env, corsHeaders);
  },
};

async function generateCharacterSpritesheet(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (!env.GEMINI_API_KEY) {
    return json({ error: "Gemini image generation is not configured" }, 500, corsHeaders);
  }

  const payload = await readGeneratePayload(request);
  if (!payload.ok) {
    return json({ error: payload.error }, 400, corsHeaders);
  }

  const model = normalizeGeminiModel(payload.value.model, env.GEMINI_IMAGE_MODEL);
  if (!model) {
    return json(
      { error: "Choose a Gemini image model such as nano-banana, nano-banana-2, nano-banana-pro, or a gemini-* model id." },
      400,
      corsHeaders,
    );
  }

  const images = normalizeReferenceImages(payload.value);
  if (!images.ok) {
    return json({ error: images.error }, 400, corsHeaders);
  }

  const prompt = buildCharacterSpritesheetPrompt(payload.value.prompt, images.value.length);
  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...images.value.map((image) => ({
            inline_data: {
              mime_type: image.mimeType,
              data: image.data,
            },
          })),
        ],
      },
    ],
    generationConfig: buildGenerationConfig(payload.value, env),
  };

  const response = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    return json(
      {
        error: "Could not generate character spritesheet",
        status: response.status,
        details: getGeminiErrorMessage(body),
      },
      502,
      corsHeaders,
    );
  }

  const generated = getGeneratedImage(body);
  if (!generated) {
    return json(
      {
        error: "Gemini did not return an image",
        text: getGeminiText(body),
      },
      502,
      corsHeaders,
    );
  }

  return json(
    {
      model,
      prompt,
      image: {
        mimeType: generated.mimeType,
        data: generated.data,
        dataUrl: `data:${generated.mimeType};base64,${generated.data}`,
      },
      text: getGeminiText(body),
      usageMetadata: isRecord(body) ? body.usageMetadata : undefined,
    },
    200,
    {
      ...corsHeaders,
      "Cache-Control": "no-store",
    },
  );
}

function getCorsHeaders(allowedOrigin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

async function readGeneratePayload(request: Request): Promise<{ ok: true; value: GenerateCharacterRequest } | { ok: false; error: string }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, error: "Send generation requests as JSON." };
  }

  try {
    const value = (await request.json()) as unknown;
    return isRecord(value) ? { ok: true, value } : { ok: false, error: "Generation request must be a JSON object." };
  } catch {
    return { ok: false, error: "Could not read generation request JSON." };
  }
}

function buildCharacterSpritesheetPrompt(userPrompt: unknown, referenceImageCount: number) {
  const cleanedUserPrompt = typeof userPrompt === "string" ? userPrompt.trim() : "";
  const userDirection = cleanedUserPrompt
    ? `\nUser character brief to merge into the character design:\n${cleanedUserPrompt}\n`
    : "\nUser character brief: invent a playful original homemade fighter.\n";
  const referenceDirection =
    referenceImageCount > 0
      ? `\nUse the ${referenceImageCount} provided image${referenceImageCount === 1 ? "" : "s"} as visual reference only. Preserve useful user-provided details such as body shape, colors, outfit, sketch, or prop ideas, but transform them into an original cartoon cutout fighter. Do not copy protected characters, logos, visible text, or third-party branding from reference images.\n`
      : "";

  return `Create a single horizontal 5-cell spritesheet for an original cartoon cutout fighting-game character.

Canvas: 5:1 aspect ratio, PNG. Use a transparent background with alpha if possible; if transparency is unavailable, use a flat plain white background that can be cleanly removed. Each cell is an equal square frame. No labels, no text, no borders, no grid lines.

Character: an original playful homemade fighter, full body visible, bold readable silhouette, high-contrast colors, expressive face, simple clean shapes, camera-created cutout style, suitable for a 2D browser fighting game. Keep the exact same character design, outfit, colors, scale, and camera angle in every cell. Center the character in each cell with feet aligned near the bottom and leave safe padding around the body.
${userDirection}${referenceDirection}
Pose order from left to right:

1. idle stance
2. forward punch
3. forward kick
4. getting hit / recoil pose
5. victory pose

Format compatibility: make the final image easy to crop by splitting it into five equal vertical slices. Keep every limb, prop, and effect inside its own cell. Keep the feet on one shared baseline across all five cells.

Style: crisp game sprite, transparent cutout, charming DIY fighting-game energy, no copyrighted characters, no Nintendo or Photo Dojo references.`;
}

function normalizeGeminiModel(input: unknown, configuredModel?: string) {
  const raw = typeof input === "string" && input.trim() ? input.trim() : configuredModel?.trim() || DEFAULT_GEMINI_IMAGE_MODEL;
  const model = MODEL_ALIASES[raw] ?? raw;
  return /^gemini-[a-z0-9._-]+$/i.test(model) ? model : "";
}

function normalizeReferenceImages(
  payload: GenerateCharacterRequest,
): { ok: true; value: NormalizedReferenceImage[] } | { ok: false; error: string } {
  const rawImages = Array.isArray(payload.images) ? payload.images : payload.image ? [payload.image] : [];
  if (rawImages.length > MAX_REFERENCE_IMAGES) {
    return { ok: false, error: `Use ${MAX_REFERENCE_IMAGES} or fewer reference images.` };
  }

  const images: NormalizedReferenceImage[] = [];
  for (const rawImage of rawImages) {
    if (!isRecord(rawImage)) {
      return { ok: false, error: "Each reference image must be an object with mimeType and data." };
    }

    const normalized = normalizeReferenceImage(rawImage);
    if (!normalized.ok) {
      return normalized;
    }
    images.push(normalized.value);
  }

  return { ok: true, value: images };
}

function normalizeReferenceImage(image: ReferenceImageInput): { ok: true; value: NormalizedReferenceImage } | { ok: false; error: string } {
  const data = typeof image.data === "string" ? image.data.trim() : "";
  const dataUrlMatch = data.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i);
  const mimeType = (dataUrlMatch?.[1] || (typeof image.mimeType === "string" ? image.mimeType.trim() : "")).toLowerCase();
  const base64Data = (dataUrlMatch?.[2] || data).replace(/\s/g, "");

  if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)) {
    return { ok: false, error: "Reference images must be PNG, JPEG, or WebP." };
  }
  if (!base64Data || !/^[a-z0-9+/]+={0,2}$/i.test(base64Data)) {
    return { ok: false, error: "Reference image data must be base64." };
  }
  if (getBase64ByteLength(base64Data) > MAX_REFERENCE_IMAGE_BYTES) {
    return { ok: false, error: "Reference images must be 12 MB or smaller." };
  }

  return {
    ok: true,
    value: {
      mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
      data: base64Data,
    },
  };
}

function buildGenerationConfig(payload: GenerateCharacterRequest, env: Env) {
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["Image"],
  };

  const aspectRatio = getOptionalString(payload.aspectRatio) || env.GEMINI_IMAGE_ASPECT_RATIO?.trim();
  const imageSize = getOptionalString(payload.imageSize) || env.GEMINI_IMAGE_SIZE?.trim();
  if (aspectRatio || imageSize) {
    generationConfig.responseFormat = {
      image: {
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(imageSize ? { imageSize } : {}),
      },
    };
  }

  return generationConfig;
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getGeneratedImage(body: unknown): NormalizedReferenceImage | undefined {
  const part = getGeminiParts(body).find((candidatePart) => {
    if (!isRecord(candidatePart)) {
      return false;
    }
    return isRecord(candidatePart.inlineData) || isRecord(candidatePart.inline_data);
  });

  if (!isRecord(part)) {
    return undefined;
  }
  const inlineData = (isRecord(part.inlineData) ? part.inlineData : part.inline_data) as Record<string, unknown> | undefined;
  const data = typeof inlineData?.data === "string" ? inlineData.data : "";
  const mimeType = typeof inlineData?.mimeType === "string" ? inlineData.mimeType : typeof inlineData?.mime_type === "string" ? inlineData.mime_type : "image/png";
  return data ? { data, mimeType } : undefined;
}

function getGeminiText(body: unknown) {
  const text = getGeminiParts(body)
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n");

  return text || undefined;
}

function getGeminiParts(body: unknown): unknown[] {
  if (!isRecord(body) || !Array.isArray(body.candidates)) {
    return [];
  }

  return body.candidates.flatMap((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) {
      return [];
    }
    return candidate.content.parts;
  });
}

function getGeminiErrorMessage(body: unknown) {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return body.error.message;
  }
  return undefined;
}

function getBase64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
