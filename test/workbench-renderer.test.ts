import { afterEach, describe, expect, it, vi } from "vitest";
import chalk from "chalk";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import type { Terminal } from "@earendil-works/pi-tui";
import { WorkbenchTerminalRenderer, renderState } from "../src/ui/workbench-renderer.js";
import { MessageList } from "../src/tui/components/message-list.js";
import { CommandPanel } from "../src/tui/components/command-panel.js";
import { ConfirmPanel } from "../src/tui/components/confirm-panel.js";
import { theme } from "../src/tui/theme.js";
import { FileRegistry } from "../src/util/file-hash.js";
import { createStartupRenderState } from "../src/startup-state.js";
import type { RenderState, UiEvent } from "../src/types.js";

const defaultChalkLevel = chalk.level;

function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*m/g, "");
}

function baseState(overrides: Partial<RenderState>): RenderState {
  const unreadConversations = overrides.unreadConversations ?? [];
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
    unreadConversations,
    switcherConversations: overrides.switcherConversations ?? unreadConversations,
    conversationSwitcherActive: false,
    ...overrides
  };
}

describe("WorkbenchTerminalRenderer", () => {
  afterEach(() => {
    vi.useRealTimers();
    chalk.level = defaultChalkLevel;
  });

  it("ignores Kitty key release events before they reach runtime handlers", () => {
    const terminal = new InputTerminal();
    const events: UiEvent[] = [];
    const renderer = new WorkbenchTerminalRenderer(terminal);

    renderer.start((event) => events.push(event), () => {});
    terminal.send("\x1b[1;1:1A");
    terminal.send("\x1b[1;1:3A");
    renderer.stop();

    expect(events).toEqual([{ type: "key", key: { sequence: "\x1b[1;1:1A", name: "up" } }]);
  });

  it("suppresses immediate duplicate navigation keys before SelectList handles them", () => {
    const terminal = new InputTerminal();
    const events: UiEvent[] = [];
    const renderer = new WorkbenchTerminalRenderer(terminal);

    renderer.start((event) => events.push(event), () => {});
    renderer.render(
      baseState({
        conversations: [
          {
            id: "conversation:alpha",
            protocolId: "@alpha",
            kind: "private",
            title: "Alpha",
            unreadCount: 0,
            updatedAt: 1_700_000_000_000
          },
          {
            id: "conversation:beta",
            protocolId: "@beta",
            kind: "private",
            title: "Beta",
            unreadCount: 0,
            updatedAt: 1_700_000_000_001
          }
        ]
      })
    );

    terminal.send("\x1b[B");
    terminal.send("\x1b[B");
    renderer.stop();

    expect(events).toEqual([{ type: "conversation-select", index: 1 }]);
  });

  it("updates the terminal tab title with unread counts", () => {
    const terminal = new InputTerminal();
    const renderer = new WorkbenchTerminalRenderer(terminal);

    renderer.start(() => {}, () => {});
    expect(terminal.titles).toEqual(["WeChat"]);

    renderer.render(baseState({ totalUnreadCount: 2 }));
    renderer.render(baseState({ totalUnreadCount: 2 }));
    expect(terminal.titles).toEqual(["WeChat", "WeChat (2)"]);

    renderer.stop();
    expect(terminal.titles).toEqual(["WeChat", "WeChat (2)", "WeChat"]);
  });

  it("renders the animated startup moon scene", () => {
    const output = renderState(
      createStartupRenderState({
        frame: 1,
        message: "Preparing local data..."
      }),
      { width: 72, rows: 24 }
    );

    const plain = stripAnsi(output);
    expect(plain).toContain("WECHAT TUI");
    expect(plain).toContain("Preparing local data");
    expect(plain).toContain("/|\\");
    expect(plain).toContain("_________./___\\.");
  });

  it("forwards tab from the chat editor to runtime", () => {
    const terminal = new InputTerminal();
    const events: UiEvent[] = [];
    const renderer = new WorkbenchTerminalRenderer(terminal);

    renderer.start((event) => events.push(event), () => {});
    renderer.render(
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
        switcherConversations: [
          {
            id: "conversation:project",
            protocolId: "@@project",
            kind: "group",
            title: "Project A",
            unreadCount: 2,
            updatedAt: 1_700_000_100_000
          }
        ],
        totalUnreadCount: 2
      })
    );

    terminal.send("\t");
    renderer.stop();

    expect(events).toEqual([{ type: "key", key: { sequence: "\t", name: "tab" } }]);
  });

  it("consumes tab before autocomplete when the chat input is empty and there are no unread conversations", () => {
    const terminal = new InputTerminal();
    const events: UiEvent[] = [];
    const renderer = new WorkbenchTerminalRenderer(terminal);

    renderer.start((event) => events.push(event), () => {});
    renderer.render(
      baseState({
        view: "chat",
        activeConversation: {
          id: "conversation:boss",
          protocolId: "@boss",
          kind: "private",
          title: "Boss",
          unreadCount: 0,
          updatedAt: 1_700_000_000_000
        }
      })
    );

    terminal.send("\t");
    renderer.stop();

    expect(events).toEqual([]);
  });

  it("forwards tab when the only switcher target is the remembered previous chat", () => {
    const terminal = new InputTerminal();
    const events: UiEvent[] = [];
    const renderer = new WorkbenchTerminalRenderer(terminal);

    renderer.start((event) => events.push(event), () => {});
    renderer.render(
      baseState({
        view: "chat",
        activeConversation: {
          id: "conversation:project",
          protocolId: "@@project",
          kind: "group",
          title: "Project A",
          unreadCount: 0,
          updatedAt: 1_700_000_100_000
        },
        switcherConversations: [
          {
            id: "conversation:boss",
            protocolId: "@boss",
            kind: "private",
            title: "Boss",
            unreadCount: 0,
            updatedAt: 1_700_000_000_000
          }
        ]
      })
    );

    terminal.send("\t");
    renderer.stop();

    expect(events).toEqual([{ type: "key", key: { sequence: "\t", name: "tab" } }]);
  });

  it("forwards conversation switcher controls instead of focusing the chat editor", () => {
    const terminal = new InputTerminal();
    const events: UiEvent[] = [];
    const renderer = new WorkbenchTerminalRenderer(terminal);

    renderer.start((event) => events.push(event), () => {});
    renderer.render(
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
        unreadConversations: [
          {
            id: "conversation:project",
            protocolId: "@@project",
            kind: "group",
            title: "Project A",
            unreadCount: 2,
            updatedAt: 1_700_000_100_000
          }
        ],
        totalUnreadCount: 2,
        conversationSwitcherActive: true,
        selectedSwitcherConversationId: "conversation:project"
      })
    );

    terminal.send("\x1b[C");
    terminal.send("\r");
    renderer.stop();

    expect(events).toEqual([
      { type: "key", key: { sequence: "\x1b[C", name: "right" } },
      { type: "key", key: { sequence: "\r", name: "return" } }
    ]);
  });

  it("renders recent conversations with unread and group sender preview", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2023, 10, 15, 7, 0));
    const lastMessageAt = new Date(2023, 10, 15, 6, 13).getTime();
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
            lastMessageAt,
            updatedAt: lastMessageAt
          }
        ],
        totalUnreadCount: 3
      })
    );

    expect(output).toContain("Recent Chats");
    expect(output).toContain("Project A");
    expect(stripAnsi(output)).toContain("[06:13] Alice: campaignId changed");
    expect(output).toContain("select");
  });

  it("renders update notifications at the top of the screen", () => {
    const output = renderState(
      baseState({
        updateInfo: {
          packageName: "wechat-tui",
          currentVersion: "0.1.1",
          latestVersion: "0.1.2",
          installCommand: "npm install -g wechat-tui@latest"
        }
      })
    );

    const plain = stripAnsi(output);
    expect(plain).toContain("Update available");
    expect(plain).toContain("0.1.1 -> 0.1.2");
    expect(plain).toContain("npm install -g wechat-tui@latest");
  });

  it("renders home overlays as separated panels", () => {
    const commands = new CommandPanel().render(80);
    const confirm = new ConfirmPanel().render(80);
    const commandPlain = stripAnsi(commands.join("\n"));
    const confirmPlain = stripAnsi(confirm.join("\n"));

    expect(commands[0]?.trim()).toBe("");
    expect(commands.at(-1)?.trim()).toBe("");
    expect(commandPlain).toContain("Commands");
    expect(commandPlain).toContain("/contacts");
    expect(commandPlain).toContain("/readall");
    expect(confirm[0]?.trim()).toBe("");
    expect(confirm.at(-1)?.trim()).toBe("");
    expect(confirmPlain).toContain("Confirm");
    expect(confirmPlain).toContain("Yes, clear data");
  });

  it("renders relative message times before conversation previews", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2023, 10, 16, 7, 0));
    const lastMessageAt = new Date(2023, 10, 15, 6, 13).getTime();
    const output = renderState(
      baseState({
        conversations: [
          {
            id: "conversation:boss",
            protocolId: "@boss",
            kind: "private",
            title: "Boss",
            unreadCount: 0,
            lastMessagePreview: "[link] 这是一个很长的链接标题",
            lastMessageAt,
            updatedAt: lastMessageAt
          }
        ]
      })
    );

    const plain = stripAnsi(output);
    expect(plain).toContain("[昨天 06:13] [link] 这是一个很长的链接标题");
  });

  it("renders chat message times with relative date labels", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2023, 10, 16, 0, 5));
    const output = renderState(
      baseState({
        view: "chat",
        activeConversation: {
          id: "conversation:boss",
          protocolId: "@boss",
          kind: "private",
          title: "Boss",
          unreadCount: 0,
          updatedAt: new Date(2023, 10, 16, 0, 1).getTime()
        },
        messages: [
          {
            id: "message:today",
            conversationId: "conversation:boss",
            senderName: "Boss",
            isSelf: false,
            content: "today",
            type: "text",
            timestamp: new Date(2023, 10, 16, 0, 1).getTime(),
            createdAt: new Date(2023, 10, 16, 0, 1).getTime()
          },
          {
            id: "message:yesterday",
            conversationId: "conversation:boss",
            senderName: "Boss",
            isSelf: false,
            content: "yesterday",
            type: "text",
            timestamp: new Date(2023, 10, 15, 23, 59).getTime(),
            createdAt: new Date(2023, 10, 15, 23, 59).getTime()
          },
          {
            id: "message:older",
            conversationId: "conversation:boss",
            senderName: "Boss",
            isSelf: false,
            content: "older",
            type: "text",
            timestamp: new Date(2023, 10, 14, 6, 13).getTime(),
            createdAt: new Date(2023, 10, 14, 6, 13).getTime()
          }
        ]
      }),
      { width: 100, rows: 32 }
    );

    const plain = stripAnsi(output);
    expect(plain).toContain("[00:01] Boss");
    expect(plain).toContain("[昨天 23:59] Boss");
    expect(plain).toContain("[11月14日 06:13] Boss");
  });

  it("truncates long conversation titles with an ellipsis", () => {
    const longTitle = "Very Long Conversation Title With Enough Details To Require Truncation";
    const output = renderState(
      baseState({
        conversations: [
          {
            id: "conversation:long",
            protocolId: "@long",
            kind: "private",
            title: longTitle,
            unreadCount: 8,
            lastMessagePreview: "short preview",
            lastMessageAt: new Date(2023, 10, 15, 6, 13).getTime(),
            updatedAt: new Date(2023, 10, 15, 6, 13).getTime()
          }
        ]
      }),
      { width: 72 }
    );

    const plain = stripAnsi(output);
    expect(plain).toContain("Very Long Conversation Title With Enough Details");
    expect(plain).toContain("… (8)");
    expect(plain).not.toContain(longTitle);
  });

  it("renders sparse group preview senders with a readable fallback", () => {
    const output = renderState(
      baseState({
        conversations: [
          {
            id: "conversation:project",
            protocolId: "@@project",
            kind: "group",
            title: "Project A",
            unreadCount: 0,
            lastMessagePreview: "[sticker]",
            lastMessageSenderName: "@sparse-group-sender",
            lastMessageIsSelf: false,
            lastMessageAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000
          }
        ]
      })
    );

    const plain = stripAnsi(output);
    expect(plain).toContain("Group member: [sticker]");
    expect(plain).not.toContain("@sparse-group-sender");
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

  it("renders conversation switcher hints, background highlight, and keeps the chat input visible", () => {
    chalk.level = 1;
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
            content: "meet at three",
            type: "text",
            timestamp: 1_700_000_000_000,
            createdAt: 1_700_000_000_000
          }
        ],
        switcherConversations: [
          {
            id: "conversation:project",
            protocolId: "@@project",
            kind: "group",
            title: "Project A",
            unreadCount: 2,
            updatedAt: 1_700_000_100_000
          },
          {
            id: "conversation:ops",
            protocolId: "@ops",
            kind: "private",
            title: "Ops",
            unreadCount: 1,
            updatedAt: 1_700_000_090_000
          },
          {
            id: "conversation:archive",
            protocolId: "@archive",
            kind: "private",
            title: "Archive",
            unreadCount: 0,
            updatedAt: 1_700_000_080_000
          }
        ],
        totalUnreadCount: 3,
        chatInput: "draft text",
        conversationSwitcherActive: true,
        selectedSwitcherConversationId: "conversation:project"
      })
    );

    const plain = stripAnsi(output);
    expect(output).toContain(theme.unreadActive(" Project A(2) "));
    expect(plain).toContain("Ops(1)");
    expect(plain).toContain("Archive");
    expect(plain).not.toContain("Archive(0)");
    expect(plain).toContain("⏎ confirm");
    expect(plain).toContain("Esc cancel");
    expect(plain).not.toContain("←→ switch");
    expect(plain).not.toContain("⏎ send");
    expect(plain).toContain("draft text");
  });

  it("does not render remembered return targets as unread before tab is pressed again", () => {
    const output = renderState(
      baseState({
        view: "chat",
        activeConversation: {
          id: "conversation:project",
          protocolId: "@@project",
          kind: "group",
          title: "Project A",
          unreadCount: 0,
          updatedAt: 1_700_000_100_000
        },
        messages: [
          {
            id: "message:1",
            conversationId: "conversation:project",
            senderName: "Mock Member",
            isSelf: false,
            content: "field changed",
            type: "text",
            timestamp: 1_700_000_100_000,
            createdAt: 1_700_000_100_000
          }
        ],
        switcherConversations: [
          {
            id: "conversation:boss",
            protocolId: "@boss",
            kind: "private",
            title: "Boss",
            unreadCount: 0,
            updatedAt: 1_700_000_000_000
          }
        ]
      })
    );

    const plain = stripAnsi(output);
    expect(plain).not.toContain("Boss");
    expect(plain).not.toContain("Boss(0)");
    expect(plain).not.toContain("⏎ confirm");
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

  it("renders media placeholders with a muted theme color", () => {
    chalk.level = 1;
    const activeConversation = {
      id: "conversation:boss",
      protocolId: "@boss",
      kind: "private" as const,
      title: "Boss",
      unreadCount: 0,
      updatedAt: 1_700_000_000_000
    };
    const message = {
      id: "message:image",
      conversationId: activeConversation.id,
      senderName: "Boss",
      isSelf: false,
      content: "<xml />",
      type: "image" as const,
      timestamp: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
      raw: { localFilePath: "/tmp/wechat-tui-image.png" }
    };
    const fileRegistry = new FileRegistry();
    const hash = fileRegistry.register(activeConversation.id, message.id, message.raw.localFilePath);

    const output = new MessageList()
      .render(baseState({ view: "chat", activeConversation, messages: [message] }), 80, 8, fileRegistry)
      .join("\n");

    expect(stripAnsi(output)).toContain(`[image #${hash}]`);
    expect(output).toContain(theme.media(`[image #${hash}]`));
    expect(output).not.toContain(theme.dim(`[image #${hash}]`));
  });

  it("renders stored recalled notices from raw protocol data", () => {
    const output = renderState(
      baseState({
        view: "chat",
        activeConversation: {
          id: "conversation:one",
          protocolId: "@one",
          kind: "private",
          title: "Test Contact",
          unreadCount: 0,
          updatedAt: 1_700_000_000_000
        },
        messages: [
          {
            id: "message:1",
            conversationId: "conversation:one",
            senderName: "Test Contact",
            isSelf: false,
            content: "wxid_test_contact\n\t\told-message-id\n\t\tmessage-id",
            type: "notice",
            timestamp: 1_700_000_000_000,
            createdAt: 1_700_000_000_000,
            raw: {
              MsgType: 10002,
              Content:
                '<sysmsg type="revokemsg"><revokemsg><session>wxid_test_contact</session><oldmsgid>old-message-id</oldmsgid><msgid>message-id</msgid><replacemsg><![CDATA["Test Contact" recalled a message]]></replacemsg></revokemsg></sysmsg>'
            }
          }
        ]
      })
    );

    const plain = stripAnsi(output);
    expect(plain).toContain('"Test Contact" recalled a message');
    expect(plain).not.toContain("wxid_test_contact");
    expect(plain).not.toContain("message-id");
  });

  it("renders sparse group message senders with a readable fallback", () => {
    const output = renderState(
      baseState({
        view: "chat",
        activeConversation: {
          id: "conversation:project",
          protocolId: "@@project",
          kind: "group",
          title: "Project A",
          unreadCount: 0,
          updatedAt: 1_700_000_000_000
        },
        messages: [
          {
            id: "message:1",
            conversationId: "conversation:project",
            senderName: "@sparse-group-sender",
            isSelf: false,
            content: "[sticker]",
            type: "sticker",
            timestamp: 1_700_000_000_000,
            createdAt: 1_700_000_000_000
          }
        ]
      })
    );

    const plain = stripAnsi(output);
    expect(plain).toContain("Group member");
    expect(plain).toContain("[sticker]");
    expect(plain).not.toContain("@sparse-group-sender");
  });

  it("anchors the search prompt cursor for IME input", () => {
    const output = renderState(
      baseState({
        view: "search",
        searchKeyword: "测试",
        searchResults: [
          {
            id: "contact:one",
            protocolId: "@one",
            kind: "private",
            displayName: "测试联系人",
            isSelf: false,
            updatedAt: 1_700_000_000_000
          }
        ]
      })
    );

    expect(output).toContain(`search ▸ 测试${CURSOR_MARKER}`);
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

class InputTerminal implements Terminal {
  readonly columns = 80;
  readonly rows = 24;
  readonly kittyProtocolActive = true;
  readonly titles: string[] = [];
  private input?: (data: string) => void;

  start(onInput: (data: string) => void): void {
    this.input = onInput;
  }
  stop(): void {
    this.input = undefined;
  }
  async drainInput(): Promise<void> {}
  send(data: string): void {
    this.input?.(data);
  }
  write(): void {}
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(title: string): void {
    this.titles.push(title);
  }
  setProgress(): void {}
}
