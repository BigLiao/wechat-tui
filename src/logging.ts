import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import type { CliConfig } from "./config.js";
import type {
  ContactInput,
  ConversationInput,
  IncomingProtocolMessage,
  MessageInput,
  MessageRecord,
  SearchResult
} from "./types.js";

export interface DebugLoggerResult {
  logger?: Logger;
  logPath?: string;
}

const PREVIEW_LIMIT = 500;

export function createDebugLogger(config: CliConfig): DebugLoggerResult {
  if (!config.debug) {
    return {};
  }

  const logDir = join(homedir(), ".wechat-tui", "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `wechat-tui-${formatLogTimestamp(new Date())}-${process.pid}.log`);
  const destination = pino.destination({ dest: logPath, sync: false });
  const logger = pino(
    {
      level: config.logLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      base: {
        pid: process.pid,
        component: "wechat-tui"
      },
      redact: {
        paths: [
          "*.COOKIE",
          "*.PROP",
          "*.passTicket",
          "*.pass_ticket",
          "*.webwxDataTicket",
          "*.skey",
          "*.sid",
          "*.uin",
          "*.sessionData",
          "*.botData",
          "*.BaseRequest",
          "sessionData",
          "botData",
          "raw.COOKIE",
          "raw.PROP"
        ],
        censor: "[redacted]"
      }
    },
    destination
  );

  logger.info(
    {
      config: summarizeConfig(config, logPath),
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd()
      }
    },
    "debug logging enabled"
  );

  return { logger, logPath };
}

export function summarizeConfig(config: CliConfig, logPath?: string): Record<string, unknown> {
  return {
    dataDir: config.dataDir,
    dbPath: config.dbPath,
    mock: config.mock,
    debug: config.debug,
    logLevel: config.logLevel,
    logPath
  };
}

export function summarizeContacts(contacts: ContactInput[]): Record<string, unknown> {
  const counts = contacts.reduce<Record<string, number>>((acc, contact) => {
    acc[contact.kind] = (acc[contact.kind] ?? 0) + 1;
    return acc;
  }, {});
  return {
    count: contacts.length,
    counts,
    sample: contacts.slice(0, 8).map((contact) => ({
      id: contact.id,
      protocolId: contact.protocolId,
      kind: contact.kind,
      displayName: contact.displayName,
      remarkName: contact.remarkName,
      nickName: contact.nickName,
      isSelf: contact.isSelf === true,
      groupRaw: contact.kind === "group" ? summarizeGroupContactRaw(contact.raw) : undefined
    }))
  };
}

export function summarizeIncomingMessage(message: IncomingProtocolMessage): Record<string, unknown> {
  return {
    id: message.id,
    protocolMessageId: message.protocolMessageId,
    type: message.type,
    timestamp: message.timestamp,
    isSelf: message.isSelf,
    conversation: summarizeConversationInput(message.conversation),
    sender: summarizeContact(message.sender),
    contentLength: message.content.length,
    contentPreview: preview(message.content),
    raw: summarizeRawWechatMessage(message.raw)
  };
}

export function summarizeMessageInput(message: MessageInput): Record<string, unknown> {
  return {
    id: message.id,
    protocolMessageId: message.protocolMessageId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: message.senderName,
    isSelf: message.isSelf,
    type: message.type,
    timestamp: message.timestamp,
    contentLength: message.content.length,
    contentPreview: preview(message.content),
    raw: summarizeRawWechatMessage(message.raw)
  };
}

export function summarizeStoredMessage(message: MessageRecord): Record<string, unknown> {
  return {
    id: message.id,
    protocolMessageId: message.protocolMessageId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderName: message.senderName,
    isSelf: message.isSelf,
    type: message.type,
    timestamp: message.timestamp,
    createdAt: message.createdAt,
    contentLength: message.content.length,
    contentPreview: preview(message.content)
  };
}

export function summarizeConversationInput(conversation: ConversationInput): Record<string, unknown> {
  return {
    id: conversation.id,
    protocolId: conversation.protocolId,
    kind: conversation.kind,
    title: conversation.title
  };
}

export function summarizeSearchResults(results: SearchResult[]): Record<string, unknown> {
  return {
    count: results.length,
    sample: results.slice(0, 5).map(({ conversation, message }) => ({
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      messageId: message.id,
      senderName: message.senderName,
      timestamp: message.timestamp,
      contentPreview: preview(message.content)
    }))
  };
}

export function summarizeRawWechatMessage(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const value = raw as Record<string, unknown>;
  return {
    MsgId: value.MsgId,
    NewMsgId: value.NewMsgId,
    MsgType: value.MsgType,
    SubMsgType: value.SubMsgType,
    AppMsgType: value.AppMsgType,
    FromUserName: value.FromUserName,
    ToUserName: value.ToUserName,
    ActualUserName: value.ActualUserName,
    ActualNickName: value.ActualNickName,
    StatusNotifyCode: value.StatusNotifyCode,
    StatusNotifyUserName: value.StatusNotifyUserName,
    CreateTime: value.CreateTime,
    isSendBySelf: value.isSendBySelf,
    Content: preview(typeof value.Content === "string" ? value.Content : undefined),
    OriginalContent: preview(typeof value.OriginalContent === "string" ? value.OriginalContent : undefined),
    FileName: value.FileName,
    MediaId: value.MediaId,
    Url: value.Url
  };
}

export function preview(value: unknown, limit = PREVIEW_LIMIT): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}...`;
}

function summarizeContact(contact: ContactInput): Record<string, unknown> {
  return {
    id: contact.id,
    protocolId: contact.protocolId,
    kind: contact.kind,
    displayName: contact.displayName,
    remarkName: contact.remarkName,
    nickName: contact.nickName,
    isSelf: contact.isSelf === true
  };
}

function summarizeGroupContactRaw(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as {
    MemberCount?: unknown;
    MemberList?: unknown;
    EncryChatRoomId?: unknown;
  };
  return {
    MemberCount: value.MemberCount,
    MemberListSize: Array.isArray(value.MemberList) ? value.MemberList.length : undefined,
    hasEncryChatRoomId: typeof value.EncryChatRoomId === "string" && value.EncryChatRoomId.length > 0
  };
}

function formatLogTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
