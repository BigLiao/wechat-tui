import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { imageFilePathFromPastedText, normalizeUserFilePath } from "../src/util/path-input.js";

const tempDirs: string[] = [];

function tempImagePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "wechat-tui-path-"));
  tempDirs.push(dir);
  const imagePath = join(dir, "sample image 2026-05-28.png");
  writeFileSync(imagePath, "fake png");
  return imagePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("path input helpers", () => {
  it("normalizes quoted paths with spaces", () => {
    const imagePath = tempImagePath();

    expect(normalizeUserFilePath(`"${imagePath}"`)).toBe(imagePath);
    expect(imageFilePathFromPastedText(`"${imagePath}"`)).toBe(imagePath);
  });

  it("normalizes shell-escaped paths with spaces", () => {
    const imagePath = tempImagePath();
    const escapedPath = imagePath.replace(/ /g, "\\ ");

    expect(normalizeUserFilePath(escapedPath)).toBe(imagePath);
    expect(imageFilePathFromPastedText(escapedPath)).toBe(imagePath);
  });

  it("normalizes file URLs", () => {
    const imagePath = tempImagePath();

    expect(imageFilePathFromPastedText(pathToFileURL(imagePath).href)).toBe(imagePath);
  });

  it("does not touch the filesystem when parsing pasted image paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "wechat-tui-path-"));
    tempDirs.push(dir);
    const imagePath = join(dir, "not-yet-created.png");

    expect(imageFilePathFromPastedText(imagePath)).toBe(imagePath);
  });
});
