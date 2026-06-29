import { button, folder, LevaPanel, useControls, useCreateStore } from "leva";
import { useEffect, useRef, useState } from "react";
import { getEnabledBattlePostEffects } from "../game/render/postEffectSettings";
import { type LocalePreference, type MessageKey } from "../i18n";
import { useI18n } from "../i18n/react";
import { BATTLE_POST_EFFECTS, type BattlePostEffect, type BattlePostEffectConfigMap, type BattlePostEffectSettings } from "../types/game";

const EFFECT_LABEL_KEYS = {
  pixel: "effects.pixel",
  "bad-tv": "effects.bad-tv",
  static: "effects.static",
  "crt-soft": "effects.crt-soft",
  "crt-strong": "effects.crt-strong",
  lens: "effects.lens",
} as const satisfies Record<BattlePostEffect, MessageKey>;

const EFFECT_SET = new Set<BattlePostEffect>(BATTLE_POST_EFFECTS);

type LevaOnChangeContext = {
  initial: boolean;
};

type LevaFolderControls = Parameters<typeof folder>[0];
type LevaSetValues = Record<string, boolean | number | string>;

const EFFECT_CONTROL_KEYS = {
  pixel: {
    enabled: "pixelEnabled",
    granularity: "pixelGranularity",
  },
  "bad-tv": {
    enabled: "badTvEnabled",
    chromaticOffsetX: "badTvChromaticOffsetX",
    chromaticOffsetY: "badTvChromaticOffsetY",
    chromaticOpacity: "badTvChromaticOpacity",
    distortion: "badTvDistortion",
    distortion2: "badTvDistortion2",
    speed: "badTvSpeed",
    rollSpeed: "badTvRollSpeed",
  },
  static: {
    enabled: "staticEnabled",
    amount: "staticAmount",
    size: "staticSize",
  },
  "crt-soft": {
    enabled: "crtSoftEnabled",
    hardScan: "crtSoftHardScan",
    hardPix: "crtSoftHardPix",
    warpX: "crtSoftWarpX",
    warpY: "crtSoftWarpY",
    maskDark: "crtSoftMaskDark",
    maskLight: "crtSoftMaskLight",
    scanlineDensity: "crtSoftScanlineDensity",
    scanlineOpacity: "crtSoftScanlineOpacity",
  },
  "crt-strong": {
    enabled: "crtStrongEnabled",
    hardScan: "crtStrongHardScan",
    hardPix: "crtStrongHardPix",
    warpX: "crtStrongWarpX",
    warpY: "crtStrongWarpY",
    maskDark: "crtStrongMaskDark",
    maskLight: "crtStrongMaskLight",
    scanlineDensity: "crtStrongScanlineDensity",
    scanlineOpacity: "crtStrongScanlineOpacity",
    chromaticOffsetX: "crtStrongChromaticOffsetX",
    chromaticOffsetY: "crtStrongChromaticOffsetY",
    chromaticOpacity: "crtStrongChromaticOpacity",
    dotScale: "crtStrongDotScale",
    dotOpacity: "crtStrongDotOpacity",
  },
  lens: {
    enabled: "lensEnabled",
    focusRange: "lensFocusRange",
    bokehBase: "lensBokehBase",
    motionBoost: "lensMotionBoost",
    hitBoost: "lensHitBoost",
    superBoost: "lensSuperBoost",
    resolutionScale: "lensResolutionScale",
    vignetteOffset: "lensVignetteOffset",
    vignetteDarkness: "lensVignetteDarkness",
    vignetteOpacity: "lensVignetteOpacity",
  },
} as const;

export function AppSettingsPanel(props: {
  battlePostEffectSettings: BattlePostEffectSettings;
  onBattlePostEffectSettingsChange: (settings: BattlePostEffectSettings) => void;
}) {
  const { preference, setPreference, t } = useI18n();
  const settingsStore = useCreateStore();
  const [settingsCollapsed, setSettingsCollapsed] = useState(true);
  const settingsRef = useRef(props.battlePostEffectSettings);
  const syncingLevaRef = useRef(false);
  const settings = props.battlePostEffectSettings;

  useEffect(() => {
    settingsRef.current = props.battlePostEffectSettings;
  }, [props.battlePostEffectSettings]);

  const updateSettings = (next: BattlePostEffectSettings) => {
    settingsRef.current = next;
    props.onBattlePostEffectSettingsChange(next);
  };
  const updateFromLeva = (context: LevaOnChangeContext, createNext: (current: BattlePostEffectSettings) => BattlePostEffectSettings) => {
    if (!context.initial && !syncingLevaRef.current) {
      updateSettings(createNext(settingsRef.current));
    }
  };
  const effectFolder = <Effect extends BattlePostEffect>(
    effect: Effect,
    enabledKey: string,
    controls: LevaFolderControls,
  ) =>
    folder(
      {
        [enabledKey]: {
          label: t("effects.enabled"),
          value: settings.effects[effect].enabled,
          transient: false as const,
          onChange: (enabled: boolean, _path: string, context: LevaOnChangeContext) => {
            updateFromLeva(context, (current) => setEffectEnabled(current, effect, enabled));
          },
        },
        ...controls,
      },
      { collapsed: !settings.effects[effect].enabled },
    );
  const slider = <Effect extends BattlePostEffect, Key extends keyof BattlePostEffectConfigMap[Effect]>(
    effect: Effect,
    key: Key,
    label: MessageKey,
    min: number,
    max: number,
    step: number,
  ) => ({
    label: t(label),
    value: settings.effects[effect][key],
    min,
    max,
    step,
    transient: false as const,
    onChange: (value: number, _path: string, context: LevaOnChangeContext) => {
      updateFromLeva(context, (current) => setEffectValue(current, effect, key, value));
    },
  });

  const [, setLevaValues] = useControls(
    () => ({
      language: {
        label: t("settings.language"),
        value: preference,
        options: {
          [t("common.auto")]: "auto",
          [t("common.english")]: "en",
          [t("common.espanol")]: "es",
        },
        transient: false,
        onChange: (next: LocalePreference, _path: string, context: LevaOnChangeContext) => {
          if (!context.initial) {
            setPreference(next);
          }
        },
      },
      [t("settings.battleDisplay")]: folder(
        {
          clean: {
            ...button(() => {
              updateSettings(disableAllEffects(settingsRef.current));
            }),
            label: t("effects.clean"),
          },
          effectOrder: {
            label: t("effects.battleDisplayEffectOrder"),
            value: getEnabledBattlePostEffects(settings).join(", "),
            transient: false,
            onChange: (value: string, _path: string, context: LevaOnChangeContext) => {
              updateFromLeva(context, (current) => setEffectOrder(current, value));
            },
          },
          [t(EFFECT_LABEL_KEYS.pixel)]: effectFolder("pixel", EFFECT_CONTROL_KEYS.pixel.enabled, {
            [EFFECT_CONTROL_KEYS.pixel.granularity]: slider("pixel", "granularity", "effects.pixelGranularity", 1, 16, 1),
          }),
          [t(EFFECT_LABEL_KEYS["bad-tv"])]: effectFolder("bad-tv", EFFECT_CONTROL_KEYS["bad-tv"].enabled, {
            [EFFECT_CONTROL_KEYS["bad-tv"].chromaticOffsetX]: slider("bad-tv", "chromaticOffsetX", "effects.chromaticOffsetX", 0, 0.02, 0.0001),
            [EFFECT_CONTROL_KEYS["bad-tv"].chromaticOffsetY]: slider("bad-tv", "chromaticOffsetY", "effects.chromaticOffsetY", 0, 0.02, 0.0001),
            [EFFECT_CONTROL_KEYS["bad-tv"].chromaticOpacity]: slider("bad-tv", "chromaticOpacity", "effects.chromaticOpacity", 0, 1, 0.01),
            [EFFECT_CONTROL_KEYS["bad-tv"].distortion]: slider("bad-tv", "distortion", "effects.badTvDistortion", 0, 8, 0.1),
            [EFFECT_CONTROL_KEYS["bad-tv"].distortion2]: slider("bad-tv", "distortion2", "effects.badTvFineDistortion", 0, 5, 0.1),
            [EFFECT_CONTROL_KEYS["bad-tv"].speed]: slider("bad-tv", "speed", "effects.badTvSpeed", 0, 20, 0.1),
            [EFFECT_CONTROL_KEYS["bad-tv"].rollSpeed]: slider("bad-tv", "rollSpeed", "effects.badTvRoll", 0, 0.08, 0.001),
          }),
          [t(EFFECT_LABEL_KEYS.static)]: effectFolder("static", EFFECT_CONTROL_KEYS.static.enabled, {
            [EFFECT_CONTROL_KEYS.static.amount]: slider("static", "amount", "effects.staticAmount", 0, 1, 0.01),
            [EFFECT_CONTROL_KEYS.static.size]: slider("static", "size", "effects.staticSize", 0.1, 8, 0.05),
          }),
          [t(EFFECT_LABEL_KEYS["crt-soft"])]: effectFolder("crt-soft", EFFECT_CONTROL_KEYS["crt-soft"].enabled, {
            [EFFECT_CONTROL_KEYS["crt-soft"].hardScan]: slider("crt-soft", "hardScan", "effects.crtScanSharpness", -30, -1, 0.1),
            [EFFECT_CONTROL_KEYS["crt-soft"].hardPix]: slider("crt-soft", "hardPix", "effects.crtPixelSharpness", -8, -0.5, 0.1),
            [EFFECT_CONTROL_KEYS["crt-soft"].warpX]: slider("crt-soft", "warpX", "effects.crtWarpX", 0, 0.08, 0.001),
            [EFFECT_CONTROL_KEYS["crt-soft"].warpY]: slider("crt-soft", "warpY", "effects.crtWarpY", 0, 0.08, 0.001),
            [EFFECT_CONTROL_KEYS["crt-soft"].maskDark]: slider("crt-soft", "maskDark", "effects.crtMaskDark", 0, 1, 0.01),
            [EFFECT_CONTROL_KEYS["crt-soft"].maskLight]: slider("crt-soft", "maskLight", "effects.crtMaskLight", 0.5, 2, 0.01),
            [EFFECT_CONTROL_KEYS["crt-soft"].scanlineDensity]: slider("crt-soft", "scanlineDensity", "effects.scanlineDensity", 0, 1.5, 0.01),
            [EFFECT_CONTROL_KEYS["crt-soft"].scanlineOpacity]: slider("crt-soft", "scanlineOpacity", "effects.scanlineOpacity", 0, 1, 0.01),
          }),
          [t(EFFECT_LABEL_KEYS["crt-strong"])]: effectFolder("crt-strong", EFFECT_CONTROL_KEYS["crt-strong"].enabled, {
            [EFFECT_CONTROL_KEYS["crt-strong"].hardScan]: slider("crt-strong", "hardScan", "effects.crtScanSharpness", -30, -1, 0.1),
            [EFFECT_CONTROL_KEYS["crt-strong"].hardPix]: slider("crt-strong", "hardPix", "effects.crtPixelSharpness", -8, -0.5, 0.1),
            [EFFECT_CONTROL_KEYS["crt-strong"].warpX]: slider("crt-strong", "warpX", "effects.crtWarpX", 0, 0.08, 0.001),
            [EFFECT_CONTROL_KEYS["crt-strong"].warpY]: slider("crt-strong", "warpY", "effects.crtWarpY", 0, 0.08, 0.001),
            [EFFECT_CONTROL_KEYS["crt-strong"].maskDark]: slider("crt-strong", "maskDark", "effects.crtMaskDark", 0, 1, 0.01),
            [EFFECT_CONTROL_KEYS["crt-strong"].maskLight]: slider("crt-strong", "maskLight", "effects.crtMaskLight", 0.5, 2, 0.01),
            [EFFECT_CONTROL_KEYS["crt-strong"].scanlineDensity]: slider("crt-strong", "scanlineDensity", "effects.scanlineDensity", 0, 1.5, 0.01),
            [EFFECT_CONTROL_KEYS["crt-strong"].scanlineOpacity]: slider("crt-strong", "scanlineOpacity", "effects.scanlineOpacity", 0, 1, 0.01),
            [EFFECT_CONTROL_KEYS["crt-strong"].chromaticOffsetX]: slider("crt-strong", "chromaticOffsetX", "effects.chromaticOffsetX", 0, 0.02, 0.0001),
            [EFFECT_CONTROL_KEYS["crt-strong"].chromaticOffsetY]: slider("crt-strong", "chromaticOffsetY", "effects.chromaticOffsetY", 0, 0.02, 0.0001),
            [EFFECT_CONTROL_KEYS["crt-strong"].chromaticOpacity]: slider("crt-strong", "chromaticOpacity", "effects.chromaticOpacity", 0, 1, 0.01),
            [EFFECT_CONTROL_KEYS["crt-strong"].dotScale]: slider("crt-strong", "dotScale", "effects.dotScale", 100, 1200, 10),
            [EFFECT_CONTROL_KEYS["crt-strong"].dotOpacity]: slider("crt-strong", "dotOpacity", "effects.dotOpacity", 0, 0.5, 0.01),
          }),
          [t(EFFECT_LABEL_KEYS.lens)]: effectFolder("lens", EFFECT_CONTROL_KEYS.lens.enabled, {
            [EFFECT_CONTROL_KEYS.lens.focusRange]: slider("lens", "focusRange", "effects.lensFocusRange", 0.05, 2, 0.01),
            [EFFECT_CONTROL_KEYS.lens.bokehBase]: slider("lens", "bokehBase", "effects.lensBokehBase", 0, 3, 0.01),
            [EFFECT_CONTROL_KEYS.lens.motionBoost]: slider("lens", "motionBoost", "effects.lensMotionBoost", 0, 3, 0.01),
            [EFFECT_CONTROL_KEYS.lens.hitBoost]: slider("lens", "hitBoost", "effects.lensHitBoost", 0, 4, 0.01),
            [EFFECT_CONTROL_KEYS.lens.superBoost]: slider("lens", "superBoost", "effects.lensSuperBoost", 0, 6, 0.01),
            [EFFECT_CONTROL_KEYS.lens.resolutionScale]: slider("lens", "resolutionScale", "effects.lensResolutionScale", 0.2, 1, 0.01),
            [EFFECT_CONTROL_KEYS.lens.vignetteOffset]: slider("lens", "vignetteOffset", "effects.vignetteOffset", 0, 1, 0.01),
            [EFFECT_CONTROL_KEYS.lens.vignetteDarkness]: slider("lens", "vignetteDarkness", "effects.vignetteDarkness", 0, 1, 0.01),
            [EFFECT_CONTROL_KEYS.lens.vignetteOpacity]: slider("lens", "vignetteOpacity", "effects.vignetteOpacity", 0, 1, 0.01),
          }),
        },
        { collapsed: false },
      ),
    }),
    { store: settingsStore },
    [preference, props.battlePostEffectSettings, props.onBattlePostEffectSettingsChange, setPreference, settingsStore, t],
  );

  useEffect(() => {
    syncingLevaRef.current = true;
    setLevaValues(settingsToLevaValues(props.battlePostEffectSettings) as unknown as Parameters<typeof setLevaValues>[0]);
    const syncReset = window.setTimeout(() => {
      syncingLevaRef.current = false;
    }, 0);
    return () => {
      window.clearTimeout(syncReset);
      syncingLevaRef.current = false;
    };
  }, [props.battlePostEffectSettings, setLevaValues]);

  return (
    <LevaPanel
      collapsed={{ collapsed: settingsCollapsed, onChange: setSettingsCollapsed }}
      hideCopyButton
      oneLineLabels
      store={settingsStore}
      titleBar={{ title: t("settings.title"), filter: false }}
    />
  );
}

function setEffectEnabled(settings: BattlePostEffectSettings, effect: BattlePostEffect, enabled: boolean): BattlePostEffectSettings {
  return {
    ...settings,
    order: enabled && !settings.order.includes(effect) ? [...settings.order, effect] : settings.order,
    effects: {
      ...settings.effects,
      [effect]: { ...settings.effects[effect], enabled },
    },
  };
}

function setEffectValue<Effect extends BattlePostEffect, Key extends keyof BattlePostEffectConfigMap[Effect]>(
  settings: BattlePostEffectSettings,
  effect: Effect,
  key: Key,
  value: number,
): BattlePostEffectSettings {
  return {
    ...settings,
    effects: {
      ...settings.effects,
      [effect]: { ...settings.effects[effect], [key]: value },
    },
  };
}

function setEffectOrder(settings: BattlePostEffectSettings, value: string): BattlePostEffectSettings {
  const parsed = parseEffectOrder(value);
  if (!parsed) {
    return settings;
  }
  const enabled = new Set(parsed);
  return {
    ...settings,
    order: [...parsed, ...settings.order.filter((effect) => !enabled.has(effect))],
    effects: Object.fromEntries(
      BATTLE_POST_EFFECTS.map((effect) => [effect, { ...settings.effects[effect], enabled: enabled.has(effect) }]),
    ) as unknown as BattlePostEffectConfigMap,
  };
}

function disableAllEffects(settings: BattlePostEffectSettings): BattlePostEffectSettings {
  return {
    ...settings,
    effects: Object.fromEntries(
      BATTLE_POST_EFFECTS.map((effect) => [effect, { ...settings.effects[effect], enabled: false }]),
    ) as unknown as BattlePostEffectConfigMap,
  };
}

function settingsToLevaValues(settings: BattlePostEffectSettings): LevaSetValues {
  return {
    effectOrder: getEnabledBattlePostEffects(settings).join(", "),
    [EFFECT_CONTROL_KEYS.pixel.enabled]: settings.effects.pixel.enabled,
    [EFFECT_CONTROL_KEYS.pixel.granularity]: settings.effects.pixel.granularity,
    [EFFECT_CONTROL_KEYS["bad-tv"].enabled]: settings.effects["bad-tv"].enabled,
    [EFFECT_CONTROL_KEYS["bad-tv"].chromaticOffsetX]: settings.effects["bad-tv"].chromaticOffsetX,
    [EFFECT_CONTROL_KEYS["bad-tv"].chromaticOffsetY]: settings.effects["bad-tv"].chromaticOffsetY,
    [EFFECT_CONTROL_KEYS["bad-tv"].chromaticOpacity]: settings.effects["bad-tv"].chromaticOpacity,
    [EFFECT_CONTROL_KEYS["bad-tv"].distortion]: settings.effects["bad-tv"].distortion,
    [EFFECT_CONTROL_KEYS["bad-tv"].distortion2]: settings.effects["bad-tv"].distortion2,
    [EFFECT_CONTROL_KEYS["bad-tv"].speed]: settings.effects["bad-tv"].speed,
    [EFFECT_CONTROL_KEYS["bad-tv"].rollSpeed]: settings.effects["bad-tv"].rollSpeed,
    [EFFECT_CONTROL_KEYS.static.enabled]: settings.effects.static.enabled,
    [EFFECT_CONTROL_KEYS.static.amount]: settings.effects.static.amount,
    [EFFECT_CONTROL_KEYS.static.size]: settings.effects.static.size,
    [EFFECT_CONTROL_KEYS["crt-soft"].enabled]: settings.effects["crt-soft"].enabled,
    [EFFECT_CONTROL_KEYS["crt-soft"].hardScan]: settings.effects["crt-soft"].hardScan,
    [EFFECT_CONTROL_KEYS["crt-soft"].hardPix]: settings.effects["crt-soft"].hardPix,
    [EFFECT_CONTROL_KEYS["crt-soft"].warpX]: settings.effects["crt-soft"].warpX,
    [EFFECT_CONTROL_KEYS["crt-soft"].warpY]: settings.effects["crt-soft"].warpY,
    [EFFECT_CONTROL_KEYS["crt-soft"].maskDark]: settings.effects["crt-soft"].maskDark,
    [EFFECT_CONTROL_KEYS["crt-soft"].maskLight]: settings.effects["crt-soft"].maskLight,
    [EFFECT_CONTROL_KEYS["crt-soft"].scanlineDensity]: settings.effects["crt-soft"].scanlineDensity,
    [EFFECT_CONTROL_KEYS["crt-soft"].scanlineOpacity]: settings.effects["crt-soft"].scanlineOpacity,
    [EFFECT_CONTROL_KEYS["crt-strong"].enabled]: settings.effects["crt-strong"].enabled,
    [EFFECT_CONTROL_KEYS["crt-strong"].hardScan]: settings.effects["crt-strong"].hardScan,
    [EFFECT_CONTROL_KEYS["crt-strong"].hardPix]: settings.effects["crt-strong"].hardPix,
    [EFFECT_CONTROL_KEYS["crt-strong"].warpX]: settings.effects["crt-strong"].warpX,
    [EFFECT_CONTROL_KEYS["crt-strong"].warpY]: settings.effects["crt-strong"].warpY,
    [EFFECT_CONTROL_KEYS["crt-strong"].maskDark]: settings.effects["crt-strong"].maskDark,
    [EFFECT_CONTROL_KEYS["crt-strong"].maskLight]: settings.effects["crt-strong"].maskLight,
    [EFFECT_CONTROL_KEYS["crt-strong"].scanlineDensity]: settings.effects["crt-strong"].scanlineDensity,
    [EFFECT_CONTROL_KEYS["crt-strong"].scanlineOpacity]: settings.effects["crt-strong"].scanlineOpacity,
    [EFFECT_CONTROL_KEYS["crt-strong"].chromaticOffsetX]: settings.effects["crt-strong"].chromaticOffsetX,
    [EFFECT_CONTROL_KEYS["crt-strong"].chromaticOffsetY]: settings.effects["crt-strong"].chromaticOffsetY,
    [EFFECT_CONTROL_KEYS["crt-strong"].chromaticOpacity]: settings.effects["crt-strong"].chromaticOpacity,
    [EFFECT_CONTROL_KEYS["crt-strong"].dotScale]: settings.effects["crt-strong"].dotScale,
    [EFFECT_CONTROL_KEYS["crt-strong"].dotOpacity]: settings.effects["crt-strong"].dotOpacity,
    [EFFECT_CONTROL_KEYS.lens.enabled]: settings.effects.lens.enabled,
    [EFFECT_CONTROL_KEYS.lens.focusRange]: settings.effects.lens.focusRange,
    [EFFECT_CONTROL_KEYS.lens.bokehBase]: settings.effects.lens.bokehBase,
    [EFFECT_CONTROL_KEYS.lens.motionBoost]: settings.effects.lens.motionBoost,
    [EFFECT_CONTROL_KEYS.lens.hitBoost]: settings.effects.lens.hitBoost,
    [EFFECT_CONTROL_KEYS.lens.superBoost]: settings.effects.lens.superBoost,
    [EFFECT_CONTROL_KEYS.lens.resolutionScale]: settings.effects.lens.resolutionScale,
    [EFFECT_CONTROL_KEYS.lens.vignetteOffset]: settings.effects.lens.vignetteOffset,
    [EFFECT_CONTROL_KEYS.lens.vignetteDarkness]: settings.effects.lens.vignetteDarkness,
    [EFFECT_CONTROL_KEYS.lens.vignetteOpacity]: settings.effects.lens.vignetteOpacity,
  };
}

function parseEffectOrder(value: string): BattlePostEffect[] | undefined {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  const uniqueEffects = new Set<BattlePostEffect>();
  for (const token of tokens) {
    if (!EFFECT_SET.has(token as BattlePostEffect)) {
      return undefined;
    }
    uniqueEffects.add(token as BattlePostEffect);
  }
  return [...uniqueEffects];
}
