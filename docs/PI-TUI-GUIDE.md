# Pi-TUI Library Guide for WeChat TUI

## Overview

**Pi-TUI** (`@earendil-works/pi-tui` v0.75.5) is a minimal but powerful **Terminal User Interface (TUI) framework** for Node.js with the following key features:

- **Differential Rendering**: Only updates screen regions that changed (efficient)
- **Synchronized Output**: Uses CSI 2026 to atomically update screen (no flicker)
- **Component-based**: Simple interface with render() method for all UI elements
- **Theme Support**: Customizable styling via theme functions
- **Keyboard Handling**: Supports both legacy terminal sequences and Kitty protocol
- **IME Support**: Hardware cursor positioning for CJK input methods
- **Rich Components**: Text, Input, Editor, Markdown, SelectList, Loader, Image, and more
- **Overlays**: Floating UI elements with positioning options
- **Inline Images**: Kitty and iTerm2 graphics protocol support

## Core Concepts

### 1. Component Interface

All UI elements implement the **Component interface**:

```typescript
interface Component {
  /**
   * Render the component to lines for the given viewport width
   * @param width - Current viewport width in columns
   * @returns Array of strings, one per line (must not exceed width)
   */
  render(width: number): string[];
  
  /**
   * Optional handler for keyboard input when component has focus
   */
  handleInput?(data: string): void;
  
  /**
   * Invalidate any cached rendering state
   * Called when theme changes or component needs to re-render from scratch
   */
  invalidate(): void;
  
  /**
   * If true, component receives key release events (Kitty protocol)
   * Default is false - release events are filtered out
   */
  wantsKeyRelease?: boolean;
}
```

**Key Rules:**
- Each line returned by `render()` must be ≤ width columns
- Styles (ANSI codes) don't carry across lines; each line gets a reset
- Components must handle ANSI codes without counting them toward width

### 2. TUI Class (Main Container)

The **TUI class** is the root container that manages all components and rendering:

```typescript
import { TUI, ProcessTerminal } from "@earendil-works/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

// Add components
tui.addChild(component);
tui.removeChild(component);

// Set keyboard focus
tui.setFocus(focusableComponent);

// Render management
tui.requestRender();      // Request a re-render
tui.invalidate();         // Force full re-render

// Lifecycle
tui.start();              // Start terminal loop
tui.stop();               // Stop terminal loop

// Input handling
tui.addInputListener((data) => {
  // Process raw terminal input
  return { consume: true }; // Consume or pass through
});

// Overlays
const handle = tui.showOverlay(component, options);
handle.hide();
handle.setHidden(true);
tui.hideOverlay();
tui.hasOverlay();
```

**Properties:**
- `terminal: Terminal` - The underlying terminal instance
- `showHardwareCursor: boolean` - Toggle hardware cursor visibility
- `clearOnShrink: boolean` - Re-render when content shrinks (default: true)
- `onDebug?: () => void` - Callback for debug key (Shift+Ctrl+D)

### 3. Terminal Abstraction

Pi-TUI abstracts the terminal through a **Terminal interface**:

```typescript
interface Terminal {
  columns: number;
  rows: number;
  // Internal methods for rendering and input handling
}
```

**Default Implementation: ProcessTerminal**
- Uses `process.stdin`/`process.stdout`
- Auto-detects Kitty keyboard protocol
- Handles raw mode and terminal capabilities

## Built-in Components

### Text Component
Displays multi-line text with word wrapping and optional styling.

```typescript
import { Text } from "@earendil-works/pi-tui";
import chalk from "chalk";

const text = new Text(
  "Hello World",           // text content
  1,                       // paddingX (default: 0)
  0,                       // paddingY (default: 0)
  (s) => chalk.blue(s)    // optional background color function
);

text.setText("Updated text");
text.setCustomBgFn((s) => chalk.bgGreen(s));
```

### TruncatedText Component
Text that truncates with ellipsis if too wide.

```typescript
import { TruncatedText } from "@earendil-works/pi-tui";

const truncated = new TruncatedText(
  "Very long text here",
  "...",               // ellipsis (default: "...")
  0,                  // paddingX
  0                   // paddingY
);
```

### Box Component
Container that applies padding and background color to children.

```typescript
import { Box, Text } from "@earendil-works/pi-tui";

const box = new Box(
  2,                           // paddingX
  1,                           // paddingY
  (s) => chalk.bgCyan(s)      // optional background function
);

box.addChild(new Text("Boxed content"));
box.removeChild(component);
box.clear();
```

**Properties:**
- `children: Component[]` - Child components
- `setBgFn(fn)` - Update background styling function

### Spacer Component
Renders empty lines for vertical spacing.

```typescript
import { Spacer } from "@earendil-works/pi-tui";

const spacer = new Spacer(2); // 2 empty lines (default: 1)
```

### Input Component
Single-line text input with horizontal scrolling, IME support.

```typescript
import { Input, CURSOR_MARKER } from "@earendil-works/pi-tui";
import chalk from "chalk";

const input = new Input();

input.getValue();                    // Get current text
input.setValue("new value");         // Set text
input.focused = true;                // Set focus for IME
input.onSubmit = (value) => {
  console.log("User submitted:", value);
};
input.onEscape = () => {
  console.log("User pressed Escape");
};

// Emacs-style editing:
// Ctrl+B/Left: move left
// Ctrl+F/Right: move right
// Ctrl+A: line start
// Ctrl+E: line end
// Ctrl+K: delete to line end
// Ctrl+U: delete to line start
// Ctrl+W: delete word backward
// Meta+D: delete word forward
// Ctrl+Y: yank (paste)
// Meta+Y: yank-pop (cycle through kill ring)
```

**Focusable Interface (IME Support):**
```typescript
interface Focusable {
  focused: boolean;  // Set by TUI when focus changes
}

// When rendering with IME, emit CURSOR_MARKER at cursor position:
const CURSOR_MARKER = "_pi:c";
```

### Editor Component
Multi-line text editor with syntax highlighting potential, autocomplete, and history.

```typescript
import { Editor, type EditorTheme } from "@earendil-works/pi-tui";
import chalk from "chalk";

interface EditorTheme {
  borderColor: (str: string) => string;
  selectList: SelectListTheme;  // For autocomplete
}

const editorTheme: EditorTheme = {
  borderColor: (text) => chalk.dim(text),
  selectList: {
    selectedPrefix: (text) => chalk.inverse(text),
    selectedText: (text) => chalk.inverse(text),
    description: (text) => chalk.dim(text),
    scrollInfo: (text) => chalk.dim(text),
    noMatch: (text) => chalk.dim(text)
  }
};

const editor = new Editor(tui, editorTheme, {
  paddingX: 2,                    // Optional padding
  autocompleteMaxVisible: 10      // Max autocomplete items
});

editor.getText();                     // Get current text
editor.getExpandedText();             // Get with paste markers expanded
editor.getLines();                    // Get lines array
editor.setText(text);                 // Set text
editor.addToHistory(text);            // Add to history for up/down navigation

editor.setAutocompleteProvider(provider);  // Set autocomplete source
editor.onSubmit = (text) => { };           // Callback on Ctrl+Enter
editor.onChange = (text) => { };           // Callback on content change
editor.disableSubmit = false;              // Toggle Ctrl+Enter

editor.focused = true;            // Set focus for IME
editor.invalidate();              // Force re-render
```

**Keyboard Shortcuts (Emacs-style):**
```
Navigation:
  Up/Down/Left/Right: Move cursor
  Ctrl+B/F: Move left/right
  Ctrl+A/E: Line start/end
  Ctrl+H: Delete backward
  Ctrl+D: Delete forward
  Meta+D: Delete word forward
  Ctrl+U/K: Delete to line start/end
  Page Up/Down: Scroll

Editing:
  Ctrl+Y: Yank (paste)
  Meta+Y: Yank-pop (cycle kill ring)
  Ctrl+Z: Undo

History:
  Up/Down: Navigate history (when at start/end)

Jump Mode:
  Ctrl+]: Enter jump mode, press character to jump to
```

### SelectList Component
Interactive list with filtering and keyboard navigation.

```typescript
import { SelectList, type SelectListTheme, type SelectItem } from "@earendil-works/pi-tui";
import chalk from "chalk";

interface SelectItem {
  value: string;
  label: string;
  description?: string;
}

const items: SelectItem[] = [
  { value: "opt1", label: "Option 1", description: "First choice" },
  { value: "opt2", label: "Option 2", description: "Second choice" }
];

const theme: SelectListTheme = {
  selectedPrefix: (text) => chalk.inverse(text),
  selectedText: (text) => chalk.inverse(text),
  description: (text) => chalk.dim(text),
  scrollInfo: (text) => chalk.dim(text),
  noMatch: (text) => chalk.dim(text)
};

const list = new SelectList(
  items,
  5,     // maxVisible items
  theme,
  {
    minPrimaryColumnWidth: 30,     // Min width for primary column
    maxPrimaryColumnWidth: 50,     // Max width for primary column
    truncatePrimary: (context) => { // Custom truncation
      // context: { text, maxWidth, columnWidth, item, isSelected }
      return text;
    }
  }
);

list.setFilter("opt");                      // Filter items
list.setSelectedIndex(0);                   // Set highlighted item
list.getSelectedItem();                     // Get current selection

list.onSelect = (item) => { };              // User pressed Enter
list.onCancel = () => { };                  // User pressed Escape
list.onSelectionChange = (item) => { };    // User moved highlight
```

**Controls:**
- Arrow keys: Navigate
- Enter: Select
- Escape: Cancel

### Markdown Component
Renders Markdown with ANSI styling.

```typescript
import { Markdown, type MarkdownTheme, type DefaultTextStyle } from "@earendil-works/pi-tui";
import chalk from "chalk";

interface MarkdownTheme {
  heading: (text: string) => string;
  link: (text: string) => string;
  linkUrl: (text: string) => string;
  code: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  codeBlockIndent?: string;            // Default: "  "
  quote: (text: string) => string;
  quoteBorder: (text: string) => string;
  hr: (text: string) => string;
  listBullet: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  strikethrough: (text: string) => string;
  underline: (text: string) => string;
  highlightCode?: (code: string, lang?: string) => string[];  // Syntax highlighting
}

interface DefaultTextStyle {
  color?: (text: string) => string;
  bgColor?: (text: string) => string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
}

const markdown = new Markdown(
  "# Title\n\n**bold** and *italic*",
  1,                    // paddingX
  1,                    // paddingY
  theme,
  {                     // Optional default style
    color: (s) => chalk.gray(s)
  }
);

markdown.setText("New content");
```

**Supported Markdown:**
- Headings: `# H1`, `## H2`, etc.
- Bold: `**bold**`
- Italic: `*italic*`
- Strikethrough: `~~text~~`
- Underline: `__text__`
- Code: `` `code` ``
- Code blocks: ` ```lang ... ``` `
- Quotes: `> quote`
- Lists: `- item` or `1. item`
- Horizontal rules: `---`
- Tables: Markdown table syntax
- Links: `[text](url)`

### Image Component
Renders images inline (Kitty or iTerm2 protocols).

```typescript
import { Image, type ImageTheme, type ImageOptions } from "@earendil-works/pi-tui";
import chalk from "chalk";

interface ImageTheme {
  fallbackColor: (str: string) => string;
}

interface ImageOptions {
  maxWidthCells?: number;
  maxHeightCells?: number;
  filename?: string;
  imageId?: number;  // Reuse Kitty image ID for animations
}

const image = new Image(
  base64Data,           // base64-encoded PNG/JPEG/GIF/WebP
  "image/png",          // MIME type
  { fallbackColor: (s) => chalk.dim(s) },
  {
    maxWidthCells: 80,
    maxHeightCells: 20
  }
);

// Dimensions are auto-detected from image data
// Falls back to text placeholder on unsupported terminals
```

### Loader Component
Animated loading indicator.

```typescript
import { Loader, type LoaderIndicatorOptions } from "@earendil-works/pi-tui";
import chalk from "chalk";

const loader = new Loader(
  tui,
  (s) => chalk.cyan(s),     // Spinner color
  (s) => chalk.gray(s),     // Message color
  "Loading...",             // Initial message
  {
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    intervalMs: 80  // Frame interval
  }
);

loader.start();
loader.setMessage("Still loading...");
loader.setIndicator({ frames: [...], intervalMs: 100 });
loader.stop();
```

### CancellableLoader Component
Loader that can be cancelled with Escape key.

```typescript
import { CancellableLoader } from "@earendil-works/pi-tui";

const loader = new CancellableLoader(
  tui,
  (s) => chalk.cyan(s),
  (s) => chalk.gray(s),
  "Working..."
);

loader.onAbort = () => {
  console.log("User pressed Escape");
};

// Use loader.signal for async cancellation
doAsyncWork(loader.signal).then((result) => {
  if (!loader.aborted) {
    // Handle result
  }
});
```

**Properties:**
- `signal: AbortSignal` - Aborted when Escape pressed
- `aborted: boolean` - Whether aborted
- `onAbort?: () => void` - Escape callback

### SettingsList Component
Settings panel with value cycling and submenus.

```typescript
import { SettingsList, type SettingItem, type SettingsListTheme } from "@earendil-works/pi-tui";
import chalk from "chalk";

interface SettingItem {
  id: string;
  label: string;
  description?: string;
  currentValue: string;
  values?: string[];  // Cycle through with Enter
  submenu?: (currentValue: string, done: (selectedValue?: string) => void) => Component;
}

interface SettingsListTheme {
  label: (text: string, selected: boolean) => string;
  value: (text: string, selected: boolean) => string;
  description: (text: string) => string;
  cursor: string;
  hint: (text: string) => string;
}

const settings = new SettingsList(
  [
    { id: "theme", label: "Theme", currentValue: "dark", values: ["dark", "light"] },
    { id: "model", label: "Model", currentValue: "gpt-4" }
  ],
  10,
  theme,
  (id, newValue) => console.log(`${id} = ${newValue}`),
  () => console.log("Done")
);

settings.updateValue("theme", "light");
```

**Controls:**
- Arrow keys: Navigate
- Enter/Space: Activate
- Escape: Cancel

### Container Component
Basic container for grouping components.

```typescript
import { Container } from "@earendil-works/pi-tui";

const container = new Container();
container.addChild(component1);
container.addChild(component2);
container.removeChild(component1);
container.clear();
```

## Keyboard Input

### Key Helper

Use the `Key` helper for typed key identifiers:

```typescript
import { Key, matchesKey } from "@earendil-works/pi-tui";

// Special keys
Key.escape, Key.enter, Key.tab, Key.space
Key.backspace, Key.delete, Key.insert
Key.home, Key.end, Key.pageUp, Key.pageDown
Key.up, Key.down, Key.left, Key.right
Key.f1, Key.f2, ..., Key.f12

// Single modifiers
Key.ctrl("c")          // Ctrl+C
Key.alt("x")           // Alt+X
Key.shift("tab")       // Shift+Tab
Key.super("k")         // Super+K

// Combined modifiers
Key.ctrlShift("p")     // Ctrl+Shift+P
Key.ctrlAlt("x")       // Ctrl+Alt+X
Key.ctrlSuper("k")     // Ctrl+Super+K

// String literals also work
"escape", "enter", "tab", "ctrl+c", "shift+tab", "ctrl+shift+p"
```

### Key Matching

```typescript
import { matchesKey, Key } from "@earendil-works/pi-tui";

if (matchesKey(data, Key.ctrl("c"))) {
  process.exit(0);
}

if (matchesKey(data, Key.enter)) {
  submit();
} else if (matchesKey(data, Key.escape)) {
  cancel();
}
```

### Keybindings

Pi-TUI provides a global keybinding registry:

```typescript
import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";

const keybindings = getKeybindings();

// Default keybindings include:
// - tui.editor.cursorUp, cursorDown, cursorLeft, cursorRight
// - tui.editor.cursorWordLeft, cursorWordRight
// - tui.editor.cursorLineStart, cursorLineEnd
// - tui.editor.jumpForward, jumpBackward
// - tui.editor.pageUp, pageDown
// - tui.editor.deleteCharBackward/Forward
// - tui.editor.deleteWordBackward/Forward
// - tui.editor.deleteToLineStart/End
// - tui.editor.yank, yankPop
// - tui.editor.undo
// - tui.input.newLine, submit, tab, copy
// - tui.select.up, down, pageUp, pageDown, confirm, cancel

// Custom keybindings
setKeybindings({
  "tui.editor.cursorUp": "ctrl+p",
  "tui.editor.cursorDown": "ctrl+n"
});
```

## Overlays

Overlays render on top of existing content without replacing it.

```typescript
import { TUI } from "@earendil-works/pi-tui";
import type { OverlayOptions, OverlayHandle } from "@earendil-works/pi-tui";

// Show overlay with default centering
const handle = tui.showOverlay(component);

// Show overlay with custom options
const handle = tui.showOverlay(component, {
  // Sizing
  width: 60,                    // Fixed width in columns
  width: "80%",                 // Percentage of terminal width
  minWidth: 40,                 // Minimum width floor
  maxHeight: 20,                // Max height in rows
  maxHeight: "50%",             // Percentage of terminal height

  // Anchor-based positioning
  anchor: 'center',             // Default position
  // Other anchors: top-left, top-right, bottom-left, bottom-right,
  //                top-center, bottom-center, left-center, right-center
  offsetX: 2,                   // Horizontal offset from anchor
  offsetY: -1,                  // Vertical offset from anchor

  // Percentage-based positioning (alternative to anchor)
  row: "25%",                   // Vertical: 0%=top, 100%=bottom
  col: "50%",                   // Horizontal: 0%=left, 100%=right

  // Absolute positioning (overrides anchor/percent)
  row: 5,                       // Exact row
  col: 10,                      // Exact column

  // Margin from terminal edges
  margin: 2,                    // All sides
  margin: { top: 1, right: 2, bottom: 1, left: 2 },

  // Responsive visibility
  visible: (termWidth, termHeight) => termWidth >= 100,

  // Focus behavior
  nonCapturing: true             // Don't auto-focus when shown
});

// OverlayHandle API
handle.hide();                  // Permanently remove overlay
handle.setHidden(true);         // Temporarily hide (can show later)
handle.setHidden(false);        // Show after hiding
handle.isHidden();              // Check if hidden
handle.focus();                 // Focus and bring to front
handle.unfocus();               // Release focus to previous
handle.isFocused();             // Check if has focus

// Hide topmost overlay
tui.hideOverlay();

// Check for overlays
tui.hasOverlay();
```

## Autocomplete

### CombinedAutocompleteProvider

Supports both slash commands and file paths:

```typescript
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";

const provider = new CombinedAutocompleteProvider(
  [
    { name: "help", description: "Show help" },
    { name: "clear", description: "Clear screen" },
    { name: "delete", description: "Delete item" }
  ],
  process.cwd()  // Base path for file completion
);

editor.setAutocompleteProvider(provider);
```

**Features:**
- Type `/` to trigger slash commands
- Press Tab for file path completion
- Supports `~/`, `./`, `../`, `@` prefixes
- `@` prefix filters to attachable files

## Styling & ANSI Codes

Pi-TUI uses **ANSI escape sequences** for styling. Use libraries like **chalk** for convenience:

```typescript
import chalk from "chalk";

// Basic colors
chalk.red("text")
chalk.green("text")
chalk.blue("text")
chalk.yellow("text")
chalk.cyan("text")
chalk.magenta("text")
chalk.white("text")
chalk.gray("text")

// Background colors
chalk.bgRed("text")
chalk.bgGreen("text")
chalk.bgBlue("text")
// etc.

// Styles
chalk.bold("text")
chalk.italic("text")
chalk.underline("text")
chalk.strikethrough("text")
chalk.inverse("text")
chalk.dim("text")

// Combinations
chalk.bold.red("text")
chalk.bgGreen.white("text")

// True color (24-bit RGB)
chalk.rgb(255, 136, 0)("text")
chalk.bgRgb(255, 136, 0)("text")

// Hex colors
chalk.hex("#FF8800")("text")
chalk.bgHex("#FF8800")("text")
```

**Important Notes:**
- Styles reset at end of each line; reapply per line
- Theme functions receive plain text and return styled text
- ANSI codes don't count toward width calculations

## Utility Functions

### Text Layout

```typescript
import {
  visibleWidth,              // Get visible column width of string
  truncateToWidth,           // Truncate string to max width
  wrapTextWithAnsi,          // Word-wrap preserving ANSI codes
  sliceByColumn,             // Extract column range
  extractSegments            // Extract before/after segments
} from "@earendil-works/pi-tui";

// Get visible width (ANSI codes ignored)
const width = visibleWidth("Hello");  // 5
const width = visibleWidth(chalk.red("Hello"));  // Still 5

// Truncate with ellipsis
truncateToWidth("Very long text", 10, "...", true);
// Returns: "Very lo..." (truncated and padded)

// Word wrap text while preserving styles
const lines = wrapTextWithAnsi("Long text here", 20);

// Slice by column position
const segment = sliceByColumn("Hello World", 6, 5);  // "World"
```

### Image Handling

```typescript
import {
  allocateImageId,
  encodeKitty,
  encodeITerm2,
  deleteKittyImage,
  deleteAllKittyImages,
  getImageDimensions,
  getPngDimensions,
  getJpegDimensions,
  detectCapabilities,
  renderImage
} from "@earendil-works/pi-tui";

// Detect terminal capabilities
const caps = detectCapabilities();
// Returns: { images: 'kitty' | 'iterm2' | null, trueColor: boolean, hyperlinks: boolean }

// Get image dimensions (auto-detects format)
const dims = getImageDimensions(base64Data, "image/png");
// Returns: { widthPx: number, heightPx: number }

// Allocate Kitty image ID
const imageId = allocateImageId();

// Encode for Kitty graphics protocol
const kittySequence = encodeKitty(base64Data, {
  columns: 80,
  rows: 24,
  imageId: imageId,
  moveCursor: true
});

// Encode for iTerm2 inline images
const iterm2Sequence = encodeITerm2(base64Data, {
  width: 80,
  height: 24,
  preserveAspectRatio: true,
  inline: true
});

// Delete image
deleteKittyImage(imageId);
deleteAllKittyImages();
```

### Hyperlinks

```typescript
import { hyperlink } from "@earendil-works/pi-tui";

// Create clickable hyperlink (OSC 8 protocol)
const link = hyperlink("Click here", "https://example.com");
// Works in: Ghostty, Kitty, WezTerm, iTerm2, VSCode, etc.
```

## Real-World Example: WeChat TUI

The WeChat TUI uses pi-tui for rendering chat UI:

```typescript
import { TUI, ProcessTerminal, Editor, Text, Key, matchesKey } from "@earendil-works/pi-tui";
import chalk from "chalk";
import type { Component } from "@earendil-works/pi-tui";

// Create TUI
const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

// Define theme
const editorTheme = {
  borderColor: (text) => chalk.dim(text),
  selectList: {
    selectedPrefix: (text) => chalk.inverse(text),
    selectedText: (text) => chalk.inverse(text),
    description: (text) => chalk.dim(text),
    scrollInfo: (text) => chalk.dim(text),
    noMatch: (text) => chalk.dim(text)
  }
};

// Create chat editor
const chatEditor = new Editor(tui, editorTheme);
chatEditor.onSubmit = (message) => {
  // Send message
  sendMessage(message);
  chatEditor.setText("");
};

// Create main UI component
const app: Component = {
  render(width) {
    const lines = [];
    lines.push(chalk.bold("WeChat Chat"));
    lines.push("");
    lines.push(...renderMessages(width));
    lines.push("");
    lines.push(...chatEditor.render(width));
    return lines;
  },
  invalidate() {
    chatEditor.invalidate();
  }
};

tui.addChild(app);
tui.setFocus(chatEditor);

// Handle input
tui.addInputListener((data) => {
  if (matchesKey(data, Key.ctrl("c"))) {
    tui.stop();
    process.exit(0);
  }
  return undefined;  // Pass through to focused component
});

tui.start();
```

## Performance Considerations

1. **Differential Rendering**: Only changed regions are re-rendered
2. **Caching**: Components can cache render results
3. **Synchronized Output**: CSI 2026 prevents flicker
4. **Invalidation**: Call `invalidate()` when data changes to clear cache
5. **Request Render**: Call `requestRender()` to trigger next frame
6. **Debouncing**: Consider debouncing frequent updates

## Terminal Support

**Tested Terminals:**
- Kitty
- Ghostty
- WezTerm
- iTerm2
- xterm-256color
- Linux console

**Features:**
- True color (24-bit RGB): Detected at startup
- Kitty graphics protocol: For inline images
- iTerm2 inline images: Fallback for images
- Kitty keyboard protocol: For accurate key detection
- OSC 8 hyperlinks: For clickable links

## Advanced: Creating Custom Components

```typescript
import { Component, CURSOR_MARKER, type Focusable } from "@earendil-works/pi-tui";
import { visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Simple component
class MyComponent implements Component {
  render(width: number): string[] {
    return [
      "Line 1",
      "Line 2"
    ];
  }
  
  handleInput?(data: string): void {
    // Process keyboard input
  }
  
  invalidate(): void {
    // Clear any caches
  }
}

// Component with focus and cursor
class MyInput implements Component, Focusable {
  focused = false;
  private value = "";
  private cursor = 0;
  
  render(width: number): string[] {
    const before = this.value.slice(0, this.cursor);
    const at = this.value[this.cursor] || " ";
    const after = this.value.slice(this.cursor + 1);
    
    // Emit cursor marker for IME support
    const marker = this.focused ? CURSOR_MARKER : "";
    const cursor_vis = chalk.inverse(at);
    
    return [`> ${before}${marker}${cursor_vis}${after}`];
  }
  
  handleInput(data: string): void {
    if (data === "\x08") {  // Backspace
      this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
      this.cursor--;
    }
  }
  
  invalidate(): void {}
}
```

## Summary

Pi-TUI provides everything needed to build sophisticated terminal UIs:
- ✅ Component-based architecture
- ✅ Efficient differential rendering
- ✅ Rich built-in components
- ✅ Keyboard input handling with Kitty protocol support
- ✅ IME cursor positioning for CJK input
- ✅ Theme system for styling
- ✅ Overlay system for dialogs/modals
- ✅ Image rendering support
- ✅ Autocomplete integration
- ✅ Utility functions for text manipulation

Perfect for building interactive CLI applications like the WeChat TUI!
