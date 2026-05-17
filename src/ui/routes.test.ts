import { describe, expect, it } from "vitest";
import { appRouteFromPathname, appRouteToHref, normalizeBasePath } from "./routes";

describe("app routes", () => {
  it("maps view paths to app routes", () => {
    expect(appRouteFromPathname("/", "/")).toBe("menu");
    expect(appRouteFromPathname("/creator", "/")).toBe("creator");
    expect(appRouteFromPathname("/fight", "/")).toBe("menu");
    expect(appRouteFromPathname("/select", "/")).toBe("menu");
    expect(appRouteFromPathname("/local/fighters", "/")).toBe("localFighters");
    expect(appRouteFromPathname("/local/background", "/")).toBe("localFighters");
    expect(appRouteFromPathname("/remote/host/fighter", "/")).toBe("remoteHostFighter");
    expect(appRouteFromPathname("/remote/host/background", "/")).toBe("remoteHostFighter");
    expect(appRouteFromPathname("/remote/join/fighter", "/")).toBe("remoteJoinFighter");
    expect(appRouteFromPathname("/settings", "/")).toBe("settings");
    expect(appRouteFromPathname("/online/host", "/")).toBe("onlineHost");
    expect(appRouteFromPathname("/online/join", "/")).toBe("onlineGuest");
    expect(appRouteFromPathname("/battle", "/")).toBe("battle");
  });

  it("resolves paths under the GitHub Pages base", () => {
    expect(appRouteFromPathname("/pungafighters/local/background", "/pungafighters/")).toBe("localFighters");
    expect(appRouteFromPathname("/pungafighters/online/join", "/pungafighters/")).toBe("onlineGuest");
    expect(appRouteToHref("settings", "/pungafighters/")).toBe("/pungafighters/settings");
    expect(appRouteToHref("localFighters", "/pungafighters/")).toBe("/pungafighters/local/fighters");
  });

  it("keeps legacy fight setup links routable without a canonical /fight route", () => {
    expect(appRouteFromPathname("/fight/local/fighters", "/")).toBe("localFighters");
    expect(appRouteFromPathname("/fight/remote/host/fighter", "/")).toBe("remoteHostFighter");
    expect(appRouteFromPathname("/fight/remote/join/fighter", "/")).toBe("remoteJoinFighter");
  });

  it("normalizes base paths", () => {
    expect(normalizeBasePath("pungafighters")).toBe("/pungafighters/");
    expect(normalizeBasePath("/pungafighters")).toBe("/pungafighters/");
    expect(normalizeBasePath(".")).toBe("/");
  });
});
