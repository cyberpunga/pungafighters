import { Camera, Gamepad2, Settings } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { BattleConfig, BattlePostEffect, LoadedBattleBackground, LoadedFighter, PlayerSlot, RuntimeBattleBackground } from "../types/game";
import type { NetworkInputController } from "../game/network/networkInputController";
import { downloadFighterExport } from "../creator/fighterFiles";
import { DEFAULT_FIGHTER_IDS } from "../game/content/defaultFighters";
import {
  clearBattleBackgroundImage,
  deleteFighter,
  DEFAULT_BATTLE_POST_EFFECTS,
  getBattlePostEffects,
  getLoadedBattleBackground,
  listLoadedFighters,
  saveBattleBackgroundImage,
  setBattlePostEffects as saveBattlePostEffects,
} from "../storage/db";
import { BattleView } from "./BattleView";
import { CreatorView } from "./CreatorView";
import {
  LocalFighterSelectView,
  OnlineFighterSelectView,
  type LocalFighterSelection,
} from "./FighterSelectView";
import { MenuView } from "./MenuView";
import { OnlineMatchView } from "./OnlineMatchView";
import { DEFAULT_LOCAL_BATTLE_MODE, getLocalPlayerControls } from "./localBattleMode";
import { selectOnlineLocalFighter } from "./onlineSelection";
import {
  appRouteFromLocation,
  appRouteToHref,
  appRouteToView,
  creatorEditFighterIdFromPathname,
  creatorEditRouteToHref,
  type AppRoute,
  type View,
} from "./routes";
import { SettingsView } from "./SettingsView";
import { useI18n } from "../i18n/react";
import { localizeError } from "../i18n/errors";

type OnlineRole = "host" | "guest";

interface OnlineBattle {
  config: BattleConfig;
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
  background?: RuntimeBattleBackground;
  localSlot: PlayerSlot;
  controller: NetworkInputController;
}

const DEFAULT_BATTLE_CONFIG: Omit<BattleConfig, "playerOneFighterId" | "playerTwoFighterId"> = {
  roundCount: 3,
  timerSeconds: 60,
  stageId: "dojo-v1",
};

const StagePreviewView = lazy(() => import("./StagePreviewView").then((module) => ({ default: module.StagePreviewView })));

export function App() {
  const { t } = useI18n();
  const [route, navigate, pathname] = useAppRoute();
  const view = appRouteToView(route);
  const editFighterId = view === "creator" ? creatorEditFighterIdFromPathname(pathname) : undefined;
  const [fighters, setFighters] = useState<LoadedFighter[]>([]);
  const [localSelection, setLocalSelection] = useState<LocalFighterSelection>({
    p1: DEFAULT_FIGHTER_IDS[0],
    p2: DEFAULT_FIGHTER_IDS[1],
    activeSlot: "p1",
    mode: DEFAULT_LOCAL_BATTLE_MODE,
  });
  const [onlineSelectedFighterId, setOnlineSelectedFighterId] = useState<string>(DEFAULT_FIGHTER_IDS[0]);
  const [loading, setLoading] = useState(true);
  const [onlineBattle, setOnlineBattle] = useState<OnlineBattle | undefined>();
  const [fileStatus, setFileStatus] = useState("");
  const [backgroundStatus, setBackgroundStatus] = useState("");
  const [battleBackground, setBattleBackground] = useState<LoadedBattleBackground | undefined>();
  const [battlePostEffects, setBattlePostEffects] = useState<BattlePostEffect[]>(DEFAULT_BATTLE_POST_EFFECTS);
  const battleBackgroundUrlRef = useRef<string | undefined>();
  const onlineRole: OnlineRole = route === "onlineGuest" ? "guest" : "host";

  const setLoadedBattleBackground = useCallback((next: LoadedBattleBackground | undefined) => {
    if (battleBackgroundUrlRef.current && battleBackgroundUrlRef.current !== next?.imageUrl) {
      URL.revokeObjectURL(battleBackgroundUrlRef.current);
    }
    battleBackgroundUrlRef.current = next?.imageUrl;
    setBattleBackground(next);
  }, []);

  const refreshFighters = useCallback(async () => {
    setLoading(true);
    const loaded = await listLoadedFighters();
    setFighters(loaded);
    setLoading(false);
    setLocalSelection((current) => ({
      p1: loaded.some((fighter) => fighter.id === current.p1) ? current.p1 : loaded[0]?.id ?? DEFAULT_FIGHTER_IDS[0],
      p2: loaded.some((fighter) => fighter.id === current.p2) ? current.p2 : loaded[1]?.id ?? loaded[0]?.id ?? DEFAULT_FIGHTER_IDS[1],
      activeSlot: current.activeSlot,
      mode: current.mode,
    }));
    setOnlineSelectedFighterId((current) => (loaded.some((fighter) => fighter.id === current) ? current : loaded[0]?.id ?? DEFAULT_FIGHTER_IDS[0]));
  }, []);

  const refreshBattleBackground = useCallback(async () => {
    setLoadedBattleBackground(await getLoadedBattleBackground());
  }, [setLoadedBattleBackground]);

  useEffect(() => {
    void refreshFighters();
  }, [refreshFighters]);

  useEffect(() => {
    void refreshBattleBackground();
  }, [refreshBattleBackground]);

  useEffect(() => {
    let active = true;
    void getBattlePostEffects().then((effects) => {
      if (active) {
        setBattlePostEffects(effects);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (battleBackgroundUrlRef.current) {
        URL.revokeObjectURL(battleBackgroundUrlRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (view !== "battle") {
      setOnlineBattle(undefined);
    }
  }, [view]);

  const importBattleBackgroundFile = useCallback(
    async (file: File) => {
      setBackgroundStatus(t("appStatus.importingFile", { name: file.name }));
      try {
        const background = await saveBattleBackgroundImage(file);
        setLoadedBattleBackground(background);
        setBackgroundStatus(t("appStatus.backgroundSet", { name: background.name }));
      } catch (error) {
        setBackgroundStatus(localizeError(error, t, "appStatus.backgroundImportFailed"));
      }
    },
    [setLoadedBattleBackground, t],
  );

  const clearBattleBackground = useCallback(async () => {
    try {
      await clearBattleBackgroundImage();
      setLoadedBattleBackground(undefined);
      setBackgroundStatus(t("appStatus.defaultArenaRestored"));
    } catch (error) {
      setBackgroundStatus(localizeError(error, t, "appStatus.backgroundResetFailed"));
    }
  }, [setLoadedBattleBackground, t]);

  const updateBattlePostEffects = useCallback((effects: BattlePostEffect[]) => {
    setBattlePostEffects(effects);
    void saveBattlePostEffects(effects);
  }, []);

  const exportFighterFile = useCallback(async (fighter: LoadedFighter) => {
    setFileStatus(t("appStatus.exportingFighter", { name: fighter.name }));
    try {
      await downloadFighterExport(fighter);
      setFileStatus(t("appStatus.fighterExported", { name: fighter.name }));
    } catch (error) {
      setFileStatus(localizeError(error, t, "appStatus.fighterExportFailed"));
    }
  }, [t]);

  const deleteFighterFile = useCallback(
    async (id: string) => {
      await deleteFighter(id);
      await refreshFighters();
      setFileStatus(t("appStatus.fighterDeleted"));
    },
    [refreshFighters, t],
  );
  const editFighter = useCallback(
    (id: string) => {
      navigate("creator", { href: creatorEditRouteToHref(id) });
    },
    [navigate],
  );

  const battleFighters = useMemo(() => {
    const p1 = fighters.find((fighter) => fighter.id === localSelection.p1);
    const p2 = fighters.find((fighter) => fighter.id === localSelection.p2);
    return p1 && p2 ? { p1, p2 } : undefined;
  }, [fighters, localSelection]);
  const localBattleConfig = useMemo(
    () => ({
      ...DEFAULT_BATTLE_CONFIG,
      playerOneFighterId: localSelection.p1,
      playerTwoFighterId: localSelection.p2,
      playerControls: getLocalPlayerControls(localSelection.mode),
    }),
    [localSelection.mode, localSelection.p1, localSelection.p2],
  );
  const onlineLocalFighter = useMemo(() => selectOnlineLocalFighter(fighters, onlineSelectedFighterId), [fighters, onlineSelectedFighterId]);
  const exitLocalBattle = useCallback(() => navigate("menu", { replace: true }), [navigate]);
  const exitOnlineBattle = useCallback(() => {
    setOnlineBattle(undefined);
    navigate("menu", { replace: true });
  }, [navigate]);

  return (
    <main className="app-shell">
      {view !== "battle" && view !== "stagePreview" && <Topbar view={view} onNavigate={navigate} />}

      {view === "menu" && (
        <MenuView
          fighters={fighters}
          loading={loading}
          onCreate={() => navigate("creator")}
          onLocal={() => navigate("localFighters")}
          onStagePreview={() => navigate("stagePreview")}
          onHost={() => navigate("remoteHostFighter")}
          onJoin={() => navigate("remoteJoinFighter")}
        />
      )}
      {view === "creator" && <CreatorView editFighterId={editFighterId} onSaved={refreshFighters} />}
      {route === "localFighters" && (
        <LocalFighterSelectView
          fighters={fighters}
          selected={localSelection}
          fileStatus={fileStatus}
          backgroundStatus={backgroundStatus}
          battleBackground={battleBackground}
          onSelected={setLocalSelection}
          onExport={exportFighterFile}
          onEdit={editFighter}
          onDelete={deleteFighterFile}
          onImportBackgroundFile={importBattleBackgroundFile}
          onClearBackground={clearBattleBackground}
          onBack={() => navigate("menu")}
          onNext={() => {
            setOnlineBattle(undefined);
            if (battleFighters) {
              navigate("stagePreview");
            }
          }}
        />
      )}
      {route === "remoteHostFighter" && (
        <OnlineFighterSelectView
          role="host"
          fighters={fighters}
          selectedId={onlineSelectedFighterId}
          fileStatus={fileStatus}
          backgroundStatus={backgroundStatus}
          battleBackground={battleBackground}
          onSelected={setOnlineSelectedFighterId}
          onExport={exportFighterFile}
          onEdit={editFighter}
          onDelete={deleteFighterFile}
          onImportBackgroundFile={importBattleBackgroundFile}
          onClearBackground={clearBattleBackground}
          onBack={() => navigate("menu")}
          onNext={() => navigate("onlineHost")}
        />
      )}
      {route === "remoteJoinFighter" && (
        <OnlineFighterSelectView
          role="guest"
          fighters={fighters}
          selectedId={onlineSelectedFighterId}
          fileStatus={fileStatus}
          onSelected={setOnlineSelectedFighterId}
          onExport={exportFighterFile}
          onEdit={editFighter}
          onDelete={deleteFighterFile}
          onBack={() => navigate("menu")}
          onNext={() => navigate("onlineGuest")}
        />
      )}
      {view === "online" && onlineLocalFighter && (
        <OnlineMatchView
          role={onlineRole}
          localFighter={onlineLocalFighter}
          background={onlineRole === "host" ? battleBackground : undefined}
          onCancel={() => navigate(onlineRole === "host" ? "remoteHostFighter" : "remoteJoinFighter")}
          onReady={(match) => {
            setOnlineBattle({
              config: {
                ...DEFAULT_BATTLE_CONFIG,
                playerOneFighterId: match.fighters.p1.id,
                playerTwoFighterId: match.fighters.p2.id,
              },
              fighters: match.fighters,
              background: match.background,
              localSlot: match.localSlot,
              controller: match.controller,
            });
            navigate("battle");
          }}
        />
      )}
      {view === "settings" && <SettingsView battlePostEffects={battlePostEffects} onBattlePostEffectsChange={updateBattlePostEffects} />}
      {view === "stagePreview" && (
        <Suspense fallback={<div className="stage-preview-loading">{t("common.loading")}</div>}>
          <StagePreviewView
            fighters={fighters}
            selectedFighterIds={{ p1: localSelection.p1, p2: localSelection.p2 }}
            config={{
              ...localBattleConfig,
              playerControls: { p1: "human", p2: "cpu" },
            }}
            loading={loading}
            onBack={() => navigate("menu")}
            onFight={() => navigate("localFighters")}
          />
        </Suspense>
      )}
      {view === "battle" && onlineBattle && (
        <BattleView
          mode="online"
          localSlot={onlineBattle.localSlot}
          networkController={onlineBattle.controller}
          config={onlineBattle.config}
          fighters={onlineBattle.fighters}
          background={onlineBattle.background}
          displayEffects={battlePostEffects}
          onDisplayEffectsChange={updateBattlePostEffects}
          onExit={exitOnlineBattle}
        />
      )}
      {view === "battle" && !onlineBattle && battleFighters && (
        <BattleView
          config={localBattleConfig}
          fighters={battleFighters}
          background={battleBackground}
          displayEffects={battlePostEffects}
          onDisplayEffectsChange={updateBattlePostEffects}
          onExit={exitLocalBattle}
        />
      )}
    </main>
  );
}

function Topbar(props: { view: View; onNavigate: (route: AppRoute) => void }) {
  const { t } = useI18n();
  const onRouteClick = (event: MouseEvent<HTMLAnchorElement>, route: AppRoute) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    props.onNavigate(route);
  };

  const fightActive = props.view === "menu" || props.view === "fighterSelect" || props.view === "online";

  return (
    <header className="topbar">
      <a className="brand-button" href={appRouteToHref("menu")} onClick={(event) => onRouteClick(event, "menu")}>
        <span className="brand-mark">PF</span>
        <span>{t("app.brand")}</span>
      </a>
      <nav className="nav-cluster" aria-label={t("nav.primary")}>
        <a
          className={props.view === "creator" ? "icon-button active" : "icon-button"}
          href={appRouteToHref("creator")}
          onClick={(event) => onRouteClick(event, "creator")}
          aria-current={props.view === "creator" ? "page" : undefined}
          aria-label={t("nav.createFighter")}
          title={t("nav.createFighter")}
        >
          <Camera size={19} />
        </a>
        <a
          className={fightActive ? "icon-button active" : "icon-button"}
          href={appRouteToHref("menu")}
          onClick={(event) => onRouteClick(event, "menu")}
          aria-current={fightActive ? "page" : undefined}
          aria-label={t("nav.fightOptions")}
          title={t("nav.fightOptions")}
        >
          <Gamepad2 size={19} />
        </a>
        <a
          className={props.view === "settings" ? "icon-button active" : "icon-button"}
          href={appRouteToHref("settings")}
          onClick={(event) => onRouteClick(event, "settings")}
          aria-current={props.view === "settings" ? "page" : undefined}
          aria-label={t("nav.settings")}
          title={t("nav.settings")}
        >
          <Settings size={19} />
        </a>
      </nav>
    </header>
  );
}

function useAppRoute(): [AppRoute, (route: AppRoute, options?: { href?: string; replace?: boolean }) => void, string] {
  const [locationState, setLocationState] = useState(() => ({
    route: appRouteFromLocation(window.location),
    pathname: window.location.pathname,
  }));
  const { route, pathname } = locationState;

  useEffect(() => {
    const onPopState = () =>
      setLocationState({
        route: appRouteFromLocation(window.location),
        pathname: window.location.pathname,
      });
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (route === "creator" && creatorEditFighterIdFromPathname(window.location.pathname)) {
      return;
    }
    const href = appRouteToHref(route);
    if (window.location.pathname !== href) {
      window.history.replaceState({ appRoute: route }, "", href);
    }
  }, [route]);

  const navigate = useCallback((nextRoute: AppRoute, options?: { href?: string; replace?: boolean }) => {
    const href = options?.href ?? appRouteToHref(nextRoute);
    if (window.location.pathname !== href) {
      const method = options?.replace ? "replaceState" : "pushState";
      window.history[method]({ appRoute: nextRoute }, "", href);
    }
    setLocationState({ route: nextRoute, pathname: window.location.pathname });
  }, []);

  return [route, navigate, pathname];
}
