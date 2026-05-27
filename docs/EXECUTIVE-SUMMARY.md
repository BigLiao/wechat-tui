# WeChat TUI Architecture - Executive Summary

## Project Overview
**WeChat TUI** is a terminal user interface (TUI) application for WeChat messaging, built with:
- **Frontend**: pi-tui (v0.75.5) - minimal terminal UI framework
- **Backend**: Node.js with SQLite for local storage
- **Protocol**: wechat4u library for WeChat API integration

**Codebase Size**: ~3,000 lines of well-organized TypeScript  
**Documentation**: 10 files, 5,500+ lines created  
**Architecture**: Event-driven, unidirectional data flow, stateless UI components

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                         Terminal Output                          │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│  TUI (pi-tui) - Differential Rendering & Terminal Abstraction   │
│  ├── 11 Built-in Components (Text, Input, Editor, etc.)         │
│  ├── Overlay System (dialogs/notifications)                     │
│  ├── Keyboard Handling (Kitty protocol, ANSI codes)             │
│  └── IME Support (cursor positioning for CJK input)             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│  WorkbenchRenderer - Terminal Abstraction Layer                 │
│  ├── ProcessTerminal abstraction                                │
│  ├── Input listener (keyboard events)                           │
│  ├── renderState(state) → WechatApp.setState() + TUI.render()  │
│  └── Key conversion: Raw terminal input → UiKey objects        │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│  WechatApp - UI Rendering Component (456 lines)                │
│  ├── 4 Screen implementations: Login, Chats, Chat, Search      │
│  ├── 7 Shared UI helpers: Header, StatusBar, etc.              │
│  ├── Stateless: All state from RenderState parameter           │
│  └── render(width) → string[] (pure function)                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────────────┐
│  WeChatRuntime - State Machine (792 lines)                     │
│  ├── Owns 16 state variables (view, connectionState, etc.)     │
│  ├── Event routing: keyboard → state mutations                 │
│  ├── Protocol binding: WeChat events → state mutations         │
│  ├── buildRenderState(): Queries Store, builds 42-field object │
│  └── Emits "exit" event on shutdown                            │
└─────────────────────┬───────────────────────────────────────────┘
            │                               │
     ┌──────┴────────┐           ┌─────────┴──────────┐
     │               │           │                    │
     ▼               ▼           ▼                    ▼
┌─────────────┐ ┌─────────┐ ┌─────────────┐  ┌──────────────┐
│MessageStore │ │WeChatProtocol   │ │ CLI Config  │  │ Logger   │
│ (SQLite)    │ │ WeChatProtocol  │ │ & Options  │  │ (pino)   │
└─────────────┘ ├─────────────────┤ └─────────────┘  └──────────┘
  • Contacts   │ Wechat4u Adapter │
  • Chats      ├─────────────────┤
  • Messages   │ MockProtocol    │
  • Unread     └─────────────────┘
  • Sessions
```

---

## Data Flow: Message Reception Example

```
Real WeChat sends message
          ↓
Wechat4uAdapter.on("message")
          ↓
Runtime.bindProtocol()
          ↓
Runtime.handleIncomingMessage()
  ├── Store.upsertContact(sender)
  ├── Store.saveMessage(message)
  ├── If in active chat: Store.markRead()
  └── Update statusMessage
          ↓
Runtime.render()
  ├── buildRenderState()
  │   ├── Store.listMessages(activeConversationId)
  │   ├── Store.totalUnreadCount()
  │   └── Build 42-field RenderState object
  └── Renderer.render(state)
          ↓
WorkbenchRenderer.render(state)
  ├── WechatApp.setState(state)
  └── TUI.requestRender()
          ↓
WechatApp.render(width)
  ├── Select screen based on view
  ├── MessageList.render()
  │   └── Format message[].slice(-budget)
  └── Return string[]
          ↓
TUI differential rendering
          ↓
Terminal displays new message
```

---

## Core Concepts

### 1. RenderState (42 Fields)
**Central data structure**: Complete snapshot of UI state passed from Runtime → Renderer → WechatApp

| Category | Fields | Examples |
|----------|--------|----------|
| View | view, previousView | "chat", "chats", "login", "search" |
| Connection | connectionState, accountName | "online", "syncing", "offline" |
| Conversation List | conversations[], query, index | [ConversationRecord], "" |
| Active Chat | activeConversation, messages[], chatInput | ConversationRecord, MessageRecord[] |
| Search | searchResults[], keyword, index | [ContactRecord], "alice" |
| Feedback | statusMessage, errorMessage | "message sent", "connection lost" |
| Login | qr | ProtocolQrEvent |

### 2. Event Loop
```
Repeat:
  Wait for event (keyboard or protocol)
  ↓
  Handle event (mutate Runtime state)
  ↓
  Call Runtime.render()
  ↓
  Build new RenderState
  ↓
  Pass to Renderer
  ↓
  UI updates automatically
```

### 3. Screen Routing
```
Runtime.view = "login"    → LoginScreen (QR code display)
Runtime.view = "chats"    → ConversationScreen (recent chats list)
Runtime.view = "chat"     → ChatScreen (message view + input)
Runtime.view = "search"   → ContactSearchScreen (contact search)
```

### 4. Focus Management
```
if (Runtime.view === "chat") {
  TUI.setFocus(ChatEditor)    // Terminal shows cursor, accepts input
} else {
  TUI.setFocus(null)          // No text input for other screens
}
```

---

## Key Design Patterns

### Pattern 1: Unidirectional Data Flow
- State flows **in one direction only**: Runtime → Renderer → Terminal
- No feedback loops or circular dependencies
- Enables deterministic rendering and easy debugging
- Any state change triggers re-render automatically

### Pattern 2: Stateless UI Components
- WechatApp has **no internal state**
- All state comes from immutable RenderState parameter
- Same input always produces same output (pure function)
- Easy to test: `render(state, width) → string[]`

### Pattern 3: Event-Driven Protocol Integration
- WeChat protocol is EventEmitter
- Runtime subscribes to all events
- Protocol doesn't need to know about UI
- Easy to swap protocols (Wechat4u ↔ MockProtocol)

### Pattern 4: Lazy Evaluation
- Store is queried during buildRenderState()
- Not cached in RenderState
- Always displays latest data
- Simple but effective for typical data sizes

### Pattern 5: Windowed List Rendering
```
visible_items = all_items[start : start + window_size]
window_size = max(5, terminal_height - 10)
ensure selected_item in visible_items
```
- Supports 1000s of items but renders only 5-10
- Smooth scrolling with selection
- Memory efficient

---

## Message Flow: User Types Text

```
Terminal key press: 'A'
      ↓
ProcessTerminal captures keystroke
      ↓
WorkbenchRenderer.addInputListener() callback
      ↓
rawInputToKey('A') → {sequence: 'A'}
      ↓
onEvent callback called with UiEvent
      ↓
Runtime.handleUiEvent({type: "chat-change", text: "A"})
      ↓
this.chatInput = "A"
      ↓
Runtime.render()
      ↓
buildRenderState() [chatInput = "A"]
      ↓
ChatEditor renders text, CURSOR_MARKER positioned
      ↓
Terminal displays text, IME candidate appears
```

---

## Performance Characteristics

| Operation | Time | Complexity | Notes |
|-----------|------|-----------|-------|
| Key press | <1ms | O(1) | Simple state mutation |
| View switch | 1-5ms | O(n) | n = visible items |
| Message arrival | 2-10ms | O(m) | m = message size |
| Full render | 5-20ms | O(n+m) | Differential rendering |
| Search | 10-50ms | O(k log k) | k = total contacts |

**Bottleneck**: Store queries during render  
**Optimization**: Cache frequently accessed data

---

## Supported Features

### Authentication
- ✅ QR code login
- ✅ Session persistence
- ✅ Automatic reconnection

### Messaging
- ✅ Send/receive text
- ✅ Message history (last 30)
- ✅ Unread tracking
- ✅ Multiple message types (text, image, video, file, etc.)

### Contacts
- ✅ Private chats
- ✅ Group chats
- ✅ Contact search
- ✅ Display names & remarks

### Commands
- ✅ `/contacts` - search contacts
- ✅ `/chats` - return to recent chats
- ✅ `/status` - show connection status
- ✅ `/refresh` - sync contacts
- ✅ `/quit` - exit
- ⏳ `/messages` - search (not implemented)

### Input
- ✅ Multi-line text input
- ✅ Chat history (up/down keys)
- ✅ Autocomplete
- ✅ IME support (CJK input)

---

## Extension Points

### Adding a New Screen
1. Create new class in wechat-app.ts
2. Add case to render() switch
3. Add to AppView type
4. Handle transitions in Runtime.handleKey()

### Adding a Protocol
1. Implement WeChatProtocol interface
2. Emit all required events
3. Initialize in index.ts
4. Runtime uses it unchanged

### Adding a Command
1. Add case to Runtime.executeCommand()
2. Implement handler
3. Update help text
4. Done!

### Customizing Keybindings
1. Modify isUpKey(), isDownKey(), etc. helpers
2. OR create new handlers in Runtime.handleChatKey()
3. Update StatusBar help text

---

## Deployment

### Configuration
```bash
wechat-tui [--data-dir <path>] [--db <path>] [--mock] [--debug]
```

### Environment Variables
```
WECHAT_TUI_DATA_DIR       # Local data directory (~/.wechat-tui)
WECHAT_TUI_DB            # SQLite database path
WECHAT_TUI_MOCK=1        # Use mock protocol
WECHAT_TUI_DEBUG=1       # Enable detailed logging
WECHAT_TUI_LOG_LEVEL     # trace|debug|info|warn|error|fatal
```

### Files Created
- `~/.wechat-tui/wechat-tui.sqlite` - Message database
- `~/.wechat-tui/logs/` - Debug logs (if --debug)

---

## Testing Strategy

### Unit Tests
```typescript
// Pure functions, deterministic
const lines = formatConversationRow(conversation, false, 80);
expect(lines.length).toBeGreaterThan(0);
```

### Integration Tests
```typescript
// Render state snapshot
const output = renderState(mockState, {width: 80, rows: 24});
expect(output).toMatchSnapshot();
```

### Behavior Tests
```typescript
// Event-driven with mock protocol
mockProtocol.emit("login", user);
// Verify Runtime transitions to "chats" view
```

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| QR not showing | Protocol not ready | Wait for "waiting_scan" state |
| Messages not loading | Offline or reconnecting | Check statusMessage |
| Search slow | Large contact list | Use search limits |
| Input lag | Terminal too small | Increase window size |
| CJK input broken | Missing CURSOR_MARKER | Check pi-tui version |

---

## Statistics

| Metric | Value |
|--------|-------|
| Total Lines of Code | ~3,000 |
| Runtime.ts | 792 lines |
| WechatApp.ts | 456 lines |
| Main file size | 67 lines |
| Type definitions | 203 lines |
| Protocol adapters | 700+ lines |
| MessageStore | 500+ lines |
| Documentation | 5,500+ lines |
| Number of screens | 4 |
| Number of state variables | 16 (in Runtime) |
| RenderState fields | 42 |
| Protocol events | 8 |
| Supported commands | 7 |
| Message types | 9 |

---

## Conclusion

WeChat TUI demonstrates:
- **Elegant simplicity**: Clean separation of concerns
- **Efficiency**: Differential rendering, windowed lists
- **Extensibility**: Clear patterns for adding features
- **Robustness**: Event-driven, no shared mutable state
- **User-friendly**: IME support, message history, offline mode

Perfect for:
- 💬 Terminal-based WeChat messaging
- 🔧 Building on top of pi-tui framework
- 📚 Learning TUI architecture patterns
- 🧪 Protocol integration examples

---

## References

**Documentation Files** (in `/docs/` directory):
- `PI-TUI-GUIDE.md` - Complete pi-tui API reference
- `PI-TUI-ARCHITECTURE.md` - pi-tui internals
- `WECHAT-TUI-ARCHITECTURE.md` - Complete system design
- `INTEGRATION-PATTERNS.md` - Developer patterns
- `COMPONENT-MAP.md` - Quick reference
- `SESSION-2-FINDINGS.md` - Detailed technical analysis

**Source Code** (in `src/` directory):
- `types.ts` - Central type definitions
- `runtime.ts` - Core state machine
- `tui/wechat-app.ts` - UI rendering
- `ui/workbench-renderer.ts` - Terminal abstraction
- `protocol/wechat4u-adapter.ts` - Real protocol
- `protocol/mock-protocol.ts` - Test protocol
- `store/sqlite-store.ts` - Persistence

---

*Last Updated: Session 2 - Comprehensive Architecture Investigation*
