import { cleanText } from "./text.js";

const GROUP_MEMBER_COUNT_SUFFIX = /\s*[\(（]\s*(\d+)\s*[\)）]\s*$/u;

export function stripGroupMemberCountSuffix(value: string, expectedCount?: number): string {
  const clean = value.trim();
  const match = clean.match(GROUP_MEMBER_COUNT_SUFFIX);
  if (!match) {
    return clean;
  }

  const count = Number(match[1]);
  if (expectedCount !== undefined && count !== expectedCount) {
    return clean;
  }

  return clean.slice(0, match.index).trim();
}

export function groupMemberCountSuffix(value: unknown): number | undefined {
  const match = cleanText(value).match(GROUP_MEMBER_COUNT_SUFFIX);
  if (!match) {
    return undefined;
  }
  const count = Number(match[1]);
  return Number.isFinite(count) && count >= 0 ? count : undefined;
}

export function groupMemberCountFromRaw(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as { MemberCount?: unknown; MemberList?: unknown };
  const count =
    typeof value.MemberCount === "number"
      ? value.MemberCount
      : typeof value.MemberCount === "string"
        ? Number(value.MemberCount)
        : Number.NaN;
  if (Number.isFinite(count) && count >= 0) {
    return count;
  }
  return Array.isArray(value.MemberList) ? value.MemberList.length : undefined;
}

export function normalizeComparableText(value: unknown): string {
  return cleanText(value).normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeComparableGroupName(value: unknown): string {
  return normalizeComparableText(stripGroupMemberCountSuffix(cleanText(value)).replace(/^\[群\]\s*/, ""));
}
