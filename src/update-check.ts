import type { Logger } from "pino";
import type { UpdateInfo } from "./types.js";

export interface UpdateCheckOptions {
  packageName: string;
  currentVersion: string;
  registryUrl?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
  logger?: Logger;
}

type Fetcher = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<FetchResponse>;

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export async function checkForPackageUpdate(options: UpdateCheckOptions): Promise<UpdateInfo | undefined> {
  const registryUrl = options.registryUrl ?? "https://registry.npmjs.org";
  const timeoutMs = options.timeoutMs ?? 3000;
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) {
    options.logger?.debug("global fetch is not available; skipping update check");
    return undefined;
  }

  const url = `${registryUrl.replace(/\/+$/, "")}/${encodeURIComponent(options.packageName)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetcher(url, {
      headers: {
        accept: "application/vnd.npm.install-v1+json"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      options.logger?.debug({ status: response.status }, "npm update check failed");
      return undefined;
    }

    const body = await response.json();
    const latestVersion = latestVersionFromRegistry(body);
    if (!latestVersion || compareVersions(latestVersion, options.currentVersion) <= 0) {
      options.logger?.debug(
        { currentVersion: options.currentVersion, latestVersion },
        "package is already on the latest npm version"
      );
      return undefined;
    }

    return {
      packageName: options.packageName,
      currentVersion: options.currentVersion,
      latestVersion,
      installCommand: `npm install -g ${options.packageName}@latest`
    };
  } catch (error) {
    options.logger?.debug({ err: error }, "npm update check skipped after error");
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function latestVersionFromRegistry(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const tags = (input as { "dist-tags"?: unknown })["dist-tags"];
  if (!tags || typeof tags !== "object") {
    return undefined;
  }
  const latest = (tags as { latest?: unknown }).latest;
  return typeof latest === "string" && latest ? latest : undefined;
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) {
    return left.localeCompare(right);
  }

  for (const key of ["major", "minor", "patch"] as const) {
    const diff = leftVersion[key] - rightVersion[key];
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }

  if (leftVersion.prerelease === rightVersion.prerelease) {
    return 0;
  }
  if (!leftVersion.prerelease) {
    return 1;
  }
  if (!rightVersion.prerelease) {
    return -1;
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function parseVersion(input: string):
  | {
      major: number;
      minor: number;
      patch: number;
      prerelease?: string;
    }
  | undefined {
  const match = input.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
  };
}

function comparePrerelease(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumber = numericIdentifier(leftPart);
    const rightNumber = numericIdentifier(rightPart);
    if (leftNumber !== undefined && rightNumber !== undefined) {
      return Math.sign(leftNumber - rightNumber);
    }
    if (leftNumber !== undefined) {
      return -1;
    }
    if (rightNumber !== undefined) {
      return 1;
    }
    return Math.sign(leftPart.localeCompare(rightPart));
  }
  return 0;
}

function numericIdentifier(input: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(input)) {
    return undefined;
  }
  return Number(input);
}
