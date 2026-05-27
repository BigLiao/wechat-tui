# WeChat TUI - UI Rendering System Documentation

Complete exploration of how the WeChat TUI renders its terminal UI.

## 📚 Documentation Files

This exploration consists of three comprehensive documents:

### 1. **UI_RENDERING_EXPLORATION.md** (21 KB)
The most detailed reference covering every aspect of the rendering system.

**Sections**:
- Project overview & dependencies (pi-tui, chalk, qrcode-terminal)
- **Message formatting & display** (MessageList component)
  - Rendering flow with code examples
  - Message content handling (text, images, files, etc.)
  - Screen space budget calculation
- **Conversation listing & selection** (ConversationPicker)
  - Row format: `"> Title (n) Preview"`
  - Windowing algorithm for list navigation
  - Visible rows calculation
- **Header & status bar rendering**
  - Header component (title + subtitle)
  - Status bar on each view
  - Status messages (informational & error)
- **Colors & text styling** (Chalk library)
  - All 4 styling functions used: bold, dim, inverse, red
  - 20+ specific styling locations documented
  - pi-tui theme objects
- **Layout & screen real estate**
  - Universal layout structure (header → content → statusbar)
  - View-specific layouts for all 4 screens
  - Key layout helper functions with examples
  - Spacing details
- **Style constants & theme definitions**
  - Current state: inline styling (no centralized theme)
  - Opportunity for refactoring
- **PI-TUI framework integration**
  - What pi-tui provides (Editor, text utils, key handling)
  - Custom components hierarchy
- **Data flow: State → Render**
  - Complete rendering pipeline
  - RenderState interface structure

### 2. **UI_RENDERING_QUICK_REFERENCE.md** (10 KB)
Quick lookup guide organized by topic.

**Sections**:
- File map with line counts
- Component hierarchy tree
- View-specific rendering functions (login, chats, chat, search)
- Styling cheatsheet (all chalk functions & locations)
- Data flow diagram (runtime → terminal)
- Key helper functions reference
- Screen size assumptions
- Opportunities for enhancement (currently unstyled elements)
- Performance considerations
- Type definitions (RenderState)

### 3. **UI_RENDERING_VISUAL_GUIDE.md** (16 KB)
Visual examples and diagrams of how rendering works.

**Sections**:
- Screen layout examples for all 4 views (80x24 terminal)
  - Login screen with QR code
  - Conversation list with windowing
  - Chat view with message history
  - Contact search screen
- Component rendering details with examples
  - Message list formatting step-by-step
  - Conversation row layout calculation
  - Windowing algorithm execution
- Styling application flow (before/after with ANSI codes)
- Text width calculation (ANSI-aware)
- Message content wrapping examples
- Empty states & fallbacks
- Connection states & display
- Terminal capabilities assumed
- Performance timeline & frame rate

## 🗂️ Quick Navigation

**Finding specific information?**

| Topic | Location |
|-------|----------|
| How messages are displayed | Exploration §1 or Quick §"Message Display" |
| Conversation row format | Quick §"Chats view" or Visual §"Conversation Row" |
| All color/styling used | Quick §"Styling Cheatsheet" or Exploration §4 |
| Layout structure | Quick §"File Map" or Exploration §5 |
| Visual examples | Visual guide (all sections) |
| RenderState data structure | Exploration §8 or Quick §"Type Definitions" |
| Performance info | Quick §"Performance" or Visual §"Timeline" |

## 🎯 Key Findings

### 1. **Rendering Architecture**
- **Single entry point**: `WechatApp.render(width)` returns `string[]`
- **Component-based**: Each screen is a class with `render()` method
- **Line-based rendering**: No pixel graphics, all text lines
- **pi-tui framework**: Rust-based TUI library wrapped for Node.js

### 2. **Styling System**
- **Library**: chalk v5.4.1 (ANSI colors)
- **Functions used**: `chalk.bold()`, `chalk.dim()`, `chalk.inverse()`, `chalk.red()`
- **Style count**: Only 4 distinct styles applied
- **Current state**: Inline styling throughout (no centralized theme)

### 3. **Message Display**
- **Format**: `[HH:MM] Sender` (header, dimmed) + Indented content
- **Indentation**: 2 spaces from column 0
- **Content wrapping**: Wraps at `width - 2`, ANSI-aware
- **Budget**: `Math.max(5, rows - 12)` rows available for messages
- **Scrolling**: Only last N messages shown (automatic scroll to newest)

### 4. **Conversation Listing**
- **Row format**: `"> Title (n) Sender: Preview"` or `"  Title"`
- **Title width**: 14-28 chars (28% of terminal width)
- **Selection**: Full-row inverse highlighting
- **Windowing**: 5-10 items visible, keeps selected item in view
- **Scroll info**: Shows "X-Y of Z" when more items exist

### 5. **Layout Strategy**
- **Universal structure**: Header (2) → Status (0-2) → Content → Filler → StatusBar (1)
- **View-specific content**: Different pickers/lists by screen
- **Dynamic spacing**: `fillLines()` pushes content to bottom
- **Width handling**: `fit()` ensures every line fits exactly, ANSI-aware

### 6. **Performance**
- **Complexity**: O(n) for visible items only (windowed)
- **Render time**: ~6ms for typical state
- **Terminal output**: ~2000 bytes per frame
- **Frame rate**: 20-60 Hz typical

## 📋 Components Breakdown

```
src/tui/wechat-app.ts (456 lines)
  ├── WechatApp (main component)
  ├── LoginScreen
  ├── ConversationScreen
  │   └── ConversationPicker
  ├── ChatScreen
  │   ├── MessageList
  │   └── ChatEditor (pi-tui Editor)
  ├── ContactSearchScreen
  │   └── ContactPicker
  ├── Header
  ├── StatusBar
  └── Formatting functions:
      ├── formatConversationRow()
      ├── formatContactRow()
      ├── formatMessage()
      ├── formatConversationPreview()
      ├── messageDisplayContent()
      ├── fit()
      ├── fillLines()
      ├── windowItems()
      ├── visiblePickerRows()
      ├── pushStatus()
      ├── unreadSummary()
      ├── qrLines()
      └── emptyState()
```

## 🔍 Styling Coverage

| Element | Style | Line |
|---------|-------|------|
| Main title | bold | 178 |
| Subtitles | dim | 178 |
| Status bar | inverse | 185 |
| Selected rows | inverse | 310, 333 |
| Error messages | red | 380 |
| Empty states | dim | 200, 224, 243, 246 |
| Timestamps | dim | 338 |
| Help text | dim | 25-36 |
| Scroll info | dim | 209, 233 |

## 🚀 Next Steps (Enhancement Opportunities)

Currently unstyled (could be styled):
1. Conversation row preview text
2. Contact names
3. Message content (main body)
4. Unread count badges
5. Chat input text
6. Status messages (could use colors by state)

Potential improvements:
- Centralized theme object
- Color by sender (groups)
- Connection state indicators
- Message type indicators (color-coded)
- Syntax highlighting for code messages
- Custom color schemes

## 📊 By The Numbers

- **Total files explored**: 5 (wechat-app.ts, workbench-renderer.ts, types.ts, text.ts, time.ts)
- **Main rendering file**: 456 lines
- **Components**: 11 major classes
- **Helper functions**: 10+
- **Styling functions**: 4 (bold, dim, inverse, red)
- **Styling locations**: 20+
- **Data flows**: 1 main (RenderState → terminal)
- **Views**: 4 (login, chats, chat, search)
- **Max visible items**: 10 (conversations or search results)
- **Message display budget**: 5-28 rows (depends on terminal height)

## 📖 How to Use This Documentation

**I want to...**
- 🎨 **Understand the styling system** → Start with Quick Reference §"Styling Cheatsheet", then Exploration §4
- 📝 **Know how messages render** → Visual Guide §"Message List Rendering" or Exploration §1
- 🧩 **See the component structure** → Quick Reference §"Component Hierarchy"
- 📍 **Find where something is styled** → Exploration §6 or Quick Reference §"Styling Cheatsheet"
- 🖼️ **See visual examples** → Visual Guide (all sections)
- ⚙️ **Understand how layout works** → Exploration §5 with Quick Reference §"Key Helper Functions"
- 📊 **Get a complete overview** → This index file, then Exploration §1

## 📝 Notes

- Plan mode enabled: Exploration was conducted without making changes
- All files are TypeScript (.ts)
- Main rendering file is well-structured with clear separation of concerns
- No external UI framework beyond pi-tui
- All styling is library-based (chalk) and could be centralized
- Terminal size not validated (assumes 40+ width, 20+ height)

---

**Created**: May 26, 2026  
**Project**: wechat-tui (WeChat TUI)  
**Framework**: pi-tui v0.75.5, chalk v5.4.1  
**Status**: Complete exploration, plan mode

