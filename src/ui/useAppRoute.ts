import { useCallback, useEffect, useState } from "react";
import {
  appRouteFromLocation,
  appRouteToHref,
  creatorEditFighterIdFromPathname,
  type AppRoute,
} from "./routes";

export function useAppRoute(): [AppRoute, (route: AppRoute, options?: { href?: string; replace?: boolean }) => void, string] {
  const [locationState, setLocationState] = useState(() => ({
    route: appRouteFromLocation(window.location),
    pathname: window.location.pathname,
  }));
  const { route, pathname } = locationState;

  useEffect(() => {
    const onPopState = () =>
      setLocationState({
        route: appRouteFromLocation(window.location),
        pathname: window.location.pathname,
      });
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (route === "creator" && creatorEditFighterIdFromPathname(window.location.pathname)) {
      return;
    }
    const href = appRouteToHref(route);
    if (window.location.pathname !== href) {
      window.history.replaceState({ appRoute: route }, "", href);
    }
  }, [route]);

  const navigate = useCallback((nextRoute: AppRoute, options?: { href?: string; replace?: boolean }) => {
    const href = options?.href ?? appRouteToHref(nextRoute);
    if (window.location.pathname !== href) {
      const method = options?.replace ? "replaceState" : "pushState";
      window.history[method]({ appRoute: nextRoute }, "", href);
    }
    setLocationState({ route: nextRoute, pathname: window.location.pathname });
  }, []);

  return [route, navigate, pathname];
}
