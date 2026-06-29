import {
  BATTLE_POST_EFFECTS,
  type BattlePostEffect,
  type BattlePostEffectConfigMap,
  type BattlePostEffectSettings,
} from "../../types/game";

export const DEFAULT_BATTLE_POST_EFFECT_CONFIGS = {
  pixel: {
    enabled: false,
    granularity: 5,
  },
  "bad-tv": {
    enabled: false,
    chromaticOffsetX: 0.0026,
    chromaticOffsetY: 0.0008,
    chromaticOpacity: 0.7,
    distortion: 3.3,
    distortion2: 1.4,
    speed: 8.5,
    rollSpeed: 0.018,
  },
  static: {
    enabled: false,
    amount: 0.32,
    size: 1.65,
  },
  "crt-soft": {
    enabled: false,
    hardScan: -10,
    hardPix: -2.6,
    warpX: 1 / 54,
    warpY: 1 / 42,
    maskDark: 0.68,
    maskLight: 1.22,
    scanlineDensity: 0.36,
    scanlineOpacity: 0.2,
  },
  "crt-strong": {
    enabled: false,
    hardScan: -16,
    hardPix: -3.2,
    warpX: 1 / 32,
    warpY: 1 / 24,
    maskDark: 0.52,
    maskLight: 1.46,
    scanlineDensity: 0.85,
    scanlineOpacity: 0.36,
    chromaticOffsetX: 0.0018,
    chromaticOffsetY: 0.0006,
    chromaticOpacity: 0.5,
    dotScale: 620,
    dotOpacity: 0.16,
  },
  lens: {
    enabled: false,
    focusRange: 0.86,
    bokehBase: 0.72,
    motionBoost: 1,
    hitBoost: 1.15,
    superBoost: 2.45,
    resolutionScale: 0.55,
    vignetteOffset: 0.2,
    vignetteDarkness: 0.54,
    vignetteOpacity: 0.34,
  },
} as const satisfies BattlePostEffectConfigMap;

export function createDefaultBattlePostEffectSettings(enabledEffects: BattlePostEffect[] = []): BattlePostEffectSettings {
  const enabled = new Set(enabledEffects);
  const order = mergeEffectOrder(enabledEffects);
  return {
    order,
    effects: {
      pixel: { ...DEFAULT_BATTLE_POST_EFFECT_CONFIGS.pixel, enabled: enabled.has("pixel") },
      "bad-tv": { ...DEFAULT_BATTLE_POST_EFFECT_CONFIGS["bad-tv"], enabled: enabled.has("bad-tv") },
      static: { ...DEFAULT_BATTLE_POST_EFFECT_CONFIGS.static, enabled: enabled.has("static") },
      "crt-soft": { ...DEFAULT_BATTLE_POST_EFFECT_CONFIGS["crt-soft"], enabled: enabled.has("crt-soft") },
      "crt-strong": { ...DEFAULT_BATTLE_POST_EFFECT_CONFIGS["crt-strong"], enabled: enabled.has("crt-strong") },
      lens: { ...DEFAULT_BATTLE_POST_EFFECT_CONFIGS.lens, enabled: enabled.has("lens") },
    },
  };
}

export function getEnabledBattlePostEffects(settings: BattlePostEffectSettings): BattlePostEffect[] {
  return mergeEffectOrder(settings.order).filter((effect) => settings.effects[effect].enabled);
}

export function normalizeBattlePostEffectSettings(value: unknown): BattlePostEffectSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const base = createDefaultBattlePostEffectSettings();
  const effectsValue = isRecord(value.effects) ? value.effects : {};
  const orderValue = Array.isArray(value.order) ? value.order : [];
  const order = mergeEffectOrder(orderValue.filter(isBattlePostEffect));

  return {
    order,
    effects: {
      pixel: {
        enabled: readBoolean(effectsValue.pixel, base.effects.pixel.enabled),
        granularity: readNumber(effectsValue.pixel, "granularity", base.effects.pixel.granularity),
      },
      "bad-tv": {
        enabled: readBoolean(effectsValue["bad-tv"], base.effects["bad-tv"].enabled),
        chromaticOffsetX: readNumber(effectsValue["bad-tv"], "chromaticOffsetX", base.effects["bad-tv"].chromaticOffsetX),
        chromaticOffsetY: readNumber(effectsValue["bad-tv"], "chromaticOffsetY", base.effects["bad-tv"].chromaticOffsetY),
        chromaticOpacity: readNumber(effectsValue["bad-tv"], "chromaticOpacity", base.effects["bad-tv"].chromaticOpacity),
        distortion: readNumber(effectsValue["bad-tv"], "distortion", base.effects["bad-tv"].distortion),
        distortion2: readNumber(effectsValue["bad-tv"], "distortion2", base.effects["bad-tv"].distortion2),
        speed: readNumber(effectsValue["bad-tv"], "speed", base.effects["bad-tv"].speed),
        rollSpeed: readNumber(effectsValue["bad-tv"], "rollSpeed", base.effects["bad-tv"].rollSpeed),
      },
      static: {
        enabled: readBoolean(effectsValue.static, base.effects.static.enabled),
        amount: readNumber(effectsValue.static, "amount", base.effects.static.amount),
        size: readNumber(effectsValue.static, "size", base.effects.static.size),
      },
      "crt-soft": {
        enabled: readBoolean(effectsValue["crt-soft"], base.effects["crt-soft"].enabled),
        hardScan: readNumber(effectsValue["crt-soft"], "hardScan", base.effects["crt-soft"].hardScan),
        hardPix: readNumber(effectsValue["crt-soft"], "hardPix", base.effects["crt-soft"].hardPix),
        warpX: readNumber(effectsValue["crt-soft"], "warpX", base.effects["crt-soft"].warpX),
        warpY: readNumber(effectsValue["crt-soft"], "warpY", base.effects["crt-soft"].warpY),
        maskDark: readNumber(effectsValue["crt-soft"], "maskDark", base.effects["crt-soft"].maskDark),
        maskLight: readNumber(effectsValue["crt-soft"], "maskLight", base.effects["crt-soft"].maskLight),
        scanlineDensity: readNumber(effectsValue["crt-soft"], "scanlineDensity", base.effects["crt-soft"].scanlineDensity),
        scanlineOpacity: readNumber(effectsValue["crt-soft"], "scanlineOpacity", base.effects["crt-soft"].scanlineOpacity),
      },
      "crt-strong": {
        enabled: readBoolean(effectsValue["crt-strong"], base.effects["crt-strong"].enabled),
        hardScan: readNumber(effectsValue["crt-strong"], "hardScan", base.effects["crt-strong"].hardScan),
        hardPix: readNumber(effectsValue["crt-strong"], "hardPix", base.effects["crt-strong"].hardPix),
        warpX: readNumber(effectsValue["crt-strong"], "warpX", base.effects["crt-strong"].warpX),
        warpY: readNumber(effectsValue["crt-strong"], "warpY", base.effects["crt-strong"].warpY),
        maskDark: readNumber(effectsValue["crt-strong"], "maskDark", base.effects["crt-strong"].maskDark),
        maskLight: readNumber(effectsValue["crt-strong"], "maskLight", base.effects["crt-strong"].maskLight),
        scanlineDensity: readNumber(effectsValue["crt-strong"], "scanlineDensity", base.effects["crt-strong"].scanlineDensity),
        scanlineOpacity: readNumber(effectsValue["crt-strong"], "scanlineOpacity", base.effects["crt-strong"].scanlineOpacity),
        chromaticOffsetX: readNumber(effectsValue["crt-strong"], "chromaticOffsetX", base.effects["crt-strong"].chromaticOffsetX),
        chromaticOffsetY: readNumber(effectsValue["crt-strong"], "chromaticOffsetY", base.effects["crt-strong"].chromaticOffsetY),
        chromaticOpacity: readNumber(effectsValue["crt-strong"], "chromaticOpacity", base.effects["crt-strong"].chromaticOpacity),
        dotScale: readNumber(effectsValue["crt-strong"], "dotScale", base.effects["crt-strong"].dotScale),
        dotOpacity: readNumber(effectsValue["crt-strong"], "dotOpacity", base.effects["crt-strong"].dotOpacity),
      },
      lens: {
        enabled: readBoolean(effectsValue.lens, base.effects.lens.enabled),
        focusRange: readNumber(effectsValue.lens, "focusRange", base.effects.lens.focusRange),
        bokehBase: readNumber(effectsValue.lens, "bokehBase", base.effects.lens.bokehBase),
        motionBoost: readNumber(effectsValue.lens, "motionBoost", base.effects.lens.motionBoost),
        hitBoost: readNumber(effectsValue.lens, "hitBoost", base.effects.lens.hitBoost),
        superBoost: readNumber(effectsValue.lens, "superBoost", base.effects.lens.superBoost),
        resolutionScale: readNumber(effectsValue.lens, "resolutionScale", base.effects.lens.resolutionScale),
        vignetteOffset: readNumber(effectsValue.lens, "vignetteOffset", base.effects.lens.vignetteOffset),
        vignetteDarkness: readNumber(effectsValue.lens, "vignetteDarkness", base.effects.lens.vignetteDarkness),
        vignetteOpacity: readNumber(effectsValue.lens, "vignetteOpacity", base.effects.lens.vignetteOpacity),
      },
    },
  };
}

function mergeEffectOrder(order: BattlePostEffect[]): BattlePostEffect[] {
  return [...new Set([...order, ...BATTLE_POST_EFFECTS])];
}

function isBattlePostEffect(value: unknown): value is BattlePostEffect {
  return typeof value === "string" && BATTLE_POST_EFFECTS.includes(value as BattlePostEffect);
}

function readBoolean(value: unknown, fallback: boolean) {
  return isRecord(value) && typeof value.enabled === "boolean" ? value.enabled : fallback;
}

function readNumber(value: unknown, key: string, fallback: number) {
  if (!isRecord(value)) {
    return fallback;
  }
  const next = value[key];
  return typeof next === "number" && Number.isFinite(next) ? next : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
