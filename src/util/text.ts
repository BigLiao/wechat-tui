const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " "
};

export function decodeHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, entity: string) => HTML_ENTITIES[entity] ?? match);
}

export function stripTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

export function cleanText(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  return stripTags(decodeHtml(String(input))).replace(/\r\n/g, "\n").trim();
}

export function truncate(input: string, maxLength = 100): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, Math.max(0, maxLength - 1))}...`;
}
