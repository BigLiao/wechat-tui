import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Logger } from "pino";
import type {
  ConnectionState,
  ContactInput,
  ContactKind,
  IncomingProtocolMessage,
  MessageKind,
  ProtocolQrEvent,
  UserProfile,
  WeChatProtocol
} from "../types.js";
import { contactId, conversationFromContact, localMessageId } from "../util/ids.js";
import { cleanText } from "../util/text.js";
import { preview, summarizeContacts, summarizeIncomingMessage, summarizeRawWechatMessage } from "../logging.js";

const require = createRequire(import.meta.url);

type RawWechatBot = EventEmitter & {
  botData?: unknown;
  user?: RawContact;
  contacts?: Record<string, RawContact>;
  CONF?: Record<string, unknown>;
  state?: unknown;
  start(): Promise<void>;
  restart?: () => Promise<void>;
  stop(): void;
  setPollingTargetGetter?: (getter: () => string) => void;
  sendText?: (text: string, toUserName: string) => Promise<unknown>;
  sendMsg?: (text: string, toUserName: string) => Promise<unknown>;
};

interface RawContact {
  UserName?: string;
  NickName?: string;
  RemarkName?: string;
  DisplayName?: string;
  Alias?: string;
  Uin?: number | string;
  PYQuanPin?: string;
  RemarkPYQuanPin?: string;
  MemberCount?: number;
  MemberList?: RawContact[];
  VerifyFlag?: number;
  KeyWord?: string;
  isSelf?: boolean;
  getDisplayName?: () => string;
}

interface RawMessage {
  MsgId?: string;
  NewMsgId?: string | number;
  FromUserName?: string;
  ToUserName?: string;
  ActualUserName?: string;
  ActualNickName?: string;
  Content?: string;
  OriginalContent?: string;
  MsgType?: number;
  AppMsgType?: number;
  FileName?: string;
  FileNameTitle?: string;
  CreateTime?: number;
  StatusNotifyCode?: number;
  StatusNotifyUserName?: string;
  isSendBySelf?: boolean;
  getPeerUserName?: () => string;
}

export interface Wechat4uAdapterOptions {
  logger?: Logger;
}

export class Wechat4uAdapter extends EventEmitter implements WeChatProtocol {
  private bot?: RawWechatBot;
  private user?: UserProfile;

  constructor(private readonly options: Wechat4uAdapterOptions = {}) {
    super();
  }

  async start(sessionData?: unknown): Promise<void> {
    this.options.logger?.info({ hasSessionData: sessionData !== undefined }, "starting wechat4u adapter");
    this.emit("state", "init" satisfies ConnectionState);
    this.bot = this.createBot(sessionData);
    this.attachBot(this.bot);
    if (sessionData && this.bot.restart) {
      this.options.logger?.debug("attempting wechat4u session restart");
      this.emit("state", "syncing" satisfies ConnectionState);
      await this.bot.restart();
      if (isLoggedIn(this.bot)) {
        this.options.logger?.info("wechat4u session restart succeeded");
        return;
      }
      this.options.logger?.warn("saved wechat session is invalid, falling back to QR login");
      this.bot = this.createBot();
      this.attachBot(this.bot);
    }
    await this.bot.start();
    this.options.logger?.debug("wechat4u start promise resolved");
  }

  async reconnect(): Promise<void> {
    this.options.logger?.info("wechat4u reconnect requested");
    this.emit("state", "reconnecting" satisfies ConnectionState);
    if (this.bot?.restart) {
      await this.bot.restart();
      this.options.logger?.info("wechat4u restart call completed");
      return;
    }
    await this.start(this.getSessionData());
  }

  async logout(): Promise<void> {
    this.options.logger?.info({ hasBot: !!this.bot }, "wechat4u logout requested");
    if (!this.bot) {
      this.emit("logout");
      return;
    }
    this.bot.stop();
  }

  async sendText(toProtocolId: string, text: string): Promise<{ messageId?: string; raw?: unknown }> {
    if (!this.bot) {
      throw new Error("WeChat protocol is not started");
    }
    const sender = this.bot.sendText ?? this.bot.sendMsg;
    if (!sender) {
      throw new Error("wechat4u does not expose a text send method");
    }
    this.options.logger?.debug(
      {
        toProtocolId,
        textLength: text.length,
        textPreview: preview(text)
      },
      "sending wechat text"
    );
    const raw = await sender.call(this.bot, text, toProtocolId);
    const messageId = extractSentMessageId(raw);
    this.options.logger?.debug({ toProtocolId, messageId, raw: summarizeRawWechatMessage(raw) }, "wechat text send completed");
    return { messageId, raw };
  }

  async getContacts(): Promise<ContactInput[]> {
    const contacts = Object.values(this.bot?.contacts ?? {}).map((contact) => normalizeContact(contact, this.bot?.user));
    this.options.logger?.debug(summarizeContacts(contacts), "loaded current wechat contacts");
    return contacts;
  }

  getCurrentUser(): UserProfile | undefined {
    return this.user ?? this.cacheCurrentUserFromBot(this.bot, "current user lookup");
  }

  getSessionData(): unknown | undefined {
    return this.bot?.botData;
  }

  private createBot(sessionData?: unknown): RawWechatBot {
    const Wechat = require("wechat4u") as new (botData?: unknown) => RawWechatBot;
    const bot = new Wechat(sessionData);
    // wechat4u defaults to sending a periodic "heartbeat" text to filehelper.
    // It is a protocol keepalive, not a user-visible chat message.
    bot.setPollingTargetGetter?.(() => "");
    this.options.logger?.debug(
      { hasSessionData: sessionData !== undefined, disabledFilehelperHeartbeat: !!bot.setPollingTargetGetter },
      "wechat4u bot created"
    );
    return bot;
  }

  private attachBot(bot: RawWechatBot): void {
    bot.on("uuid", (uuid: string) => {
      const event: ProtocolQrEvent = {
        uuid,
        loginUrl: `https://login.weixin.qq.com/l/${uuid}`,
        qrUrl: `https://login.weixin.qq.com/qrcode/${uuid}`
      };
      this.options.logger?.info({ uuid }, "wechat4u login uuid received");
      this.emit("state", "waiting_scan" satisfies ConnectionState);
      this.emit("qr", event);
    });

    bot.on("user-avatar", () => {
      this.options.logger?.info("wechat login QR scanned");
      this.emit("state", "waiting_confirm" satisfies ConnectionState);
      this.emit("scan");
    });

    bot.on("login", () => {
      const currentUser = this.cacheCurrentUserFromBot(bot, "login event") ?? normalizeUser(bot.user);
      this.options.logger?.info(
        {
          user: {
            id: currentUser.id,
            protocolId: currentUser.protocolId,
            displayName: currentUser.displayName
          }
        },
        "wechat login completed"
      );
      this.emit("state", "online" satisfies ConnectionState);
      this.emit("login", currentUser);

      if (bot.user) {
        this.emit("contacts", [normalizeContact(bot.user, bot.user)]);
      }
    });

    bot.on("contacts-updated", (contacts: RawContact[] | Record<string, RawContact>) => {
      this.cacheCurrentUserFromBot(bot, "contacts update");
      const normalized = Array.isArray(contacts)
        ? contacts.map((contact) => normalizeContact(contact, bot.user))
        : Object.values(contacts).map((contact) => normalizeContact(contact, bot.user));
      this.options.logger?.debug(summarizeContacts(normalized), "wechat contacts updated");
      this.emit("contacts", normalized);
    });

    bot.on("message", (message: RawMessage) => {
      try {
        this.cacheCurrentUserFromBot(bot, "message event");
        this.options.logger?.debug({ raw: summarizeRawWechatMessage(message) }, "wechat4u raw message received");
        const normalized = normalizeWechat4uMessage(message, bot);
        if (normalized) {
          this.options.logger?.debug({ message: summarizeIncomingMessage(normalized) }, "wechat4u message normalized");
          this.emit("message", normalized);
        } else {
          this.options.logger?.debug({ raw: summarizeRawWechatMessage(message) }, "wechat4u message dropped by adapter");
        }
      } catch (error) {
        this.options.logger?.error({ err: error, message }, "failed to normalize wechat4u message");
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    });

    bot.on("logout", () => {
      this.options.logger?.info("wechat4u logout event received");
      this.emit("state", "logout" satisfies ConnectionState);
      this.emit("logout");
    });

    bot.on("error", (error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.options.logger?.error({ err: normalizedError }, "wechat4u error");
      this.emit("state", "error" satisfies ConnectionState);
      this.emit("error", normalizedError);
    });
  }

  private cacheCurrentUserFromBot(bot: RawWechatBot | undefined, source: string): UserProfile | undefined {
    if (!bot?.user) {
      return this.user;
    }
    const currentUser = normalizeUser(bot.user);
    if (!this.user || this.user.id !== currentUser.id) {
      this.user = currentUser;
      this.options.logger?.debug(
        { source, user: { id: currentUser.id, protocolId: currentUser.protocolId, displayName: currentUser.displayName } },
        "cached current wechat user"
      );
    }
    return this.user;
  }
}

function normalizeUser(raw?: RawContact): UserProfile {
  const contact = normalizeContact(raw ?? {}, raw);
  return {
    id: contact.id,
    protocolId: contact.protocolId,
    displayName: contact.displayName,
    raw
  };
}

function normalizeContact(raw: RawContact, self?: RawContact): ContactInput {
  const protocolId = raw.UserName;
  const kind = detectContactKind(raw, self);
  const displayName = firstCleanContactDisplayName(
    raw.getDisplayName?.(),
    raw.RemarkName,
    raw.DisplayName,
    raw.NickName,
    raw.Alias,
    protocolId,
    "Unknown"
  );
  const remarkName = cleanText(raw.RemarkName);
  const nickName = cleanText(raw.NickName);
  const alias = cleanText(raw.Alias);
  const id = contactId(
    kind,
    protocolId ? [protocolId] : [raw.Uin ? String(raw.Uin) : undefined, alias, remarkName, nickName, displayName]
  );

  return {
    id,
    protocolId,
    kind,
    displayName,
    remarkName: remarkName || undefined,
    nickName: nickName || undefined,
    alias: alias || undefined,
    isSelf: raw.isSelf === true || (!!self?.UserName && raw.UserName === self.UserName),
    raw
  };
}

export function normalizeWechat4uMessage(rawInput: unknown, botInput: unknown): IncomingProtocolMessage | undefined {
  const raw = rawInput as RawMessage;
  const bot = botInput as RawWechatBot;
  if (isInternalProtocolMessage(raw, bot)) {
    return undefined;
  }

  const from = raw.FromUserName;
  const to = raw.ToUserName;
  const selfProtocolId = bot.user?.UserName;
  const isSelf = raw.isSendBySelf === true || (!!selfProtocolId && from === selfProtocolId);
  const conversationProtocolId = raw.getPeerUserName?.() ?? (isSelf ? to : from);
  if (!conversationProtocolId) {
    return undefined;
  }

  const contact = bot.contacts?.[conversationProtocolId] ?? ({ UserName: conversationProtocolId } satisfies RawContact);
  const conversationContact = normalizeContact(contact, bot.user);
  const conversation = conversationFromContact(conversationContact);
  const timestamp = raw.CreateTime ? raw.CreateTime * 1000 : Date.now();
  const protocolMessageId = raw.MsgId ?? (raw.NewMsgId ? String(raw.NewMsgId) : undefined);
  const type = detectMessageKind(raw, bot);
  const parsedContent = parseMessageContent(raw, conversationContact, isSelf);
  const sender = isSelf
    ? normalizeContact(bot.user ?? { UserName: selfProtocolId, NickName: "You", isSelf: true }, bot.user)
    : normalizeSender(raw, bot, conversationContact, parsedContent);
  const content =
    type === "text" || type === "notice"
      ? parsedContent.content || placeholderForMessageKind(type, raw)
      : placeholderForMessageKind(type, raw);

  return {
    id: protocolMessageId ? `wechat:${protocolMessageId}` : localMessageId([conversation.id, sender.id, content, String(timestamp)]),
    protocolMessageId,
    conversation,
    sender,
    isSelf,
    content,
    type,
    timestamp,
    raw
  };
}

function isInternalProtocolMessage(raw: RawMessage, bot: RawWechatBot): boolean {
  const conf = bot.CONF as
    | {
        MSGTYPE_TEXT?: number;
        MSGTYPE_STATUSNOTIFY?: number;
        MSGTYPE_SYSNOTICE?: number;
        MSGTYPE_SYS?: number;
      }
    | undefined;
  const messageType = Number(raw.MsgType);

  if (messageType === Number(conf?.MSGTYPE_STATUSNOTIFY ?? 51) || raw.StatusNotifyUserName || raw.StatusNotifyCode) {
    return true;
  }

  const content = cleanText(raw.Content);
  const selfProtocolId = bot.user?.UserName;
  const isSelf = raw.isSendBySelf === true || (!!selfProtocolId && raw.FromUserName === selfProtocolId);
  if (isSelf && raw.ToUserName === "filehelper" && content.startsWith("心跳：")) {
    return true;
  }

  const textType = Number(conf?.MSGTYPE_TEXT ?? 1);
  const systemTypes = [Number(conf?.MSGTYPE_SYSNOTICE ?? 9999), Number(conf?.MSGTYPE_SYS ?? 10000)];
  if (isSelf && !content && messageType !== textType) {
    return true;
  }

  return !content && systemTypes.includes(messageType);
}

function normalizeSender(
  raw: RawMessage,
  bot: RawWechatBot,
  conversationContact: ContactInput,
  parsedContent: ParsedMessageContent
): ContactInput {
  if (conversationContact.kind === "group") {
    const senderProtocolId = parsedContent.senderProtocolId ?? raw.ActualUserName;
    const conversationRaw = conversationContact.raw as RawContact | undefined;
    const member = senderProtocolId
      ? conversationRaw?.MemberList?.find((item) => item.UserName === senderProtocolId) ?? bot.contacts?.[senderProtocolId]
      : undefined;
    if (senderProtocolId) {
      const contact = mergeGroupSenderContact({
        senderProtocolId,
        groupMember: member,
        directoryContact: bot.contacts?.[senderProtocolId],
        fallbackDisplayName: parsedContent.senderDisplayName,
        fallbackNickName: raw.ActualNickName
      });
      return normalizeContact(contact, bot.user);
    }
    if (parsedContent.senderDisplayName) {
      return syntheticGroupSender(conversationContact, parsedContent.senderDisplayName);
    }
    return syntheticGroupSender(conversationContact, "Group member");
  }
  return conversationContact;
}

interface ParsedMessageContent {
  content: string;
  senderDisplayName?: string;
  senderProtocolId?: string;
}

function parseMessageContent(
  raw: RawMessage,
  conversationContact: ContactInput,
  isSelf: boolean
): ParsedMessageContent {
  const content = cleanText(raw.Content);
  if (conversationContact.kind !== "group" || isSelf) {
    return { content };
  }

  const match = content.match(/^(.+?):\n([\s\S]*)$/);
  if (!match) {
    return {
      content,
      senderProtocolId: raw.ActualUserName ?? extractGroupSenderProtocolId(raw.OriginalContent) ?? extractGroupSenderProtocolId(raw.Content),
      senderDisplayName: cleanText(raw.ActualNickName) || undefined
    };
  }

  const senderDisplayName = cleanText(raw.ActualNickName) || cleanGroupSenderDisplayName(match[1]);
  return {
    senderProtocolId: raw.ActualUserName ?? extractGroupSenderProtocolId(raw.OriginalContent) ?? extractGroupSenderProtocolId(raw.Content),
    senderDisplayName,
    content: match[2].trim()
  };
}

function detectMessageKind(raw: RawMessage, bot: RawWechatBot): MessageKind {
  const conf = bot.CONF as
    | {
        MSGTYPE_TEXT?: number;
        MSGTYPE_IMAGE?: number;
        MSGTYPE_VOICE?: number;
        MSGTYPE_VIDEO?: number;
        MSGTYPE_MICROVIDEO?: number;
        MSGTYPE_EMOTICON?: number;
        MSGTYPE_APP?: number;
      }
    | undefined;
  const messageType = Number(raw.MsgType);
  if (messageType === Number(conf?.MSGTYPE_TEXT ?? 1)) {
    return "text";
  }
  if (messageType === Number(conf?.MSGTYPE_IMAGE ?? 3)) {
    return "image";
  }
  if (messageType === Number(conf?.MSGTYPE_VOICE ?? 34)) {
    return "voice";
  }
  if (messageType === Number(conf?.MSGTYPE_VIDEO ?? 43) || messageType === Number(conf?.MSGTYPE_MICROVIDEO ?? 62)) {
    return "video";
  }
  if (messageType === Number(conf?.MSGTYPE_EMOTICON ?? 47)) {
    return "sticker";
  }
  if (messageType === Number(conf?.MSGTYPE_APP ?? 49)) {
    const appType = Number(raw.AppMsgType);
    if (appType === 6 || appType === 74) {
      return "file";
    }
    if (appType === 33 || appType === 36) {
      return "mini-program";
    }
    return raw.Content ? "notice" : "unsupported";
  }
  return raw.Content ? "notice" : "unsupported";
}

function placeholderForMessageKind(type: MessageKind, raw: RawMessage): string {
  switch (type) {
    case "image":
      return "[image]";
    case "voice":
      return "[voice]";
    case "video":
      return "[video]";
    case "file": {
      const fileName = cleanText(raw.FileName) || cleanText(raw.FileNameTitle);
      return fileName ? `[file] ${fileName}` : "[file]";
    }
    case "mini-program":
      return "[mini-program]";
    case "sticker":
      return "[sticker]";
    default:
      return "[unsupported message]";
  }
}

function detectContactKind(raw: RawContact, self?: RawContact): ContactKind {
  if (raw.isSelf === true || (!!self?.UserName && raw.UserName === self.UserName)) {
    return "self";
  }
  if (raw.UserName?.startsWith("@@")) {
    return "group";
  }
  if (raw.UserName?.endsWith("@chatroom")) {
    return "group";
  }
  if (isPublicVerifyFlag(raw.VerifyFlag)) {
    return "public";
  }
  if (raw.KeyWord?.startsWith("gh_")) {
    return "public";
  }
  if (raw.UserName?.startsWith("@")) {
    return "private";
  }
  return "special";
}

function isPublicVerifyFlag(value: unknown): boolean {
  const verifyFlag = Number(value ?? 0);
  const biz = 1;
  const bizBig = 4;
  const bizBrand = 8;
  const bizVerified = 16;
  return (verifyFlag & (biz | bizBig | bizBrand | bizVerified)) !== 0;
}

function firstCleanContactDisplayName(...inputs: Array<unknown>): string {
  for (const input of inputs) {
    const displayName = cleanContactDisplayName(input);
    if (displayName) {
      return displayName;
    }
  }
  return "Unknown";
}

function cleanContactDisplayName(input: unknown): string {
  return cleanText(input).replace(/^\[群\]\s*/, "");
}

function cleanGroupSenderDisplayName(input: unknown): string | undefined {
  const value = cleanContactDisplayName(input);
  return value && !looksLikeProtocolUserName(value) ? value : undefined;
}

function extractGroupSenderProtocolId(input: unknown): string | undefined {
  const raw = typeof input === "string" ? input : "";
  return raw.match(/^(@[^:<\n]+):(?:<br\s*\/?>|\n)?/)?.[1];
}

function looksLikeProtocolUserName(input: string): boolean {
  return input.startsWith("@");
}

function syntheticGroupSender(conversationContact: ContactInput, displayName: string): ContactInput {
  return {
    id: contactId("private", [conversationContact.id, displayName]),
    kind: "private",
    displayName,
    isSelf: false
  };
}

function mergeGroupSenderContact(input: {
  senderProtocolId: string;
  groupMember?: RawContact;
  directoryContact?: RawContact;
  fallbackDisplayName?: string;
  fallbackNickName?: string;
}): RawContact {
  const merged: RawContact = {
    ...(input.directoryContact ?? {}),
    ...(input.groupMember ?? {}),
    UserName: input.senderProtocolId
  };

  merged.RemarkName = firstCleanValue(input.groupMember?.RemarkName, input.directoryContact?.RemarkName);
  merged.DisplayName = firstCleanValue(
    input.groupMember?.DisplayName,
    input.directoryContact?.DisplayName,
    input.fallbackDisplayName
  );
  merged.NickName = firstCleanValue(
    input.groupMember?.NickName,
    input.directoryContact?.NickName,
    input.fallbackNickName,
    input.fallbackDisplayName
  );
  merged.Alias = firstCleanValue(input.groupMember?.Alias, input.directoryContact?.Alias);

  return merged;
}

function firstCleanValue(...inputs: Array<unknown>): string | undefined {
  for (const input of inputs) {
    const value = cleanText(input);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function extractSentMessageId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as { MsgID?: unknown; MsgId?: unknown; NewMsgId?: unknown };
  return value.MsgID ? String(value.MsgID) : value.MsgId ? String(value.MsgId) : value.NewMsgId ? String(value.NewMsgId) : undefined;
}

function isLoggedIn(bot: RawWechatBot): boolean {
  const state = bot.CONF && typeof bot.CONF === "object" ? (bot.CONF as { STATE?: { login?: unknown } }).STATE : undefined;
  return state?.login !== undefined && bot.state === state.login;
}
