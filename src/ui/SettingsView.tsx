import type { BattlePostEffect } from "../types/game";
import { BattleDisplayEffectsControl } from "./BattleDisplayEffectsControl";
import { useI18n } from "../i18n/react";
import type { LocalePreference } from "../i18n";

export function SettingsView(props: {
  battlePostEffects: BattlePostEffect[];
  onBattlePostEffectsChange: (effects: BattlePostEffect[]) => void;
}) {
  const { preference, setPreference, t } = useI18n();
  const setLocalePreference = (nextPreference: LocalePreference) => setPreference(nextPreference);

  return (
    <section className="settings-view">
      <p className="eyebrow">{t("settings.eyebrow")}</p>
      <h2>{t("settings.title")}</h2>
      <div className="settings-grid">
        <div className="settings-control-card">
          <strong>{t("settings.language")}</strong>
          <div className="segmented-control" role="group" aria-label={t("settings.language")}>
            <button
              className={preference === "auto" ? "segment-option active" : "segment-option"}
              type="button"
              onClick={() => setLocalePreference("auto")}
            >
              {t("common.auto")}
            </button>
            <button
              className={preference === "en" ? "segment-option active" : "segment-option"}
              type="button"
              onClick={() => setLocalePreference("en")}
            >
              {t("common.english")}
            </button>
            <button
              className={preference === "es" ? "segment-option active" : "segment-option"}
              type="button"
              onClick={() => setLocalePreference("es")}
            >
              {t("common.espanol")}
            </button>
          </div>
          <span>{t("settings.languageAutoDetail")}</span>
        </div>
        <div className="settings-control-card">
          <strong>{t("settings.battleDisplay")}</strong>
          <BattleDisplayEffectsControl effects={props.battlePostEffects} onChange={props.onBattlePostEffectsChange} />
        </div>
        <div>
          <strong>{t("settings.rounds")}</strong>
          <span>{t("menu.bestOf3")}</span>
        </div>
        <div>
          <strong>{t("settings.timer")}</strong>
          <span>{t("settings.timerValue")}</span>
        </div>
        <div>
          <strong>{t("settings.saves")}</strong>
          <span>{t("settings.savesValue")}</span>
        </div>
        <div>
          <strong>{t("settings.segmentation")}</strong>
          <span>{t("settings.segmentationValue")}</span>
        </div>
      </div>
    </section>
  );
}
