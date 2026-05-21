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
const FIGHTER_POSES = ["idle", "punch", "kick", "hit", "victory"] as const;

const MODEL_ALIASES: Record<string, string> = {
  "nano-banana": "gemini-2.5-flash-image",
  "nano-banana-2": "gemini-3.1-flash-image-preview",
  "nano-banana-pro": "gemini-3-pro-image-preview",
};

interface GenerateCharacterRequest {
  mode?: unknown;
  pose?: unknown;
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

type GenerationMode = "strip" | "pose";
type FighterPose = (typeof FIGHTER_POSES)[number];

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

  const mode = normalizeGenerationMode(payload.value.mode);
  if (!mode) {
    return json({ error: "Generation mode must be strip or pose." }, 400, corsHeaders);
  }
  const pose = mode === "pose" ? normalizeFighterPose(payload.value.pose) : undefined;
  if (mode === "pose" && !pose) {
    return json({ error: "Pose generation requires pose to be idle, punch, kick, hit, or victory." }, 400, corsHeaders);
  }

  const prompt =
    mode === "pose" && pose
      ? buildCharacterPosePrompt(payload.value.prompt, images.value.length, pose)
      : buildCharacterSpritesheetPrompt(payload.value.prompt, images.value.length);
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
    generationConfig: buildGenerationConfig(payload.value, env, mode),
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
  const hasReferenceImages = referenceImageCount > 0;

  const userDirection = cleanedUserPrompt
    ? `\nUser instructions:\n${cleanedUserPrompt}\n`
    : hasReferenceImages
      ? "\nUser instructions: keep the same character from the provided reference image(s).\n"
      : "\nUser instructions: invent an original fighter.\n";

  const referenceDirection = hasReferenceImages
    ? `\nReference image rule: the provided image${referenceImageCount === 1 ? " is" : "s are"} the character identity source of truth. Use the same character, not a redesigned or inspired version. Preserve the character's apparent identity, body type, face, hairstyle, skin tone, outfit, colors, proportions, medium, rendering style, texture, and lighting unless the user instructions explicitly request a change. Only change the pose in each spritesheet cell. Do not reinterpret, redesign, restyle, simplify, cartoonify, or invent a different fighter.\n`
    : "";

  const characterDirection = hasReferenceImages
    ? "Character: use the same character from the provided reference image(s)."
    : "Character: create an original fighter.";

  return `Create a single horizontal 5-cell spritesheet for a fighting-game character.

Canvas: 5:1 aspect ratio, PNG. Use a fully opaque solid chroma key green background (#00ff00) across the whole image. Do not use transparency, alpha, white, gradients, shadows, scenery, props, labels, text, borders, or grid lines in the background. Each cell is an equal square frame.

${characterDirection} Full body visible, readable silhouette, suitable for a 2D browser fighting game. Follow the user's requested visual style and medium without replacing it with a default house style. Keep the exact same character identity, design, outfit, colors, scale, medium, rendering style, lighting, and camera angle in every cell. Center the character in each cell with feet aligned near the bottom and leave safe padding around the body.
${userDirection}${referenceDirection}
Pose order from left to right:

1. idle stance
2. forward punch
3. forward kick
4. getting hit / recoil pose
5. victory pose

Format compatibility: make the final image easy to crop by splitting it into five equal vertical slices. Keep every limb, prop, and effect inside its own cell. Keep the feet on one shared baseline across all five cells.

Safety: keep the character original unless the user provided their own reference image. Do not include copyrighted characters, Nintendo references, Photo Dojo references, logos, brand marks, or readable text.`;
}

function buildCharacterPosePrompt(userPrompt: unknown, referenceImageCount: number, pose: FighterPose) {
  const cleanedUserPrompt = typeof userPrompt === "string" ? userPrompt.trim() : "";
  const hasReferenceImages = referenceImageCount > 0;
  const userDirection = cleanedUserPrompt
    ? `\nUser instructions:\n${cleanedUserPrompt}\n`
    : hasReferenceImages
      ? "\nUser instructions: keep the same character from the provided reference image(s).\n"
      : "\nUser instructions: invent an original fighter.\n";

  const referenceDirection = hasReferenceImages
    ? `\nReference image rule: the provided image${referenceImageCount === 1 ? " is" : "s are"} the character identity source of truth. Preserve the character's apparent identity, body type, face, hairstyle, skin tone, outfit, colors, proportions, medium, rendering style, texture, and lighting unless the user instructions explicitly request a change. Generate only the requested action pose.\n`
    : "";

  const characterDirection = hasReferenceImages
    ? "Character: use the same character from the provided reference image(s)."
    : "Character: create an original fighter.";

  return `Create one square action frame for a fighting-game character.

Canvas: 1:1 aspect ratio, PNG. Use a fully opaque solid chroma key green background (#00ff00). Do not use transparency, alpha, white, gradients, scenery, labels, text, borders, or grid lines in the background.

${characterDirection} Full body visible, readable silhouette, suitable for a 2D browser fighting game. Follow the user's requested visual style and medium without replacing it with a default house style. Center the character with feet aligned near the bottom and leave safe padding around the body.
${userDirection}${referenceDirection}
Action pose: ${getPosePromptDescription(pose)}.

Format compatibility: keep every limb, prop, and effect inside the square frame. Avoid motion blur or effects that make the cutout hard to read.

Safety: keep the character original unless the user provided their own reference image. Do not include copyrighted characters, Nintendo references, Photo Dojo references, logos, brand marks, or readable text.`;
}

function getPosePromptDescription(pose: FighterPose) {
  switch (pose) {
    case "idle":
      return "idle fighting stance";
    case "punch":
      return "forward punch";
    case "kick":
      return "forward kick";
    case "hit":
      return "getting hit / recoil pose";
    case "victory":
      return "victory pose";
  }
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

function buildGenerationConfig(payload: GenerateCharacterRequest, env: Env, mode: GenerationMode) {
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["Image"],
  };

  const aspectRatio = getOptionalString(payload.aspectRatio) || (mode === "pose" ? "1:1" : env.GEMINI_IMAGE_ASPECT_RATIO?.trim());
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

function normalizeGenerationMode(value: unknown): GenerationMode | "" {
  if (value === undefined || value === null || value === "") {
    return "strip";
  }
  return value === "strip" || value === "pose" ? value : "";
}

function normalizeFighterPose(value: unknown): FighterPose | "" {
  return typeof value === "string" && FIGHTER_POSES.includes(value as FighterPose) ? (value as FighterPose) : "";
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
