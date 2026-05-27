# WeChat TUI Rendering System - Deep Exploration

## Project Overview

**Project**: WeChat TUI (`wechat-tui`)  
**Framework**: `pi-tui` (v0.75.5) - A Rust-based TUI framework wrapper for Node.js  
**Color Library**: `chalk` (v5.4.1) - ANSI color/styling library  
**Terminal Image Support**: `qrcode-terminal` - For QR code rendering  

---

## 1. MESSAGE FORMATTING & DISPLAY (MessageList Component)

### Location
`src/tui/wechat-app.ts` - Lines 239-256 (MessageList class)

### Rendering Flow

```typescript
class MessageList {
  render(state: RenderState, width: number, rows: number): string[] {
    // 1. Validate state
    if (!conversation) return [dim("No active conversation.")]
    if (state.messages.length === 0) return [dim("No local messages yet.")]

    // 2. Determine available space
    const budget = Math.max(5, rows - 12)  // Leave 12 rows for UI elements

    // 3. Format all messages to lines
    const allLines: string[] = []
    for (const message of state.messages) {
      allLines.push(...formatMessage(message, conversation, width))
    }

    // 4. Return only last N lines (scrollable window)
    return allLines.slice(-budget)
  }
}
```

### Message Format Details

**Function**: `formatMessage()` (Lines 336-342)

```typescript
function formatMessage(
  message: MessageRecord,
  conversation: ConversationRecord,
  width: number
): string[] {
  // Header line: [TIME] SENDER
  const sender = message.isSelf ? "You" : 
                 conversation.kind === "group" ? message.senderName : 
                 conversation.title
  const header = fit(chalk.dim(`[${formatClock(message.timestamp)}] ${sender}`), width)

  // Content extraction
  const content = messageDisplayContent(message)

  // Wrapped lines with 2-space indent
  const wrapped = wrapTextWithAnsi(content, Math.max(1, width - 2))
                   .map((line) => fit(`  ${line}`, width))

  return [header, ...wrapped]
}
```

### Message Content Handling

**Function**: `messageDisplayContent()` (Lines 344-352)

| Type | Display |
|------|---------|
| `text`, `notice` | Raw content or placeholder |
| `image` | `[image]` |
| `voice` | `[voice]` |
| `video` | `[video]` |
| `file` | `[file] filename` or `[file]` |
| `mini-program` | `[mini-program]` |
| `sticker` | `[sticker]` |
| Other | `[unsupported message]` |

### Styling Applied
- **Header**: `chalk.dim()` - Dimmed timestamp & sender (grey)
- **Content**: Plain text with ANSI wrapping preserved
- **Indentation**: All content wrapped at `width - 2`, indented with 2 spaces
- **Layout**: One header line per message, then N content lines

### Screen Space Budget
- Total rows: Terminal height
- Used for: Header (2) + Status (2) + StatusBar (1) + Editor (3) = ~8 rows minimum
- Available for messages: `Math.max(5, rows - 12)`
- Vertical scrolling: Only last N messages displayed; older messages hidden

---

## 2. CONVERSATION LISTING & SELECTION (ConversationPicker)

### Location
`src/tui/wechat-app.ts` - Lines 189-213 (ConversationPicker class)

### Rendering Flow

```typescript
class ConversationPicker {
  render(state: RenderState, width: number, rows: number): string[] {
    const lines: string[] = []

    // Show current input (command or filter)
    const commandMode = state.conversationQuery.startsWith("/")
    lines.push(fit(`${commandMode ? "Command" : "Chats"} > ${state.conversationQuery}`, width))
    lines.push("")

    // Windowed view
    const maxVisible = visiblePickerRows(rows)
    const windowed = windowItems(state.conversations, state.selectedConversationIndex, maxVisible)

    // Handle empty state
    if (state.conversations.length === 0) {
      const empty = state.conversationQuery && !commandMode ? 
                    "No local conversations match." : 
                    "No recent conversations yet. Use /contacts."
      lines.push(fit(chalk.dim(empty), width))
      return lines
    }

    // Render conversation rows
    for (let offset = 0; offset < windowed.items.length; offset += 1) {
      const index = windowed.start + offset
      lines.push(formatConversationRow(windowed.items[offset], 
                                       index === state.selectedConversationIndex, 
                                       width))
    }

    // Show scroll info if needed
    if (state.conversations.length > maxVisible) {
      lines.push(fit(chalk.dim(`${windowed.start + 1}-${windowed.start + windowed.items.length} of ${state.conversations.length}`), width))
    }

    return lines
  }
}
```

### Conversation Row Format

**Function**: `formatConversationRow()` (Lines 303-311)

```
  Title            (n) LastSender: Last message preview...
```

Detailed breakdown:
- **Marker**: `"> "` if selected, else `"  "` (2 chars)
- **Title**: Truncated to 28% of width (max 28 chars)
- **Unread**: Right-padded count `(n)` (5 chars total), or empty
- **Preview**: Last message with optional sender prefix for groups
- **Selection**: Full row inverted (white-on-black) if selected

```typescript
function formatConversationRow(conversation: ConversationRecord, selected: boolean, width: number): string {
  const marker = selected ? "> " : "  "
  const titleWidth = Math.max(14, Math.min(28, Math.floor(width * 0.32)))
  const unread = conversation.unreadCount > 0 ? `(${conversation.unreadCount})` : ""
  const title = truncateToWidth(conversation.title, titleWidth, "", true)
  const preview = formatConversationPreview(conversation)
  const row = fit(`${marker}${title} ${unread.padStart(5)} ${preview}`, width, true)
  return selected ? chalk.inverse(row) : row
}
```

### Selection Windowing

**Function**: `windowItems()` (Lines 404-411)

```typescript
function windowItems<T>(items: T[], selectedIndex: number, limit: number): 
  { items: T[]; start: number } {
  if (items.length <= limit) {
    return { items, start: 0 }
  }
  const selected = clamp(selectedIndex, 0, items.length - 1)
  const start = clamp(selected - limit + 1, 0, Math.max(0, items.length - limit))
  return { items: items.slice(start, start + limit), start }
}
```

**Behavior**:
- Show only `limit` items at a time
- Keep selected item visible within window
- Scroll position: `Math.max(0, selectedIndex - limit + 1)`
- Always keep 1 item visible if list has items

### Visible Rows Calculation

**Function**: `visiblePickerRows()` (Lines 400-402)

```typescript
function visiblePickerRows(rows: number): number {
  return clamp(rows - 10, 5, 10)  // Min 5, Max 10 rows visible
}
```

### Styling Applied
- **Query line**: Plain text with mode indicator
- **Empty state**: `chalk.dim()` - Dimmed grey text
- **Title**: Truncated to width
- **Unread count**: Right-aligned, plain text
- **Preview**: Dimmed for "no local messages" state
- **Selection**: `chalk.inverse()` - Full row inverted
- **Scroll info**: `chalk.dim()` - Dimmed grey

---

## 3. HEADER & STATUS BAR RENDERING

### Location
`src/tui/wechat-app.ts` - Lines 176-187

### Header Component

```typescript
class Header {
  render(title: string, subtitle: string, width: number): string[] {
    return [
      fit(chalk.bold(title), width),           // "WeChat TUI"
      fit(chalk.dim(subtitle), width)          // "Login", "Recent Chats", etc.
    ]
  }
}
```

**Output**:
```
WeChat TUI                                      (bold)
Login                                           (dim)
```

**Styling**:
- Line 1: `chalk.bold()` - Bold text
- Line 2: `chalk.dim()` - Dimmed/greyed text
- Both lines: Fitted to terminal width with padding

### Status Bar Component

```typescript
class StatusBar {
  render(state: RenderState, suffix: string, width: number): string {
    const account = state.accountName ? ` | ${state.accountName}` : ""
    return chalk.inverse(fit(`${state.connectionState}${account} | ${suffix}`, width, true))
  }
}
```

**Output**:
```
[CONNECTION_STATE] | [ACCOUNT] | [SUFFIX]      (inverted/highlighted)
```

**Status bar locations**:

| Screen | Suffix |
|--------|--------|
| Login | `Login \| q quit` |
| Chats | `unread {count} \| Up/Down \| Enter \| /contacts \| Esc/q` |
| Chat | `current {title} \| unread {count} \| Esc chats` |
| Search | `{count} results \| Up/Down select \| Enter open \| Esc back` |

**Styling**:
- Entire bar: `chalk.inverse()` - White text on black background
- Connection state: Included as-is
- Account name: Optional, prefixed with ` | ` separator
- Right padding: Full width fill with spaces

### Status Messages

**Function**: `pushStatus()` (Lines 375-382)

```typescript
function pushStatus(lines: string[], state: RenderState, width: number): void {
  if (state.statusMessage) {
    lines.push(fit(chalk.dim(state.statusMessage), width))
  }
  if (state.errorMessage) {
    lines.push(fit(chalk.red(state.errorMessage), width))
  }
}
```

**Styling**:
- Status (informational): `chalk.dim()` - Grey
- Error: `chalk.red()` - Red text

---

## 4. COLORS & TEXT STYLING

### Chalk Library Integration

**Imported**: `import chalk from "chalk"`

### Style Functions Used

| Function | Purpose | ANSI Code |
|----------|---------|-----------|
| `chalk.bold()` | Bold text | CSI 1m |
| `chalk.dim()` | Dimmed/grey text | CSI 2m |
| `chalk.red()` | Red text | CSI 31m |
| `chalk.inverse()` | Invert colors (white-on-black) | CSI 7m |

### Application Locations

| Component | Location | Styling |
|-----------|----------|---------|
| Header title | `Header.render()` | Bold |
| Header subtitle | `Header.render()` | Dim |
| Status bar | `StatusBar.render()` | Inverse |
| Message timestamp/sender | `formatMessage()` | Dim |
| Message indentation | `formatMessage()` | Plain |
| Empty messages | `MessageList.render()` | Dim |
| Conversation selected row | `formatConversationRow()` | Inverse |
| Conversation unselected row | `formatConversationRow()` | Plain |
| Conversation preview (no messages) | `formatConversationPreview()` | Dim |
| Conversation scroll info | `ConversationPicker.render()` | Dim |
| Contact kind badge | `formatContactRow()` | Dim |
| Search empty state | `ContactPicker.render()` | Dim |
| Status message | `pushStatus()` | Dim |
| Error message | `pushStatus()` | Red |
| Debug log path | `LoginScreen.render()` | Dim |
| Waiting for QR | `LoginScreen.render()` | Dim |

### PI-TUI Theme Objects

**SelectListTheme** (Lines 25-31):

```typescript
const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => chalk.inverse(text),
  selectedText: (text) => chalk.inverse(text),
  description: (text) => chalk.dim(text),
  scrollInfo: (text) => chalk.dim(text),
  noMatch: (text) => chalk.dim(text)
}
```

Used by: pi-tui's Editor component for autocomplete suggestions

**EditorTheme** (Lines 33-36):

```typescript
const editorTheme: EditorTheme = {
  borderColor: (text) => chalk.dim(text),
  selectList: selectListTheme
}
```

Used by: Chat editor input field

### No Explicit Theme Constants

Currently: Styling is **inline** in rendering functions, no centralized color/style definitions.

---

## 5. LAYOUT & SCREEN REAL ESTATE STRUCTURE

### View Hierarchy

All views share this layout:

```
┌─────────────────────────────────────────────────────┐
│ Header (2 rows)                                     │
│  - Title (bold)                                     │
│  - Subtitle (dim)                                   │
├─────────────────────────────────────────────────────┤
│ Status Messages (0-2 rows)                          │
│  - Optional: status message (dim)                   │
│  - Optional: error message (red)                    │
├─────────────────────────────────────────────────────┤
│ Main Content (dynamic)                              │
│  - Varies by view type                              │
├─────────────────────────────────────────────────────┤
│ Filler Lines (expands to fill space)                │
├─────────────────────────────────────────────────────┤
│ Status Bar (1 row, inverse background)              │
│  [CONNECTION] | [ACCOUNT] | [CONTROLS]             │
├─────────────────────────────────────────────────────┤
│ Editor/Input (if applicable, 3+ rows)              │
│  - Prompt line: "Chat >" or "Search >"              │
│  - pi-tui Editor component                          │
│  - Auto-complete dropdown                           │
└─────────────────────────────────────────────────────┘
```

### View-Specific Layouts

#### Login Screen (`LoginScreen`)

```
Header (2 rows)
  "WeChat TUI" (bold)
  "Login" (dim)
Status message
  Optional debug log path (dim)
Content:
  "Scan with WeChat: [URL]"
  [QR Code ASCII Art] - 9-13 rows typically
  OR "waiting for login QR..." (dim)
Filler lines
Status bar (inverse)
```

**Row Budget**: ~18-24 minimum

#### Conversation List (`ConversationScreen`)

```
Header (2 rows)
Status messages
Query prompt line:
  "Chats > " or "Command > " + user input
Empty line
Conversation rows:
  "> Title  (n) LastSender: message..." (selected, inverse)
  "  Title  (n) LastSender: message..." (plain)
  "> Title  (n) LastSender: message..." (selected, inverse)
  ...
  "1-8 of 42" (dim)           <- If more items exist
Filler lines
Status bar (inverse)
  "unread 5 | Up/Down | Enter | /contacts | Esc/q"
```

**Max visible**: 5-10 conversation rows (min 5, clamped to rows - 10)

#### Chat View (`ChatScreen`)

```
Header (2 rows)
  "WeChat TUI" (bold)
  "Chat: [Contact Name]" (dim)
Status messages
Message history:
  [HH:MM] You                                         (dim)
    Your message text...
  [HH:MM] Sender Name                                (dim)
    Incoming message text...
  ...
Filler lines
Status bar (inverse)
  "current [Name] | unread [Summary] | Esc chats"
Editor section:
  "Chat >" (plain)
  Editor input (pi-tui component, 1-3 rows)
  Auto-complete menu (pi-tui, 0-6 rows)
```

**Message display space**: `Math.max(5, rows - 12)` rows
- `rows - 12` accounts for: Header(2) + Status(2) + StatusBar(1) + Editor(3) + Spacing(4)

#### Contact Search (`ContactSearchScreen`)

```
Header (2 rows)
Status messages
Search prompt:
  "Search > " + user input
Empty line
Search results:
  "> [Name]  [kind]"  (selected, inverse)
  "  [Name]  [kind]"  (plain)
  ...
  "1-8 of 42" (dim)    <- If more items
Filler lines
Status bar (inverse)
  "42 results | Up/Down select | Enter open | Esc back"
```

### Key Layout Functions

**`fillLines()`** (Lines 413-416)
- Fills remaining vertical space
- Used to push status bar to bottom
- Creates empty rows with appropriate width

```typescript
function fillLines(rows: number, used: number, reserved: number, width: number): string[] {
  const count = Math.max(0, rows - used - reserved)
  return Array.from({ length: count }, () => " ".repeat(Math.max(0, width)))
}
```

**`fit()`** (Lines 418-425)
- Fits text to exact width with truncation or padding
- Handles ANSI color codes correctly via `visibleWidth()`
- Used for every single line to ensure exact width

```typescript
function fit(text: string, width: number, pad = false, ellipsis = "..."): string {
  const maxWidth = Math.max(1, width)
  const fitted = truncateToWidth(text, maxWidth, ellipsis, pad)
  if (!pad || visibleWidth(fitted) >= maxWidth) {
    return fitted
  }
  return `${fitted}${" ".repeat(maxWidth - visibleWidth(fitted))}`
}
```

### Spacing Details

| Element | Spacing |
|---------|---------|
| Empty line separator | `""` (empty string) |
| Message indentation | `"  "` (2 spaces) |
| Conversation marker | `"  "` (unselected) or `"> "` (selected) |
| Prompt prefix | Varies ("Chat >", "Search >", "Chats >", "Command >") |
| Filler padding | Full width with spaces |

---

## 6. STYLE CONSTANTS & THEME DEFINITIONS

### Current State: NO CENTRALIZED THEME

**Problem**: Styling is scattered throughout rendering functions.

### Styling Locations

```
src/tui/wechat-app.ts:
  - Lines 25-31: selectListTheme (pi-tui autocomplete)
  - Lines 33-36: editorTheme (pi-tui editor)
  - Lines 96, 103, 178, 185, 200, 209, 224, 233, 243, 246, 310, 315, 332, 338, 377, 380
    (inline chalk calls scattered throughout)
```

### Theme-Like Objects

1. **selectListTheme** - Controls autocomplete appearance
   ```typescript
   {
     selectedPrefix: invert styling
     selectedText: invert styling
     description: dim styling
     scrollInfo: dim styling
     noMatch: dim styling
   }
   ```

2. **editorTheme** - Controls editor input appearance
   ```typescript
   {
     borderColor: dim styling
     selectList: selectListTheme
   }
   ```

### Chalk Styling Applied

Total unique styling patterns:

| Pattern | Count | Locations |
|---------|-------|-----------|
| `chalk.dim()` | 13 | Headers, status, scroll info, empty states, timestamps, errors, help text |
| `chalk.inverse()` | 3 | Selected rows, status bar, autocomplete selection |
| `chalk.bold()` | 1 | Main header title |
| `chalk.red()` | 1 | Error messages |

### No Style Constants Defined

- No `const COLORS = { ... }`
- No `const STYLES = { ... }`
- No exported theme factory
- Color codes are hardcoded in function calls

---

## 7. PI-TUI FRAMEWORK INTEGRATION

### What pi-tui Provides

The app uses `@earendil-works/pi-tui` (v0.75.5) for:

1. **TUI Component System**
   - Base `Component` interface
   - Container & layout management
   - Focus handling

2. **Editor Component** (used for chat input)
   - Text editing with wrapping
   - History navigation (Up/Down)
   - Autocomplete support
   - Customizable theme

3. **Text Utilities**
   - `truncateToWidth()` - Truncate with proper ANSI handling
   - `visibleWidth()` - Calculate display width (ANSI-aware)
   - `wrapTextWithAnsi()` - Wrap text preserving ANSI codes

4. **Key Handling**
   - `Key` constants for special keys
   - `matchesKey()` - Match key sequences
   - `parseKey()` - Parse key input
   - `decodeKittyPrintable()` - Handle Kitty protocol

5. **Terminal Abstraction**
   - `Terminal` interface (keyboard input, output)
   - `ProcessTerminal` - Actual terminal implementation

### Custom Components

The app defines custom components on top of pi-tui:

```typescript
class WechatApp implements Component
class LoginScreen
class ConversationScreen
class ChatScreen
class ContactSearchScreen
class Header
class StatusBar
class ConversationPicker
class ContactPicker
class MessageList
class ChatEditor implements Component
```

All follow pattern:
```typescript
render(width: number, [rows?: number]): string[] { ... }
```

---

## 8. DATA FLOW: STATE → RENDER

### Entry Point

```typescript
// src/ui/workbench-renderer.ts - WorkbenchTerminalRenderer
render(state: RenderState): void {
  this.app?.setState(state)
  this.tui?.requestRender()
}
```

### Render Pipeline

```
RenderState (from runtime)
  ↓
WechatApp.setState(state)
  ↓ (based on state.view)
  ├→ LoginScreen.render()
  ├→ ConversationScreen.render()
  ├→ ChatScreen.render()
  └→ ContactSearchScreen.render()
  ↓
Component.render(width: number): string[]
  (returns array of formatted lines)
  ↓
TUI.requestRender()
  ↓
Terminal.write(text)
  (outputs to stdout)
```

### State Structure

```typescript
interface RenderState {
  view: AppView                          // "login" | "chats" | "chat" | "search"
  connectionState: ConnectionState       // "online", "offline", etc.
  accountName?: string                   // Display user
  qr?: ProtocolQrEvent                  // QR login data
  statusMessage?: string                 // Informational status
  errorMessage?: string                  // Error text
  debugLogPath?: string                  // Debug log location

  conversations: ConversationRecord[]    // List of chats
  conversationQuery: string              // Filter/search text
  selectedConversationIndex: number      // Currently selected index
  activeConversation?: ConversationRecord // Currently viewing
  messages: MessageRecord[]              // Messages in active chat
  
  searchKeyword: string                  // Contact search query
  searchResults: ContactRecord[]         // Search results
  selectedSearchIndex: number            // Selected result index
  
  chatInput: string                      // Editor content
  commandInput: string                   // Command input content
  
  totalUnreadCount: number               // Total unread messages
  unreadConversations: ConversationRecord[] // Conversations with unread
}
```

---

## Summary Table

| Aspect | Details |
|--------|---------|
| **Framework** | pi-tui (v0.75.5) + chalk (v5.4.1) |
| **Entry** | `WechatApp.render(width)` → `string[]` |
| **Components** | Header, StatusBar, MessageList, ConversationPicker, ContactPicker, ChatEditor |
| **Colors** | Bold, Dim, Inverse, Red (via chalk) |
| **Selection** | Full-row inverse background |
| **Scrolling** | Windowed view: 5-10 items visible, auto-scroll to keep selection visible |
| **Message Display** | Header (timestamp+sender, dim) + Indented content (2 spaces), last N messages shown |
| **Width Handling** | ANSI-aware via `truncateToWidth()`, `visibleWidth()`, `fit()` helpers |
| **Row Budget** | ~12-14 rows reserved for UI, rest for content |
| **Theme** | Inline styling, no centralized theme object (candidate for refactoring) |

