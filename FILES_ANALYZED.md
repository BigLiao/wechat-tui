# Files Analyzed for Command System Documentation

## Source Code Files Examined

### Core Runtime & State Management
- **src/runtime.ts** (1053 lines)
  - Command execution: `executeCommand()` method (lines 416-476)
  - Event handling: `handleUiEvent()` method (lines 91-139)
  - Key handlers: `handleChatKey()`, `handleConversationListKey()`, `handleSearchKey()`
  - State management: 18 member variables
  - File operations: `sendFileToActiveConversation()`, `extractClipboardImage()`

### Type Definitions
- **src/types.ts** (222 lines)
  - `UiEvent` type definition (lines 155-161) - 6 event types
  - `RenderState` interface (lines 163-186)
  - `AppView` type: "login" | "chats" | "chat" | "search"
  - `ConnectionState`, `MessageKind`, `ContactKind` types
  - `WeChatProtocol` interface

### Terminal UI Components
- **src/tui/components/chat-editor.ts** (154 lines)
  - **COMMANDS array** (lines 12-22) - Command definitions (9 commands)
  - Autocomplete provider setup (line 63)
  - Image paste detection: `transformPasteData()` method
  - Input handling: `handleInput()` method
  - Rendering: `render()` method

- **src/tui/components/status-bar.ts** (27 lines)
  - Status bar rendering
  - Hint sets for each view (lines 23-26)

- **src/tui/chat-screen.ts** (59 lines)
  - Chat view rendering
  - Message list, editor, status bar layout

- **src/tui/conversation-screen.ts** (38 lines)
  - Conversation list view rendering
  - Home page layout

- **src/tui/wechat-app.ts** (197 lines)
  - Main application component
  - Screen management
  - Component lifecycle

### Configuration
- **src/config.ts** (154 lines)
  - Help text (lines 44-80) - includes all command descriptions
  - CLI configuration
  - Command help documentation

### Data & Protocol
- **src/protocol/wechat4u-adapter.ts** - Real WeChat protocol
- **src/protocol/mock-protocol.ts** - Mock protocol for testing
- **src/store/sqlite-store.ts** - SQLite message store

## Documentation Files Created

### 1. COMMAND_SYSTEM_ANALYSIS.md (580 lines)
Comprehensive deep-dive covering:
- Complete project architecture
- All 9 commands with full descriptions
- Event system and routing
- Component architecture
- Data flow from input to display
- Special features (image handling, clipboard, etc)

### 2. COMMAND_FLOW_DIAGRAM.md (558 lines)
Visual representations including:
- High-level architecture diagram
- Step-by-step command execution flow
- State transition charts for each command
- Event routing pipeline
- Image handling pipeline
- Platform-specific code paths

### 3. COMMAND_QUICK_REFERENCE.md (438 lines)
Quick lookup tables and guides:
- File location map with line numbers
- Command reference table
- Key classes and methods
- Data flow examples
- Error conditions and recovery
- Extension points for new features
- Testing checklist

### 4. COMMAND_SYSTEM_README.md (271 lines)
Master index and navigation guide:
- Quick start guide (5/10/15 min reads)
- Common tasks and how to do them
- Document navigation
- Architecture patterns explained
- File organization reference

## Statistics

| Category | Count |
|----------|-------|
| Source files analyzed | 15+ |
| Documentation files created | 4 |
| Total documentation lines | 1,893 |
| Commands documented | 9 |
| Key files referenced | 8 |
| UI views documented | 4 |
| Event types documented | 6 |
| State variables documented | 18+ |

## Key File Locations

| Feature | File | Lines |
|---------|------|-------|
| Command definitions | `src/tui/components/chat-editor.ts` | 12-22 |
| Command execution | `src/runtime.ts` | 416-476 |
| Event types | `src/types.ts` | 155-161 |
| Event routing | `src/runtime.ts` | 91-139 |
| Help text | `src/config.ts` | 44-80 |
| Status hints | `src/tui/components/status-bar.ts` | 23-26 |
| Chat screen | `src/tui/chat-screen.ts` | Full file |
| Home screen | `src/tui/conversation-screen.ts` | Full file |
| Chat input | `src/tui/components/chat-editor.ts` | Full file |

## Commands Documented

1. `/send <path>` - Send file from path
2. `/paste` - Send clipboard image
3. `/contacts` - Search contacts/groups
4. `/chats` - Return to recent chats
5. `/status` - Show connection status
6. `/refresh` - Refresh contact list
7. `/load` - Load local history (stub)
8. `/messages` - Search messages (not implemented)
9. `/quit` - Exit application

## Analysis Methodology

1. **File Discovery**
   - Used `find` to locate all TypeScript files
   - Identified patterns (chat-editor, runtime, types)

2. **Command Definition Search**
   - Located COMMANDS array in chat-editor.ts
   - Identified command definitions pattern

3. **Execution Flow Tracing**
   - Found executeCommand() method
   - Traced call chain: submitChatText() → executeCommand()
   - Mapped all 9 command cases

4. **Event System Analysis**
   - Identified UiEvent types
   - Traced event routing through runtime
   - Documented handler methods

5. **Component Architecture**
   - Located screen components
   - Mapped component hierarchy
   - Documented rendering flow

6. **Special Features**
   - Found image handling in chat-editor
   - Located platform-specific code
   - Documented autocomplete integration

## Cross-References in Documentation

Each file references others for:
- **README** → Main navigation to other docs
- **ANALYSIS** → Detailed reference with line numbers
- **FLOW_DIAGRAM** → Visual representation of ANALYSIS
- **QUICK_REFERENCE** → Quick lookups related to ANALYSIS

All 1,893 lines cross-linked for easy navigation.

