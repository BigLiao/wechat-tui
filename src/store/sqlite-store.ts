import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
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
  SearchResult
} from "../types.js";
import {
  summarizeContacts,
  summarizeConversationInput,
  summarizeMessageInput,
  summarizeSearchResults,
  summarizeStoredMessage
} from "../logging.js";

const require = createRequire(import.meta.url);

type SqliteModule = typeof import("node:sqlite");

interface ContactRow {
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

let sqliteModule: SqliteModule | undefined;

function loadSqlite(): SqliteModule {
  if (sqliteModule) {
    return sqliteModule;
  }

  const previousEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const type = typeof args[0] === "string" ? args[0] : undefined;
    if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) {
      return;
    }
    return (previousEmitWarning as (...innerArgs: unknown[]) => void).call(process, warning, ...args);
  }) as typeof process.emitWarning;

  try {
    sqliteModule = require("node:sqlite") as SqliteModule;
    return sqliteModule;
  } finally {
    process.emitWarning = previousEmitWarning;
  }
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

  constructor(
    private readonly dbPath: string,
    private readonly options: { logger?: Logger } = {}
  ) {
    this.options.logger?.debug({ dbPath }, "opening sqlite store");
    mkdirSync(dirname(dbPath), { recursive: true });
    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(dbPath);
    this.migrate();
    this.options.logger?.debug({ dbPath }, "sqlite store ready");
  }

  close(): void {
    this.options.logger?.debug({ dbPath: this.dbPath }, "closing sqlite store");
    this.db.close();
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

  upsertContact(contact: ContactInput): ContactRecord {
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO contacts " +
          "(id, protocol_id, kind, display_name, remark_name, nick_name, alias, is_self, raw_json, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET " +
          "protocol_id = excluded.protocol_id, kind = excluded.kind, display_name = excluded.display_name, " +
          "remark_name = excluded.remark_name, nick_name = excluded.nick_name, alias = excluded.alias, " +
          "is_self = excluded.is_self, raw_json = excluded.raw_json, updated_at = excluded.updated_at"
      )
      .run(
        contact.id,
        contact.protocolId ?? null,
        contact.kind,
        contact.displayName,
        contact.remarkName ?? null,
        contact.nickName ?? null,
        contact.alias ?? null,
        contact.isSelf ? 1 : 0,
        jsonString(contact.raw),
        now
      );

    const saved = this.findContactById(contact.id);
    if (!saved) {
      throw new Error(`Failed to save contact ${contact.id}`);
    }
    this.backfillSenderNameFromContact(saved);
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
      this.options.logger?.error({ error, count: contacts.length }, "failed to upsert contacts");
      throw error;
    }
  }

  listContacts(kind?: ContactKind, limit = 50): ContactRecord[] {
    const rows = kind
      ? (this.db
          .prepare(
            "SELECT * FROM contacts WHERE kind = ? AND is_self = 0 ORDER BY display_name COLLATE NOCASE LIMIT ?"
          )
          .all(kind, limit) as unknown as ContactRow[])
      : (this.db
          .prepare("SELECT * FROM contacts WHERE is_self = 0 ORDER BY display_name COLLATE NOCASE LIMIT ?")
          .all(limit) as unknown as ContactRow[]);
    const contacts = rows.map(asContact);
    this.options.logger?.debug({ kind, limit, count: contacts.length }, "listed contacts");
    return contacts;
  }

  findContactByName(query: string): ContactRecord | undefined {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    const like = `%${normalized}%`;
    const row = this.db
      .prepare(
        "SELECT * FROM contacts WHERE is_self = 0 AND " +
          "(lower(display_name) = ? OR lower(remark_name) = ? OR lower(nick_name) = ? OR lower(alias) = ? " +
          "OR lower(display_name) LIKE ? OR lower(remark_name) LIKE ? OR lower(nick_name) LIKE ? OR lower(alias) LIKE ?) " +
          "ORDER BY CASE " +
          "WHEN lower(display_name) = ? THEN 0 WHEN lower(remark_name) = ? THEN 1 " +
          "WHEN lower(nick_name) = ? THEN 2 WHEN lower(alias) = ? THEN 3 ELSE 4 END, updated_at DESC LIMIT 1"
      )
      .get(normalized, normalized, normalized, normalized, like, like, like, like, normalized, normalized, normalized, normalized) as
      | ContactRow
      | undefined;
    const contact = row ? asContact(row) : undefined;
    this.options.logger?.debug({ query, found: !!contact, contactId: contact?.id }, "contact lookup by name");
    return contact;
  }

  searchContacts(keyword: string, limit = 20): ContactRecord[] {
    const normalized = keyword.trim().toLowerCase();
    const rows = normalized
      ? (this.db
          .prepare(
            "SELECT * FROM contacts WHERE is_self = 0 AND kind IN ('private', 'group') AND " +
              "(lower(display_name) LIKE ? OR lower(remark_name) LIKE ? OR lower(nick_name) LIKE ? OR lower(alias) LIKE ?) " +
              "ORDER BY CASE " +
              "WHEN lower(display_name) = ? THEN 0 WHEN lower(remark_name) = ? THEN 1 " +
              "WHEN lower(nick_name) = ? THEN 2 WHEN lower(alias) = ? THEN 3 ELSE 4 END, " +
              "display_name COLLATE NOCASE LIMIT ?"
          )
          .all(
            `%${normalized}%`,
            `%${normalized}%`,
            `%${normalized}%`,
            `%${normalized}%`,
            normalized,
            normalized,
            normalized,
            normalized,
            limit
          ) as unknown as ContactRow[])
      : (this.db
          .prepare(
            "SELECT * FROM contacts WHERE is_self = 0 AND kind IN ('private', 'group') ORDER BY updated_at DESC, display_name COLLATE NOCASE LIMIT ?"
          )
          .all(limit) as unknown as ContactRow[]);
    const contacts = rows.map(asContact);
    this.options.logger?.debug({ keyword, limit, count: contacts.length }, "searched contacts");
    return contacts;
  }

  upsertConversation(conversation: ConversationInput): ConversationRecord {
    this.options.logger?.trace({ conversation: summarizeConversationInput(conversation) }, "upserting conversation");
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO conversations (id, protocol_id, kind, title, unread_count, updated_at) VALUES (?, ?, ?, ?, 0, ?) " +
          "ON CONFLICT(id) DO UPDATE SET protocol_id = excluded.protocol_id, kind = excluded.kind, " +
          "title = excluded.title, updated_at = excluded.updated_at"
      )
      .run(conversation.id, conversation.protocolId ?? null, conversation.kind, conversation.title, now);

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

  findConversationById(id: string): ConversationRecord | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
    const conversation = row ? asConversation(row) : undefined;
    this.options.logger?.trace({ id, found: !!conversation }, "conversation lookup by id");
    return conversation;
  }

  findConversationByName(query: string): ConversationRecord | undefined {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    const like = `%${normalized}%`;
    const row = this.db
      .prepare(
        "SELECT * FROM conversations WHERE lower(title) = ? OR lower(title) LIKE ? " +
          "ORDER BY CASE WHEN lower(title) = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1"
      )
      .get(normalized, like, normalized) as ConversationRow | undefined;
    const conversation = row ? asConversation(row) : undefined;
    this.options.logger?.debug({ query, found: !!conversation, conversationId: conversation?.id }, "conversation lookup by name");
    return conversation;
  }

  saveMessage(message: MessageInput, conversation: ConversationInput, incrementUnread: boolean): MessageRecord {
    this.options.logger?.debug(
      {
        message: summarizeMessageInput(message),
        conversation: summarizeConversationInput(conversation),
        incrementUnread
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
            "(id, conversation_id, protocol_message_id, sender_id, sender_name, is_self, content, type, timestamp, raw_json, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
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
              "unread_count = unread_count + ?, updated_at = ? WHERE id = ?"
          )
          .run(
            message.content,
            message.timestamp,
            message.senderName,
            message.isSelf ? 1 : 0,
            incrementUnread ? 1 : 0,
            now,
            conversation.id
          );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.options.logger?.error(
        {
          error,
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
        incrementUnread,
        message: summarizeStoredMessage(saved)
      },
      inserted ? "message saved" : "duplicate message ignored"
    );
    return saved;
  }

  listRecentConversations(limit = 20): ConversationRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM conversations ORDER BY last_message_at IS NULL ASC, last_message_at DESC, updated_at DESC LIMIT ?"
      )
      .all(limit) as unknown as ConversationRow[];
    const conversations = rows.map(asConversation);
    this.options.logger?.debug({ limit, count: conversations.length }, "listed recent conversations");
    return conversations;
  }

  listUnreadConversations(limit = 20): ConversationRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM conversations WHERE unread_count > 0 ORDER BY last_message_at DESC, updated_at DESC LIMIT ?"
      )
      .all(limit) as unknown as ConversationRow[];
    const conversations = rows.map(asConversation);
    this.options.logger?.debug({ limit, count: conversations.length }, "listed unread conversations");
    return conversations;
  }

  listMessages(conversationId: string, limit = 30): MessageRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM (" +
          "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC, created_at DESC LIMIT ?" +
          ") ORDER BY timestamp ASC, created_at ASC"
      )
      .all(conversationId, limit) as unknown as MessageRow[];
    const messages = rows.map(asMessage);
    this.options.logger?.debug({ conversationId, limit, count: messages.length }, "listed messages");
    return messages;
  }

  searchMessages(keyword: string, limit = 50, conversationId?: string): SearchResult[] {
    const normalized = keyword.trim();
    if (!normalized) {
      return [];
    }
    const like = `%${normalized}%`;
    const rows = conversationId
      ? (this.db
          .prepare(
            "SELECT * FROM messages WHERE conversation_id = ? AND content LIKE ? " +
              "ORDER BY timestamp DESC, created_at DESC LIMIT ?"
          )
          .all(conversationId, like, limit) as unknown as MessageRow[])
      : (this.db
          .prepare("SELECT * FROM messages WHERE content LIKE ? ORDER BY timestamp DESC, created_at DESC LIMIT ?")
          .all(like, limit) as unknown as MessageRow[]);

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
    this.options.logger?.debug({ conversationId }, "marking conversation read");
    this.db.prepare("UPDATE conversations SET unread_count = 0, updated_at = ? WHERE id = ?").run(Date.now(), conversationId);
  }

  totalUnreadCount(): number {
    const row = this.db.prepare("SELECT COALESCE(SUM(unread_count), 0) AS total FROM conversations").get() as
      | { total: number }
      | undefined;
    const total = Number(row?.total ?? 0);
    this.options.logger?.trace({ total }, "computed total unread count");
    return total;
  }

  private findContactById(id: string): ContactRecord | undefined {
    const row = this.db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as ContactRow | undefined;
    return row ? asContact(row) : undefined;
  }

  private findMessageById(id: string): MessageRecord | undefined {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    return row ? asMessage(row) : undefined;
  }

  private backfillSenderNameFromContact(contact: ContactRecord): void {
    if (!contact.protocolId || contact.isSelf || !isUsefulSenderName(contact.displayName)) {
      return;
    }

    const result = this.db
      .prepare(
        "UPDATE messages SET sender_name = ? WHERE sender_id IN (" +
          "SELECT id FROM contacts WHERE protocol_id = ? AND " +
          "(display_name = 'Unknown' OR display_name = 'Group member' OR display_name LIKE '@%')" +
          ") AND (sender_name = 'Unknown' OR sender_name = 'Group member' OR sender_name LIKE '@%')"
      )
      .run(contact.displayName, contact.protocolId);

    this.db
      .prepare(
        "UPDATE conversations SET last_message_sender_name = ? WHERE id IN (" +
          "SELECT conversation_id FROM messages WHERE sender_id IN (" +
          "SELECT id FROM contacts WHERE protocol_id = ? AND " +
          "(display_name = 'Unknown' OR display_name = 'Group member' OR display_name LIKE '@%')" +
          ")" +
          ") AND (last_message_sender_name = 'Unknown' OR last_message_sender_name = 'Group member' OR last_message_sender_name LIKE '@%')"
      )
      .run(contact.displayName, contact.protocolId);

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

      CREATE TABLE IF NOT EXISTS contacts (
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

      CREATE INDEX IF NOT EXISTS idx_contacts_display_name ON contacts(display_name);
      CREATE INDEX IF NOT EXISTS idx_contacts_protocol_id ON contacts(protocol_id);

      CREATE TABLE IF NOT EXISTS conversations (
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

      CREATE INDEX IF NOT EXISTS idx_conversations_protocol_id ON conversations(protocol_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_unread_count ON conversations(unread_count);

      CREATE TABLE IF NOT EXISTS messages (
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

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_time ON messages(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);

      CREATE TABLE IF NOT EXISTS attachments (
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

      CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
    `);
    this.ensureColumn("conversations", "last_message_sender_name", "TEXT");
    this.ensureColumn("conversations", "last_message_is_self", "INTEGER");
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
