import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "pino";
import sqlite3 from "sqlite3";
import { open, type Database, type ISqlite } from "sqlite";
import type {
  ContactInput,
  ContactKind,
  ContactRecord,
  ConversationInput,
  ConversationRecord,
  GroupMemberInput,
  GroupMemberRecord,
  MessageInput,
  MessageKind,
  MessageRecord,
  MessageSenderKind,
  MessageStore,
  SearchResult,
  UserProfile
} from "../types.js";
import {
  summarizeContacts,
  summarizeConversationInput,
  summarizeMessageInput,
  summarizeSearchResults,
  summarizeStoredMessage
} from "../logging.js";
import {
  groupMemberCountFromRaw,
  groupMemberCountSuffix,
  normalizeComparableGroupName,
  normalizeComparableText
} from "../util/group-name.js";
import { conversationIdFromContact, groupMemberId } from "../util/ids.js";
import { cleanText } from "../util/text.js";

interface ContactRow {
  account_id: string | null;
  id: string;
  protocol_id: string | null;
  kind: ContactKind;
  display_name: string;
  remark_name: string | null;
  nick_name: string | null;
  alias: string | null;
  is_self: number;
  raw_json: string | null;
  updated_at: number;
}

interface ConversationRow {
  account_id: string | null;
  id: string;
  protocol_id: string | null;
  kind: ContactKind;
  title: string;
  unread_count: number;
  last_message_preview: string | null;
  last_message_sender_name: string | null;
  last_message_is_self: number | null;
  last_message_at: number | null;
  updated_at: number;
}

interface GroupMemberRow {
  account_id: string | null;
  id: string;
  group_id: string;
  group_protocol_id: string | null;
  member_protocol_id: string;
  display_name: string;
  remark_name: string | null;
  nick_name: string | null;
  alias: string | null;
  raw_json: string | null;
  updated_at: number;
}

interface MessageRow {
  account_id: string | null;
  id: string;
  conversation_id: string;
  protocol_message_id: string | null;
  sender_id: string | null;
  sender_kind: MessageSenderKind | null;
  sender_protocol_id: string | null;
  sender_name: string;
  is_self: number;
  content: string;
  type: MessageKind;
  timestamp: number;
  raw_json: string | null;
  created_at: number;
}

interface ContactNameRow {
  display_name: string;
  remark_name: string | null;
  nick_name: string | null;
  alias: string | null;
}

interface UsefulContactName {
  displayName: string;
  remarkName?: string;
  nickName?: string;
  alias?: string;
}

interface LegacyGroupMessageSenderRow {
  account_id: string | null;
  group_id: string;
  group_protocol_id: string | null;
  member_protocol_id: string;
  sender_name: string;
}

function jsonString(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function parseJson(value: string | null): unknown | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asContact(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    protocolId: row.protocol_id ?? undefined,
    kind: row.kind,
    displayName: row.display_name,
    remarkName: row.remark_name ?? undefined,
    nickName: row.nick_name ?? undefined,
    alias: row.alias ?? undefined,
    isSelf: row.is_self === 1,
    raw: parseJson(row.raw_json),
    updatedAt: row.updated_at
  };
}

function asConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    protocolId: row.protocol_id ?? undefined,
    kind: row.kind,
    title: row.title,
    unreadCount: row.unread_count,
    lastMessagePreview: row.last_message_preview ?? undefined,
    lastMessageSenderName: row.last_message_sender_name ?? undefined,
    lastMessageIsSelf: row.last_message_is_self === null ? undefined : row.last_message_is_self === 1,
    lastMessageAt: row.last_message_at ?? undefined,
    updatedAt: row.updated_at
  };
}

function asGroupMember(row: GroupMemberRow): GroupMemberRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    groupProtocolId: row.group_protocol_id ?? undefined,
    memberProtocolId: row.member_protocol_id,
    displayName: row.display_name,
    remarkName: row.remark_name ?? undefined,
    nickName: row.nick_name ?? undefined,
    alias: row.alias ?? undefined,
    raw: parseJson(row.raw_json),
    updatedAt: row.updated_at
  };
}

function asMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    protocolMessageId: row.protocol_message_id ?? undefined,
    senderId: row.sender_id ?? undefined,
    senderKind: row.sender_kind ?? undefined,
    senderProtocolId: row.sender_protocol_id ?? undefined,
    senderName: row.sender_name,
    isSelf: row.is_self === 1,
    content: row.content,
    type: row.type,
    timestamp: row.timestamp,
    raw: parseJson(row.raw_json),
    createdAt: row.created_at
  };
}

class AsyncSqliteDatabase {
  constructor(private readonly db: Database) {}

  prepare(sql: string): AsyncSqliteStatement {
    return new AsyncSqliteStatement(this.db, sql);
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

class AsyncSqliteStatement {
  constructor(
    private readonly db: Database,
    private readonly sql: string
  ) {}

  async run(...params: unknown[]): Promise<ISqlite.RunResult> {
    return this.db.run(this.sql, ...params);
  }

  async get<T = unknown>(...params: unknown[]): Promise<T | undefined> {
    return this.db.get<T>(this.sql, ...params);
  }

  async all<T = unknown>(...params: unknown[]): Promise<T[]> {
    return this.db.all<T[]>(this.sql, ...params);
  }
}

export class SqliteStore implements MessageStore {
  private readonly db: AsyncSqliteDatabase;
  private readonly writeContext = new AsyncLocalStorage<boolean>();
  private writeQueue: Promise<void> = Promise.resolve();
  private activeAccountId?: string;

  private constructor(
    private readonly dbPath: string,
    private readonly options: { logger?: Logger },
    db: Database
  ) {
    this.db = new AsyncSqliteDatabase(db);
  }

  static async open(dbPath: string, options: { logger?: Logger } = {}): Promise<SqliteStore> {
    options.logger?.debug({ dbPath }, "opening sqlite store");
    await mkdir(dirname(dbPath), { recursive: true });
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
    const store = new SqliteStore(dbPath, options, db);
    await store.migrate();
    options.logger?.debug({ dbPath }, "sqlite store ready");
    return store;
  }

  async close(): Promise<void> {
    this.options.logger?.debug({ dbPath: this.dbPath }, "closing sqlite store");
    await this.writeQueue;
    await this.db.close();
  }

  async setActiveAccount(account: UserProfile): Promise<void> {
    await this.enqueueWrite(async () => {
      this.activeAccountId = account.id;
      await this.db
        .prepare(
          "INSERT INTO accounts (id, protocol_id, display_name, raw_json, updated_at) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET protocol_id = excluded.protocol_id, display_name = excluded.display_name, " +
            "raw_json = excluded.raw_json, updated_at = excluded.updated_at"
        )
        .run(account.id, account.protocolId ?? null, account.displayName, jsonString(account.raw), Date.now());
      this.options.logger?.debug(
        { accountId: account.id, protocolId: account.protocolId, displayName: account.displayName },
        "active store account set"
      );
    });
  }

  clearActiveAccount(): void {
    this.options.logger?.debug({ accountId: this.activeAccountId }, "active store account cleared");
    this.activeAccountId = undefined;
  }

  async getSessionData(): Promise<unknown | undefined> {
    const row = await this.db.prepare("SELECT value FROM kv WHERE key = ?").get("wechat.session") as
      | { value: string }
      | undefined;
    this.options.logger?.debug({ hasSessionData: !!row }, "loaded session data marker");
    return row ? parseJson(row.value) : undefined;
  }

  async setSessionData(data: unknown): Promise<void> {
    return this.enqueueWrite(async () => {
      if (data === undefined) {
        await this.clearSessionData();
        return;
      }
      this.options.logger?.debug("saving session data marker");
      await this.db
        .prepare(
          "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        )
        .run("wechat.session", JSON.stringify(data), Date.now());
    });
  }

  async clearSessionData(): Promise<void> {
    return this.enqueueWrite(async () => {
      this.options.logger?.debug("clearing session data");
      await this.db.prepare("DELETE FROM kv WHERE key = ?").run("wechat.session");
    });
  }

  async clearData(): Promise<void> {
    return this.enqueueWrite(async () => {
      this.options.logger?.debug("clearing all data except session");
      await this.db.prepare("DELETE FROM messages").run();
      await this.db.prepare("DELETE FROM attachments").run();
      await this.db.prepare("DELETE FROM group_members").run();
      await this.db.prepare("DELETE FROM conversations").run();
      await this.db.prepare("DELETE FROM contacts").run();
      await this.db.prepare("DELETE FROM accounts").run();
      await this.db.prepare("DELETE FROM kv WHERE key != ?").run("wechat.session");
    });
  }

  async upsertContact(contact: ContactInput): Promise<ContactRecord> {
    return this.enqueueWrite(async () => {
      const accountId = this.requireActiveAccountId("upsert contact");
      const now = Date.now();
      const existing = await this.findContactById(contact.id);
      const contactForStorage = stabilizeContactForUpsert(contact, existing);
      await this.db
        .prepare(
          "INSERT INTO contacts " +
            "(account_id, id, protocol_id, kind, display_name, remark_name, nick_name, alias, is_self, is_stale, raw_json, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET " +
            "account_id = excluded.account_id, protocol_id = excluded.protocol_id, kind = excluded.kind, display_name = excluded.display_name, " +
            "remark_name = excluded.remark_name, nick_name = excluded.nick_name, alias = excluded.alias, " +
            "is_self = excluded.is_self, is_stale = 0, raw_json = excluded.raw_json, updated_at = excluded.updated_at"
        )
        .run(
          accountId,
          contactForStorage.id,
          contactForStorage.protocolId ?? null,
          contactForStorage.kind,
          contactForStorage.displayName,
          contactForStorage.remarkName ?? null,
          contactForStorage.nickName ?? null,
          contactForStorage.alias ?? null,
          contactForStorage.isSelf ? 1 : 0,
          jsonString(contactForStorage.raw),
          now
        );

      const saved = await this.findContactById(contactForStorage.id);
      if (!saved) {
        throw new Error(`Failed to save contact ${contact.id}`);
      }
      await this.backfillConversationTitlesFromContact(saved);
      await this.backfillSenderNameFromContact(saved);
      await this.backfillGroupMemberSenderNamesFromContact(saved);
      this.options.logger?.trace(
        {
          id: saved.id,
          protocolId: saved.protocolId,
          kind: saved.kind,
          displayName: saved.displayName,
          isSelf: saved.isSelf
        },
        "contact upserted"
      );
      return saved;
    });
  }

  async upsertContacts(contacts: ContactInput[]): Promise<ContactRecord[]> {
    return this.enqueueWrite(async () => {
      this.options.logger?.debug(summarizeContacts(contacts), "upserting contacts");
      await this.db.exec("BEGIN");
      try {
        const saved: ContactRecord[] = [];
        for (const contact of contacts) {
          saved.push(await this.upsertContact(contact));
        }
        await this.db.exec("COMMIT");
        this.options.logger?.debug({ count: saved.length }, "contacts upserted");
        return saved;
      } catch (error) {
        await this.db.exec("ROLLBACK");
        this.options.logger?.error({ err: error, count: contacts.length }, "failed to upsert contacts");
        throw error;
      }
    });
  }

  async upsertGroupMember(member: GroupMemberInput): Promise<GroupMemberRecord> {
    return this.enqueueWrite(async () => {
      const accountId = this.requireActiveAccountId("upsert group member");
      const now = Date.now();
      const existing = await this.findGroupMemberById(member.id);
      const memberForStorage = await this.enrichGroupMemberFromContact(
        stabilizeGroupMemberForUpsert(member, existing),
        accountId
      );
      await this.db
        .prepare(
          "INSERT INTO group_members " +
            "(account_id, id, group_id, group_protocol_id, member_protocol_id, display_name, remark_name, nick_name, alias, raw_json, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET " +
            "account_id = excluded.account_id, group_id = excluded.group_id, group_protocol_id = excluded.group_protocol_id, " +
            "member_protocol_id = excluded.member_protocol_id, display_name = excluded.display_name, " +
            "remark_name = excluded.remark_name, nick_name = excluded.nick_name, alias = excluded.alias, " +
            "raw_json = excluded.raw_json, updated_at = excluded.updated_at"
        )
        .run(
          accountId,
          memberForStorage.id,
          memberForStorage.groupId,
          memberForStorage.groupProtocolId ?? null,
          memberForStorage.memberProtocolId,
          memberForStorage.displayName,
          memberForStorage.remarkName ?? null,
          memberForStorage.nickName ?? null,
          memberForStorage.alias ?? null,
          jsonString(memberForStorage.raw),
          now
        );

      const saved = await this.findGroupMemberById(memberForStorage.id);
      if (!saved) {
        throw new Error(`Failed to save group member ${member.id}`);
      }
      await this.backfillSenderNameFromGroupMember(saved, existing?.displayName);
      this.options.logger?.trace(
        {
          id: saved.id,
          groupId: saved.groupId,
          groupProtocolId: saved.groupProtocolId,
          memberProtocolId: saved.memberProtocolId,
          displayName: saved.displayName
        },
        "group member upserted"
      );
      return saved;
    });
  }

  private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (this.writeContext.getStore()) {
      return operation();
    }
    const run = () => this.writeContext.run(true, operation);
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async enrichGroupMemberFromContact(member: GroupMemberInput, accountId: string | null): Promise<GroupMemberInput> {
    if (isUsefulSenderName(member.displayName)) {
      return member;
    }
    const contactName = await this.usefulContactNameForProtocol(accountId, member.memberProtocolId);
    if (!contactName) {
      return member;
    }
    return {
      ...member,
      displayName: contactName.displayName,
      remarkName: member.remarkName ?? contactName.remarkName,
      nickName: member.nickName ?? contactName.nickName,
      alias: member.alias ?? contactName.alias
    };
  }

  private async usefulContactNameForProtocol(accountId: string | null, protocolId: string): Promise<UsefulContactName | undefined> {
    const row = await this.db
      .prepare(
        "SELECT display_name, remark_name, nick_name, alias FROM contacts " +
          "WHERE account_id IS ? AND is_self = 0 AND kind = 'private' AND protocol_id = ? " +
          `AND NOT ${unhelpfulNameSql("display_name")} ` +
          "ORDER BY is_stale ASC, updated_at DESC LIMIT 1"
      )
      .get(accountId, protocolId) as ContactNameRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      displayName: row.display_name,
      remarkName: optionalUsefulName(row.remark_name),
      nickName: optionalUsefulName(row.nick_name),
      alias: optionalUsefulName(row.alias)
    };
  }

  async markAllContactsStale(): Promise<void> {
    return this.enqueueWrite(async () => {
      const accountId = this.currentAccountId();
      if (!accountId) {
        return;
      }
      await this.db
        .prepare("UPDATE contacts SET is_stale = 1 WHERE account_id = ? AND is_self = 0")
        .run(accountId);
      this.options.logger?.debug({ accountId }, "marked all contacts stale");
    });
  }

  async listContacts(kind?: ContactKind, limit = 50): Promise<ContactRecord[]> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const scanLimit = Math.max(limit * 3, limit);
    const rows = kind
      ? (await this.db
          .prepare(
            "SELECT * FROM contacts WHERE account_id = ? AND kind = ? AND is_self = 0 AND is_stale = 0 ORDER BY display_name COLLATE NOCASE LIMIT ?"
          )
          .all(accountId, kind, scanLimit) as unknown as ContactRow[])
      : (await this.db
          .prepare("SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 ORDER BY display_name COLLATE NOCASE LIMIT ?")
          .all(accountId, scanLimit) as unknown as ContactRow[]);
    const contacts = dedupeContactsByProtocol(rows.map(asContact)).slice(0, limit);
    this.options.logger?.debug({ kind, limit, count: contacts.length }, "listed contacts");
    return contacts;
  }

  async findContactByName(query: string): Promise<ContactRecord | undefined> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    const like = `%${normalized}%`;
    const row = await this.db
      .prepare(
        "SELECT * FROM contacts WHERE is_self = 0 AND is_stale = 0 AND " +
          "account_id = ? AND " +
          "(lower(display_name) = ? OR lower(remark_name) = ? OR lower(nick_name) = ? OR lower(alias) = ? " +
          "OR lower(display_name) LIKE ? OR lower(remark_name) LIKE ? OR lower(nick_name) LIKE ? OR lower(alias) LIKE ?) " +
          "ORDER BY CASE " +
          "WHEN lower(display_name) = ? THEN 0 WHEN lower(remark_name) = ? THEN 1 " +
          "WHEN lower(nick_name) = ? THEN 2 WHEN lower(alias) = ? THEN 3 ELSE 4 END, updated_at DESC LIMIT 1"
      )
      .get(accountId, normalized, normalized, normalized, normalized, like, like, like, like, normalized, normalized, normalized, normalized) as
      | ContactRow
      | undefined;
    let contact = row ? asContact(row) : undefined;
    const normalizedGroupName = normalizeComparableGroupName(query);
    if (!contact && normalizedGroupName) {
      const groupRows = await this.db
        .prepare(
          "SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 AND kind = 'group' ORDER BY updated_at DESC"
        )
        .all(accountId) as unknown as ContactRow[];
      contact = groupRows.map(asContact).find((candidate) => contactMatchesGroupName(candidate, normalizedGroupName));
    }
    this.options.logger?.debug({ query, found: !!contact, contactId: contact?.id }, "contact lookup by name");
    return contact;
  }

  async searchContacts(keyword: string, limit = 20): Promise<ContactRecord[]> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const scanLimit = Math.max(limit * 3, limit);
    const normalized = keyword.trim().toLowerCase();
    const rows = normalized
      ? (await this.db
          .prepare(
            "SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 AND kind IN ('private', 'group') AND " +
              "(lower(display_name) LIKE ? OR lower(remark_name) LIKE ? OR lower(nick_name) LIKE ? OR lower(alias) LIKE ?) " +
              "ORDER BY CASE " +
              "WHEN lower(display_name) = ? THEN 0 WHEN lower(remark_name) = ? THEN 1 " +
              "WHEN lower(nick_name) = ? THEN 2 WHEN lower(alias) = ? THEN 3 ELSE 4 END, " +
              "display_name COLLATE NOCASE LIMIT ?"
          )
          .all(
            accountId,
            `%${normalized}%`,
            `%${normalized}%`,
            `%${normalized}%`,
            `%${normalized}%`,
            normalized,
            normalized,
            normalized,
            normalized,
            scanLimit
          ) as unknown as ContactRow[])
      : (await this.db
          .prepare(
            "SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 AND kind IN ('private', 'group') ORDER BY updated_at DESC, display_name COLLATE NOCASE LIMIT ?"
          )
          .all(accountId, scanLimit) as unknown as ContactRow[]);
    const contacts = dedupeContactsByProtocol(rows.map(asContact)).slice(0, limit);
    this.options.logger?.debug({ keyword, limit, count: contacts.length }, "searched contacts");
    return contacts;
  }

  async upsertConversation(conversation: ConversationInput): Promise<ConversationRecord> {
    return this.enqueueWrite(async () => {
      const accountId = this.requireActiveAccountId("upsert conversation");
      this.options.logger?.trace({ conversation: summarizeConversationInput(conversation) }, "upserting conversation");
      const now = Date.now();
      const existing = await this.findConversationById(conversation.id);
      const conversationForStorage = stabilizeConversationForUpsert(conversation, existing);
      await this.db
        .prepare(
          "INSERT INTO conversations (account_id, id, protocol_id, kind, title, unread_count, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?) " +
            "ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, protocol_id = excluded.protocol_id, kind = excluded.kind, " +
            "title = excluded.title, updated_at = excluded.updated_at"
        )
        .run(
          accountId,
          conversationForStorage.id,
          conversationForStorage.protocolId ?? null,
          conversationForStorage.kind,
          conversationForStorage.title,
          now
        );

      const saved = await this.findConversationById(conversation.id);
      if (!saved) {
        throw new Error(`Failed to save conversation ${conversation.id}`);
      }
      this.options.logger?.trace(
        {
          id: saved.id,
          protocolId: saved.protocolId,
          title: saved.title,
          unreadCount: saved.unreadCount
        },
        "conversation upserted"
      );
      return saved;
    });
  }

  async mergeStaleConversationForContact(contact: ContactRecord, conversation: ConversationRecord): Promise<ConversationRecord> {
    return this.enqueueWrite(async () => {
      const accountId = this.currentAccountId();
      if (!accountId || !isMergeableContactKind(contact.kind) || contact.isSelf) {
        return conversation;
      }

      const activeMatches = await this.findLazyMergeActiveContacts(accountId, contact);
      if (activeMatches.length !== 1 || activeMatches[0]?.id !== contact.id) {
        this.options.logger?.debug(
          { contactId: contact.id, displayName: contact.displayName, activeMatches: activeMatches.length },
          "skipping stale conversation merge because current contact is ambiguous"
        );
        return conversation;
      }

      const staleContacts = await this.findLazyMergeStaleContacts(accountId, contact);
      const mergeableConversationsById = new Map<string, ConversationRecord>();
      for (const staleConversation of await this.findLazyMergeStaleConversations(accountId, contact, conversation, staleContacts)) {
        mergeableConversationsById.set(staleConversation.id, staleConversation);
      }
      for (const orphanConversation of await this.findLazyMergeOrphanConversations(accountId, contact, conversation)) {
        mergeableConversationsById.set(orphanConversation.id, orphanConversation);
      }
      const mergeableConversations = Array.from(mergeableConversationsById.values());
      if (mergeableConversations.length === 0) {
        return conversation;
      }

      await this.applyStaleConversationMerge(accountId, contact, conversation, staleContacts, mergeableConversations);

      const merged = (await this.findConversationById(conversation.id)) ?? conversation;
      this.options.logger?.info(
        {
          contactId: contact.id,
          conversationId: conversation.id,
          staleContactIds: staleContacts.map((staleContact) => staleContact.id),
          staleConversationIds: mergeableConversations.map((staleConversation) => staleConversation.id)
        },
        "merged stale conversations into current contact conversation"
      );
      return merged;
    });
  }

  async findConversationById(id: string): Promise<ConversationRecord | undefined> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const row = await this.db.prepare("SELECT * FROM conversations WHERE account_id = ? AND id = ?").get(accountId, id) as
      | ConversationRow
      | undefined;
    const conversation = row ? asConversation(row) : undefined;
    this.options.logger?.trace({ id, found: !!conversation }, "conversation lookup by id");
    return conversation;
  }

  async hasMessage(messageId: string): Promise<boolean> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return false;
    }
    const row = await this.db.prepare("SELECT 1 FROM messages WHERE account_id = ? AND id = ? LIMIT 1").get(accountId, messageId);
    return !!row;
  }

  async saveMessage(message: MessageInput, conversation: ConversationInput, incrementUnread: boolean): Promise<MessageRecord> {
    return this.enqueueWrite(async () => {
      const unreadIncrement = conversation.kind === "public" ? 0 : incrementUnread ? 1 : 0;
      const accountId = this.requireActiveAccountId("save message");
      this.options.logger?.debug(
        {
          message: summarizeMessageInput(message),
          conversation: summarizeConversationInput(conversation),
          incrementUnread: unreadIncrement > 0
        },
        "saving message"
      );
      let inserted = false;
      await this.db.exec("BEGIN");
      try {
        await this.upsertConversation(conversation);
        const now = Date.now();
        const senderKind = message.senderKind ?? (message.isSelf ? "self" : "contact");
        const insertResult = await this.db
          .prepare(
            "INSERT OR IGNORE INTO messages " +
              "(account_id, id, conversation_id, protocol_message_id, sender_id, sender_kind, sender_protocol_id, " +
              "sender_name, is_self, content, type, timestamp, raw_json, created_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            accountId,
            message.id,
            message.conversationId,
            message.protocolMessageId ?? null,
            message.senderId ?? null,
            senderKind,
            message.senderProtocolId ?? null,
            message.senderName,
            message.isSelf ? 1 : 0,
            message.content,
            message.type,
            message.timestamp,
            jsonString(message.raw),
            now
          );

        if (Number(insertResult.changes) > 0) {
          inserted = true;
          await this.db
            .prepare(
              "UPDATE conversations SET last_message_preview = ?, last_message_at = ?, " +
                "last_message_sender_name = ?, last_message_is_self = ?, " +
                "unread_count = unread_count + ?, updated_at = ? WHERE account_id = ? AND id = ?"
            )
            .run(
              message.content,
              message.timestamp,
              message.senderName,
              message.isSelf ? 1 : 0,
              unreadIncrement,
              now,
              accountId,
              conversation.id
            );
        }

        await this.db.exec("COMMIT");
      } catch (error) {
        await this.db.exec("ROLLBACK");
        this.options.logger?.error(
          {
            err: error,
            message: summarizeMessageInput(message),
            conversation: summarizeConversationInput(conversation)
          },
          "failed to save message"
        );
        throw error;
      }

      const saved = await this.findMessageById(message.id);
      if (!saved) {
        throw new Error(`Failed to save message ${message.id}`);
      }
      this.options.logger?.debug(
        {
          inserted,
          incrementUnread: unreadIncrement > 0,
          message: summarizeStoredMessage(saved)
        },
        inserted ? "message saved" : "duplicate message ignored"
      );
      return saved;
    });
  }

  async listRecentConversations(limit = 20): Promise<ConversationRecord[]> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const scanLimit = Math.max(limit * 3, limit);
    const rows = await this.db
      .prepare(
        "SELECT * FROM conversations WHERE account_id = ? ORDER BY last_message_at IS NULL ASC, last_message_at DESC, updated_at DESC LIMIT ?"
      )
      .all(accountId, scanLimit) as unknown as ConversationRow[];
    const conversations = (await this.foldMergeableConversationsByActiveContacts(
      accountId,
      dedupeConversationsByProtocol(rows.map(asConversation))
    )).slice(0, limit);
    this.options.logger?.debug({ limit, count: conversations.length }, "listed recent conversations");
    return conversations;
  }

  async listUnreadConversations(limit = 20): Promise<ConversationRecord[]> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const scanLimit = Math.max(limit * 3, limit);
    const rows = await this.db
      .prepare(
        "SELECT * FROM conversations WHERE account_id = ? AND kind <> 'public' AND unread_count > 0 " +
          "ORDER BY last_message_at DESC, updated_at DESC LIMIT ?"
      )
      .all(accountId, scanLimit) as unknown as ConversationRow[];
    const conversations = (await this.foldMergeableConversationsByActiveContacts(
      accountId,
      dedupeConversationsByProtocol(rows.map(asConversation))
    )).slice(0, limit);
    this.options.logger?.debug({ limit, count: conversations.length }, "listed unread conversations");
    return conversations;
  }

  async listMessages(conversationId: string, limit = 30): Promise<MessageRecord[]> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const rows = await this.db
      .prepare(
        "SELECT * FROM messages WHERE account_id = ? AND conversation_id = ? ORDER BY timestamp DESC, created_at DESC LIMIT ?"
      )
      .all(accountId, conversationId, limit) as unknown as MessageRow[];
    const messages = rows.reverse().map(asMessage);
    this.options.logger?.debug({ conversationId, limit, count: messages.length }, "listed messages");
    return messages;
  }

  async updateMessageRaw(messageId: string, raw: unknown): Promise<void> {
    return this.enqueueWrite(async () => {
      const accountId = this.currentAccountId();
      if (!accountId) {
        return;
      }
      await this.db
        .prepare("UPDATE messages SET raw_json = ? WHERE account_id = ? AND id = ?")
        .run(jsonString(raw), accountId, messageId);
    });
  }

  async searchMessages(keyword: string, limit = 50, conversationId?: string): Promise<SearchResult[]> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const normalized = keyword.trim();
    if (!normalized) {
      return [];
    }
    const like = `%${normalized}%`;
    const rows = conversationId
      ? (await this.db
          .prepare(
            "SELECT * FROM messages WHERE account_id = ? AND conversation_id = ? AND content LIKE ? " +
              "ORDER BY timestamp DESC, created_at DESC LIMIT ?"
          )
          .all(accountId, conversationId, like, limit) as unknown as MessageRow[])
      : (await this.db
          .prepare("SELECT * FROM messages WHERE account_id = ? AND content LIKE ? ORDER BY timestamp DESC, created_at DESC LIMIT ?")
          .all(accountId, like, limit) as unknown as MessageRow[]);

    const results: SearchResult[] = [];
    for (const row of rows) {
      const conversation = await this.findConversationById(row.conversation_id);
      if (conversation) {
        results.push({ conversation, message: asMessage(row) });
      }
    }
    this.options.logger?.debug(
      {
        keyword,
        limit,
        conversationId,
        results: summarizeSearchResults(results)
      },
      "searched messages"
    );
    return results;
  }

  async markRead(conversationId: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const accountId = this.currentAccountId();
      if (!accountId) {
        return;
      }
      const conversation = await this.findConversationById(conversationId);
      const conversationIds = conversation ? await this.findFoldedConversationIds(accountId, conversation) : [conversationId];
      const now = Date.now();
      const statement = await this.db.prepare(
        "UPDATE conversations SET unread_count = 0, updated_at = ? WHERE account_id = ? AND id = ?"
      );
      for (const id of conversationIds) {
        await statement.run(now, accountId, id);
      }
      this.options.logger?.debug({ conversationId, conversationIds }, "marked conversation read");
    });
  }

  async totalUnreadCount(): Promise<number> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return 0;
    }
    const row = await this.db
      .prepare("SELECT COALESCE(SUM(unread_count), 0) AS total FROM conversations WHERE account_id = ? AND kind <> 'public'")
      .get(accountId) as { total: number } | undefined;
    const total = Number(row?.total ?? 0);
    this.options.logger?.trace({ total }, "computed total unread count");
    return total;
  }

  private async findContactById(id: string): Promise<ContactRecord | undefined> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const row = await this.db.prepare("SELECT * FROM contacts WHERE account_id = ? AND id = ?").get(accountId, id) as
      | ContactRow
      | undefined;
    return row ? asContact(row) : undefined;
  }

  private async findGroupMemberById(id: string): Promise<GroupMemberRecord | undefined> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const row = await this.db.prepare("SELECT * FROM group_members WHERE account_id = ? AND id = ?").get(accountId, id) as
      | GroupMemberRow
      | undefined;
    return row ? asGroupMember(row) : undefined;
  }

  private async findMessageById(id: string): Promise<MessageRecord | undefined> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const row = await this.db.prepare("SELECT * FROM messages WHERE account_id = ? AND id = ?").get(accountId, id) as
      | MessageRow
      | undefined;
    return row ? asMessage(row) : undefined;
  }

  private async backfillConversationTitlesFromContact(contact: ContactRecord): Promise<void> {
    const accountId = this.currentAccountId();
    if (!accountId || !contact.protocolId) {
      return;
    }
    const now = Date.now();

    // Update the conversation's protocol_id to the latest UserName (by stable conversation ID)
    const conversationId = `conversation:${contact.id}`;
    await this.db
      .prepare(
        "UPDATE conversations SET protocol_id = ?, updated_at = ? WHERE account_id = ? AND id = ?"
      )
      .run(contact.protocolId, now, accountId, conversationId);

    // Update titles for conversations matching this protocol_id with unhelpful names
    if (isUsefulSenderName(contact.displayName)) {
      await this.db
        .prepare(
          "UPDATE conversations SET title = ?, updated_at = ? " +
            `WHERE account_id = ? AND protocol_id = ? AND ${unhelpfulNameSql("title")}`
        )
        .run(contact.displayName, now, accountId, contact.protocolId);
    }
  }

  private async backfillSenderNameFromContact(contact: ContactRecord): Promise<void> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return;
    }
    if (contact.isSelf || !isUsefulSenderName(contact.displayName)) {
      return;
    }

    const senderIdsSql = senderIdsForContactSql();
    const result = await this.db
      .prepare(
        `UPDATE messages SET sender_name = ? WHERE account_id = ? AND sender_id IN (${senderIdsSql}) ` +
          `AND ${unhelpfulNameSql("sender_name")}`
      )
      .run(contact.displayName, accountId, contact.id, accountId, contact.protocolId ?? null);

    await this.db
      .prepare(
        "UPDATE conversations SET last_message_sender_name = ? WHERE account_id = ? " +
          `AND ${unhelpfulNameSql("last_message_sender_name")} ` +
          "AND (" +
          "SELECT sender_id FROM messages WHERE account_id = conversations.account_id AND conversation_id = conversations.id " +
          "ORDER BY timestamp DESC, created_at DESC LIMIT 1" +
          `) IN (${senderIdsSql})`
      )
      .run(contact.displayName, accountId, contact.id, accountId, contact.protocolId ?? null);

    const changes = Number(result.changes);
    if (changes > 0) {
      this.options.logger?.debug(
        {
          protocolId: contact.protocolId,
          displayName: contact.displayName,
          changedMessages: changes
        },
        "backfilled message sender names from contact"
      );
    }
  }

  private async backfillSenderNameFromGroupMember(member: GroupMemberRecord, previousDisplayName?: string): Promise<void> {
    const accountId = this.currentAccountId();
    if (!accountId || !isUsefulSenderName(member.displayName)) {
      return;
    }

    const groupConversationSql = groupConversationIdsForMemberSql();
    const senderSql = groupMemberSenderSql();
    const previousName = previousDisplayName && previousDisplayName !== member.displayName ? previousDisplayName : undefined;
    const messageNameSql = nameBackfillSql("sender_name", previousName);
    const previewNameSql = nameBackfillSql("last_message_sender_name", previousName);
    const previousNameParams = previousName ? [previousName] : [];
    const result = await this.db
      .prepare(
        "UPDATE messages SET sender_name = ? WHERE account_id = ? " +
          `AND ${messageNameSql} ` +
          `AND conversation_id IN (${groupConversationSql}) ` +
          `AND (${senderSql})`
      )
      .run(
        member.displayName,
        accountId,
        ...previousNameParams,
        accountId,
        member.groupId,
        member.groupProtocolId ?? null,
        member.memberProtocolId,
        member.id,
        accountId,
        member.memberProtocolId
      );

    await this.db
      .prepare(
        "UPDATE conversations SET last_message_sender_name = ? WHERE account_id = ? " +
          `AND ${previewNameSql} ` +
          `AND id IN (${groupConversationSql}) ` +
          "AND (" +
          "SELECT " +
          `CASE WHEN ${senderSql} THEN 1 ELSE 0 END ` +
          "FROM messages WHERE account_id = conversations.account_id AND conversation_id = conversations.id " +
          "ORDER BY timestamp DESC, created_at DESC LIMIT 1" +
          ") = 1"
      )
      .run(
        member.displayName,
        accountId,
        ...previousNameParams,
        accountId,
        member.groupId,
        member.groupProtocolId ?? null,
        member.memberProtocolId,
        member.id,
        accountId,
        member.memberProtocolId
      );

    const changes = Number(result.changes);
    if (changes > 0) {
      this.options.logger?.debug(
        {
          groupId: member.groupId,
          groupProtocolId: member.groupProtocolId,
          memberProtocolId: member.memberProtocolId,
          displayName: member.displayName,
          changedMessages: changes
        },
        "backfilled message sender names from group member"
      );
    }
  }

  private async backfillMissingGroupMemberSenderProtocol(member: GroupMemberRecord): Promise<number> {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return 0;
    }
    const result = await this.db
      .prepare(
        "UPDATE messages SET sender_kind = 'group-member', sender_protocol_id = ?, sender_id = ? " +
          "WHERE account_id = ? " +
          `AND conversation_id IN (${groupConversationIdsForMemberSql()}) ` +
          "AND sender_id IN (SELECT id FROM contacts WHERE account_id = ? AND protocol_id = ?)"
      )
      .run(
        member.memberProtocolId,
        member.id,
        accountId,
        accountId,
        member.groupId,
        member.groupProtocolId ?? null,
        accountId,
        member.memberProtocolId
      );
    return Number(result.changes);
  }

  private async backfillGroupMemberSenderNamesFromContact(contact: ContactRecord): Promise<void> {
    const accountId = this.currentAccountId();
    if (!accountId || contact.kind !== "group" || !contact.protocolId) {
      return;
    }

    const members = groupMemberInputsFromContact(contact, accountId);
    if (members.length === 0) {
      return;
    }

    let changedMessages = 0;
    for (const member of members) {
      const saved = await this.upsertGroupMember(member);
      changedMessages += await this.backfillMissingGroupMemberSenderProtocol(saved);
    }

    if (changedMessages > 0) {
      this.options.logger?.debug(
        {
          groupProtocolId: contact.protocolId,
          changedMessages,
          memberCount: members.length
        },
        "backfilled group message sender names from member list"
      );
    }
  }

  private async foldMergeableConversationsByActiveContacts(
    accountId: string,
    conversations: ConversationRecord[]
  ): Promise<ConversationRecord[]> {
    const activeContacts = await this.listActiveMergeableContacts(accountId);
    if (activeContacts.length === 0) {
      return conversations;
    }

    const buckets = new Map<string, { contact?: ContactRecord; conversations: ConversationRecord[] }>();
    for (const conversation of conversations) {
      const contact = await this.uniqueActiveContactForConversation(accountId, activeContacts, conversation);
      const key = contact ? `contact:${contact.id}` : conversation.protocolId ? `${conversation.kind}:${conversation.protocolId}` : conversation.id;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.conversations.push(conversation);
      } else {
        buckets.set(key, { contact, conversations: [conversation] });
      }
    }

    return Array.from(buckets.values())
      .map(({ contact, conversations: bucketConversations }) => foldConversationBucket(contact, bucketConversations))
      .sort(compareRecentConversations);
  }

  private async findFoldedConversationIds(accountId: string, conversation: ConversationRecord): Promise<string[]> {
    const activeContacts = await this.listActiveMergeableContacts(accountId);
    const contact = await this.uniqueActiveContactForConversation(accountId, activeContacts, conversation);
    if (!contact) {
      return [conversation.id];
    }

    const rows = await this.db
      .prepare("SELECT * FROM conversations WHERE account_id = ? AND kind = ?")
      .all(accountId, conversation.kind) as unknown as ConversationRow[];
    const ids: string[] = [];
    for (const candidate of rows.map(asConversation)) {
      const candidateContact = candidate.id === conversation.id
        ? contact
        : await this.uniqueActiveContactForConversation(accountId, activeContacts, candidate);
      if (candidateContact?.id === contact.id) {
        ids.push(candidate.id);
      }
    }
    return ids.length > 0 ? ids : [conversation.id];
  }

  private async listActiveMergeableContacts(accountId: string): Promise<ContactRecord[]> {
    const rows = await this.db
      .prepare(
        "SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 AND kind IN ('private', 'group')"
      )
      .all(accountId) as unknown as ContactRow[];
    return rows.map(asContact);
  }

  private async uniqueActiveContactForConversation(
    accountId: string,
    activeContacts: ContactRecord[],
    conversation: ConversationRecord
  ): Promise<ContactRecord | undefined> {
    if (!isMergeableContactKind(conversation.kind)) {
      return undefined;
    }
    const matches: ContactRecord[] = [];
    for (const contact of activeContacts) {
      if (await this.contactCanFoldConversation(accountId, contact, conversation)) {
        matches.push(contact);
      }
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  private async contactCanFoldConversation(
    accountId: string,
    contact: ContactRecord,
    conversation: ConversationRecord
  ): Promise<boolean> {
    if (!contactMatchesConversation(contact, conversation)) {
      return false;
    }
    if (conversation.protocolId && conversation.protocolId === contact.protocolId) {
      return true;
    }
    if (!conversation.protocolId) {
      return true;
    }
    const staleContact = await this.findStaleContactByProtocolId(accountId, conversation.kind, conversation.protocolId);
    return !!staleContact && sameLazyMergeContact(contact, staleContact);
  }

  private async findStaleContactByProtocolId(
    accountId: string,
    kind: ContactKind,
    protocolId: string
  ): Promise<ContactRecord | undefined> {
    const row = await this.db
      .prepare("SELECT * FROM contacts WHERE account_id = ? AND is_stale = 1 AND kind = ? AND protocol_id = ? LIMIT 1")
      .get(accountId, kind, protocolId) as ContactRow | undefined;
    return row ? asContact(row) : undefined;
  }

  private async findLazyMergeActiveContacts(accountId: string, contact: ContactRecord): Promise<ContactRecord[]> {
    const candidates = await this.findLazyMergeCandidateContacts(accountId, contact, false);
    return candidates.filter((candidate) => sameLazyMergeContact(candidate, contact));
  }

  private async findLazyMergeStaleContacts(accountId: string, contact: ContactRecord): Promise<ContactRecord[]> {
    const candidates = await this.findLazyMergeCandidateContacts(accountId, contact, true);
    return candidates.filter(
      (candidate) =>
        candidate.id !== contact.id &&
        !!candidate.protocolId &&
        candidate.protocolId !== contact.protocolId &&
        sameLazyMergeContact(candidate, contact)
    );
  }

  private async findLazyMergeCandidateContacts(accountId: string, contact: ContactRecord, stale: boolean): Promise<ContactRecord[]> {
    const staleValue = stale ? 1 : 0;
    const rows =
      contact.kind === "group"
        ? (await this.db
            .prepare("SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = ? AND kind = ?")
            .all(accountId, staleValue, contact.kind) as unknown as ContactRow[])
        : (await this.db
            .prepare(
              "SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = ? AND kind = ? AND display_name = ?"
            )
            .all(accountId, staleValue, contact.kind, contact.displayName) as unknown as ContactRow[]);
    return rows.map(asContact);
  }

  private async findLazyMergeStaleConversations(
    accountId: string,
    contact: ContactRecord,
    conversation: ConversationRecord,
    staleContacts: ContactRecord[]
  ): Promise<ConversationRecord[]> {
    const staleConversationById = new Map<string, ConversationRecord>();
    const statement = await this.db.prepare(
      "SELECT * FROM conversations WHERE account_id = ? AND kind = ? AND protocol_id = ? AND id != ?"
    );

    for (const staleContact of staleContacts) {
      if (!staleContact.protocolId) {
        continue;
      }
      const rows = await statement.all(
        accountId,
        staleContact.kind,
        staleContact.protocolId,
        conversation.id
      ) as unknown as ConversationRow[];
      for (const row of rows) {
        const staleConversation = asConversation(row);
        if (contactMatchesConversation(contact, staleConversation)) {
          staleConversationById.set(row.id, staleConversation);
        }
      }
    }

    return Array.from(staleConversationById.values());
  }

  private async findLazyMergeOrphanConversations(
    accountId: string,
    contact: ContactRecord,
    conversation: ConversationRecord
  ): Promise<ConversationRecord[]> {
    const rows = await this.db
      .prepare("SELECT * FROM conversations WHERE account_id = ? AND kind = ? AND protocol_id IS NULL AND id != ?")
      .all(accountId, contact.kind, conversation.id) as unknown as ConversationRow[];
    const activeContacts = await this.listActiveMergeableContacts(accountId);
    const conversations: ConversationRecord[] = [];
    for (const candidate of rows.map(asConversation)) {
      if (!contactMatchesConversation(contact, candidate)) {
        continue;
      }
      const candidateContact = await this.uniqueActiveContactForConversation(accountId, activeContacts, candidate);
      if (candidateContact?.id === contact.id) {
        conversations.push(candidate);
      }
    }
    return conversations;
  }

  private async applyStaleConversationMerge(
    accountId: string,
    contact: ContactRecord,
    conversation: ConversationRecord,
    staleContacts: ContactRecord[],
    staleConversations: ConversationRecord[]
  ): Promise<void> {
    const staleUnreadCount = staleConversations.reduce((total, staleConversation) => total + staleConversation.unreadCount, 0);
    const now = Date.now();
    await this.db.exec("BEGIN");
    try {
      for (const staleConversation of staleConversations) {
        await this.db
          .prepare("UPDATE messages SET conversation_id = ? WHERE account_id = ? AND conversation_id = ?")
          .run(conversation.id, accountId, staleConversation.id);
      }
      for (const staleContact of staleContacts) {
        await this.db
          .prepare("UPDATE messages SET sender_id = ? WHERE account_id = ? AND conversation_id = ? AND sender_id = ?")
          .run(contact.id, accountId, conversation.id, staleContact.id);
      }
      for (const staleConversation of staleConversations) {
        await this.db.prepare("DELETE FROM conversations WHERE account_id = ? AND id = ?").run(accountId, staleConversation.id);
      }
      await this.refreshConversationSummary(accountId, conversation, staleUnreadCount, now);
      await this.db.exec("COMMIT");
    } catch (error) {
      await this.db.exec("ROLLBACK");
      this.options.logger?.error(
        {
          err: error,
          contactId: contact.id,
          conversationId: conversation.id,
          staleConversationIds: staleConversations.map((staleConversation) => staleConversation.id)
        },
        "failed to merge stale conversations"
      );
      throw error;
    }
  }

  private async refreshConversationSummary(
    accountId: string,
    conversation: ConversationRecord,
    unreadIncrement: number,
    updatedAt: number
  ): Promise<void> {
    const latest = await this.db
      .prepare(
        "SELECT * FROM messages WHERE account_id = ? AND conversation_id = ? ORDER BY timestamp DESC, created_at DESC LIMIT 1"
      )
      .get(accountId, conversation.id) as MessageRow | undefined;

    if (!latest) {
      await this.db
        .prepare(
          "UPDATE conversations SET protocol_id = ?, kind = ?, title = ?, unread_count = unread_count + ?, updated_at = ? " +
            "WHERE account_id = ? AND id = ?"
        )
        .run(
          conversation.protocolId ?? null,
          conversation.kind,
          conversation.title,
          unreadIncrement,
          updatedAt,
          accountId,
          conversation.id
        );
      return;
    }

    await this.db
      .prepare(
        "UPDATE conversations SET protocol_id = ?, kind = ?, title = ?, unread_count = unread_count + ?, " +
          "last_message_preview = ?, last_message_sender_name = ?, last_message_is_self = ?, last_message_at = ?, updated_at = ? " +
          "WHERE account_id = ? AND id = ?"
      )
      .run(
        conversation.protocolId ?? null,
        conversation.kind,
        conversation.title,
        unreadIncrement,
        latest.content,
        latest.sender_name,
        latest.is_self,
        latest.timestamp,
        updatedAt,
        accountId,
        conversation.id
      );
  }

  private currentAccountId(): string | undefined {
    return this.activeAccountId;
  }

  private requireActiveAccountId(operation: string): string {
    if (!this.activeAccountId) {
      throw new Error(`Cannot ${operation} before an account is active`);
    }
    return this.activeAccountId;
  }

  private async migrateLegacyGroupMemberSenders(): Promise<void> {
    const now = Date.now();
    const groupRows = await this.db
      .prepare("SELECT * FROM contacts WHERE kind = 'group' AND raw_json IS NOT NULL")
      .all() as unknown as ContactRow[];
    const findGroupMember = await this.db.prepare("SELECT * FROM group_members WHERE id = ? LIMIT 1");
    const insertGroupMember = await this.db.prepare(
      "INSERT INTO group_members " +
        "(account_id, id, group_id, group_protocol_id, member_protocol_id, display_name, remark_name, nick_name, alias, raw_json, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET " +
        "account_id = excluded.account_id, group_id = excluded.group_id, group_protocol_id = excluded.group_protocol_id, " +
        "member_protocol_id = excluded.member_protocol_id, display_name = excluded.display_name, " +
        "remark_name = excluded.remark_name, nick_name = excluded.nick_name, alias = excluded.alias, " +
        "raw_json = excluded.raw_json, updated_at = excluded.updated_at"
    );
    const insertMigratedGroupMember = async (accountId: string | null, member: GroupMemberInput): Promise<void> => {
      const existingRow = await findGroupMember.get(member.id) as GroupMemberRow | undefined;
      const existing = existingRow ? asGroupMember(existingRow) : undefined;
      const memberForStorage = await this.enrichGroupMemberFromContact(
        stabilizeGroupMemberForUpsert(member, existing),
        accountId
      );
      await insertGroupMember.run(
        accountId,
        memberForStorage.id,
        memberForStorage.groupId,
        memberForStorage.groupProtocolId ?? null,
        memberForStorage.memberProtocolId,
        memberForStorage.displayName,
        memberForStorage.remarkName ?? null,
        memberForStorage.nickName ?? null,
        memberForStorage.alias ?? null,
        jsonString(memberForStorage.raw),
        now
      );
    };
    for (const row of groupRows) {
      const group = asContact(row);
      for (const member of groupMemberInputsFromContact(group, row.account_id)) {
        await insertMigratedGroupMember(row.account_id, member);
      }
    }

    await this.db.exec(`
      UPDATE messages
      SET sender_kind = CASE WHEN is_self = 1 THEN 'self' ELSE 'contact' END
      WHERE sender_kind IS NULL;

      UPDATE messages
      SET sender_protocol_id = (
        SELECT contacts.protocol_id
        FROM contacts
        WHERE contacts.account_id IS messages.account_id
          AND contacts.id = messages.sender_id
          AND contacts.protocol_id IS NOT NULL
        LIMIT 1
      )
      WHERE sender_protocol_id IS NULL
        AND sender_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM contacts
          WHERE contacts.account_id IS messages.account_id
            AND contacts.id = messages.sender_id
            AND contacts.protocol_id IS NOT NULL
        );

      UPDATE messages
      SET sender_kind = 'group-member'
      WHERE is_self = 0
        AND sender_protocol_id IS NOT NULL
        AND conversation_id IN (
          SELECT id FROM conversations WHERE conversations.account_id IS messages.account_id AND kind = 'group'
        );
    `);

    const legacyGroupSenders = await this.db
      .prepare(
        "SELECT DISTINCT messages.account_id, conversations.id AS group_id, " +
          "conversations.protocol_id AS group_protocol_id, messages.sender_protocol_id AS member_protocol_id, " +
          "messages.sender_name " +
          "FROM messages " +
          "JOIN conversations ON conversations.account_id IS messages.account_id " +
          "AND conversations.id = messages.conversation_id AND conversations.kind = 'group' " +
          "WHERE messages.sender_kind = 'group-member' AND messages.sender_protocol_id IS NOT NULL"
      )
      .all() as unknown as LegacyGroupMessageSenderRow[];
    for (const row of legacyGroupSenders) {
      const displayName = firstUsefulGroupMemberName(row.sender_name) ?? "Group member";
      await insertMigratedGroupMember(row.account_id, {
        id: groupMemberId(row.group_id, row.member_protocol_id),
        groupId: row.group_id,
        groupProtocolId: row.group_protocol_id ?? undefined,
        memberProtocolId: row.member_protocol_id,
        displayName
      });
    }

    await this.db.exec(`
      UPDATE messages
      SET sender_id = (
        SELECT group_members.id
        FROM group_members
        JOIN conversations ON conversations.account_id IS messages.account_id
          AND conversations.id = messages.conversation_id
        WHERE group_members.account_id IS messages.account_id
          AND group_members.member_protocol_id = messages.sender_protocol_id
          AND (group_members.group_id = conversations.id OR group_members.group_protocol_id = conversations.protocol_id)
        LIMIT 1
      )
      WHERE sender_kind = 'group-member'
        AND sender_protocol_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM group_members
          JOIN conversations ON conversations.account_id IS messages.account_id
            AND conversations.id = messages.conversation_id
          WHERE group_members.account_id IS messages.account_id
            AND group_members.member_protocol_id = messages.sender_protocol_id
            AND (group_members.group_id = conversations.id OR group_members.group_protocol_id = conversations.protocol_id)
        );

      UPDATE messages
      SET sender_name = (
        SELECT group_members.display_name
        FROM group_members
        JOIN conversations ON conversations.account_id IS messages.account_id
          AND conversations.id = messages.conversation_id
        WHERE group_members.account_id IS messages.account_id
          AND group_members.member_protocol_id = messages.sender_protocol_id
          AND (group_members.group_id = conversations.id OR group_members.group_protocol_id = conversations.protocol_id)
        LIMIT 1
      )
      WHERE sender_kind = 'group-member'
        AND (
          ${unhelpfulNameSql("sender_name")}
          OR sender_name = (
            SELECT contacts.display_name
            FROM contacts
            WHERE contacts.account_id IS messages.account_id
              AND contacts.kind = 'private'
              AND contacts.protocol_id = messages.sender_protocol_id
              AND NOT ${unhelpfulNameSql("contacts.display_name")}
            ORDER BY contacts.is_stale ASC, contacts.updated_at DESC
            LIMIT 1
          )
        )
        AND sender_protocol_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM group_members
          JOIN conversations ON conversations.account_id IS messages.account_id
            AND conversations.id = messages.conversation_id
          WHERE group_members.account_id IS messages.account_id
            AND group_members.member_protocol_id = messages.sender_protocol_id
            AND (group_members.group_id = conversations.id OR group_members.group_protocol_id = conversations.protocol_id)
            AND NOT ${unhelpfulNameSql("group_members.display_name")}
        );

      UPDATE conversations
      SET last_message_sender_name = (
        SELECT latest.sender_name
        FROM messages AS latest
        WHERE latest.account_id IS conversations.account_id
          AND latest.conversation_id = conversations.id
        ORDER BY latest.timestamp DESC, latest.created_at DESC
        LIMIT 1
      )
      WHERE (
          last_message_sender_name IS NULL
          OR ${unhelpfulNameSql("last_message_sender_name")}
          OR last_message_sender_name != (
            SELECT latest.sender_name
            FROM messages AS latest
            WHERE latest.account_id IS conversations.account_id
              AND latest.conversation_id = conversations.id
            ORDER BY latest.timestamp DESC, latest.created_at DESC
            LIMIT 1
          )
        )
        AND (
          SELECT CASE WHEN NOT ${unhelpfulNameSql("latest.sender_name")} THEN 1 ELSE 0 END
          FROM messages AS latest
          WHERE latest.account_id IS conversations.account_id
            AND latest.conversation_id = conversations.id
          ORDER BY latest.timestamp DESC, latest.created_at DESC
          LIMIT 1
        ) = 1;

      UPDATE contacts
      SET is_stale = 1
      WHERE is_self = 0
        AND kind = 'private'
        AND (display_name = 'Group member' OR display_name LIKE '@%')
        AND (
          id IN (
            SELECT messages.sender_id
            FROM messages
            JOIN conversations ON conversations.account_id IS messages.account_id
              AND conversations.id = messages.conversation_id
              AND conversations.kind = 'group'
            WHERE messages.sender_id IS NOT NULL
          )
          OR protocol_id IN (
            SELECT messages.sender_protocol_id
            FROM messages
            JOIN conversations ON conversations.account_id IS messages.account_id
              AND conversations.id = messages.conversation_id
              AND conversations.kind = 'group'
            WHERE messages.sender_protocol_id IS NOT NULL
          )
        );
    `);
  }

  private async migrate(): Promise<void> {
    this.options.logger?.debug("running sqlite migrations");
    await this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        protocol_id TEXT,
        display_name TEXT NOT NULL,
        raw_json TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contacts (
        account_id TEXT,
        id TEXT PRIMARY KEY,
        protocol_id TEXT,
        kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        remark_name TEXT,
        nick_name TEXT,
        alias TEXT,
        is_self INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        account_id TEXT,
        id TEXT PRIMARY KEY,
        protocol_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        unread_count INTEGER NOT NULL DEFAULT 0,
        last_message_preview TEXT,
        last_message_sender_name TEXT,
        last_message_is_self INTEGER,
        last_message_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_members (
        account_id TEXT,
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        group_protocol_id TEXT,
        member_protocol_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        remark_name TEXT,
        nick_name TEXT,
        alias TEXT,
        raw_json TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        account_id TEXT,
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        protocol_message_id TEXT,
        sender_id TEXT,
        sender_kind TEXT,
        sender_protocol_id TEXT,
        sender_name TEXT NOT NULL,
        is_self INTEGER NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'text',
        timestamp INTEGER NOT NULL,
        raw_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS attachments (
        account_id TEXT,
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        file_name TEXT,
        media_id TEXT,
        mime_type TEXT,
        size INTEGER,
        local_path TEXT,
        raw_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
    `);
    await this.ensureColumn("contacts", "account_id", "TEXT");
    await this.ensureColumn("contacts", "is_stale", "INTEGER DEFAULT 0");
    await this.ensureColumn("conversations", "account_id", "TEXT");
    await this.ensureColumn("conversations", "last_message_sender_name", "TEXT");
    await this.ensureColumn("conversations", "last_message_is_self", "INTEGER");
    await this.ensureColumn("messages", "account_id", "TEXT");
    await this.ensureColumn("messages", "sender_kind", "TEXT");
    await this.ensureColumn("messages", "sender_protocol_id", "TEXT");
    await this.ensureColumn("attachments", "account_id", "TEXT");
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_contacts_account_display_name ON contacts(account_id, display_name);
      CREATE INDEX IF NOT EXISTS idx_contacts_account_protocol_id ON contacts(account_id, protocol_id);
      CREATE INDEX IF NOT EXISTS idx_group_members_account_group ON group_members(account_id, group_id);
      CREATE INDEX IF NOT EXISTS idx_group_members_account_member_protocol ON group_members(account_id, member_protocol_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_account_protocol_id ON conversations(account_id, protocol_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_account_recent_order
        ON conversations(account_id, (last_message_at IS NULL), last_message_at DESC, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_account_unread_order
        ON conversations(account_id, last_message_at DESC, updated_at DESC)
        WHERE kind <> 'public' AND unread_count > 0;
      CREATE INDEX IF NOT EXISTS idx_conversations_account_unread_count ON conversations(account_id, unread_count);
      CREATE INDEX IF NOT EXISTS idx_messages_account_conversation_time_created
        ON messages(account_id, conversation_id, timestamp DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_account_sender_protocol ON messages(account_id, sender_protocol_id);
      CREATE INDEX IF NOT EXISTS idx_messages_account_content ON messages(account_id, content);
      CREATE INDEX IF NOT EXISTS idx_attachments_account_message_id ON attachments(account_id, message_id);
    `);
    await this.migrateLegacyGroupMemberSenders();
    this.options.logger?.debug("sqlite migrations complete");
  }

  private async ensureColumn(table: string, column: string, definition: string): Promise<void> {
    const rows = await this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) {
      return;
    }
    this.options.logger?.debug({ table, column }, "adding sqlite column");
    await this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function isUsefulSenderName(value: string | undefined): value is string {
  return !!value && value !== "Unknown" && value !== "Group member" && !value.startsWith("@");
}

function optionalUsefulName(value: string | null): string | undefined {
  return isUsefulSenderName(value ?? undefined) ? value ?? undefined : undefined;
}

function isMergeableContactKind(kind: ContactKind): boolean {
  return kind === "private" || kind === "group";
}

function unhelpfulNameSql(column: string): string {
  return `(${column} = 'Unknown' OR ${column} = 'Group member' OR ${column} LIKE '@%')`;
}

function nameBackfillSql(column: string, previousName: string | undefined): string {
  return previousName ? `(${unhelpfulNameSql(column)} OR ${column} = ?)` : unhelpfulNameSql(column);
}

function senderIdsForContactSql(): string {
  return "SELECT ? AS id UNION SELECT id FROM contacts WHERE account_id = ? AND protocol_id = ?";
}

function groupConversationIdsForMemberSql(): string {
  return "SELECT id FROM conversations WHERE account_id = ? AND kind = 'group' AND (id = ? OR protocol_id = ?)";
}

function groupMemberSenderSql(): string {
  return (
    "sender_protocol_id = ? OR sender_id = ? OR " +
    "sender_id IN (SELECT id FROM contacts WHERE account_id = ? AND protocol_id = ?)"
  );
}

function stabilizeContactForUpsert(contact: ContactInput, existing: ContactRecord | undefined): ContactInput {
  const raw = contact.raw ?? existing?.raw;
  if (!existing || isUsefulSenderName(contact.displayName) || !isUsefulSenderName(existing.displayName)) {
    return {
      ...contact,
      protocolId: contact.protocolId ?? existing?.protocolId,
      raw
    };
  }

  return {
    ...contact,
    protocolId: contact.protocolId ?? existing.protocolId,
    displayName: existing.displayName,
    remarkName: contact.remarkName ?? existing.remarkName,
    nickName: contact.nickName ?? existing.nickName,
    alias: contact.alias ?? existing.alias,
    raw
  };
}

function stabilizeGroupMemberForUpsert(member: GroupMemberInput, existing: GroupMemberRecord | undefined): GroupMemberInput {
  const raw = member.raw ?? existing?.raw;
  if (!existing || isUsefulSenderName(member.displayName) || !isUsefulSenderName(existing.displayName)) {
    return {
      ...member,
      groupProtocolId: member.groupProtocolId ?? existing?.groupProtocolId,
      raw
    };
  }

  return {
    ...member,
    groupProtocolId: member.groupProtocolId ?? existing.groupProtocolId,
    displayName: existing.displayName,
    remarkName: member.remarkName ?? existing.remarkName,
    nickName: member.nickName ?? existing.nickName,
    alias: member.alias ?? existing.alias,
    raw
  };
}

function stabilizeConversationForUpsert(conversation: ConversationInput, existing: ConversationRecord | undefined): ConversationInput {
  if (!existing || isUsefulSenderName(conversation.title) || !isUsefulSenderName(existing.title)) {
    return conversation;
  }

  return {
    ...conversation,
    title: existing.title
  };
}

const CONTACT_NAME_FIELDS = ["displayName", "remarkName", "nickName", "alias"] as const;

function groupMemberInputsFromContact(contact: Pick<ContactRecord, "id" | "protocolId" | "raw">, accountId?: string | null): GroupMemberInput[] {
  if (!contact.raw || typeof contact.raw !== "object") {
    return [];
  }
  const memberList = (contact.raw as { MemberList?: unknown }).MemberList;
  if (!Array.isArray(memberList)) {
    return [];
  }

  const members: GroupMemberInput[] = [];
  const seen = new Set<string>();
  const groupId = groupConversationIdFromContact(contact, accountId);
  for (const member of memberList) {
    if (!member || typeof member !== "object") {
      continue;
    }
    const record = member as Record<string, unknown>;
    const protocolId = cleanGroupMemberProtocolId(record.UserName);
    if (!protocolId || seen.has(protocolId)) {
      continue;
    }
    const displayName = firstUsefulGroupMemberName(
      record.RemarkName,
      record.DisplayName,
      record.NickName,
      record.Alias
    );
    if (!displayName) {
      continue;
    }
    seen.add(protocolId);
    members.push({
      id: groupMemberId(groupId, protocolId),
      groupId,
      groupProtocolId: contact.protocolId,
      memberProtocolId: protocolId,
      displayName,
      remarkName: cleanGroupMemberName(record.RemarkName),
      nickName: cleanGroupMemberName(record.NickName),
      alias: cleanGroupMemberName(record.Alias),
      raw: member
    });
  }
  return members;
}

function groupConversationIdFromContact(contact: Pick<ContactRecord, "id">, accountId?: string | null): string {
  if (accountId) {
    const accountPrefix = `${accountId}:`;
    if (contact.id.startsWith(accountPrefix)) {
      return `${accountId}:${conversationIdFromContact({ id: contact.id.slice(accountPrefix.length) })}`;
    }
  }
  return conversationIdFromContact(contact);
}

function cleanGroupMemberProtocolId(value: unknown): string | undefined {
  const protocolId = typeof value === "string" ? value.trim() : "";
  return protocolId.startsWith("@") && !protocolId.startsWith("@@") ? protocolId : undefined;
}

function firstUsefulGroupMemberName(...values: unknown[]): string | undefined {
  for (const value of values) {
    const displayName = cleanGroupMemberName(value);
    if (isUsefulSenderName(displayName)) {
      return displayName;
    }
  }
  return undefined;
}

function cleanGroupMemberName(value: unknown): string | undefined {
  const displayName = cleanText(value).replace(/^\[群\]\s*/, "");
  return displayName || undefined;
}

function sameLazyMergeContact(left: ContactRecord, right: ContactRecord): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "group") {
    return sameGroupName(left, right) && compatibleGroupMemberCounts(left, right);
  }
  return CONTACT_NAME_FIELDS.every(
    (field) => normalizeComparableText(left[field]) === normalizeComparableText(right[field])
  );
}

function sameGroupName(left: ContactRecord, right: ContactRecord): boolean {
  const rightNames = groupNameCandidates(right);
  return groupNameCandidates(left).some((leftName) =>
    rightNames.some((rightName) => groupNamesMatch(leftName, rightName))
  );
}

function groupNameCandidates(contact: ContactRecord): string[] {
  return CONTACT_NAME_FIELDS.map((field) => normalizeComparableGroupName(contact[field])).filter(Boolean);
}

function compatibleGroupMemberCounts(left: ContactRecord, right: ContactRecord): boolean {
  const leftCount = groupMemberCountForContact(left);
  const rightCount = groupMemberCountForContact(right);
  return leftCount === undefined || rightCount === undefined || leftCount === rightCount;
}

function groupMemberCountForContact(contact: ContactRecord): number | undefined {
  const rawCount = groupMemberCountFromRaw(contact.raw);
  if (rawCount !== undefined) {
    return rawCount;
  }
  for (const field of CONTACT_NAME_FIELDS) {
    const suffixCount = groupMemberCountSuffix(contact[field]);
    if (suffixCount !== undefined) {
      return suffixCount;
    }
  }
  return undefined;
}

function comparableContactName(kind: ContactKind, value: string | undefined): string {
  return kind === "group" ? normalizeComparableGroupName(value) : normalizeComparableText(value);
}

function contactMatchesConversation(contact: ContactRecord, conversation: ConversationRecord): boolean {
  if (contact.kind !== conversation.kind) {
    return false;
  }
  const title = comparableContactName(contact.kind, conversation.title);
  return CONTACT_NAME_FIELDS.some((field) => contactNameMatchesTitle(contact.kind, contact[field], title));
}

function contactNameMatchesTitle(kind: ContactKind, value: string | undefined, title: string): boolean {
  const candidate = comparableContactName(kind, value);
  return kind === "group" ? groupNamesMatch(candidate, title) : candidate === title;
}

function contactMatchesGroupName(contact: ContactRecord, normalizedGroupName: string): boolean {
  return (
    contact.kind === "group" &&
    CONTACT_NAME_FIELDS.some((field) => groupNamesMatch(normalizeComparableGroupName(contact[field]), normalizedGroupName))
  );
}

function groupNamesMatch(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return groupNamePartsMatch(left, right);
}

function groupNamePartsMatch(left: string, right: string): boolean {
  const leftParts = splitGroupNameParts(left);
  const rightParts = splitGroupNameParts(right);
  if (leftParts.length < 2 || leftParts.length !== rightParts.length) {
    return false;
  }
  return leftParts.every((part, index) => sameGroupNamePart(part, rightParts[index] ?? ""));
}

function splitGroupNameParts(value: string): string[] {
  return value
    .split(/[、,，]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sameGroupNamePart(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  return left.length >= 2 && right.length >= 2 && (left.includes(right) || right.includes(left));
}

function foldConversationBucket(contact: ContactRecord | undefined, conversations: ConversationRecord[]): ConversationRecord {
  const sorted = [...conversations].sort(compareRecentConversations);
  const latest = sorted[0];
  const current = contact ? conversations.find((conversation) => conversation.protocolId === contact.protocolId) : undefined;
  const base = current ?? latest;
  return {
    ...base,
    protocolId: current?.protocolId ?? base.protocolId,
    title: contact?.displayName ?? base.title,
    unreadCount: conversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
    lastMessagePreview: latest.lastMessagePreview,
    lastMessageSenderName: latest.lastMessageSenderName,
    lastMessageIsSelf: latest.lastMessageIsSelf,
    lastMessageAt: latest.lastMessageAt,
    updatedAt: Math.max(...conversations.map((conversation) => conversation.updatedAt))
  };
}

function dedupeContactsByProtocol(contacts: ContactRecord[]): ContactRecord[] {
  const deduped = new Map<string, ContactRecord>();
  for (const contact of contacts) {
    const key = contact.protocolId ? `${contact.kind}:${contact.protocolId}` : contact.id;
    const current = deduped.get(key);
    if (!current || compareContactQuality(contact, current) > 0) {
      deduped.set(key, contact);
    }
  }
  return Array.from(deduped.values());
}

function compareContactQuality(left: ContactRecord, right: ContactRecord): number {
  const leftScore = (isUsefulSenderName(left.displayName) ? 4 : 0) + (left.nickName ? 2 : 0) + (left.remarkName ? 2 : 0);
  const rightScore = (isUsefulSenderName(right.displayName) ? 4 : 0) + (right.nickName ? 2 : 0) + (right.remarkName ? 2 : 0);
  return leftScore - rightScore || left.updatedAt - right.updatedAt;
}

function dedupeConversationsByProtocol(conversations: ConversationRecord[]): ConversationRecord[] {
  const deduped = new Map<string, ConversationRecord>();
  for (const conversation of conversations) {
    const key = conversation.protocolId ? `${conversation.kind}:${conversation.protocolId}` : conversation.id;
    const current = deduped.get(key);
    if (!current || compareConversationQuality(conversation, current) > 0) {
      deduped.set(key, conversation);
    }
  }
  return Array.from(deduped.values()).sort(compareRecentConversations);
}

function compareConversationQuality(left: ConversationRecord, right: ConversationRecord): number {
  const leftScore =
    (left.lastMessageAt ? 8 : 0) + (isUsefulSenderName(left.title) ? 4 : 0) + (left.lastMessagePreview ? 2 : 0);
  const rightScore =
    (right.lastMessageAt ? 8 : 0) + (isUsefulSenderName(right.title) ? 4 : 0) + (right.lastMessagePreview ? 2 : 0);
  return leftScore - rightScore || (left.lastMessageAt ?? 0) - (right.lastMessageAt ?? 0) || left.updatedAt - right.updatedAt;
}

function compareRecentConversations(left: ConversationRecord, right: ConversationRecord): number {
  const leftHasMessage = left.lastMessageAt === undefined ? 1 : 0;
  const rightHasMessage = right.lastMessageAt === undefined ? 1 : 0;
  return (
    leftHasMessage - rightHasMessage ||
    (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0) ||
    right.updatedAt - left.updatedAt
  );
}
