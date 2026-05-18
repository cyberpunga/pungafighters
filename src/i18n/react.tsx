import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSetting, setSetting } from "../storage/db";
import {
  createTranslator,
  DEFAULT_LOCALE,
  LOCALE_SETTING_KEY,
  normalizeLocalePreference,
  resolveLocale,
  type Locale,
  type LocalePreference,
  type Translate,
} from "./index";

interface I18nContextValue {
  locale: Locale;
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider(props: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LocalePreference>("auto");
  const [loaded, setLoaded] = useState(false);
  const browserLanguages = typeof navigator === "undefined" ? [DEFAULT_LOCALE] : navigator.languages;
  const locale = resolveLocale(preference, browserLanguages);
  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    let cancelled = false;
    void getSetting<unknown>(LOCALE_SETTING_KEY, "auto").then((saved) => {
      if (!cancelled) {
        setPreferenceState(normalizeLocalePreference(saved));
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setPreference = useCallback((nextPreference: LocalePreference) => {
    setPreferenceState(nextPreference);
    void setSetting(LOCALE_SETTING_KEY, nextPreference);
  }, []);

  const value = useMemo(
    () => ({
      locale,
      preference,
      setPreference,
      t,
    }),
    [locale, preference, setPreference, t],
  );

  if (!loaded) {
    return null;
  }

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }
  return value;
}
