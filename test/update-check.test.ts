import { describe, expect, it } from "vitest";
import { checkForPackageUpdate, compareVersions, latestVersionFromRegistry } from "../src/update-check.js";

describe("update check", () => {
  it("detects newer npm versions from dist-tags.latest", async () => {
    const update = await checkForPackageUpdate({
      packageName: "wechat-tui",
      currentVersion: "0.1.1",
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "0.1.2" } })
      })
    });

    expect(update).toEqual({
      packageName: "wechat-tui",
      currentVersion: "0.1.1",
      latestVersion: "0.1.2",
      installCommand: "npm install -g wechat-tui@latest"
    });
  });

  it("returns no update when the installed version is current", async () => {
    const update = await checkForPackageUpdate({
      packageName: "wechat-tui",
      currentVersion: "0.1.2",
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ "dist-tags": { latest: "0.1.2" } })
      })
    });

    expect(update).toBeUndefined();
  });

  it("compares stable and prerelease versions", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.1")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0")).toBe(-1);
  });

  it("parses latest from npm registry metadata", () => {
    expect(latestVersionFromRegistry({ "dist-tags": { latest: "1.2.3" } })).toBe("1.2.3");
    expect(latestVersionFromRegistry({})).toBeUndefined();
  });
});
