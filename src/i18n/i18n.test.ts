import { describe, expect, it } from "vitest";
import { AppError, localizeError, missingPoseImageError } from "./errors";
import { createTranslator, detectLocale, dictionaries, normalizeLocalePreference, resolveLocale, translate } from "./index";

describe("i18n", () => {
  it("detects supported browser languages", () => {
    expect(detectLocale(["es-CL", "en-US"])).toBe("es");
    expect(detectLocale(["fr-FR", "en-US"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("normalizes saved locale preferences", () => {
    expect(normalizeLocalePreference("auto")).toBe("auto");
    expect(normalizeLocalePreference("es")).toBe("es");
    expect(normalizeLocalePreference("pt")).toBe("auto");
    expect(normalizeLocalePreference(undefined)).toBe("auto");
  });

  it("resolves auto preferences through browser language", () => {
    expect(resolveLocale("auto", ["es-MX"])).toBe("es");
    expect(resolveLocale("en", ["es-MX"])).toBe("en");
  });

  it("interpolates values", () => {
    expect(translate("en", "battle.wins", { name: "Mint Guard" })).toBe("Mint Guard wins");
    expect(createTranslator("es")("battle.roundsWon", { count: 2 })).toBe("Rondas: 2");
  });

  it("localizes app errors by key", () => {
    expect(localizeError(new AppError("error.backgroundType"), createTranslator("es"))).toBe(
      "Elige una imagen de fondo PNG, JPEG o WebP.",
    );
  });

  it("localizes app error values", () => {
    expect(localizeError(missingPoseImageError("kick"), createTranslator("es"))).toBe("Falta la imagen de patada.");
  });

  it("keeps dictionary keys in parity", () => {
    const englishKeys = Object.keys(dictionaries.en).sort();
    expect(Object.keys(dictionaries.es).sort()).toEqual(englishKeys);
  });
});
