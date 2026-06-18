import { EventEmitter } from "node:events";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { basename } from "node:path";
import type { Logger } from "pino";
import WechatConstructor from "wechat4u";
import type {
  ConnectionState,
  ContactInput,
  ContactKind,
  IncomingProtocolMessage,
  MediaDownloadResult,
  MessageKind,
  ProtocolQrEvent,
  UserProfile,
  WeChatProtocol
} from "../types.js";
import { groupMemberCountFromRaw, stripGroupMemberCountSuffix } from "../util/group-name.js";
import { contactId, conversationFromContact, localMessageId } from "../util/ids.js";
import { cleanText, decodeHtml } from "../util/text.js";
import { formatWechatRecallMessage } from "../util/wechat-recall.js";
import { preview, summarizeContacts, summarizeIncomingMessage, summarizeRawWechatMessage } from "../logging.js";

const WECHAT4U_CONTACT_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

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
  sendMsg?: (msg: string | { file: unknown; filename: string }, toUserName: string) => Promise<unknown>;
  getMsgImg?: (msgId: string) => Promise<{ data: ArrayBuffer; type: string }>;
  getVideo?: (msgId: string) => Promise<{ data: ArrayBuffer; type: string }>;
  getVoice?: (msgId: string) => Promise<{ data: ArrayBuffer; type: string }>;
  getDoc?: (fromUserName: string, mediaId: string, fileName: string) => Promise<{ data: ArrayBuffer; type: string }>;
  batchGetContact?: (contacts: RawContact[]) => Promise<RawContact[]>;
  updateContacts?: (contacts: RawContact[]) => void;
  Message?: {
    extend?: (message: RawMessage) => RawMessage;
  };
  handleMsg?: (messages: RawMessage[]) => void;
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
  EncryChatRoomId?: string;
  ChatRoomId?: number | string;
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
  FileSize?: number | string;
  MediaId?: string;
  Url?: string;
  CreateTime?: number;
  StatusNotifyCode?: number;
  StatusNotifyUserName?: string;
  SubMsgType?: number;
  RecommendInfo?: unknown;
  AppInfo?: unknown;
  isSendBySelf?: boolean;
  getPeerUserName?: () => string;
}

export interface Wechat4uAdapterOptions {
  logger?: Logger;
}

interface NormalizeWechat4uMessageOptions {
  logger?: Logger;
}

type Wechat4uMessageContactRefreshReason =
  | "missing-contact"
  | "empty-group-members"
  | "missing-group-member-display-name";

export class Wechat4uAdapter extends EventEmitter implements WeChatProtocol {
  private bot?: RawWechatBot;
  private user?: UserProfile;
  private readonly hydratedGroupSenderKeys = new Set<string>();
  private readonly inFlightGroupSenderHydrationKeys = new Set<string>();

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

  async sendFile(toProtocolId: string, filePath: string): Promise<{ messageId?: string; raw?: unknown }> {
    if (!this.bot) {
      throw new Error("WeChat protocol is not started");
    }
    const sender = this.bot.sendMsg;
    if (!sender) {
      throw new Error("wechat4u does not expose sendMsg method");
    }
    if (!(await fileExists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    const filename = basename(filePath);
    const file = createReadStream(filePath);
    this.options.logger?.debug(
      { toProtocolId, filePath, filename },
      "sending wechat file"
    );
    const raw = await sender.call(this.bot, { file, filename }, toProtocolId);
    const messageId = extractSentMessageId(raw);
    this.options.logger?.debug({ toProtocolId, messageId, raw: summarizeRawWechatMessage(raw) }, "wechat file send completed");
    return { messageId, raw };
  }

  async downloadMedia(message: IncomingProtocolMessage): Promise<MediaDownloadResult | undefined> {
    if (!this.bot) {
      return undefined;
    }
    const msgId = message.protocolMessageId;
    if (!msgId) {
      return undefined;
    }

    const raw = message.raw as RawMessage | undefined;
    try {
      let result: { data: ArrayBuffer; type: string } | undefined;

      switch (message.type) {
        case "image":
        case "sticker":
          if (this.bot.getMsgImg) {
            result = await this.bot.getMsgImg(msgId);
          }
          break;
        case "video":
          if (this.bot.getVideo) {
            result = await this.bot.getVideo(msgId);
          }
          break;
        case "voice":
          if (this.bot.getVoice) {
            result = await this.bot.getVoice(msgId);
          }
          break;
        case "file": {
          const fromUser = raw?.FromUserName;
          const mediaId = raw?.MediaId ?? extractAttachId(raw?.Content);
          const fileName = raw?.FileName ?? raw?.FileNameTitle;
          if (this.bot.getDoc && fromUser && mediaId && fileName) {
            result = await this.bot.getDoc(fromUser, mediaId, fileName);
          }
          break;
        }
        default:
          return undefined;
      }

      if (!result?.data) {
        return undefined;
      }

      this.options.logger?.debug(
        { msgId, type: message.type, contentType: result.type, size: result.data.byteLength },
        "media downloaded"
      );

      return {
        data: Buffer.from(result.data),
        contentType: result.type ?? "application/octet-stream"
      };
    } catch (error) {
      this.options.logger?.debug({ err: error, msgId, type: message.type }, "media download failed");
      return undefined;
    }
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
    const Wechat = WechatConstructor as new (botData?: unknown) => RawWechatBot;
    const bot = new Wechat(sessionData);
    // wechat4u defaults to sending a periodic "heartbeat" text to filehelper.
    // It is a protocol keepalive, not a user-visible chat message.
    bot.setPollingTargetGetter?.(() => "");
    const nonBlockingMessageDispatch = installNonBlockingWechat4uMessageDispatch(bot, { logger: this.options.logger });
    this.options.logger?.debug(
      {
        hasSessionData: sessionData !== undefined,
        disabledFilehelperHeartbeat: !!bot.setPollingTargetGetter,
        nonBlockingMessageDispatch
      },
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
      this.handleBotMessage(bot, message);
    });

    bot.on("logout", () => {
      this.options.logger?.info("wechat4u logout event received");
      this.emit("state", "logout" satisfies ConnectionState);
      this.emit("logout");
    });

    bot.on("error", (error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      const errorSummary = summarizeWechat4uError(normalizedError);
      if (isRecoverableWechat4uError(normalizedError)) {
        this.options.logger?.warn({ error: errorSummary }, "wechat4u recoverable error");
        if (isLoggedIn(bot)) {
          this.emit("state", "online" satisfies ConnectionState);
        }
        return;
      }

      this.options.logger?.error({ error: errorSummary }, "wechat4u error");
      this.emit("state", "error" satisfies ConnectionState);
      this.emit("error", toProtocolError(normalizedError));
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

  private handleBotMessage(bot: RawWechatBot, message: RawMessage): void {
    try {
      this.cacheCurrentUserFromBot(bot, "message event");
      this.options.logger?.debug({ raw: summarizeRawWechatMessage(message) }, "wechat4u raw message received");
      void hydrateSparseGroupSender(message, bot, {
        logger: this.options.logger,
        hydratedKeys: this.hydratedGroupSenderKeys,
        inFlightKeys: this.inFlightGroupSenderHydrationKeys
      }).then((hydratedGroup) => {
        if (hydratedGroup) {
          this.emit("contacts", [normalizeContact(hydratedGroup, bot.user)]);
        }
      }).catch((error) => {
        this.options.logger?.debug({ err: error }, "background sparse group sender hydration failed");
      });
      const normalized = normalizeWechat4uMessage(message, bot, { logger: this.options.logger });
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
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface NonBlockingWechat4uMessageDispatchOptions {
  logger?: Logger;
}

export function installNonBlockingWechat4uMessageDispatch(
  botInput: unknown,
  options: NonBlockingWechat4uMessageDispatchOptions = {}
): boolean {
  const bot = botInput as RawWechatBot;
  if (typeof bot.handleMsg !== "function" || typeof bot.Message?.extend !== "function") {
    return false;
  }

  const extendMessage = bot.Message.extend.bind(bot.Message);
  const inFlightContactRefreshes = new Set<string>();
  const recentContactRefreshes = new Map<string, number>();
  bot.handleMsg = (messages: RawMessage[]) => {
    const messageList = Array.isArray(messages) ? messages : [];
    for (const raw of messageList) {
      try {
        scheduleWechat4uMessageContactRefresh(raw, bot, inFlightContactRefreshes, recentContactRefreshes, options);
        ensureWechat4uMessageContactPlaceholder(raw, bot);
        const message = extendMessage(raw);
        bot.emit("message", message);
        scheduleWechat4uStatusNotifyContactRefresh(message, bot, options);
        if (isWechat4uStopControlMessage(message)) {
          bot.stop();
        }
      } catch (error) {
        options.logger?.debug({ err: error }, "wechat4u non-blocking message dispatch failed");
        bot.emit("error", error);
      }
    }
  };
  return true;
}

function scheduleWechat4uMessageContactRefresh(
  raw: RawMessage,
  bot: RawWechatBot,
  inFlightContactRefreshes: Set<string>,
  recentContactRefreshes: Map<string, number>,
  options: NonBlockingWechat4uMessageDispatchOptions
): void {
  const fromUserName = raw.FromUserName;
  const reason = wechat4uMessageContactRefreshReason(raw, bot);
  if (!fromUserName || !bot.batchGetContact || !bot.updateContacts || !reason) {
    return;
  }
  const refreshKey = `${fromUserName}:${reason}`;
  const now = Date.now();
  const lastRefreshAt = recentContactRefreshes.get(refreshKey);
  if (lastRefreshAt !== undefined && now - lastRefreshAt < WECHAT4U_CONTACT_REFRESH_COOLDOWN_MS) {
    options.logger?.trace(
      {
        fromUserName,
        reason,
        lastRefreshAt,
        cooldownMs: WECHAT4U_CONTACT_REFRESH_COOLDOWN_MS
      },
      "skipping background message contact refresh during cooldown"
    );
    return;
  }
  if (inFlightContactRefreshes.has(fromUserName)) {
    options.logger?.trace(
      {
        fromUserName,
        reason,
        raw: summarizeRawWechatMessage(raw)
      },
      "skipping background message contact refresh already in flight"
    );
    return;
  }

  inFlightContactRefreshes.add(fromUserName);
  options.logger?.debug(
    {
      fromUserName,
      reason,
      contact: summarizeGroupSenderRawContact(bot.contacts?.[fromUserName]),
      senderProtocolId: groupMessageSenderProtocolId(raw),
      raw: summarizeRawWechatMessage(raw)
    },
    "scheduling background message contact refresh"
  );
  void bot.batchGetContact([{ UserName: fromUserName }]).then((contacts) => {
    options.logger?.debug(
      {
        fromUserName,
        reason,
        returnedCount: contacts.length,
        returnedContacts: contacts.slice(0, 3).map((contact) => summarizeGroupContactRaw(contact))
      },
      "background message contact refresh returned"
    );
    bot.updateContacts?.(contacts);
    recentContactRefreshes.set(refreshKey, Date.now());
  }).catch((error) => {
    options.logger?.debug({ err: error, fromUserName }, "background message contact refresh failed");
  }).finally(() => {
    inFlightContactRefreshes.delete(fromUserName);
  });
}

function wechat4uMessageContactRefreshReason(
  raw: RawMessage,
  bot: RawWechatBot
): Wechat4uMessageContactRefreshReason | undefined {
  const fromUserName = raw.FromUserName;
  if (!fromUserName) {
    return undefined;
  }
  const contact = bot.contacts?.[fromUserName];
  if (!contact) {
    return "missing-contact";
  }
  if (!fromUserName.startsWith("@@")) {
    return undefined;
  }
  if (Number(contact.MemberCount ?? 0) === 0) {
    return "empty-group-members";
  }
  const senderProtocolId = groupMessageSenderProtocolId(raw);
  if (!senderProtocolId || !senderProtocolId.startsWith("@") || senderProtocolId.startsWith("@@")) {
    return undefined;
  }
  const member = contact.MemberList?.find((item) => item.UserName === senderProtocolId);
  return rawContactHasGroupDisplayName(member) ? undefined : "missing-group-member-display-name";
}

function ensureWechat4uMessageContactPlaceholder(raw: RawMessage, bot: RawWechatBot): void {
  const fromUserName = raw.FromUserName;
  if (!fromUserName?.startsWith("@@")) {
    return;
  }

  bot.contacts ??= {};
  const contact = bot.contacts[fromUserName] ?? {
    UserName: fromUserName,
    NickName: fromUserName,
    DisplayName: fromUserName,
    MemberCount: 0,
    MemberList: []
  };
  if (!Array.isArray(contact.MemberList)) {
    contact.MemberList = [];
  }
  if (contact.MemberCount === undefined) {
    contact.MemberCount = contact.MemberList.length;
  }
  bot.contacts[fromUserName] = contact;
}

function scheduleWechat4uStatusNotifyContactRefresh(
  raw: RawMessage,
  bot: RawWechatBot,
  options: NonBlockingWechat4uMessageDispatchOptions
): void {
  if (!raw.StatusNotifyUserName || !bot.batchGetContact || !bot.updateContacts) {
    return;
  }

  const conf = bot.CONF as { MSGTYPE_STATUSNOTIFY?: number } | undefined;
  if (Number(raw.MsgType) !== Number(conf?.MSGTYPE_STATUSNOTIFY ?? 51)) {
    return;
  }

  const userList = raw.StatusNotifyUserName.split(",")
    .map((UserName) => UserName.trim())
    .filter((UserName) => UserName && !bot.contacts?.[UserName])
    .map((UserName) => ({ UserName }));
  for (const list of chunkArray(userList, 50)) {
    void bot.batchGetContact(list).then((contacts) => {
      bot.updateContacts?.(contacts);
    }).catch((error) => {
      options.logger?.debug({ err: error, contactCount: list.length }, "background status notify contact refresh failed");
    });
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isWechat4uStopControlMessage(raw: RawMessage): boolean {
  const content = raw.Content ?? "";
  return (raw.ToUserName === "filehelper" && content === "退出wechat4u") || /^(.\udf1a\u0020\ud83c.){3}$/.test(content);
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
  const groupMemberCount = kind === "group" ? groupMemberCountFromRaw(raw) : undefined;
  const rawDisplayName = contactDisplayName(raw, kind, groupMemberCount, protocolId);
  const displayName = cleanContactNamePart(kind, rawDisplayName, groupMemberCount);
  const remarkName = cleanContactNamePart(kind, raw.RemarkName, groupMemberCount);
  const nickName = cleanContactNamePart(kind, raw.NickName, groupMemberCount);
  const alias = cleanText(raw.Alias);
  const uin = raw.Uin ? String(raw.Uin) : undefined;
  const id = contactId(kind, contactIdentityParts(kind, protocolId, uin, alias, remarkName, nickName, displayName));

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

function contactIdentityParts(
  kind: ContactInput["kind"],
  protocolId: string | undefined,
  uin: string | undefined,
  alias: string,
  remarkName: string,
  nickName: string,
  displayName: string
): Array<string | undefined> {
  if (kind === "self" && uin) {
    return [uin];
  }
  return protocolId ? [protocolId] : [uin, alias, remarkName, nickName, displayName];
}

export function normalizeWechat4uMessage(
  rawInput: unknown,
  botInput: unknown,
  options: NormalizeWechat4uMessageOptions = {}
): IncomingProtocolMessage | undefined {
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
  const content = messageContentForKind(type, raw, conversationContact, parsedContent, isSelf);

  if (conversationContact.kind === "group" && !isSelf) {
    logGroupSenderResolution(options.logger, raw, bot, conversationContact, parsedContent, sender);
  }

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

interface HydrateSparseGroupSenderOptions {
  logger?: Logger;
  hydratedKeys?: Set<string>;
  inFlightKeys?: Set<string>;
}

export async function hydrateSparseGroupSender(
  rawInput: unknown,
  botInput: unknown,
  options: HydrateSparseGroupSenderOptions = {}
): Promise<RawContact | undefined> {
  const raw = rawInput as RawMessage;
  const bot = botInput as RawWechatBot;
  if (!bot.batchGetContact) {
    return undefined;
  }

  const target = sparseGroupSenderHydrationTarget(raw, bot);
  if (!target) {
    return undefined;
  }

  const candidates = groupRoomIdCandidates(target.groupRaw, target.conversationProtocolId);
  const fetchKey = `${target.conversationProtocolId}:${target.senderProtocolId}`;
  if (options.hydratedKeys?.has(fetchKey) || options.inFlightKeys?.has(fetchKey)) {
    options.logger?.trace(
      {
        groupProtocolId: target.conversationProtocolId,
        senderProtocolId: target.senderProtocolId,
        alreadyHydrated: options.hydratedKeys?.has(fetchKey) === true,
        inFlight: options.inFlightKeys?.has(fetchKey) === true
      },
      "skipping sparse group sender hydration"
    );
    return undefined;
  }
  options.inFlightKeys?.add(fetchKey);
  options.logger?.debug(
    {
      groupProtocolId: target.conversationProtocolId,
      senderProtocolId: target.senderProtocolId,
      candidateCount: candidates.length,
      existingMember: summarizeGroupSenderRawContact(target.groupMember),
      directoryContact: summarizeGroupSenderRawContact(target.directoryContact),
      parsedSenderDisplayName: target.parsedSenderDisplayName
    },
    "hydrating sparse group sender"
  );

  try {
    let fallbackHydrated: { contact: RawContact; hasEncryChatRoomId: boolean } | undefined;
    for (const encryChatRoomId of candidates) {
      try {
        const contacts = await bot.batchGetContact([
          {
            UserName: target.senderProtocolId,
            EncryChatRoomId: encryChatRoomId
          }
        ]);
        const hydrated = contacts.find((contact) => contact.UserName === target.senderProtocolId);
        if (!hydrated) {
          continue;
        }
        if (!rawContactHasUsefulGroupSenderName(hydrated)) {
          options.logger?.debug(
            {
              groupProtocolId: target.conversationProtocolId,
              senderProtocolId: target.senderProtocolId,
              hasEncryChatRoomId: encryChatRoomId.length > 0,
              contact: summarizeGroupSenderRawContact(hydrated)
            },
            "sparse group sender lookup returned no useful name"
          );
          continue;
        }
        if (!rawContactHasGroupDisplayName(hydrated)) {
          fallbackHydrated ??= {
            contact: hydrated,
            hasEncryChatRoomId: encryChatRoomId.length > 0
          };
          options.logger?.debug(
            {
              groupProtocolId: target.conversationProtocolId,
              senderProtocolId: target.senderProtocolId,
              hasEncryChatRoomId: encryChatRoomId.length > 0,
              contact: summarizeGroupSenderRawContact(hydrated)
            },
            "sparse group sender lookup returned fallback name"
          );
          continue;
        }
        mergeGroupMemberIntoRaw(target.groupRaw, hydrated);
        options.hydratedKeys?.add(fetchKey);
        options.logger?.debug(
          {
            groupProtocolId: target.conversationProtocolId,
            senderProtocolId: target.senderProtocolId,
            hasEncryChatRoomId: encryChatRoomId.length > 0,
            contact: summarizeGroupSenderRawContact(hydrated)
          },
          "hydrated sparse group sender"
        );
        return target.groupRaw;
      } catch (error) {
        options.logger?.debug(
          {
            err: error,
            groupProtocolId: target.conversationProtocolId,
            senderProtocolId: target.senderProtocolId,
            hasEncryChatRoomId: encryChatRoomId.length > 0
          },
          "failed to hydrate sparse group sender"
        );
      }
    }
    if (fallbackHydrated) {
      mergeGroupMemberIntoRaw(target.groupRaw, fallbackHydrated.contact);
      options.hydratedKeys?.add(fetchKey);
      options.logger?.debug(
        {
          groupProtocolId: target.conversationProtocolId,
          senderProtocolId: target.senderProtocolId,
          hasEncryChatRoomId: fallbackHydrated.hasEncryChatRoomId,
          contact: summarizeGroupSenderRawContact(fallbackHydrated.contact)
        },
        "hydrated sparse group sender with fallback name"
      );
      return target.groupRaw;
    }
    return undefined;
  } finally {
    options.inFlightKeys?.delete(fetchKey);
  }
}

interface SparseGroupSenderHydrationTarget {
  conversationProtocolId: string;
  senderProtocolId: string;
  groupRaw: RawContact;
  groupMember?: RawContact;
  directoryContact?: RawContact;
  parsedSenderDisplayName?: string;
}

function sparseGroupSenderHydrationTarget(raw: RawMessage, bot: RawWechatBot): SparseGroupSenderHydrationTarget | undefined {
  if (isInternalProtocolMessage(raw, bot)) {
    return undefined;
  }

  const from = raw.FromUserName;
  const to = raw.ToUserName;
  const selfProtocolId = bot.user?.UserName;
  const isSelf = raw.isSendBySelf === true || (!!selfProtocolId && from === selfProtocolId);
  if (isSelf) {
    return undefined;
  }

  const conversationProtocolId = raw.getPeerUserName?.() ?? from;
  if (!conversationProtocolId) {
    return undefined;
  }

  const groupRaw = bot.contacts?.[conversationProtocolId] ?? ({ UserName: conversationProtocolId } satisfies RawContact);
  const conversationContact = normalizeContact(groupRaw, bot.user);
  if (conversationContact.kind !== "group") {
    return undefined;
  }

  const parsedContent = parseMessageContent(raw, conversationContact, false);
  const senderProtocolId = parsedContent.senderProtocolId ?? raw.ActualUserName;
  if (!senderProtocolId || !senderProtocolId.startsWith("@") || senderProtocolId.startsWith("@@")) {
    return undefined;
  }

  const member = groupRaw.MemberList?.find((item) => item.UserName === senderProtocolId);
  if (rawContactHasGroupDisplayName(member)) {
    return undefined;
  }

  return {
    conversationProtocolId,
    senderProtocolId,
    groupRaw,
    groupMember: member,
    directoryContact: bot.contacts?.[senderProtocolId],
    parsedSenderDisplayName: parsedContent.senderDisplayName
  };
}

function rawContactHasUsefulGroupSenderName(contact: RawContact | undefined): boolean {
  return !!firstUsefulGroupSenderName(
    contact?.getDisplayName?.(),
    contact?.RemarkName,
    contact?.DisplayName,
    contact?.NickName,
    contact?.Alias
  );
}

function rawContactHasGroupDisplayName(contact: RawContact | undefined): boolean {
  return !!firstUsefulGroupSenderName(contact?.DisplayName);
}

function groupRoomIdCandidates(groupRaw: RawContact, conversationProtocolId: string): string[] {
  const candidates = [
    cleanRawString(groupRaw.EncryChatRoomId),
    cleanRawString(groupRaw.UserName),
    conversationProtocolId,
    ""
  ];
  return Array.from(new Set(candidates.filter((candidate): candidate is string => candidate !== undefined)));
}

function mergeGroupMemberIntoRaw(groupRaw: RawContact, member: RawContact): void {
  const memberList = Array.isArray(groupRaw.MemberList) ? groupRaw.MemberList : [];
  const existingIndex = memberList.findIndex((item) => item.UserName === member.UserName);
  if (existingIndex >= 0) {
    memberList[existingIndex] = {
      ...memberList[existingIndex],
      ...member
    };
  } else {
    memberList.push(member);
  }
  groupRaw.MemberList = memberList;
  groupRaw.MemberCount = Math.max(Number(groupRaw.MemberCount ?? 0), memberList.length);
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
    const member = senderProtocolId ? conversationRaw?.MemberList?.find((item) => item.UserName === senderProtocolId) : undefined;
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

function logGroupSenderResolution(
  logger: Logger | undefined,
  raw: RawMessage,
  bot: RawWechatBot,
  conversationContact: ContactInput,
  parsedContent: ParsedMessageContent,
  sender: ContactInput
): void {
  const summary = summarizeGroupSenderResolution(raw, bot, conversationContact, parsedContent, sender);
  if (summary.hasGroupDisplayName === true) {
    logger?.trace({ sender: summary }, "resolved group message sender");
    return;
  }
  logger?.debug({ sender: summary }, "resolved group message sender");
}

function summarizeGroupSenderResolution(
  raw: RawMessage,
  bot: RawWechatBot,
  conversationContact: ContactInput,
  parsedContent: ParsedMessageContent,
  sender: ContactInput
): Record<string, unknown> {
  const conversationRaw = conversationContact.raw as RawContact | undefined;
  const senderProtocolId = parsedContent.senderProtocolId ?? raw.ActualUserName;
  const groupMember = senderProtocolId
    ? conversationRaw?.MemberList?.find((item) => item.UserName === senderProtocolId)
    : undefined;
  const directoryContact = senderProtocolId ? bot.contacts?.[senderProtocolId] : undefined;
  const hasGroupDisplayName = rawContactHasGroupDisplayName(groupMember);

  return {
    messageId: raw.MsgId ?? raw.NewMsgId,
    conversationProtocolId: conversationContact.protocolId,
    senderProtocolId,
    hasGroupDisplayName,
    parsedSenderDisplayName: parsedContent.senderDisplayName,
    actualNickName: cleanGroupSenderDisplayName(raw.ActualNickName),
    selected: {
      id: sender.id,
      protocolId: sender.protocolId,
      displayName: sender.displayName,
      remarkName: sender.remarkName,
      nickName: sender.nickName,
      alias: sender.alias
    },
    groupMember: summarizeGroupSenderRawContact(groupMember),
    directoryContact: summarizeGroupSenderRawContact(directoryContact),
    groupMemberCount: conversationRaw?.MemberCount,
    groupMemberListSize: conversationRaw?.MemberList?.length
  };
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
      senderProtocolId: groupMessageSenderProtocolId(raw),
      senderDisplayName: cleanGroupSenderDisplayName(raw.ActualNickName)
    };
  }

  const senderDisplayName = cleanGroupSenderDisplayName(raw.ActualNickName) || cleanGroupSenderDisplayName(match[1]);
  return {
    senderProtocolId: groupMessageSenderProtocolId(raw),
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
        MSGTYPE_LOCATION?: number;
        MSGTYPE_SHARECARD?: number;
        MSGTYPE_RECALLED?: number;
        APPMSGTYPE_IMG?: number;
        APPMSGTYPE_AUDIO?: number;
        APPMSGTYPE_VIDEO?: number;
        APPMSGTYPE_URL?: number;
        APPMSGTYPE_ATTACH?: number;
        APPMSGTYPE_EMOJI?: number;
        APPMSGTYPE_EMOTION?: number;
        APPMSGTYPE_READER_TYPE?: number;
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
  if (messageType === Number(conf?.MSGTYPE_LOCATION ?? 48)) {
    return "notice";
  }
  if (messageType === Number(conf?.MSGTYPE_SHARECARD ?? 42)) {
    return "notice";
  }
  if (messageType === Number(conf?.MSGTYPE_RECALLED ?? 10002)) {
    return "notice";
  }
  if (messageType === Number(conf?.MSGTYPE_APP ?? 49)) {
    const appType = Number(raw.AppMsgType);
    if (appType === Number(conf?.APPMSGTYPE_URL ?? 5) || appType === Number(conf?.APPMSGTYPE_READER_TYPE ?? 100001)) {
      return "link";
    }
    if (appType === Number(conf?.APPMSGTYPE_ATTACH ?? 6) || appType === 74) {
      return "file";
    }
    if (appType === Number(conf?.APPMSGTYPE_IMG ?? 2)) {
      return "image";
    }
    if (appType === Number(conf?.APPMSGTYPE_VIDEO ?? 4)) {
      return "video";
    }
    if (appType === Number(conf?.APPMSGTYPE_EMOJI ?? 8) || appType === Number(conf?.APPMSGTYPE_EMOTION ?? 15)) {
      return "sticker";
    }
    if (appType === 33 || appType === 36) {
      return "mini-program";
    }
    return raw.Content ? "notice" : "unsupported";
  }
  return raw.Content ? "notice" : "unsupported";
}

function messageContentForKind(
  type: MessageKind,
  raw: RawMessage,
  conversationContact: ContactInput,
  parsedContent: ParsedMessageContent,
  isSelf: boolean
): string {
  switch (type) {
    case "text":
      return parsedContent.content || placeholderForMessageKind(type, raw);
    case "notice":
      return formatNoticeMessage(raw, conversationContact, isSelf) || parsedContent.content || placeholderForMessageKind(type, raw);
    case "link":
    case "mini-program":
    case "file":
      return formatAppMessage(type, raw, conversationContact, isSelf) || placeholderForMessageKind(type, raw);
    default:
      return placeholderForMessageKind(type, raw);
  }
}

interface ParsedAppMessage {
  title?: string;
  description?: string;
  url?: string;
  pagePath?: string;
  username?: string;
  appId?: string;
  fileExt?: string;
  totalLength?: string;
}

function formatAppMessage(
  type: MessageKind,
  raw: RawMessage,
  conversationContact: ContactInput,
  isSelf: boolean
): string {
  const app = parseAppMessage(raw, conversationContact, isSelf);
  if (!app) {
    return "";
  }

  switch (type) {
    case "link": {
      const lines = [`[link] ${app.title || app.url || "Untitled"}`];
      if (app.description) {
        lines.push(app.description);
      }
      if (app.url && app.url !== app.title) {
        lines.push(app.url);
      }
      return lines.join("\n");
    }
    case "mini-program": {
      const lines = [`[mini-program] ${app.title || app.description || app.pagePath || "Untitled"}`];
      if (app.description && app.description !== app.title) {
        lines.push(app.description);
      }
      if (app.pagePath) {
        lines.push(app.pagePath);
      }
      return lines.join("\n");
    }
    case "file": {
      const fileName = cleanText(raw.FileName) || cleanText(raw.FileNameTitle) || app.title;
      const suffix = [app.fileExt, formatFileSize(app.totalLength ?? raw.FileSize)].filter(Boolean).join(", ");
      return fileName ? `[file] ${fileName}${suffix ? ` (${suffix})` : ""}` : "";
    }
    default:
      return "";
  }
}

function formatNoticeMessage(raw: RawMessage, conversationContact: ContactInput, isSelf: boolean): string {
  const recall = formatWechatRecallMessage(raw);
  if (recall) {
    return recall;
  }

  const messageType = Number(raw.MsgType);
  if (messageType === 48) {
    return formatLocationMessage(raw, conversationContact, isSelf);
  }
  if (messageType === 42) {
    return formatContactCardMessage(raw);
  }
  if (messageType === 49) {
    const app = parseAppMessage(raw, conversationContact, isSelf);
    if (!app) {
      return "";
    }
    return [`[app] ${app.title || app.description || "Untitled"}`, app.description, app.url].filter(Boolean).join("\n");
  }
  return "";
}

function formatLocationMessage(raw: RawMessage, conversationContact: ContactInput, isSelf: boolean): string {
  const xml = appMessageXml(raw, conversationContact, isSelf);
  const label = cleanXmlValue(attributeValue(xml, "label"));
  const pointName = cleanXmlValue(attributeValue(xml, "poiname"));
  const x = cleanXmlValue(attributeValue(xml, "x"));
  const y = cleanXmlValue(attributeValue(xml, "y"));
  const coords = x && y ? `${x}, ${y}` : undefined;
  return ["[location]", pointName || label || coords].filter(Boolean).join(" ");
}

function formatContactCardMessage(raw: RawMessage): string {
  const info = raw.RecommendInfo;
  const nickname = objectString(info, "NickName") || objectString(info, "DisplayName") || objectString(info, "UserName");
  return nickname ? `[contact-card] ${nickname}` : "[contact-card]";
}

function parseAppMessage(raw: RawMessage, conversationContact: ContactInput, isSelf: boolean): ParsedAppMessage | undefined {
  const xml = appMessageXml(raw, conversationContact, isSelf);
  if (!xml || !xml.includes("<appmsg")) {
    return undefined;
  }

  return {
    title: cleanXmlValue(tagValue(xml, "title")),
    description: cleanXmlValue(tagValue(xml, "des")),
    url: cleanXmlValue(tagValue(xml, "url") || cleanRawString(raw.Url)),
    pagePath: cleanXmlValue(tagValue(xml, "pagepath")),
    username: cleanXmlValue(tagValue(xml, "username")),
    appId: cleanXmlValue(tagValue(xml, "appid")),
    fileExt: cleanXmlValue(tagValue(xml, "fileext")),
    totalLength: cleanXmlValue(tagValue(xml, "totallen"))
  };
}

function appMessageXml(raw: RawMessage, conversationContact: ContactInput, isSelf: boolean): string {
  const content = normalizeRawContent(raw.Content);
  if (conversationContact.kind !== "group" || isSelf) {
    return content;
  }

  const displayPrefixMatch = content.match(/^.+?:\n([\s\S]*)$/);
  if (displayPrefixMatch) {
    return displayPrefixMatch[1]?.trim() ?? "";
  }

  const original = normalizeRawContent(raw.OriginalContent);
  const protocolPrefixMatch = original.match(/^@[^:\n]+:\n?([\s\S]*)$/);
  return protocolPrefixMatch?.[1]?.trim() ?? content;
}

function normalizeRawContent(input: unknown): string {
  if (input === undefined || input === null) {
    return "";
  }
  return decodeHtml(String(input)).replace(/\r\n/g, "\n").trim();
}

function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1];
}

function extractAttachId(content: unknown): string | undefined {
  if (!content || typeof content !== "string") {
    return undefined;
  }
  const match = content.match(/<attachid>([^<]+)<\/attachid>/i);
  return match?.[1]?.trim() || undefined;
}

function attributeValue(xml: string, attribute: string): string | undefined {
  const match = xml.match(new RegExp(`\\b${attribute}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, "i"));
  return match?.[2];
}

function cleanXmlValue(input: unknown): string | undefined {
  const value = cleanText(input);
  return value || undefined;
}

function cleanRawString(input: unknown): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const value = decodeHtml(input).trim();
  return value || undefined;
}

function formatFileSize(value: unknown): string | undefined {
  const size = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(size) || size <= 0) {
    return undefined;
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function objectString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? cleanText(value) : undefined;
}

function placeholderForMessageKind(type: MessageKind, raw: RawMessage): string {
  switch (type) {
    case "notice":
      return "[notice]";
    case "link":
      return "[link]";
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

function contactDisplayName(
  raw: RawContact,
  kind: ContactKind,
  groupMemberCount: number | undefined,
  protocolId: string | undefined
): string {
  if (kind === "group") {
    return firstCleanContactDisplayName(
      raw.RemarkName,
      raw.DisplayName,
      raw.NickName,
      raw.Alias,
      groupMemberListDisplayName(raw.MemberList, groupMemberCount),
      raw.getDisplayName?.(),
      protocolId,
      "Unknown"
    );
  }
  return firstCleanContactDisplayName(
    raw.getDisplayName?.(),
    raw.RemarkName,
    raw.DisplayName,
    raw.NickName,
    raw.Alias,
    protocolId,
    "Unknown"
  );
}

function groupMemberListDisplayName(memberList: RawContact[] | undefined, memberCount: number | undefined): string | undefined {
  if (!Array.isArray(memberList) || memberList.length === 0) {
    return undefined;
  }
  if (memberCount !== undefined && memberList.length < memberCount) {
    return undefined;
  }
  const names = memberList
    .map((member) =>
      firstCleanGroupMemberDisplayName(member.RemarkName, member.DisplayName, member.NickName, member.Alias)
    )
    .filter(Boolean);
  if (names.length === 0) {
    return undefined;
  }
  const total = memberCount ?? names.length;
  if (total > 8) {
    return `${names.slice(0, 4).join("、")} 等${total}人`;
  }
  return names.join("、");
}

function firstCleanGroupMemberDisplayName(...inputs: Array<unknown>): string | undefined {
  for (const input of inputs) {
    const displayName = cleanGroupSenderDisplayName(input);
    if (displayName) {
      return displayName;
    }
  }
  return undefined;
}

function cleanContactDisplayName(input: unknown): string {
  return cleanText(input).replace(/^\[群\]\s*/, "");
}

function cleanContactNamePart(kind: ContactKind, input: unknown, groupMemberCount: number | undefined): string {
  const value = cleanText(input);
  return kind === "group" ? stripGroupMemberCountSuffix(value, groupMemberCount) : value;
}

function cleanGroupSenderDisplayName(input: unknown): string | undefined {
  const value = cleanContactDisplayName(input);
  return value && !looksLikeProtocolUserName(value) ? value : undefined;
}

function groupMessageSenderProtocolId(raw: RawMessage): string | undefined {
  return raw.ActualUserName ?? extractGroupSenderProtocolId(raw.OriginalContent) ?? extractGroupSenderProtocolId(raw.Content);
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
  const memberDisplayName = input.groupMember?.getDisplayName?.();
  const directoryDisplayName = input.directoryContact?.getDisplayName?.();
  const groupDisplayName = firstUsefulGroupSenderName(input.groupMember?.DisplayName);
  const remarkName = firstUsefulGroupSenderName(input.groupMember?.RemarkName, input.directoryContact?.RemarkName);
  const displayName = firstUsefulGroupSenderName(
    groupDisplayName,
    input.groupMember?.RemarkName,
    memberDisplayName,
    input.directoryContact?.RemarkName,
    input.directoryContact?.DisplayName,
    directoryDisplayName,
    input.groupMember?.NickName,
    input.directoryContact?.NickName,
    input.fallbackDisplayName
  );
  const nickName = firstUsefulGroupSenderName(
    input.groupMember?.NickName,
    input.directoryContact?.NickName,
    input.fallbackNickName,
    input.fallbackDisplayName
  );

  const merged: RawContact = {
    UserName: input.senderProtocolId
  };
  merged.RemarkName = remarkName;
  if (groupDisplayName) {
    merged.DisplayName = groupDisplayName;
  }
  merged.NickName = nickName ?? displayName ?? remarkName ?? "Group member";
  merged.Alias = firstCleanValue(input.groupMember?.Alias, input.directoryContact?.Alias);
  merged.getDisplayName = () => displayName ?? remarkName ?? nickName ?? "Group member";

  return merged;
}

function summarizeGroupSenderRawContact(contact: RawContact | undefined): Record<string, unknown> | undefined {
  if (!contact) {
    return undefined;
  }
  return {
    UserName: contact.UserName,
    RemarkName: cleanGroupSenderDisplayName(contact.RemarkName),
    DisplayName: cleanGroupSenderDisplayName(contact.DisplayName),
    NickName: cleanGroupSenderDisplayName(contact.NickName),
    Alias: cleanGroupSenderDisplayName(contact.Alias),
    getDisplayName: cleanGroupSenderDisplayName(contact.getDisplayName?.()),
    hasDisplayName: rawContactHasGroupDisplayName(contact)
  };
}

function summarizeGroupContactRaw(contact: RawContact | undefined): Record<string, unknown> | undefined {
  if (!contact) {
    return undefined;
  }
  return {
    UserName: contact.UserName,
    RemarkName: cleanGroupSenderDisplayName(contact.RemarkName),
    DisplayName: cleanGroupSenderDisplayName(contact.DisplayName),
    NickName: cleanGroupSenderDisplayName(contact.NickName),
    MemberCount: contact.MemberCount,
    MemberListSize: contact.MemberList?.length,
    EncryChatRoomId: cleanRawString(contact.EncryChatRoomId),
    sampleMembers: contact.MemberList?.slice(0, 5).map((member) => summarizeGroupSenderRawContact(member))
  };
}

function firstUsefulGroupSenderName(...inputs: Array<unknown>): string | undefined {
  for (const input of inputs) {
    const value = cleanGroupSenderDisplayName(input);
    if (value) {
      return value;
    }
  }
  return undefined;
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

export function isRecoverableWechat4uError(error: unknown): boolean {
  const code = getStringProperty(error, "code");
  const message = error instanceof Error ? error.message : String(error);
  const tips = getStringProperty(error, "tips");
  const url = getNestedStringProperty(error, ["config", "url"]) ?? getNestedStringProperty(error, ["request", "_currentUrl"]);
  const responseStatus = getNestedNumberProperty(error, ["response", "status"]);

  const isBatchContactFailure =
    tips.includes("批量获取联系人失败") || (url !== undefined && url.includes("/webwxbatchgetcontact"));
  const isSyncFailure =
    tips.includes("同步失败") ||
    tips.includes("获取新信息失败") ||
    (url !== undefined && (url.includes("/synccheck") || url.includes("/webwxsync")));
  const isTransientNetworkFailure =
    ["ETIMEDOUT", "ECONNABORTED", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH"].includes(code) ||
    /timeout|timed out|socket hang up|network/i.test(message) ||
    (responseStatus !== undefined && responseStatus >= 500);

  return (isBatchContactFailure || isSyncFailure) && isTransientNetworkFailure;
}

function summarizeWechat4uError(error: Error): Record<string, unknown> {
  const url = getNestedStringProperty(error, ["config", "url"]) ?? getNestedStringProperty(error, ["request", "_currentUrl"]);
  return {
    name: error.name,
    message: error.message,
    code: getStringProperty(error, "code"),
    type: getStringProperty(error, "type"),
    tips: getStringProperty(error, "tips"),
    status: getNestedNumberProperty(error, ["response", "status"]),
    url: stripQuery(url),
    stack: preview(error.stack, 2_000)
  };
}

function toProtocolError(error: Error): Error {
  const tips = getStringProperty(error, "tips");
  const code = getStringProperty(error, "code");
  const message = tips || error.message || code || "WeChat protocol error";
  const protocolError = new Error(message);
  protocolError.name = error.name;
  if (code) {
    Object.defineProperty(protocolError, "code", {
      value: code,
      enumerable: true,
      configurable: true
    });
  }
  return protocolError;
}

function getStringProperty(value: unknown, key: string): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

function getNestedStringProperty(value: unknown, path: string[]): string | undefined {
  const property = getNestedProperty(value, path);
  return typeof property === "string" ? property : undefined;
}

function getNestedNumberProperty(value: unknown, path: string[]): number | undefined {
  const property = getNestedProperty(value, path);
  return typeof property === "number" ? property : undefined;
}

function getNestedProperty(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stripQuery(url: string | undefined): string | undefined {
  return url?.replace(/[?#].*$/, "");
}

function isLoggedIn(bot: RawWechatBot): boolean {
  const state = bot.CONF && typeof bot.CONF === "object" ? (bot.CONF as { STATE?: { login?: unknown } }).STATE : undefined;
  return state?.login !== undefined && bot.state === state.login;
}
