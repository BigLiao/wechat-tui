import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { contactId, conversationFromContact, groupMemberId, localMessageId } from "../src/util/ids.js";
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
  it("persists sessions, contacts, conversations, messages, unread counts, and search", async () => {
    const dbPath = tempDb();
    const store = await SqliteStore.open(dbPath);
    await store.setActiveAccount(accountA);
    await store.setSessionData({ sid: "abc" });

    const contact: ContactInput = {
      id: contactId("private", ["boss"]),
      protocolId: "@boss",
      kind: "private",
      displayName: "Boss",
      remarkName: "Boss"
    };
    await store.upsertContact(contact);
    const conversation = conversationFromContact(contact);
    const message = await store.saveMessage(
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
    expect(await store.totalUnreadCount()).toBe(1);
    expect(await store.searchMessages("cache")).toHaveLength(1);
    expect((await store.listRecentConversations())[0]?.title).toBe("Boss");
    await store.close();

    const reopened = await SqliteStore.open(dbPath);
    await reopened.setActiveAccount(accountA);
    expect(await reopened.getSessionData()).toEqual({ sid: "abc" });
    expect((await reopened.findContactByName("Boss"))?.protocolId).toBe("@boss");
    expect(await reopened.listMessages(conversation.id)).toHaveLength(1);
    await reopened.markRead(conversation.id);
    expect(await reopened.totalUnreadCount()).toBe(0);
    await reopened.close();
  });

  it("serializes concurrent transactional message writes", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
    const boss: ContactInput = {
      id: contactId("private", ["concurrent-boss"]),
      protocolId: "@concurrent-boss",
      kind: "private",
      displayName: "Concurrent Boss"
    };
    const teammate: ContactInput = {
      id: contactId("private", ["concurrent-teammate"]),
      protocolId: "@concurrent-teammate",
      kind: "private",
      displayName: "Concurrent Teammate"
    };
    const bossConversation = conversationFromContact(boss);
    const teammateConversation = conversationFromContact(teammate);

    await Promise.all([
      store.saveMessage(
        {
          id: localMessageId([bossConversation.id, "concurrent-one"]),
          conversationId: bossConversation.id,
          senderId: boss.id,
          senderName: "Concurrent Boss",
          isSelf: false,
          content: "first concurrent message",
          type: "text",
          timestamp: 1_700_000_000_000
        },
        bossConversation,
        true
      ),
      store.saveMessage(
        {
          id: localMessageId([teammateConversation.id, "concurrent-two"]),
          conversationId: teammateConversation.id,
          senderId: teammate.id,
          senderName: "Concurrent Teammate",
          isSelf: false,
          content: "second concurrent message",
          type: "text",
          timestamp: 1_700_000_100_000
        },
        teammateConversation,
        true
      )
    ]);

    expect(await store.totalUnreadCount()).toBe(2);
    expect(await store.listMessages(bossConversation.id)).toHaveLength(1);
    expect(await store.listMessages(teammateConversation.id)).toHaveLength(1);
    expect((await store.listRecentConversations(2)).map((conversation) => conversation.id)).toEqual([
      teammateConversation.id,
      bossConversation.id
    ]);
    await store.close();
  });

  it("marks all unread conversations read for the active account", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
    const boss: ContactInput = {
      id: contactId("private", ["read-all-boss"]),
      protocolId: "@read-all-boss",
      kind: "private",
      displayName: "Read All Boss"
    };
    const teammate: ContactInput = {
      id: contactId("private", ["read-all-teammate"]),
      protocolId: "@read-all-teammate",
      kind: "private",
      displayName: "Read All Teammate"
    };
    const bossConversation = conversationFromContact(boss);
    const teammateConversation = conversationFromContact(teammate);

    await store.saveMessage(
      {
        id: localMessageId([bossConversation.id, "unread one"]),
        conversationId: bossConversation.id,
        senderId: boss.id,
        senderName: "Read All Boss",
        isSelf: false,
        content: "unread one",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      bossConversation,
      true
    );
    await store.saveMessage(
      {
        id: localMessageId([teammateConversation.id, "unread two"]),
        conversationId: teammateConversation.id,
        senderId: teammate.id,
        senderName: "Read All Teammate",
        isSelf: false,
        content: "unread two",
        type: "text",
        timestamp: 1_700_000_100_000
      },
      teammateConversation,
      true
    );

    await store.setActiveAccount(accountB);
    const otherConversation = conversationFromContact({
      id: contactId("private", ["read-all-other"]),
      protocolId: "@read-all-other",
      kind: "private",
      displayName: "Read All Other"
    });
    await store.saveMessage(
      {
        id: localMessageId([otherConversation.id, "other unread"]),
        conversationId: otherConversation.id,
        senderName: "Read All Other",
        isSelf: false,
        content: "other unread",
        type: "text",
        timestamp: 1_700_000_200_000
      },
      otherConversation,
      true
    );

    await store.setActiveAccount(accountA);
    expect(await store.totalUnreadCount()).toBe(2);
    await store.markAllRead();
    expect(await store.totalUnreadCount()).toBe(0);
    expect(await store.listUnreadConversations()).toHaveLength(0);

    await store.setActiveAccount(accountB);
    expect(await store.totalUnreadCount()).toBe(1);
    await store.close();
  });

  it("backfills sender names when a richer contact for the same protocol id is synced later", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(sparseContact);
    await store.saveMessage(
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

    await store.upsertContact({
      id: contactId("private", ["Alice", "@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "Alice",
      nickName: "Alice"
    });

    expect((await store.listMessages(conversation.id))[0]?.senderName).toBe("Alice");
    await store.close();
  });

  it("backfills and preserves useful group conversation titles over protocol placeholders", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
    const sparseGroup: ContactInput = {
      id: contactId("group", ["@@project"]),
      protocolId: "@@project",
      kind: "group",
      displayName: "@@project"
    };
    const sparseConversation = conversationFromContact(sparseGroup);

    await store.saveMessage(
      {
        id: localMessageId([sparseConversation.id, "first"]),
        conversationId: sparseConversation.id,
        senderName: "Group member",
        isSelf: false,
        content: "first sparse message",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      sparseConversation,
      true
    );
    expect((await store.findConversationById(sparseConversation.id))?.title).toBe("@@project");

    await store.upsertContact({
      ...sparseGroup,
      displayName: "Project Group",
      nickName: "Project Group"
    });
    expect((await store.findConversationById(sparseConversation.id))?.title).toBe("Project Group");

    await store.saveMessage(
      {
        id: localMessageId([sparseConversation.id, "second"]),
        conversationId: sparseConversation.id,
        senderName: "Group member",
        isSelf: false,
        content: "second sparse message",
        type: "text",
        timestamp: 1_700_000_100_000
      },
      sparseConversation,
      true
    );

    expect((await store.findConversationById(sparseConversation.id))?.title).toBe("Project Group");
    await store.close();
  });

  it("backfills same-id placeholder sender names when a sparse contact becomes useful", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(sparseContact);
    await store.saveMessage(
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

    await store.upsertContact({
      ...sparseContact,
      displayName: "Alice",
      nickName: "Alice"
    });

    expect((await store.listMessages(conversation.id))[0]?.senderName).toBe("Alice");
    expect((await store.findConversationById(conversation.id))?.lastMessageSenderName).toBe("Alice");
    await store.close();
  });

  it("does not backfill a conversation preview when the useful contact is not the latest sender", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(aliceSparse);
    await store.upsertContact(bobSparse);
    await store.saveMessage(
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
    await store.saveMessage(
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

    await store.upsertContact({
      ...aliceSparse,
      displayName: "Alice",
      nickName: "Alice"
    });

    const messages = await store.listMessages(conversation.id);
    expect(messages[0]?.senderName).toBe("Alice");
    expect(messages[1]?.senderName).toBe("Group member");
    expect((await store.findConversationById(conversation.id))?.lastMessagePreview).toBe("bob latest");
    expect((await store.findConversationById(conversation.id))?.lastMessageSenderName).toBe("Group member");
    await store.close();
  });

  it("backfills group sender names from updated group member metadata", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(sparseContact);
    await store.saveMessage(
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
    await store.saveMessage(
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

    await store.upsertContact({
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

    expect((await store.listMessages(conversation.id))[0]?.senderName).toBe("Alice in Project");
    expect((await store.findConversationById(conversation.id))?.lastMessageSenderName).toBe("Alice in Project");
    expect((await store.listMessages(otherConversation.id))[0]?.senderName).toBe("Group member");
    expect((await store.findConversationById(otherConversation.id))?.lastMessageSenderName).toBe("Group member");
    await store.close();
  });

  it("migrates legacy group member contacts into group message senders", async () => {
    const dbPath = tempDb();
    const store = await SqliteStore.open(dbPath);
    await store.setActiveAccount(accountA);
    const leakedMember: ContactInput = {
      id: contactId("private", ["@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "Group member"
    };
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
            DisplayName: "Alice in Project",
            NickName: "Alice"
          }
        ]
      }
    };
    const conversation = conversationFromContact(group);

    await store.upsertContact(leakedMember);
    await store.upsertContact(group);
    await store.saveMessage(
      {
        id: localMessageId([conversation.id, leakedMember.id, "legacy hello"]),
        conversationId: conversation.id,
        senderId: leakedMember.id,
        senderName: "Group member",
        isSelf: false,
        content: "legacy hello",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversation,
      true
    );
    await store.close();

    const reopened = await SqliteStore.open(dbPath);
    await reopened.setActiveAccount(accountA);
    const message = (await reopened.listMessages(conversation.id))[0];
    expect(message?.senderId).toBe(groupMemberId(conversation.id, "@alice"));
    expect(message?.senderKind).toBe("group-member");
    expect(message?.senderProtocolId).toBe("@alice");
    expect(message?.senderName).toBe("Alice in Project");
    expect((await reopened.findConversationById(conversation.id))?.lastMessageSenderName).toBe("Alice in Project");
    expect(await reopened.searchContacts("Group member")).toHaveLength(0);
    await reopened.close();
  });

  it("uses hidden private contact names as fallback group member names", async () => {
    const dbPath = tempDb();
    const store = await SqliteStore.open(dbPath);
    await store.setActiveAccount(accountA);
    const leakedMember: ContactInput = {
      id: contactId("private", ["@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "Alice Contact",
      nickName: "Group member"
    };
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
            DisplayName: "",
            NickName: ""
          }
        ]
      }
    };
    const conversation = conversationFromContact(group);

    await store.upsertContact(leakedMember);
    await store.upsertContact(group);
    await store.markAllContactsStale();
    await store.saveMessage(
      {
        id: localMessageId([conversation.id, leakedMember.id, "legacy unnamed"]),
        conversationId: conversation.id,
        senderId: leakedMember.id,
        senderName: "Group member",
        isSelf: false,
        content: "legacy unnamed",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversation,
      true
    );
    await store.close();

    const reopened = await SqliteStore.open(dbPath);
    await reopened.setActiveAccount(accountA);
    const message = (await reopened.listMessages(conversation.id))[0];
    expect(message?.senderId).toBe(groupMemberId(conversation.id, "@alice"));
    expect(message?.senderKind).toBe("group-member");
    expect(message?.senderProtocolId).toBe("@alice");
    expect(message?.senderName).toBe("Alice Contact");
    expect((await reopened.findConversationById(conversation.id))?.lastMessageSenderName).toBe("Alice Contact");
    expect(await reopened.searchContacts("Alice Contact")).toHaveLength(0);
    await reopened.close();
  });

  it("enriches sparse group member upserts from hidden private contact names", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
    const leakedMember: ContactInput = {
      id: contactId("private", ["@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "Alice Contact",
      nickName: "Group member"
    };
    const group: ContactInput = {
      id: contactId("group", ["project"]),
      protocolId: "@@project",
      kind: "group",
      displayName: "Project"
    };
    const conversation = conversationFromContact(group);

    await store.upsertContact(leakedMember);
    await store.markAllContactsStale();
    const member = await store.upsertGroupMember({
      id: groupMemberId(conversation.id, "@alice"),
      groupId: conversation.id,
      groupProtocolId: group.protocolId,
      memberProtocolId: "@alice",
      displayName: "Group member"
    });

    expect(member.displayName).toBe("Alice Contact");
    expect(await store.searchContacts("Alice Contact")).toHaveLength(0);
    await store.close();
  });

  it("replaces hidden contact fallback group member names with richer group metadata", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
    const leakedMember: ContactInput = {
      id: contactId("private", ["@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "Alice Contact",
      nickName: "Group member"
    };
    const group: ContactInput = {
      id: contactId("group", ["project"]),
      protocolId: "@@project",
      kind: "group",
      displayName: "Project"
    };
    const conversation = conversationFromContact(group);

    await store.upsertContact(leakedMember);
    await store.markAllContactsStale();
    const fallbackMember = await store.upsertGroupMember({
      id: groupMemberId(conversation.id, "@alice"),
      groupId: conversation.id,
      groupProtocolId: group.protocolId,
      memberProtocolId: "@alice",
      displayName: "Group member"
    });
    await store.saveMessage(
      {
        id: localMessageId([conversation.id, "@alice", "fallback name"]),
        conversationId: conversation.id,
        senderId: fallbackMember.id,
        senderKind: "group-member",
        senderProtocolId: "@alice",
        senderName: fallbackMember.displayName,
        isSelf: false,
        content: "fallback name",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      conversation,
      true
    );

    await store.upsertGroupMember({
      id: groupMemberId(conversation.id, "@alice"),
      groupId: conversation.id,
      groupProtocolId: group.protocolId,
      memberProtocolId: "@alice",
      displayName: "Alice in Project"
    });

    expect((await store.listMessages(conversation.id))[0]?.senderName).toBe("Alice in Project");
    expect((await store.findConversationById(conversation.id))?.lastMessageSenderName).toBe("Alice in Project");
    await store.close();
  });

  it("preserves existing contact raw metadata when a later sparse upsert has no raw", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(group);
    const saved = await store.upsertContact({
      ...group,
      raw: undefined
    });

    expect((saved.raw as { MemberList?: unknown[] } | undefined)?.MemberList).toHaveLength(1);
    await store.close();
  });

  it("keeps a useful contact name when a later sparse update arrives for the same id", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
    const richContact: ContactInput = {
      id: contactId("private", ["@alice"]),
      protocolId: "@alice",
      kind: "private",
      displayName: "Alice",
      nickName: "Alice"
    };

    await store.upsertContact(richContact);
    const saved = await store.upsertContact({
      ...richContact,
      displayName: "Group member",
      nickName: undefined
    });

    expect(saved.displayName).toBe("Alice");
    expect(saved.nickName).toBe("Alice");
    expect((await store.listContacts("private", 10)).map((contact) => contact.displayName)).toEqual(["Alice"]);
    await store.close();
  });

  it("deduplicates protocol contacts and backfills placeholder conversation titles", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(sparseContact);
    await store.saveMessage(
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
    await store.upsertContact(richContact);
    await store.upsertConversation(richConversation);

    const contacts = await store.listContacts("public", 10);
    expect(contacts.map((contact) => contact.displayName)).toEqual(["Public Account"]);
    const conversations = await store.listRecentConversations(10);
    expect(conversations.map((conversation) => conversation.protocolId)).toEqual(["@public"]);
    expect(conversations[0]?.title).toBe("Public Account");
    expect((await store.listMessages(sparseConversation.id))[0]?.senderName).toBe("Public Account");
    expect(await store.totalUnreadCount()).toBe(0);
    expect(await store.listUnreadConversations()).toHaveLength(0);
    await store.close();
  });

  it("lazily merges stale private conversations into the current contact conversation", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(staleContact);
    await store.saveMessage(
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

    await store.markAllContactsStale();
    const current = await store.upsertContact(currentContact);
    const currentConversation = await store.upsertConversation(conversationFromContact(currentContact));
    const merged = await store.mergeStaleConversationForContact(current, currentConversation);

    expect(merged.id).toBe(currentConversation.id);
    expect(merged.protocolId).toBe("@new-one");
    expect(merged.lastMessagePreview).toBe("old message");
    expect(await store.findConversationById(staleConversation.id)).toBeUndefined();
    expect((await store.listRecentConversations()).filter((conversation) => conversation.title === "Test Contact")).toHaveLength(1);
    expect(await store.listMessages(staleConversation.id)).toHaveLength(0);
    const messages = await store.listMessages(currentConversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.senderId).toBe(current.id);
    expect(await store.totalUnreadCount()).toBe(1);
    await store.close();
  });

  it("lazily merges stale group conversations into the current group conversation", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(staleGroup);
    await store.upsertContact(sender);
    await store.saveMessage(
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

    await store.markAllContactsStale();
    const current = await store.upsertContact(currentGroup);
    const currentConversation = await store.upsertConversation(conversationFromContact(currentGroup));
    const merged = await store.mergeStaleConversationForContact(current, currentConversation);

    expect(merged.id).toBe(currentConversation.id);
    expect(merged.protocolId).toBe("@@new-group");
    expect(merged.lastMessagePreview).toBe("old group message");
    expect(await store.findConversationById(staleConversation.id)).toBeUndefined();
    expect((await store.listRecentConversations()).filter((conversation) => conversation.title === "Project Group")).toHaveLength(1);
    expect(await store.listMessages(staleConversation.id)).toHaveLength(0);
    const messages = await store.listMessages(currentConversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.senderId).toBe(sender.id);
    expect(await store.totalUnreadCount()).toBe(1);
    await store.close();
  });

  it("does not merge stale group conversations when member counts differ", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(staleGroup);
    await store.saveMessage(
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

    await store.markAllContactsStale();
    const current = await store.upsertContact(currentGroup);
    const currentConversation = await store.upsertConversation(currentConversationInput);
    const merged = await store.mergeStaleConversationForContact(current, currentConversation);

    expect(merged.id).toBe(currentConversation.id);
    expect(await store.findConversationById(staleConversation.id)).toBeDefined();
    expect((await store.listRecentConversations()).filter((conversation) => conversation.title === "Counted Group")).toHaveLength(2);
    await store.close();
  });

  it("folds stale private conversations in recent and unread lists", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(staleContact);
    await store.saveMessage(
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
    await store.markAllContactsStale();
    await store.upsertContact(currentContact);
    await store.saveMessage(
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

    const recent = (await store.listRecentConversations()).filter((conversation) => conversation.title === "Folded Friend");
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(currentConversation.id);
    expect(recent[0]?.unreadCount).toBe(2);
    expect(recent[0]?.lastMessagePreview).toBe("new folded");
    expect((await store.listUnreadConversations()).filter((conversation) => conversation.title === "Folded Friend")).toHaveLength(1);
    await store.close();
  });

  it("folds stale group conversations in recent and unread lists", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setActiveAccount(accountA);
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

    await store.upsertContact(staleGroup);
    await store.saveMessage(
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
    await store.markAllContactsStale();
    await store.upsertContact(currentGroup);
    await store.saveMessage(
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

    const recent = (await store.listRecentConversations()).filter((conversation) => conversation.title === "Folded Group");
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(currentConversation.id);
    expect(recent[0]?.unreadCount).toBe(2);
    expect(recent[0]?.lastMessagePreview).toBe("new group folded");
    expect((await store.listUnreadConversations()).filter((conversation) => conversation.title === "Folded Group")).toHaveLength(1);
    await store.close();
  });

  it("isolates contacts, conversations, messages, and unread counts by active account", async () => {
    const store = await SqliteStore.open(tempDb());
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

    await store.setActiveAccount(accountA);
    await store.upsertContact(contactA);
    await store.saveMessage(
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

    await store.setActiveAccount(accountB);
    expect(await store.findContactByName("Shared Name")).toBeUndefined();
    expect(await store.listRecentConversations()).toHaveLength(0);
    expect(await store.searchMessages("account a")).toHaveLength(0);
    expect(await store.totalUnreadCount()).toBe(0);

    await store.upsertContact(contactB);
    await store.saveMessage(
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

    expect((await store.findContactByName("Shared Name B"))?.displayName).toBe("Shared Name B");
    expect(await store.searchMessages("account b")).toHaveLength(1);
    expect(await store.searchMessages("account a")).toHaveLength(0);
    expect(await store.totalUnreadCount()).toBe(1);

    await store.setActiveAccount(accountA);
    expect((await store.findContactByName("Shared Name"))?.displayName).toBe("Shared Name");
    expect(await store.searchMessages("account a")).toHaveLength(1);
    expect(await store.searchMessages("account b")).toHaveLength(0);
    expect(await store.totalUnreadCount()).toBe(1);
    await store.close();
  });
});
