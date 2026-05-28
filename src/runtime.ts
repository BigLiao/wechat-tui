import { EventEmitter } from "node:events";
import { existsSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";
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
  MessageKind,
  MessageRecord,
  MessageStore,
  RenderState,
  UiEvent,
  UiKey,
  UpdateInfo,
  UserProfile,
  WeChatProtocol,
  WorkbenchRenderer
} from "./types.js";
import { conversationFromContact, localMessageId } from "./util/ids.js";
import { FileRegistry } from "./util/file-hash.js";
import { MediaCache, extensionFromContentType } from "./util/media-cache.js";
import { openWithSystem, revealInFileManager } from "./util/open.js";
import { normalizeUserFilePath } from "./util/path-input.js";

export interface RuntimeOptions {
  initialHistoryLimit?: number;
  conversationListLimit?: number;
  searchLimit?: number;
  logger?: Logger;
  debugLogPath?: string;
  updateCheck?: () => Promise<UpdateInfo | undefined>;
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
  private updateInfo?: UpdateInfo;
  private accountName?: string;
  private activeAccountId?: string;
  private qr?: RenderState["qr"];
  private exiting = false;
  private contactSnapshotApplied = false;
  private readonly fileRegistry = new FileRegistry();
  private readonly mediaCache = new MediaCache();

  constructor(
    private readonly protocol: WeChatProtocol,
    private readonly store: MessageStore,
    private readonly renderer: WorkbenchRenderer,
    private readonly options: RuntimeOptions = {}
  ) {
    super();
    this.bindProtocol();
    this.renderer.setFileRegistry?.(this.fileRegistry);
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
    this.startUpdateCheck();
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
      } else if (event.type === "file-submit") {
        await this.sendFileToActiveConversation(event.filePath);
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
      // First contacts event after login = snapshot: mark all existing contacts stale
      if (!this.contactSnapshotApplied) {
        this.contactSnapshotApplied = true;
        this.store.markAllContactsStale();
        this.options.logger?.info({ count: contacts.length }, "applying contact snapshot (marked existing as stale)");
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
      this.fileRegistry.clear();
      this.contactSnapshotApplied = false;
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
    if (key.name === "command-clear") {
      this.clearAppData();
      return;
    }
    if (key.name === "command-logout") {
      await this.protocol.logout();
      this.store.clearSessionData();
      this.requestExit();
      return;
    }
    if (key.name === "command-quit") {
      this.requestExit();
      return;
    }
    if (isQuitKey(key)) {
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
      case "/send": {
        const filePath = command.slice(name.length).trim();
        if (filePath) {
          await this.sendFileToActiveConversation(filePath);
        } else {
          this.errorMessage = "usage: /send <file-path>";
        }
        return;
      }
      case "/view": {
        const hash = command.slice(name.length).trim();
        this.viewFileByHash(hash);
        return;
      }
      case "/logout":
        await this.protocol.logout();
        this.store.clearSessionData();
        this.requestExit();
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
    const conversation = this.store.upsertConversation(this.conversationFromStoredContact(contact));
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
    // Resolve the current protocol ID: prefer a fresh lookup from active contacts
    const protocolId = this.resolveCurrentProtocolId(activeConversation);
    if (!protocolId) {
      this.errorMessage = "active conversation has no current protocol id";
      return;
    }

    this.options.logger?.debug(
      {
        conversationId: activeConversation.id,
        protocolId,
        textLength: text.length,
        textPreview: preview(text)
      },
      "sending active chat message"
    );
    try {
      const sent = await this.protocol.sendText(protocolId, text);
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

  private async sendFileToActiveConversation(rawPath: string): Promise<void> {
    if (!rawPath) {
      this.errorMessage = "usage: /send <file-path>";
      return;
    }
    const activeConversation = this.getActiveConversation();
    if (!activeConversation) {
      this.errorMessage = "no active conversation";
      return;
    }
    const protocolId = this.resolveCurrentProtocolId(activeConversation);
    if (!protocolId) {
      this.errorMessage = "active conversation has no current protocol id";
      return;
    }

    const filePath = normalizeUserFilePath(rawPath);
    if (!existsSync(filePath)) {
      this.errorMessage = `file not found: ${filePath}`;
      return;
    }

    const filename = basename(filePath);
    const type = detectFileMessageKind(filePath);
    this.options.logger?.debug(
      { conversationId: activeConversation.id, filePath, filename, type },
      "sending file to active conversation"
    );

    try {
      const sent = await this.protocol.sendFile(protocolId, filePath);
      const now = Date.now();
      const currentUser = this.protocol.getCurrentUser();
      const content = `[${type}] ${filename}`;
      const message: MessageInput = {
        id: this.scopeId(sent.messageId ? `wechat:${sent.messageId}` : localMessageId([activeConversation.id, content, String(now)])),
        protocolMessageId: sent.messageId,
        conversationId: activeConversation.id,
        senderId: currentUser ? this.scopeId(currentUser.id) : undefined,
        senderName: "You",
        isSelf: true,
        content,
        type,
        timestamp: now,
        raw: { ...asObject(sent.raw), localFilePath: filePath }
      };
      const saved = this.store.saveMessage(message, conversationInputFromRecord(activeConversation), false);
      this.store.markRead(activeConversation.id);
      this.messageScrollOffset = 0;
      this.persistSessionData();
      this.statusMessage = `${type} sent: ${filename}`;
      this.options.logger?.info(
        { conversationId: activeConversation.id, sentMessageId: sent.messageId, message: summarizeStoredMessage(saved) },
        "file sent to active conversation"
      );
    } catch (error) {
      this.options.logger?.error({ err: error, conversationId: activeConversation.id, filePath }, "failed to send file");
      this.errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  private handleIncomingMessage(incoming: IncomingProtocolMessage): void {
    const scopedIncoming = this.scopeIncomingMessage(incoming);
    this.store.upsertContact(this.contactFromConversationInput(scopedIncoming.conversation));
    const senderIsGroupConversation =
      scopedIncoming.conversation.kind === "group" &&
      !!scopedIncoming.sender.protocolId &&
      scopedIncoming.sender.protocolId === scopedIncoming.conversation.protocolId;
    if (
      !senderIsGroupConversation &&
      (scopedIncoming.sender.id !== scopedIncoming.conversation.id || scopedIncoming.conversation.kind !== "group")
    ) {
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

    // Auto-download media for non-public messages
    if (!isPublic && isDownloadableType(scopedIncoming.type)) {
      void this.downloadAndCacheMedia(incoming, saved);
    }
  }

  private async downloadAndCacheMedia(incoming: IncomingProtocolMessage, saved: MessageRecord): Promise<void> {
    try {
      const result = await this.protocol.downloadMedia(incoming);
      if (!result) {
        this.options.logger?.debug(
          { messageId: saved.id, type: saved.type, protocolMessageId: incoming.protocolMessageId },
          "media download returned empty (no data or unsupported)"
        );
        return;
      }

      // Determine filename: prefer original name from raw, fall back to msgId-based name
      const raw = asObject(incoming.raw);
      const originalName = stringField(raw, "FileName") || stringField(raw, "FileNameTitle");
      const ext = originalName
        ? extname(originalName) || extensionFromContentType(result.contentType, saved.type)
        : extensionFromContentType(result.contentType, saved.type);
      const fileName = originalName
        ? sanitizeFileName(originalName)
        : `${saved.type}_${incoming.protocolMessageId ?? Date.now()}${ext}`;

      const cachePath = this.mediaCache.filePathByName(saved.conversationId, fileName);
      writeFileSync(cachePath, result.data);
      this.fileRegistry.register(saved.conversationId, saved.id, cachePath);

      // Persist localFilePath in the message raw so it survives restarts
      const updatedRaw = { ...asObject(saved.raw), localFilePath: cachePath };
      this.store.updateMessageRaw(saved.id, updatedRaw);

      this.options.logger?.info(
        { messageId: saved.id, type: saved.type, cachePath, size: result.data.length },
        "media downloaded and cached"
      );
      // Re-render so the hash/path association is visible
      this.render();
    } catch (error) {
      this.options.logger?.warn({ err: error, messageId: saved.id, type: saved.type }, "media download failed");
    }
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
      updateInfo: this.updateInfo,
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

  /**
   * Resolve the current valid protocol ID for a conversation.
   * After re-login, UserNames change so the stored protocolId may be stale.
   * We look up by title (displayName) in active contacts to find the fresh one.
   */
  private resolveCurrentProtocolId(conversation: ConversationRecord): string | undefined {
    // First try: find a non-stale contact with the same display name
    const contact = this.store.findContactByName(conversation.title);
    if (contact?.protocolId) {
      // Update the conversation's protocolId for future use
      if (contact.protocolId !== conversation.protocolId) {
        this.store.upsertConversation({
          id: conversation.id,
          protocolId: contact.protocolId,
          kind: conversation.kind,
          title: conversation.title
        });
      }
      return contact.protocolId;
    }
    // Fallback: use the stored protocolId (may be stale but worth trying)
    return conversation.protocolId;
  }

  private startUpdateCheck(): void {
    if (!this.options.updateCheck) {
      return;
    }
    void this.options.updateCheck().then(
      (updateInfo) => {
        if (this.exiting || !updateInfo) {
          return;
        }
        this.updateInfo = updateInfo;
        this.options.logger?.info(
          {
            packageName: updateInfo.packageName,
            currentVersion: updateInfo.currentVersion,
            latestVersion: updateInfo.latestVersion
          },
          "new package version available"
        );
        this.render();
      },
      (error: unknown) => {
        this.options.logger?.debug({ err: error }, "update check failed");
      }
    );
  }

  private conversationFromStoredContact(contact: ContactRecord): ConversationInput {
    const contactId = this.unscopedId(contact.id);
    const conversation = conversationFromContact({
      id: contactId,
      protocolId: contact.protocolId,
      kind: contact.kind,
      displayName: contact.displayName,
      remarkName: contact.remarkName,
      nickName: contact.nickName,
      alias: contact.alias,
      isSelf: contact.isSelf,
      raw: contact.raw
    });

    return {
      ...conversation,
      id: this.scopeId(contactId.startsWith("conversation:") ? contactId : conversation.id)
    };
  }

  private contactFromConversationInput(conversation: ConversationInput): ContactInput {
    const conversationId = this.unscopedId(conversation.id);
    const contactId = conversationId.startsWith("conversation:")
      ? conversationId.slice("conversation:".length)
      : conversationId;

    return {
      id: this.scopeId(contactId),
      protocolId: conversation.protocolId,
      kind: conversation.kind,
      displayName: conversation.title,
      isSelf: false
    };
  }

  private unscopedId(id: string): string {
    const prefix = this.activeAccountId ? `${this.activeAccountId}:` : "";
    return prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;
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

  private clearAppData(): void {
    this.options.logger?.info("clearing app data (messages, contacts, logs)");
    this.store.clearData();
    this.clearLogFiles();
    this.clearMediaCache();
    this.fileRegistry.clear();
    this.statusMessage = "data cleared";
    this.render();
  }

  private clearLogFiles(): void {
    const logDir = join(homedir(), ".wechat-tui", "logs");
    try {
      if (!existsSync(logDir)) return;
      const files = readdirSync(logDir);
      const currentLogPath = this.options.debugLogPath;
      for (const file of files) {
        const filePath = join(logDir, file);
        // Skip the current log file (still in use)
        if (currentLogPath && filePath === currentLogPath) continue;
        try { rmSync(filePath); } catch { /* ignore */ }
      }
    } catch {
      this.options.logger?.debug("failed to clear log directory");
    }
  }

  private clearMediaCache(): void {
    const cacheDir = this.mediaCache.baseDir;
    try {
      if (existsSync(cacheDir)) {
        rmSync(cacheDir, { recursive: true, force: true });
      }
    } catch {
      this.options.logger?.debug("failed to clear media cache directory");
    }
  }

  private viewFileByHash(hash: string): void {
    if (!hash) {
      this.errorMessage = "usage: /view <hash>";
      return;
    }
    // Strip leading '#' for convenience (user may type /view #a1c1 or /view a1c1)
    const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
    const filePath = this.fileRegistry.lookup(normalizedHash);
    if (!filePath) {
      this.errorMessage = `no file found for hash: ${normalizedHash}`;
      return;
    }
    if (!existsSync(filePath)) {
      this.errorMessage = `file no longer exists: ${filePath}`;
      return;
    }
    const ext = extname(filePath).toLowerCase();
    const isViewable = VIEWABLE_EXTENSIONS.has(ext);
    this.options.logger?.info({ hash: normalizedHash, filePath, isViewable }, "opening file with system viewer");
    if (isViewable) {
      openWithSystem(filePath);
      this.statusMessage = `opening: ${basename(filePath)}`;
    } else {
      revealInFileManager(filePath);
      this.statusMessage = `revealing: ${basename(filePath)}`;
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

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".amr", ".ogg", ".silk", ".m4a", ".wav"]);

/** Extensions that can be opened directly with a viewer (images, videos, audio) */
const VIEWABLE_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

function detectFileMessageKind(filePath: string): MessageKind {
  const ext = extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "file";
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/:*?"<>|\\]/g, "_").slice(0, 128);
}

const DOWNLOADABLE_TYPES = new Set<string>(["image", "sticker", "video", "voice", "file"]);

function isDownloadableType(type: MessageKind): boolean {
  return DOWNLOADABLE_TYPES.has(type);
}
