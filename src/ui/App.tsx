import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BattleConfig, BattlePostEffectSettings, LoadedBattleBackground, LoadedFighter, PlayerSlot, RuntimeBattleBackground } from "../types/game";
import type { NetworkInputController } from "../game/network/networkInputController";
import { downloadFighterExport } from "../creator/fighterFiles";
import { DEFAULT_FIGHTER_IDS } from "../game/content/defaultFighters";
import {
  clearBattleBackgroundImage,
  deleteFighter,
  DEFAULT_BATTLE_POST_EFFECT_SETTINGS,
  getBattlePostEffectSettings,
  getLoadedBattleBackground,
  listLoadedFighters,
  saveBattleBackgroundImage,
  setBattlePostEffectSettings as saveBattlePostEffectSettings,
} from "../storage/db";
import { CreatorView } from "./CreatorView";
import {
  LocalFighterSelectView,
  OnlineFighterSelectView,
  type LocalFighterSelection,
} from "./FighterSelectView";
import { MenuView } from "./MenuView";
import { OnlineMatchView } from "./OnlineMatchView";
import { AppSettingsPanel } from "./AppSettingsPanel";
import { DEFAULT_LOCAL_BATTLE_MODE, getLocalPlayerControls } from "./localBattleMode";
import { selectOnlineLocalFighter } from "./onlineSelection";
import {
  appRouteToView,
  creatorEditFighterIdFromPathname,
  creatorEditRouteToHref,
} from "./routes";
import { Topbar } from "./Topbar";
import { useAppRoute } from "./useAppRoute";
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

const BattleStageView = lazy(() => import("./BattleStageView").then((module) => ({ default: module.BattleStageView })));

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
  const [battlePostEffectSettings, setBattlePostEffectSettings] = useState<BattlePostEffectSettings>(DEFAULT_BATTLE_POST_EFFECT_SETTINGS);
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
    void getBattlePostEffectSettings().then((settings) => {
      if (active) {
        setBattlePostEffectSettings(settings);
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

  const updateBattlePostEffectSettings = useCallback((settings: BattlePostEffectSettings) => {
    setBattlePostEffectSettings(settings);
    void saveBattlePostEffectSettings(settings);
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
  const localBattleFighterList = useMemo(() => (battleFighters ? [battleFighters.p1, battleFighters.p2] : []), [battleFighters]);
  const localBattleSelectedFighterIds = useMemo(
    () => (battleFighters ? { p1: battleFighters.p1.id, p2: battleFighters.p2.id } : undefined),
    [battleFighters],
  );
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
  const onlineBattleFighterList = useMemo(
    () => (onlineBattle ? [onlineBattle.fighters.p1, onlineBattle.fighters.p2] : []),
    [onlineBattle],
  );
  const onlineBattleSelectedFighterIds = useMemo(
    () => (onlineBattle ? { p1: onlineBattle.fighters.p1.id, p2: onlineBattle.fighters.p2.id } : undefined),
    [onlineBattle],
  );
  const exitLocalBattle = useCallback(() => navigate("menu", { replace: true }), [navigate]);
  const exitOnlineBattle = useCallback(() => {
    setOnlineBattle(undefined);
    navigate("menu", { replace: true });
  }, [navigate]);

  return (
    <main className="app-shell">
      <AppSettingsPanel battleActive={view === "battle"} battlePostEffectSettings={battlePostEffectSettings} onBattlePostEffectSettingsChange={updateBattlePostEffectSettings} />
      {view !== "battle" && <Topbar view={view} onNavigate={navigate} />}

      {view === "menu" && (
        <MenuView
          fighters={fighters}
          loading={loading}
          onCreate={() => navigate("creator")}
          onLocal={() => navigate("localFighters")}
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
              navigate("battle");
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
      {view === "battle" && onlineBattle && onlineBattleSelectedFighterIds && (
        <Suspense fallback={<div className="battle-stage-loading">{t("common.loading")}</div>}>
          <BattleStageView
            fighters={onlineBattleFighterList}
            selectedFighterIds={onlineBattleSelectedFighterIds}
            mode="online"
            localSlot={onlineBattle.localSlot}
            networkController={onlineBattle.controller}
            config={onlineBattle.config}
            background={onlineBattle.background}
            displayEffectSettings={battlePostEffectSettings}
            loading={loading}
            onBack={exitOnlineBattle}
          />
        </Suspense>
      )}
      {view === "battle" && !onlineBattle && battleFighters && localBattleSelectedFighterIds && (
        <Suspense fallback={<div className="battle-stage-loading">{t("common.loading")}</div>}>
          <BattleStageView
            fighters={localBattleFighterList}
            selectedFighterIds={localBattleSelectedFighterIds}
            config={localBattleConfig}
            background={battleBackground}
            displayEffectSettings={battlePostEffectSettings}
            loading={loading}
            onBack={exitLocalBattle}
          />
        </Suspense>
      )}
    </main>
  );
}
