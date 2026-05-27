# Command System Flow Diagrams

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     WeChat TUI Application                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │   LoginScreen    │  │ConversationScreen│  │  ChatScreen  │ │
│  │                  │  │  (Home/Sessions) │  │              │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│           ↑                     ↑                     ↑         │
│           └─────────────────────┴─────────────────────┘         │
│                         │                                        │
│                    WechatApp                                     │
│              (Component Manager)                                 │
│                         │                                        │
│           ┌─────────────┼─────────────┐                         │
│           ↓             ↓             ↓                         │
│       ChatEditor   ConversationList  StatusBar                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
                  ┌─────────────────────────┐
                  │   Runtime (State Mgmt)  │
                  │  - Command Execution    │
                  │  - Event Handling       │
                  │  - State Management     │
                  └─────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
          Protocol         Store         Renderer
        (WeChat API)   (SQLite DB)   (Terminal UI)
```

---

## Command Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Types in Chat                       │
│                      (e.g., "/send file.png")                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              ChatEditor.handleInput(keystroke)                  │
│  - Accumulates characters into text                             │
│  - Provides autocomplete suggestions                            │
│  - Detects image pastes                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
                    ┌─────────────────────┐
              User presses Enter         Other key
                    │                        │
                    ↓                        ↓
         ChatEditor.onSubmit()    ChatEditor.onChange()
                    │                        │
                    ↓                        ↓
         UiEvent: chat-submit     UiEvent: chat-change
                    │                        │
                    └────────────┬───────────┘
                                 ↓
                 Runtime.handleUiEvent(event)
                                 │
                    ┌────────────┴────────────┐
                    ↓                         ↓
              Is "chat-submit"?         Is "chat-change"?
                    │ YES                     │ YES
                    ↓                         ↓
        submitChatText(text)          Update this.chatInput
                    │                  (Sync editor state)
        ┌───────────┴───────────┐
        ↓                       ↓
   Starts with "/"?        Regular message
    (Command check)         (Normal message)
        │ YES                   │ NO
        ↓                       ↓
executeCommand(text)    sendToActiveConversation(text)
        │                       │
        ├─ Parse command name   └─ Protocol.sendText()
        ├─ Switch on name       └─ Store.saveMessage()
        │  (9 cases)            └─ Update statusMessage
        │
        ├──→ /contacts → enterContactSearch()
        ├──→ /chats    → view = "chats"
        ├──→ /status   → statusMessage = "connection: X"
        ├──→ /refresh  → protocol.getContacts()
        ├──→ /load     → statusMessage = "..."
        ├──→ /messages → errorMessage = "not implemented"
        ├──→ /send     → sendFileToActiveConversation()
        ├──→ /paste    → extractClipboardImage() → sendFile()
        ├──→ /quit     → requestExit()
        └──→ default   → errorMessage = "unknown command"
                │
                ├─ Update state
                ├─ Clear chatInput
                ├─ Update statusMessage/errorMessage
                └─ Trigger render cycle
                        │
                        ↓
                Runtime.render()
                        │
                        ↓
            buildRenderState() → RenderState
                        │
                        ↓
            WechatApp.setState(state)
                        │
                ┌───────┼───────┐
                ↓       ↓       ↓
            Set    Set      Set
            Focus  State   Editor
                        │
                        ↓
         Screen.render(state) → String[]
                        │
                        ↓
          Renderer.render(renderState)
                        │
                        ↓
        ┌──────────────────────────────────┐
        │    Terminal Display Updates       │
        │  - Header, Messages, Input       │
        │  - Status bar, Hints             │
        │  - Status/Error messages         │
        └──────────────────────────────────┘
```

---

## Command Types & Categories

```
┌─────────────────────────────────────────────────────────────────┐
│                     COMMANDS (9 Total)                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│   Navigation (3)    │  │   Data Sync (1)  │  │   File Ops (2)  │
├─────────────────────┤  ├──────────────────┤  ├─────────────────┤
│ /contacts           │  │ /refresh         │  │ /send <path>    │
│   → view = "search" │  │   → Get contacts │  │   → Send file   │
│                     │  │   → Update store │  │   → Detect type │
│ /chats              │  │   → Status msg   │  │                 │
│   → view = "chats"  │  │                  │  │ /paste          │
│                     │  │                  │  │   → Clipboard   │
│ (back via Escape)   │  │                  │  │   → Send image  │
│                     │  │                  │  │   → Platform:   │
│                     │  │                  │  │     macOS/Linux │
└─────────────────────┘  └──────────────────┘  └─────────────────┘

┌─────────────────────┐  ┌──────────────────┐  ┌─────────────────┐
│   Info/Status (2)   │  │  Placeholder (1) │  │  Control (1)    │
├─────────────────────┤  ├──────────────────┤  ├─────────────────┤
│ /status             │  │ /messages        │  │ /quit           │
│   → Connection info │  │   [NOT IMPL]     │  │   → requestExit │
│   → Account name    │  │   Local search   │  │   → Graceful    │
│                     │  │                  │  │     shutdown    │
│ /load               │  │                  │  │                 │
│   → Msg if loaded   │  │                  │  │                 │
│                     │  │                  │  │                 │
└─────────────────────┘  └──────────────────┘  └─────────────────┘
```

---

## State Transitions on Command Execution

```
COMMAND: /contacts
────────────────────────────────────────────────────────────────

State Before:  view = "chat"
               conversationQuery = "any value"
               selectedSearchIndex = 0

Action:        enterContactSearch("chat")
               
State After:   view = "search"
               previousView = "chat"
               searchKeyword = ""
               selectedSearchIndex = 0
               statusMessage = "search contacts and groups"

UI Change:     Chat view → Search view


COMMAND: /chats
────────────────────────────────────────────────────────────────

State Before:  view = "chat"
               chatInput = "anything"
               
State After:   view = "chats"
               previousView = "chat"
               chatInput = ""
               conversationFocus = "list"
               statusMessage = "recent chats"

UI Change:     Chat view → Conversation list


COMMAND: /send ~/path/to/image.png
────────────────────────────────────────────────────────────────

State Before:  activeConversationId = "some_id"
               chatInput = "/send ~/path/to/image.png"
               messageScrollOffset = 10
               
Action:        1. Parse path
               2. Validate file exists
               3. Detect type (image/video/file)
               4. protocol.sendFile()
               5. store.saveMessage()
               
State After:   activeConversation.messages += [new message]
               chatInput = ""
               messageScrollOffset = 0
               statusMessage = "image sent: image.png"

UI Change:     New message appears in list


COMMAND: /status
────────────────────────────────────────────────────────────────

State Before:  connectionState = "online"
               accountName = "My Account"
               
State After:   statusMessage = "connection: online, account: My Account"

UI Change:     Status bar updates


COMMAND: /refresh
────────────────────────────────────────────────────────────────

State Before:  store.contacts = [...]
               
Action:        1. protocol.getContacts()
               2. store.upsertContacts()
               3. persistSessionData()
               
State After:   store.contacts = [... updated ...]
               statusMessage = "refreshed N contacts"

UI Change:     Status bar updates
               Conversation list may refresh


COMMAND: /quit
────────────────────────────────────────────────────────────────

State Before:  exiting = false
               
State After:   exiting = true
               renderer.stop()
               emit("exit", 0)

UI Change:     Terminal returns to shell
```

---

## Event Routing

```
Terminal Input
      │
      ↓
┌─────────────────────────────┐
│   WorkbenchRenderer         │
│   Converts terminal events  │
│   to UiEvent                │
└─────────────────────────────┘
      │
      ├─────────────────────────────────────────────────┐
      ↓                                                 ↓
┌────────────────┐                            ┌─────────────────────┐
│ Key Press      │                            │ Text/Mouse Event    │
│                │                            │                     │
│ e.g., Escape   │                            │ e.g., Click, Select │
└────────────────┘                            └─────────────────────┘
      │                                                 │
      ↓                                                 ↓
UiEvent:                                     UiEvent:
{ type: "key",                              { type: "conversation-select"
  key: { ... } }                              index: 3 }
      │                                     OR
      ↓                                     { type: "chat-submit"
Runtime.handleKey(key)                        text: "..." }
      │                                     OR
      ├────────────────────┬──────────────┐ { type: "chat-change"
      ↓                    ↓              ↓   text: "..." }
   Login                Chats            Chat      OR
   Handler             Handler         Handler   { type: "file-submit"
   (q to quit)        (↑↓ select,      (↑↓ scroll,  filePath: "..." }
                      Enter open)      Enter send)    │
                                                      ↓
                                          Runtime.handleUiEvent()
                                                      │
                                          ┌───────────┼──────────┐
                                          ↓           ↓          ↓
                                      chat-   chat-    file-
                                      change  submit    submit
                                          │      │        │
                                          ↓      ↓        ↓
                                      Update   Submit    Send
                                      Input    Text      File
                                              (→ command
                                               or message)
```

---

## Image Handling Pipeline

```
┌──────────────────────────────────────────────────────────┐
│         User Pastes File or Types in Chat                │
│    (e.g., CMD+V with image path in clipboard)            │
└──────────────────────────────────────────────────────────┘
                         │
                         ↓
        ┌─────────────────────────────────┐
        │ bracketed paste detected?       │
        │ (escape sequence detection)     │
        └─────────────────────────────────┘
                    YES │        │ NO
                        ↓        └────→ Normal paste
        ┌─────────────────────────────────┐
        │ Extract paste content           │
        │ (between markers)                │
        └─────────────────────────────────┘
                         │
                         ↓
        ┌─────────────────────────────────┐
        │ Is image file path?             │
        │ - Matches image extension       │
        │ - File exists                   │
        │ - Starts with / ~ .             │
        └─────────────────────────────────┘
             YES │          │ NO
                 ↓          └────→ Normal paste
        ┌─────────────────────────────────┐
        │ Create [Image #N] marker        │
        │ Map ID → filepath               │
        │ Store in imageAttachments{}     │
        └─────────────────────────────────┘
                         │
                         ↓
        ┌─────────────────────────────────┐
        │ Insert marker into editor       │
        │ Replace paste content with      │
        │ [Image #1], [Image #2], etc.    │
        └─────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         ↓                               ↓
   User continues typing      User presses Enter
   (message + images)
                                       │
                                       ↓
                             handleSubmit()
                                       │
           ┌───────────────────────────┼───────────────┐
           ↓                           ↓               ↓
     Extract markers             Parse markers    Process remaining
     [Image #1]                  Get filepath    text as message
           │                           │               │
           ↓                           ↓               ↓
      For each marker:         event: file-submit
      1. Look up filepath              │
      2. Emit file-submit       sendFileToActive...()
         event                         │
           │                           ↓
           └──→ Runtime.handleUiEvent()
                                       │
                                       ↓
                          protocol.sendFile()
                          store.saveMessage()
```

---

## Autocomplete System

```
┌──────────────────────────────────────────────┐
│     ChatEditor with Autocomplete             │
└──────────────────────────────────────────────┘

User types "/"
      │
      ↓
CombinedAutocompleteProvider
      │
      ├─ From COMMANDS array:
      │  ├─ /send
      │  ├─ /paste
      │  ├─ /contacts
      │  ├─ /chats
      │  ├─ /status
      │  ├─ /refresh
      │  ├─ /load
      │  ├─ /messages
      │  └─ /quit
      │
      └─ From file system (cwd):
         ├─ Files in current directory
         ├─ Subdirectories
         └─ Path completion

Display:
┌────────────────────────────────────┐
│ Autocomplete Menu (up to 6 visible)│
├────────────────────────────────────┤
│ → /send      Send a file...        │
│   /paste     Send clipboard image  │
│   /contacts  Search contacts...    │
│   /chats     Return to recent...   │
│   /status    Show connection...    │
│   /refresh   Refresh local...      │
└────────────────────────────────────┘

User can:
- Press ↑↓ to navigate
- Press Tab/Enter to select
- Continue typing to filter
```

---

## Platform-Specific Clipboard Access

```
/paste command triggered
      │
      ↓
┌─────────────────────────────────────┐
│ detectPlatform() = ?                │
└─────────────────────────────────────┘
      │
  ┌───┼───┐
  ↓   ↓   ↓
darwin linux other
  │     │    │
  │     │    └─→ errorMessage = 
  │     │       "not supported"
  │     │
  │     ↓
  │    execSync(xclip -selection...)
  │     │
  │     ↓
  │    Extract to temp PNG
  │     │
  ↓     └──→ Combined
osascript          │
command            ↓
  │         ┌────────────────┐
  ↓         │ Temp file path │
Extract     └────────────────┘
PNG via           │
clipboard         ↓
  │         ┌───────────────────────┐
  ↓         │ sendFileToActive...() │
Temp file   │ protocol.sendFile()   │
path        │ store.saveMessage()   │
  │         └───────────────────────┘
  └──→ Combined
      │
      ↓
  ┌────────────┐
  │ File sent! │
  └────────────┘
```

---

## Error Handling

```
Command Execution
      │
      ├─ Try
      │   │
      │   ├─→ File not found
      │   │    └─→ errorMessage = "file not found: ..."
      │   │
      │   ├─→ No active conversation
      │   │    └─→ errorMessage = "no active conversation"
      │   │
      │   ├─→ Invalid command
      │   │    └─→ errorMessage = "unknown command: ..."
      │   │
      │   ├─→ Not implemented
      │   │    └─→ errorMessage = "/messages not implemented"
      │   │
      │   └─→ Protocol error (sendText/sendFile)
      │        └─→ logger.error()
      │        └─→ errorMessage = error.message
      │
      └─ Finally
          └─ render() if !exiting

Error Display:
┌────────────────────────┐
│ Chat Screen            │
├────────────────────────┤
│ [Header]               │
│ [Messages]             │
│ ✗ file not found: ...  │ ← Error line
│ [Input Editor]         │
│ [Status Bar]           │
└────────────────────────┘

Error Cleared On:
- New chat input (chat-change event)
- Next command execution
```

---

## Session/State Persistence

```
On Command /refresh:
─────────────────────────────────────
1. getContacts() from protocol
2. upsertContacts() to store
3. persistSessionData()
   │
   └─ protocol.getSessionData()
      └─ store.setSessionData(data)
      └─ Saved to SQLite DB

On Incoming Message:
────────────────────────────────────
1. store.saveMessage()
2. Render update
3. persistSessionData()
   └─ Session data auto-saved

On Application Exit (/quit):
────────────────────────────────────
1. requestExit()
2. renderer.stop()
3. emit("exit", 0)
4. Main process handles cleanup
```

