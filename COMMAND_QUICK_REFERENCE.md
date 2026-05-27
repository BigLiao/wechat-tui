# Command System Quick Reference

## File Locations Map

| Aspect | File | Lines |
|--------|------|-------|
| **Command Definitions** | `src/tui/components/chat-editor.ts` | 12-22 |
| **Command Execution** | `src/runtime.ts` | 416-476 |
| **Event Types** | `src/types.ts` | 155-161 |
| **Event Routing** | `src/runtime.ts` | 91-139 |
| **Chat Input Component** | `src/tui/components/chat-editor.ts` | Full file |
| **Runtime/State Machine** | `src/runtime.ts` | Full file (1053 lines) |
| **Chat Screen** | `src/tui/chat-screen.ts` | Full file |
| **Conversation Screen (Home)** | `src/tui/conversation-screen.ts` | Full file |
| **Status Bar/Hints** | `src/tui/components/status-bar.ts` | Full file |
| **Help Text** | `src/config.ts` | 44-80 |
| **Type Definitions** | `src/types.ts` | Full file |

---

## Command Reference Table

| Command | Args | Category | Status | Key Function | View Required |
|---------|------|----------|--------|---------------|---------------|
| `/contacts` | — | Navigation | ✅ Working | `enterContactSearch()` | chat/chats |
| `/chats` | — | Navigation | ✅ Working | View switch | any |
| `/status` | — | Info | ✅ Working | Display status msg | any |
| `/refresh` | — | Data Sync | ✅ Working | `protocol.getContacts()` | any |
| `/load` | — | Info | ✅ Stub | Status message | any |
| `/messages` | — | Search | ❌ Not impl | Error message | any |
| `/send` | `<path>` | File | ✅ Working | `sendFileToActiveConversation()` | chat |
| `/paste` | — | File | ✅ Working | `extractClipboardImage()` | chat |
| `/quit` | — | Control | ✅ Working | `requestExit()` | any |

**Status Legend**: ✅ = Fully implemented, ❌ = Not implemented, 📝 = Partial/Stub

---

## Key Classes & Methods

### WeChatRuntime

```typescript
// Main execution entry point
async executeCommand(rawCommand: string, sourceView: AppView): Promise<void>

// Submit text (routes to command or message)
private async submitChatText(rawText: string): Promise<void>

// File operations
private async sendFileToActiveConversation(rawPath: string): Promise<void>
private async sendToActiveConversation(text: string): Promise<void>
private extractClipboardImage(): string | undefined

// Key handlers
private async handleChatKey(key: UiKey): Promise<void>
private async handleConversationListKey(key: UiKey): Promise<void>
private async handleSearchKey(key: UiKey): Promise<void>

// State management
private render(): void
private buildRenderState(): RenderState
private activateAccount(user: UserProfile): void
```

### ChatEditor

```typescript
// Input capture and submission
handleInput(data: string): void
syncText(text: string): void
invalidate(): void

// Image paste detection
transformPasteData(data: string): string | undefined
private handleSubmit(text: string): void

// Rendering
render(width: number): string[]
```

---

## Data Flow Quick Reference

### Simple Command (`/status`)

```
User types "/status" + Enter
    ↓
ChatEditor.onSubmit()
    ↓
UiEvent: { type: "chat-submit", text: "/status" }
    ↓
Runtime.handleUiEvent()
    ↓
Runtime.submitChatText("/status")
    ↓
text.startsWith("/") → true
    ↓
Runtime.executeCommand("/status", "chat")
    ↓
name = "/status"
    ↓
statusMessage = "connection: online, account: My Account"
    ↓
render() → RenderState → WechatApp.setState() → Screen.render()
    ↓
Terminal updates status bar
```

### File Command (`/send ~/photo.png`)

```
User types "/send ~/photo.png" + Enter
    ↓
ChatEditor.onSubmit()
    ↓
UiEvent: { type: "chat-submit", text: "/send ~/photo.png" }
    ↓
Runtime.submitChatText()
    ↓
Runtime.executeCommand("/send ~/photo.png", "chat")
    ↓
name = "/send"
filePath = resolveFilePath("~/photo.png")
    ↓
existsSync(filePath) ? continue : errorMessage = "file not found"
    ↓
detectFileMessageKind(filePath) → "image"
    ↓
protocol.sendFile(protocolId, filePath)
    ↓
store.saveMessage(messageInput, ...)
    ↓
statusMessage = "image sent: photo.png"
    ↓
render() → Terminal displays new message
```

### Image Paste

```
User CMD+V with image file path
    ↓
WechatApp.transformPasteInput()
    ↓
ChatEditor.transformPasteData()
    ↓
detectBracketedPaste() → true
    ↓
isImageFilePath(content) → true
    ↓
imageCounter++
imageAttachments.set(1, "/path/to/image.png")
    ↓
Replace in editor: "[Image #1]"
    ↓
User continues typing: "[Image #1] Look at this!"
    ↓
User presses Enter
    ↓
ChatEditor.handleSubmit()
    ↓
Extract markers → emit file-submit for each
Remaining text → emit chat-submit
    ↓
Runtime.handleUiEvent()
    ↓
sendFileToActiveConversation("/path/to/image.png")
    ↓
sendToActiveConversation("Look at this!")
```

---

## State Mutations per Command

### Commands that mutate view

```
/contacts:  view: "chat" → "search"
/chats:     view: "chat" → "chats"
/quit:      exiting: false → true
```

### Commands that mutate statusMessage

```
/status:    statusMessage = "connection: X, account: Y"
/refresh:   statusMessage = "refreshed N contacts"
/load:      statusMessage = "local history is loaded..."
/send:      statusMessage = "image sent: filename"
/paste:     statusMessage = "image sent: filename"
/chats:     statusMessage = "recent chats"
/contacts:  statusMessage = "search contacts and groups"
```

### Commands that clear chatInput

```
All commands clear chatInput after execution
chatInput = ""
```

### Commands that mutate messageScrollOffset

```
/send:  messageScrollOffset = 0 (after sending file)
/paste: messageScrollOffset = 0 (after sending image)
```

---

## Error Conditions

| Scenario | Error Message | Recovery |
|----------|---------------|----------|
| Unknown command | `unknown command: <cmd>` | Show error, stay in view |
| `/send` without path | `usage: /send <file-path>` | Show error, stay in chat |
| `/send` with missing file | `file not found: <path>` | Show error, stay in chat |
| `/send` without active conv | `no active conversation` | Show error, stay in chat |
| `/paste` no clipboard image | `No image found in clipboard` | Show error, stay in chat |
| `/paste` unsupported platform | Platform-specific warning | Stay in chat |
| `/messages` command | `/messages local message search is not implemented yet` | Show error, stay in view |
| Protocol send error | `<protocol error message>` | Log & show error |

---

## Extension Points

### Adding a New Command

1. **Add to COMMANDS array** (`src/tui/components/chat-editor.ts`)
   ```typescript
   { name: "mycommand", description: "Do something" }
   ```

2. **Add case to switch** (`src/runtime.ts`)
   ```typescript
   case "/mycommand": {
     // Implementation
     this.statusMessage = "...";
     return;
   }
   ```

3. **Update help text** (`src/config.ts`)
   ```typescript
   "  /mycommand  Do something"
   ```

4. **Update hints if needed** (`src/tui/components/status-bar.ts`)

### Adding a New View

1. Create screen component (e.g., `src/tui/my-screen.ts`)
2. Add view type to `AppView` type (`src/types.ts`)
3. Add case to `WechatApp.render()` switch
4. Handle navigation commands to reach view
5. Add key handler in `Runtime.handleKey()`

### Modifying Event Routing

1. Add event type to `UiEvent` union (`src/types.ts`)
2. Add handler in `Runtime.handleUiEvent()`
3. Emit event from UI component

---

## Testing Checklist

### For New Commands

- [ ] Command appears in autocomplete when typing `/`
- [ ] Command is parsed correctly (including arguments)
- [ ] State updates occur as expected
- [ ] Error messages display on failure
- [ ] Status message updates on success
- [ ] View transitions work correctly
- [ ] Input is cleared after execution
- [ ] Works from all valid views
- [ ] Logging shows execution in debug mode

### For File Operations

- [ ] File path resolution works (~ expansion)
- [ ] File existence validation works
- [ ] File type detection works (image/video/file)
- [ ] Protocol sendFile is called
- [ ] Message is saved to store
- [ ] Display updates with new message

### For Navigation

- [ ] Previous view is stored
- [ ] Back navigation works (Escape key)
- [ ] Focus is set correctly on new view
- [ ] Status message is updated

---

## Debugging Tips

### Enable Debug Logging

```bash
WECHAT_TUI_DEBUG=1 npm start
# Logs written to ~/.wechat-tui/logs/
```

### Check Command Execution

```typescript
// Look for this log in debug output:
this.options.logger?.debug(
  { command: preview(command), sourceView }, 
  "executing UI command"
);
```

### Common Issues

**Command not executing:**
- Check if text starts with `/`
- Check if view allows command (most do, but validate)
- Check RuntimeOptions has logger for visibility

**State not updating on UI:**
- Ensure `render()` is called after state mutation
- Check `RenderState` is built correctly
- Verify component render method uses correct state

**Image paste not working:**
- Check if paste data has bracketed paste markers
- Verify file path is valid and exists
- Check if extension is in IMAGE_EXTENSIONS set
- Check platform-specific clipboard tool is installed

**Autocomplete not showing:**
- Ensure ChatEditor initialized with CombinedAutocompleteProvider
- Check COMMANDS array has entries
- Verify current working directory is readable

---

## Performance Considerations

### Large Contact Lists
- `searchContacts()` is O(n) with substring matching
- Consider limiting search results with `searchLimit` option

### Message Loading
- `initialHistoryLimit` controls how many messages load
- Scrolling expands loaded messages dynamically
- `activeMessageLimit()` calculates dynamic limit based on offset

### File Operations
- Async/await prevents UI blocking
- Platform clipboard extraction uses execSync (short timeout)
- Consider file size limits for protocol

---

## Architecture Patterns Used

### Event-Driven
- UI emits UiEvent
- Runtime dispatches to handlers
- Render cycle updates display

### Immutable State + Rendering
- Runtime maintains state
- buildRenderState() creates immutable RenderState
- Components render from immutable state

### Component Pattern
- Screen components (`ChatScreen`, `ConversationScreen`, etc.)
- WechatApp manages component lifecycle
- Each component implements `render()` method

### Focus Management
- TUI maintains focus (ChatEditor, SelectList, or null)
- Focus determines which component gets input
- Key dispatch handled by focused component or global handlers

### Error Handling
- Try-catch in event handlers
- Errors logged to logger
- User-friendly error messages in statusMessage/errorMessage

---

## Dependencies

### Core UI Framework
- `@earendil-works/pi-tui` - Terminal UI components
  - `Editor` - Chat input field with autocomplete
  - `SelectList` - Conversation list, search results
  - `CombinedAutocompleteProvider` - Commands + file paths

### Database
- `sqlite` - SQLite database for message store
- `src/store/sqlite-store.ts` - Store implementation

### Logging
- `pino` - Structured logging

### Node.js Built-ins
- `fs`, `path`, `os`, `child_process`, `events`

---

## Future Enhancement Ideas

1. **New Command Categories**
   - `/help` - Context-sensitive help
   - `/settings` - Modify app settings
   - `/export` - Export conversations
   - `/mute`, `/unmute` - Silence notifications

2. **Command Improvements**
   - Command arguments parsing (arg parser)
   - Command aliases (`/q` → `/quit`)
   - Command history (↑↓ in input)
   - Tab-complete arguments

3. **UI Enhancements**
   - Command palette with descriptions
   - Inline command help
   - Command preview/confirmation
   - Macro/scripting support

4. **Performance**
   - Message pagination instead of scroll offset
   - Contact caching strategies
   - Lazy loading for large conversations

