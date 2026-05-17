import { Camera, Gamepad2, Monitor, RadioTower, Sparkles, Trophy, Users } from "lucide-react";
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
  const featuredFighters = props.fighters.slice(0, 4);
  const [leftFighter, rightFighter] = featuredFighters;
  const fighterCountLabel = props.loading ? "Loading" : `${props.fighters.length} ready`;
  const savedCountLabel = props.loading ? "Loading saves" : `${savedCount} custom saved`;

  return (
    <section className="home-view">
      <div className="home-hero-band">
        <div className="hero-copy">
          <p className="eyebrow">Camera cutout arena</p>
          <h1>Punga Fighters</h1>
          <p>Build a fighter, choose a rival, and jump into a fast local bout.</p>
          <div className="home-quick-actions">
            <button className="primary-button" type="button" onClick={props.onCreate}>
              <Camera size={19} />
              Create Fighter
            </button>
            <button className="secondary-button" type="button" onClick={props.onLocal}>
              <Gamepad2 size={19} />
              Start Fight
            </button>
          </div>
          <div className="home-stat-row" aria-label="Fighter status">
            <span>
              <strong>{fighterCountLabel}</strong>
              Fighters
            </span>
            <span>
              <strong>{savedCountLabel}</strong>
              IndexedDB
            </span>
            <span>
              <strong>Best of 3</strong>
              Rounds
            </span>
          </div>
        </div>

        <div className="home-versus-stage" aria-label="Featured fighters">
          <div className="versus-grid">
            {leftFighter && <FeaturedFighter fighter={leftFighter} side="left" />}
            <div className="versus-badge" aria-hidden="true">
              VS
            </div>
            {rightFighter && <FeaturedFighter fighter={rightFighter} side="right" />}
          </div>
          <div className="stage-lines" aria-hidden="true" />
        </div>
      </div>

      <div className="home-lobby-grid">
        <div className="home-panel-heading">
          <p className="eyebrow">Fight desk</p>
          <h2>Pick a lane</h2>
        </div>
        <div className="fight-mode-grid home-fight-options" aria-label="Choose the match">
          <button className="mode-card local-card" type="button" onClick={props.onLocal}>
            <Users size={28} />
            <strong>Local Fight</strong>
            <span>Keyboard duels, CPU sparring, and quick arena selection.</span>
          </button>
          <button className="mode-card host-card" type="button" onClick={props.onHost}>
            <RadioTower size={28} />
            <strong>Host Remote</strong>
            <span>Create a manual invite after choosing your fighter and stage.</span>
          </button>
          <button className="mode-card join-card" type="button" onClick={props.onJoin}>
            <Monitor size={28} />
            <strong>Join Remote</strong>
            <span>Bring your local fighter into a pasted host offer.</span>
          </button>
        </div>
      </div>

      <div className="home-roster-band">
        <div className="home-panel-heading">
          <p className="eyebrow">Roster</p>
          <h2>{savedCountLabel}</h2>
        </div>
        <div className="fighter-marquee" aria-label="Fighter gallery">
          {featuredFighters.map((fighter) => (
            <div className="fighter-card marquee-card" key={fighter.id}>
              <img src={fighter.frameUrls.idle} alt="" />
              <strong>{fighter.name}</strong>
              <span>{fighter.isDefault ? "Default fighter" : "Custom fighter"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedFighter(props: { fighter: LoadedFighter; side: "left" | "right" }) {
  return (
    <div className={`featured-fighter ${props.side}`}>
      <img src={props.fighter.frameUrls.idle} alt="" />
      <div className="featured-fighter-name">
        {props.fighter.isDefault ? <Trophy size={15} /> : <Sparkles size={15} />}
        <strong>{props.fighter.name}</strong>
      </div>
    </div>
  );
}
