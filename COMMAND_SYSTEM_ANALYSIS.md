# WeChat TUI Command System Architecture

## Overview

This is a **WeChat Terminal User Interface (TUI)** application built with TypeScript using the `@earendil-works/pi-tui` framework. The application has a slash-command system integrated into its chat interface, allowing users to perform various operations via keyboard commands.

---

## Project Structure

```
src/
├── tui/                          # Terminal UI Components
│   ├── wechat-app.ts            # Main app component (screens manager)
│   ├── chat-screen.ts           # Chat view screen
│   ├── conversation-screen.ts   # Home/conversation list view
│   ├── contact-search-screen.ts # Contact search view
│   ├── login-screen.ts          # Login view
│   ├── theme.ts                 # Theme/styling
│   ├── components/
│   │   ├── chat-editor.ts       # Chat input component (COMMAND DEFINITIONS)
│   │   ├── message-list.ts      # Message list display
│   │   ├── header.ts            # Screen header
│   │   ├── status-bar.ts        # Status bar with hints
│   │   └── contact-picker.ts    # Contact picker modal
│   └── ...
├── runtime.ts                   # Runtime state machine (COMMAND EXECUTION)
├── types.ts                     # Type definitions
├── config.ts                    # CLI config & help text
├── protocol/                    # Protocol adapters (WeChat protocol)
├── store/                       # Message store (SQLite)
└── util/                        # Utilities
```

---

## Application Architecture

### Views/Screens

The application has 4 main views (screens):

1. **"login"** - Login screen with QR code
2. **"chats"** - Conversation/session list (home page)
3. **"chat"** - Active chat message view with input editor
4. **"search"** - Contact/conversation search results

### Data Flow

```
User Input (Terminal)
    ↓
WechatApp.transformPasteInput() / ChatEditor.handleInput()
    ↓
UiEvent (type: "key", "chat-submit", "chat-change", etc.)
    ↓
Runtime.handleUiEvent() → Runtime.handleKey() or Runtime.submitChatText()
    ↓
If command: Runtime.executeCommand()
If message: Protocol.sendText() → MessageStore.saveMessage()
    ↓
Runtime.render() → RenderState
    ↓
WechatApp.setState() → Screen.render()
    ↓
Terminal Display
```

---

## Command System

### 1. Command Definitions

**Location**: `src/tui/components/chat-editor.ts` (lines 12-22)

Commands are defined as an array of objects with `name` and `description`:

```typescript
const COMMANDS = [
  { name: "send", description: "Send a file (image, video, doc)" },
  { name: "paste", description: "Send clipboard image" },
  { name: "contacts", description: "Search contacts and groups" },
  { name: "chats", description: "Return to recent chats" },
  { name: "status", description: "Show connection status" },
  { name: "refresh", description: "Refresh local contacts" },
  { name: "load", description: "Load local history" },
  { name: "messages", description: "Search local messages" },
  { name: "quit", description: "Quit wechat-tui" }
];
```

These are passed to an autocomplete provider in the chat editor:
```typescript
this.focusTarget.setAutocompleteProvider(
  new CombinedAutocompleteProvider(COMMANDS, process.cwd())
);
```

### 2. Command Execution Flow

**Location**: `src/runtime.ts` (lines 416-476)

#### Entry Point: `submitChatText()`

When user presses Enter in the chat editor:

```typescript
private async submitChatText(rawText: string): Promise<void> {
  const text = rawText.trim();
  this.chatInput = "";
  this.messageScrollOffset = 0;
  if (!text) {
    return;
  }
  if (text.startsWith("/")) {
    await this.executeCommand(text, "chat");  // ← Command execution
    return;
  }
  await this.sendToActiveConversation(text);  // ← Regular message
}
```

#### Command Parser: `executeCommand()`

```typescript
private async executeCommand(rawCommand: string, sourceView: AppView): Promise<void> {
  const command = rawCommand.trim();
  const name = command.split(/\s+/, 1)[0] ?? "";  // Extract command name
  this.options.logger?.debug({ command: preview(command), sourceView }, "executing UI command");
  
  // Reset state if called from "chats" view
  if (sourceView === "chats") {
    this.conversationQuery = "";
    this.selectedConversationIndex = 0;
  }

  switch (name) {
    // Command handling...
  }
}
```

### 3. Available Commands

#### `/contacts`
- **Description**: Search contacts and groups
- **Implementation**: Calls `this.enterContactSearch(sourceView)`
- **Behavior**: Switches to search view, allows filtering contacts
- **Type**: Navigation/Search

#### `/chats`
- **Description**: Return to recent chats
- **Implementation**: Sets `this.view = "chats"`
- **Behavior**: Returns to conversation list
- **Type**: Navigation

#### `/status`
- **Description**: Show connection status
- **Implementation**: Updates `statusMessage` with connection state and account name
- **Output Example**: `"connection: online, account: My Account"`
- **Type**: Info/Diagnostic

#### `/refresh`
- **Description**: Refresh local contacts
- **Implementation**: Calls `protocol.getContacts()`, upserts to store
- **Behavior**: Updates local contact cache from protocol
- **Status**: Updates statusMessage with contact count
- **Type**: Data Sync

#### `/load`
- **Description**: Load local history
- **Implementation**: Just displays status message
- **Status**: `"local history is loaded from the message store"`
- **Type**: Info (Not fully implemented)

#### `/messages`
- **Description**: Search local messages
- **Implementation**: Sets errorMessage
- **Error**: `"/messages local message search is not implemented yet"`
- **Type**: Placeholder (Not implemented)

#### `/send <file-path>`
- **Description**: Send a file (image, video, doc)
- **Implementation**: Calls `sendFileToActiveConversation(filePath)`
- **Usage**: `/send ~/path/to/image.png`
- **Behavior**: 
  - Validates file exists
  - Detects file type (image/video/file)
  - Sends via protocol
  - Saves to message store
- **Type**: File Operation

#### `/paste`
- **Description**: Send clipboard image
- **Implementation**: Calls `extractClipboardImage()` then `sendFileToActiveConversation()`
- **Platform Support**: macOS (osascript), Linux (xclip)
- **Behavior**: Extracts image from clipboard, sends as message
- **Type**: File Operation

#### `/quit`
- **Description**: Quit wechat-tui
- **Implementation**: Calls `this.requestExit()`
- **Behavior**: Graceful shutdown
- **Type**: Control

---

## Event System

### Event Types

**Location**: `src/types.ts` (lines 155-161)

```typescript
export type UiEvent =
  | { type: "key"; key: UiKey }
  | { type: "conversation-select"; index: number }
  | { type: "conversation-open"; conversationId?: string }
  | { type: "chat-change"; text: string }          // Text input changed
  | { type: "chat-submit"; text: string }          // Enter pressed
  | { type: "file-submit"; filePath: string };     // File submission
```

### Event Routing

**Location**: `src/runtime.ts` (lines 91-139)

```typescript
async handleUiEvent(event: UiEvent): Promise<void> {
  if (event.type === "key") {
    await this.handleKey(event.key);
    return;
  }
  // ... other event types
  if (event.type === "chat-change") {
    this.chatInput = event.text;
  } else if (event.type === "file-submit") {
    await this.sendFileToActiveConversation(event.filePath);
  } else {
    await this.submitChatText(event.text);  // ← chat-submit lands here
  }
}
```

---

## Component Architecture

### ChatEditor Component

**Location**: `src/tui/components/chat-editor.ts`

Responsible for:
- Input capture and validation
- Image paste detection and transformation
- Autocomplete suggestion (slash commands + file paths)
- Text submission handling
- Image attachment tracking

Key Features:
```typescript
// Autocomplete with commands and file paths
this.focusTarget.setAutocompleteProvider(
  new CombinedAutocompleteProvider(COMMANDS, process.cwd())
);

// Image detection for pasted file paths
transformPasteData(data: string): string | undefined
  → Converts image file paths to [Image #N] markers

// Handles image attachments
imageAttachments: Map<number, string>
```

### Chat Screen Component

**Location**: `src/tui/chat-screen.ts`

Renders:
- Header with conversation title
- Error messages
- Message list (scrollable)
- Unread count from other conversations
- Status bar with hints
- Chat editor

### Conversation Screen Component

**Location**: `src/tui/conversation-screen.ts`

Renders:
- Header with "Recent Chats"
- Status/error messages
- SelectList of conversations (filterable)
- Search item at bottom ("/contacts")
- Status bar with hints

### Status Bar Component

**Location**: `src/tui/components/status-bar.ts`

Displays:
- Context-specific key hints
- Unread count badge (right-aligned)

**Hint Sets**:
```typescript
HINTS_CONVERSATION = ["↑↓ select", "⏎ open", "⎋ quit"]
HINTS_CHAT = ["⏎ send", "⎋ back", "↑↓ scroll"]
HINTS_SEARCH = ["↑↓ select", "⏎ open", "⎋ back"]
HINTS_LOGIN = ["scan QR to login", "q quit"]
```

---

## User Interface

### Chat View Controls

**Location**: `src/config.ts` (help text)

```
Controls:
  chats:   type to filter local chats, Up/Down select, Enter open, /contacts, Esc/q quit
  chat:    Chat > text, Enter send, Up/Down scroll messages, Esc chats, slash commands autocomplete
  search:  Search > keyword, Up/Down select, Enter open, Esc back
```

### Commands in Help

```
Commands:
  /contacts  search contacts and groups
  /chats     return to recent chats
  /status    show connection status
  /refresh   refresh local contacts
  /load      load local history
  /messages  search local messages
  /quit      quit
```

Note: `/send` and `/paste` are not listed in help but are fully functional.

---

## Key Handlers

**Location**: `src/runtime.ts` (lines 141-414)

### handleChatKey()

Processes keyboard input while in "chat" view:
- Escape: Return to chats
- Up/Down: Scroll messages
- Enter: Submit text (triggers command or message)
- Backspace: Delete character
- Printable chars: Append to input

### handleConversationListKey()

Processes keyboard input while in "chats" view:
- Cmd+Contact (key.name === "command-contacts"): Search contacts
- Quit key (q/Q): Exit
- Escape: Exit
- Enter: Open conversation
- Up/Down: Move selection

### handleSearchKey()

Processes keyboard input while in "search" view:
- Escape: Back to previous view
- Up/Down: Move selection
- Enter: Open selected contact
- Backspace: Delete from search
- Printable chars: Add to search

---

## Render State

**Location**: `src/types.ts` (lines 163-186)

The `RenderState` interface contains:
```typescript
interface RenderState {
  view: AppView;                     // Current view (login|chats|chat|search)
  previousView?: AppView;            // For navigation back
  connectionState: ConnectionState;  // Protocol state
  accountName?: string;              // Logged-in account
  qr?: ProtocolQrEvent;              // QR code data for login
  statusMessage?: string;            // Info message
  errorMessage?: string;             // Error message
  conversations: ConversationRecord[];
  conversationQuery: string;         // Search/filter input
  selectedConversationIndex: number;
  conversationFocus: "list" | "input";
  activeConversation?: ConversationRecord;
  messages: MessageRecord[];         // Loaded messages
  searchKeyword: string;             // Search input
  searchResults: ContactRecord[];
  selectedSearchIndex: number;
  chatInput: string;                 // Chat editor input
  messageScrollOffset: number;
  commandInput: string;              // If typing command: capture in RenderState
  totalUnreadCount: number;
  unreadConversations: ConversationRecord[];
}
```

---

## Message Types

**Location**: `src/types.ts` (lines 18-28)

```typescript
export type MessageKind =
  | "text"
  | "notice"
  | "link"
  | "image"
  | "voice"
  | "video"
  | "file"
  | "mini-program"
  | "sticker"
  | "unsupported";
```

---

## Protocol Communication

**Location**: `src/types.ts` (lines 127-145)

The `WeChatProtocol` interface defines protocol methods:
```typescript
interface WeChatProtocol extends EventEmitter {
  start(sessionData?: unknown): Promise<void>;
  reconnect(): Promise<void>;
  logout(): Promise<void>;
  sendText(toProtocolId: string, text: string): Promise<...>;
  sendFile(toProtocolId: string, filePath: string): Promise<...>;
  getContacts(): Promise<ContactInput[]>;
  getCurrentUser(): UserProfile | undefined;
  getSessionData(): unknown | undefined;
  
  // Events:
  on("qr", ...): this;
  on("scan", ...): this;
  on("login", ...): this;
  on("contacts", ...): this;
  on("message", ...): this;
  on("logout", ...): this;
  on("state", ...): this;
  on("error", ...): this;
}
```

Implementations:
- `src/protocol/wechat4u-adapter.ts` - Real WeChat protocol
- `src/protocol/mock-protocol.ts` - Mock protocol for testing

---

## Special Features

### Image Handling

**Paste Detection** (`src/tui/components/chat-editor.ts`):
- Detects bracketed paste escape sequences
- Identifies image file paths (jpg, jpeg, png, bmp, gif, webp)
- Converts file paths to `[Image #N]` markers
- Maps markers to file paths for later submission

**Image Submission**:
```typescript
private handleSubmit(text: string): void {
  const markerMatch = text.match(IMAGE_MARKER_REGEX);
  if (markerMatch) {
    for (const marker of markerMatch) {
      // Extract file path from imageAttachments
      this.onEvent({ type: "file-submit", filePath });
    }
  }
}
```

### File Type Detection

```typescript
function detectFileMessageKind(filePath: string): MessageKind {
  const ext = extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "file";
}
```

### Platform-Specific Clipboard

**macOS** (osascript):
```typescript
osascript -e 'set imageData to the clipboard as «class PNGf»' \
          -e 'set filePath to POSIX file "${tempFile}"' \
          -e 'set fileRef to open for access filePath with write permission' \
          -e 'write imageData to fileRef' \
          -e 'close access fileRef'
```

**Linux** (xclip):
```bash
xclip -selection clipboard -t image/png -o > "${tempFile}"
```

---

## Configuration

**Location**: `src/config.ts`

- CLI arguments: `--data-dir`, `--db`, `--mock`, `--debug`, `--help`, `--version`
- Environment variables: `WECHAT_TUI_DATA_DIR`, `WECHAT_TUI_DB`, `WECHAT_TUI_MOCK`, `WECHAT_TUI_DEBUG`, `WECHAT_TUI_LOG_LEVEL`
- Help text includes all commands
- Log levels: trace, debug, info, warn, error, fatal

---

## State Management

### Runtime State Variables

**Location**: `src/runtime.ts` (lines 42-59)

```typescript
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
```

---

## Threading & Async

- All command execution is async (`executeCommand()`)
- File operations are async (platform clipboard handling)
- Protocol communication is async
- No explicit queueing - events handled sequentially through runtime event loop

---

## Summary

This is a sophisticated WeChat TUI client with an integrated slash-command system. The architecture cleanly separates:

1. **Command Definition** - Simple array of command objects with descriptions
2. **Input Handling** - ChatEditor captures and processes input
3. **Event System** - Type-safe UiEvent routing
4. **Command Execution** - Switch-case dispatcher in runtime
5. **View Management** - Component-based screens with focus routing
6. **State Management** - Runtime maintains app state, renders to RenderState
7. **Display** - Component screens render based on RenderState

The system supports rich features like image paste detection, platform-specific clipboard handling, command autocomplete, and graceful error handling. The code is well-organized, typed, and follows functional reactive patterns.

