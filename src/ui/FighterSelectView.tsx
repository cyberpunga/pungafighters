import { Download, Gamepad2, ImagePlus, RadioTower, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { FIGHTER_IMPORT_ACCEPT } from "../creator/fighterFiles";
import { BATTLE_BACKGROUND_IMPORT_ACCEPT } from "../storage/db";
import type { LoadedBattleBackground, LoadedFighter } from "../types/game";

export function FighterSelectView(props: {
  fighters: LoadedFighter[];
  selected: { p1: string; p2: string };
  fileStatus: string;
  backgroundStatus: string;
  battleBackground?: LoadedBattleBackground;
  onSelected: (next: { p1: string; p2: string }) => void;
  onImportFile: (file: File) => Promise<void>;
  onImportBackgroundFile: (file: File) => Promise<void>;
  onClearBackground: () => Promise<void>;
  onExport: (fighter: LoadedFighter) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFight: () => void;
  onHostOnline: () => void;
  onJoinOnline: () => void;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section className="select-view">
      <div className="duel-header">
        <div>
          <p className="eyebrow">Choose your corners</p>
          <h2>Fighter Select</h2>
        </div>
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>
            <Upload size={18} />
            Import
          </button>
          <input
            ref={importInputRef}
            className="sr-only"
            type="file"
            accept={FIGHTER_IMPORT_ACCEPT}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void props.onImportFile(file);
              }
            }}
          />
          <button className="secondary-button" type="button" onClick={props.onHostOnline}>
            <RadioTower size={18} />
            Host Online
          </button>
          <button className="secondary-button" type="button" onClick={props.onJoinOnline}>
            <RadioTower size={18} />
            Join Online
          </button>
          <button className="primary-button" type="button" onClick={props.onFight}>
            <Gamepad2 size={18} />
            Start Battle
          </button>
        </div>
      </div>
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
      {props.fileStatus && <p className="helper-text select-status">{props.fileStatus}</p>}
      <div className="select-columns">
        <FighterColumn
          slot="p1"
          fighters={props.fighters}
          selectedId={props.selected.p1}
          onSelect={(id) => props.onSelected({ ...props.selected, p1: id })}
          onExport={props.onExport}
          onDelete={props.onDelete}
        />
        <FighterColumn
          slot="p2"
          fighters={props.fighters}
          selectedId={props.selected.p2}
          onSelect={(id) => props.onSelected({ ...props.selected, p2: id })}
          onExport={props.onExport}
          onDelete={props.onDelete}
        />
      </div>
    </section>
  );
}

function FighterColumn(props: {
  slot: "p1" | "p2";
  fighters: LoadedFighter[];
  selectedId: string;
  onSelect: (id: string) => void;
  onExport: (fighter: LoadedFighter) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <div className="fighter-column">
      <h3>{props.slot === "p1" ? "Player 1" : "Player 2"}</h3>
      <div className="fighter-list">
        {props.fighters.map((fighter) => (
          <article className={props.selectedId === fighter.id ? "fighter-card selected" : "fighter-card"} key={`${props.slot}-${fighter.id}`}>
            <button type="button" className="fighter-pick" onClick={() => props.onSelect(fighter.id)}>
              <img src={fighter.frameUrls.idle} alt="" />
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
        ))}
      </div>
    </div>
  );
}
