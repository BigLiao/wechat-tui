import { cleanText, decodeHtml } from "./text.js";

const RECALLED_MESSAGE_TYPE = 10002;

export function formatWechatRecallMessage(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  for (const payload of recallPayloadCandidates(raw as Record<string, unknown>)) {
    if (!isRecallPayload(payload)) {
      continue;
    }
    return cleanCdataText(tagValue(payload, "replacemsg")) ?? "[recalled]";
  }

  return Number((raw as Record<string, unknown>).MsgType) === RECALLED_MESSAGE_TYPE ? "[recalled]" : undefined;
}

function recallPayloadCandidates(raw: Record<string, unknown>): string[] {
  const content = normalizeRawString(raw.Content);
  const original = normalizeRawString(raw.OriginalContent);
  return uniqueNonEmpty([
    stripDisplaySenderPrefix(content),
    stripProtocolSenderPrefix(original),
    content,
    original
  ]);
}

function normalizeRawString(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  return decodeHtml(String(input)).replace(/\r\n/g, "\n").trim();
}

function stripDisplaySenderPrefix(input: string): string {
  return input.match(/^.+?:\n([\s\S]*)$/)?.[1]?.trim() ?? input;
}

function stripProtocolSenderPrefix(input: string): string {
  return input.match(/^@[^:\n]+:\n?([\s\S]*)$/)?.[1]?.trim() ?? input;
}

function uniqueNonEmpty(inputs: string[]): string[] {
  return [...new Set(inputs.map((value) => value.trim()).filter(Boolean))];
}

function isRecallPayload(input: string): boolean {
  return /<revokemsg\b/i.test(input) || /\btype\s*=\s*(['"])revokemsg\1/i.test(input);
}

function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1];
}

function cleanCdataText(input: unknown): string | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  const value = cleanText(String(input).replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, ""));
  return value || undefined;
}
