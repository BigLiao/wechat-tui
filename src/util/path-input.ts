import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"]);

export function normalizeUserFilePath(rawPath: string): string {
  let value = stripWrappingQuotes(rawPath.trim());
  if (value.toLowerCase().startsWith("file://")) {
    try {
      value = fileURLToPath(value);
    } catch {
      // Fall through to ordinary path handling so the caller can show a useful not-found path.
    }
  }
  value = unescapeShellPath(value);
  if (value.startsWith("~")) {
    return resolve(homedir(), value.slice(value.startsWith("~/") ? 2 : 1));
  }
  return resolve(value);
}

export function imageFilePathFromPastedText(text: string): string | undefined {
  const filePath = normalizeUserFilePath(text);
  if (!IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return undefined;
  }
  return existsSync(filePath) ? filePath : undefined;
}

function stripWrappingQuotes(value: string): string {
  let result = value;
  while (result.length >= 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      result = result.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return result;
}

function unescapeShellPath(value: string): string {
  return value.replace(/\\([\\ "'()&;<>|*?$[\]{}!#`])/g, "$1");
}
