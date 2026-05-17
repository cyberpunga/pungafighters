import { Camera, Monitor, RadioTower, Users } from "lucide-react";
import type { LoadedFighter } from "../types/game";

export function MenuView(props: {
  fighters: LoadedFighter[];
  loading: boolean;
  onCreate: () => void;
  onLocal: () => void;
  onHost: () => void;
  onJoin: () => void;
}) {
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
      <div className="fight-mode-grid home-fight-options" aria-label="Choose the match">
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
      <footer className="status-strip">
        <span>{props.loading ? "Loading fighters" : `${savedCount} saved custom fighters`}</span>
        <span>Local-only IndexedDB saves</span>
        <span>Best of 3 rounds</span>
      </footer>
    </section>
  );
}
