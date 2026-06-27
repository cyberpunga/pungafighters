import { Aperture, ArrowDown, ArrowUp, CircleOff, Grid3X3, ScanLine, Sparkles, TvMinimal, Zap } from "lucide-react";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n/react";
import type { BattlePostEffect } from "../types/game";

const DISPLAY_EFFECT_OPTIONS = [
  { value: "pixel", labelKey: "effects.pixel", Icon: Grid3X3 },
  { value: "bad-tv", labelKey: "effects.bad-tv", Icon: Zap },
  { value: "static", labelKey: "effects.static", Icon: Sparkles },
  { value: "crt-soft", labelKey: "effects.crt-soft", Icon: TvMinimal },
  { value: "crt-strong", labelKey: "effects.crt-strong", Icon: ScanLine },
  { value: "lens", labelKey: "effects.lens", Icon: Aperture },
] as const satisfies ReadonlyArray<{
  value: BattlePostEffect;
  labelKey: MessageKey;
  Icon: typeof CircleOff;
}>;

export function BattleDisplayEffectsControl(props: {
  effects: BattlePostEffect[];
  onChange: (effects: BattlePostEffect[]) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const setClean = () => props.onChange([]);
  const toggleEffect = (effect: BattlePostEffect) => {
    props.onChange(props.effects.includes(effect) ? props.effects.filter((current) => current !== effect) : [...props.effects, effect]);
  };
  const moveEffect = (effect: BattlePostEffect, direction: -1 | 1) => {
    const index = props.effects.indexOf(effect);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= props.effects.length) {
      return;
    }
    const next = [...props.effects];
    [next[index], next[target]] = [next[target], next[index]];
    props.onChange(next);
  };

  return (
    <div className={props.compact ? "effect-stack effect-stack--compact" : "effect-stack"}>
      <div className="effect-toggle-row" role="group" aria-label={t("effects.battleDisplayEffects")}>
        <button className={props.effects.length === 0 ? "effect-toggle-button active" : "effect-toggle-button"} type="button" onClick={setClean}>
          <CircleOff size={16} aria-hidden="true" />
          <span>{t("effects.clean")}</span>
        </button>
        {DISPLAY_EFFECT_OPTIONS.map(({ value, labelKey, Icon }) => (
          <button
            key={value}
            className={props.effects.includes(value) ? "effect-toggle-button active" : "effect-toggle-button"}
            type="button"
            aria-pressed={props.effects.includes(value)}
            onClick={() => toggleEffect(value)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </div>

      {props.effects.length > 0 && (
        <div className="effect-order-list" aria-label={t("effects.battleDisplayEffectOrder")}>
          {props.effects.map((effect, index) => {
            const option = DISPLAY_EFFECT_OPTIONS.find((current) => current.value === effect);
            if (!option) {
              return null;
            }
            const { labelKey, Icon } = option;
            const label = t(labelKey);
            return (
              <div className="effect-order-item" key={effect}>
                <span className="effect-order-label">
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </span>
                <span className="effect-order-actions">
                  <button
                    className="icon-button effect-order-button"
                    type="button"
                    title={t("effects.moveEarlier")}
                    aria-label={t("effects.moveEffectEarlier", { effect: label })}
                    disabled={index === 0}
                    onClick={() => moveEffect(effect, -1)}
                  >
                    <ArrowUp size={15} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button effect-order-button"
                    type="button"
                    title={t("effects.moveLater")}
                    aria-label={t("effects.moveEffectLater", { effect: label })}
                    disabled={index === props.effects.length - 1}
                    onClick={() => moveEffect(effect, 1)}
                  >
                    <ArrowDown size={15} aria-hidden="true" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
