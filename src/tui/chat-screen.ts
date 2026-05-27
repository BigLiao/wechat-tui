import { theme, fit, fillLines } from "./theme.js";
import { Header } from "./components/header.js";
import { StatusBar, HINTS_CHAT } from "./components/status-bar.js";
import { MessageList } from "./components/message-list.js";
import { ChatEditor } from "./components/chat-editor.js";
import type { RenderState } from "../types.js";

export class ChatScreen {
  private readonly header = new Header();
  private readonly messages = new MessageList();
  private readonly statusBar = new StatusBar();

  constructor(private readonly editor: ChatEditor) {}

  render(state: RenderState, width: number, rows: number): string[] {
    // Fixed top: header with conversation title as subtitle
    const headerLines = this.header.render(state, state.activeConversation?.title ?? "", width);

    // Error messages
    const errorLines: string[] = [];
    if (state.errorMessage) {
      errorLines.push(fit(`  ${theme.error(state.errorMessage)}`, width));
    }

    // Content: messages
    const contentLines = this.messages.render(state, width, rows);

    // Unread from other conversations
    const otherUnread = unreadSummary(state);
    if (otherUnread) {
      contentLines.push("");
      contentLines.push(fit(`  ${theme.dim(otherUnread)}`, width));
    }

    // Fixed bottom: status bar + editor
    const editorLines = this.editor.render(width);
    const unreadText = state.totalUnreadCount > 0 ? `${state.totalUnreadCount} unread` : "";
    const bottomLines: string[] = [];
    bottomLines.push(this.statusBar.render(state, HINTS_CHAT, width, unreadText));
    bottomLines.push(...editorLines);

    // Layout: header → fill → error + content → bottom (bottom-aligned)
    const fixedCount = headerLines.length + errorLines.length + contentLines.length + bottomLines.length;
    const fill = fillLines(rows, fixedCount, 0, width);

    return [...headerLines, ...fill, ...errorLines, ...contentLines, ...bottomLines];
  }
}

function unreadSummary(state: RenderState): string {
  const items = state.unreadConversations
    .filter((c) => c.id !== state.activeConversation?.id && c.unreadCount > 0)
    .slice(0, 3)
    .map((c) => `${c.title}(${c.unreadCount})`);
  return items.length > 0 ? items.join(" · ") : "";
}
