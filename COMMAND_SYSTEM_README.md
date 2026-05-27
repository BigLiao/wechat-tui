# WeChat TUI Command System Documentation

This directory contains comprehensive documentation of the slash-command system in the weixin-tui application.

## 📚 Documentation Files

### 1. **COMMAND_SYSTEM_ANALYSIS.md** (580 lines)
**Complete architectural overview and deep dive**

- Project structure and file organization
- Application architecture (4 views: login, chats, chat, search)
- Complete data flow from user input to terminal display
- Detailed command system explanation
- Event system and routing
- Component architecture (ChatEditor, Chat/Conversation screens, StatusBar)
- User interface and controls
- Key handlers for all views
- Render state structure
- Message types and protocol communication
- Special features (image handling, file type detection, platform-specific clipboard)
- Configuration options
- State management
- Threading and async handling

**Best for:** Understanding the big picture, learning how everything connects, detailed reference

---

### 2. **COMMAND_FLOW_DIAGRAM.md** (558 lines)
**Visual flow diagrams and state transition charts**

- High-level architecture diagram
- Complete command execution flow (step-by-step with ASCII art)
- Command types & categories (9 commands organized by function)
- State transitions for each command showing before/after state
- Event routing from terminal input to component handling
- Image handling pipeline (paste detection → marker insertion → file submission)
- Autocomplete system
- Platform-specific clipboard access (macOS vs Linux)
- Error handling and recovery
- Session/state persistence workflow

**Best for:** Visual learners, understanding flow, debugging specific paths, state mutation tracking

---

### 3. **COMMAND_QUICK_REFERENCE.md** (438 lines)
**Quick lookup tables and implementation guides**

- File locations map (which file, which lines)
- Command reference table (9 commands with status, category, functions)
- Key classes & methods with signatures
- Data flow quick reference for common scenarios
- State mutations per command
- Error conditions and recovery
- Extension points (how to add new commands, views, events)
- Testing checklist for new features
- Debugging tips and common issues
- Performance considerations
- Architecture patterns used
- Dependencies listed
- Future enhancement ideas

**Best for:** Quick lookups, adding new features, debugging, testing, extension

---

## 🗂️ File Organization in Project

```
weixin-tui/
├── src/
│   ├── tui/
│   │   ├── wechat-app.ts              # Main app component
│   │   ├── chat-screen.ts             # Chat view
│   │   ├── conversation-screen.ts     # Home/conversation list
│   │   ├── contact-search-screen.ts   # Search view
│   │   ├── login-screen.ts            # Login view
│   │   └── components/
│   │       ├── chat-editor.ts         # Chat input (COMMANDS defined here)
│   │       ├── message-list.ts
│   │       ├── status-bar.ts
│   │       └── ...
│   ├── runtime.ts                     # Command execution (MAIN LOGIC)
│   ├── types.ts                       # Type definitions
│   ├── config.ts                      # Help text & config
│   └── ...
├── COMMAND_SYSTEM_ANALYSIS.md         # This project ← You are here
├── COMMAND_FLOW_DIAGRAM.md            # This project
├── COMMAND_QUICK_REFERENCE.md         # This project
└── README.md                          # Original project README
```

---

## 🚀 Quick Start: Understanding the System

### 1. Start Here (5 min read)
Read the **Overview** section of `COMMAND_SYSTEM_ANALYSIS.md` to understand:
- What this is (WeChat TUI with slash commands)
- The 4 views (login, chats, chat, search)
- High-level data flow

### 2. Visual Understanding (10 min)
Look at diagrams in `COMMAND_FLOW_DIAGRAM.md`:
- **High-Level Architecture** - see component relationships
- **Command Execution Flow** - understand the path from user input to display

### 3. Details (15 min)
Read the full `COMMAND_SYSTEM_ANALYSIS.md` to understand:
- How commands are defined
- How command execution works
- Event system routing
- Component architecture

### 4. Reference (as needed)
Use `COMMAND_QUICK_REFERENCE.md` to:
- Quickly find file locations
- Look up command details
- Understand state mutations
- Add new commands

---

## 💡 Key Insights

### Command Definition
Commands are simply defined in an array in `src/tui/components/chat-editor.ts`:
```typescript
const COMMANDS = [
  { name: "send", description: "Send a file (image, video, doc)" },
  { name: "paste", description: "Send clipboard image" },
  // ... more commands
];
```

### Command Execution
When user types `/command` and presses Enter:
1. ChatEditor emits `chat-submit` event
2. Runtime's `submitChatText()` routes to `executeCommand()`
3. Command name is extracted and matched in switch statement
4. Command-specific action is performed
5. State is mutated
6. `render()` is called to update display

### Event Flow
Terminal Input → UiEvent → Runtime.handleUiEvent() → Command/Message Handler → State Mutation → Render → Terminal Display

### State Management
Runtime maintains all app state in member variables:
- `view`, `chatInput`, `statusMessage`, `errorMessage`, etc.
- `buildRenderState()` creates immutable snapshot for rendering
- Components render from this snapshot
- No two-way binding - unidirectional data flow

---

## 🔧 Common Tasks

### Add a New Command
1. Add to COMMANDS array (`chat-editor.ts`)
2. Add case to switch in `executeCommand()` (`runtime.ts`)
3. Update help text (`config.ts`)
4. Refer to `COMMAND_QUICK_REFERENCE.md` **Extension Points** section

### Debug a Command Not Working
1. Check `COMMAND_QUICK_REFERENCE.md` **Common Issues** section
2. Enable debug logging: `WECHAT_TUI_DEBUG=1 npm start`
3. Follow flow in `COMMAND_FLOW_DIAGRAM.md` to identify where it breaks
4. Check error conditions in `COMMAND_QUICK_REFERENCE.md`

### Understand State Changes
1. Look at **State Transitions** in `COMMAND_FLOW_DIAGRAM.md`
2. Check **State Mutations per Command** in `COMMAND_QUICK_REFERENCE.md`
3. Read command implementation in `runtime.ts`

### Add a New View
1. Read **Modifying Event Routing** in `COMMAND_QUICK_REFERENCE.md`
2. Create screen component (follow pattern of `ChatScreen`, `ConversationScreen`)
3. Update type definitions
4. Wire up to WechatApp and Runtime

---

## 📊 Command Summary

| Command | Status | Type | What it does |
|---------|--------|------|--------------|
| `/send <path>` | ✅ | File | Send file from path |
| `/paste` | ✅ | File | Send image from clipboard |
| `/contacts` | ✅ | Nav | Search contacts/groups |
| `/chats` | ✅ | Nav | Return to recent chats |
| `/status` | ✅ | Info | Show connection status |
| `/refresh` | ✅ | Sync | Refresh contact list |
| `/load` | ✅ | Info | Load local history (stub) |
| `/messages` | ❌ | Search | Search messages (not impl) |
| `/quit` | ✅ | Ctrl | Exit application |

---

## 🏗️ Architecture Patterns

### Event-Driven
- UI components emit events
- Runtime dispatches to handlers
- Render cycle updates display

### Immutable State + Rendering  
- Runtime maintains mutable state
- `buildRenderState()` creates immutable snapshot
- Components render from immutable data

### Component Pattern
- Screen components implement `render(state) → string[]`
- WechatApp manages component lifecycle
- Each component focuses on one view

### Focus Management
- TUI routes input to focused component
- Components can reject focus
- Allows multiple interactive elements

---

## 🔍 File Location Quick Links

| What | Where |
|------|-------|
| Command names & descriptions | `src/tui/components/chat-editor.ts` lines 12-22 |
| Command execution logic | `src/runtime.ts` lines 416-476 |
| Event type definitions | `src/types.ts` lines 155-161 |
| Event routing | `src/runtime.ts` lines 91-139 |
| Help text | `src/config.ts` lines 44-80 |
| Status bar hints | `src/tui/components/status-bar.ts` lines 23-26 |

---

## 🧪 Testing

For testing new commands, use the **Testing Checklist** in `COMMAND_QUICK_REFERENCE.md`:
- Command appears in autocomplete ✓
- Command is parsed correctly ✓
- State updates as expected ✓
- Error messages display on failure ✓
- Status message updates on success ✓
- View transitions work ✓
- Input clears after execution ✓

---

## 📝 Notes for Developers

### Before Making Changes
1. Read relevant section in appropriate doc
2. Review current implementation in code
3. Check for side effects (state mutations)
4. Update all three places: command def, execution, help text

### When Adding Features
- Keep commands simple and focused
- Provide clear error messages
- Update status message on success
- Log important operations (logger.debug)
- Clear input after command execution

### Code Style Notes
- Commands use lowercase names (`/send`, not `/SEND`)
- File paths resolved with `resolveFilePath()` to expand `~`
- Async operations prevent UI blocking
- Error handling uses try-catch with logger

---

## 🎯 Next Steps

1. **Read the overview** in `COMMAND_SYSTEM_ANALYSIS.md`
2. **Study the flow diagram** in `COMMAND_FLOW_DIAGRAM.md`
3. **Explore the code** following the file locations
4. **Use the quick reference** for specific lookups
5. **Try adding a simple command** to understand the flow

---

## 📖 Document Versions

Created: 2026-05-27
Analyzed: WeChat TUI (`weixin-tui` project)
Framework: TypeScript + pi-tui terminal UI framework
Current Commands: 9 (8 implemented, 1 placeholder)

---

## ✅ What's Covered

- [x] Complete architecture explanation
- [x] All 9 commands documented
- [x] Data flow from input to display
- [x] Event system and routing
- [x] Component organization
- [x] State management
- [x] Special features (image paste, clipboard, autocomplete)
- [x] Error handling
- [x] Extension points for new commands
- [x] Testing guidelines
- [x] Debugging tips
- [x] Performance considerations

## ❓ Questions?

Refer to the appropriate document:
- **"How does X work?"** → `COMMAND_SYSTEM_ANALYSIS.md`
- **"What happens when I type X?"** → `COMMAND_FLOW_DIAGRAM.md`
- **"Where is X?"** / **"How do I add X?"** → `COMMAND_QUICK_REFERENCE.md`

---

**Happy coding! 🎉**
