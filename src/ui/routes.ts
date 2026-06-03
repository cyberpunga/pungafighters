export type View = "menu" | "creator" | "fighterSelect" | "settings" | "online" | "battle";

export type AppRoute =
  | "menu"
  | "creator"
  | "localFighters"
  | "remoteHostFighter"
  | "remoteJoinFighter"
  | "settings"
  | "onlineHost"
  | "onlineGuest"
  | "battle";

const ROUTE_PATHS: Record<AppRoute, string> = {
  menu: "/",
  creator: "/creator",
  localFighters: "/local/fighters",
  remoteHostFighter: "/remote/host/fighter",
  remoteJoinFighter: "/remote/join/fighter",
  settings: "/settings",
  onlineHost: "/online/host",
  onlineGuest: "/online/join",
  battle: "/battle",
};

type Env = {
  BASE_URL?: string;
};

export function getAppBasePath(): string {
  const env = ((import.meta as ImportMeta & { env?: Env }).env ?? {}) as Env;
  return normalizeBasePath(env.BASE_URL ?? "/");
}

export function appRouteToPath(route: AppRoute): string {
  return ROUTE_PATHS[route];
}

export function appRouteToHref(route: AppRoute, basePath = getAppBasePath()): string {
  const base = normalizeBasePath(basePath);
  const routePath = appRouteToPath(route);
  return base === "/" ? routePath : `${base.slice(0, -1)}${routePath}`;
}

export function creatorEditRouteToHref(fighterId: string, basePath = getAppBasePath()): string {
  const base = normalizeBasePath(basePath);
  const routePath = `/creator/edit/${encodeURIComponent(fighterId)}`;
  return base === "/" ? routePath : `${base.slice(0, -1)}${routePath}`;
}

export function appRouteToView(route: AppRoute): View {
  if (route === "localFighters" || route === "remoteHostFighter" || route === "remoteJoinFighter") {
    return "fighterSelect";
  }
  if (route === "onlineHost" || route === "onlineGuest") {
    return "online";
  }
  return route;
}

export function appRouteFromPathname(pathname: string, basePath = getAppBasePath()): AppRoute {
  const routePath = normalizeRoutePath(stripBasePath(pathname, basePath));
  switch (routePath) {
    case "/":
    case "/menu":
    case "/fight":
    case "/select":
      return "menu";
    case "/creator":
      return "creator";
    default:
      if (routePath.startsWith("/creator/edit/")) {
        return "creator";
      }
      break;
  }

  switch (routePath) {
    case "/local/fighters":
    case "/local/background":
    case "/fight/local/fighters":
    case "/fight/local/background":
      return "localFighters";
    case "/remote/host/fighter":
    case "/remote/host/background":
    case "/fight/remote/host/fighter":
    case "/fight/remote/host/background":
      return "remoteHostFighter";
    case "/remote/join/fighter":
    case "/fight/remote/join/fighter":
      return "remoteJoinFighter";
    case "/settings":
      return "settings";
    case "/online/host":
      return "onlineHost";
    case "/online/join":
      return "onlineGuest";
    case "/battle":
      return "battle";
    default:
      return "menu";
  }
}

export function appRouteFromLocation(location: Pick<Location, "pathname">, basePath = getAppBasePath()): AppRoute {
  return appRouteFromPathname(location.pathname, basePath);
}

export function creatorEditFighterIdFromPathname(pathname: string, basePath = getAppBasePath()): string | undefined {
  const routePath = normalizeRoutePath(stripBasePath(pathname, basePath));
  const prefix = "/creator/edit/";
  if (!routePath.startsWith(prefix)) {
    return undefined;
  }
  const encodedId = routePath.slice(prefix.length);
  if (!encodedId) {
    return undefined;
  }
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return undefined;
  }
}

export function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === ".") {
    return "/";
  }
  const withLeadingSlash = basePath.startsWith("/") ? basePath : `/${basePath}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function stripBasePath(pathname: string, basePath: string): string {
  const base = normalizeBasePath(basePath);
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (base === "/") {
    return path;
  }

  const baseWithoutTrailingSlash = base.slice(0, -1);
  if (path === baseWithoutTrailingSlash) {
    return "/";
  }
  if (path.startsWith(base)) {
    return `/${path.slice(base.length)}`;
  }
  return path;
}

function normalizeRoutePath(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const compact = path.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return (compact || "/").toLowerCase();
}
