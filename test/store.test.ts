import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { contactId, conversationFromContact, localMessageId } from "../src/util/ids.js";
import type { ContactInput } from "../src/types.js";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "wechat-tui-store-"));
  tempDirs.push(dir);
  return join(dir, "db.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SqliteStore", () => {
  it("persists sessions, contacts, conversations, messages, unread counts, and search", () => {
    const dbPath = tempDb();
    const store = new SqliteStore(dbPath);
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
    expect(reopened.getSessionData()).toEqual({ sid: "abc" });
    expect(reopened.findContactByName("Boss")?.protocolId).toBe("@boss");
    expect(reopened.listMessages(conversation.id)).toHaveLength(1);
    reopened.markRead(conversation.id);
    expect(reopened.totalUnreadCount()).toBe(0);
    reopened.close();
  });

  it("backfills sender names when a richer contact for the same protocol id is synced later", () => {
    const store = new SqliteStore(tempDb());
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
});
