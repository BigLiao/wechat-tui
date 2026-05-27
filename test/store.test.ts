import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { contactId, conversationFromContact, localMessageId } from "../src/util/ids.js";
import type { ContactInput, UserProfile } from "../src/types.js";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "wechat-tui-store-"));
  tempDirs.push(dir);
  return join(dir, "db.sqlite");
}

const accountA: UserProfile = {
  id: contactId("self", ["account-a"]),
  protocolId: "@account-a",
  displayName: "Account A"
};

const accountB: UserProfile = {
  id: contactId("self", ["account-b"]),
  protocolId: "@account-b",
  displayName: "Account B"
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SqliteStore", () => {
  it("persists sessions, contacts, conversations, messages, unread counts, and search", () => {
    const dbPath = tempDb();
    const store = new SqliteStore(dbPath);
    store.setActiveAccount(accountA);
    store.setSessionData({ sid: "abc" });

    const contact: ContactInput = {
      id: contactId("private", ["boss"]),
      protocolId: "@boss",
      kind: "private",
      displayName: "Boss",
      remarkName: "Boss"
    };
    store.upsertContact(contact);
    const conversation = conversationFromContact(contact);
    const message = store.saveMessage(
      {
        id: localMessageId([conversation.id, "hello", "1"]),
        conversationId: conversation.id,
        senderId: contact.id,
        senderName: "Boss",
        isSelf: false,
        content: "hello from local cache",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversation,
      true
    );

    expect(message.content).toBe("hello from local cache");
    expect(store.totalUnreadCount()).toBe(1);
    expect(store.searchMessages("cache")).toHaveLength(1);
    expect(store.listRecentConversations()[0]?.title).toBe("Boss");
    store.close();

    const reopened = new SqliteStore(dbPath);
    reopened.setActiveAccount(accountA);
    expect(reopened.getSessionData()).toEqual({ sid: "abc" });
    expect(reopened.findContactByName("Boss")?.protocolId).toBe("@boss");
    expect(reopened.listMessages(conversation.id)).toHaveLength(1);
    reopened.markRead(conversation.id);
    expect(reopened.totalUnreadCount()).toBe(0);
    reopened.close();
  });

  it("backfills sender names when a richer contact for the same protocol id is synced later", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const sparseContact: ContactInput = {
      id: contactId("private", ["@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "@alice"
    };
    const group: ContactInput = {
      id: contactId("group", ["project"]),
      protocolId: "@@project",
      kind: "group",
      displayName: "Project"
    };
    const conversation = conversationFromContact(group);

    store.upsertContact(sparseContact);
    store.saveMessage(
      {
        id: localMessageId([conversation.id, sparseContact.id, "hello"]),
        conversationId: conversation.id,
        senderId: sparseContact.id,
        senderName: "@alice",
        isSelf: false,
        content: "hello",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversation,
      true
    );

    store.upsertContact({
      id: contactId("private", ["Alice", "@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "Alice",
      nickName: "Alice"
    });

    expect(store.listMessages(conversation.id)[0]?.senderName).toBe("Alice");
    store.close();
  });

  it("deduplicates protocol contacts and backfills placeholder conversation titles", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const sparseContact: ContactInput = {
      id: "contact:public:sparse",
      protocolId: "@public",
      kind: "public",
      displayName: "@public"
    };
    const richContact: ContactInput = {
      id: "contact:public:rich",
      protocolId: "@public",
      kind: "public",
      displayName: "Public Account",
      nickName: "Public Account"
    };
    const sparseConversation = conversationFromContact(sparseContact);
    const richConversation = conversationFromContact(richContact);

    store.upsertContact(sparseContact);
    store.saveMessage(
      {
        id: localMessageId([sparseConversation.id, "first"]),
        conversationId: sparseConversation.id,
        senderId: sparseContact.id,
        senderName: "@public",
        isSelf: false,
        content: "first message",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      sparseConversation,
      true
    );
    store.upsertContact(richContact);
    store.upsertConversation(richConversation);

    const contacts = store.listContacts("public", 10);
    expect(contacts.map((contact) => contact.displayName)).toEqual(["Public Account"]);
    const conversations = store.listRecentConversations(10);
    expect(conversations.map((conversation) => conversation.protocolId)).toEqual(["@public"]);
    expect(conversations[0]?.title).toBe("Public Account");
    expect(store.listMessages(sparseConversation.id)[0]?.senderName).toBe("Public Account");
    expect(store.totalUnreadCount()).toBe(0);
    expect(store.listUnreadConversations()).toHaveLength(0);
    store.close();
  });

  it("isolates contacts, conversations, messages, and unread counts by active account", () => {
    const store = new SqliteStore(tempDb());
    const baseContactId = contactId("private", ["shared-contact"]);
    const contactA: ContactInput = {
      id: `${accountA.id}:${baseContactId}`,
      protocolId: "@shared-contact",
      kind: "private",
      displayName: "Shared Name"
    };
    const contactB: ContactInput = {
      ...contactA,
      id: `${accountB.id}:${baseContactId}`,
      displayName: "Shared Name B"
    };
    const conversationA = conversationFromContact(contactA);
    const conversationB = conversationFromContact(contactB);

    store.setActiveAccount(accountA);
    store.upsertContact(contactA);
    store.saveMessage(
      {
        id: localMessageId([accountA.id, conversationA.id, "account-a-message"]),
        conversationId: conversationA.id,
        senderId: contactA.id,
        senderName: "Shared Name",
        isSelf: false,
        content: "only account a",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversationA,
      true
    );

    store.setActiveAccount(accountB);
    expect(store.findContactByName("Shared Name")).toBeUndefined();
    expect(store.listRecentConversations()).toHaveLength(0);
    expect(store.searchMessages("account a")).toHaveLength(0);
    expect(store.totalUnreadCount()).toBe(0);

    store.upsertContact(contactB);
    store.saveMessage(
      {
        id: localMessageId([accountB.id, conversationB.id, "account-b-message"]),
        conversationId: conversationB.id,
        senderId: contactB.id,
        senderName: "Shared Name B",
        isSelf: false,
        content: "only account b",
        type: "text",
        timestamp: 1_700_000_100_000
      },
      conversationB,
      true
    );

    expect(store.findContactByName("Shared Name B")?.displayName).toBe("Shared Name B");
    expect(store.searchMessages("account b")).toHaveLength(1);
    expect(store.searchMessages("account a")).toHaveLength(0);
    expect(store.totalUnreadCount()).toBe(1);

    store.setActiveAccount(accountA);
    expect(store.findContactByName("Shared Name")?.displayName).toBe("Shared Name");
    expect(store.searchMessages("account a")).toHaveLength(1);
    expect(store.searchMessages("account b")).toHaveLength(0);
    expect(store.totalUnreadCount()).toBe(1);
    store.close();
  });
});
