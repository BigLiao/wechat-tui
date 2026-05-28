import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MessageKind } from "../types.js";

const CACHE_BASE = join(homedir(), ".wechat-tui", "cache");

/**
 * MediaCache — manages downloaded media files organized by conversation ID.
 *
 * Directory structure:
 *   ~/.wechat-tui/cache/<conversationId>/
 *     <messageId>.<ext>
 */
export class MediaCache {
  /**
   * Get the directory for a conversation's cached files.
   * Creates it if it doesn't exist.
   */
  conversationDir(conversationId: string): string {
    // Sanitize conversation ID for filesystem (replace colons, slashes)
    const safeName = conversationId.replace(/[/:*?"<>|\\]/g, "_");
    const dir = join(CACHE_BASE, safeName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Get the expected file path for a cached media file.
   * Does NOT check if the file exists.
   */
  filePath(conversationId: string, messageId: string, extension: string): string {
    const dir = this.conversationDir(conversationId);
    const safeMessageId = messageId.replace(/[/:*?"<>|\\]/g, "_");
    const ext = extension.startsWith(".") ? extension : `.${extension}`;
    return join(dir, `${safeMessageId}${ext}`);
  }

  /**
   * Get a file path using the original filename (already sanitized by caller).
   * If a file with the same name exists, appends a counter.
   */
  filePathByName(conversationId: string, fileName: string): string {
    const dir = this.conversationDir(conversationId);
    const target = join(dir, fileName);
    if (!existsSync(target)) {
      return target;
    }
    // Deduplicate: file_2.ext, file_3.ext, ...
    const dot = fileName.lastIndexOf(".");
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : "";
    for (let i = 2; i < 1000; i++) {
      const candidate = join(dir, `${base}_${i}${ext}`);
      if (!existsSync(candidate)) {
        return candidate;
      }
    }
    return target;
  }

  /**
   * Check if a file is already cached.
   */
  has(conversationId: string, messageId: string, extension: string): boolean {
    return existsSync(this.filePath(conversationId, messageId, extension));
  }

  /**
   * Get the cache base directory.
   */
  get baseDir(): string {
    return CACHE_BASE;
  }
}

const CONTENT_TYPE_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/amr": ".amr",
  "audio/ogg": ".ogg",
  "audio/silk": ".silk",
  "audio/mp4": ".m4a"
};

const FALLBACK_EXTENSIONS: Partial<Record<MessageKind, string>> = {
  image: ".jpg",
  sticker: ".gif",
  video: ".mp4",
  voice: ".mp3",
  file: ".bin"
};

/**
 * Derive a file extension from a content-type header.
 * Falls back to a sensible default based on message type.
 */
export function extensionFromContentType(contentType: string, messageType: MessageKind): string {
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const mapped = CONTENT_TYPE_MAP[mime];
  if (mapped) {
    return mapped;
  }
  return FALLBACK_EXTENSIONS[messageType] ?? ".bin";
}
