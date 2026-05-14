import { Camera, Gamepad2, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import type { BattleConfig, LoadedFighter, PlayerSlot } from "../types/game";
import type { NetworkInputController } from "../game/network/networkInputController";
import { downloadFighterExport, readFighterImportFile } from "../creator/fighterFiles";
import { DEFAULT_FIGHTER_IDS } from "../game/content/defaultFighters";
import { deleteFighter, listLoadedFighters, saveImportedFighter } from "../storage/db";
import { BattleView } from "./BattleView";
import { CreatorView } from "./CreatorView";
import { FighterSelectView } from "./FighterSelectView";
import { MenuView } from "./MenuView";
import { OnlineMatchView } from "./OnlineMatchView";
import { appRouteFromLocation, appRouteToHref, appRouteToView, type AppRoute, type View } from "./routes";
import { SettingsView } from "./SettingsView";

type OnlineRole = "host" | "guest";

interface OnlineBattle {
  config: BattleConfig;
  fighters: { p1: LoadedFighter; p2: LoadedFighter };
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
  const [selected, setSelected] = useState<{ p1: string; p2: string }>({
    p1: DEFAULT_FIGHTER_IDS[0],
    p2: DEFAULT_FIGHTER_IDS[1],
  });
  const [loading, setLoading] = useState(true);
  const [onlineBattle, setOnlineBattle] = useState<OnlineBattle | undefined>();
  const [fileStatus, setFileStatus] = useState("");
  const onlineRole: OnlineRole = route === "onlineGuest" ? "guest" : "host";

  const refreshFighters = useCallback(async () => {
    setLoading(true);
    const loaded = await listLoadedFighters();
    setFighters(loaded);
    setLoading(false);
    setSelected((current) => ({
      p1: loaded.some((fighter) => fighter.id === current.p1) ? current.p1 : loaded[0]?.id ?? DEFAULT_FIGHTER_IDS[0],
      p2: loaded.some((fighter) => fighter.id === current.p2) ? current.p2 : loaded[1]?.id ?? loaded[0]?.id ?? DEFAULT_FIGHTER_IDS[1],
    }));
  }, []);

  useEffect(() => {
    void refreshFighters();
  }, [refreshFighters]);

  useEffect(() => {
    if (view !== "battle") {
      setOnlineBattle(undefined);
    }
  }, [view]);

  const importFighterFile = useCallback(
    async (file: File) => {
      setFileStatus(`Importing ${file.name}...`);
      try {
        const imported = await readFighterImportFile(file);
        const fighter = await saveImportedFighter(imported);
        await refreshFighters();
        setSelected((current) => ({ ...current, p1: fighter.id }));
        setFileStatus(`${fighter.name} imported.`);
      } catch (error) {
        setFileStatus(error instanceof Error ? error.message : "Could not import fighter.");
      }
    },
    [refreshFighters],
  );

  const exportFighterFile = useCallback(async (fighter: LoadedFighter) => {
    setFileStatus(`Exporting ${fighter.name}...`);
    try {
      await downloadFighterExport(fighter);
      setFileStatus(`${fighter.name} exported.`);
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : "Could not export fighter.");
    }
  }, []);

  const battleFighters = useMemo(() => {
    const p1 = fighters.find((fighter) => fighter.id === selected.p1);
    const p2 = fighters.find((fighter) => fighter.id === selected.p2);
    return p1 && p2 ? { p1, p2 } : undefined;
  }, [fighters, selected]);
  const onlineLocalFighter = useMemo(
    () => fighters.find((fighter) => fighter.id === selected[onlineRole === "host" ? "p1" : "p2"]) ?? fighters[0],
    [fighters, onlineRole, selected],
  );

  return (
    <main className="app-shell">
      {view !== "battle" && <Topbar view={view} onNavigate={navigate} />}

      {view === "menu" && <MenuView fighters={fighters} loading={loading} onCreate={() => navigate("creator")} onSelect={() => navigate("select")} />}
      {view === "creator" && <CreatorView onSaved={refreshFighters} />}
      {view === "select" && (
        <FighterSelectView
          fighters={fighters}
          selected={selected}
          fileStatus={fileStatus}
          onSelected={setSelected}
          onImportFile={importFighterFile}
          onExport={exportFighterFile}
          onDelete={async (id) => {
            await deleteFighter(id);
            await refreshFighters();
          }}
          onFight={() => {
            setOnlineBattle(undefined);
            if (battleFighters) {
              navigate("battle");
            }
          }}
          onHostOnline={() => {
            navigate("onlineHost");
          }}
          onJoinOnline={() => {
            navigate("onlineGuest");
          }}
        />
      )}
      {view === "online" && onlineLocalFighter && (
        <OnlineMatchView
          role={onlineRole}
          localFighter={onlineLocalFighter}
          onCancel={() => navigate("select")}
          onReady={(match) => {
            setOnlineBattle({
              config: {
                ...DEFAULT_BATTLE_CONFIG,
                playerOneFighterId: match.fighters.p1.id,
                playerTwoFighterId: match.fighters.p2.id,
              },
              fighters: match.fighters,
              localSlot: match.localSlot,
              controller: match.controller,
            });
            navigate("battle");
          }}
        />
      )}
      {view === "settings" && <SettingsView />}
      {view === "battle" && onlineBattle && (
        <BattleView
          mode="online"
          localSlot={onlineBattle.localSlot}
          networkController={onlineBattle.controller}
          config={onlineBattle.config}
          fighters={onlineBattle.fighters}
          onExit={() => {
            setOnlineBattle(undefined);
            navigate("select", { replace: true });
          }}
        />
      )}
      {view === "battle" && !onlineBattle && battleFighters && (
        <BattleView
          config={{ ...DEFAULT_BATTLE_CONFIG, playerOneFighterId: selected.p1, playerTwoFighterId: selected.p2 }}
          fighters={battleFighters}
          onExit={() => navigate("select", { replace: true })}
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
          className={props.view === "select" ? "icon-button active" : "icon-button"}
          href={appRouteToHref("select")}
          onClick={(event) => onRouteClick(event, "select")}
          aria-current={props.view === "select" ? "page" : undefined}
          aria-label="Select fighters"
          title="Select fighters"
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
