import { Gamepad2, RadioTower, Trash2 } from "lucide-react";
import type { LoadedFighter } from "../types/game";

export function FighterSelectView(props: {
  fighters: LoadedFighter[];
  selected: { p1: string; p2: string };
  onSelected: (next: { p1: string; p2: string }) => void;
  onDelete: (id: string) => Promise<void>;
  onFight: () => void;
  onHostOnline: () => void;
  onJoinOnline: () => void;
}) {
  return (
    <section className="select-view">
      <div className="duel-header">
        <div>
          <p className="eyebrow">Choose your corners</p>
          <h2>Fighter Select</h2>
        </div>
        <div className="action-row">
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
      <div className="select-columns">
        <FighterColumn
          slot="p1"
          fighters={props.fighters}
          selectedId={props.selected.p1}
          onSelect={(id) => props.onSelected({ ...props.selected, p1: id })}
          onDelete={props.onDelete}
        />
        <FighterColumn
          slot="p2"
          fighters={props.fighters}
          selectedId={props.selected.p2}
          onSelect={(id) => props.onSelected({ ...props.selected, p2: id })}
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
            {!fighter.isDefault && (
              <button className="icon-button danger" type="button" onClick={() => void props.onDelete(fighter.id)} title="Delete fighter">
                <Trash2 size={17} />
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
