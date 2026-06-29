import { button, folder, LevaPanel, useControls, useCreateStore } from "leva";
import { useEffect, useRef, useState } from "react";
import { BATTLE_POST_EFFECTS, type BattlePostEffect } from "../types/game";
import type { LocalePreference, MessageKey } from "../i18n";
import { useI18n } from "../i18n/react";

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

export function AppSettingsPanel(props: {
  battlePostEffects: BattlePostEffect[];
  onBattlePostEffectsChange: (effects: BattlePostEffect[]) => void;
}) {
  const { preference, setPreference, t } = useI18n();
  const settingsStore = useCreateStore();
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const effectsRef = useRef(props.battlePostEffects);

  useEffect(() => {
    effectsRef.current = props.battlePostEffects;
  }, [props.battlePostEffects]);

  useControls(
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
              effectsRef.current = [];
              props.onBattlePostEffectsChange([]);
            }),
            label: t("effects.clean"),
          },
          ...Object.fromEntries(
            BATTLE_POST_EFFECTS.map((effect) => [
              effect,
              {
                label: t(EFFECT_LABEL_KEYS[effect]),
                value: props.battlePostEffects.includes(effect),
                transient: false,
                onChange: (enabled: boolean, _path: string, context: LevaOnChangeContext) => {
                  if (context.initial) {
                    return;
                  }
                  const next = togglePostEffect(effectsRef.current, effect, enabled);
                  effectsRef.current = next;
                  props.onBattlePostEffectsChange(next);
                },
              },
            ]),
          ),
          effectOrder: {
            label: t("effects.battleDisplayEffectOrder"),
            value: props.battlePostEffects.join(", "),
            transient: false,
            onChange: (value: string, _path: string, context: LevaOnChangeContext) => {
              if (context.initial) {
                return;
              }
              const parsed = parseEffectOrder(value);
              if (parsed) {
                effectsRef.current = parsed;
                props.onBattlePostEffectsChange(parsed);
              }
            },
          },
        },
        { collapsed: false },
      ),
    }),
    { store: settingsStore },
    [preference, props.battlePostEffects, props.onBattlePostEffectsChange, setPreference, settingsStore, t],
  );

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

function togglePostEffect(effects: BattlePostEffect[], effect: BattlePostEffect, enabled: boolean): BattlePostEffect[] {
  if (enabled) {
    return effects.includes(effect) ? effects : [...effects, effect];
  }
  return effects.filter((current) => current !== effect);
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
