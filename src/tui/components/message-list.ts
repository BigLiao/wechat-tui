import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { theme, fit } from "../theme.js";
import { formatClock } from "../../util/time.js";
import type { ConversationRecord, MessageRecord, RenderState } from "../../types.js";

/**
 * Message list — terminal log format with breathing room.
 *
 * [14:32] Alice
 * Hello, how are you?
 *
 * [14:35] You
 * I'm good, thanks!
 */
export class MessageList {
  render(state: RenderState, width: number, rows: number): string[] {
    const conversation = state.activeConversation;
    if (!conversation) {
      return [fit(`  ${theme.dim("No active conversation.")}`, width)];
    }
    if (state.messages.length === 0) {
      return [fit(`  ${theme.dim("No messages yet.")}`, width)];
    }

    const budget = Math.max(5, rows - 8);
    const allLines: string[] = [];

    for (let i = 0; i < state.messages.length; i++) {
      const message = state.messages[i];
      if (i > 0) {
        allLines.push(""); // breathing room between messages
      }
      allLines.push(...formatMessage(message, conversation, width));
    }

    return allLines.slice(-budget);
  }
}

function formatMessage(message: MessageRecord, conversation: ConversationRecord, width: number): string[] {
  const lines: string[] = [];

  // Header: [HH:MM] Sender
  const sender = message.isSelf
    ? "You"
    : (conversation.kind === "group" ? message.senderName : conversation.title);
  const time = formatClock(message.timestamp);
  const senderStyled = message.isSelf ? theme.selfName(sender) : theme.otherName(sender);
  const timeStyled = theme.dim(`[${time}]`);

  lines.push(fit(`${timeStyled} ${senderStyled}`, width));

  // Content
  const content = messageDisplayContent(message);
  const contentWidth = Math.max(1, width - 2);
  const wrapped = wrapTextWithAnsi(content, contentWidth);
  for (const line of wrapped) {
    lines.push(fit(line, width));
  }

  return lines;
}

function messageDisplayContent(message: MessageRecord): string {
  switch (message.type) {
    case "text":
    case "notice":
      return message.content || placeholderForMessage(message);
    default:
      return placeholderForMessage(message);
  }
}

function placeholderForMessage(message: MessageRecord): string {
  switch (message.type) {
    case "image":
      return theme.dim("[image]");
    case "voice":
      return theme.dim("[voice]");
    case "video":
      return theme.dim("[video]");
    case "file": {
      const filename = rawString(message.raw, "FileName") ?? rawString(message.raw, "FileNameTitle");
      return theme.dim(filename ? `[file] ${filename}` : "[file]");
    }
    case "mini-program":
      return theme.dim("[mini-program]");
    case "sticker":
      return theme.dim("[sticker]");
    default:
      return theme.dim("[unsupported]");
  }
}

function rawString(raw: unknown, key: string): string | undefined {
  if (!raw || typeof raw !== "object" || !(key in raw)) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
