import { Camera, Gamepad2, Monitor, RadioTower, Sparkles, Trophy, Users } from "lucide-react";
import type { LoadedFighter } from "../types/game";
import { useI18n } from "../i18n/react";

export function MenuView(props: {
  fighters: LoadedFighter[];
  loading: boolean;
  onCreate: () => void;
  onLocal: () => void;
  onHost: () => void;
  onJoin: () => void;
}) {
  const { t } = useI18n();
  const savedCount = props.fighters.filter((fighter) => !fighter.isDefault).length;
  const featuredFighters = props.fighters.slice(0, 4);
  const [leftFighter, rightFighter] = featuredFighters;
  const fighterCountLabel = props.loading ? t("common.loading") : t("menu.readyCount", { count: props.fighters.length });
  const savedCountLabel = props.loading ? t("menu.loadingSaves") : t("menu.customSavedCount", { count: savedCount });

  return (
    <section className="home-view">
      <div className="home-hero-band">
        <div className="hero-copy">
          <p className="eyebrow">{t("menu.eyebrow")}</p>
          <h1>{t("app.brand")}</h1>
          <p>{t("menu.subtitle")}</p>
          <div className="home-quick-actions">
            <button className="primary-button" type="button" onClick={props.onCreate}>
              <Camera size={19} />
              {t("menu.createFighter")}
            </button>
            <button className="secondary-button" type="button" onClick={props.onLocal}>
              <Gamepad2 size={19} />
              {t("menu.startFight")}
            </button>
          </div>
          <div className="home-stat-row" aria-label={t("menu.fighterStatus")}>
            <span>
              <strong>{fighterCountLabel}</strong>
              {t("menu.fighters")}
            </span>
            <span>
              <strong>{savedCountLabel}</strong>
              {t("menu.savesStore")}
            </span>
            <span>
              <strong>{t("menu.bestOf3")}</strong>
              {t("menu.rounds")}
            </span>
          </div>
        </div>

        <div className="home-versus-stage" aria-label={t("menu.featuredFighters")}>
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
          <p className="eyebrow">{t("menu.fightDesk")}</p>
          <h2>{t("menu.pickLane")}</h2>
        </div>
        <div className="fight-mode-grid home-fight-options" aria-label={t("menu.chooseMatch")}>
          <button className="mode-card local-card" type="button" onClick={props.onLocal}>
            <Users size={28} />
            <strong>{t("menu.localFight")}</strong>
            <span>{t("menu.localFightDetail")}</span>
          </button>
          <button className="mode-card host-card" type="button" onClick={props.onHost}>
            <RadioTower size={28} />
            <strong>{t("menu.hostRemote")}</strong>
            <span>{t("menu.hostRemoteDetail")}</span>
          </button>
          <button className="mode-card join-card" type="button" onClick={props.onJoin}>
            <Monitor size={28} />
            <strong>{t("menu.joinRemote")}</strong>
            <span>{t("menu.joinRemoteDetail")}</span>
          </button>
        </div>
      </div>

      <div className="home-roster-band">
        <div className="home-panel-heading">
          <p className="eyebrow">{t("menu.roster")}</p>
          <h2>{savedCountLabel}</h2>
        </div>
        <div className="fighter-marquee" aria-label={t("menu.fighterGallery")}>
          {featuredFighters.map((fighter) => (
            <div className="fighter-card marquee-card" key={fighter.id}>
              <img src={fighter.spriteFrameUrls?.idle1 || fighter.frameUrls.idle} alt="" />
              <strong>{fighter.name}</strong>
              <span>{fighter.isDefault ? t("menu.defaultFighter") : t("menu.customFighter")}</span>
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
      <img src={props.fighter.spriteFrameUrls?.idle1 || props.fighter.frameUrls.idle} alt="" />
      <div className="featured-fighter-name">
        {props.fighter.isDefault ? <Trophy size={15} /> : <Sparkles size={15} />}
        <strong>{props.fighter.name}</strong>
      </div>
    </div>
  );
}
