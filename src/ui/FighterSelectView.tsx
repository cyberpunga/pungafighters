import { ArrowLeft, Bot, Cpu, Download, Gamepad2, ImagePlus, Pencil, RadioTower, RotateCcw, Trash2, Users } from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n/react";
import { BATTLE_BACKGROUND_IMPORT_ACCEPT } from "../storage/db";
import type { LoadedBattleBackground, LoadedFighter, LocalBattleMode, PlayerSlot } from "../types/game";

export interface LocalFighterSelection {
  p1: string;
  p2: string;
  activeSlot: PlayerSlot;
  mode: LocalBattleMode;
}

export function LocalFighterSelectView(props: {
  fighters: LoadedFighter[];
  selected: LocalFighterSelection;
  fileStatus: string;
  backgroundStatus: string;
  battleBackground?: LoadedBattleBackground;
  onSelected: (next: LocalFighterSelection) => void;
  onExport: (fighter: LoadedFighter) => Promise<void>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onImportBackgroundFile: (file: File) => Promise<void>;
  onClearBackground: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="select-view">
      <SetupHeader eyebrow={t("select.localFight")} title={t("select.chooseFighters")} onBack={props.onBack}>
        <button className="primary-button" type="button" onClick={props.onNext}>
          <Gamepad2 size={18} />
          {t("select.startBattle")}
        </button>
      </SetupHeader>

      <LocalBattleModePicker
        mode={props.selected.mode}
        onModeChange={(mode) => props.onSelected({ ...props.selected, mode })}
      />

      <div className="cursor-panel" aria-label={t("select.activePlayerCursor")}>
        <span className="field-label-text">{t("select.activeCursor")}</span>
        <div className="player-cursor-toggle">
          <button
            className={props.selected.activeSlot === "p1" ? "cursor-button p1 active" : "cursor-button p1"}
            type="button"
            onClick={() => props.onSelected({ ...props.selected, activeSlot: "p1" })}
          >
            P1
          </button>
          <button
            className={props.selected.activeSlot === "p2" ? "cursor-button p2 active" : "cursor-button p2"}
            type="button"
            onClick={() => props.onSelected({ ...props.selected, activeSlot: "p2" })}
          >
            P2
          </button>
        </div>
      </div>

      {props.fileStatus && <p className="helper-text select-status">{props.fileStatus}</p>}
      <FighterGrid
        fighters={props.fighters}
        localSelection={props.selected}
        onSelect={(id) => props.onSelected({ ...props.selected, [props.selected.activeSlot]: id })}
        onExport={props.onExport}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />

      <StagePicker
        battleBackground={props.battleBackground}
        backgroundStatus={props.backgroundStatus}
        onImportBackgroundFile={props.onImportBackgroundFile}
        onClearBackground={props.onClearBackground}
      />
    </section>
  );
}

function LocalBattleModePicker(props: { mode: LocalBattleMode; onModeChange: (mode: LocalBattleMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="local-mode-panel" aria-label={t("select.localBattleMode")}>
      <span className="field-label-text">{t("select.localBattleMode")}</span>
      <div className="local-mode-options">
        {LOCAL_BATTLE_MODE_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              className={props.mode === option.mode ? "local-mode-button active" : "local-mode-button"}
              type="button"
              key={option.mode}
              onClick={() => props.onModeChange(option.mode)}
            >
              <Icon size={18} />
              <span>{t(option.labelKey)}</span>
              <small>{t(option.detailKey)}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const LOCAL_BATTLE_MODE_OPTIONS: Array<{
  mode: LocalBattleMode;
  labelKey: MessageKey;
  detailKey: MessageKey;
  icon: typeof Users;
}> = [
  { mode: "p1-vs-p2", labelKey: "select.modeP1VsP2", detailKey: "select.modeP1VsP2Detail", icon: Users },
  { mode: "p1-vs-cpu", labelKey: "select.modeP1VsCpu", detailKey: "select.modeP1VsCpuDetail", icon: Bot },
  { mode: "cpu-vs-cpu", labelKey: "select.modeCpuVsCpu", detailKey: "select.modeCpuVsCpuDetail", icon: Cpu },
];

export function OnlineFighterSelectView(props: {
  role: "host" | "guest";
  fighters: LoadedFighter[];
  selectedId: string;
  fileStatus: string;
  backgroundStatus?: string;
  battleBackground?: LoadedBattleBackground;
  onSelected: (id: string) => void;
  onExport: (fighter: LoadedFighter) => Promise<void>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onImportBackgroundFile?: (file: File) => Promise<void>;
  onClearBackground?: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="select-view">
      <SetupHeader eyebrow={props.role === "host" ? t("select.remoteHost") : t("select.remoteGuest")} title={t("select.chooseFighter")} onBack={props.onBack}>
        <button className="primary-button" type="button" onClick={props.onNext}>
          <RadioTower size={18} />
          {props.role === "host" ? t("select.createInvite") : t("select.joinInvite")}
        </button>
      </SetupHeader>

      <div className="cursor-panel single-cursor" aria-label={t("select.remoteFighterCursor")}>
        <span className="field-label-text">{props.role === "host" ? t("select.hostFighter") : t("select.guestFighter")}</span>
        <span className="cursor-badge online">{props.role === "host" ? "P1" : "P2"}</span>
      </div>

      {props.fileStatus && <p className="helper-text select-status">{props.fileStatus}</p>}
      <FighterGrid
        fighters={props.fighters}
        onlineSelectedId={props.selectedId}
        onlineSlot={props.role === "host" ? "p1" : "p2"}
        onSelect={props.onSelected}
        onExport={props.onExport}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />

      {props.role === "host" && props.onImportBackgroundFile && props.onClearBackground && (
        <StagePicker
          battleBackground={props.battleBackground}
          backgroundStatus={props.backgroundStatus ?? ""}
          onImportBackgroundFile={props.onImportBackgroundFile}
          onClearBackground={props.onClearBackground}
        />
      )}
    </section>
  );
}

function SetupHeader(props: { eyebrow: string; title: string; onBack: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="duel-header">
      <div>
        <p className="eyebrow">{props.eyebrow}</p>
        <h2>{props.title}</h2>
      </div>
      <div className="action-row">
        <button className="secondary-button" type="button" onClick={props.onBack}>
          <ArrowLeft size={18} />
          {t("common.back")}
        </button>
        {props.children}
      </div>
    </div>
  );
}

function StagePicker(props: {
  backgroundStatus: string;
  battleBackground?: LoadedBattleBackground;
  onImportBackgroundFile: (file: File) => Promise<void>;
  onClearBackground: () => Promise<void>;
}) {
  const { t } = useI18n();
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="stage-picker">
      <div className="background-preview" aria-hidden="true">
        {props.battleBackground ? <img src={props.battleBackground.imageUrl} alt="" /> : <div className="background-preview-default" />}
      </div>
      <div className="stage-details">
        <div className="stage-title">
          <span className="field-label-text">{t("select.battleBackground")}</span>
          <strong>{props.battleBackground?.name ?? t("common.defaultArena")}</strong>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={() => backgroundInputRef.current?.click()}>
            <ImagePlus size={18} />
            {t("select.importBackground")}
          </button>
          <input
            ref={backgroundInputRef}
            className="sr-only"
            type="file"
            accept={BATTLE_BACKGROUND_IMPORT_ACCEPT}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void props.onImportBackgroundFile(file);
              }
            }}
          />
          <button className="secondary-button" type="button" onClick={() => void props.onClearBackground()} disabled={!props.battleBackground}>
            <RotateCcw size={18} />
            {t("common.reset")}
          </button>
        </div>
        {props.backgroundStatus && <p className="helper-text">{props.backgroundStatus}</p>}
      </div>
    </div>
  );
}

function FighterGrid(props: {
  fighters: LoadedFighter[];
  localSelection?: LocalFighterSelection;
  onlineSelectedId?: string;
  onlineSlot?: PlayerSlot;
  onSelect: (id: string) => void;
  onExport: (fighter: LoadedFighter) => Promise<void>;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="fighter-grid">
      {props.fighters.map((fighter) => {
        const selectedSlots = getSelectedSlots(props, fighter.id);
        const classes = ["fighter-card", "fighter-grid-card"];
        if (selectedSlots.length > 0) {
          classes.push("selected");
        }
        if (props.localSelection?.activeSlot && selectedSlots.includes(props.localSelection.activeSlot)) {
          classes.push("active-cursor-card");
        }
        return (
          <article className={classes.join(" ")} key={fighter.id}>
            <button type="button" className="fighter-pick" onClick={() => props.onSelect(fighter.id)}>
              <span className="fighter-portrait">
                <img src={fighter.spriteFrameUrls?.idle1 || fighter.frameUrls.idle} alt="" />
                <span className="fighter-markers" aria-hidden="true">
                  {selectedSlots.map((slot) => (
                    <span className={`cursor-badge ${slot}`} key={slot}>
                      {slot.toUpperCase()}
                    </span>
                  ))}
                </span>
              </span>
              <span>{fighter.name}</span>
            </button>
            <div className="fighter-card-actions">
              <button className="icon-button" type="button" onClick={() => props.onEdit(fighter.id)} title={t("select.editFighter")}>
                <Pencil size={17} />
                <span className="sr-only">{t("select.editNamedFighter", { name: fighter.name })}</span>
              </button>
              <button className="icon-button" type="button" onClick={() => void props.onExport(fighter)} title={t("select.exportFighter")}>
                <Download size={17} />
                <span className="sr-only">{t("select.exportNamedFighter", { name: fighter.name })}</span>
              </button>
              {!fighter.isDefault && (
                <button className="icon-button danger" type="button" onClick={() => void props.onDelete(fighter.id)} title={t("select.deleteFighter")}>
                  <Trash2 size={17} />
                  <span className="sr-only">{t("select.deleteNamedFighter", { name: fighter.name })}</span>
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function getSelectedSlots(
  props: { localSelection?: LocalFighterSelection; onlineSelectedId?: string; onlineSlot?: PlayerSlot },
  fighterId: string,
): PlayerSlot[] {
  if (props.localSelection) {
    const slots: PlayerSlot[] = [];
    if (props.localSelection.p1 === fighterId) {
      slots.push("p1");
    }
    if (props.localSelection.p2 === fighterId) {
      slots.push("p2");
    }
    return slots;
  }
  return props.onlineSelectedId === fighterId && props.onlineSlot ? [props.onlineSlot] : [];
}
