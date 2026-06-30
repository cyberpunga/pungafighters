import { AppError } from "../i18n/errors";
import type { FighterPose, FighterSpriteId } from "../types/game";

type Env = Record<string, string | boolean | undefined>;

export interface CharacterGenerationReferenceImage {
  mimeType: string;
  data: string;
}

interface GenerateCharacterBaseInput {
  prompt: string;
  model?: string;
  images?: CharacterGenerationReferenceImage[];
}

export type GenerateCharacterInput =
  | (GenerateCharacterBaseInput & { mode?: "strip" })
  | (GenerateCharacterBaseInput & { mode: "pose"; pose: FighterPose })
  | (GenerateCharacterBaseInput & { mode: "sprite"; spriteId: FighterSpriteId });

export interface GeneratedCharacterImage {
  model: string;
  prompt: string;
  image: {
    mimeType: string;
    data: string;
    dataUrl: string;
  };
  text?: string;
}

export function getCharacterGenerationEndpoint() {
  const endpoint = getEnvString("VITE_CHARACTER_GENERATION_URL");
  if (!endpoint) {
    throw new AppError("error.generationEndpoint");
  }
  return endpoint;
}

export async function generateCharacterImage(input: GenerateCharacterInput): Promise<GeneratedCharacterImage> {
  const endpoint = getCharacterGenerationEndpoint();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      mode: input.mode ?? "strip",
      prompt: input.prompt,
      ...(input.model ? { model: input.model } : {}),
      ...(input.images?.length ? { images: input.images } : {}),
      ...(input.mode === "pose" ? { pose: input.pose } : {}),
      ...(input.mode === "sprite" ? { spriteId: input.spriteId } : {}),
    }),
  });

  const payload = (await response.json().catch(() => undefined)) as unknown;
  if (!response.ok) {
    throw new AppError("error.generationService");
  }

  if (!isGeneratedCharacterImage(payload)) {
    throw new AppError("error.generationInvalidResponse");
  }

  return payload;
}

export function generateCharacterSpritesheet(
  input: GenerateCharacterBaseInput & { mode?: "strip" },
): Promise<GeneratedCharacterImage> {
  return generateCharacterImage({ ...input, mode: "strip" });
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [metadata, data] = dataUrl.split(",", 2);
  const mimeType = metadata.match(/^data:([^;]+);base64$/)?.[1] ?? "image/png";
  const binary = atob(data ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], filename, { type: mimeType });
}

export function fileToReferenceImage(file: Blob & { name?: string }): Promise<CharacterGenerationReferenceImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result);
      resolve({
        mimeType: file.type || getMimeTypeFromName(file.name ?? "") || "image/png",
        data: dataUrl,
      });
    });
    reader.addEventListener("error", () => reject(new AppError("error.referenceImageRead")));
    reader.readAsDataURL(file);
  });
}

function isGeneratedCharacterImage(value: unknown): value is GeneratedCharacterImage {
  if (!isRecord(value) || typeof value.model !== "string" || !isRecord(value.image)) {
    return false;
  }
  return typeof value.prompt === "string" && typeof value.image.mimeType === "string" && typeof value.image.dataUrl === "string";
}

function getMimeTypeFromName(filename: string) {
  if (/\.jpe?g$/i.test(filename)) {
    return "image/jpeg";
  }
  if (/\.webp$/i.test(filename)) {
    return "image/webp";
  }
  if (/\.png$/i.test(filename)) {
    return "image/png";
  }
  return undefined;
}

function getEnvString(name: string): string | undefined {
  const value = getEnv()[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getEnv(): Env {
  return ((import.meta as ImportMeta & { env?: Env }).env ?? {}) as Env;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
