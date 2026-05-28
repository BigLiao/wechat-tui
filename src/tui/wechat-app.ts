import { SelectList } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Component, SelectItem, SelectListTheme, TUI } from "@earendil-works/pi-tui";
import type { RenderState, UiEvent } from "../types.js";
import { theme } from "./theme.js";
import { LoginScreen } from "./login-screen.js";
import { ConversationScreen } from "./conversation-screen.js";
import { ChatScreen } from "./chat-screen.js";
import { ContactSearchScreen } from "./contact-search-screen.js";
import { ChatEditor } from "./components/chat-editor.js";
import { CommandPanel } from "./components/command-panel.js";
import { ConfirmPanel } from "./components/confirm-panel.js";
import type { FileRegistry } from "../util/file-hash.js";

const SEARCH_ITEM_VALUE = "__search__";

const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => theme.accent(text),
  selectedText: (text) => theme.accent(text),
  description: (text) => theme.dim(text),
  scrollInfo: (text) => theme.dim(text),
  noMatch: (text) => theme.dim(text)
};

function emptyState(): RenderState {
  return {
    view: "login",
    connectionState: "init",
    conversations: [],
    conversationQuery: "",
    selectedConversationIndex: 0,
    conversationFocus: "list",
    messages: [],
    searchKeyword: "",
    searchResults: [],
    selectedSearchIndex: 0,
    chatInput: "",
    messageScrollOffset: 0,
    commandInput: "",
    totalUnreadCount: 0,
    unreadConversations: []
  };
}

export class WechatApp implements Component {
  private state: RenderState = emptyState();
  private readonly loginScreen = new LoginScreen();
  private readonly conversationScreen = new ConversationScreen();
  private readonly chatScreen: ChatScreen;
  private readonly contactSearchScreen = new ContactSearchScreen();
  private readonly chatEditor: ChatEditor;
  private readonly commandPanel: CommandPanel;
  private readonly confirmPanel: ConfirmPanel;
  private commandPanelVisible = false;
  private confirmPanelVisible = false;
  private conversationList: SelectList;
  private conversationItems: SelectItem[] = [];
  private conversationListSignature = "";
  private fileRegistry?: FileRegistry;

  constructor(
    private readonly tui: TUI,
    private readonly onEvent: (event: UiEvent) => void
  ) {
    this.chatEditor = new ChatEditor(tui, onEvent);
    this.chatScreen = new ChatScreen(this.chatEditor);
    this.conversationList = this.createConversationList([], 5);
    this.commandPanel = new CommandPanel();
    this.commandPanel.onCommand = (command) => {
      this.hideCommandPanel();
      if (command === "/clear") {
        this.showConfirmPanel();
      } else {
        const name = command.startsWith("/") ? command.slice(1) : command;
        this.onEvent({ type: "key", key: { sequence: "", name: `command-${name}` } });
      }
    };
    this.commandPanel.onCancel = () => {
      this.hideCommandPanel();
    };
    this.confirmPanel = new ConfirmPanel();
    this.confirmPanel.onConfirm = () => {
      this.hideConfirmPanel();
      this.onEvent({ type: "key", key: { sequence: "", name: "command-clear" } });
    };
    this.confirmPanel.onCancel = () => {
      this.hideConfirmPanel();
    };
  }

  setState(state: RenderState): void {
    this.state = state;
    if (state.view === "chat") {
      this.commandPanelVisible = false;
      this.confirmPanelVisible = false;
      this.chatEditor.syncText(state.chatInput);
      this.tui.setFocus(this.chatEditor.focusTarget);
    } else if (state.view === "chats") {
      this.syncConversationList(state);
      if (!this.commandPanelVisible && !this.confirmPanelVisible) {
        this.tui.setFocus(this.conversationList);
      }
    } else {
      this.commandPanelVisible = false;
      this.confirmPanelVisible = false;
      this.tui.setFocus(null);
    }
  }

  private syncConversationList(state: RenderState): void {
    const items: SelectItem[] = state.conversations.map((c) => {
      const badge = c.unreadCount > 0 ? ` (${c.unreadCount})` : "";
      const label = `${c.title}${badge}`;
      const lastMessageSenderName =
        c.kind === "group" ? readableGroupSenderName(c.lastMessageSenderName) : c.lastMessageSenderName;
      const preview = c.lastMessagePreview
        ? ((c.kind === "group" || c.title === "公众号") && lastMessageSenderName
            ? `${c.lastMessageIsSelf ? "You" : lastMessageSenderName}: ${c.lastMessagePreview}`
            : c.lastMessageIsSelf ? `You: ${c.lastMessagePreview}` : c.lastMessagePreview)
        : undefined;
      return { value: c.id, label, description: preview ? truncatePreview(preview, 24) : undefined };
    });
    items.push({ value: SEARCH_ITEM_VALUE, label: "Search contacts", description: "/contacts" });

    const statusLineCount = (state.statusMessage ? 1 : 0) + (state.errorMessage ? 1 : 0);
    const listAreaHeight = Math.max(1, this.tui.terminal.rows - 3 - statusLineCount - 1);
    const maxVisible =
      items.length > listAreaHeight ? Math.max(1, listAreaHeight - 1) : Math.max(1, Math.min(items.length, listAreaHeight));
    const signature = conversationListSignature(items, maxVisible);
    if (signature !== this.conversationListSignature) {
      this.conversationItems = items;
      this.conversationList = this.createConversationList(items, maxVisible);
      this.conversationListSignature = signature;
    }
    this.conversationList.setSelectedIndex(state.selectedConversationIndex);
  }

  private createConversationList(items: SelectItem[], maxVisible: number): SelectList {
    const list = new SelectList(items, maxVisible, selectListTheme, {
      minPrimaryColumnWidth: 16,
      maxPrimaryColumnWidth: 40
    });
    list.onSelectionChange = (item) => {
      const index = this.conversationItems.findIndex((candidate) => candidate.value === item.value);
      if (index >= 0) {
        this.onEvent({ type: "conversation-select", index });
      }
    };
    list.onSelect = (item) => {
      this.onEvent({
        type: "conversation-open",
        conversationId: item.value === SEARCH_ITEM_VALUE ? undefined : item.value
      });
    };
    list.onCancel = () => {
      this.onEvent({ type: "key", key: { sequence: "\u001b", name: "escape" } });
    };
    return list;
  }

  isChatsView(): boolean {
    return this.state.view === "chats";
  }

  isChatView(): boolean {
    return this.state.view === "chat";
  }

  isChatAutocompleteActive(): boolean {
    return this.state.view === "chat" && this.state.chatInput.startsWith("/");
  }

  isCommandPanelVisible(): boolean {
    return this.commandPanelVisible || this.confirmPanelVisible;
  }

  showCommandPanel(): void {
    this.commandPanelVisible = true;
    this.confirmPanelVisible = false;
    this.tui.setFocus(this.commandPanel.focusTarget);
  }

  hideCommandPanel(): void {
    this.commandPanelVisible = false;
    this.tui.setFocus(this.conversationList);
  }

  showConfirmPanel(): void {
    this.confirmPanelVisible = true;
    this.tui.setFocus(this.confirmPanel.focusTarget);
  }

  hideConfirmPanel(): void {
    this.confirmPanelVisible = false;
    this.tui.setFocus(this.conversationList);
  }

  /**
   * Intercept bracketed paste data containing image file paths.
   * Returns transformed data (with image marker) or undefined if not an image path.
   */
  transformPasteInput(data: string): string | undefined {
    return this.chatEditor.transformPasteData(data);
  }

  setFileRegistry(registry: FileRegistry): void {
    this.fileRegistry = registry;
  }

  invalidate(): void {
    this.chatEditor.invalidate();
    this.conversationList.invalidate();
    this.commandPanel.invalidate();
    this.confirmPanel.invalidate();
  }

  render(width: number): string[] {
    const rows = this.tui.terminal.rows;
    switch (this.state.view) {
      case "login":
        return this.loginScreen.render(this.state, width, rows);
      case "chats": {
        const overlay = this.confirmPanelVisible ? this.confirmPanel : this.commandPanelVisible ? this.commandPanel : undefined;
        return this.conversationScreen.render(this.state, width, rows, this.conversationList, overlay);
      }
      case "chat":
        return this.chatScreen.render(this.state, width, rows, this.fileRegistry);
      case "search":
        return this.contactSearchScreen.render(this.state, width, rows);
    }
  }
}

function conversationListSignature(items: SelectItem[], maxVisible: number): string {
  return JSON.stringify({
    maxVisible,
    items: items.map((item) => [item.value, item.label, item.description ?? ""])
  });
}

function readableGroupSenderName(input: string | undefined): string {
  const name = input?.trim();
  if (!name || name === "Unknown" || name.startsWith("@")) {
    return "Group member";
  }
  return name;
}

function truncatePreview(input: string, maxWidth: number): string {
  const text = input.replace(/\s+/g, " ").trim();
  if (visibleWidth(text) <= maxWidth) {
    return text;
  }

  const ellipsis = "...";
  const targetWidth = Math.max(0, maxWidth - visibleWidth(ellipsis));
  let result = "";
  let width = 0;
  for (const { segment } of new Intl.Segmenter().segment(text)) {
    const nextWidth = visibleWidth(segment);
    if (width + nextWidth > targetWidth) {
      break;
    }
    result += segment;
    width += nextWidth;
  }
  return `${result}${ellipsis}`;
}
