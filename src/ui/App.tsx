import { Camera, Gamepad2, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { BattleConfig, BattleDisplayEffect, LoadedBattleBackground, LoadedFighter, PlayerSlot, RuntimeBattleBackground } from "../types/game";
import type { NetworkInputController } from "../game/network/networkInputController";
import { downloadFighterExport } from "../creator/fighterFiles";
import { DEFAULT_FIGHTER_IDS } from "../game/content/defaultFighters";
import {
  clearBattleBackgroundImage,
  deleteFighter,
  DEFAULT_BATTLE_DISPLAY_EFFECT,
  getBattleDisplayEffect,
  getLoadedBattleBackground,
  listLoadedFighters,
  saveBattleBackgroundImage,
  setBattleDisplayEffect as saveBattleDisplayEffect,
} from "../storage/db";
import { BattleView } from "./BattleView";
import { CreatorView } from "./CreatorView";
import {
  BackgroundSelectView,
  FightModeView,
  LocalFighterSelectView,
  OnlineFighterSelectView,
  type LocalFighterSelection,
} from "./FighterSelectView";
import { MenuView } from "./MenuView";
import { OnlineMatchView } from "./OnlineMatchView";
import { selectOnlineLocalFighter } from "./onlineSelection";
import { appRouteFromLocation, appRouteToHref, appRouteToView, type AppRoute, type View } from "./routes";
import { SettingsView } from "./SettingsView";

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

export function App() {
  const [route, navigate] = useAppRoute();
  const view = appRouteToView(route);
  const [fighters, setFighters] = useState<LoadedFighter[]>([]);
  const [localSelection, setLocalSelection] = useState<LocalFighterSelection>({
    p1: DEFAULT_FIGHTER_IDS[0],
    p2: DEFAULT_FIGHTER_IDS[1],
    activeSlot: "p1",
  });
  const [onlineSelectedFighterId, setOnlineSelectedFighterId] = useState<string>(DEFAULT_FIGHTER_IDS[0]);
  const [loading, setLoading] = useState(true);
  const [onlineBattle, setOnlineBattle] = useState<OnlineBattle | undefined>();
  const [fileStatus, setFileStatus] = useState("");
  const [backgroundStatus, setBackgroundStatus] = useState("");
  const [battleBackground, setBattleBackground] = useState<LoadedBattleBackground | undefined>();
  const [battleDisplayEffect, setBattleDisplayEffect] = useState<BattleDisplayEffect>(DEFAULT_BATTLE_DISPLAY_EFFECT);
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
    void getBattleDisplayEffect().then((effect) => {
      if (active) {
        setBattleDisplayEffect(effect);
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
      setBackgroundStatus(`Importing ${file.name}...`);
      try {
        const background = await saveBattleBackgroundImage(file);
        setLoadedBattleBackground(background);
        setBackgroundStatus(`${background.name} set as battle background.`);
      } catch (error) {
        setBackgroundStatus(error instanceof Error ? error.message : "Could not import background.");
      }
    },
    [setLoadedBattleBackground],
  );

  const clearBattleBackground = useCallback(async () => {
    try {
      await clearBattleBackgroundImage();
      setLoadedBattleBackground(undefined);
      setBackgroundStatus("Default arena restored.");
    } catch (error) {
      setBackgroundStatus(error instanceof Error ? error.message : "Could not reset background.");
    }
  }, [setLoadedBattleBackground]);

  const updateBattleDisplayEffect = useCallback((effect: BattleDisplayEffect) => {
    setBattleDisplayEffect(effect);
    void saveBattleDisplayEffect(effect);
  }, []);

  const exportFighterFile = useCallback(async (fighter: LoadedFighter) => {
    setFileStatus(`Exporting ${fighter.name}...`);
    try {
      await downloadFighterExport(fighter);
      setFileStatus(`${fighter.name} exported.`);
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : "Could not export fighter.");
    }
  }, []);

  const deleteFighterFile = useCallback(
    async (id: string) => {
      await deleteFighter(id);
      await refreshFighters();
      setFileStatus("Fighter deleted.");
    },
    [refreshFighters],
  );

  const battleFighters = useMemo(() => {
    const p1 = fighters.find((fighter) => fighter.id === localSelection.p1);
    const p2 = fighters.find((fighter) => fighter.id === localSelection.p2);
    return p1 && p2 ? { p1, p2 } : undefined;
  }, [fighters, localSelection]);
  const onlineLocalFighter = useMemo(() => selectOnlineLocalFighter(fighters, onlineSelectedFighterId), [fighters, onlineSelectedFighterId]);

  return (
    <main className="app-shell">
      {view !== "battle" && <Topbar view={view} onNavigate={navigate} />}

      {view === "menu" && <MenuView fighters={fighters} loading={loading} onCreate={() => navigate("creator")} onSelect={() => navigate("fight")} />}
      {view === "creator" && <CreatorView onSaved={refreshFighters} />}
      {route === "fight" && (
        <FightModeView
          onLocal={() => navigate("localFighters")}
          onHost={() => navigate("remoteHostFighter")}
          onJoin={() => navigate("remoteJoinFighter")}
        />
      )}
      {route === "localFighters" && (
        <LocalFighterSelectView
          fighters={fighters}
          selected={localSelection}
          fileStatus={fileStatus}
          onSelected={setLocalSelection}
          onExport={exportFighterFile}
          onDelete={deleteFighterFile}
          onBack={() => navigate("fight")}
          onNext={() => navigate("localBackground")}
        />
      )}
      {route === "remoteHostFighter" && (
        <OnlineFighterSelectView
          role="host"
          fighters={fighters}
          selectedId={onlineSelectedFighterId}
          fileStatus={fileStatus}
          onSelected={setOnlineSelectedFighterId}
          onExport={exportFighterFile}
          onDelete={deleteFighterFile}
          onBack={() => navigate("fight")}
          onNext={() => navigate("remoteHostBackground")}
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
          onDelete={deleteFighterFile}
          onBack={() => navigate("fight")}
          onNext={() => navigate("onlineGuest")}
        />
      )}
      {route === "localBackground" && (
        <BackgroundSelectView
          mode="local"
          backgroundStatus={backgroundStatus}
          battleBackground={battleBackground}
          onImportBackgroundFile={importBattleBackgroundFile}
          onClearBackground={clearBattleBackground}
          onBack={() => navigate("localFighters")}
          onNext={() => {
            setOnlineBattle(undefined);
            if (battleFighters) {
              navigate("battle");
            }
          }}
        />
      )}
      {route === "remoteHostBackground" && (
        <BackgroundSelectView
          mode="remoteHost"
          backgroundStatus={backgroundStatus}
          battleBackground={battleBackground}
          onImportBackgroundFile={importBattleBackgroundFile}
          onClearBackground={clearBattleBackground}
          onBack={() => navigate("remoteHostFighter")}
          onNext={() => navigate("onlineHost")}
        />
      )}
      {view === "online" && onlineLocalFighter && (
        <OnlineMatchView
          role={onlineRole}
          localFighter={onlineLocalFighter}
          background={onlineRole === "host" ? battleBackground : undefined}
          onCancel={() => navigate(onlineRole === "host" ? "remoteHostBackground" : "remoteJoinFighter")}
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
      {view === "settings" && <SettingsView battleDisplayEffect={battleDisplayEffect} onBattleDisplayEffectChange={updateBattleDisplayEffect} />}
      {view === "battle" && onlineBattle && (
        <BattleView
          mode="online"
          localSlot={onlineBattle.localSlot}
          networkController={onlineBattle.controller}
          config={onlineBattle.config}
          fighters={onlineBattle.fighters}
          background={onlineBattle.background}
          displayEffect={battleDisplayEffect}
          onExit={() => {
            setOnlineBattle(undefined);
            navigate("fight", { replace: true });
          }}
        />
      )}
      {view === "battle" && !onlineBattle && battleFighters && (
        <BattleView
          config={{ ...DEFAULT_BATTLE_CONFIG, playerOneFighterId: localSelection.p1, playerTwoFighterId: localSelection.p2 }}
          fighters={battleFighters}
          background={battleBackground}
          displayEffect={battleDisplayEffect}
          onExit={() => navigate("fight", { replace: true })}
        />
      )}
    </main>
  );
}

function Topbar(props: { view: View; onNavigate: (route: AppRoute) => void }) {
  const onRouteClick = (event: MouseEvent<HTMLAnchorElement>, route: AppRoute) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    props.onNavigate(route);
  };

  const fightActive = props.view === "fightMode" || props.view === "fighterSelect" || props.view === "backgroundSelect" || props.view === "online";

  return (
    <header className="topbar">
      <a className="brand-button" href={appRouteToHref("menu")} onClick={(event) => onRouteClick(event, "menu")}>
        <span className="brand-mark">PF</span>
        <span>Punga Fighters</span>
      </a>
      <nav className="nav-cluster" aria-label="Primary">
        <a
          className={props.view === "creator" ? "icon-button active" : "icon-button"}
          href={appRouteToHref("creator")}
          onClick={(event) => onRouteClick(event, "creator")}
          aria-current={props.view === "creator" ? "page" : undefined}
          aria-label="Create fighter"
          title="Create fighter"
        >
          <Camera size={19} />
        </a>
        <a
          className={fightActive ? "icon-button active" : "icon-button"}
          href={appRouteToHref("fight")}
          onClick={(event) => onRouteClick(event, "fight")}
          aria-current={fightActive ? "page" : undefined}
          aria-label="Fight setup"
          title="Fight setup"
        >
          <Gamepad2 size={19} />
        </a>
        <a
          className={props.view === "settings" ? "icon-button active" : "icon-button"}
          href={appRouteToHref("settings")}
          onClick={(event) => onRouteClick(event, "settings")}
          aria-current={props.view === "settings" ? "page" : undefined}
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={19} />
        </a>
      </nav>
    </header>
  );
}

function useAppRoute(): [AppRoute, (route: AppRoute, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<AppRoute>(() => appRouteFromLocation(window.location));

  useEffect(() => {
    const onPopState = () => setRoute(appRouteFromLocation(window.location));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((nextRoute: AppRoute, options?: { replace?: boolean }) => {
    const href = appRouteToHref(nextRoute);
    if (window.location.pathname !== href) {
      const method = options?.replace ? "replaceState" : "pushState";
      window.history[method]({ appRoute: nextRoute }, "", href);
    }
    setRoute(nextRoute);
  }, []);

  return [route, navigate];
}
