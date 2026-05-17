import { ArrowLeft, Bot, Cpu, Download, Gamepad2, ImagePlus, Monitor, RadioTower, RotateCcw, Trash2, Users } from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";
import { BATTLE_BACKGROUND_IMPORT_ACCEPT } from "../storage/db";
import type { LoadedBattleBackground, LoadedFighter, LocalBattleMode, PlayerSlot } from "../types/game";

export interface LocalFighterSelection {
  p1: string;
  p2: string;
  activeSlot: PlayerSlot;
  mode: LocalBattleMode;
}

export function FightModeView(props: { onLocal: () => void; onHost: () => void; onJoin: () => void }) {
  return (
    <section className="select-view">
      <div className="duel-header">
        <div>
          <p className="eyebrow">Choose the match</p>
          <h2>Fight Setup</h2>
        </div>
      </div>

      <div className="fight-mode-grid">
        <button className="mode-card" type="button" onClick={props.onLocal}>
          <Users size={28} />
          <strong>Local Fight</strong>
          <span>Choose 1 vs 2, 1 vs CPU, or CPU vs CPU on this device.</span>
        </button>
        <button className="mode-card" type="button" onClick={props.onHost}>
          <RadioTower size={28} />
          <strong>Host Remote</strong>
          <span>Pick your fighter and arena, then send an invite.</span>
        </button>
        <button className="mode-card" type="button" onClick={props.onJoin}>
          <Monitor size={28} />
          <strong>Join Remote</strong>
          <span>Pick your fighter, then paste the host offer.</span>
        </button>
      </div>
    </section>
  );
}

export function LocalFighterSelectView(props: {
  fighters: LoadedFighter[];
  selected: LocalFighterSelection;
  fileStatus: string;
  backgroundStatus: string;
  battleBackground?: LoadedBattleBackground;
  onSelected: (next: LocalFighterSelection) => void;
  onExport: (fighter: LoadedFighter) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onImportBackgroundFile: (file: File) => Promise<void>;
  onClearBackground: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section className="select-view">
      <SetupHeader eyebrow="Local fight" title="Choose Fighters" onBack={props.onBack}>
        <button className="primary-button" type="button" onClick={props.onNext}>
          <Gamepad2 size={18} />
          Start Battle
        </button>
      </SetupHeader>

      <LocalBattleModePicker
        mode={props.selected.mode}
        onModeChange={(mode) => props.onSelected({ ...props.selected, mode })}
      />

      <div className="cursor-panel" aria-label="Active player cursor">
        <span className="field-label-text">Active cursor</span>
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

      <StagePicker
        battleBackground={props.battleBackground}
        backgroundStatus={props.backgroundStatus}
        onImportBackgroundFile={props.onImportBackgroundFile}
        onClearBackground={props.onClearBackground}
      />

      {props.fileStatus && <p className="helper-text select-status">{props.fileStatus}</p>}
      <FighterGrid
        fighters={props.fighters}
        localSelection={props.selected}
        onSelect={(id) => props.onSelected({ ...props.selected, [props.selected.activeSlot]: id })}
        onExport={props.onExport}
        onDelete={props.onDelete}
      />
    </section>
  );
}

function LocalBattleModePicker(props: { mode: LocalBattleMode; onModeChange: (mode: LocalBattleMode) => void }) {
  return (
    <div className="local-mode-panel" aria-label="Local battle mode">
      <span className="field-label-text">Local battle mode</span>
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
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const LOCAL_BATTLE_MODE_OPTIONS: Array<{
  mode: LocalBattleMode;
  label: string;
  detail: string;
  icon: typeof Users;
}> = [
  { mode: "p1-vs-p2", label: "1 vs 2", detail: "Both sides use local keys.", icon: Users },
  { mode: "p1-vs-cpu", label: "1 vs CPU", detail: "P1 fights a CPU opponent.", icon: Bot },
  { mode: "cpu-vs-cpu", label: "CPU vs CPU", detail: "Watch two CPU fighters spar.", icon: Cpu },
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
  onDelete: (id: string) => Promise<void>;
  onImportBackgroundFile?: (file: File) => Promise<void>;
  onClearBackground?: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <section className="select-view">
      <SetupHeader eyebrow={props.role === "host" ? "Remote host" : "Remote guest"} title="Choose Fighter" onBack={props.onBack}>
        <button className="primary-button" type="button" onClick={props.onNext}>
          <RadioTower size={18} />
          {props.role === "host" ? "Create Invite" : "Join Invite"}
        </button>
      </SetupHeader>

      <div className="cursor-panel single-cursor" aria-label="Remote fighter cursor">
        <span className="field-label-text">{props.role === "host" ? "Host fighter" : "Guest fighter"}</span>
        <span className="cursor-badge online">{props.role === "host" ? "P1" : "P2"}</span>
      </div>

      {props.role === "host" && props.onImportBackgroundFile && props.onClearBackground && (
        <StagePicker
          battleBackground={props.battleBackground}
          backgroundStatus={props.backgroundStatus ?? ""}
          onImportBackgroundFile={props.onImportBackgroundFile}
          onClearBackground={props.onClearBackground}
        />
      )}

      {props.fileStatus && <p className="helper-text select-status">{props.fileStatus}</p>}
      <FighterGrid
        fighters={props.fighters}
        onlineSelectedId={props.selectedId}
        onlineSlot={props.role === "host" ? "p1" : "p2"}
        onSelect={props.onSelected}
        onExport={props.onExport}
        onDelete={props.onDelete}
      />
    </section>
  );
}

function SetupHeader(props: { eyebrow: string; title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="duel-header">
      <div>
        <p className="eyebrow">{props.eyebrow}</p>
        <h2>{props.title}</h2>
      </div>
      <div className="action-row">
        <button className="secondary-button" type="button" onClick={props.onBack}>
          <ArrowLeft size={18} />
          Back
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
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="stage-picker">
      <div className="stage-preview" aria-hidden="true">
        {props.battleBackground ? <img src={props.battleBackground.imageUrl} alt="" /> : <div className="stage-preview-default" />}
      </div>
      <div className="stage-details">
        <div className="stage-title">
          <span className="field-label-text">Battle Background</span>
          <strong>{props.battleBackground?.name ?? "Default Arena"}</strong>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={() => backgroundInputRef.current?.click()}>
            <ImagePlus size={18} />
            Import Background
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
            Reset
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
  onDelete: (id: string) => Promise<void>;
}) {
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
                <img src={fighter.frameUrls.idle} alt="" />
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
              <button className="icon-button" type="button" onClick={() => void props.onExport(fighter)} title="Export fighter">
                <Download size={17} />
              </button>
              {!fighter.isDefault && (
                <button className="icon-button danger" type="button" onClick={() => void props.onDelete(fighter.id)} title="Delete fighter">
                  <Trash2 size={17} />
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
