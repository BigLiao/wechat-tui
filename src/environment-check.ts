import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";

export const MINIMUM_NODE_VERSION = "22.19.0";

type StartupEnvironmentIssueId = "node-version" | "sqlite-database";

export interface StartupEnvironmentIssue {
  id: StartupEnvironmentIssueId;
  title: string;
  detail: string;
  suggestion: string;
}

export interface StartupEnvironmentReport {
  ok: boolean;
  node: {
    currentVersion: string;
    minimumVersion: string;
    ok: boolean;
  };
  sqlite: {
    dbPath: string;
    ok: boolean;
  };
  issues: StartupEnvironmentIssue[];
}

export interface StartupEnvironmentCheckOptions {
  dbPath: string;
  nodeVersion?: string;
  minimumNodeVersion?: string;
}

export function checkStartupEnvironment(options: StartupEnvironmentCheckOptions): StartupEnvironmentReport {
  const minimumVersion = normalizeVersion(options.minimumNodeVersion ?? MINIMUM_NODE_VERSION);
  const currentVersion = normalizeVersion(options.nodeVersion ?? process.versions.node);
  const issues: StartupEnvironmentIssue[] = [];
  const nodeOk = compareVersions(currentVersion, minimumVersion) >= 0;

  if (!nodeOk) {
    issues.push({
      id: "node-version",
      title: "Node.js 版本过低",
      detail: `当前版本：v${currentVersion}；要求：>=${minimumVersion}。`,
      suggestion: `请安装 Node.js ${minimumVersion} 或更高版本后重试。`
    });
  }

  let sqliteOk = false;
  try {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    sqliteOk = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({
      id: "sqlite-database",
      title: "数据库目录不可用",
      detail: `数据库路径：${options.dbPath}\n  原因：${message}`,
      suggestion: "请确认数据库目录可写，或使用 --db 指定一个当前用户有权限读写的路径。"
    });
  }

  return {
    ok: issues.length === 0,
    node: {
      currentVersion,
      minimumVersion,
      ok: nodeOk
    },
    sqlite: {
      dbPath: options.dbPath,
      ok: sqliteOk
    },
    issues
  };
}

export function formatStartupEnvironmentReport(report: StartupEnvironmentReport): string {
  if (report.ok) {
    return "wechat-tui 环境检查通过。";
  }

  const lines = ["wechat-tui 无法启动：当前环境不满足要求。", ""];
  for (const issue of report.issues) {
    lines.push(`- ${issue.title}`);
    lines.push(`  ${issue.detail}`);
    lines.push(`  ${issue.suggestion}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, "").split("-", 1)[0] || "0.0.0";
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function parseVersionParts(version: string): [number, number, number] {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
