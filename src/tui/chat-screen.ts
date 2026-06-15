import { theme, fit, fillLines } from "./theme.js";
import { Header } from "./components/header.js";
import { StatusBar, HINTS_CHAT, HINTS_CHAT_SWITCHER } from "./components/status-bar.js";
import { MessageList } from "./components/message-list.js";
import { ChatEditor } from "./components/chat-editor.js";
import type { RenderState } from "../types.js";
import type { FileRegistry } from "../util/file-hash.js";

export class ChatScreen {
  private readonly header = new Header();
  private readonly messages = new MessageList();
  private readonly statusBar = new StatusBar();

  constructor(private readonly editor: ChatEditor) {}

  render(state: RenderState, width: number, rows: number, fileRegistry?: FileRegistry): string[] {
    // Fixed top: header with conversation title as subtitle
    const headerLines = this.header.render(state, state.activeConversation?.title ?? "", width);

    // Error messages
    const errorLines: string[] = [];
    if (state.errorMessage) {
      errorLines.push(fit(`  ${theme.error(state.errorMessage)}`, width));
    }

    // Unread from other conversations
    const otherUnread = unreadSummary(state);
    const otherUnreadLines = otherUnread ? ["", fit(`  ${otherUnread}`, width)] : [];

    // Fixed bottom: status bar + editor
    const editorLines = this.editor.render(width);
    const hints = state.conversationSwitcherActive ? HINTS_CHAT_SWITCHER : HINTS_CHAT;
    const unreadText = state.totalUnreadCount > 0 ? `${state.totalUnreadCount} unread` : "";
    const bottomLines: string[] = [];
    bottomLines.push(this.statusBar.render(state, hints, width, unreadText));
    bottomLines.push(...editorLines);

    // Content: messages, sized to the remaining viewport above the fixed bottom.
    const messageRows = Math.max(
      1,
      rows - headerLines.length - errorLines.length - otherUnreadLines.length - bottomLines.length
    );
    const contentLines = this.messages.render(state, width, messageRows, fileRegistry);

    // Layout: header → fill → error + content → bottom (bottom-aligned)
    const fixedCount =
      headerLines.length + errorLines.length + contentLines.length + otherUnreadLines.length + bottomLines.length;
    const fill = fillLines(rows, fixedCount, 0, width);

    return [...headerLines, ...fill, ...errorLines, ...contentLines, ...otherUnreadLines, ...bottomLines];
  }
}

function unreadSummary(state: RenderState): string {
  const conversations = state.switcherConversations.filter(
    (c) => c.id !== state.activeConversation?.id && (state.conversationSwitcherActive || c.unreadCount > 0)
  );
  const selectedConversationId = state.conversationSwitcherActive ? state.selectedSwitcherConversationId : undefined;
  const items = conversations
    .slice(0, state.conversationSwitcherActive ? conversations.length : 3)
    .map((c) => {
      const label = c.unreadCount > 0 ? `${c.title}(${c.unreadCount})` : c.title;
      return c.id === selectedConversationId ? theme.unreadActive(` ${label} `) : theme.dim(label);
    });
  return items.length > 0 ? items.join(theme.dim(" · ")) : "";
}
