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

  it("backfills same-id placeholder sender names when a sparse contact becomes useful", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const aliceId = contactId("private", ["@alice"]);
    const sparseContact: ContactInput = {
      id: aliceId,
      protocolId: "@alice",
      kind: "private",
      displayName: "Group member"
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
        id: localMessageId([conversation.id, aliceId, "hello"]),
        conversationId: conversation.id,
        senderId: aliceId,
        senderName: "Group member",
        isSelf: false,
        content: "hello",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversation,
      true
    );

    store.upsertContact({
      ...sparseContact,
      displayName: "Alice",
      nickName: "Alice"
    });

    expect(store.listMessages(conversation.id)[0]?.senderName).toBe("Alice");
    expect(store.findConversationById(conversation.id)?.lastMessageSenderName).toBe("Alice");
    store.close();
  });

  it("does not backfill a conversation preview when the useful contact is not the latest sender", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const aliceId = contactId("private", ["@alice"]);
    const bobId = contactId("private", ["@bob"]);
    const aliceSparse: ContactInput = {
      id: aliceId,
      protocolId: "@alice",
      kind: "private",
      displayName: "Group member"
    };
    const bobSparse: ContactInput = {
      id: bobId,
      protocolId: "@bob",
      kind: "private",
      displayName: "Group member"
    };
    const group: ContactInput = {
      id: contactId("group", ["project"]),
      protocolId: "@@project",
      kind: "group",
      displayName: "Project"
    };
    const conversation = conversationFromContact(group);

    store.upsertContact(aliceSparse);
    store.upsertContact(bobSparse);
    store.saveMessage(
      {
        id: localMessageId([conversation.id, aliceId, "alice old"]),
        conversationId: conversation.id,
        senderId: aliceId,
        senderName: "Group member",
        isSelf: false,
        content: "alice old",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversation,
      true
    );
    store.saveMessage(
      {
        id: localMessageId([conversation.id, bobId, "bob latest"]),
        conversationId: conversation.id,
        senderId: bobId,
        senderName: "Group member",
        isSelf: false,
        content: "bob latest",
        type: "text",
        timestamp: 1_700_000_100_000
      },
      conversation,
      true
    );

    store.upsertContact({
      ...aliceSparse,
      displayName: "Alice",
      nickName: "Alice"
    });

    const messages = store.listMessages(conversation.id);
    expect(messages[0]?.senderName).toBe("Alice");
    expect(messages[1]?.senderName).toBe("Group member");
    expect(store.findConversationById(conversation.id)?.lastMessagePreview).toBe("bob latest");
    expect(store.findConversationById(conversation.id)?.lastMessageSenderName).toBe("Group member");
    store.close();
  });

  it("backfills group sender names from updated group member metadata", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const aliceId = contactId("private", ["@alice"]);
    const sparseContact: ContactInput = {
      id: aliceId,
      protocolId: "@alice",
      kind: "private",
      displayName: "Group member"
    };
    const group: ContactInput = {
      id: contactId("group", ["project"]),
      protocolId: "@@project",
      kind: "group",
      displayName: "Project"
    };
    const otherGroup: ContactInput = {
      id: contactId("group", ["other"]),
      protocolId: "@@other",
      kind: "group",
      displayName: "Other"
    };
    const conversation = conversationFromContact(group);
    const otherConversation = conversationFromContact(otherGroup);

    store.upsertContact(sparseContact);
    store.saveMessage(
      {
        id: localMessageId([conversation.id, aliceId, "project message"]),
        conversationId: conversation.id,
        senderId: aliceId,
        senderName: "Group member",
        isSelf: false,
        content: "project message",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversation,
      true
    );
    store.saveMessage(
      {
        id: localMessageId([otherConversation.id, aliceId, "other message"]),
        conversationId: otherConversation.id,
        senderId: aliceId,
        senderName: "Group member",
        isSelf: false,
        content: "other message",
        type: "text",
        timestamp: 1_700_000_100_000
      },
      otherConversation,
      true
    );

    store.upsertContact({
      ...group,
      raw: {
        UserName: "@@project",
        MemberList: [
          {
            UserName: "@alice",
            DisplayName: "Alice in Project",
            NickName: "Alice"
          }
        ]
      }
    });

    expect(store.listMessages(conversation.id)[0]?.senderName).toBe("Alice in Project");
    expect(store.findConversationById(conversation.id)?.lastMessageSenderName).toBe("Alice in Project");
    expect(store.listMessages(otherConversation.id)[0]?.senderName).toBe("Group member");
    expect(store.findConversationById(otherConversation.id)?.lastMessageSenderName).toBe("Group member");
    store.close();
  });

  it("preserves existing contact raw metadata when a later sparse upsert has no raw", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const group: ContactInput = {
      id: contactId("group", ["project"]),
      protocolId: "@@project",
      kind: "group",
      displayName: "Project",
      raw: {
        UserName: "@@project",
        MemberList: [
          {
            UserName: "@alice",
            DisplayName: "Alice"
          }
        ]
      }
    };

    store.upsertContact(group);
    const saved = store.upsertContact({
      ...group,
      raw: undefined
    });

    expect((saved.raw as { MemberList?: unknown[] } | undefined)?.MemberList).toHaveLength(1);
    store.close();
  });

  it("keeps a useful contact name when a later sparse update arrives for the same id", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const richContact: ContactInput = {
      id: contactId("private", ["@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "Alice",
      nickName: "Alice"
    };

    store.upsertContact(richContact);
    const saved = store.upsertContact({
      ...richContact,
      displayName: "Group member",
      nickName: undefined
    });

    expect(saved.displayName).toBe("Alice");
    expect(saved.nickName).toBe("Alice");
    expect(store.listContacts("private", 10).map((contact) => contact.displayName)).toEqual(["Alice"]);
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

  it("lazily merges stale private conversations into the current contact conversation", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const staleContact: ContactInput = {
      id: contactId("private", ["@old-one"]),
      protocolId: "@old-one",
      kind: "private",
      displayName: "Test Contact",
      remarkName: "Test Contact",
      nickName: "Alternate Name"
    };
    const currentContact: ContactInput = {
      ...staleContact,
      id: contactId("private", ["@new-one"]),
      protocolId: "@new-one"
    };
    const staleConversation = conversationFromContact(staleContact);

    store.upsertContact(staleContact);
    store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old"]),
        conversationId: staleConversation.id,
        senderId: staleContact.id,
        senderName: "Test Contact",
        isSelf: false,
        content: "old message",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );

    store.markAllContactsStale();
    const current = store.upsertContact(currentContact);
    const currentConversation = store.upsertConversation(conversationFromContact(currentContact));
    const merged = store.mergeStaleConversationForContact(current, currentConversation);

    expect(merged.id).toBe(currentConversation.id);
    expect(merged.protocolId).toBe("@new-one");
    expect(merged.lastMessagePreview).toBe("old message");
    expect(store.findConversationById(staleConversation.id)).toBeUndefined();
    expect(store.listRecentConversations().filter((conversation) => conversation.title === "Test Contact")).toHaveLength(1);
    expect(store.listMessages(staleConversation.id)).toHaveLength(0);
    const messages = store.listMessages(currentConversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.senderId).toBe(current.id);
    expect(store.totalUnreadCount()).toBe(1);
    store.close();
  });

  it("lazily merges stale group conversations into the current group conversation", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const staleGroup: ContactInput = {
      id: contactId("group", ["@@old-group"]),
      protocolId: "@@old-group",
      kind: "group",
      displayName: "Project Group",
      raw: { UserName: "@@old-group", MemberCount: 3 }
    };
    const currentGroup: ContactInput = {
      ...staleGroup,
      id: contactId("group", ["@@new-group"]),
      protocolId: "@@new-group",
      raw: { UserName: "@@new-group", MemberCount: 3 }
    };
    const sender: ContactInput = {
      id: contactId("private", ["@member"]),
      protocolId: "@member",
      kind: "private",
      displayName: "Member"
    };
    const staleConversation = conversationFromContact(staleGroup);

    store.upsertContact(staleGroup);
    store.upsertContact(sender);
    store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old group"]),
        conversationId: staleConversation.id,
        senderId: sender.id,
        senderName: "Member",
        isSelf: false,
        content: "old group message",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );

    store.markAllContactsStale();
    const current = store.upsertContact(currentGroup);
    const currentConversation = store.upsertConversation(conversationFromContact(currentGroup));
    const merged = store.mergeStaleConversationForContact(current, currentConversation);

    expect(merged.id).toBe(currentConversation.id);
    expect(merged.protocolId).toBe("@@new-group");
    expect(merged.lastMessagePreview).toBe("old group message");
    expect(store.findConversationById(staleConversation.id)).toBeUndefined();
    expect(store.listRecentConversations().filter((conversation) => conversation.title === "Project Group")).toHaveLength(1);
    expect(store.listMessages(staleConversation.id)).toHaveLength(0);
    const messages = store.listMessages(currentConversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.senderId).toBe(sender.id);
    expect(store.totalUnreadCount()).toBe(1);
    store.close();
  });

  it("does not merge stale group conversations when member counts differ", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const staleGroup: ContactInput = {
      id: contactId("group", ["@@old-count-group"]),
      protocolId: "@@old-count-group",
      kind: "group",
      displayName: "Counted Group",
      raw: { UserName: "@@old-count-group", MemberCount: 3 }
    };
    const currentGroup: ContactInput = {
      ...staleGroup,
      id: contactId("group", ["@@new-count-group"]),
      protocolId: "@@new-count-group",
      raw: { UserName: "@@new-count-group", MemberCount: 4 }
    };
    const staleConversation = conversationFromContact(staleGroup);
    const currentConversationInput = conversationFromContact(currentGroup);

    store.upsertContact(staleGroup);
    store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old counted group"]),
        conversationId: staleConversation.id,
        senderId: contactId("private", ["@count-member"]),
        senderName: "Count Member",
        isSelf: false,
        content: "old counted group",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );

    store.markAllContactsStale();
    const current = store.upsertContact(currentGroup);
    const currentConversation = store.upsertConversation(currentConversationInput);
    const merged = store.mergeStaleConversationForContact(current, currentConversation);

    expect(merged.id).toBe(currentConversation.id);
    expect(store.findConversationById(staleConversation.id)).toBeDefined();
    expect(store.listRecentConversations().filter((conversation) => conversation.title === "Counted Group")).toHaveLength(2);
    store.close();
  });

  it("folds stale private conversations in recent and unread lists", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const staleContact: ContactInput = {
      id: contactId("private", ["@old-folded"]),
      protocolId: "@old-folded",
      kind: "private",
      displayName: "Folded Friend",
      remarkName: "Folded Friend",
      nickName: "Folded"
    };
    const currentContact: ContactInput = {
      ...staleContact,
      id: contactId("private", ["@new-folded"]),
      protocolId: "@new-folded"
    };
    const staleConversation = conversationFromContact(staleContact);
    const currentConversation = conversationFromContact(currentContact);

    store.upsertContact(staleContact);
    store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old folded"]),
        conversationId: staleConversation.id,
        senderId: staleContact.id,
        senderName: "Folded Friend",
        isSelf: false,
        content: "old folded",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );
    store.markAllContactsStale();
    store.upsertContact(currentContact);
    store.saveMessage(
      {
        id: localMessageId([currentConversation.id, "new folded"]),
        conversationId: currentConversation.id,
        senderId: currentContact.id,
        senderName: "Folded Friend",
        isSelf: false,
        content: "new folded",
        type: "text",
        timestamp: 1_700_000_100_000
      },
      currentConversation,
      true
    );

    const recent = store.listRecentConversations().filter((conversation) => conversation.title === "Folded Friend");
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(currentConversation.id);
    expect(recent[0]?.unreadCount).toBe(2);
    expect(recent[0]?.lastMessagePreview).toBe("new folded");
    expect(store.listUnreadConversations().filter((conversation) => conversation.title === "Folded Friend")).toHaveLength(1);
    store.close();
  });

  it("folds stale group conversations in recent and unread lists", () => {
    const store = new SqliteStore(tempDb());
    store.setActiveAccount(accountA);
    const staleGroup: ContactInput = {
      id: contactId("group", ["@@old-folded-group"]),
      protocolId: "@@old-folded-group",
      kind: "group",
      displayName: "Folded Group",
      raw: { UserName: "@@old-folded-group", MemberCount: 4 }
    };
    const currentGroup: ContactInput = {
      ...staleGroup,
      id: contactId("group", ["@@new-folded-group"]),
      protocolId: "@@new-folded-group",
      raw: { UserName: "@@new-folded-group", MemberCount: 4 }
    };
    const staleConversation = conversationFromContact(staleGroup);
    const currentConversation = conversationFromContact(currentGroup);

    store.upsertContact(staleGroup);
    store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old group folded"]),
        conversationId: staleConversation.id,
        senderId: contactId("private", ["@old-member"]),
        senderName: "Old Member",
        isSelf: false,
        content: "old group folded",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );
    store.markAllContactsStale();
    store.upsertContact(currentGroup);
    store.saveMessage(
      {
        id: localMessageId([currentConversation.id, "new group folded"]),
        conversationId: currentConversation.id,
        senderId: contactId("private", ["@new-member"]),
        senderName: "New Member",
        isSelf: false,
        content: "new group folded",
        type: "text",
        timestamp: 1_700_000_100_000
      },
      currentConversation,
      true
    );

    const recent = store.listRecentConversations().filter((conversation) => conversation.title === "Folded Group");
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(currentConversation.id);
    expect(recent[0]?.unreadCount).toBe(2);
    expect(recent[0]?.lastMessagePreview).toBe("new group folded");
    expect(store.listUnreadConversations().filter((conversation) => conversation.title === "Folded Group")).toHaveLength(1);
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
