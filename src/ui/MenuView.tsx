import { Camera, Gamepad2 } from "lucide-react";
import type { LoadedFighter } from "../types/game";

export function MenuView(props: { fighters: LoadedFighter[]; loading: boolean; onCreate: () => void; onSelect: () => void }) {
  const savedCount = props.fighters.filter((fighter) => !fighter.isDefault).length;
  return (
    <section className="menu-stage">
      <div className="hero-copy">
        <p className="eyebrow">Local webcam fighter</p>
        <h1>Punga Fighters</h1>
        <p>
          Build cutout fighters from your camera, save them locally, then fight on one keyboard or through a manual remote invite.
        </p>
        <div className="action-row">
          <button className="primary-button" type="button" onClick={props.onCreate}>
            <Camera size={19} />
            Create
          </button>
          <button className="secondary-button" type="button" onClick={props.onSelect}>
            <Gamepad2 size={19} />
            Fight
          </button>
        </div>
      </div>
      <div className="fighter-marquee" aria-label="Fighter gallery">
        {props.fighters.slice(0, 4).map((fighter) => (
          <div className="fighter-card marquee-card" key={fighter.id}>
            <img src={fighter.frameUrls.idle} alt="" />
            <strong>{fighter.name}</strong>
          </div>
        ))}
      </div>
      <footer className="status-strip">
        <span>{props.loading ? "Loading fighters" : `${savedCount} saved custom fighters`}</span>
        <span>Local-only IndexedDB saves</span>
        <span>Best of 3 rounds</span>
      </footer>
    </section>
  );
}
