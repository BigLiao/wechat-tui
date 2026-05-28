import { mkdtempSync, rmSync } from "node:fs";
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
  it("passes when node and sqlite are available", () => {
    const report = checkStartupEnvironment({
      dbPath: tempDb(),
      nodeVersion: "22.19.0",
      loadSqlite: () => ({ DatabaseSync: FakeDatabase })
    });

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("reports an unsupported node version before startup", () => {
    const report = checkStartupEnvironment({
      dbPath: tempDb(),
      nodeVersion: "22.18.0",
      loadSqlite: () => ({ DatabaseSync: FakeDatabase })
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

  it("reports unavailable node sqlite support", () => {
    const report = checkStartupEnvironment({
      dbPath: tempDb(),
      nodeVersion: "22.19.0",
      loadSqlite: () => ({})
    });

    expect(report.ok).toBe(false);
    expect(report.issues[0]).toEqual(
      expect.objectContaining({
        id: "sqlite-module",
        title: "SQLite 模块不可用"
      })
    );
  });

  it("reports database open failures with the configured path", () => {
    const dbPath = tempDb();
    const report = checkStartupEnvironment({
      dbPath,
      nodeVersion: "22.19.0",
      loadSqlite: () => ({ DatabaseSync: ThrowingDatabase })
    });

    const formatted = formatStartupEnvironmentReport(report);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toEqual(
      expect.objectContaining({
        id: "sqlite-database",
        title: "SQLite 数据库无法打开"
      })
    );
    expect(formatted).toContain(dbPath);
    expect(formatted).toContain("permission denied");
    expect(formatted).toContain("--db");
  });
});

class FakeDatabase {
  constructor(_location?: string) {}
  prepare(_sql: string): { get: () => unknown } {
    return { get: () => ({ user_version: 0 }) };
  }
  close(): void {}
}

class ThrowingDatabase {
  constructor(_location?: string) {
    throw new Error("permission denied");
  }
  prepare(_sql: string): { get: () => unknown } {
    return { get: () => ({}) };
  }
  close(): void {}
}
