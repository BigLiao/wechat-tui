import { readFileSync } from "node:fs";

export interface PackageInfo {
  name: string;
  version: string;
}

export function readPackageInfo(): PackageInfo {
  const packageUrl = new URL("../package.json", import.meta.url);
  const raw = JSON.parse(readFileSync(packageUrl, "utf8")) as { name?: unknown; version?: unknown };
  const name = typeof raw.name === "string" && raw.name ? raw.name : "wechat-tui";
  const version = typeof raw.version === "string" && raw.version ? raw.version : "0.0.0";
  return { name, version };
}
