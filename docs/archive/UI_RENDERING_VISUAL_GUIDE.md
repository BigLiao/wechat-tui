# WeChat TUI - Visual Rendering Guide

## Screen Layout Examples

### Login Screen (Typical 80x24 terminal)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ WeChat TUI                                                           [BOLD]   │
│ Login                                                                 [DIM]    │
│                                                                              │
│ debug log: ~/.wechat-tui/logs/wechat-tui-1234567890-1234.log                 [DIM]    │
│                                                                              │
│ Scan with WeChat: https://login.weixin.qq.com/qrcode/xxxxx                 │
│  ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄                                             │
│  █ ▀▀ ▄▄▄ ▀ █  ▀ █ ▀▄▄▀ ▀ █ ▄▄ █   (QR code ASCII)                         │
│  █ █   █   ▀   ▄ █ █   ▀█ █ █ ▀█                                           │
│  █ ▀▀▀▀▀ ▀▀▀ ▄▄▀ █   ▀ ▀█ █▀▀ █                                           │
│  ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀ ▀                                             │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ waiting_scan |  | Login | q quit                              [INVERSE]     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Conversation List Screen

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ WeChat TUI                                                           [BOLD]   │
│ Recent Chats                                                         [DIM]    │
│                                                                              │
│ Chats > a                                                                   │
│                                                                              │
│ > Alice                       (2) Alice: Sure, let's meet tomorrow          │ [INVERSE]
│   Mom                            Mom: Don't forget to eat                   │
│   Work Chat                   (5) Boss: Project deadline extended           │
│   Friend Group                     You: Thanks everyone!                    │
│   Restaurant Booking              Restaurant: Your reservation confirmed   │
│ 1-5 of 12                                                          [DIM]    │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ online | alice@wechat | unread 7 | Up/Down | Enter | /contacts | Esc/q    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Layout Breakdown**:
```
Row 1:  Header (title)
Row 2:  Header (subtitle)
Row 3:  Empty
Row 4:  Query prompt line
Row 5:  Empty
Row 6-10: Conversation rows (windowed: 5-10 items visible)
Row 11: Scroll info (if > max visible)
Row 12-22: Filler lines
Row 23: Status bar
```

### Chat Screen

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ WeChat TUI                                                           [BOLD]   │
│ Chat: Alice                                                          [DIM]    │
│                                                                              │
│ [14:32] Alice                                                        [DIM]    │
│   I'm coming to the city tomorrow, want to grab lunch?                      │
│                                                                              │
│ [14:33] You                                                          [DIM]    │
│   Sure! How about noon?                                                     │
│   Let's meet at the usual place                                             │
│                                                                              │
│ [14:35] Alice                                                        [DIM]    │
│   Sounds good. See you then!                                                │
│   [file] meeting_notes.pdf                                                  │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ current Alice | unread Mom(1), Work(5) | Esc chats                          │
│ Chat >                                                                       │
│ > Let me check my calendar                                                  │
│   ↑ Previous │ Ctrl+C to cancel │ Enter to send                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Layout Breakdown**:
```
Row 1:  Header (title)
Row 2:  Header (subtitle)
Row 3:  Empty
Row 4-5: Optional status/error messages (0-2 rows)
Row 6-16: Message history (last N messages, ~10-12 rows typical)
Row 17-20: Filler lines
Row 21: Status bar
Row 22: Chat prompt
Row 23: Editor input (pi-tui Editor, 1-3 rows)
Row 24: Autocomplete menu (0-6 rows, if applicable)
```

### Contact Search Screen

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ WeChat TUI                                                           [BOLD]   │
│ Contact Search                                                       [DIM]    │
│                                                                              │
│ Search > a                                                                  │
│                                                                              │
│ > Alice Chen                                       [private]        [INVERSE]
│   Amy Johnson                                      [private]                │
│   Angela Wu                                        [private]                │
│   Architecture Team                               [group]                  │
│   Admin Support                                   [group]                  │
│ 1-5 of 142                                                         [DIM]    │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ 142 results | Up/Down select | Enter open | Esc back                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Rendering Details

### Message List Rendering

```typescript
// Input: state.messages = [msg1, msg2, msg3, ...]
// Process: Format each message to lines

msg1: {
  timestamp: 1234567890,
  senderName: "Alice",
  isSelf: false,
  content: "Hello, how are you?"
}
  ↓
Output lines:
  "[14:32] Alice"                  ← formatMessage() header (chalk.dim)
  "  Hello, how are you?"          ← wrapped content (2-space indent)

msg2: {
  timestamp: 1234567900,
  senderName: "You",
  isSelf: true,
  content: "I'm great! Just finished work.\nLet's grab dinner!"
}
  ↓
Output lines:
  "[14:33] You"                    ← formatMessage() header (chalk.dim)
  "  I'm great! Just finished"     ← wrapped line 1 (2-space indent)
  "  work."                        ← wrapped line 2 (2-space indent)
  "  Let's grab dinner!"           ← wrapped line 3 (2-space indent)

// Budget calculation
rows = 24
budget = Math.max(5, 24 - 12) = 12 rows available for messages

// Only last 12 lines shown (newest at bottom)
allLines = [...all formatted message lines]
displayed = allLines.slice(-12)
```

### Conversation Row Rendering

```typescript
Input: ConversationRecord {
  title: "Alice Chen",
  unreadCount: 2,
  lastMessagePreview: "Sure, let's meet tomorrow",
  lastMessageSenderName: undefined,  // 1-to-1 conversation
  lastMessageIsSelf: false
}

// Layout calculation
width = 80
titleWidth = Math.max(14, Math.min(28, Math.floor(80 * 0.32)))
           = Math.max(14, Math.min(28, 25))
           = 25  // 31% of width

marker = "> "  (selected) or "  " (not selected)
title = "Alice Chen" (fits in 25 chars)
unread = "(2)" (right-padded in 5 chars: "    (2)")
preview = "Sure, let's meet tomorrow"

Row format:
"> Alice Chen            (2) Sure, let's meet tomorrow"
                    ↑                 ↑
             titleWidth        remaining space for preview

If selected: chalk.inverse(row)
Otherwise: row (plain)
```

### Conversation Picker Windowing

```typescript
// Example: 42 conversations, showing rows 1-24

state.conversations.length = 42
state.selectedConversationIndex = 15
rows = 24
maxVisible = visiblePickerRows(24) = clamp(24-10, 5, 10) = 10

windowItems(conversations, 15, 10):
  selected = clamp(15, 0, 41) = 15
  start = clamp(15 - 10 + 1, 0, max(0, 42-10))
        = clamp(6, 0, 32) = 6
  return { items: conversations.slice(6, 16), start: 6 }

Display:
  "> Item 7"      ← start + 1
  "  Item 8"
  "  Item 9"
  ...
  "  Item 15"     ← selectedIndex (shown with "> " marker)
  "  Item 16"
  ...
  7-16 of 42      ← scroll info (chalk.dim)
```

---

## Styling Application Flow

### Before Styling
```typescript
const title = "Alice Chen"
const unreadCount = 2
const preview = "Sure, let's meet tomorrow"
const row = `> ${title}            ${unreadCount} ${preview}`
// Result: "Alice Chen            2 Sure, let's meet tomorrow"
```

### With Styling (Selected)
```typescript
const row = `> ${title}            ${unreadCount} ${preview}`
            = "Alice Chen            2 Sure, let's meet tomorrow"

return chalk.inverse(row)
// Result: [ANSI-7m]Alice Chen            2 Sure, let's meet tomorrow[ANSI-0m]
//         (white text on black background)
```

### With Styling (Status Bar)
```typescript
const connectionState = "online"
const accountName = "alice@wechat"
const suffix = "unread 7 | Up/Down | Enter | /contacts | Esc/q"

const text = `${connectionState} | ${accountName} | ${suffix}`
           = "online | alice@wechat | unread 7 | Up/Down | Enter | /contacts | Esc/q"

return chalk.inverse(fit(text, 80, true))
// Result: [ANSI-7m]online | alice@wechat | unread 7 | Up/Down | Enter | /contacts | Esc/q[ANSI-0m]
//         + padding to width 80
```

---

## Text Width Calculation (ANSI-Aware)

### fit() Function Behavior

```typescript
// Example 1: Plain text
fit("Hello", 10, true)
// Visible width: 5
// Padding needed: 10 - 5 = 5 spaces
// Result: "Hello     " (10 chars, looks right)

// Example 2: With ANSI codes (chalk.dim)
const dimmed = chalk.dim("Hello")
// Raw string: "\x1b[2mHello\x1b[0m" (includes ANSI codes)
// Visible width: 5 (ANSI codes don't display)
// Padding needed: 10 - 5 = 5 spaces
// Result: "\x1b[2mHello\x1b[0m     " (19 chars raw, but displays as 10)

// Example 3: Truncation
fit("This is a longer message", 15, false)
// Visible width: 24 > 15
// Truncate to 15 with "..."
// Result: "This is a lon..." (15 visible chars)
```

---

## Message Content Wrapping

### wrapTextWithAnsi() in Action

```typescript
const content = "I'm coming to the city tomorrow, want to grab lunch?"
const width = 80  // terminal width

wrapTextWithAnsi(content, Math.max(1, 80 - 2))
  = wrapTextWithAnsi(content, 78)

Result: [
  "I'm coming to the city tomorrow, want to grab lunch?"
]

// Then each line gets:
// - Indented with 2 spaces: "  " + line
// - Fitted to width: fit("  " + line, 80)
// Result: ["  I'm coming to the city tomorrow, want to grab lunch?"]

// Example 2: Longer text needing wrap
const content = "This is a very long message about meeting up tomorrow. " + 
                "Let's plan to meet at noon at the usual coffee shop. " +
                "I'll bring my calendar."

wrapTextWithAnsi(content, 78)
Result: [
  "This is a very long message about meeting up tomorrow. Let's plan to",
  "meet at noon at the usual coffee shop. I'll bring my calendar."
]

// Then:
// "  This is a very long message about meeting up tomorrow. Let's plan to"
// "  meet at noon at the usual coffee shop. I'll bring my calendar."
```

---

## Empty States & Fallbacks

### Empty Conversation List

```
Chats >                   ← query prompt (empty)

No recent conversations yet. Use /contacts.  [DIM]
                          ← help text (chalk.dim)

// If query is active but no matches:
Chats > "abc"

No local conversations match.  [DIM]
```

### Empty Messages

```
[Chat header]
[Empty line]

No local messages yet.  [DIM]
```

### Empty Search Results

```
Search > ""

Type to search contacts and groups.  [DIM]

// If query entered but no results:
Search > "xyz"

No matches.  [DIM]
```

---

## Connection States & Display

### Status Bar Examples by State

```
init                    | Login | q quit
waiting_scan            | Login | q quit
waiting_confirm         | Login | q quit
online      | alice@... | unread 5 | ...  [connection established]
syncing     | alice@... | unread 5 | ...  [pulling new messages]
idle        | alice@... | unread 5 | ...  [connected, listening]
reconnecting | alice@... | unread 5 | ...  [temporary disconnect]
offline     | alice@... | unread 5 | ...  [connection lost]
logout      | [empty]   | Restart | q quit [logged out]
error       | [empty]   | Retry | q quit   [connection error]
```

---

## Terminal Capabilities Assumed

- ANSI color support (256 color mode minimum)
- UTF-8 text encoding
- Cursor control sequences
- Terminal size detection (SIGWINCH signals)
- Raw terminal mode capability

Tested with:
- macOS Terminal
- iTerm2
- Linux terminals (xterm, gnome-terminal)
- Windows Terminal (WSL)

---

## Performance Timeline (Typical 80x24 terminal)

```
State change
  ↓ (0ms)
WechatApp.setState()
  ↓ (0ms)
TUI.requestRender()
  ↓ (0ms)
WechatApp.render(80)
  ├ ConversationScreen.render(80, 24)
  │  ├ Header.render() → 2 lines (0.1ms)
  │  ├ ConversationPicker.render() → ~10 lines (1ms)
  │  └ StatusBar.render() → 1 line (0.1ms)
  ├ Message list format: ~10 messages × 2 lines = 20 lines (5ms)
  └ fillLines() → ~10 lines (0.1ms)
  ↓ (6ms total)
Terminal.write(~2000 bytes of ANSI)
  ↓ (varies by terminal)
Screen repaint (full redraw)
  ↓ (10-50ms depends on terminal & system)
User sees update
```

Typical frame rate: 20-60 Hz (updates every 17-50ms visible)
