import { createHash } from "node:crypto";

/**
 * FileRegistry — maps short 4-char hex hashes to file paths.
 * Hashes are deterministically derived from (conversationId, resourceKey).
 *
 * For sent files, the resourceKey is the local file path.
 * For received files, the resourceKey is the message ID (path may be unavailable).
 */
export class FileRegistry {
  private readonly hashToPath = new Map<string, string>();
  private readonly keyToHash = new Map<string, string>();

  /**
   * Register a resource and optionally associate it with a local file path.
   * Returns the 4-char hash for display.
   */
  register(conversationId: string, resourceKey: string, filePath?: string): string {
    const key = `${conversationId}\0${resourceKey}`;
    const existing = this.keyToHash.get(key);
    if (existing) {
      // Update path if now available
      if (filePath) {
        this.hashToPath.set(existing, filePath);
      }
      return existing;
    }

    let hash = computeShortHash(key);

    // Handle collisions
    let attempt = 0;
    while (this.hashToPath.has(hash) && this.keyToHash.get(key) !== hash) {
      attempt++;
      hash = computeShortHash(`${key}\0${attempt}`);
    }

    if (filePath) {
      this.hashToPath.set(hash, filePath);
    }
    this.keyToHash.set(key, hash);
    return hash;
  }

  /**
   * Look up a file path by its hash.
   * Returns undefined if the hash is unknown or has no associated path.
   */
  lookup(hash: string): string | undefined {
    return this.hashToPath.get(hash.toLowerCase());
  }

  /**
   * Clear all registered entries.
   */
  clear(): void {
    this.hashToPath.clear();
    this.keyToHash.clear();
  }
}

function computeShortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 4);
}
