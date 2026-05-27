import { describe, expect, it } from "vitest";
import { renderState } from "../src/ui/workbench-renderer.js";
import { MessageList } from "../src/tui/components/message-list.js";
import type { RenderState } from "../src/types.js";

function baseState(overrides: Partial<RenderState>): RenderState {
  return {
    view: "chats",
    connectionState: "online",
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
    ...overrides
  };
}

describe("WorkbenchTerminalRenderer", () => {
  it("renders recent conversations with unread and group sender preview", () => {
    const output = renderState(
      baseState({
        conversations: [
          {
            id: "conversation:project",
            protocolId: "@@project",
            kind: "group",
            title: "Project A",
            unreadCount: 3,
            lastMessagePreview: "campaignId changed",
            lastMessageSenderName: "Alice",
            lastMessageIsSelf: false,
            lastMessageAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000
          }
        ],
        totalUnreadCount: 3
      })
    );

    expect(output).toContain("Recent Chats");
    expect(output).toContain("Project A");
    expect(output).toContain("Alice: campaignId changed");
    expect(output).toContain("select");
  });

  it("renders only the active chat body and summarizes other unread conversations", () => {
    const output = renderState(
      baseState({
        view: "chat",
        activeConversation: {
          id: "conversation:boss",
          protocolId: "@boss",
          kind: "private",
          title: "Boss",
          unreadCount: 0,
          updatedAt: 1_700_000_000_000
        },
        messages: [
          {
            id: "message:1",
            conversationId: "conversation:boss",
            senderId: "contact:boss",
            senderName: "Boss",
            isSelf: false,
            content: "meet at three",
            type: "text",
            timestamp: 1_700_000_000_000,
            createdAt: 1_700_000_000_000
          }
        ],
        unreadConversations: [
          {
            id: "conversation:project",
            protocolId: "@@project",
            kind: "group",
            title: "Project A",
            unreadCount: 2,
            lastMessagePreview: "hidden from body",
            lastMessageAt: 1_700_000_100_000,
            updatedAt: 1_700_000_100_000
          }
        ],
        totalUnreadCount: 2,
        chatInput: "ok"
      })
    );

    expect(output).toContain("Boss");
    expect(output).toContain("meet at three");
    expect(output).toContain("Project A(2)");
    expect(output).not.toContain("Boss > ok");
    expect(output).not.toContain("hidden from body");
  });

  it("renders attachment placeholders", () => {
    const output = renderState(
      baseState({
        view: "chat",
        activeConversation: {
          id: "conversation:boss",
          protocolId: "@boss",
          kind: "private",
          title: "Boss",
          unreadCount: 0,
          updatedAt: 1_700_000_000_000
        },
        messages: [
          {
            id: "message:1",
            conversationId: "conversation:boss",
            senderName: "Boss",
            isSelf: false,
            content: "<xml />",
            type: "image",
            timestamp: 1_700_000_000_000,
            createdAt: 1_700_000_000_000
          }
        ]
      })
    );

    expect(output).toContain("[image]");
    expect(output).not.toContain("<xml />");
  });

  it("renders older message list content when the chat scroll offset is above the bottom", () => {
    const activeConversation = {
      id: "conversation:boss",
      protocolId: "@boss",
      kind: "private" as const,
      title: "Boss",
      unreadCount: 0,
      updatedAt: 1_700_000_000_000
    };
    const messages = Array.from({ length: 8 }, (_, index) => ({
      id: `message:${index + 1}`,
      conversationId: activeConversation.id,
      senderName: "Boss",
      isSelf: false,
      content: `msg ${index + 1}`,
      type: "text" as const,
      timestamp: 1_700_000_000_000 + index,
      createdAt: 1_700_000_000_000 + index
    }));
    const list = new MessageList();

    const bottom = list.render(baseState({ view: "chat", activeConversation, messages }), 80, 6).join("\n");
    const older = list
      .render(baseState({ view: "chat", activeConversation, messages, messageScrollOffset: 6 }), 80, 6)
      .join("\n");

    expect(bottom).toContain("msg 8");
    expect(older).toContain("msg 6");
    expect(older).not.toContain("msg 8");
  });
});
