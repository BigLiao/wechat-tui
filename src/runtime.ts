import { EventEmitter } from "node:events";
import { access, readdir, rm, writeFile } from "node:fs/promises";
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
  ContactKind,
  ConversationInput,
  ConversationRecord,
  GroupMemberInput,
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
import { normalizeComparableGroupName, normalizeComparableText } from "./util/group-name.js";
import { conversationFromContact, groupMemberId, localMessageId } from "./util/ids.js";
import { FileRegistry } from "./util/file-hash.js";
import { MediaCache, extensionFromContentType } from "./util/media-cache.js";
import { openWithSystem, revealInFileManager } from "./util/open.js";
import { normalizeUserFilePath } from "./util/path-input.js";
import { createStartupRenderState } from "./startup-state.js";

export interface RuntimeOptions {
  initialHistoryLimit?: number;
  conversationListLimit?: number;
  searchLimit?: number;
  logger?: Logger;
  debugLogPath?: string;
  updateCheck?: () => Promise<UpdateInfo | undefined>;
  minimumStartupMs?: number;
}

const SEARCH_ENTER_SUPPRESSION_MS = 100;
const STARTUP_FRAME_MS = 160;
const RENDER_DEBOUNCE_MS = 8;

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
  private selectedSwitcherConversationId?: string;
  private tabReturnConversationId?: string;
  private statusMessage?: string;
  private errorMessage?: string;
  private updateInfo?: UpdateInfo;
  private accountName?: string;
  private activeAccountId?: string;
  private qr?: RenderState["qr"];
  private exiting = false;
  private contactSnapshotApplied = false;
  private suppressSearchEnterUntil = 0;
  private renderScheduled = false;
  private rendering = false;
  private renderAgain = false;
  private renderPromise: Promise<void> | undefined;
  private protocolEventQueue: Promise<void> = Promise.resolve();
  private pendingProtocolEvents = 0;
  private protocolBatchRenderRequested = false;
  private startupActive = false;
  private startupFrame = 0;
  private startupMessage = "Opening WeChat TUI...";
  private startupStartedAt = 0;
  private startupTimer?: ReturnType<typeof setInterval>;
  private pendingStoredSessionStartup = false;
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
    this.startStartupAnimation("Opening WeChat TUI...");
    this.startUpdateCheck();
    await this.render();
    const sessionData = await this.store.getSessionData();
    this.pendingStoredSessionStartup = sessionData !== undefined;
    this.startupMessage = sessionData ? "Checking saved WeChat session..." : "Preparing WeChat login...";
    this.statusMessage = this.startupMessage;
    await this.render();
    try {
      await this.protocol.start(sessionData);
      await this.protocolEventQueue;
      if (this.startupActive) {
        await waitForMinimumStartup(this.startupStartedAt, this.options.minimumStartupMs ?? 0);
      }
    } finally {
      this.pendingStoredSessionStartup = false;
      this.stopStartupAnimation();
    }
    this.options.logger?.info("runtime start completed");
    await this.render();
  }

  async handleUiEvent(event: UiEvent): Promise<void> {
    if (event.type === "key") {
      await this.handleKey(event.key);
      return;
    }

    if (event.type === "conversation-select") {
      if (!this.exiting && this.view === "chats") {
        const conversations = await this.listVisibleConversations();
        this.selectedConversationIndex = clampSelection(event.index, conversations.length + 1);
        await this.render();
      }
      return;
    }

    if (event.type === "conversation-open") {
      if (!this.exiting && this.view === "chats") {
        if (event.conversationId) {
          await this.openConversationById(event.conversationId);
        } else {
          this.enterContactSearch("chats");
        }
        await this.render();
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
        await this.render();
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
      if (this.startupActive) {
        if (isQuitKey(key)) {
          this.requestExit();
        }
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
        await this.render();
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
      void this.render();
    });

    this.protocol.on("qr", (event) => {
      this.options.logger?.info({ uuid: event.uuid, qrUrl: event.qrUrl }, "login QR received");
      this.pendingStoredSessionStartup = false;
      this.stopStartupAnimation();
      this.qr = event;
      this.view = "login";
      this.statusMessage = "Scan the QR code with WeChat.";
      void this.render();
    });

    this.protocol.on("scan", () => {
      this.options.logger?.info("login QR scanned");
      this.statusMessage = "QR scanned. Confirm login on your phone.";
      void this.render();
    });

    this.protocol.on("login", (user) => {
      this.enqueueProtocolEvent(() => this.handleProtocolLogin(user));
    });

    this.protocol.on("contacts", (contacts) => {
      this.enqueueProtocolEvent(() => this.handleProtocolContacts(contacts));
    });

    this.protocol.on("message", (message) => {
      this.enqueueProtocolEvent(() => this.handleProtocolMessage(message));
    });

    this.protocol.on("logout", () => {
      this.enqueueProtocolEvent(() => this.handleProtocolLogout());
    });

    this.protocol.on("error", (error) => {
      this.connectionState = "error";
      this.errorMessage = error.message;
      this.statusMessage = "Use q to quit, or restart the CLI to reconnect.";
      this.options.logger?.error({ err: error }, "runtime protocol error");
      void this.render();
    });
  }

  private enqueueProtocolEvent(task: () => Promise<void>): void {
    this.pendingProtocolEvents += 1;
    const run = async () => {
      try {
        await task();
      } finally {
        this.pendingProtocolEvents -= 1;
        if (this.pendingProtocolEvents === 0 && this.protocolBatchRenderRequested) {
          this.protocolBatchRenderRequested = false;
          this.scheduleRender();
        }
      }
    };
    this.protocolEventQueue = this.protocolEventQueue.then(run, run);
    void this.protocolEventQueue.catch((error: unknown) => {
      this.options.logger?.error({ err: error }, "protocol event queue failed");
      this.errorMessage = error instanceof Error ? error.message : String(error);
      void this.render();
    });
  }

  private async handleProtocolLogin(user: UserProfile): Promise<void> {
    try {
      const showStartup = this.pendingStoredSessionStartup;
      this.pendingStoredSessionStartup = false;
      await this.activateAccount(user);
      this.accountName = user.displayName;
      this.qr = undefined;
      this.view = "chats";
      this.statusMessage = `connected as ${user.displayName}`;
      await this.persistSessionData();
      this.options.logger?.info(
        { user: { id: user.id, protocolId: user.protocolId, displayName: user.displayName } },
        "runtime login event"
      );
      if (showStartup) {
        if (this.startupActive) {
          this.startupMessage = "Loading your WeChat workspace...";
        } else {
          this.startStartupAnimation("Loading your WeChat workspace...");
        }
      }
      void this.render();
    } catch (error) {
      this.options.logger?.error({ err: error }, "failed to handle protocol login");
      this.errorMessage = error instanceof Error ? error.message : String(error);
      void this.render();
    }
  }

  private async handleProtocolContacts(contacts: ContactInput[]): Promise<void> {
    try {
      this.options.logger?.debug(summarizeContacts(contacts), "runtime received contacts");
      if (!(await this.ensureActiveAccount("contacts"))) {
        this.options.logger?.warn({ count: contacts.length }, "dropping contacts received before account is known");
        return;
      }
      // First contacts event after login = snapshot: mark all existing contacts stale
      if (!this.contactSnapshotApplied) {
        this.contactSnapshotApplied = true;
        await this.store.markAllContactsStale();
        this.options.logger?.info({ count: contacts.length }, "applying contact snapshot (marked existing as stale)");
      }
      await this.store.upsertContacts(contacts.map((contact) => this.scopeContact(contact)));
      await this.persistSessionData();
      if (this.view === "search") {
        await this.clampSearchSelection();
      }
      void this.render();
    } catch (error) {
      this.options.logger?.error({ err: error, count: contacts.length }, "failed to handle protocol contacts");
      this.errorMessage = error instanceof Error ? error.message : String(error);
      void this.render();
    }
  }

  private async handleProtocolMessage(message: IncomingProtocolMessage): Promise<void> {
    try {
      this.options.logger?.debug({ message: summarizeIncomingMessage(message) }, "runtime received protocol message");
      if (!(await this.ensureActiveAccount("message"))) {
        this.options.logger?.warn({ message: summarizeIncomingMessage(message) }, "dropping message received before account is known");
        return;
      }
      if (await this.handleIncomingMessage(message)) {
        this.scheduleProtocolBatchRender();
      }
    } catch (error) {
      this.options.logger?.error({ err: error, message: summarizeIncomingMessage(message) }, "failed to handle protocol message");
      this.errorMessage = error instanceof Error ? error.message : String(error);
      void this.render();
    }
  }

  private async handleProtocolLogout(): Promise<void> {
    this.connectionState = "logout";
    this.accountName = undefined;
    this.activeAccountId = undefined;
    this.store.clearActiveAccount();
    this.statusMessage = "logged out. Use q to quit.";
    void this.render();
  }

  private async activateAccount(user: UserProfile): Promise<void> {
    const previousAccountId = this.activeAccountId;
    this.activeAccountId = user.id;
    await this.store.setActiveAccount(user);
    if (previousAccountId && previousAccountId !== user.id) {
      this.activeConversationId = undefined;
      this.selectedConversationIndex = 0;
      this.selectedSearchIndex = 0;
      this.searchKeyword = "";
      this.conversationQuery = "";
      this.chatInput = "";
      this.messageScrollOffset = 0;
      this.conversationFocus = "list";
      this.selectedSwitcherConversationId = undefined;
      this.tabReturnConversationId = undefined;
      this.fileRegistry.clear();
      this.contactSnapshotApplied = false;
    }
  }

  private async ensureActiveAccount(reason: string): Promise<boolean> {
    if (this.activeAccountId) {
      return true;
    }
    const user = this.protocol.getCurrentUser();
    if (!user) {
      this.options.logger?.warn({ reason }, "protocol event arrived before current account is known");
      return false;
    }
    await this.activateAccount(user);
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
      await this.clearAppData();
      return;
    }
    if (key.name === "command-readall") {
      await this.markAllConversationsRead();
      return;
    }
    if (key.name === "command-logout") {
      await this.protocol.logout();
      await this.store.clearSessionData();
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
      await this.openSelectedConversation();
      return;
    }
    if (isUpKey(key)) {
      await this.moveConversationSelection(-1);
      return;
    }
    if (isDownKey(key)) {
      await this.moveConversationSelection(1);
      return;
    }
  }

  private async handleChatKey(key: UiKey): Promise<void> {
    if (this.selectedSwitcherConversationId) {
      await this.handleConversationSwitcherKey(key);
      return;
    }
    if (isTabKey(key)) {
      await this.cycleConversationSwitcher();
      return;
    }
    if (isEscapeKey(key)) {
      this.view = "chats";
      this.previousView = "chat";
      this.chatInput = "";
      this.messageScrollOffset = 0;
      this.conversationFocus = "list";
      this.selectedSwitcherConversationId = undefined;
      this.tabReturnConversationId = undefined;
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
    const shouldIgnoreEnter = isEnterKey(key) && Date.now() < this.suppressSearchEnterUntil;
    if (!isEnterKey(key)) {
      this.suppressSearchEnterUntil = 0;
    }
    if (isEscapeKey(key)) {
      this.view = this.previousView === "chat" && this.activeConversationId ? "chat" : "chats";
      this.conversationFocus = "list";
      this.statusMessage = this.view === "chat" ? "back to chat" : "back to recent chats";
      return;
    }
    if (isUpKey(key)) {
      await this.moveSearchSelection(-1);
      return;
    }
    if (isDownKey(key)) {
      await this.moveSearchSelection(1);
      return;
    }
    if (isEnterKey(key)) {
      if (shouldIgnoreEnter) {
        this.suppressSearchEnterUntil = 0;
        return;
      }
      this.suppressSearchEnterUntil = 0;
      await this.openSelectedSearchResult();
      return;
    }
    if (isBackspaceKey(key)) {
      this.searchKeyword = this.searchKeyword.slice(0, -1);
      await this.clampSearchSelection();
      return;
    }

    const text = printableText(key);
    if (text) {
      this.searchKeyword += text;
      await this.clampSearchSelection();
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
      case "/readall":
        await this.markAllConversationsRead();
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
        await this.viewFileByHash(hash);
        return;
      }
      case "/logout":
        await this.protocol.logout();
        await this.store.clearSessionData();
        this.requestExit();
        return;
      case "/quit":
        this.requestExit();
        return;
      default:
        this.errorMessage = `unknown command: ${command || "-"}`;
    }
  }

  private async moveConversationSelection(delta: number): Promise<void> {
    const conversations = await this.listVisibleConversations();
    // +1 for the "🔍搜索" item at the end
    const totalItems = conversations.length + 1;
    if (totalItems === 0) {
      this.selectedConversationIndex = 0;
      return;
    }
    this.selectedConversationIndex = clamp(this.selectedConversationIndex + delta, 0, totalItems - 1);
  }

  private async moveSearchSelection(delta: number): Promise<void> {
    const results = await this.store.searchContacts(this.searchKeyword, this.options.searchLimit ?? 20);
    if (results.length === 0) {
      this.selectedSearchIndex = 0;
      return;
    }
    this.selectedSearchIndex = clamp(this.selectedSearchIndex + delta, 0, results.length - 1);
  }

  private async openSelectedConversation(): Promise<void> {
    const conversations = await this.listVisibleConversations();
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
    await this.openConversation(conversation);
  }

  private async openConversationById(conversationId: string): Promise<void> {
    const visibleConversations = await this.listVisibleConversations();
    const conversation =
      visibleConversations.find((item) => item.id === conversationId) ?? await this.store.findConversationById(conversationId);
    if (!conversation) {
      this.errorMessage = "selected conversation is no longer available";
      return;
    }
    this.selectedConversationIndex = Math.max(0, visibleConversations.findIndex((item) => item.id === conversation.id));
    await this.openConversation(conversation);
  }

  private async openSelectedSearchResult(): Promise<void> {
    const results = await this.store.searchContacts(this.searchKeyword, this.options.searchLimit ?? 20);
    if (results.length === 0) {
      this.errorMessage = "no search result selected";
      return;
    }
    const contact = results[clamp(this.selectedSearchIndex, 0, results.length - 1)];
    const conversation = await this.mergeConversationWithContact(
      contact,
      await this.store.upsertConversation(this.conversationFromStoredContact(contact))
    );
    await this.openConversation(conversation);
  }

  private async openConversation(conversation: ConversationRecord): Promise<void> {
    const currentConversation = await this.mergeConversationWithCurrentContact(conversation);
    this.activeConversationId = currentConversation.id;
    this.view = "chat";
    this.previousView = "chats";
    this.conversationQuery = "";
    this.searchKeyword = "";
    this.chatInput = "";
    this.messageScrollOffset = 0;
    this.selectedSwitcherConversationId = undefined;
    this.tabReturnConversationId = undefined;
    await this.store.markRead(currentConversation.id);
    this.statusMessage = `opened ${currentConversation.title}`;
    this.options.logger?.info(
      { conversationId: currentConversation.id, title: currentConversation.title, kind: currentConversation.kind },
      "opened conversation"
    );
  }

  private async mergeConversationWithCurrentContact(conversation: ConversationRecord): Promise<ConversationRecord> {
    const contact = await this.currentContactForConversation(conversation);
    return contact ? this.mergeConversationWithContact(contact, conversation) : conversation;
  }

  private async mergeConversationWithContact(contact: ContactRecord, conversation: ConversationRecord): Promise<ConversationRecord> {
    const currentConversation =
      conversation.id === this.conversationFromStoredContact(contact).id
        ? conversation
        : await this.store.upsertConversation(this.conversationFromStoredContact(contact));
    return this.store.mergeStaleConversationForContact(contact, currentConversation);
  }

  private async currentContactForConversation(conversation: ConversationRecord): Promise<ContactRecord | undefined> {
    if (conversation.kind !== "private" && conversation.kind !== "group") {
      return undefined;
    }
    const contact = await this.store.findContactByName(conversation.title);
    if (!contact || contact.kind !== conversation.kind || !contactMatchesConversationTitle(contact, conversation)) {
      return undefined;
    }
    return contact;
  }

  private enterContactSearch(previousView: AppView): void {
    this.previousView = previousView;
    this.view = "search";
    this.searchKeyword = "";
    this.selectedSearchIndex = 0;
    this.suppressSearchEnterUntil = Date.now() + SEARCH_ENTER_SUPPRESSION_MS;
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

  private async handleConversationSwitcherKey(key: UiKey): Promise<void> {
    if (isTabKey(key)) {
      await this.cycleConversationSwitcher();
      return;
    }
    if (isEscapeKey(key)) {
      this.exitConversationSwitcher("back to chat");
      return;
    }
    if (isLeftKey(key)) {
      await this.moveConversationSwitcher(-1);
      return;
    }
    if (isRightKey(key)) {
      await this.moveConversationSwitcher(1);
      return;
    }
    if (isEnterKey(key)) {
      await this.openSelectedSwitcherConversation();
    }
  }

  private async cycleConversationSwitcher(): Promise<void> {
    const switcherConversations = await this.listConversationSwitcherTargets();
    if (switcherConversations.length === 0) {
      this.exitConversationSwitcher();
      return;
    }
    if (!this.selectedSwitcherConversationId) {
      this.selectSwitcherConversation(switcherConversations[0]);
      return;
    }

    const currentIndex = switcherConversations.findIndex((conversation) => conversation.id === this.selectedSwitcherConversationId);
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
    if (nextIndex >= switcherConversations.length) {
      this.exitConversationSwitcher("back to chat");
      return;
    }
    this.selectSwitcherConversation(switcherConversations[nextIndex]);
  }

  private async moveConversationSwitcher(delta: number): Promise<void> {
    const switcherConversations = await this.listConversationSwitcherTargets();
    if (switcherConversations.length === 0) {
      this.exitConversationSwitcher("no conversations to switch");
      return;
    }

    const currentIndex = Math.max(
      0,
      switcherConversations.findIndex((conversation) => conversation.id === this.selectedSwitcherConversationId)
    );
    const nextIndex = (currentIndex + delta + switcherConversations.length) % switcherConversations.length;
    this.selectSwitcherConversation(switcherConversations[nextIndex]);
  }

  private async openSelectedSwitcherConversation(): Promise<void> {
    const switcherConversations = await this.listConversationSwitcherTargets();
    const conversation = switcherConversations.find((item) => item.id === this.selectedSwitcherConversationId);
    if (!conversation) {
      this.exitConversationSwitcher("no conversations to switch");
      return;
    }
    const returnConversationId = this.activeConversationId && this.activeConversationId !== conversation.id
      ? this.activeConversationId
      : undefined;
    await this.openConversation(conversation);
    this.tabReturnConversationId = returnConversationId;
  }

  private selectSwitcherConversation(conversation: ConversationRecord): void {
    this.selectedSwitcherConversationId = conversation.id;
    this.statusMessage = `switch: ${conversation.title}`;
  }

  private exitConversationSwitcher(statusMessage?: string): void {
    this.selectedSwitcherConversationId = undefined;
    this.statusMessage = statusMessage;
  }

  private async listVisibleConversations(): Promise<ConversationRecord[]> {
    const conversations = foldPublicConversations(await this.store.listRecentConversations(this.options.conversationListLimit ?? 20));
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
    let activeConversation = await this.getActiveConversation();
    if (!activeConversation) {
      this.errorMessage = "no active conversation";
      return;
    }
    activeConversation = await this.mergeConversationWithCurrentContact(activeConversation);
    this.activeConversationId = activeConversation.id;
    // Resolve the current protocol ID: prefer a fresh lookup from active contacts
    const protocolId = await this.resolveCurrentProtocolId(activeConversation);
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
      const saved = await this.store.saveMessage(message, conversationInputFromRecord(activeConversation), false);
      await this.store.markRead(activeConversation.id);
      this.messageScrollOffset = 0;
      await this.persistSessionData();
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
    let activeConversation = await this.getActiveConversation();
    if (!activeConversation) {
      this.errorMessage = "no active conversation";
      return;
    }
    activeConversation = await this.mergeConversationWithCurrentContact(activeConversation);
    this.activeConversationId = activeConversation.id;
    const protocolId = await this.resolveCurrentProtocolId(activeConversation);
    if (!protocolId) {
      this.errorMessage = "active conversation has no current protocol id";
      return;
    }

    const filePath = normalizeUserFilePath(rawPath);
    if (!(await fileExists(filePath))) {
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
      const saved = await this.store.saveMessage(message, conversationInputFromRecord(activeConversation), false);
      await this.store.markRead(activeConversation.id);
      this.messageScrollOffset = 0;
      await this.persistSessionData();
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

  private async handleIncomingMessage(incoming: IncomingProtocolMessage): Promise<boolean> {
    const scopedIncoming = this.scopeIncomingMessage(incoming);
    if (await this.store.hasMessage(scopedIncoming.id)) {
      this.options.logger?.debug(
        { messageId: scopedIncoming.id, protocolMessageId: scopedIncoming.protocolMessageId },
        "duplicate incoming message skipped"
      );
      return false;
    }
    let conversationContact = await this.store.upsertContact(this.contactFromConversationInput(scopedIncoming.conversation));
    let senderForMessage: { id: string; protocolId?: string; displayName: string } = scopedIncoming.sender;
    let senderKind: MessageInput["senderKind"] = scopedIncoming.isSelf ? "self" : "contact";
    let senderProtocolId = scopedIncoming.sender.protocolId;
    const senderIsGroupConversation =
      scopedIncoming.conversation.kind === "group" &&
      !!scopedIncoming.sender.protocolId &&
      scopedIncoming.sender.protocolId === scopedIncoming.conversation.protocolId;
    if (scopedIncoming.conversation.kind === "group" && !scopedIncoming.isSelf) {
      senderKind = "group-member";
      const groupMember = !senderIsGroupConversation
        ? this.groupMemberFromSender(scopedIncoming.conversation, scopedIncoming.sender)
        : undefined;
      if (groupMember) {
        const savedGroupMember = await this.store.upsertGroupMember(groupMember);
        senderForMessage = savedGroupMember;
        senderProtocolId = savedGroupMember.memberProtocolId;
      }
    } else if (
      !senderIsGroupConversation &&
      (scopedIncoming.sender.id !== scopedIncoming.conversation.id || scopedIncoming.conversation.kind !== "group")
    ) {
      const senderContact = await this.store.upsertContact(scopedIncoming.sender);
      senderForMessage = senderContact;
      senderProtocolId = senderContact.protocolId;
      if (
        scopedIncoming.conversation.kind === "private" &&
        !!scopedIncoming.sender.protocolId &&
        scopedIncoming.sender.protocolId === scopedIncoming.conversation.protocolId
      ) {
        conversationContact = senderContact;
      }
    }
    const activeConversation = await this.getActiveConversation();
    const isActive =
      this.activeConversationId === scopedIncoming.conversation.id ||
      !!activeConversationMatchesInput(activeConversation, scopedIncoming.conversation);
    const isPublic = scopedIncoming.conversation.kind === "public";
    const incrementUnread = !isPublic && !scopedIncoming.isSelf && !isActive;
    const saved = await this.store.saveMessage(
      {
        id: scopedIncoming.id,
        protocolMessageId: scopedIncoming.protocolMessageId,
        conversationId: scopedIncoming.conversation.id,
        senderId: senderForMessage.id,
        senderKind,
        senderProtocolId,
        senderName: scopedIncoming.isSelf ? "You" : senderForMessage.displayName,
        isSelf: scopedIncoming.isSelf,
        content: scopedIncoming.content,
        type: scopedIncoming.type,
        timestamp: scopedIncoming.timestamp,
        raw: scopedIncoming.raw
      },
      scopedIncoming.conversation,
      incrementUnread
    );
    const savedConversation = await this.store.findConversationById(scopedIncoming.conversation.id);
    const mergedConversation =
      savedConversation && !isPublic ? await this.store.mergeStaleConversationForContact(conversationContact, savedConversation) : savedConversation;
    if (isActive && mergedConversation) {
      this.activeConversationId = mergedConversation.id;
    }

    if (isPublic) {
      // Public account updates should be archived without creating unread or status reminders.
    } else if (isActive) {
      await this.store.markRead(mergedConversation?.id ?? scopedIncoming.conversation.id);
      this.statusMessage = "new message";
    } else if (this.view === "chat" || this.view === "search") {
      this.statusMessage = `new message from ${scopedIncoming.conversation.title}`;
    } else {
      this.statusMessage = "recent chats updated";
    }
    await this.persistSessionData();
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
    return true;
  }

  private groupMemberFromSender(conversation: ConversationInput, sender: ContactInput): GroupMemberInput | undefined {
    if (!sender.protocolId) {
      return undefined;
    }
    return {
      id: groupMemberId(conversation.id, sender.protocolId),
      groupId: conversation.id,
      groupProtocolId: conversation.protocolId,
      memberProtocolId: sender.protocolId,
      displayName: sender.displayName,
      remarkName: sender.remarkName,
      nickName: sender.nickName,
      alias: sender.alias,
      raw: sender.raw
    };
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

      const cachePath = await this.mediaCache.filePathByName(saved.conversationId, fileName);
      await writeFile(cachePath, result.data);
      this.fileRegistry.register(saved.conversationId, saved.id, cachePath);

      // Persist localFilePath in the message raw so it survives restarts
      const updatedRaw = { ...asObject(saved.raw), localFilePath: cachePath };
      await this.store.updateMessageRaw(saved.id, updatedRaw);

      this.options.logger?.info(
        { messageId: saved.id, type: saved.type, cachePath, size: result.data.length },
        "media downloaded and cached"
      );
      // Re-render so the hash/path association is visible
      this.scheduleRender();
    } catch (error) {
      this.options.logger?.warn({ err: error, messageId: saved.id, type: saved.type }, "media download failed");
    }
  }

  private scheduleRender(): void {
    if (this.exiting || this.renderScheduled) {
      return;
    }
    this.renderScheduled = true;
    setTimeout(() => {
      this.renderScheduled = false;
      void this.render();
    }, RENDER_DEBOUNCE_MS);
  }

  private scheduleProtocolBatchRender(): void {
    if (this.pendingProtocolEvents > 0) {
      this.protocolBatchRenderRequested = true;
      return;
    }
    this.scheduleRender();
  }

  private startStartupAnimation(message: string): void {
    this.startupActive = true;
    this.startupMessage = message;
    this.startupStartedAt = Date.now();
    this.startupFrame = 0;
    if (this.startupTimer) {
      clearInterval(this.startupTimer);
    }
    this.startupTimer = setInterval(() => {
      this.startupFrame += 1;
      this.render();
    }, STARTUP_FRAME_MS);
  }

  private stopStartupAnimation(): void {
    if (this.startupTimer) {
      clearInterval(this.startupTimer);
      this.startupTimer = undefined;
    }
    this.startupActive = false;
  }

  private render(): Promise<void> {
    if (this.exiting) {
      return Promise.resolve();
    }
    if (this.startupActive) {
      this.renderer.render(
        createStartupRenderState({
          frame: this.startupFrame,
          message: this.startupMessage,
          debugLogPath: this.options.debugLogPath
        })
      );
      return Promise.resolve();
    }
    if (this.rendering) {
      this.renderAgain = true;
      return this.renderPromise ?? Promise.resolve();
    }
    this.rendering = true;
    const renderPromise = (async () => {
      try {
        do {
          this.renderAgain = false;
          const state = await this.buildRenderState();
          if (!this.exiting && !this.startupActive) {
            this.renderer.render(state);
          }
        } while (this.renderAgain && !this.exiting && !this.startupActive);
      } catch (error) {
        this.options.logger?.error({ err: error }, "failed to build render state");
        this.errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        this.rendering = false;
        this.renderPromise = undefined;
      }
    })();
    this.renderPromise = renderPromise;
    return renderPromise;
  }

  private async buildRenderState(): Promise<RenderState> {
    const conversations = await this.listVisibleConversations();
    // +1 for the "🔍搜索" item at the end of the list
    this.selectedConversationIndex = clampSelection(this.selectedConversationIndex, conversations.length + 1);
    const activeConversation = await this.getActiveConversation();
    const messages = activeConversation
      ? await this.store.listMessages(activeConversation.id, this.activeMessageLimit())
      : [];
    const searchResults = this.view === "search" ? await this.store.searchContacts(this.searchKeyword, this.options.searchLimit ?? 20) : [];
    this.selectedSearchIndex = clampSelection(this.selectedSearchIndex, searchResults.length);
    const unreadConversations = await this.listUnreadConversations();
    const switcherConversations = await this.listConversationSwitcherTargets(unreadConversations);
    this.syncConversationSwitcherSelection(switcherConversations);
    const totalUnreadCount = await this.store.totalUnreadCount();

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
      unreadConversations,
      switcherConversations,
      conversationSwitcherActive: !!this.selectedSwitcherConversationId,
      selectedSwitcherConversationId: this.selectedSwitcherConversationId
    };
  }

  private async listUnreadConversations(): Promise<ConversationRecord[]> {
    const unreadConversations = foldPublicConversations(await this.store.listUnreadConversations(20));
    return unreadConversations.filter(
      (conversation) => conversation.unreadCount > 0 && conversation.id !== this.activeConversationId
    );
  }

  private async listConversationSwitcherTargets(unreadConversations?: ConversationRecord[]): Promise<ConversationRecord[]> {
    unreadConversations ??= await this.listUnreadConversations();
    const targets = [...unreadConversations];
    const returnConversation = this.tabReturnConversationId ? await this.store.findConversationById(this.tabReturnConversationId) : undefined;
    if (
      returnConversation &&
      returnConversation.id !== this.activeConversationId &&
      !targets.some((conversation) => conversation.id === returnConversation.id)
    ) {
      targets.unshift(returnConversation);
    }
    return targets;
  }

  private syncConversationSwitcherSelection(switcherConversations: ConversationRecord[]): void {
    if (!this.selectedSwitcherConversationId) {
      return;
    }
    if (switcherConversations.length === 0) {
      this.selectedSwitcherConversationId = undefined;
      return;
    }
    if (!switcherConversations.some((conversation) => conversation.id === this.selectedSwitcherConversationId)) {
      this.selectedSwitcherConversationId = switcherConversations[0]?.id;
    }
  }

  private async getActiveConversation(): Promise<ConversationRecord | undefined> {
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
  private async resolveCurrentProtocolId(conversation: ConversationRecord): Promise<string | undefined> {
    return (await this.currentContactForConversation(conversation))?.protocolId ?? conversation.protocolId;
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
        void this.render();
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

  private async clampSearchSelection(): Promise<void> {
    const results = await this.store.searchContacts(this.searchKeyword, this.options.searchLimit ?? 20);
    this.selectedSearchIndex = clampSelection(this.selectedSearchIndex, results.length);
  }

  private async persistSessionData(): Promise<void> {
    const sessionData = this.protocol.getSessionData();
    if (sessionData !== undefined) {
      this.options.logger?.trace("persisting protocol session data");
      await this.store.setSessionData(sessionData);
    }
  }

  private async clearAppData(): Promise<void> {
    this.options.logger?.info("clearing app data (messages, contacts, logs)");
    await this.store.clearData();
    await Promise.all([this.clearLogFiles(), this.clearMediaCache()]);
    this.fileRegistry.clear();
    this.statusMessage = "data cleared";
    await this.render();
  }

  private async markAllConversationsRead(): Promise<void> {
    const unreadCount = await this.store.totalUnreadCount();
    await this.store.markAllRead();
    this.selectedSwitcherConversationId = undefined;
    this.tabReturnConversationId = undefined;
    this.statusMessage = unreadCount > 0 ? "all conversations marked read" : "no unread conversations";
  }

  private async clearLogFiles(): Promise<void> {
    const logDir = join(homedir(), ".wechat-tui", "logs");
    try {
      const files = await readdir(logDir);
      const currentLogPath = this.options.debugLogPath;
      await Promise.all(
        files.map(async (file) => {
          const filePath = join(logDir, file);
          // Skip the current log file (still in use)
          if (currentLogPath && filePath === currentLogPath) {
            return;
          }
          try {
            await rm(filePath);
          } catch {
            // Ignore files that disappear while clearing the directory.
          }
        })
      );
    } catch {
      this.options.logger?.debug("failed to clear log directory");
    }
  }

  private async clearMediaCache(): Promise<void> {
    const cacheDir = this.mediaCache.baseDir;
    try {
      await rm(cacheDir, { recursive: true, force: true });
    } catch {
      this.options.logger?.debug("failed to clear media cache directory");
    }
  }

  private async viewFileByHash(hash: string): Promise<void> {
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
    if (!(await fileExists(filePath))) {
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

function activeConversationMatchesInput(
  activeConversation: ConversationRecord | undefined,
  incomingConversation: ConversationInput
): boolean {
  return (
    !!activeConversation &&
    activeConversation.kind === incomingConversation.kind &&
    normalizedConversationName(activeConversation.kind, activeConversation.title) ===
      normalizedConversationName(incomingConversation.kind, incomingConversation.title)
  );
}

function contactMatchesConversationTitle(contact: ContactRecord, conversation: ConversationRecord): boolean {
  const title = normalizedConversationName(conversation.kind, conversation.title);
  return [contact.displayName, contact.remarkName, contact.nickName, contact.alias].some(
    (value) => normalizedConversationName(contact.kind, value) === title
  );
}

function normalizedConversationName(kind: ContactKind, value: string | undefined): string {
  return kind === "group" ? normalizeComparableGroupName(value) : normalizeComparableText(value);
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

function isLeftKey(key: UiKey): boolean {
  return key.name === "left";
}

function isRightKey(key: UiKey): boolean {
  return key.name === "right";
}

function isTabKey(key: UiKey): boolean {
  return key.name === "tab" || key.sequence === "\t";
}

function isEnterKey(key: UiKey): boolean {
  return key.name === "return" || key.name === "enter" || key.sequence === "\r" || key.sequence === "\n";
}

async function waitForMinimumStartup(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = startedAt + minimumMs - Date.now();
  if (remaining <= 0) {
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, remaining));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isEscapeKey(key: UiKey): boolean {
  return key.name === "escape" || key.sequence === "\u001b";
}

function isBackspaceKey(key: UiKey): boolean {
  return key.name === "backspace" || key.sequence === "\b" || key.sequence === "\u007f";
}

function printableText(key: UiKey): string {
  if (
    key.ctrl ||
    key.meta ||
    key.name === "up" ||
    key.name === "down" ||
    key.name === "left" ||
    key.name === "right" ||
    key.name === "tab"
  ) {
    return "";
  }
  if (isEnterKey(key) || isEscapeKey(key) || isBackspaceKey(key) || isTabKey(key)) {
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
