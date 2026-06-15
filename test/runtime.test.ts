import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MockProtocol } from "../src/protocol/mock-protocol.js";
import { WeChatRuntime } from "../src/runtime.js";
import { SqliteStore } from "../src/store/sqlite-store.js";
import type { ConnectionState, ContactInput, ProtocolQrEvent, UserProfile, WeChatProtocol } from "../src/types.js";
import { contactId, conversationFromContact, localMessageId } from "../src/util/ids.js";
import { FakeRenderer, key } from "./helpers.js";

const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "wechat-tui-runtime-"));
  tempDirs.push(dir);
  return join(dir, "db.sqlite");
}

async function pressText(runtime: WeChatRuntime, value: string): Promise<void> {
  for (const char of value) {
    await runtime.handleKey(key.text(char));
  }
}

async function flushRender(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

class ContactsBeforeLoginProtocol extends EventEmitter implements WeChatProtocol {
  startedWithSessionData: unknown;

  private readonly self: ContactInput = {
    id: contactId("self", ["early-self"]),
    protocolId: "@early-self",
    kind: "self",
    displayName: "Early User",
    isSelf: true
  };

  private readonly contacts: ContactInput[] = [
    this.self,
    {
      id: contactId("private", ["early-boss"]),
      protocolId: "@early-boss",
      kind: "private",
      displayName: "Early Boss"
    }
  ];

  async start(sessionData?: unknown): Promise<void> {
    this.startedWithSessionData = sessionData;
    this.emit("state", "syncing" satisfies ConnectionState);
    this.emit("contacts", this.contacts);
    this.emit("state", "online" satisfies ConnectionState);
    this.emit("login", this.getCurrentUser());
  }

  async reconnect(): Promise<void> {}

  async logout(): Promise<void> {
    this.emit("logout");
  }

  async sendText(): Promise<{ messageId?: string; raw?: unknown }> {
    return {};
  }

  async sendFile(): Promise<{ messageId?: string; raw?: unknown }> {
    return {};
  }

  async downloadMedia(): Promise<undefined> {
    return undefined;
  }

  async getContacts(): Promise<ContactInput[]> {
    return this.contacts;
  }

  getCurrentUser(): UserProfile {
    return {
      id: this.self.id,
      protocolId: this.self.protocolId,
      displayName: this.self.displayName
    };
  }

  getSessionData(): unknown | undefined {
    return undefined;
  }
}

class LoginThenLogoutProtocol extends EventEmitter implements WeChatProtocol {
  private readonly self: UserProfile = {
    id: contactId("self", ["race-user"]),
    protocolId: "@race-user",
    displayName: "Race User"
  };

  async start(): Promise<void> {
    this.emit("state", "online" satisfies ConnectionState);
    this.emit("login", this.self);
    this.emit("logout");
  }

  async reconnect(): Promise<void> {}

  async logout(): Promise<void> {
    this.emit("logout");
  }

  async sendText(): Promise<{ messageId?: string; raw?: unknown }> {
    return {};
  }

  async sendFile(): Promise<{ messageId?: string; raw?: unknown }> {
    return {};
  }

  async downloadMedia(): Promise<undefined> {
    return undefined;
  }

  async getContacts(): Promise<ContactInput[]> {
    return [];
  }

  getCurrentUser(): UserProfile {
    return this.self;
  }

  getSessionData(): unknown | undefined {
    return undefined;
  }
}

class QrOnlyProtocol extends EventEmitter implements WeChatProtocol {
  async start(): Promise<void> {
    this.emit("state", "waiting_scan" satisfies ConnectionState);
    this.emit("qr", {
      uuid: "qr-only",
      loginUrl: "mock://login",
      qrUrl: "mock://qrcode"
    } satisfies ProtocolQrEvent);
  }

  async reconnect(): Promise<void> {}

  async logout(): Promise<void> {
    this.emit("logout");
  }

  async sendText(): Promise<{ messageId?: string; raw?: unknown }> {
    return {};
  }

  async sendFile(): Promise<{ messageId?: string; raw?: unknown }> {
    return {};
  }

  async downloadMedia(): Promise<undefined> {
    return undefined;
  }

  async getContacts(): Promise<ContactInput[]> {
    return [];
  }

  getCurrentUser(): UserProfile | undefined {
    return undefined;
  }

  getSessionData(): unknown | undefined {
    return undefined;
  }
}

class PublicConversationProtocol extends EventEmitter implements WeChatProtocol {
  private readonly self: ContactInput = {
    id: contactId("self", ["public-fold-self"]),
    protocolId: "@public-fold-self",
    kind: "self",
    displayName: "Public Fold User",
    isSelf: true
  };

  async start(): Promise<void> {
    this.emit("state", "online" satisfies ConnectionState);
    this.emit("login", this.getCurrentUser());
  }

  async reconnect(): Promise<void> {}

  async logout(): Promise<void> {
    this.emit("logout");
  }

  async sendText(): Promise<{ messageId?: string; raw?: unknown }> {
    return {};
  }

  async sendFile(): Promise<{ messageId?: string; raw?: unknown }> {
    return {};
  }

  async downloadMedia(): Promise<undefined> {
    return undefined;
  }

  async getContacts(): Promise<ContactInput[]> {
    return [this.self];
  }

  getCurrentUser(): UserProfile {
    return {
      id: this.self.id,
      protocolId: this.self.protocolId,
      displayName: this.self.displayName
    };
  }

  getSessionData(): unknown | undefined {
    return undefined;
  }

  emitPublicMessage(displayName: string, content: string, timestamp: number): void {
    const contact: ContactInput = {
      id: contactId("public", [displayName]),
      protocolId: `@public-${displayName}`,
      kind: "public",
      displayName
    };
    this.emit("message", {
      id: localMessageId([contact.id, content, String(timestamp)]),
      conversation: conversationFromContact(contact),
      sender: contact,
      isSelf: false,
      content,
      type: "notice",
      timestamp
    });
  }
}

class CapturingFileProtocol extends MockProtocol {
  readonly sentFiles: Array<{ toProtocolId: string; filePath: string }> = [];

  override async sendFile(toProtocolId: string, filePath: string): Promise<{ messageId?: string; raw?: unknown }> {
    this.sentFiles.push({ toProtocolId, filePath });
    return super.sendFile(toProtocolId, filePath);
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WeChatRuntime", () => {
  it("shows the QR login screen without the startup splash when no saved session exists", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new QrOnlyProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();

    expect(renderer.states.some((state) => state.view === "startup")).toBe(false);
    expect(renderer.latest.view).toBe("login");
    expect(renderer.latest.qr?.uuid).toBe("qr-only");
    await store.close();
  });

  it("shows the startup splash only after a saved session restores login", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setSessionData({ restored: true });
    const protocol = new ContactsBeforeLoginProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, {
      initialHistoryLimit: 10,
      minimumStartupMs: 0
    });

    await runtime.start();

    expect(protocol.startedWithSessionData).toEqual({ restored: true });
    expect(renderer.states.some((state) => state.view === "startup")).toBe(true);
    expect(renderer.latest.view).toBe("chats");
    expect(renderer.latest.accountName).toBe("Early User");
    await store.close();
  });

  it("keeps the saved-session startup splash visible for the configured minimum", async () => {
    const store = await SqliteStore.open(tempDb());
    await store.setSessionData({ restored: true });
    const protocol = new ContactsBeforeLoginProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, {
      initialHistoryLimit: 10,
      minimumStartupMs: 50
    });
    let settled = false;
    const startedAt = Date.now();

    const startPromise = runtime.start().then(() => {
      settled = true;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    expect(renderer.latest.view).toBe("startup");

    await startPromise;

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(45);
    expect(settled).toBe(true);
    expect(renderer.latest.view).toBe("chats");
    await store.close();
  });

  it("handles contacts that arrive before the login event during session restart", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new ContactsBeforeLoginProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();

    expect(renderer.latest.view).toBe("chats");
    expect(renderer.latest.accountName).toBe("Early User");
    expect(await store.searchContacts("Early Boss")).toHaveLength(1);
    await store.close();
  });

  it("serializes logout after a pending login event", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new LoginThenLogoutProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();

    expect(renderer.latest.connectionState).toBe("logout");
    expect(renderer.latest.accountName).toBeUndefined();
    expect(renderer.latest.statusMessage).toBe("logged out. Use q to quit.");
    await store.close();
  });

  it("folds public account conversations in the recent chat list", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new PublicConversationProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    protocol.emitPublicMessage("City Guide", "article one", 1_700_000_000_000);
    await flushRender();

    expect(renderer.latest.conversations).toHaveLength(1);
    expect(renderer.latest.conversations[0]?.title).toBe("公众号");
    expect(renderer.latest.conversations[0]?.unreadCount).toBe(0);

    protocol.emitPublicMessage("City Services", "article two", 1_700_000_100_000);
    await flushRender();

    expect(renderer.latest.conversations).toHaveLength(1);
    expect(renderer.latest.conversations[0]?.title).toBe("公众号");
    expect(renderer.latest.conversations[0]?.unreadCount).toBe(0);
    expect(renderer.latest.conversations[0]?.lastMessageSenderName).toBe("City Services");
    expect(renderer.latest.totalUnreadCount).toBe(0);
    expect(renderer.latest.unreadConversations).toHaveLength(0);
    expect(renderer.latest.statusMessage).not.toContain("new message");

    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.title).toBe("City Services");
    await store.close();
  });

  it("renders an update notification when a newer package version is available", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, {
      initialHistoryLimit: 10,
      updateCheck: async () => ({
        packageName: "wechat-tui",
        currentVersion: "0.1.1",
        latestVersion: "0.1.2",
        installCommand: "npm install -g wechat-tui@latest"
      })
    });

    await runtime.start();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(renderer.latest.updateInfo?.latestVersion).toBe("0.1.2");
    await store.close();
  });

  it("skips duplicate incoming messages before refreshing runtime state", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    protocol.emitIncoming("Boss", "same message", 1_700_000_000_000);
    await flushRender();
    const renderCountAfterFirstMessage = renderer.states.length;
    const unreadAfterFirstMessage = await store.totalUnreadCount();

    protocol.emitIncoming("Boss", "same message", 1_700_000_000_000);
    await flushRender();

    expect(renderer.states).toHaveLength(renderCountAfterFirstMessage);
    expect(await store.totalUnreadCount()).toBe(unreadAfterFirstMessage);
    expect(await store.listRecentConversations()).toHaveLength(1);
    await store.close();
  });

  it("coalesces renders for incoming message bursts", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    const renderCountBeforeMessages = renderer.states.length;

    protocol.emitIncoming("Boss", "burst one", 1_700_000_000_000);
    protocol.emitIncoming("Project A", "burst two", 1_700_000_100_000);

    expect(renderer.states).toHaveLength(renderCountBeforeMessages);
    await flushRender();
    expect(renderer.states).toHaveLength(renderCountBeforeMessages + 1);
    expect(renderer.latest.conversations.map((conversation) => conversation.title)).toEqual(["Project A", "Boss"]);
    await store.close();
  });

  it("uses the stored useful contact name for a sparse incoming sender", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });
    const bossContact: ContactInput = {
      id: contactId("private", ["boss"]),
      protocolId: "@boss",
      kind: "private",
      displayName: "Boss",
      remarkName: "Boss"
    };
    const sparseBoss: ContactInput = {
      ...bossContact,
      displayName: "Group member",
      remarkName: undefined
    };
    const conversation = conversationFromContact(bossContact);

    await runtime.start();
    protocol.emit("message", {
      id: localMessageId([conversation.id, "sparse boss"]),
      conversation,
      sender: sparseBoss,
      isSelf: false,
      content: "sparse boss",
      type: "text",
      timestamp: 1_700_000_000_000
    });
    await flushRender();

    const storedConversation = renderer.latest.conversations.find((item) => item.title === "Boss");
    expect(storedConversation).toBeDefined();
    expect((await store.listMessages(storedConversation?.id ?? ""))[0]?.senderName).toBe("Boss");
    expect(storedConversation?.lastMessageSenderName).toBe("Boss");
    await store.close();
  });

  it("does not expose group message senders as searchable contacts", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });
    const group: ContactInput = {
      id: contactId("group", ["project-a"]),
      protocolId: "@@project-a",
      kind: "group",
      displayName: "Project A"
    };
    const sender: ContactInput = {
      id: contactId("private", ["@mock-member"]),
      protocolId: "@mock-member",
      kind: "private",
      displayName: "Mock Member"
    };
    const conversation = conversationFromContact(group);

    await runtime.start();
    protocol.emit("message", {
      id: localMessageId([conversation.id, sender.id, "group hello"]),
      conversation,
      sender,
      isSelf: false,
      content: "group hello",
      type: "text",
      timestamp: 1_700_000_000_000
    });
    await flushRender();

    const storedConversation = renderer.latest.conversations.find((item) => item.title === "Project A");
    const message = (await store.listMessages(storedConversation?.id ?? ""))[0];
    expect(message?.senderName).toBe("Mock Member");
    expect(message?.senderKind).toBe("group-member");
    expect(message?.senderProtocolId).toBe("@mock-member");
    expect(await store.searchContacts("Mock Member")).toHaveLength(0);
    expect(await store.searchContacts("Project A")).toHaveLength(1);
    await store.close();
  });

  it("backfills sparse group message sender names from later group member metadata", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });
    const group: ContactInput = {
      id: contactId("group", ["late-project"]),
      protocolId: "@@late-project",
      kind: "group",
      displayName: "Late Project"
    };
    const sparseSender: ContactInput = {
      id: contactId("private", ["@late-member"]),
      protocolId: "@late-member",
      kind: "private",
      displayName: "Group member"
    };
    const conversation = conversationFromContact(group);

    await runtime.start();
    protocol.emit("message", {
      id: localMessageId([conversation.id, sparseSender.id, "late hello"]),
      conversation,
      sender: sparseSender,
      isSelf: false,
      content: "late hello",
      type: "text",
      timestamp: 1_700_000_000_000
    });
    await flushRender();

    const storedConversation = renderer.latest.conversations.find((item) => item.title === "Late Project");
    expect((await store.listMessages(storedConversation?.id ?? ""))[0]?.senderName).toBe("Group member");

    protocol.emit("contacts", [
      {
        ...group,
        raw: {
          UserName: "@@late-project",
          MemberList: [{ UserName: "@late-member", DisplayName: "Late Member" }]
        }
      }
    ]);
    await flushRender();

    expect((await store.listMessages(storedConversation?.id ?? ""))[0]?.senderName).toBe("Late Member");
    expect((await store.findConversationById(storedConversation?.id ?? ""))?.lastMessageSenderName).toBe("Late Member");
    expect(await store.searchContacts("Late Member")).toHaveLength(0);
    await store.close();
  });

  it("uses redraw state for chats, keyboard navigation, chat input, unread status, and search", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    expect(renderer.latest.view).toBe("chats");

    protocol.emitIncoming("Boss", "meet at three", 1_700_000_000_000);
    await flushRender();
    expect(renderer.latest.view).toBe("chats");
    expect(renderer.latest.conversations[0]?.title).toBe("Boss");
    expect(renderer.latest.conversations[0]?.unreadCount).toBe(1);

    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    expect(await store.totalUnreadCount()).toBe(0);
    expect(renderer.latest.messages.map((message) => message.content)).toContain("meet at three");

    await pressText(runtime, "yes");
    expect(renderer.latest.chatInput).toBe("yes");
    await runtime.handleKey(key.enter());
    expect(renderer.latest.messages.map((message) => message.content)).toContain("yes");

    protocol.emitIncoming("Project A", "field changed", 1_700_000_100_000);
    await flushRender();
    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.messages.every((message) => message.conversationId === renderer.latest.activeConversation?.id)).toBe(true);
    expect(renderer.latest.unreadConversations.some((conversation) => conversation.title === "Project A")).toBe(true);
    expect(await store.totalUnreadCount()).toBe(1);

    await runtime.handleKey(key.escape());
    expect(renderer.latest.view).toBe("chats");
    expect(renderer.latest.conversations.map((conversation) => conversation.title)).toContain("Project A");
    const projectConversationFromRecent = renderer.latest.conversations.find((conversation) => conversation.title === "Project A");

    const before = renderer.latest.selectedConversationIndex;
    await runtime.handleKey(key.down());
    expect(renderer.latest.selectedConversationIndex).toBeGreaterThanOrEqual(before);
    await runtime.handleKey(key.up());
    expect(renderer.latest.selectedConversationIndex).toBeGreaterThanOrEqual(0);

    // Navigate down to the "🔍搜索" item (past all conversations) and press enter
    const conversationCount = renderer.latest.conversations.length;
    for (let i = 0; i <= conversationCount; i++) {
      await runtime.handleKey(key.down());
    }
    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("search");

    await pressText(runtime, "Project");
    expect(renderer.latest.searchKeyword).toBe("Project");
    expect(renderer.latest.searchResults[0]?.displayName).toBe("Project A");
    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.title).toBe("Project A");
    expect(renderer.latest.activeConversation?.id).toBe(projectConversationFromRecent?.id);
    expect(renderer.latest.messages.map((message) => message.content)).toContain("field changed");
    await store.close();
  });

  it("scrolls chat messages with arrow keys instead of prompt history", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    protocol.emitIncoming("Boss", "first", 1_700_000_000_000);
    await flushRender();
    await runtime.handleKey(key.enter());

    await pressText(runtime, "reply");
    await runtime.handleKey(key.enter());
    await pressText(runtime, "draft");

    await runtime.handleKey(key.up());
    expect(renderer.latest.chatInput).toBe("draft");
    expect(renderer.latest.messageScrollOffset).toBe(1);

    await runtime.handleKey(key.down());
    expect(renderer.latest.chatInput).toBe("draft");
    expect(renderer.latest.messageScrollOffset).toBe(0);

    await store.close();
  });

  it("switches unread conversations from the active chat with tab", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    protocol.emitIncoming("Boss", "first", 1_700_000_000_000);
    await flushRender();
    await runtime.handleKey(key.enter());
    await pressText(runtime, "draft");

    protocol.emitIncoming("Project A", "field changed", 1_700_000_100_000);
    await flushRender();
    const projectB: ContactInput = {
      id: contactId("private", ["project-b"]),
      protocolId: "@project-b",
      kind: "private",
      displayName: "Project B"
    };
    protocol.emit("contacts", [projectB]);
    protocol.emit("message", {
      id: localMessageId([projectB.id, "ship it", "1_700_000_200_000"]),
      conversation: conversationFromContact(projectB),
      sender: projectB,
      isSelf: false,
      content: "ship it",
      type: "text",
      timestamp: 1_700_000_200_000
    });
    await flushRender();
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    expect(await store.totalUnreadCount()).toBe(2);

    await runtime.handleKey(key.tab());
    expect(renderer.latest.conversationSwitcherActive).toBe(true);
    expect(renderer.latest.chatInput).toBe("draft");
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    expect(await store.totalUnreadCount()).toBe(2);
    const firstSelection = renderer.latest.selectedSwitcherConversationId;
    expect(firstSelection).toBeTruthy();

    await runtime.handleKey(key.tab());
    expect(renderer.latest.conversationSwitcherActive).toBe(true);
    const secondSelection = renderer.latest.selectedSwitcherConversationId;
    expect(secondSelection).toBeTruthy();
    expect(secondSelection).not.toBe(firstSelection);

    await runtime.handleKey(key.tab());
    expect(renderer.latest.conversationSwitcherActive).toBe(false);
    expect(renderer.latest.selectedSwitcherConversationId).toBeUndefined();
    expect(renderer.latest.chatInput).toBe("draft");

    await runtime.handleKey(key.tab());
    await runtime.handleKey(key.right());
    expect(renderer.latest.selectedSwitcherConversationId).toBe(secondSelection);
    await runtime.handleKey(key.left());
    expect(renderer.latest.selectedSwitcherConversationId).toBe(firstSelection);

    await runtime.handleKey(key.escape());
    expect(renderer.latest.conversationSwitcherActive).toBe(false);
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    expect(renderer.latest.chatInput).toBe("draft");

    await runtime.handleKey(key.tab());
    const selectedSwitcherTitle = renderer.latest.switcherConversations.find(
      (conversation) => conversation.id === renderer.latest.selectedSwitcherConversationId
    )?.title;
    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.conversationSwitcherActive).toBe(false);
    expect(renderer.latest.activeConversation?.title).toBe(selectedSwitcherTitle);
    expect(renderer.latest.chatInput).toBe("");
    expect(await store.totalUnreadCount()).toBe(1);
    const visibleReturnTarget = renderer.latest.switcherConversations.find((conversation) => conversation.title === "Boss");
    expect(visibleReturnTarget?.unreadCount).toBe(0);
    expect(renderer.latest.conversationSwitcherActive).toBe(false);

    await runtime.handleKey(key.tab());
    expect(renderer.latest.conversationSwitcherActive).toBe(true);
    const returnTarget = renderer.latest.switcherConversations.find(
      (conversation) => conversation.id === renderer.latest.selectedSwitcherConversationId
    );
    expect(returnTarget?.title).toBe("Boss");
    expect(returnTarget?.unreadCount).toBe(0);
    await runtime.handleKey(key.enter());
    expect(renderer.latest.conversationSwitcherActive).toBe(false);
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    expect(await store.totalUnreadCount()).toBe(1);
    await store.close();
  });

  it("sends quoted image paths with spaces", async () => {
    const imageDir = mkdtempSync(join(tmpdir(), "wechat-tui-send-image-"));
    tempDirs.push(imageDir);
    const imagePath = join(imageDir, "sample image 2026-05-28.png");
    writeFileSync(imagePath, "fake png");
    const store = await SqliteStore.open(tempDb());
    const protocol = new CapturingFileProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    protocol.emitIncoming("Boss", "hello", 1_700_000_000_000);
    await flushRender();
    await runtime.handleKey(key.enter());
    await runtime.handleUiEvent({ type: "chat-submit", text: `/send "${imagePath}"` });

    expect(protocol.sentFiles.at(-1)?.filePath).toBe(imagePath);
    expect(renderer.latest.errorMessage).toBeUndefined();
    expect(renderer.latest.messages.at(-1)?.content).toContain("[image]");
    await store.close();
  });

  it("navigates to search via the search item in conversation list", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    protocol.emitIncoming("Boss", "meet at three", 1_700_000_000_000);
    protocol.emitIncoming("Project A", "field changed", 1_700_000_100_000);
    await flushRender();

    // Navigate to search item (2 conversations + 1 search item = index 2)
    await runtime.handleKey(key.down());
    await runtime.handleKey(key.down());
    expect(renderer.latest.selectedConversationIndex).toBe(2);
    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("search");

    await pressText(runtime, "Boss");
    expect(renderer.latest.searchResults.some((r) => r.displayName === "Boss")).toBe(true);
    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    await store.close();
  });

  it("opens current contacts from search with stale conversation history merged", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const staleContact: ContactInput = {
      id: contactId("private", ["old-boss"]),
      protocolId: "@old-boss",
      kind: "private",
      displayName: "Boss",
      remarkName: "Boss"
    };
    const staleConversation = conversationFromContact(staleContact);

    await store.setActiveAccount(protocol.getCurrentUser());
    await store.upsertContact(staleContact);
    await store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old history"]),
        conversationId: staleConversation.id,
        senderId: staleContact.id,
        senderName: "Boss",
        isSelf: false,
        content: "old history",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );

    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });
    await runtime.start();
    await runtime.handleUiEvent({ type: "conversation-open" });
    await pressText(runtime, "Boss");
    await runtime.handleKey(key.enter());

    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    expect(renderer.latest.activeConversation?.protocolId).toBe("@boss");
    expect(renderer.latest.messages.map((message) => message.content)).toContain("old history");
    expect(await store.findConversationById(staleConversation.id)).toBeUndefined();
    await store.close();
  });

  it("opens stale recent conversations through the current contact conversation", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const staleContact: ContactInput = {
      id: contactId("private", ["old-boss-list"]),
      protocolId: "@old-boss-list",
      kind: "private",
      displayName: "Boss",
      remarkName: "Boss"
    };
    const staleConversation = conversationFromContact(staleContact);

    await store.setActiveAccount(protocol.getCurrentUser());
    await store.upsertContact(staleContact);
    await store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old list history"]),
        conversationId: staleConversation.id,
        senderId: staleContact.id,
        senderName: "Boss",
        isSelf: false,
        content: "old list history",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );

    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });
    await runtime.start();
    await runtime.handleKey(key.enter());

    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.protocolId).toBe("@boss");
    expect(renderer.latest.messages.map((message) => message.content)).toContain("old list history");
    expect(await store.findConversationById(staleConversation.id)).toBeUndefined();
    await store.close();
  });

  it("opens protocol-less legacy unread conversations through the current contact conversation", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const legacyContact: ContactInput = {
      id: contactId("private", ["legacy-boss-list"]),
      kind: "private",
      displayName: "Boss",
      remarkName: "Boss"
    };
    const legacyConversation = conversationFromContact(legacyContact);

    await store.setActiveAccount(protocol.getCurrentUser());
    await store.upsertContact(legacyContact);
    await store.saveMessage(
      {
        id: localMessageId([legacyConversation.id, "legacy unread"]),
        conversationId: legacyConversation.id,
        senderId: legacyContact.id,
        senderName: "Boss",
        isSelf: false,
        content: "legacy unread",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      legacyConversation,
      true
    );

    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });
    await runtime.start();
    expect(renderer.latest.conversations.find((conversation) => conversation.title === "Boss")?.unreadCount).toBe(1);

    await runtime.handleKey(key.enter());

    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.protocolId).toBe("@boss");
    expect(renderer.latest.messages.map((message) => message.content)).toContain("legacy unread");
    expect(await store.findConversationById(legacyConversation.id)).toBeUndefined();
    expect(await store.totalUnreadCount()).toBe(0);
    expect(renderer.latest.unreadConversations.some((conversation) => conversation.title === "Boss")).toBe(false);
    await store.close();
  });

  it("opens stale group conversations through the current group contact conversation", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const staleContact: ContactInput = {
      id: contactId("group", ["old-project-a-list"]),
      protocolId: "@@old-project-a-list",
      kind: "group",
      displayName: "Project A",
      raw: { UserName: "@@old-project-a-list", MemberCount: 1 }
    };
    const staleConversation = conversationFromContact(staleContact);

    await store.setActiveAccount(protocol.getCurrentUser());
    await store.upsertContact(staleContact);
    await store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old group list history"]),
        conversationId: staleConversation.id,
        senderId: contactId("private", ["@group-member"]),
        senderName: "Mock Member",
        isSelf: false,
        content: "old group list history",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );

    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });
    await runtime.start();
    await runtime.handleKey(key.enter());

    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.protocolId).toBe("@@project-a");
    expect(renderer.latest.messages.map((message) => message.content)).toContain("old group list history");
    expect(await store.findConversationById(staleConversation.id)).toBeUndefined();
    await store.close();
  });

  it("merges stale conversations when a current contact message arrives", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const staleContact: ContactInput = {
      id: contactId("private", ["old-boss-incoming"]),
      protocolId: "@old-boss-incoming",
      kind: "private",
      displayName: "Boss",
      remarkName: "Boss"
    };
    const staleConversation = conversationFromContact(staleContact);

    await store.setActiveAccount(protocol.getCurrentUser());
    await store.upsertContact(staleContact);
    await store.saveMessage(
      {
        id: localMessageId([staleConversation.id, "old incoming history"]),
        conversationId: staleConversation.id,
        senderId: staleContact.id,
        senderName: "Boss",
        isSelf: false,
        content: "old incoming history",
        type: "text",
        timestamp: 1_700_000_000_000
      },
      staleConversation,
      true
    );

    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });
    await runtime.start();
    protocol.emitIncoming("Boss", "new incoming", 1_700_000_100_000);
    await flushRender();

    const bossConversations = (await store.listRecentConversations()).filter((conversation) => conversation.title === "Boss");
    expect(bossConversations).toHaveLength(1);
    expect(bossConversations[0]?.protocolId).toBe("@boss");
    expect(await store.findConversationById(staleConversation.id)).toBeUndefined();
    expect((await store.listMessages(bossConversations[0]!.id)).map((message) => message.content)).toEqual([
      "old incoming history",
      "new incoming"
    ]);
    await store.close();
  });

  it("ignores a duplicate enter immediately after opening contact search", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    await runtime.handleUiEvent({ type: "conversation-open" });
    expect(renderer.latest.view).toBe("search");

    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("search");
    expect(renderer.latest.activeConversation).toBeUndefined();

    await pressText(runtime, "Boss");
    await runtime.handleKey(key.enter());
    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    await store.close();
  });

  it("opens the conversation selected by the pi-tui SelectList event", async () => {
    const store = await SqliteStore.open(tempDb());
    const protocol = new MockProtocol();
    const renderer = new FakeRenderer();
    const runtime = new WeChatRuntime(protocol, store, renderer, { initialHistoryLimit: 10 });

    await runtime.start();
    protocol.emitIncoming("Boss", "meet at three", 1_700_000_000_000);
    protocol.emitIncoming("Project A", "field changed", 1_700_000_100_000);
    await flushRender();

    const boss = renderer.latest.conversations.find((conversation) => conversation.title === "Boss");
    expect(boss).toBeDefined();

    await runtime.handleUiEvent({ type: "conversation-select", index: 1 });
    expect(renderer.latest.selectedConversationIndex).toBe(1);

    await runtime.handleUiEvent({ type: "conversation-open", conversationId: boss?.id });
    expect(renderer.latest.view).toBe("chat");
    expect(renderer.latest.activeConversation?.title).toBe("Boss");
    await store.close();
  });
});
