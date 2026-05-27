# WeChat TUI Architecture & Component Analysis

**Date**: 2026-05-26  
**Version**: 1.0  
**Status**: Complete Analysis of TUI Layer and Integration Points  

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Data Flow](#data-flow)
4. [Component Hierarchy](#component-hierarchy)
5. [Screen Implementations](#screen-implementations)
6. [Rendering Pipeline](#rendering-pipeline)
7. [State Management](#state-management)
8. [Event Handling](#event-handling)
9. [Integration Points](#integration-points)
10. [Performance Considerations](#performance-considerations)
11. [Extension Points](#extension-points)

---

## Executive Summary

The WeChat TUI is a terminal-based messaging application built on a clean separation of concerns:

- **WeChatRuntime** (792 lines): State machine & event orchestrator
- **WorkbenchTerminalRenderer** (153 lines): Terminal abstraction layer  
- **WechatApp** (456 lines): pi-tui Component with 4 screens and 7 sub-components
- **MessageStore**: SQLite-based persistence layer
- **WeChatProtocol**: Protocol interface (wechat4u adapter)

The key insight is **unidirectional data flow**: Runtime → Renderer → TUI Component → UI Output. No component maintains its own state; all state lives in WeChatRuntime.

---

## Architecture Overview

### System Context

```
┌─────────────────────────────────────────────────────────┐
│ WeChat TUI Application                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  WeChatRuntime (state machine & orchestrator)           │
│  ├─ Event listeners (protocol, UI)                      │
│  ├─ State variables (42 fields in RenderState)          │
│  ├─ Command execution (/contacts, /chats, etc.)         │
│  └─ Lifecycle management (exit, reconnect)              │
│                                                         │
│         ↓ render() [builds RenderState]                 │
│                                                         │
│  WorkbenchTerminalRenderer                              │
│  ├─ ProcessTerminal management                          │
│  ├─ TUI initialization                                  │
│  ├─ Input listener setup                                │
│  └─ Lifecycle (start, stop)                             │
│                                                         │
│         ↓ app.setState(state)                           │
│         ↓ tui.requestRender()                           │
│                                                         │
│  WechatApp (pi-tui Component)                           │
│  ├─ LoginScreen                                         │
│  ├─ ConversationScreen (recent chats)                   │
│  ├─ ChatScreen (active conversation)                    │
│  └─ ContactSearchScreen (search results)                │
│                                                         │
│         ↓ app.render(width) → string[]                  │
│                                                         │
│  Terminal Output                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Core Components

| Component | Lines | Responsibility | Dependencies |
|-----------|-------|-----------------|--------------|
| **WeChatRuntime** | 792 | State management, event orchestration, command execution | protocol, store, renderer |
| **WorkbenchTerminalRenderer** | 153 | Terminal lifecycle, input handling, state rendering | pi-tui (TUI) |
| **WechatApp** | 456 | All UI rendering for 4 screens via pi-tui | pi-tui, chalk |
| **MessageStore** | ~400 | Persistence, queries, search | sqlite |
| **WeChatProtocol** | Interface | Abstract protocol interface | EventEmitter |

---

## Data Flow

### 1. Startup Flow

```
index.ts (entry point)
  ├─ Create WeChatProtocol (wechat4u adapter)
  ├─ Create MessageStore (SQLite)
  ├─ Create WorkbenchTerminalRenderer
  ├─ Create WeChatRuntime
  │  └─ Bind protocol events
  │     ├─ protocol.on('qr') → set view='login', render QR
  │     ├─ protocol.on('login') → set view='chats', load recent convs
  │     ├─ protocol.on('message') → save message, update UI
  │     ├─ protocol.on('contacts') → upsert contacts
  │     └─ protocol.on('state') → update connectionState
  └─ runtime.start()
     ├─ renderer.start(onEvent, onClose)
     │  ├─ tui.start() → terminal input loop begins
     │  └─ setupInputListener() → key events → onEvent
     └─ protocol.start() → connect to WeChat
```

### 2. Event Handling Flow

```
Terminal Input (key press)
  └─ TUI.handleInput(data)
     └─ InputListener → onEvent({ type: "key", key })
        └─ WeChatRuntime.handleUiEvent()
           ├─ handleLoginKey(key)
           │  └─ Escape/Q → requestExit()
           ├─ handleConversationListKey(key)
           │  ├─ Up/Down → moveConversationSelection()
           │  ├─ Enter → openSelectedConversation()
           │  ├─ /command → executeCommand()
           │  └─ Printable → append to conversationQuery
           ├─ handleChatKey(key)
           │  ├─ Up/Down → navigateChatHistory()
           │  ├─ Enter → submitChatText()
           │  └─ Printable → append to chatInput
           └─ handleSearchKey(key)
              ├─ Up/Down → moveSearchSelection()
              ├─ Enter → openSelectedSearchResult()
              └─ Printable → append to searchKeyword
```

### 3. Text Input Flow (Chat Mode)

```
User types text
  └─ handleChatKey() detects printable text
     └─ chatInput += text
        └─ handleUiEvent({ type: "chat-change", text: chatInput })
           └─ WeChatRuntime updates this.chatInput
              └─ render() [throttled via TUI.requestRender]
                 └─ WechatApp.setState(state)
                    └─ ChatEditor.syncText(state.chatInput)
                       └─ Editor updates focused component
                          └─ TUI differential rendering
```

### 4. Protocol Event Flow

```
Protocol receives message
  └─ protocol.emit('message', incomingMessage)
     └─ WeChatRuntime.bindProtocol()
        └─ handleIncomingMessage(message)
           ├─ store.upsertContact(sender)
           ├─ store.saveMessage(message, conversation, incrementUnread)
           ├─ Update status message
           └─ render()
              └─ WechatApp shows new message in current view
```

---

## Component Hierarchy

### WechatApp Component Tree

```
WechatApp (Component)
├─ WechatApp.state: RenderState (passed via setState)
├─ WechatApp.setState(state)
├─ WechatApp.render(width) → string[]
│  └─ Routes to screen based on state.view
│
├─ LoginScreen
│  ├─ Header ("WeChat TUI" / "Login")
│  ├─ StatusBar (connection state, account)
│  ├─ Status Messages (statusMessage, errorMessage)
│  ├─ QR Code Display (qrLines converted from QR URL)
│  └─ Help Text ("waiting for login QR...")
│
├─ ConversationScreen (Recent Chats view)
│  ├─ Header ("WeChat TUI" / "Recent Chats" or "Command")
│  ├─ StatusBar (unread count, help text)
│  ├─ ConversationPicker
│  │  ├─ Search input display ("Chats > {query}")
│  │  ├─ Windowed list (5-10 items visible)
│  │  ├─ ConversationRow (for each: title, unread count, preview)
│  │  └─ Scroll indicator
│  └─ Status/Error Messages
│
├─ ChatScreen (Active Conversation)
│  ├─ Header ("WeChat TUI" / "Chat: {conversation.title}")
│  ├─ MessageList
│  │  ├─ Renders last N messages (budget = rows - 12, min 5)
│  │  ├─ MessageRow (timestamp, sender, content)
│  │  └─ Wrapped text with ANSI codes
│  ├─ StatusBar (current chat, unread summary, help)
│  ├─ ChatEditor (pi-tui Editor component)
│  │  ├─ MultiLine text editor with history
│  │  ├─ Focusable (focused = true for IME support)
│  │  ├─ OnSubmit → sendText to protocol
│  │  ├─ OnChange → update state.chatInput
│  │  ├─ Autocomplete (CombinedAutocompleteProvider)
│  │  │  ├─ COMMANDS list (/contacts, /chats, /status, etc.)
│  │  │  └─ File system completion
│  │  └─ History (Up/Down arrows navigate)
│  └─ Status/Error Messages
│
└─ ContactSearchScreen (Search Contacts/Groups)
   ├─ Header ("WeChat TUI" / "Contact Search")
   ├─ StatusBar (result count, help text)
   ├─ ContactPicker
   │  ├─ Search input display ("Search > {keyword}")
   │  ├─ Windowed list (5-10 items visible)
   │  ├─ ContactRow (name, kind badge)
   │  └─ Scroll indicator
   └─ Status/Error Messages
```

### Shared UI Components

#### Header
- **Purpose**: Display application title and current view title
- **Rendering**: Two lines (title bold, subtitle dim)
- **Code**: `fit(chalk.bold(title), width)` and `fit(chalk.dim(subtitle), width)`
- **Usage**: All 4 screens use Header

#### StatusBar
- **Purpose**: Show connection state, account name, and context-specific help
- **Rendering**: Single inverted line with padding
- **Fields**: `{connectionState} | {accountName} | {contextHelp}`
- **Example**: `online | alice@wechat | unread 3 | Up/Down | Enter | Esc/q`
- **Usage**: All 4 screens use StatusBar

#### MessageList
- **Purpose**: Display chat messages from last N (budget = rows - 12, min 5)
- **Rendering**: 
  - Message header: `[HH:MM:SS] Sender`
  - Message content: Wrapped text, indented 2 spaces
- **Features**:
  - Handles CJK characters via `wrapTextWithAnsi`
  - Shows placeholders: `[image]`, `[voice]`, `[video]`, `[file]`, etc.
  - Different format for group chats (shows sender name)
- **Usage**: ChatScreen only

#### ConversationPicker
- **Purpose**: Display searchable list of recent conversations
- **Rendering**: Window of 5-10 items
- **Features**:
  - Incremental search (type to filter conversations)
  - Up/Down arrow navigation
  - Shows unread count, last message preview
  - Current selection marked with `> ` and inverted colors
  - Scroll indicator when more than maxVisible items
- **Windowing**: Uses `windowItems()` helper

#### ContactPicker
- **Purpose**: Display searchable list of contacts/groups
- **Rendering**: Window of 5-10 items
- **Features**:
  - Incremental search (type to filter contacts)
  - Up/Down arrow navigation
  - Shows contact kind badge: `[private]`, `[group]`, etc.
  - Current selection marked with `> ` and inverted colors
  - Scroll indicator when more than maxVisible items
- **Windowing**: Uses `windowItems()` helper

#### ChatEditor
- **Purpose**: Provide multi-line text input for chat messages
- **Implements**: Component interface with handleInput()
- **Features**:
  - Multi-line editing (wraps long lines)
  - History navigation (Up/Down arrows)
  - Autocomplete for commands and filesystem
  - Emacs-style editing shortcuts (from pi-tui Editor)
  - Paste support
  - Change/Submit callbacks
- **Integration**: 
  - Synced with WechatApp.state.chatInput
  - Receives focus when in "chat" view
  - Emits "chat-change" and "chat-submit" events

---

## Screen Implementations

### LoginScreen (87 lines)

**Purpose**: Display login QR code and connection status

**State Used**:
- `state.qr`: QR code event with loginUrl and qrUrl
- `state.statusMessage`: "Scan the QR code with WeChat"
- `state.errorMessage`: Display in red
- `state.debugLogPath`: Show debug log location
- `state.connectionState`: Display in status bar

**Rendering**:
```
┌─────────────────────────┐
│ WeChat TUI              │
│ Login                   │
│                         │
│ online                  │ ← status bar
│ Scan with WeChat:...    │
│ █ █ █ █ █              │ ← QR code lines
│ █   █   █              │
│   ...                   │
│                         │ ← filler lines
│ online | Login | q quit │ ← status bar
└─────────────────────────┘
```

**Key Features**:
- QR code generated via `qrcode.generate()` → `qrLines()`
- Displayed while waiting for scan
- Shows "waiting for login QR..." if no QR yet
- Status bar shows "Login | q quit"

---

### ConversationScreen (44 lines)

**Purpose**: Show recent conversations, support search and navigation

**State Used**:
- `state.conversations[]`: Filtered by `conversationQuery`
- `state.conversationQuery`: User's search input
- `state.selectedConversationIndex`: Current selection
- `state.totalUnreadCount`: Display in status bar
- `state.connectionState`: Status

**Rendering**:
```
┌─────────────────────────────────────┐
│ WeChat TUI                          │
│ Recent Chats                        │
│                                     │
│ online                              │
│ Chats > alice               ← search input
│ > Alice (5) Last message... ← selected with unread
│   Bob (0) Hey there        ← not selected
│   Group (2) Alice: @all    ← conversation preview
│ 1-3 of 42                   ← scroll indicator
│ online | unread 3 | ...     ← status bar
└─────────────────────────────────────┘
```

**Search Logic**:
- If query is empty or starts with `/`, show all recent conversations
- Otherwise, filter: `title.includes(query) || preview.includes(query) || ...`
- Real-time filtering as user types

**Commands Supported**:
- `/contacts`: Enter contact search
- `/chats`: Back to chats (from other views)
- `/status`: Show connection state and account
- `/refresh`: Reload contacts from protocol
- `/load`: Show "local history is loaded"
- `/messages`: Show "not implemented yet"
- `/quit`: Exit application

---

### ChatScreen (77 lines)

**Purpose**: Display active conversation messages and enable text input

**State Used**:
- `state.activeConversation`: The open conversation
- `state.messages[]`: Up to N recent messages
- `state.chatInput`: Current text being composed
- `state.unreadConversations`: For unread summary in status
- `state.connectionState`: Status

**Rendering**:
```
┌────────────────────────────────┐
│ WeChat TUI                     │
│ Chat: Alice                    │
│                                │
│ online                         │
│ [14:30:22] Alice               ← message header
│ Hey, how are you?              ← wrapped message
│ [14:31:45] You                 ← self message
│ I'm good, thanks!              ← message content
│                                │
│ current Alice | unread - |     ← status bar
│ Chat > The message being...    ← editor prefix
│ typed here with wrapping       ← wrapped input
└────────────────────────────────┘
```

**Message Display**:
- Budget = max(5, rows - 12) rows for messages
- Shows last N messages (sliced from end)
- For each message:
  - Header: `[HH:MM:SS] SenderName`
  - Content: Wrapped with 2-space indent
  - Type-specific placeholders for non-text messages

**Chat Input**:
- Multi-line editor via ChatEditor component
- Displays as "Chat > " prefix + text
- Wraps long input to multiple lines
- History navigation (Up/Down)
- Autocomplete for commands
- Focus maintained for IME support

**Unread Summary**:
- Status bar shows unread from other conversations
- Format: `title(count), title(count), ...` (max 4)
- Updates dynamically as new messages arrive

---

### ContactSearchScreen (41 lines)

**Purpose**: Search and select contacts to open conversations

**State Used**:
- `state.searchKeyword`: User's search input
- `state.searchResults[]`: Filtered contacts
- `state.selectedSearchIndex`: Current selection
- `state.connectionState`: Status

**Rendering**:
```
┌──────────────────────────────┐
│ WeChat TUI                   │
│ Contact Search               │
│                              │
│ online                       │
│ Search > alice          ← search input
│ > Alice Smith [private] ← selected contact
│   Bob Jones [group]     ← contact with kind badge
│   Alice Group [group]   ← matching results
│ 1-3 of 42               ← scroll indicator
│ 42 results | Up/Down... ← status bar
└──────────────────────────────┘
```

**Search Logic**:
- Searches contacts by `displayName.includes(keyword)`
- Real-time as user types
- Returns up to `searchLimit` (default 20) results

**Navigation**:
- Up/Down arrows to move selection
- Enter to open selected contact
- Escape to return to previous view (chat or chats)

---

## Rendering Pipeline

### 1. Rendering Cycle

```
WeChatRuntime.render()
  ├─ Check if exiting (early return if true)
  ├─ buildRenderState()
  │  ├─ listVisibleConversations() ← filter by query
  │  ├─ getActiveConversation()
  │  ├─ store.listMessages() if active
  │  ├─ store.searchContacts() if searching
  │  ├─ store.listUnreadConversations()
  │  ├─ store.totalUnreadCount()
  │  └─ Return RenderState object (42 fields)
  └─ renderer.render(state)
     └─ WorkbenchTerminalRenderer.render()
        └─ app.setState(state)
           └─ WechatApp.state = state
              ├─ If view === "chat"
              │  └─ chatEditor.syncText(state.chatInput)
              │     └─ Editor.setText()
              └─ If view !== "chat"
                 └─ tui.setFocus(null) ← clear editor focus
        └─ tui.requestRender()
           └─ TUI schedules differential render
              └─ WechatApp.render(width)
                 ├─ Switch on state.view
                 ├─ Call appropriate screen's render()
                 └─ Return string[]
              └─ TUI compares with previous output
              └─ Terminal writes changed lines only (differential)
```

### 2. Rendering Frequency

- **Throttled**: TUI.requestRender() uses MIN_RENDER_INTERVAL_MS (likely 16-50ms)
- **Triggered by**:
  - User keyboard input (every key press)
  - Protocol events (message, state change, etc.)
  - Chat text input changes
  - Selection movements (Up/Down arrows)

### 3. String Array Output Format

Each screen returns string[], e.g.:
```javascript
[
  "WeChat TUI",           // 0
  "Login",                // 1
  "",                     // 2
  "online",               // 3
  "Scan with WeChat:...", // 4
  "█ █ █",                // 5-10 (QR lines)
  "",                     // 11-20 (filler)
  "online | Login | q",   // 21
]
```

**Line Calculation**:
- Fixed header: 1 line (title) + 1 line (subtitle) = 2 lines
- Status messages: 0-2 lines
- Content: Varies by screen
- Filler: `fillLines(rows, usedLines, reserved, width)` → pad to terminal height
- Status bar: 1 line (fixed)

**Width Handling**:
- All text fitted via `fit(text, width, pad, ellipsis)`
- `fit()` truncates if text > width, optionally pads to width
- Uses `truncateToWidth()` from pi-tui utilities
- Respects ANSI codes and wide characters

### 4. Focus Management

**Chat View**:
```
WechatApp.setState(state)
  └─ if state.view === "chat"
     └─ chatEditor.syncText(state.chatInput)
     └─ tui.setFocus(chatEditor.focusTarget)
        └─ ChatEditor (component with handleInput?)
           └─ Editor (pi-tui component, Focusable)
              └─ Sets up IME support (CURSOR_MARKER)
```

**Other Views**:
```
WechatApp.setState(state)
  └─ if state.view !== "chat"
     └─ tui.setFocus(null)
        └─ No component receives text input
        └─ All input treated as key events
```

---

## State Management

### RenderState (42 Fields)

```typescript
interface RenderState {
  // View routing (4 possible values)
  view: "login" | "chats" | "chat" | "search",
  previousView?: "login" | "chats" | "chat" | "search",
  
  // Connection context
  connectionState: ConnectionState,
  accountName?: string,
  
  // Login specific
  qr?: { uuid, loginUrl, qrUrl },
  
  // UI feedback
  statusMessage?: string,
  errorMessage?: string,
  debugLogPath?: string,
  
  // Conversation list
  conversations: ConversationRecord[],
  conversationQuery: string,           // search filter
  selectedConversationIndex: number,
  
  // Active chat
  activeConversation?: ConversationRecord,
  messages: MessageRecord[],
  chatInput: string,
  commandInput: string,
  
  // Contact search
  searchKeyword: string,
  searchResults: ContactRecord[],
  selectedSearchIndex: number,
  
  // Unread tracking
  totalUnreadCount: number,
  unreadConversations: ConversationRecord[],
}
```

### State Ownership

| Field | Owner | Updated By | Used In |
|-------|-------|-----------|---------|
| view | WeChatRuntime | handleKey(), executeCommand() | all screens |
| conversations[] | Store (queried) | Protocol | ConversationScreen |
| messages[] | Store (queried) | Protocol | ChatScreen |
| chatInput | WeChatRuntime | handleChatKey(), chat-change event | ChatScreen, ChatEditor |
| searchResults[] | Store (queried) | Search query | ContactSearchScreen |
| statusMessage | WeChatRuntime | All event handlers | All screens |

### State Update Cycle

```
1. Event arrives (key, message, state change)
2. WeChatRuntime.handleUiEvent() or protocol event
3. Update internal state (view, chatInput, selectedIndex, etc.)
4. Call render()
5. buildRenderState() → queries Store, composes all 42 fields
6. renderer.render(state) → app.setState(state)
7. app.render(width) → returns string[]
8. TUI differential rendering → terminal output
9. Display updates on screen
```

---

## Event Handling

### Keyboard Event Routing

```
Terminal Input
  └─ rawInputToKey(data): UiKey
     ├─ Check for Ctrl+C → { name: "c", ctrl: true }
     ├─ Check for special keys → { name: "escape" | "enter" | etc. }
     ├─ Parse via pi-tui parseKey() → "ctrl+a" etc.
     ├─ Decode Kitty protocol (if active)
     ├─ Handle paste boundaries (Ctrl+[200~...Ctrl+[201~)
     └─ Return { sequence, name?, ctrl?, meta?, shift? }
  └─ isGlobalChatKey(key) check
     ├─ if ctrl or escape → always global
     ├─ if in chat view and not global → don't send up (local Editor handling)
  └─ onEvent({ type: "key", key })
     └─ WeChatRuntime.handleUiEvent()
        └─ handleKey(key)
           └─ View-specific handler
```

### Input Modifiers (from WorkbenchTerminalRenderer)

- **Ctrl+C**: Global exit
- **Escape/Esc**: Global navigation
- **Enter/Return**: Submit or select
- **Backspace/Delete**: Append to query or delete from input
- **Up/Down/Left/Right**: Navigation or history
- **Printable characters**: Append to active input (query, search, chat)

### Chat-Specific Events

```typescript
type UiEvent = 
  | { type: "key", key: UiKey }
  | { type: "chat-change", text: string }      // text input changed
  | { type: "chat-submit", text: string }      // Enter pressed
```

**chat-change**:
- Fired when Editor content changes
- Updates `chatInput` state
- Triggers re-render (showing preview)

**chat-submit**:
- Fired when Enter pressed in Editor
- Triggers `submitChatText()`
- Sends message to protocol

---

## Integration Points

### 1. Runtime ↔ Renderer

```
WeChatRuntime
  └─ renderer.start(onEvent, onClose)
     ├─ Called on startup
     ├─ onEvent callback for UI events
     └─ onClose callback for stdin close
  └─ renderer.render(state)
     ├─ Called after every state change
     └─ Passes complete RenderState
  └─ renderer.stop()
     ├─ Called on exit
     └─ Cleans up terminal
```

### 2. Renderer ↔ TUI

```
WorkbenchTerminalRenderer
  ├─ tui = new TUI(terminal)
  ├─ app = new WechatApp(tui, onEvent)
  ├─ tui.addChild(app)
  ├─ tui.addInputListener((data) => onEvent({ type: "key", key }))
  └─ tui.start()
```

### 3. WechatApp ↔ Store

**No Direct Coupling**:
- WechatApp receives pre-queried data via RenderState
- Does not directly access Store
- Store queries happen in WeChatRuntime.buildRenderState()

**Example**:
```javascript
// In WeChatRuntime
const conversations = this.store.listRecentConversations(limit);

// Pass to WechatApp
state.conversations = conversations;

// WechatApp just renders it
render(state) {
  // state.conversations is already populated
}
```

### 4. ChatEditor ↔ Protocol

```
ChatEditor.onSubmit(text)
  └─ Emit { type: "chat-submit", text }
     └─ WeChatRuntime.submitChatText(text)
        ├─ Validate active conversation exists
        ├─ Call protocol.sendText(conversationId, text)
        └─ Save to Store.saveMessage()
```

### 5. Protocol ↔ Store

```
protocol.on('message', (incoming) => {
  store.upsertContact(incoming.sender)
  store.saveMessage(incoming)
})

protocol.on('contacts', (contacts) => {
  store.upsertContacts(contacts)
})
```

---

## Performance Considerations

### 1. Differential Rendering

- **Advantage**: Only changed terminal regions re-rendered
- **Implementation**: TUI compares previous output with new output
- **Impact**: Fast updates even on slow terminals

### 2. Message Rendering Budget

```javascript
const budget = Math.max(5, rows - 12);
const allLines = [];
for (const message of state.messages) {
  allLines.push(...formatMessage(message));  // 1-3 lines per message
}
return allLines.slice(-budget);  // Only show last `budget` lines
```

**Effect**: 
- Shows last 5-10 messages (depending on terminal size)
- Prevents rendering of entire chat history
- Fast even with 1000+ messages in local store

### 3. Windowing for Lists

```javascript
const maxVisible = visiblePickerRows(rows);  // 5-10 items
const windowed = windowItems(items, selectedIndex, maxVisible);
// Only render windowed.items, not all items
```

**Effect**:
- Shows 5-10 visible items
- Efficient scrolling even with 1000+ conversations
- Selection highlight updates instantly

### 4. Throttled Rendering

- TUI.requestRender() uses MIN_RENDER_INTERVAL_MS (likely 16-50ms)
- Prevents excessive re-renders on rapid key presses
- Multiple updates batched into single render pass

### 5. String Allocation

- Each line is a string
- ANSI codes included inline (no separate styling layer)
- Memory efficient for typical terminal sizes (80-200 columns)

### 6. Worst Case: Chat with 1000+ Messages

```
Scenario: 1000 messages in conversation
- Message list renders: last 10 messages only
- Each message: 2-3 lines average
- Total message lines: 20-30 lines
- Plus header/status/editor: ~10 lines
- Total terminal output: ~40 lines
- Rendering time: <1ms (all string concatenation)
```

---

## Extension Points

### 1. Adding New Screens

```typescript
// 1. Add view type
export type AppView = "login" | "chats" | "chat" | "search" | "settings";

// 2. Create screen class
class SettingsScreen {
  render(state: RenderState, width: number, rows: number): string[] {
    // Return string[]
  }
}

// 3. Add to WechatApp
private readonly settingsScreen = new SettingsScreen();

// 4. Add switch case
case "settings":
  return this.settingsScreen.render(this.state, width, rows);

// 5. Add navigation command
if (command === "/settings") {
  this.view = "settings";
  return;
}
```

### 2. Adding New Commands

```typescript
// In WeChatRuntime.executeCommand()
switch (name) {
  case "/settings":
    this.enterSettings();
    return;
  case "/export":
    await this.exportMessages();
    return;
  // ...
}

private async exportMessages(): Promise<void> {
  const messages = this.store.listMessages(this.activeConversationId);
  // Write to file, show status
  this.statusMessage = `exported ${messages.length} messages`;
}
```

### 3. Custom UI Components

Instead of hardcoding rendering logic, create components:

```typescript
class MessageListRenderer {
  render(messages: MessageRecord[], width: number, budget: number): string[] {
    // Encapsulate message formatting logic
  }
}

class CustomPicker {
  render(items: Item[], selected: number, width: number): string[] {
    // Custom item rendering
  }
}
```

### 4. Styling Customization

```typescript
// Create theme object
const darkTheme = {
  header: (text) => chalk.cyan.bold(text),
  statusBar: (text) => chalk.bgDim.white(text),
  selected: (text) => chalk.bgBlue.white(text),
  error: (text) => chalk.red(text),
};

// Apply in rendering
render() {
  const headerLine = fit(
    darkTheme.header("WeChat TUI"),
    width
  );
  // ...
}
```

### 5. Overlay Dialogs

Using pi-tui overlay system:

```typescript
// Show confirmation dialog
const confirmBox = new ConfirmDialog("Delete message?");
const handle = tui.showOverlay(confirmBox, {
  anchor: "center",
  width: 40,
  maxHeight: 10,
  nonCapturing: false,
});

// Handle dialog result
handle.hide();
```

### 6. Plugin Architecture

```typescript
interface UiPlugin {
  name: string;
  render(state: RenderState, width: number): string[];
  handleEvent(event: UiEvent): boolean;
}

class WechatApp {
  private plugins: UiPlugin[] = [];
  
  addPlugin(plugin: UiPlugin): void {
    this.plugins.push(plugin);
  }
  
  render(width: number): string[] {
    // Let plugins augment rendering
    for (const plugin of this.plugins) {
      lines.push(...plugin.render(this.state, width));
    }
    return lines;
  }
}
```

---

## Debugging & Troubleshooting

### 1. Enable Debug Logging

```typescript
// In index.ts
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

const runtime = new WeChatRuntime(protocol, store, renderer, {
  logger,
  debugLogPath: "./wechat-debug.log",
});
```

### 2. Trace State Changes

```typescript
// In WeChatRuntime.render()
this.options.logger?.trace({
  view: this.view,
  conversations: this.conversations.length,
  messages: this.messages.length,
  selectedIndex: this.selectedConversationIndex,
}, "render state built");
```

### 3. Monitor Rendering Performance

```typescript
// In WechatApp.render()
const start = performance.now();
const lines = this.renderScreen();
const duration = performance.now() - start;
if (duration > 10) {
  console.error(`Slow render: ${duration.toFixed(2)}ms`);
}
```

### 4. Capture Terminal Output

```bash
# Record session
script -q output.txt

# Run CLI
npx tsx src/index.ts

# Exit script (Ctrl+D)

# View recording
cat output.txt
```

### 5. Test Rendering in Isolation

```typescript
import { renderState } from "./ui/workbench-renderer.js";

const testState: RenderState = {
  // ... populate test state
};

const output = renderState(testState, { width: 80, rows: 24 });
console.log(output);
```

---

## Summary

The WeChat TUI demonstrates clean architecture principles:

1. **Separation of Concerns**
   - Runtime = state machine
   - Renderer = terminal abstraction
   - TUI = rendering layer
   - Protocol = integration layer
   - Store = persistence

2. **Unidirectional Data Flow**
   - Runtime builds state
   - Renderer displays state
   - TUI renders to terminal
   - Input flows back to runtime

3. **Testability**
   - Each component can be tested independently
   - RenderState is serializable
   - Terminal rendering can be captured

4. **Extensibility**
   - Easy to add new screens
   - Easy to add new commands
   - Overlay system for dialogs
   - Plugin potential for UI enhancements

5. **Performance**
   - Differential rendering
   - Windowed lists
   - Message budget
   - Throttled updates

