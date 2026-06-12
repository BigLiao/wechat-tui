import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkStartupEnvironment, formatStartupEnvironmentReport } from "../src/environment-check.js";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "wechat-tui-env-"));
  tempDirs.push(dir);
  return join(dir, "db.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("startup environment check", () => {
  it("passes when node and database directory are available", () => {
    const report = checkStartupEnvironment({
      dbPath: tempDb(),
      nodeVersion: "22.19.0"
    });

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("reports an unsupported node version before startup", () => {
    const report = checkStartupEnvironment({
      dbPath: tempDb(),
      nodeVersion: "22.18.0"
    });

    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        id: "node-version",
        title: "Node.js 版本过低"
      })
    ]);
    expect(formatStartupEnvironmentReport(report)).toContain("当前版本：v22.18.0；要求：>=22.19.0。");
  });

  it("reports database directory failures with the configured path", () => {
    const dir = mkdtempSync(join(tmpdir(), "wechat-tui-env-"));
    tempDirs.push(dir);
    const blockedParent = join(dir, "not-a-directory");
    writeFileSync(blockedParent, "blocked");
    const dbPath = join(blockedParent, "db.sqlite");
    const report = checkStartupEnvironment({
      dbPath,
      nodeVersion: "22.19.0"
    });

    const formatted = formatStartupEnvironmentReport(report);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toEqual(
      expect.objectContaining({
        id: "sqlite-database",
        title: "数据库目录不可用"
      })
    );
    expect(formatted).toContain(dbPath);
    expect(formatted).toContain(blockedParent);
    expect(formatted).toContain("--db");
  });
});
