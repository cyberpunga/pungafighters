import { Camera, Gamepad2, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BattleConfig, LoadedFighter, PlayerSlot } from "../types/game";
import type { NetworkInputController } from "../game/network/networkInputController";
import { DEFAULT_FIGHTER_IDS } from "../game/content/defaultFighters";
import { deleteFighter, listLoadedFighters } from "../storage/db";
import { BattleView } from "./BattleView";
import { CreatorView } from "./CreatorView";
import { FighterSelectView } from "./FighterSelectView";
import { MenuView } from "./MenuView";
import { OnlineMatchView } from "./OnlineMatchView";
import { SettingsView } from "./SettingsView";

type View = "menu" | "creator" | "select" | "settings" | "online" | "battle";
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
  const [view, setView] = useState<View>("menu");
  const [fighters, setFighters] = useState<LoadedFighter[]>([]);
  const [selected, setSelected] = useState<{ p1: string; p2: string }>({
    p1: DEFAULT_FIGHTER_IDS[0],
    p2: DEFAULT_FIGHTER_IDS[1],
  });
  const [loading, setLoading] = useState(true);
  const [onlineRole, setOnlineRole] = useState<OnlineRole>("host");
  const [onlineBattle, setOnlineBattle] = useState<OnlineBattle | undefined>();

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
      {view !== "battle" && <Topbar view={view} onNavigate={setView} />}

      {view === "menu" && <MenuView fighters={fighters} loading={loading} onCreate={() => setView("creator")} onSelect={() => setView("select")} />}
      {view === "creator" && <CreatorView onSaved={refreshFighters} />}
      {view === "select" && (
        <FighterSelectView
          fighters={fighters}
          selected={selected}
          onSelected={setSelected}
          onDelete={async (id) => {
            await deleteFighter(id);
            await refreshFighters();
          }}
          onFight={() => {
            setOnlineBattle(undefined);
            if (battleFighters) {
              setView("battle");
            }
          }}
          onHostOnline={() => {
            setOnlineRole("host");
            setView("online");
          }}
          onJoinOnline={() => {
            setOnlineRole("guest");
            setView("online");
          }}
        />
      )}
      {view === "online" && onlineLocalFighter && (
        <OnlineMatchView
          role={onlineRole}
          localFighter={onlineLocalFighter}
          onCancel={() => setView("select")}
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
            setView("battle");
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
            setView("select");
          }}
        />
      )}
      {view === "battle" && !onlineBattle && battleFighters && (
        <BattleView
          config={{ ...DEFAULT_BATTLE_CONFIG, playerOneFighterId: selected.p1, playerTwoFighterId: selected.p2 }}
          fighters={battleFighters}
          onExit={() => setView("select")}
        />
      )}
    </main>
  );
}

function Topbar(props: { view: View; onNavigate: (view: View) => void }) {
  return (
    <header className="topbar">
      <button className="brand-button" type="button" onClick={() => props.onNavigate("menu")}>
        <span className="brand-mark">PF</span>
        <span>Punga Fighters</span>
      </button>
      <nav className="nav-cluster" aria-label="Primary">
        <button
          className={props.view === "creator" ? "icon-button active" : "icon-button"}
          type="button"
          onClick={() => props.onNavigate("creator")}
          title="Create fighter"
        >
          <Camera size={19} />
        </button>
        <button
          className={props.view === "select" ? "icon-button active" : "icon-button"}
          type="button"
          onClick={() => props.onNavigate("select")}
          title="Select fighters"
        >
          <Gamepad2 size={19} />
        </button>
        <button
          className={props.view === "settings" ? "icon-button active" : "icon-button"}
          type="button"
          onClick={() => props.onNavigate("settings")}
          title="Settings"
        >
          <Settings size={19} />
        </button>
      </nav>
    </header>
  );
}
