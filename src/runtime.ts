import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import {
  preview,
  summarizeContacts,
  summarizeIncomingMessage,
  summarizeSearchResults,
  summarizeStoredMessage
} from "./logging.js";
import type {
  AppView,
  ConnectionState,
  ContactInput,
  ContactRecord,
  ConversationInput,
  ConversationRecord,
  IncomingProtocolMessage,
  MessageInput,
  MessageStore,
  RenderState,
  UiEvent,
  UiKey,
  UserProfile,
  WeChatProtocol,
  WorkbenchRenderer
} from "./types.js";
import { conversationFromContact, localMessageId } from "./util/ids.js";

export interface RuntimeOptions {
  initialHistoryLimit?: number;
  conversationListLimit?: number;
  searchLimit?: number;
  logger?: Logger;
  debugLogPath?: string;
}

export class WeChatRuntime extends EventEmitter {
  private view: AppView = "login";
  private previousView: AppView = "chats";
  private connectionState: ConnectionState = "init";
  private selectedConversationIndex = 0;
  private selectedSearchIndex = 0;
  private activeConversationId?: string;
  private messageScrollOffset = 0;
  private searchKeyword = "";
  private chatInput = "";
  private conversationQuery = "";
  private conversationFocus: "list" | "input" = "list";
  private statusMessage?: string;
  private errorMessage?: string;
  private accountName?: string;
  private activeAccountId?: string;
  private qr?: RenderState["qr"];
  private exiting = false;

  constructor(
    private readonly protocol: WeChatProtocol,
    private readonly store: MessageStore,
    private readonly renderer: WorkbenchRenderer,
    private readonly options: RuntimeOptions = {}
  ) {
    super();
    this.bindProtocol();
  }

  async start(): Promise<void> {
    this.options.logger?.info({ debugLogPath: this.options.debugLogPath }, "runtime starting");
    this.renderer.start(
      (event) => {
        void this.handleUiEvent(event);
      },
      () => {
        if (!this.exiting) {
          this.exiting = true;
          this.emit("exit", 0);
        }
      }
    );
    this.statusMessage = "Starting protocol and loading local cache...";
    this.render();
    await this.protocol.start(this.store.getSessionData());
    this.options.logger?.info("runtime start completed");
    this.render();
  }

  async handleUiEvent(event: UiEvent): Promise<void> {
    if (event.type === "key") {
      await this.handleKey(event.key);
      return;
    }

    if (event.type === "conversation-select") {
      if (!this.exiting && this.view === "chats") {
        const conversations = this.listVisibleConversations();
        this.selectedConversationIndex = clampSelection(event.index, conversations.length + 1);
        this.render();
      }
      return;
    }

    if (event.type === "conversation-open") {
      if (!this.exiting && this.view === "chats") {
        if (event.conversationId) {
          this.openConversationById(event.conversationId);
        } else {
          this.enterContactSearch("chats");
        }
        this.render();
      }
      return;
    }

    if (this.exiting || this.view !== "chat") {
      return;
    }

    this.errorMessage = undefined;
    try {
      if (event.type === "chat-change") {
        this.chatInput = event.text;
      } else {
        await this.submitChatText(event.text);
      }
    } catch (error) {
      this.options.logger?.error({ err: error, eventType: event.type, view: this.view }, "failed to handle UI event");
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      if (!this.exiting) {
        this.render();
      }
    }
  }

  async handleKey(key: UiKey): Promise<void> {
    if (this.exiting) {
      return;
    }
    this.errorMessage = undefined;

    try {
      if (key.ctrl && key.name === "c") {
        this.requestExit();
        return;
      }

      switch (this.view) {
        case "login":
          await this.handleLoginKey(key);
          break;
        case "chats":
          await this.handleConversationListKey(key);
          break;
        case "chat":
          await this.handleChatKey(key);
          break;
        case "search":
          await this.handleSearchKey(key);
          break;
      }
    } catch (error) {
      this.options.logger?.error({ err: error, key, view: this.view }, "failed to handle key");
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      if (!this.exiting) {
        this.render();
      }
    }
  }

  private bindProtocol(): void {
    this.protocol.on("state", (state) => {
      this.options.logger?.info({ previousState: this.connectionState, nextState: state }, "protocol state changed");
      this.connectionState = state;
      if (state === "reconnecting") {
        this.statusMessage = "reconnecting...";
      }
      this.render();
    });

    this.protocol.on("qr", (event) => {
      this.options.logger?.info({ uuid: event.uuid, qrUrl: event.qrUrl }, "login QR received");
      this.qr = event;
      this.view = "login";
      this.statusMessage = "Scan the QR code with WeChat.";
      this.render();
    });

    this.protocol.on("scan", () => {
      this.options.logger?.info("login QR scanned");
      this.statusMessage = "QR scanned. Confirm login on your phone.";
      this.render();
    });

    this.protocol.on("login", (user) => {
      this.activateAccount(user);
      this.accountName = user.displayName;
      this.qr = undefined;
      this.view = "chats";
      this.statusMessage = `connected as ${user.displayName}`;
      this.persistSessionData();
      this.options.logger?.info(
        { user: { id: user.id, protocolId: user.protocolId, displayName: user.displayName } },
        "runtime login event"
      );
      this.render();
    });

    this.protocol.on("contacts", (contacts) => {
      this.options.logger?.debug(summarizeContacts(contacts), "runtime received contacts");
      if (!this.ensureActiveAccount("contacts")) {
        this.options.logger?.warn({ count: contacts.length }, "dropping contacts received before account is known");
        return;
      }
      this.store.upsertContacts(contacts.map((contact) => this.scopeContact(contact)));
      this.persistSessionData();
      if (this.view === "search") {
        this.clampSearchSelection();
      }
      this.render();
    });

    this.protocol.on("message", (message) => {
      this.options.logger?.debug({ message: summarizeIncomingMessage(message) }, "runtime received protocol message");
      if (!this.ensureActiveAccount("message")) {
        this.options.logger?.warn({ message: summarizeIncomingMessage(message) }, "dropping message received before account is known");
        return;
      }
      this.handleIncomingMessage(message);
      this.render();
    });

    this.protocol.on("logout", () => {
      this.connectionState = "logout";
      this.accountName = undefined;
      this.activeAccountId = undefined;
      this.store.clearActiveAccount();
      this.statusMessage = "logged out. Use q to quit.";
      this.render();
    });

    this.protocol.on("error", (error) => {
      this.connectionState = "error";
      this.errorMessage = error.message;
      this.statusMessage = "Use q to quit, or restart the CLI to reconnect.";
      this.options.logger?.error({ err: error }, "runtime protocol error");
      this.render();
    });
  }

  private activateAccount(user: UserProfile): void {
    const previousAccountId = this.activeAccountId;
    this.activeAccountId = user.id;
    this.store.setActiveAccount(user);
    if (previousAccountId && previousAccountId !== user.id) {
      this.activeConversationId = undefined;
      this.selectedConversationIndex = 0;
      this.selectedSearchIndex = 0;
      this.searchKeyword = "";
      this.conversationQuery = "";
      this.chatInput = "";
      this.messageScrollOffset = 0;
      this.conversationFocus = "list";
    }
  }

  private ensureActiveAccount(reason: string): boolean {
    if (this.activeAccountId) {
      return true;
    }
    const user = this.protocol.getCurrentUser();
    if (!user) {
      this.options.logger?.warn({ reason }, "protocol event arrived before current account is known");
      return false;
    }
    this.activateAccount(user);
    return true;
  }

  private scopeIncomingMessage(incoming: IncomingProtocolMessage): IncomingProtocolMessage {
    return {
      ...incoming,
      id: this.scopeId(incoming.id),
      conversation: this.scopeConversation(incoming.conversation),
      sender: this.scopeContact(incoming.sender)
    };
  }

  private scopeConversation(conversation: ConversationInput): ConversationInput {
    return {
      ...conversation,
      id: this.scopeId(conversation.id)
    };
  }

  private scopeContact(contact: ContactInput): ContactInput {
    return {
      ...contact,
      id: this.scopeId(contact.id)
    };
  }

  private scopeId(id: string): string {
    if (!this.activeAccountId) {
      throw new Error("Cannot store account-scoped data before login");
    }
    return `${this.activeAccountId}:${id}`;
  }

  private async handleLoginKey(key: UiKey): Promise<void> {
    if (isQuitKey(key)) {
      this.requestExit();
    }
  }

  private async handleConversationListKey(key: UiKey): Promise<void> {
    // SelectList handles up/down/enter via its own handleInput.
    // We only handle global keys here (ctrl+c is handled above).
    if (key.name === "command-contacts") {
      this.enterContactSearch("chats");
      return;
    }
    if (isQuitKey(key)) {
      this.requestExit();
      return;
    }
    if (isEscapeKey(key)) {
      this.requestExit();
      return;
    }
    if (isEnterKey(key)) {
      this.openSelectedConversation();
      return;
    }
    if (isUpKey(key)) {
      this.moveConversationSelection(-1);
      return;
    }
    if (isDownKey(key)) {
      this.moveConversationSelection(1);
      return;
    }
  }

  private async handleChatKey(key: UiKey): Promise<void> {
    if (isEscapeKey(key)) {
      this.view = "chats";
      this.previousView = "chat";
      this.chatInput = "";
      this.messageScrollOffset = 0;
      this.conversationFocus = "list";
      this.statusMessage = "back to recent chats";
      return;
    }
    if (isUpKey(key)) {
      this.scrollChatMessages(1);
      return;
    }
    if (isDownKey(key)) {
      this.scrollChatMessages(-1);
      return;
    }
    if (isEnterKey(key)) {
      await this.submitChatText(this.chatInput);
      return;
    }
    if (isBackspaceKey(key)) {
      this.chatInput = this.chatInput.slice(0, -1);
      return;
    }

    const text = printableText(key);
    if (text) {
      this.chatInput += text;
    }
  }

  private async handleSearchKey(key: UiKey): Promise<void> {
    if (isEscapeKey(key)) {
      this.view = this.previousView === "chat" && this.activeConversationId ? "chat" : "chats";
      this.conversationFocus = "list";
      this.statusMessage = this.view === "chat" ? "back to chat" : "back to recent chats";
      return;
    }
    if (isUpKey(key)) {
      this.moveSearchSelection(-1);
      return;
    }
    if (isDownKey(key)) {
      this.moveSearchSelection(1);
      return;
    }
    if (isEnterKey(key)) {
      this.openSelectedSearchResult();
      return;
    }
    if (isBackspaceKey(key)) {
      this.searchKeyword = this.searchKeyword.slice(0, -1);
      this.clampSearchSelection();
      return;
    }

    const text = printableText(key);
    if (text) {
      this.searchKeyword += text;
      this.clampSearchSelection();
    }
  }

  private async executeCommand(rawCommand: string, sourceView: AppView): Promise<void> {
    const command = rawCommand.trim();
    const name = command.split(/\s+/, 1)[0] ?? "";
    this.options.logger?.debug({ command: preview(command), sourceView }, "executing UI command");
    if (sourceView === "chats") {
      this.conversationQuery = "";
      this.selectedConversationIndex = 0;
    }

    switch (name) {
      case "/contacts":
        this.enterContactSearch(sourceView);
        return;
      case "/chats":
        this.view = "chats";
        this.previousView = sourceView;
        this.chatInput = "";
        this.conversationFocus = "list";
        this.statusMessage = "recent chats";
        return;
      case "/status":
        this.statusMessage = `connection: ${this.connectionState}${this.accountName ? `, account: ${this.accountName}` : ""}`;
        return;
      case "/refresh": {
        const contacts = await this.protocol.getContacts();
        this.store.upsertContacts(contacts.map((contact) => this.scopeContact(contact)));
        this.persistSessionData();
        this.statusMessage = `refreshed ${contacts.length} contacts`;
        return;
      }
      case "/load":
        this.statusMessage = "local history is loaded from the message store";
        return;
      case "/messages":
        this.errorMessage = "/messages local message search is not implemented yet";
        return;
      case "/quit":
        this.requestExit();
        return;
      default:
        this.errorMessage = `unknown command: ${command || "-"}`;
    }
  }

  private moveConversationSelection(delta: number): void {
    const conversations = this.listVisibleConversations();
    // +1 for the "🔍搜索" item at the end
    const totalItems = conversations.length + 1;
    if (totalItems === 0) {
      this.selectedConversationIndex = 0;
      return;
    }
    this.selectedConversationIndex = clamp(this.selectedConversationIndex + delta, 0, totalItems - 1);
  }

  private moveSearchSelection(delta: number): void {
    const results = this.store.searchContacts(this.searchKeyword, this.options.searchLimit ?? 20);
    if (results.length === 0) {
      this.selectedSearchIndex = 0;
      return;
    }
    this.selectedSearchIndex = clamp(this.selectedSearchIndex + delta, 0, results.length - 1);
  }

  private openSelectedConversation(): void {
    const conversations = this.listVisibleConversations();
    // If selected index is beyond the conversation list, it's the "🔍搜索" item
    if (this.selectedConversationIndex >= conversations.length) {
      this.enterContactSearch("chats");
      return;
    }
    if (conversations.length === 0) {
      this.errorMessage = "no recent conversations. Use /contacts to find a contact.";
      return;
    }
    const conversation = conversations[clamp(this.selectedConversationIndex, 0, conversations.length - 1)];
    this.openConversation(conversation);
  }

  private openConversationById(conversationId: string): void {
    const conversation =
      this.listVisibleConversations().find((item) => item.id === conversationId) ?? this.store.findConversationById(conversationId);
    if (!conversation) {
      this.errorMessage = "selected conversation is no longer available";
      return;
    }
    this.selectedConversationIndex = Math.max(0, this.listVisibleConversations().findIndex((item) => item.id === conversation.id));
    this.openConversation(conversation);
  }

  private openSelectedSearchResult(): void {
    const results = this.store.searchContacts(this.searchKeyword, this.options.searchLimit ?? 20);
    if (results.length === 0) {
      this.errorMessage = "no search result selected";
      return;
    }
    const contact = results[clamp(this.selectedSearchIndex, 0, results.length - 1)];
    const conversation = this.store.upsertConversation(conversationFromStoredContact(contact));
    this.openConversation(conversation);
  }

  private openConversation(conversation: ConversationRecord): void {
    this.activeConversationId = conversation.id;
    this.view = "chat";
    this.previousView = "chats";
    this.conversationQuery = "";
    this.searchKeyword = "";
    this.chatInput = "";
    this.messageScrollOffset = 0;
    this.store.markRead(conversation.id);
    this.statusMessage = `opened ${conversation.title}`;
    this.options.logger?.info(
      { conversationId: conversation.id, title: conversation.title, kind: conversation.kind },
      "opened conversation"
    );
  }

  private enterContactSearch(previousView: AppView): void {
    this.previousView = previousView;
    this.view = "search";
    this.searchKeyword = "";
    this.selectedSearchIndex = 0;
    this.statusMessage = "search contacts and groups";
  }

  private async submitChatText(rawText: string): Promise<void> {
    const text = rawText.trim();
    this.chatInput = "";
    this.messageScrollOffset = 0;
    if (!text) {
      return;
    }
    if (text.startsWith("/")) {
      await this.executeCommand(text, "chat");
      return;
    }
    await this.sendToActiveConversation(text);
  }

  private scrollChatMessages(delta: number): void {
    this.messageScrollOffset = Math.max(0, this.messageScrollOffset + delta);
  }

  private listVisibleConversations(): ConversationRecord[] {
    const conversations = foldPublicConversations(this.store.listRecentConversations(this.options.conversationListLimit ?? 20));
    const query = this.conversationQuery.trim().toLocaleLowerCase();
    if (!query || query.startsWith("/")) {
      return conversations;
    }
    return conversations.filter((conversation) => {
      const haystack = [
        conversation.title,
        conversation.lastMessagePreview,
        conversation.lastMessageSenderName,
        conversation.kind,
        conversation.protocolId
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(query);
    });
  }

  private async sendToActiveConversation(text: string): Promise<void> {
    const activeConversation = this.getActiveConversation();
    if (!activeConversation) {
      this.errorMessage = "no active conversation";
      return;
    }
    if (!activeConversation.protocolId) {
      this.errorMessage = "active conversation has no current protocol id";
      return;
    }

    this.options.logger?.debug(
      {
        conversationId: activeConversation.id,
        protocolId: activeConversation.protocolId,
        textLength: text.length,
        textPreview: preview(text)
      },
      "sending active chat message"
    );
    try {
      const sent = await this.protocol.sendText(activeConversation.protocolId, text);
      const now = Date.now();
      const currentUser = this.protocol.getCurrentUser();
      const message: MessageInput = {
        id: this.scopeId(sent.messageId ? `wechat:${sent.messageId}` : localMessageId([activeConversation.id, text, String(now)])),
        protocolMessageId: sent.messageId,
        conversationId: activeConversation.id,
        senderId: currentUser ? this.scopeId(currentUser.id) : undefined,
        senderName: "You",
        isSelf: true,
        content: text,
        type: "text",
        timestamp: now,
        raw: sent.raw
      };
      const saved = this.store.saveMessage(message, conversationInputFromRecord(activeConversation), false);
      this.store.markRead(activeConversation.id);
      this.messageScrollOffset = 0;
      this.persistSessionData();
      this.statusMessage = "message sent";
      this.options.logger?.info(
        { conversationId: activeConversation.id, sentMessageId: sent.messageId, message: summarizeStoredMessage(saved) },
        "active chat message sent"
      );
    } catch (error) {
      this.options.logger?.error({ err: error, conversationId: activeConversation.id }, "failed to send message");
      this.errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  private handleIncomingMessage(incoming: IncomingProtocolMessage): void {
    const scopedIncoming = this.scopeIncomingMessage(incoming);
    this.store.upsertContact(contactFromConversationInput(scopedIncoming.conversation));
    if (scopedIncoming.sender.id !== scopedIncoming.conversation.id || scopedIncoming.conversation.kind !== "group") {
      this.store.upsertContact(scopedIncoming.sender);
    }
    const isActive = this.activeConversationId === scopedIncoming.conversation.id;
    const isPublic = scopedIncoming.conversation.kind === "public";
    const incrementUnread = !isPublic && !scopedIncoming.isSelf && !isActive;
    const saved = this.store.saveMessage(
      {
        id: scopedIncoming.id,
        protocolMessageId: scopedIncoming.protocolMessageId,
        conversationId: scopedIncoming.conversation.id,
        senderId: scopedIncoming.sender.id,
        senderName: scopedIncoming.isSelf ? "You" : scopedIncoming.sender.displayName,
        isSelf: scopedIncoming.isSelf,
        content: scopedIncoming.content,
        type: scopedIncoming.type,
        timestamp: scopedIncoming.timestamp,
        raw: scopedIncoming.raw
      },
      scopedIncoming.conversation,
      incrementUnread
    );

    if (isPublic) {
      // Public account updates should be archived without creating unread or status reminders.
    } else if (isActive) {
      this.store.markRead(scopedIncoming.conversation.id);
      this.statusMessage = "new message";
    } else if (this.view === "chat" || this.view === "search") {
      this.statusMessage = `new message from ${scopedIncoming.conversation.title}`;
    } else {
      this.statusMessage = "recent chats updated";
    }
    this.persistSessionData();
    this.options.logger?.debug(
      {
        route: isActive ? "active_chat" : this.view === "chat" || this.view === "search" ? "status_only" : "conversation_list",
        message: summarizeStoredMessage(saved)
      },
      "incoming message handled"
    );
  }

  private render(): void {
    if (this.exiting) {
      return;
    }
    const state = this.buildRenderState();
    this.renderer.render(state);
  }

  private buildRenderState(): RenderState {
    const conversations = this.listVisibleConversations();
    // +1 for the "🔍搜索" item at the end of the list
    this.selectedConversationIndex = clampSelection(this.selectedConversationIndex, conversations.length + 1);
    const activeConversation = this.getActiveConversation();
    const messages = activeConversation
      ? this.store.listMessages(activeConversation.id, this.activeMessageLimit())
      : [];
    const searchResults = this.view === "search" ? this.store.searchContacts(this.searchKeyword, this.options.searchLimit ?? 20) : [];
    this.selectedSearchIndex = clampSelection(this.selectedSearchIndex, searchResults.length);
    const unreadConversations = foldPublicConversations(this.store.listUnreadConversations(20)).slice(0, 6);
    const totalUnreadCount = this.store.totalUnreadCount();

    this.options.logger?.trace(
      {
        view: this.view,
        conversations: conversations.length,
        activeConversationId: activeConversation?.id,
        messages: messages.length,
        searchResults: summarizeSearchResults(searchResults.map((contact) => ({
          conversation: {
            id: contact.id,
            protocolId: contact.protocolId,
            kind: contact.kind,
            title: contact.displayName,
            unreadCount: 0,
            updatedAt: contact.updatedAt
          },
          message: {
            id: contact.id,
            conversationId: contact.id,
            senderName: contact.displayName,
            isSelf: false,
            content: contact.displayName,
            type: "text",
            timestamp: contact.updatedAt,
            createdAt: contact.updatedAt
          }
        }))),
        totalUnreadCount
      },
      "render state built"
    );

    return {
      view: this.view,
      previousView: this.previousView,
      connectionState: this.connectionState,
      accountName: this.accountName,
      qr: this.qr,
      statusMessage: this.statusMessage,
      errorMessage: this.errorMessage,
      debugLogPath: this.options.debugLogPath,
      conversations,
      conversationQuery: this.conversationQuery,
      selectedConversationIndex: this.selectedConversationIndex,
      conversationFocus: this.conversationFocus,
      activeConversation,
      messages,
      searchKeyword: this.searchKeyword,
      searchResults,
      selectedSearchIndex: this.selectedSearchIndex,
      chatInput: this.chatInput,
      messageScrollOffset: this.messageScrollOffset,
      commandInput: this.conversationQuery.startsWith("/") ? this.conversationQuery : "",
      totalUnreadCount,
      unreadConversations
    };
  }

  private getActiveConversation(): ConversationRecord | undefined {
    if (!this.activeConversationId) {
      return undefined;
    }
    return this.store.findConversationById(this.activeConversationId);
  }

  private activeMessageLimit(): number {
    const base = this.options.initialHistoryLimit ?? 30;
    const max = Math.max(base, 500);
    if (this.messageScrollOffset <= 0) {
      return base;
    }
    return Math.min(max, base + this.messageScrollOffset + 50);
  }

  private clampSearchSelection(): void {
    const results = this.store.searchContacts(this.searchKeyword, this.options.searchLimit ?? 20);
    this.selectedSearchIndex = clampSelection(this.selectedSearchIndex, results.length);
  }

  private persistSessionData(): void {
    const sessionData = this.protocol.getSessionData();
    if (sessionData !== undefined) {
      this.options.logger?.trace("persisting protocol session data");
      this.store.setSessionData(sessionData);
    }
  }

  private requestExit(): void {
    if (this.exiting) {
      return;
    }
    this.exiting = true;
    this.options.logger?.info("runtime exit requested");
    this.renderer.stop();
    this.emit("exit", 0);
  }
}

function conversationInputFromRecord(record: ConversationRecord): ConversationInput {
  return {
    id: record.id,
    protocolId: record.protocolId,
    kind: record.kind,
    title: record.title
  };
}

function conversationFromStoredContact(contact: ContactRecord): ConversationInput {
  return conversationFromContact({
    id: contact.id,
    protocolId: contact.protocolId,
    kind: contact.kind,
    displayName: contact.displayName,
    remarkName: contact.remarkName,
    nickName: contact.nickName,
    alias: contact.alias,
    isSelf: contact.isSelf,
    raw: contact.raw
  });
}

function contactFromConversationInput(conversation: ConversationInput): ContactInput {
  return {
    id: conversation.id,
    protocolId: conversation.protocolId,
    kind: conversation.kind,
    displayName: conversation.title,
    isSelf: false
  };
}

function foldPublicConversations(conversations: ConversationRecord[]): ConversationRecord[] {
  const publicConversations = conversations.filter((conversation) => conversation.kind === "public");
  if (publicConversations.length === 0) {
    return conversations;
  }

  const latestPublic = publicConversations[0];
  const publicFold: ConversationRecord = {
    ...latestPublic,
    title: "公众号",
    unreadCount: 0,
    lastMessageSenderName: latestPublic.title,
    updatedAt: Math.max(...publicConversations.map((conversation) => conversation.updatedAt))
  };
  const folded = conversations.filter((conversation) => conversation.kind !== "public");
  folded.push(publicFold);
  return folded.sort(compareRecentConversations);
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

function isQuitKey(key: UiKey): boolean {
  return key.sequence === "q" || key.sequence === "Q";
}

function isUpKey(key: UiKey): boolean {
  return key.name === "up";
}

function isDownKey(key: UiKey): boolean {
  return key.name === "down";
}

function isEnterKey(key: UiKey): boolean {
  return key.name === "return" || key.name === "enter" || key.sequence === "\r" || key.sequence === "\n";
}

function isEscapeKey(key: UiKey): boolean {
  return key.name === "escape" || key.sequence === "\u001b";
}

function isBackspaceKey(key: UiKey): boolean {
  return key.name === "backspace" || key.sequence === "\b" || key.sequence === "\u007f";
}

function printableText(key: UiKey): string {
  if (key.ctrl || key.meta || key.name === "up" || key.name === "down" || key.name === "left" || key.name === "right") {
    return "";
  }
  if (isEnterKey(key) || isEscapeKey(key) || isBackspaceKey(key)) {
    return "";
  }
  return key.sequence;
}

function clampSelection(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return clamp(index, 0, length - 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
