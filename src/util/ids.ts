import { createHash } from "node:crypto";
import type { ContactInput, ContactKind, ConversationInput } from "../types.js";

export function normalizeKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function stableId(prefix: string, parts: Array<string | undefined | null>): string {
  const source = parts
    .map((part) => (part ? normalizeKey(part) : ""))
    .filter(Boolean)
    .join("|");
  const digest = createHash("sha1").update(source || prefix).digest("hex").slice(0, 20);
  return `${prefix}:${digest}`;
}

export function contactId(kind: ContactKind, identityParts: Array<string | undefined | null>): string {
  return stableId(`contact:${kind}`, identityParts);
}

export function conversationIdFromContact(contact: Pick<ContactInput, "id">): string {
  return `conversation:${contact.id}`;
}

export function conversationFromContact(contact: ContactInput): ConversationInput {
  return {
    id: conversationIdFromContact(contact),
    protocolId: contact.protocolId,
    kind: contact.kind,
    title: contact.displayName
  };
}

export function localMessageId(parts: Array<string | undefined | null>): string {
  return stableId("local-message", parts);
}
