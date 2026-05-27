import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { colors, fit } from "../theme.js";
import { formatClock } from "../../util/time.js";
import type { ConversationRecord, MessageRecord, RenderState } from "../../types.js";

/**
 * Message list — terminal-style log format.
 *
 * Each message renders as:
 *   Alice 14:32
 *   Hey, are you free tonight?
 *   I want to grab dinner.
 *
 *   You 14:35
 *   Sure! Where do you want to go?
 *
 * Clean, minimal, like reading a CLI agent log.
 */
export class MessageList {
  render(state: RenderState, width: number, rows: number): string[] {
    const conversation = state.activeConversation;
    if (!conversation) {
      return [fit(`  ${colors.muted("No active conversation.")}`, width)];
    }
    if (state.messages.length === 0) {
      return [fit(`  ${colors.muted("No messages yet.")}`, width)];
    }

    const budget = Math.max(5, rows - 10);
    const allLines: string[] = [];

    for (let i = 0; i < state.messages.length; i++) {
      const message = state.messages[i];
      if (i > 0) {
        allLines.push(""); // blank line between messages
      }
      allLines.push(...formatMessage(message, conversation, width));
    }

    return allLines.slice(-budget);
  }
}

function formatMessage(message: MessageRecord, conversation: ConversationRecord, width: number): string[] {
  const lines: string[] = [];

  // Header line: "[HH:MM] Sender"
  const sender = message.isSelf
    ? "You"
    : (conversation.kind === "group" ? message.senderName : conversation.title);
  const time = formatClock(message.timestamp);
  const senderStyled = message.isSelf ? colors.selfName(sender) : colors.otherName(sender);
  const timeStyled = colors.muted(`[${time}]`);

  lines.push(fit(`${timeStyled} ${senderStyled}`, width));

  // Content lines
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
      return colors.muted("[image]");
    case "voice":
      return colors.muted("[voice]");
    case "video":
      return colors.muted("[video]");
    case "file": {
      const filename = rawString(message.raw, "FileName") ?? rawString(message.raw, "FileNameTitle");
      return colors.muted(filename ? `[file] ${filename}` : "[file]");
    }
    case "mini-program":
      return colors.muted("[mini-program]");
    case "sticker":
      return colors.muted("[sticker]");
    default:
      return colors.muted("[unsupported message]");
  }
}

function rawString(raw: unknown, key: string): string | undefined {
  if (!raw || typeof raw !== "object" || !(key in raw)) {
    return undefined;
  }
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
