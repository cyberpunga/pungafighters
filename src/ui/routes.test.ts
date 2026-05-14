import { describe, expect, it } from "vitest";
import { appRouteFromPathname, appRouteToHref, normalizeBasePath } from "./routes";

describe("app routes", () => {
  it("maps view paths to app routes", () => {
    expect(appRouteFromPathname("/", "/")).toBe("menu");
    expect(appRouteFromPathname("/creator", "/")).toBe("creator");
    expect(appRouteFromPathname("/select", "/")).toBe("select");
    expect(appRouteFromPathname("/settings", "/")).toBe("settings");
    expect(appRouteFromPathname("/online/host", "/")).toBe("onlineHost");
    expect(appRouteFromPathname("/online/join", "/")).toBe("onlineGuest");
    expect(appRouteFromPathname("/battle", "/")).toBe("battle");
  });

  it("resolves paths under the GitHub Pages base", () => {
    expect(appRouteFromPathname("/pungafighters/select", "/pungafighters/")).toBe("select");
    expect(appRouteFromPathname("/pungafighters/online/join", "/pungafighters/")).toBe("onlineGuest");
    expect(appRouteToHref("settings", "/pungafighters/")).toBe("/pungafighters/settings");
  });

  it("normalizes base paths", () => {
    expect(normalizeBasePath("pungafighters")).toBe("/pungafighters/");
    expect(normalizeBasePath("/pungafighters")).toBe("/pungafighters/");
    expect(normalizeBasePath(".")).toBe("/");
  });
});
