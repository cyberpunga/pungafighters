import { ArrowDown, ArrowUp, CircleOff, ScanLine, TvMinimal, Zap } from "lucide-react";
import type { BattlePostEffect } from "../types/game";

const DISPLAY_EFFECT_OPTIONS = [
  { value: "bad-tv", label: "Bad TV", Icon: Zap },
  { value: "crt-soft", label: "CRT Soft", Icon: TvMinimal },
  { value: "crt-strong", label: "CRT Max", Icon: ScanLine },
] as const satisfies ReadonlyArray<{
  value: BattlePostEffect;
  label: string;
  Icon: typeof CircleOff;
}>;

export function BattleDisplayEffectsControl(props: {
  effects: BattlePostEffect[];
  onChange: (effects: BattlePostEffect[]) => void;
  compact?: boolean;
}) {
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
      <div className="effect-toggle-row" role="group" aria-label="Battle display effects">
        <button className={props.effects.length === 0 ? "effect-toggle-button active" : "effect-toggle-button"} type="button" onClick={setClean}>
          <CircleOff size={16} aria-hidden="true" />
          <span>Clean</span>
        </button>
        {DISPLAY_EFFECT_OPTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            className={props.effects.includes(value) ? "effect-toggle-button active" : "effect-toggle-button"}
            type="button"
            aria-pressed={props.effects.includes(value)}
            onClick={() => toggleEffect(value)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {props.effects.length > 0 && (
        <div className="effect-order-list" aria-label="Battle display effect order">
          {props.effects.map((effect, index) => {
            const option = DISPLAY_EFFECT_OPTIONS.find((current) => current.value === effect);
            if (!option) {
              return null;
            }
            const { label, Icon } = option;
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
                    title="Move earlier"
                    aria-label={`Move ${label} earlier`}
                    disabled={index === 0}
                    onClick={() => moveEffect(effect, -1)}
                  >
                    <ArrowUp size={15} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button effect-order-button"
                    type="button"
                    title="Move later"
                    aria-label={`Move ${label} later`}
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
