import { describe, expect, it } from "vitest";
import { appRouteFromPathname, appRouteToHref, normalizeBasePath } from "./routes";

describe("app routes", () => {
  it("maps view paths to app routes", () => {
    expect(appRouteFromPathname("/", "/")).toBe("menu");
    expect(appRouteFromPathname("/creator", "/")).toBe("creator");
    expect(appRouteFromPathname("/fight", "/")).toBe("fight");
    expect(appRouteFromPathname("/select", "/")).toBe("fight");
    expect(appRouteFromPathname("/fight/local/fighters", "/")).toBe("localFighters");
    expect(appRouteFromPathname("/fight/local/background", "/")).toBe("localBackground");
    expect(appRouteFromPathname("/fight/remote/host/fighter", "/")).toBe("remoteHostFighter");
    expect(appRouteFromPathname("/fight/remote/host/background", "/")).toBe("remoteHostBackground");
    expect(appRouteFromPathname("/fight/remote/join/fighter", "/")).toBe("remoteJoinFighter");
    expect(appRouteFromPathname("/settings", "/")).toBe("settings");
    expect(appRouteFromPathname("/online/host", "/")).toBe("onlineHost");
    expect(appRouteFromPathname("/online/join", "/")).toBe("onlineGuest");
    expect(appRouteFromPathname("/battle", "/")).toBe("battle");
  });

  it("resolves paths under the GitHub Pages base", () => {
    expect(appRouteFromPathname("/pungafighters/fight/local/background", "/pungafighters/")).toBe("localBackground");
    expect(appRouteFromPathname("/pungafighters/online/join", "/pungafighters/")).toBe("onlineGuest");
    expect(appRouteToHref("settings", "/pungafighters/")).toBe("/pungafighters/settings");
    expect(appRouteToHref("fight", "/pungafighters/")).toBe("/pungafighters/fight");
  });

  it("normalizes base paths", () => {
    expect(normalizeBasePath("pungafighters")).toBe("/pungafighters/");
    expect(normalizeBasePath("/pungafighters")).toBe("/pungafighters/");
    expect(normalizeBasePath(".")).toBe("/");
  });
});
