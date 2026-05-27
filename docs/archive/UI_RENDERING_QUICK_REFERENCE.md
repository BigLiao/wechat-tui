# WeChat TUI - Quick Reference Guide

## File Map

| File | Purpose | Lines | Key Classes |
|------|---------|-------|-------------|
| `src/tui/wechat-app.ts` | **Main TUI rendering** | 456 | `WechatApp`, `LoginScreen`, `ConversationScreen`, `ChatScreen`, `ContactSearchScreen`, `Header`, `StatusBar`, `ConversationPicker`, `ContactPicker`, `MessageList`, `ChatEditor` |
| `src/ui/workbench-renderer.ts` | **Terminal integration** | 153 | `WorkbenchTerminalRenderer` |
| `src/types.ts` | **Type definitions** | 203 | `RenderState`, `MessageRecord`, `ConversationRecord`, `ContactRecord` |
| `src/util/text.ts` | **Text helpers** | 35 | Text decoding, truncation |
| `src/util/time.ts` | **Time formatting** | 18 | Clock/datetime formatting |

---

## Component Hierarchy

```
WechatApp (top-level component)
├── LoginScreen
│   ├── Header
│   ├── StatusBar
│   └── QR code rendering
├── ConversationScreen
│   ├── Header
│   ├── ConversationPicker
│   │   └── formatConversationRow()
│   └── StatusBar
├── ChatScreen
│   ├── Header
│   ├── MessageList
│   │   └── formatMessage()
│   ├── StatusBar (with unread summary)
│   └── ChatEditor
│       └── pi-tui Editor component
└── ContactSearchScreen
    ├── Header
    ├── ContactPicker
    │   └── formatContactRow()
    └── StatusBar
```

---

## Rendering Functions by View

### View: `"login"`
**Location**: Lines 87-108  
**Component**: `LoginScreen`

**Output Structure**:
```
[Header: "WeChat TUI" (bold)]
[Header: "Login" (dim)]
[Empty line]
[Optional debug log path (dim)]
[Empty line]
[QR URL and ASCII art] OR [Waiting message (dim)]
[Fill lines]
[Status bar (inverse)]
```

**Key Variables**:
- `state.qr` - QR event with loginUrl, qrUrl
- `state.debugLogPath` - Debug log file path
- `state.connectionState` - "waiting_scan", "waiting_confirm", etc.

---

### View: `"chats"`
**Location**: Lines 111-131  
**Component**: `ConversationScreen`

**Output Structure**:
```
[Header: "WeChat TUI" (bold)]
[Header: "Recent Chats" or "Command" (dim)]
[Empty line]
[Optional status/error messages]
[Prompt: "Chats > <query>" or "Command > <query>"]
[Empty line]
[5-10 conversation rows (windowed)]
[Optional scroll info (dim)]
[Fill lines]
[Status bar (inverse)]
```

**Conversation Row Format**:
```
> Title             (n) Sender: message preview... (if selected, inverse)
  Title             (n) Sender: message preview... (if not selected, plain)
```

**Layout Details**:
- Title: Max 28% of width (14-28 chars)
- Unread count: Right-aligned in 5-char space
- Preview: Remaining space, truncated to fit
- Marker: `"> "` (selected) or `"  "` (unselected)

**Window Behavior**:
- Min visible items: 5
- Max visible items: 10
- Calculated: `clamp(rows - 10, 5, 10)`
- Selected item always kept in view

---

### View: `"chat"`
**Location**: Lines 134-151  
**Component**: `ChatScreen`

**Output Structure**:
```
[Header: "WeChat TUI" (bold)]
[Header: "Chat: <Contact Name>" (dim)]
[Empty line]
[Optional status/error messages]
[Recent messages (last N, newest at bottom)]
[Fill lines]
[Status bar: "current <name> | unread <summary> | Esc chats" (inverse)]
[Editor prompt: "Chat >"]
[pi-tui Editor input (1-3 rows)]
[Optional autocomplete menu (0-6 rows)]
```

**Message Format**:
```
[HH:MM] Sender Name                              (dim)
  Message line 1 (indented 2 spaces)
  Message line 2
  ...
[HH:MM] You                                      (dim)
  Your message line 1
```

**Message Budget**:
- Available rows: `Math.max(5, rows - 12)`
- `rows - 12` = Header(2) + Status(2) + StatusBar(1) + Editor(3) + Spacing(4)
- Oldest messages scrolled off; only last N shown

**Message Types Displayed**:
- `text`, `notice`: Raw content
- `image`, `voice`, `video`: `[type]`
- `file`: `[file] filename` (if available)
- `mini-program`, `sticker`: `[type]`
- `unsupported`: `[unsupported message]`

---

### View: `"search"`
**Location**: Lines 154-173  
**Component**: `ContactSearchScreen`

**Output Structure**:
```
[Header: "WeChat TUI" (bold)]
[Header: "Contact Search" (dim)]
[Empty line]
[Optional status/error messages]
[Prompt: "Search > <keyword>"]
[Empty line]
[5-10 contact rows (windowed)]
[Optional scroll info (dim)]
[Fill lines]
[Status bar: "<count> results | Up/Down select | Enter open | Esc back" (inverse)]
```

**Contact Row Format**:
```
> Name                        [kind]   (if selected, inverse)
  Name                        [kind]   (if not selected, plain)
```

**Layout Details**:
- Name: Max 42% of width (16-34 chars)
- Kind: Dimmed badge `[private]`, `[group]`, etc.
- Marker: `"> "` (selected) or `"  "` (unselected)

---

## Styling Cheatsheet

### Chalk Functions Used

| Function | Effect | Usage |
|----------|--------|-------|
| `chalk.bold()` | Make text bold | Main header title only |
| `chalk.dim()` | Dim/grey text | Headers, timestamps, empty states, help text, scroll info |
| `chalk.inverse()` | White text on black | Selected rows, status bar, autocomplete selection |
| `chalk.red()` | Red text | Error messages |
| `chalk.cyan()` | NOT USED | |
| `chalk.yellow()` | NOT USED | |
| `chalk.green()` | NOT USED | |

### Styling Locations (All in `src/tui/wechat-app.ts`)

**Bold (1 location)**:
- Line 178: Header title

**Dim (13+ locations)**:
- Lines 96, 103: Login screen debug/waiting
- Line 178: Header subtitle
- Lines 200, 224: Empty states
- Lines 209, 233: Scroll info
- Lines 210, 315, 332: Message previews & contact kinds
- Line 338: Message timestamp/sender
- Lines 377: Status messages
- Lines 25-36: Editor/autocomplete theme

**Inverse (3 locations)**:
- Line 185: Status bar
- Line 310: Selected conversation row
- Lines 26-27, 333: Selected autocomplete/contact row

**Red (1 location)**:
- Line 380: Error messages

---

## Data Flow Diagram

```
Runtime (connection state, messages, etc.)
        ↓
    RenderState object
        ↓
WechatApp.setState(state)
        ↓
    [State stored internally]
        ↓
TUI.requestRender()
        ↓
WechatApp.render(width)
        ├→ if view === "login"   → LoginScreen.render()
        ├→ if view === "chats"   → ConversationScreen.render()
        ├→ if view === "chat"    → ChatScreen.render()
        └→ if view === "search"  → ContactSearchScreen.render()
        ↓
    Returns string[] (lines)
        ↓
Terminal renders each line
        ↓
User sees UI update
```

---

## Key Helper Functions

### Text Layout (`src/tui/wechat-app.ts`)

**`fit(text, width, pad?, ellipsis?)`** (Lines 418-425)
- Purpose: Ensure text fits exactly in width
- Handles ANSI color codes correctly
- Truncates with ellipsis if needed
- Pads with spaces if requested
- **Used on every line rendered**

**`fillLines(rows, used, reserved, width)`** (Lines 413-416)
- Purpose: Fill remaining vertical space
- Creates empty rows with exact width
- Pushes status bar to bottom

**`windowItems(items, selectedIndex, limit)`** (Lines 404-411)
- Purpose: Slice items for windowed view
- Keeps selected item in window
- Returns: `{ items, start }`

**`visiblePickerRows(rows)`** (Lines 400-402)
- Purpose: Calculate max visible items
- Returns: `clamp(rows - 10, 5, 10)`

### Formatting Functions

**`formatConversationRow(conversation, selected, width)`** (Lines 303-311)
- Returns: Single formatted row string
- Selection: Inverse if selected
- Layout: `"> Title (n) Preview"`

**`formatContactRow(contact, selected, width)`** (Lines 328-334)
- Returns: Single formatted row string
- Selection: Inverse if selected
- Layout: `"> Name [kind]"`

**`formatMessage(message, conversation, width)`** (Lines 336-342)
- Returns: String[] (header + wrapped content lines)
- Sender logic: "You" or contact name or group member
- Wraps content at `width - 2`, indented with 2 spaces

**`formatConversationPreview(conversation)`** (Lines 313-326)
- Returns: Last message preview string
- Shows: Sender (for groups) + message content
- Fallback: "no local messages" (dimmed)

---

## Screen Size Assumptions

### Minimum Terminal Size
- Width: Not explicitly checked, but content assumes 40+ chars
- Height: Not explicitly checked, but layouts assume 20+ rows

### Row Budget Examples

**On 24-row terminal**:
- Header: 2
- Status: ~1
- Content: ~10
- StatusBar: 1
- Editor: ~3
- Filler: Rest
- Message budget: `max(5, 24-12) = 12` rows

**On 40-row terminal**:
- Header: 2
- Status: ~1
- Content: ~20
- StatusBar: 1
- Editor: ~3
- Filler: Rest
- Message budget: `max(5, 40-12) = 28` rows

---

## Not Yet Styled (Opportunities for Enhancement)

These elements currently use **plain** text:
- Conversation unselected rows
- Contact names (selected/unselected)
- Message content (main text)
- Query input text
- Editor prompt ("Chat >")
- Unread counts
- Chat input text

Potential styling improvements:
- Color by sender (groups only)
- Highlight unread counts
- Different color for online/offline status
- Syntax highlighting in messages
- Color-coded message types

---

## Performance Considerations

### Rendering Complexity
- **O(n)** messages → each formatted individually
- **O(n)** conversations → each formatted individually
- **O(n)** search results → each formatted individually
- Only windowed items formatted (max 10 items)

### Message Display
- All messages formatted, only last N shown
- `slice(-budget)` creates new array, old array eligible for GC
- No caching of formatted messages

### Terminal Size Changes
- `resize` event triggers full re-render
- All rows recalculated
- No incremental updates

---

## Type Definitions

### RenderState (from `src/types.ts`)
```typescript
interface RenderState {
  // Navigation
  view: "login" | "chats" | "chat" | "search"
  previousView?: "login" | "chats" | "chat" | "search"

  // Connection
  connectionState: ConnectionState
  accountName?: string

  // Login
  qr?: ProtocolQrEvent
  debugLogPath?: string

  // Conversations
  conversations: ConversationRecord[]
  conversationQuery: string
  selectedConversationIndex: number
  activeConversation?: ConversationRecord

  // Messages
  messages: MessageRecord[]
  totalUnreadCount: number
  unreadConversations: ConversationRecord[]

  // Search
  searchKeyword: string
  searchResults: ContactRecord[]
  selectedSearchIndex: number

  // Editor
  chatInput: string
  commandInput: string

  // Status
  statusMessage?: string
  errorMessage?: string
}
```

