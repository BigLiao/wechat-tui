import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "pino";
import type { DatabaseSync } from "node:sqlite";
import type {
  ContactInput,
  ContactKind,
  ContactRecord,
  ConversationInput,
  ConversationRecord,
  MessageInput,
  MessageKind,
  MessageRecord,
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
import { loadNodeSqlite } from "../util/node-sqlite.js";
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

interface MessageRow {
  account_id: string | null;
  id: string;
  conversation_id: string;
  protocol_message_id: string | null;
  sender_id: string | null;
  sender_name: string;
  is_self: number;
  content: string;
  type: MessageKind;
  timestamp: number;
  raw_json: string | null;
  created_at: number;
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

function asMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    protocolMessageId: row.protocol_message_id ?? undefined,
    senderId: row.sender_id ?? undefined,
    senderName: row.sender_name,
    isSelf: row.is_self === 1,
    content: row.content,
    type: row.type,
    timestamp: row.timestamp,
    raw: parseJson(row.raw_json),
    createdAt: row.created_at
  };
}

export class SqliteStore implements MessageStore {
  private readonly db: DatabaseSync;
  private activeAccountId?: string;

  constructor(
    private readonly dbPath: string,
    private readonly options: { logger?: Logger } = {}
  ) {
    this.options.logger?.debug({ dbPath }, "opening sqlite store");
    mkdirSync(dirname(dbPath), { recursive: true });
    const { DatabaseSync } = loadNodeSqlite();
    this.db = new DatabaseSync(dbPath);
    this.migrate();
    this.options.logger?.debug({ dbPath }, "sqlite store ready");
  }

  close(): void {
    this.options.logger?.debug({ dbPath: this.dbPath }, "closing sqlite store");
    this.db.close();
  }

  setActiveAccount(account: UserProfile): void {
    this.activeAccountId = account.id;
    this.db
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
  }

  clearActiveAccount(): void {
    this.options.logger?.debug({ accountId: this.activeAccountId }, "active store account cleared");
    this.activeAccountId = undefined;
  }

  getSessionData(): unknown | undefined {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get("wechat.session") as
      | { value: string }
      | undefined;
    this.options.logger?.debug({ hasSessionData: !!row }, "loaded session data marker");
    return row ? parseJson(row.value) : undefined;
  }

  setSessionData(data: unknown): void {
    if (data === undefined) {
      this.clearSessionData();
      return;
    }
    this.options.logger?.debug("saving session data marker");
    this.db
      .prepare(
        "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      )
      .run("wechat.session", JSON.stringify(data), Date.now());
  }

  clearSessionData(): void {
    this.options.logger?.debug("clearing session data");
    this.db.prepare("DELETE FROM kv WHERE key = ?").run("wechat.session");
  }

  clearData(): void {
    this.options.logger?.debug("clearing all data except session");
    this.db.prepare("DELETE FROM messages").run();
    this.db.prepare("DELETE FROM attachments").run();
    this.db.prepare("DELETE FROM conversations").run();
    this.db.prepare("DELETE FROM contacts").run();
    this.db.prepare("DELETE FROM accounts").run();
    this.db.prepare("DELETE FROM kv WHERE key != ?").run("wechat.session");
  }

  upsertContact(contact: ContactInput): ContactRecord {
    const accountId = this.requireActiveAccountId("upsert contact");
    const now = Date.now();
    const existing = this.findContactById(contact.id);
    const contactForStorage = stabilizeContactForUpsert(contact, existing);
    this.db
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

    const saved = this.findContactById(contactForStorage.id);
    if (!saved) {
      throw new Error(`Failed to save contact ${contact.id}`);
    }
    this.backfillConversationTitlesFromContact(saved);
    this.backfillSenderNameFromContact(saved);
    this.backfillGroupMemberSenderNamesFromContact(saved);
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
  }

  upsertContacts(contacts: ContactInput[]): ContactRecord[] {
    this.options.logger?.debug(summarizeContacts(contacts), "upserting contacts");
    this.db.exec("BEGIN");
    try {
      const saved = contacts.map((contact) => this.upsertContact(contact));
      this.db.exec("COMMIT");
      this.options.logger?.debug({ count: saved.length }, "contacts upserted");
      return saved;
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.options.logger?.error({ err: error, count: contacts.length }, "failed to upsert contacts");
      throw error;
    }
  }

  markAllContactsStale(): void {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return;
    }
    this.db
      .prepare("UPDATE contacts SET is_stale = 1 WHERE account_id = ? AND is_self = 0")
      .run(accountId);
    this.options.logger?.debug({ accountId }, "marked all contacts stale");
  }

  listContacts(kind?: ContactKind, limit = 50): ContactRecord[] {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const scanLimit = Math.max(limit * 3, limit);
    const rows = kind
      ? (this.db
          .prepare(
            "SELECT * FROM contacts WHERE account_id = ? AND kind = ? AND is_self = 0 AND is_stale = 0 ORDER BY display_name COLLATE NOCASE LIMIT ?"
          )
          .all(accountId, kind, scanLimit) as unknown as ContactRow[])
      : (this.db
          .prepare("SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 ORDER BY display_name COLLATE NOCASE LIMIT ?")
          .all(accountId, scanLimit) as unknown as ContactRow[]);
    const contacts = dedupeContactsByProtocol(rows.map(asContact)).slice(0, limit);
    this.options.logger?.debug({ kind, limit, count: contacts.length }, "listed contacts");
    return contacts;
  }

  findContactByName(query: string): ContactRecord | undefined {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    const like = `%${normalized}%`;
    const row = this.db
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
    const contact = row ? asContact(row) : undefined;
    this.options.logger?.debug({ query, found: !!contact, contactId: contact?.id }, "contact lookup by name");
    return contact;
  }

  searchContacts(keyword: string, limit = 20): ContactRecord[] {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const scanLimit = Math.max(limit * 3, limit);
    const normalized = keyword.trim().toLowerCase();
    const rows = normalized
      ? (this.db
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
      : (this.db
          .prepare(
            "SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 AND kind IN ('private', 'group') ORDER BY updated_at DESC, display_name COLLATE NOCASE LIMIT ?"
          )
          .all(accountId, scanLimit) as unknown as ContactRow[]);
    const contacts = dedupeContactsByProtocol(rows.map(asContact)).slice(0, limit);
    this.options.logger?.debug({ keyword, limit, count: contacts.length }, "searched contacts");
    return contacts;
  }

  upsertConversation(conversation: ConversationInput): ConversationRecord {
    const accountId = this.requireActiveAccountId("upsert conversation");
    this.options.logger?.trace({ conversation: summarizeConversationInput(conversation) }, "upserting conversation");
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO conversations (account_id, id, protocol_id, kind, title, unread_count, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?) " +
          "ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, protocol_id = excluded.protocol_id, kind = excluded.kind, " +
          "title = excluded.title, updated_at = excluded.updated_at"
      )
      .run(accountId, conversation.id, conversation.protocolId ?? null, conversation.kind, conversation.title, now);

    const saved = this.findConversationById(conversation.id);
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
  }

  mergeStaleConversationForContact(contact: ContactRecord, conversation: ConversationRecord): ConversationRecord {
    const accountId = this.currentAccountId();
    if (!accountId || !isMergeableContactKind(contact.kind) || contact.isSelf) {
      return conversation;
    }

    const activeMatches = this.findLazyMergeActiveContacts(accountId, contact);
    if (activeMatches.length !== 1 || activeMatches[0]?.id !== contact.id) {
      this.options.logger?.debug(
        { contactId: contact.id, displayName: contact.displayName, activeMatches: activeMatches.length },
        "skipping stale conversation merge because current contact is ambiguous"
      );
      return conversation;
    }

    const staleContacts = this.findLazyMergeStaleContacts(accountId, contact);
    if (staleContacts.length === 0) {
      return conversation;
    }

    const staleConversations = this.findLazyMergeStaleConversations(accountId, contact, conversation, staleContacts);
    if (staleConversations.length === 0) {
      return conversation;
    }

    this.applyStaleConversationMerge(accountId, contact, conversation, staleContacts, staleConversations);

    const merged = this.findConversationById(conversation.id) ?? conversation;
    this.options.logger?.info(
      {
        contactId: contact.id,
        conversationId: conversation.id,
        staleContactIds: staleContacts.map((staleContact) => staleContact.id),
        staleConversationIds: staleConversations.map((staleConversation) => staleConversation.id)
      },
      "merged stale conversations into current contact conversation"
    );
    return merged;
  }

  findConversationById(id: string): ConversationRecord | undefined {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const row = this.db.prepare("SELECT * FROM conversations WHERE account_id = ? AND id = ?").get(accountId, id) as
      | ConversationRow
      | undefined;
    const conversation = row ? asConversation(row) : undefined;
    this.options.logger?.trace({ id, found: !!conversation }, "conversation lookup by id");
    return conversation;
  }

  saveMessage(message: MessageInput, conversation: ConversationInput, incrementUnread: boolean): MessageRecord {
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
    this.db.exec("BEGIN");
    try {
      this.upsertConversation(conversation);
      const now = Date.now();
      const insertResult = this.db
        .prepare(
          "INSERT OR IGNORE INTO messages " +
            "(account_id, id, conversation_id, protocol_message_id, sender_id, sender_name, is_self, content, type, timestamp, raw_json, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          accountId,
          message.id,
          message.conversationId,
          message.protocolMessageId ?? null,
          message.senderId ?? null,
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
        this.db
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

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
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

    const saved = this.findMessageById(message.id);
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
  }

  listRecentConversations(limit = 20): ConversationRecord[] {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const scanLimit = Math.max(limit * 3, limit);
    const rows = this.db
      .prepare(
        "SELECT * FROM conversations WHERE account_id = ? ORDER BY last_message_at IS NULL ASC, last_message_at DESC, updated_at DESC LIMIT ?"
      )
      .all(accountId, scanLimit) as unknown as ConversationRow[];
    const conversations = this.foldMergeableConversationsByActiveContacts(
      accountId,
      dedupeConversationsByProtocol(rows.map(asConversation))
    ).slice(0, limit);
    this.options.logger?.debug({ limit, count: conversations.length }, "listed recent conversations");
    return conversations;
  }

  listUnreadConversations(limit = 20): ConversationRecord[] {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const scanLimit = Math.max(limit * 3, limit);
    const rows = this.db
      .prepare(
        "SELECT * FROM conversations WHERE account_id = ? AND kind <> 'public' AND unread_count > 0 " +
          "ORDER BY last_message_at DESC, updated_at DESC LIMIT ?"
      )
      .all(accountId, scanLimit) as unknown as ConversationRow[];
    const conversations = this.foldMergeableConversationsByActiveContacts(
      accountId,
      dedupeConversationsByProtocol(rows.map(asConversation))
    ).slice(0, limit);
    this.options.logger?.debug({ limit, count: conversations.length }, "listed unread conversations");
    return conversations;
  }

  listMessages(conversationId: string, limit = 30): MessageRecord[] {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return [];
    }
    const rows = this.db
      .prepare(
        "SELECT * FROM (" +
          "SELECT * FROM messages WHERE account_id = ? AND conversation_id = ? ORDER BY timestamp DESC, created_at DESC LIMIT ?" +
          ") ORDER BY timestamp ASC, created_at ASC"
      )
      .all(accountId, conversationId, limit) as unknown as MessageRow[];
    const messages = rows.map(asMessage);
    this.options.logger?.debug({ conversationId, limit, count: messages.length }, "listed messages");
    return messages;
  }

  updateMessageRaw(messageId: string, raw: unknown): void {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return;
    }
    this.db
      .prepare("UPDATE messages SET raw_json = ? WHERE account_id = ? AND id = ?")
      .run(jsonString(raw), accountId, messageId);
  }

  searchMessages(keyword: string, limit = 50, conversationId?: string): SearchResult[] {
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
      ? (this.db
          .prepare(
            "SELECT * FROM messages WHERE account_id = ? AND conversation_id = ? AND content LIKE ? " +
              "ORDER BY timestamp DESC, created_at DESC LIMIT ?"
          )
          .all(accountId, conversationId, like, limit) as unknown as MessageRow[])
      : (this.db
          .prepare("SELECT * FROM messages WHERE account_id = ? AND content LIKE ? ORDER BY timestamp DESC, created_at DESC LIMIT ?")
          .all(accountId, like, limit) as unknown as MessageRow[]);

    const results = rows.flatMap((row) => {
      const conversation = this.findConversationById(row.conversation_id);
      if (!conversation) {
        return [];
      }
      return [{ conversation, message: asMessage(row) }];
    });
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

  markRead(conversationId: string): void {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return;
    }
    this.options.logger?.debug({ conversationId }, "marking conversation read");
    this.db
      .prepare("UPDATE conversations SET unread_count = 0, updated_at = ? WHERE account_id = ? AND id = ?")
      .run(Date.now(), accountId, conversationId);
  }

  totalUnreadCount(): number {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return 0;
    }
    const row = this.db
      .prepare("SELECT COALESCE(SUM(unread_count), 0) AS total FROM conversations WHERE account_id = ? AND kind <> 'public'")
      .get(accountId) as { total: number } | undefined;
    const total = Number(row?.total ?? 0);
    this.options.logger?.trace({ total }, "computed total unread count");
    return total;
  }

  private findContactById(id: string): ContactRecord | undefined {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const row = this.db.prepare("SELECT * FROM contacts WHERE account_id = ? AND id = ?").get(accountId, id) as
      | ContactRow
      | undefined;
    return row ? asContact(row) : undefined;
  }

  private findMessageById(id: string): MessageRecord | undefined {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return undefined;
    }
    const row = this.db.prepare("SELECT * FROM messages WHERE account_id = ? AND id = ?").get(accountId, id) as
      | MessageRow
      | undefined;
    return row ? asMessage(row) : undefined;
  }

  private backfillConversationTitlesFromContact(contact: ContactRecord): void {
    const accountId = this.currentAccountId();
    if (!accountId || !contact.protocolId) {
      return;
    }
    const now = Date.now();

    // Update the conversation's protocol_id to the latest UserName (by stable conversation ID)
    const conversationId = `conversation:${contact.id}`;
    this.db
      .prepare(
        "UPDATE conversations SET protocol_id = ?, updated_at = ? WHERE account_id = ? AND id = ?"
      )
      .run(contact.protocolId, now, accountId, conversationId);

    // Update titles for conversations matching this protocol_id with unhelpful names
    if (isUsefulSenderName(contact.displayName)) {
      this.db
        .prepare(
          "UPDATE conversations SET title = ?, updated_at = ? " +
            `WHERE account_id = ? AND protocol_id = ? AND ${unhelpfulNameSql("title")}`
        )
        .run(contact.displayName, now, accountId, contact.protocolId);
    }
  }

  private backfillSenderNameFromContact(contact: ContactRecord): void {
    const accountId = this.currentAccountId();
    if (!accountId) {
      return;
    }
    if (contact.isSelf || !isUsefulSenderName(contact.displayName)) {
      return;
    }

    const senderIdsSql = senderIdsForContactSql();
    const result = this.db
      .prepare(
        `UPDATE messages SET sender_name = ? WHERE account_id = ? AND sender_id IN (${senderIdsSql}) ` +
          `AND ${unhelpfulNameSql("sender_name")}`
      )
      .run(contact.displayName, accountId, contact.id, accountId, contact.protocolId ?? null);

    this.db
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

  private backfillGroupMemberSenderNamesFromContact(contact: ContactRecord): void {
    const accountId = this.currentAccountId();
    if (!accountId || contact.kind !== "group" || !contact.protocolId) {
      return;
    }

    const members = groupMembersWithUsefulNames(contact.raw);
    if (members.length === 0) {
      return;
    }

    const senderIdsSql = "SELECT id FROM contacts WHERE account_id = ? AND protocol_id = ?";
    let changedMessages = 0;
    for (const member of members) {
      const result = this.db
        .prepare(
          "UPDATE messages SET sender_name = ? WHERE account_id = ? " +
            `AND ${unhelpfulNameSql("sender_name")} ` +
            `AND sender_id IN (${senderIdsSql}) ` +
            "AND conversation_id IN (" +
            "SELECT id FROM conversations WHERE account_id = ? AND kind = 'group' AND protocol_id = ?" +
            ")"
        )
        .run(member.displayName, accountId, accountId, member.protocolId, accountId, contact.protocolId);
      changedMessages += Number(result.changes);

      this.db
        .prepare(
          "UPDATE conversations SET last_message_sender_name = ? WHERE account_id = ? " +
            `AND ${unhelpfulNameSql("last_message_sender_name")} ` +
            "AND kind = 'group' AND protocol_id = ? " +
            "AND (" +
            "SELECT sender_id FROM messages WHERE account_id = conversations.account_id AND conversation_id = conversations.id " +
            "ORDER BY timestamp DESC, created_at DESC LIMIT 1" +
            `) IN (${senderIdsSql})`
        )
        .run(member.displayName, accountId, contact.protocolId, accountId, member.protocolId);
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

  private foldMergeableConversationsByActiveContacts(
    accountId: string,
    conversations: ConversationRecord[]
  ): ConversationRecord[] {
    const activeContacts = this.listActiveMergeableContacts(accountId);
    if (activeContacts.length === 0) {
      return conversations;
    }

    const buckets = new Map<string, { contact?: ContactRecord; conversations: ConversationRecord[] }>();
    for (const conversation of conversations) {
      const contact = this.uniqueActiveContactForConversation(accountId, activeContacts, conversation);
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

  private listActiveMergeableContacts(accountId: string): ContactRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 AND kind IN ('private', 'group')"
      )
      .all(accountId) as unknown as ContactRow[];
    return rows.map(asContact);
  }

  private uniqueActiveContactForConversation(
    accountId: string,
    activeContacts: ContactRecord[],
    conversation: ConversationRecord
  ): ContactRecord | undefined {
    if (!isMergeableContactKind(conversation.kind)) {
      return undefined;
    }
    const matches = activeContacts.filter((contact) => this.contactCanFoldConversation(accountId, contact, conversation));
    return matches.length === 1 ? matches[0] : undefined;
  }

  private contactCanFoldConversation(
    accountId: string,
    contact: ContactRecord,
    conversation: ConversationRecord
  ): boolean {
    if (!contactMatchesConversation(contact, conversation)) {
      return false;
    }
    if (conversation.protocolId === contact.protocolId) {
      return true;
    }
    if (!conversation.protocolId) {
      return false;
    }
    const staleContact = this.findStaleContactByProtocolId(accountId, conversation.kind, conversation.protocolId);
    return !!staleContact && sameLazyMergeContact(contact, staleContact);
  }

  private findStaleContactByProtocolId(
    accountId: string,
    kind: ContactKind,
    protocolId: string
  ): ContactRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM contacts WHERE account_id = ? AND is_stale = 1 AND kind = ? AND protocol_id = ? LIMIT 1")
      .get(accountId, kind, protocolId) as ContactRow | undefined;
    return row ? asContact(row) : undefined;
  }

  private findLazyMergeActiveContacts(accountId: string, contact: ContactRecord): ContactRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 0 AND kind = ? AND display_name = ?")
      .all(accountId, contact.kind, contact.displayName) as unknown as ContactRow[];
    return rows.map(asContact).filter((candidate) => sameLazyMergeContact(candidate, contact));
  }

  private findLazyMergeStaleContacts(accountId: string, contact: ContactRecord): ContactRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM contacts WHERE account_id = ? AND is_self = 0 AND is_stale = 1 AND kind = ? AND display_name = ?")
      .all(accountId, contact.kind, contact.displayName) as unknown as ContactRow[];
    return rows
      .map(asContact)
      .filter(
        (candidate) =>
          candidate.id !== contact.id &&
          !!candidate.protocolId &&
          candidate.protocolId !== contact.protocolId &&
          sameLazyMergeContact(candidate, contact)
      );
  }

  private findLazyMergeStaleConversations(
    accountId: string,
    contact: ContactRecord,
    conversation: ConversationRecord,
    staleContacts: ContactRecord[]
  ): ConversationRecord[] {
    const staleConversationById = new Map<string, ConversationRecord>();
    const statement = this.db.prepare(
      "SELECT * FROM conversations WHERE account_id = ? AND kind = ? AND protocol_id = ? AND id != ? AND title = ?"
    );

    for (const staleContact of staleContacts) {
      if (!staleContact.protocolId) {
        continue;
      }
      const rows = statement.all(
        accountId,
        staleContact.kind,
        staleContact.protocolId,
        conversation.id,
        contact.displayName
      ) as unknown as ConversationRow[];
      for (const row of rows) {
        staleConversationById.set(row.id, asConversation(row));
      }
    }

    return Array.from(staleConversationById.values());
  }

  private applyStaleConversationMerge(
    accountId: string,
    contact: ContactRecord,
    conversation: ConversationRecord,
    staleContacts: ContactRecord[],
    staleConversations: ConversationRecord[]
  ): void {
    const staleUnreadCount = staleConversations.reduce((total, staleConversation) => total + staleConversation.unreadCount, 0);
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      for (const staleConversation of staleConversations) {
        this.db
          .prepare("UPDATE messages SET conversation_id = ? WHERE account_id = ? AND conversation_id = ?")
          .run(conversation.id, accountId, staleConversation.id);
      }
      for (const staleContact of staleContacts) {
        this.db
          .prepare("UPDATE messages SET sender_id = ? WHERE account_id = ? AND conversation_id = ? AND sender_id = ?")
          .run(contact.id, accountId, conversation.id, staleContact.id);
      }
      for (const staleConversation of staleConversations) {
        this.db.prepare("DELETE FROM conversations WHERE account_id = ? AND id = ?").run(accountId, staleConversation.id);
      }
      this.refreshConversationSummary(accountId, conversation, staleUnreadCount, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
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

  private refreshConversationSummary(
    accountId: string,
    conversation: ConversationRecord,
    unreadIncrement: number,
    updatedAt: number
  ): void {
    const latest = this.db
      .prepare(
        "SELECT * FROM messages WHERE account_id = ? AND conversation_id = ? ORDER BY timestamp DESC, created_at DESC LIMIT 1"
      )
      .get(accountId, conversation.id) as MessageRow | undefined;

    if (!latest) {
      this.db
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

    this.db
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

  private migrate(): void {
    this.options.logger?.debug("running sqlite migrations");
    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS messages (
        account_id TEXT,
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        protocol_message_id TEXT,
        sender_id TEXT,
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
    this.ensureColumn("contacts", "account_id", "TEXT");
    this.ensureColumn("contacts", "is_stale", "INTEGER DEFAULT 0");
    this.ensureColumn("conversations", "account_id", "TEXT");
    this.ensureColumn("conversations", "last_message_sender_name", "TEXT");
    this.ensureColumn("conversations", "last_message_is_self", "INTEGER");
    this.ensureColumn("messages", "account_id", "TEXT");
    this.ensureColumn("attachments", "account_id", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_contacts_account_display_name ON contacts(account_id, display_name);
      CREATE INDEX IF NOT EXISTS idx_contacts_account_protocol_id ON contacts(account_id, protocol_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_account_protocol_id ON conversations(account_id, protocol_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_account_last_message_at ON conversations(account_id, last_message_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_account_unread_count ON conversations(account_id, unread_count);
      CREATE INDEX IF NOT EXISTS idx_messages_account_conversation_time ON messages(account_id, conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_account_content ON messages(account_id, content);
      CREATE INDEX IF NOT EXISTS idx_attachments_account_message_id ON attachments(account_id, message_id);
    `);
    this.options.logger?.debug("sqlite migrations complete");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === column)) {
      return;
    }
    this.options.logger?.debug({ table, column }, "adding sqlite column");
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function isUsefulSenderName(value: string | undefined): value is string {
  return !!value && value !== "Unknown" && value !== "Group member" && !value.startsWith("@");
}

function isMergeableContactKind(kind: ContactKind): boolean {
  return kind === "private" || kind === "group";
}

function unhelpfulNameSql(column: "sender_name" | "last_message_sender_name" | "title"): string {
  return `(${column} = 'Unknown' OR ${column} = 'Group member' OR ${column} LIKE '@%')`;
}

function senderIdsForContactSql(): string {
  return "SELECT ? AS id UNION SELECT id FROM contacts WHERE account_id = ? AND protocol_id = ?";
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

interface UsefulGroupMember {
  protocolId: string;
  displayName: string;
}

function groupMembersWithUsefulNames(raw: unknown): UsefulGroupMember[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const memberList = (raw as { MemberList?: unknown }).MemberList;
  if (!Array.isArray(memberList)) {
    return [];
  }

  const members: UsefulGroupMember[] = [];
  const seen = new Set<string>();
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
    members.push({ protocolId, displayName });
  }
  return members;
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
  const sameTextFields =
    left.kind === right.kind &&
    mergeText(left.displayName) === mergeText(right.displayName) &&
    mergeText(left.remarkName) === mergeText(right.remarkName) &&
    mergeText(left.nickName) === mergeText(right.nickName) &&
    mergeText(left.alias) === mergeText(right.alias);
  if (!sameTextFields) {
    return false;
  }
  return left.kind === "group" ? sameGroupMemberCount(left.raw, right.raw) : true;
}

function sameGroupMemberCount(left: unknown, right: unknown): boolean {
  const leftCount = groupMemberCount(left);
  const rightCount = groupMemberCount(right);
  return leftCount !== undefined && rightCount !== undefined && leftCount === rightCount;
}

function groupMemberCount(raw: unknown): number | undefined {
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

function mergeText(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function contactMatchesConversation(contact: ContactRecord, conversation: ConversationRecord): boolean {
  const title = mergeText(conversation.title);
  return [contact.displayName, contact.remarkName, contact.nickName, contact.alias].some((value) => mergeText(value) === title);
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
