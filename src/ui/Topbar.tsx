import { Camera, Gamepad2 } from "lucide-react";
import type { MouseEvent } from "react";
import { useI18n } from "../i18n/react";
import { appRouteToHref, type AppRoute, type View } from "./routes";

export function Topbar(props: { view: View; onNavigate: (route: AppRoute) => void }) {
  const { t } = useI18n();
  const onRouteClick = (event: MouseEvent<HTMLAnchorElement>, route: AppRoute) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    props.onNavigate(route);
  };

  const fightActive = props.view === "menu" || props.view === "fighterSelect" || props.view === "online";

  return (
    <header className="topbar">
      <a className="brand-button" href={appRouteToHref("menu")} onClick={(event) => onRouteClick(event, "menu")}>
        <span className="brand-mark">PF</span>
        <span>{t("app.brand")}</span>
      </a>
      <nav className="nav-cluster" aria-label={t("nav.primary")}>
        <a
          className={props.view === "creator" ? "icon-button active" : "icon-button"}
          href={appRouteToHref("creator")}
          onClick={(event) => onRouteClick(event, "creator")}
          aria-current={props.view === "creator" ? "page" : undefined}
          aria-label={t("nav.createFighter")}
          title={t("nav.createFighter")}
        >
          <Camera size={19} />
        </a>
        <a
          className={fightActive ? "icon-button active" : "icon-button"}
          href={appRouteToHref("menu")}
          onClick={(event) => onRouteClick(event, "menu")}
          aria-current={fightActive ? "page" : undefined}
          aria-label={t("nav.fightOptions")}
          title={t("nav.fightOptions")}
        >
          <Gamepad2 size={19} />
        </a>
      </nav>
    </header>
  );
}
