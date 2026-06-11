import type { RenderState } from "./types.js";

export interface StartupStateOptions {
  frame?: number;
  message?: string;
  debugLogPath?: string;
}

export function createStartupRenderState(options: StartupStateOptions = {}): RenderState {
  return {
    view: "startup",
    connectionState: "init",
    statusMessage: options.message ?? "Opening WeChat TUI...",
    debugLogPath: options.debugLogPath,
    startupFrame: options.frame ?? 0,
    startupMessage: options.message,
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
    unreadConversations: [],
    switcherConversations: [],
    conversationSwitcherActive: false
  };
}
