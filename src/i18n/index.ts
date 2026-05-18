import { dictionaries, en, type MessageKey } from "./messages";
import type { FighterPose, VoiceClipType } from "../types/game";

export type Locale = keyof typeof dictionaries;
export type LocalePreference = Locale | "auto";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_SETTING_KEY = "ui.locale";
export const LOCALES = Object.keys(dictionaries) as Locale[];

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function detectLocale(languages: readonly string[] | undefined): Locale {
  for (const language of languages ?? []) {
    const normalized = normalizeLanguageTag(language);
    if (isLocale(normalized)) {
      return normalized;
    }
  }
  return DEFAULT_LOCALE;
}

export function resolveLocale(preference: LocalePreference, languages: readonly string[] | undefined): Locale {
  return preference === "auto" ? detectLocale(languages) : preference;
}

export function normalizeLocalePreference(value: unknown): LocalePreference {
  return value === "auto" || isLocale(value) ? value : "auto";
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale);
}

export function createTranslator(locale: Locale): Translate {
  return (key, values) => translate(locale, key, values);
}

export function translate(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  const template = dictionaries[locale][key] ?? en[key] ?? key;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (values[name] === undefined ? match : String(values[name])));
}

export function poseLabel(t: Translate, pose: FighterPose): string {
  return t(`pose.${pose}` as MessageKey);
}

export function voiceClipLabel(t: Translate, clip: VoiceClipType): string {
  return t(`voice.${clip}` as MessageKey);
}

function normalizeLanguageTag(language: string): string {
  return language.trim().toLowerCase().split("-")[0] ?? "";
}

export { dictionaries };
export type { MessageKey };
