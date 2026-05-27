# WeChat TUI Integration Patterns & Developer Guide

## Quick Reference: Component Interaction Map

### 1. State Flow During Rendering

```
┌─ WeChatRuntime ─────────────────────────────────┐
│  Internal State                                 │
│  ├─ view: AppView                              │
│  ├─ connectionState: ConnectionState           │
│  ├─ conversations: ConversationRecord[]         │
│  ├─ messages: MessageRecord[]                   │
│  ├─ chatInput: string                           │
│  └─ ... (39 more fields)                        │
│                                                 │
│  Event Handlers                                 │
│  ├─ protocol.on('message') → handleIncomingMessage() → render()
│  ├─ protocol.on('login') → updateView('chats') → render()
│  ├─ keyboard events → handleKey() → updateState → render()
│  └─ chat input changes → handleChatChange() → render()
│                                                 │
│  render() method:                               │
│  ├─ buildRenderState() ← queries Store         │
│  │  ├─ store.listRecentConversations()         │
│  │  ├─ store.listMessages()                    │
│  │  ├─ store.searchContacts()                  │
│  │  └─ store.totalUnreadCount()                │
│  └─ renderer.render(state)                     │
│                                                 │
└─────────────────────────────────────────────────┘
         ↓ passes RenderState (42 fields)
┌─ WorkbenchTerminalRenderer ──────────────────────┐
│  render(state: RenderState): void               │
│  ├─ app.setState(state) ← syncs state          │
│  └─ tui.requestRender() ← schedules render     │
│                                                 │
└─────────────────────────────────────────────────┘
         ↓ TUI differential rendering
┌─ WechatApp (pi-tui Component) ──────────────────┐
│  setState(state): void                          │
│  ├─ this.state = state                         │
│  ├─ if state.view === "chat"                   │
│  │  ├─ chatEditor.syncText(state.chatInput)    │
│  │  └─ tui.setFocus(chatEditor.focusTarget)    │
│  └─ else                                        │
│     └─ tui.setFocus(null)                      │
│                                                 │
│  render(width): string[]                        │
│  ├─ switch (this.state.view)                   │
│  ├─ case "login": return loginScreen.render()  │
│  ├─ case "chats": return convScreen.render()   │
│  ├─ case "chat": return chatScreen.render()    │
│  ├─ case "search": return searchScreen.render()│
│  └─ return []                                   │
│                                                 │
│  isChatView(): boolean                          │
│  └─ return this.state.view === "chat"          │
│                                                 │
└─────────────────────────────────────────────────┘
         ↓ string[] output
┌─ Terminal ──────────────────────────────────────┐
│  Displays lines (differential rendering)       │
└─────────────────────────────────────────────────┘
```

### 2. Event Input Routing

```
┌─ Terminal Input (Keyboard) ─────────────────┐
│  Ctrl+C, Escape, Printable chars, etc.     │
└─────────────────────────────────────────────┘
         ↓
┌─ TUI.addInputListener ──────────────────────┐
│  Converts raw string → UiKey                │
│  { sequence, name?, ctrl?, meta?, shift? }  │
└─────────────────────────────────────────────┘
         ↓
┌─ WorkbenchTerminalRenderer ─────────────────┐
│  onEvent({ type: "key", key })              │
│                                              │
│  Checks: app.isChatView()                   │
│  - If in chat & not global key              │
│    → let Editor component handle it         │
│  - Otherwise                                │
│    → onEvent(uiEvent) → runtime handler     │
└─────────────────────────────────────────────┘
         ↓
┌─ WeChatRuntime ─────────────────────────────┐
│  handleUiEvent({ type: "key", key })        │
│                                              │
│  switch (this.view)                         │
│  ├─ "login": handleLoginKey(key)            │
│  ├─ "chats": handleConversationListKey(key) │
│  ├─ "chat": handleChatKey(key)              │
│  ├─ "search": handleSearchKey(key)          │
│  └─ Handle global keys (Ctrl+C, etc.)       │
│                                              │
│  Each handler:                               │
│  ├─ Updates internal state                  │
│  └─ Calls this.render()                     │
└─────────────────────────────────────────────┘
```

### 3. Text Input Flow (Chat-Specific)

```
┌─ Terminal: User Types "Hello" ──────┐
│  'H' → 'e' → 'l' → 'l' → 'o'         │
└─────────────────────────────────────┘
         ↓ per key
┌─ TUI.handleInput() ─────────────────┐
│  Editor.handleInput(char)           │
│  └─ Updates internal text buffer    │
│     └─ Emits onChange callback      │
└─────────────────────────────────────┘
         ↓
┌─ ChatEditor.onChange ───────────────┐
│  onEvent({ type: "chat-change", text: "Hello" })
└─────────────────────────────────────┘
         ↓
┌─ WeChatRuntime.handleUiEvent ──────┐
│  this.chatInput = "Hello"           │
│  this.render()                      │
└─────────────────────────────────────┘
         ↓
┌─ Build RenderState ─────────────────┐
│  state.chatInput = "Hello"          │
│  state.view = "chat"                │
│  return state                       │
└─────────────────────────────────────┘
         ↓
┌─ WechatApp.setState() ──────────────┐
│  this.state = state                 │
│  chatEditor.syncText("Hello")       │
│  └─ If text != currentText          │
│     └─ Editor.setText("Hello")      │
└─────────────────────────────────────┘
         ↓
┌─ TUI.requestRender() ───────────────┐
│  Schedules differential render      │
│  (throttled to ~16-50ms)            │
└─────────────────────────────────────┘
         ↓
┌─ WechatApp.render() ────────────────┐
│  ChatScreen.render(state, w, h)     │
│  └─ Returns: [header, status, ...,  │
│      "Chat > Hello", statusBar]     │
└─────────────────────────────────────┘
         ↓
┌─ Terminal Display ──────────────────┐
│  Shows updated chat input           │
│  "Chat > Hello"                     │
└─────────────────────────────────────┘
```

### 4. Incoming Message Handling

```
┌─ WeChat Protocol ───────────────────┐
│  Receives message from server       │
│  emit('message', incomingMessage)   │
└─────────────────────────────────────┘
         ↓
┌─ WeChatRuntime.bindProtocol ───────┐
│  protocol.on('message', msg => {    │
│    handleIncomingMessage(msg)       │
│  })                                 │
└─────────────────────────────────────┘
         ↓
┌─ handleIncomingMessage ─────────────┐
│ 1. store.upsertContact(sender)      │
│ 2. store.saveMessage(msg)           │
│ 3. Update status: "new message"     │
│ 4. Mark read if in active chat      │
│ 5. render()                         │
└─────────────────────────────────────┘
         ↓
┌─ Store Updates ─────────────────────┐
│ SQLite tables updated               │
│ ├─ contacts (sender info)           │
│ ├─ conversations (unread count)     │
│ └─ messages (new message)           │
└─────────────────────────────────────┘
         ↓
┌─ buildRenderState ──────────────────┐
│ store.listMessages(activeConvId)    │
│ └─ Returns messages including new   │
│    one                              │
│ store.totalUnreadCount()            │
│ └─ Updated unread count             │
│ store.listRecentConversations()     │
│ └─ Updated conversation preview     │
└─────────────────────────────────────┘
         ↓
┌─ WechatApp.render ──────────────────┐
│ ChatScreen shows:                   │
│ ├─ New message in list              │
│ ├─ Updated unread summary           │
│ └─ Status: "new message"            │
└─────────────────────────────────────┘
         ↓
┌─ Terminal Display ──────────────────┐
│ Chat screen updated with new msg    │
│ [14:35:22] Alice                    │
│ Hey! How are you?                   │
└─────────────────────────────────────┘
```

### 5. Protocol State Change

```
┌─ WeChat Protocol ───────────────────┐
│  Connection established             │
│  emit('login', userProfile)         │
└─────────────────────────────────────┘
         ↓
┌─ WeChatRuntime.bindProtocol ───────┐
│  protocol.on('login', user => {     │
│    this.accountName = user.name     │
│    this.qr = undefined              │
│    this.view = "chats"              │
│    this.connectionState = "online"  │
│    this.statusMessage = "logged in" │
│    this.render()                    │
│  })                                 │
└─────────────────────────────────────┘
         ↓
┌─ buildRenderState ──────────────────┐
│ Load:                               │
│ - store.listRecentConversations()   │
│ - store.totalUnreadCount()          │
│ - store.listUnreadConversations()   │
└─────────────────────────────────────┘
         ↓
┌─ WechatApp.render ──────────────────┐
│ ConversationScreen shows:           │
│ ├─ Recent conversations             │
│ ├─ Unread counts                    │
│ ├─ Connection status: "online"      │
│ ├─ Account name: "alice"            │
│ └─ Status: "logged in"              │
└─────────────────────────────────────┘
```

---

## Common Patterns

### Pattern 1: View Transitions

**Use Case**: User navigates between screens

```typescript
// In WeChatRuntime

// Current view: "chats"
// User presses Enter on selected conversation

private openSelectedConversation(): void {
  const conversations = this.listVisibleConversations();
  const selected = conversations[this.selectedConversationIndex];
  
  this.activeConversationId = selected.id;
  this.view = "chat";              // Transition to chat view
  this.previousView = "chats";      // Remember where we came from
  this.chatInput = "";              // Clear input
  this.chatHistoryIndex = -1;       // Reset history nav
  this.store.markRead(selected.id); // Mark messages as read
  this.statusMessage = `opened ${selected.title}`;
  
  this.render();  // Trigger re-render with new view
}
```

**Result**:
- `state.view` changes from "chats" to "chat"
- `WechatApp.render()` now calls `chatScreen.render()` instead
- Terminal shows chat history for selected conversation
- Focus moves to ChatEditor

---

### Pattern 2: Incremental Search

**Use Case**: User types to filter conversations

```typescript
// In WeChatRuntime.handleConversationListKey()

const text = printableText(key);
if (text) {
  this.conversationQuery += text;     // Append character
  this.selectedConversationIndex = 0; // Reset to first result
  this.render();  // Trigger re-render
}

// In buildRenderState() -> listVisibleConversations()
private listVisibleConversations(): ConversationRecord[] {
  const all = this.store.listRecentConversations(20);
  const query = this.conversationQuery.trim().toLowerCase();
  
  if (!query || query.startsWith("/")) {
    return all;  // No filter
  }
  
  return all.filter(conv => {
    const haystack = [
      conv.title,
      conv.lastMessagePreview,
      conv.lastMessageSenderName,
      conv.kind,
    ].filter(Boolean).join(" ").toLowerCase();
    
    return haystack.includes(query);
  });
}
```

**Result**:
- Each keystroke appends to query
- Conversations filtered in real-time
- Selection resets to first result
- Terminal shows filtered conversations

---

### Pattern 3: Command Execution

**Use Case**: User types `/contacts` command

```typescript
// In WeChatRuntime.handleConversationListKey()

if (isEnterKey(key)) {
  if (this.conversationQuery.trim().startsWith("/")) {
    await this.executeCommand(this.conversationQuery, "chats");
    return;
  }
  // ... else open conversation
}

// In executeCommand()
private async executeCommand(rawCommand: string, sourceView: AppView): Promise<void> {
  const command = rawCommand.trim();
  const name = command.split(/\s+/, 1)[0] ?? "";
  
  switch (name) {
    case "/contacts":
      this.enterContactSearch(sourceView);
      return;
    
    case "/refresh":
      const contacts = await this.protocol.getContacts();
      this.store.upsertContacts(contacts);
      this.statusMessage = `refreshed ${contacts.length} contacts`;
      return;
    
    case "/quit":
      this.requestExit();
      return;
    
    default:
      this.errorMessage = `unknown command: ${command}`;
  }
}

private enterContactSearch(previousView: AppView): void {
  this.previousView = previousView;
  this.view = "search";            // Change to search view
  this.searchKeyword = "";          // Clear search
  this.selectedSearchIndex = 0;     // Reset selection
  this.statusMessage = "search contacts and groups";
}
```

**Result**:
- Command parsed from query
- `/contacts` switches to search view
- Previous view remembered for back navigation
- Search state initialized

---

### Pattern 4: Message History Navigation

**Use Case**: User presses Up arrow in chat input

```typescript
// In WeChatRuntime.handleChatKey()

if (isUpKey(key)) {
  this.navigateChatHistory(-1);  // Go backwards in time
  return;
}

if (isDownKey(key)) {
  this.navigateChatHistory(1);   // Go forwards in time
  return;
}

private navigateChatHistory(direction: -1 | 1): void {
  if (this.chatInputHistory.length === 0) {
    return;  // No history
  }

  if (direction < 0) {
    // Going backwards (older messages)
    if (this.chatHistoryIndex === -1) {
      // First time: save current input
      this.chatDraftBeforeHistory = this.chatInput;
      this.chatHistoryIndex = 0;
    } else {
      // Move to older message
      this.chatHistoryIndex = Math.min(
        this.chatHistoryIndex + 1,
        this.chatInputHistory.length - 1
      );
    }
    this.chatInput = this.chatInputHistory[this.chatHistoryIndex] ?? "";
    return;
  }

  // Going forwards (newer messages)
  if (this.chatHistoryIndex === -1) {
    return;  // Not in history
  }

  if (this.chatHistoryIndex === 0) {
    // Going back to draft
    this.chatHistoryIndex = -1;
    this.chatInput = this.chatDraftBeforeHistory;
    return;
  }

  this.chatHistoryIndex -= 1;
  this.chatInput = this.chatInputHistory[this.chatHistoryIndex] ?? "";
}
```

**Result**:
- Up arrow cycles through previous messages
- Down arrow goes forward (back to draft)
- Current draft preserved while browsing
- Input updates in real-time

---

### Pattern 5: Asynchronous Protocol Operation

**Use Case**: Send message (async operation)

```typescript
// In WeChatRuntime

private async submitChatText(rawText: string): Promise<void> {
  const text = rawText.trim();
  this.chatInput = "";
  this.chatHistoryIndex = -1;

  if (!text) {
    return;  // Empty message
  }

  // Save to history before sending
  this.addChatHistory(text);

  // Send to protocol (async)
  try {
    await this.sendToActiveConversation(text);
    this.statusMessage = "message sent";
  } catch (error) {
    this.errorMessage = error.message;
  } finally {
    this.render();  // Update UI regardless of success/failure
  }
}

private async sendToActiveConversation(text: string): Promise<void> {
  const activeConversation = this.getActiveConversation();
  if (!activeConversation) {
    throw new Error("no active conversation");
  }

  // Call protocol (potentially slow)
  const sent = await this.protocol.sendText(
    activeConversation.protocolId,
    text
  );

  // Save to local store
  const message: MessageInput = {
    id: sent.messageId ? `wechat:${sent.messageId}` : generateLocalId(),
    conversationId: activeConversation.id,
    senderId: this.protocol.getCurrentUser()?.id,
    senderName: "You",
    isSelf: true,
    content: text,
    type: "text",
    timestamp: Date.now(),
    raw: sent.raw,
  };

  this.store.saveMessage(message, conversationFromRecord(activeConversation), false);
  this.persistSessionData();  // Save session to disk
}
```

**Result**:
- Text clears immediately (optimistic)
- Sent to protocol asynchronously
- On success: status shows "message sent"
- On error: error message displayed
- Local copy saved to store
- Session persisted

---

### Pattern 6: Selection Clamping

**Use Case**: Keep selection valid when list size changes

```typescript
// Problem: If selected index is 5 and list shrinks to 3 items

private moveConversationSelection(delta: number): void {
  const conversations = this.listVisibleConversations();
  
  if (conversations.length === 0) {
    this.selectedConversationIndex = 0;
    return;
  }
  
  // Move by delta, then clamp to valid range
  this.selectedConversationIndex = clamp(
    this.selectedConversationIndex + delta,
    0,
    conversations.length - 1
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Also in buildRenderState()
private buildRenderState(): RenderState {
  const conversations = this.listVisibleConversations();
  
  // Re-clamp selection to current list size
  this.selectedConversationIndex = clampSelection(
    this.selectedConversationIndex,
    conversations.length
  );
  
  // ... rest of state building
}
```

**Result**:
- Selection never exceeds list bounds
- Handles filtering/sorting changes gracefully
- No out-of-bounds errors

---

## State Mutation Rules

### Allowed Patterns

```typescript
// ✅ Direct assignment (state owned by WeChatRuntime)
this.chatInput = newText;
this.selectedConversationIndex = 0;
this.view = "chat";

// ✅ Array methods (replacing entire array)
this.conversations = [];
this.conversations = this.store.listRecentConversations();

// ✅ Async operations with final render()
await this.protocol.sendText(...);
this.render();
```

### Forbidden Patterns

```typescript
// ❌ Mutating nested objects (RenderState is passed by reference)
state.activeConversation.title = "new title";

// ❌ Directly mutating arrays without replacing
state.conversations.push(newConversation);
state.messages[0].content = "edited";

// ❌ Partial state rebuilds
state.chatInput = "new text";  // Should rebuild entire RenderState
```

### Why This Matters

```
State mutations lead to:
1. Stale data across renders
2. Differential rendering bugs (TUI doesn't detect changes)
3. Hard-to-debug state inconsistencies
4. Issues with protocol updates

Solution: Always call this.render() after state changes
- Triggers buildRenderState()
- Fresh data from Store
- Consistent view

this.render() is fast because:
- Store queries are indexed
- RenderState building is O(n) where n = recent conversations
- TUI does differential rendering
```

---

## Testing Patterns

### Unit Test: View Transition

```typescript
import { WeChatRuntime } from "../src/runtime";

describe("WeChatRuntime - View Transitions", () => {
  it("should transition from chats to chat view", () => {
    const runtime = createRuntimeForTesting();
    
    // Setup: we're in chats view with 3 conversations
    expect(runtime.view).toBe("chats");
    expect(runtime.conversations.length).toBeGreaterThan(0);
    
    // Action: open first conversation
    runtime.openSelectedConversation();
    
    // Assert
    expect(runtime.view).toBe("chat");
    expect(runtime.previousView).toBe("chats");
    expect(runtime.activeConversationId).toBeTruthy();
  });
});
```

### Integration Test: Rendering

```typescript
import { renderState } from "../src/ui/workbench-renderer";

describe("WechatApp - Rendering", () => {
  it("should render chat screen with messages", () => {
    const state: RenderState = {
      view: "chat",
      activeConversation: {
        id: "conv1",
        title: "Alice",
        kind: "private",
        // ... other fields
      },
      messages: [
        { /* message 1 */ },
        { /* message 2 */ },
      ],
      chatInput: "Hello",
      // ... other fields
    };
    
    const output = renderState(state, { width: 80, rows: 24 });
    
    // Assert rendered output contains expected content
    expect(output).toContain("Alice");
    expect(output).toContain("Hello");
    expect(output).toContain("Chat >");
  });
});
```

### Snapshot Test: TUI Output

```typescript
describe("WechatApp - Snapshots", () => {
  it("should match snapshot for login screen", () => {
    const state: RenderState = { view: "login", /* ... */ };
    const output = renderState(state);
    expect(output).toMatchSnapshot();
  });
});
```

---

## Performance Tips

### 1. Query Optimization

```typescript
// ❌ Bad: Multiple queries for same data
const conversations = this.store.listRecentConversations();
const unread = conversations.filter(c => c.unreadCount > 0);

// ✅ Good: Single query or cache results
const conversations = this.store.listRecentConversations();
const unreadCount = this.store.totalUnreadCount();
```

### 2. Rendering Optimization

```typescript
// ❌ Bad: Rendering all messages
for (const message of state.messages) {
  allLines.push(...formatMessage(message));
}

// ✅ Good: Budget-based rendering (last N messages)
const budget = Math.max(5, rows - 12);
const visibleMessages = state.messages.slice(-budget);
```

### 3. String Allocation

```typescript
// ❌ Bad: Many small string concatenations
let output = "";
for (const char of text) {
  output += char;  // Creates new string each iteration
}

// ✅ Good: Build array then join
const lines: string[] = [];
lines.push(header);
lines.push(content);
// ... 
return lines.join("\n");
```

---

## Summary

Understanding these patterns helps:
- **Maintain data consistency**: State owned by WeChatRuntime
- **Debug efficiently**: Follow the event/render flow
- **Extend features**: Use established patterns for new screens/commands
- **Optimize performance**: Use budgets, clamping, differential rendering
- **Test effectively**: Test state transitions and rendering output

