import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { theme, fit } from "../theme.js";
import { formatChatTimestamp } from "../../util/time.js";
import { formatWechatRecallMessage } from "../../util/wechat-recall.js";
import type { ConversationRecord, MessageRecord, RenderState } from "../../types.js";
import type { FileRegistry } from "../../util/file-hash.js";

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
  render(state: RenderState, width: number, rows: number, fileRegistry?: FileRegistry): string[] {
    const conversation = state.activeConversation;
    if (!conversation) {
      return [fit(`  ${theme.dim("No active conversation.")}`, width)];
    }
    if (state.messages.length === 0) {
      return [fit(`  ${theme.dim("No messages yet.")}`, width)];
    }

    const budget = Math.max(1, rows);
    const allLines: string[] = [];

    for (let i = 0; i < state.messages.length; i++) {
      const message = state.messages[i];
      if (i > 0) {
        allLines.push(""); // breathing room between messages
      }
      allLines.push(...formatMessage(message, conversation, width, fileRegistry));
    }

    const maxOffset = Math.max(0, allLines.length - budget);
    const offset = Math.min(Math.max(0, state.messageScrollOffset), maxOffset);
    const end = allLines.length - offset;
    const start = Math.max(0, end - budget);
    return allLines.slice(start, end);
  }
}

function formatMessage(message: MessageRecord, conversation: ConversationRecord, width: number, fileRegistry?: FileRegistry): string[] {
  const lines: string[] = [];

  // Header: [time] Sender
  const sender = message.isSelf
    ? "You"
    : (conversation.kind === "group" ? readableGroupSenderName(message.senderName) : conversation.title);
  const time = formatChatTimestamp(message.timestamp);
  const senderStyled = message.isSelf ? theme.selfName(sender) : theme.otherName(sender);
  const timeStyled = theme.dim(`[${time}]`);

  lines.push(fit(`${timeStyled} ${senderStyled}`, width));

  // Content
  const content = messageDisplayContent(message, conversation, fileRegistry);
  const contentWidth = Math.max(1, width - 2);
  const wrapped = wrapTextWithAnsi(content, contentWidth);
  for (const line of wrapped) {
    lines.push(fit(line, width));
  }

  return lines;
}

function readableGroupSenderName(input: string | undefined): string {
  const name = input?.trim();
  if (!name || name === "Unknown" || name.startsWith("@")) {
    return "Group member";
  }
  return name;
}

function messageDisplayContent(message: MessageRecord, conversation: ConversationRecord, fileRegistry?: FileRegistry): string {
  switch (message.type) {
    case "text":
    case "link":
    case "mini-program":
      return message.content || placeholderForMessage(message, conversation, fileRegistry);
    case "notice":
      return formatWechatRecallMessage(message.raw) || message.content || placeholderForMessage(message, conversation, fileRegistry);
    case "file":
      // File messages always go through placeholder to ensure hash is appended
      if (message.content) {
        return appendFileHash(message, conversation, fileRegistry, message.content);
      }
      return placeholderForMessage(message, conversation, fileRegistry);
    default:
      return placeholderForMessage(message, conversation, fileRegistry);
  }
}

function appendFileHash(message: MessageRecord, conversation: ConversationRecord, fileRegistry?: FileRegistry, content?: string): string {
  if (!FILE_TYPES.has(message.type)) {
    return content ?? "";
  }
  const text = content ?? `[${message.type}]`;
  const localPath = rawString(message.raw, "localFilePath");
  const hash = fileRegistry && localPath ? fileRegistry.register(conversation.id, message.id, localPath) : undefined;
  // Insert hash after the type tag: [file #xxxx] rest...
  const tagMatch = text.match(/^\[([^\]]+)\]/);
  if (tagMatch) {
    const tag = hash ? `[${tagMatch[1]} #${hash}]` : tagMatch[0];
    return theme.media(tag) + text.slice(tagMatch[0].length);
  }
  return hash ? theme.media(`[#${hash}] `) + text : text;
}

/** Types that represent viewable file resources */
const FILE_TYPES = new Set<string>(["image", "video", "voice", "file", "sticker"]);

function placeholderForMessage(message: MessageRecord, conversation: ConversationRecord, fileRegistry?: FileRegistry): string {
  const localPath = rawString(message.raw, "localFilePath");
  // Only show hash when file is locally available (downloaded or sent)
  const hashSuffix = fileRegistry && localPath && FILE_TYPES.has(message.type)
    ? ` #${fileRegistry.register(conversation.id, message.id, localPath)}`
    : "";

  switch (message.type) {
    case "link":
      return theme.dim("[link]");
    case "image":
      return theme.media(`[image${hashSuffix}]`);
    case "voice":
      return theme.media(`[voice${hashSuffix}]`);
    case "video":
      return theme.media(`[video${hashSuffix}]`);
    case "file": {
      const filename = rawString(message.raw, "FileName") ?? rawString(message.raw, "FileNameTitle");
      return theme.media(filename ? `[file${hashSuffix}] ${filename}` : `[file${hashSuffix}]`);
    }
    case "mini-program":
      return theme.dim("[mini-program]");
    case "sticker":
      return theme.media(`[sticker${hashSuffix}]`);
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
