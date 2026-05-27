# Pi-TUI Quick Reference Cheat Sheet

## Version
- **@earendil-works/pi-tui**: v0.75.5
- **Node.js**: ≥ 22.19.0

## Basic Setup

```typescript
import { TUI, ProcessTerminal } from "@earendil-works/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);
tui.addChild(component);
tui.start();
```

## Component Interface

```typescript
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  wantsKeyRelease?: boolean;
}
```

## Core Components

| Component | Purpose | Key Method |
|-----------|---------|-----------|
| `Text` | Multi-line text with wrapping | `setText(text)` |
| `TruncatedText` | Text with ellipsis | `setText(text)` |
| `Input` | Single-line input | `getValue()`, `onSubmit` |
| `Editor` | Multi-line editor | `getText()`, `onSubmit` |
| `SelectList` | Interactive list | `setFilter()`, `onSelect` |
| `Markdown` | Markdown rendering | `setText(text)` |
| `Box` | Container with padding | `addChild()`, `removeChild()` |
| `Spacer` | Empty lines | `new Spacer(count)` |
| `Loader` | Spinning indicator | `start()`, `stop()` |
| `Image` | Inline images (Kitty/iTerm2) | `render()` |
| `Container` | Basic container | `addChild()`, `removeChild()` |

## Styling with Chalk

```typescript
import chalk from "chalk";

chalk.red("text")
chalk.bold.red("text")
chalk.bgGreen.white("text")
chalk.inverse("text")
chalk.dim("text")
chalk.rgb(255, 136, 0)("text")
chalk.hex("#FF8800")("text")
```

## Editor Theme

```typescript
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

const editor = new Editor(tui, editorTheme);
editor.onSubmit = (text) => { };
editor.onChange = (text) => { };
```

## Keyboard Input

```typescript
import { Key, matchesKey } from "@earendil-works/pi-tui";

// Key identifiers
Key.escape, Key.enter, Key.tab, Key.space
Key.up, Key.down, Key.left, Key.right
Key.ctrl("c"), Key.alt("x"), Key.shift("tab")
Key.ctrlShift("p"), Key.ctrlAlt("x")

// Matching
if (matchesKey(data, Key.ctrl("c"))) {
  process.exit(0);
}
```

## Editor Shortcuts (Emacs-style)

| Shortcut | Action |
|----------|--------|
| `Ctrl+A/E` | Line start/end |
| `Ctrl+B/F` | Cursor left/right |
| `Ctrl+H/D` | Delete backward/forward |
| `Ctrl+U/K` | Delete to line start/end |
| `Ctrl+W` | Delete word backward |
| `Meta+D` | Delete word forward |
| `Ctrl+Y` | Yank (paste) |
| `Meta+Y` | Yank-pop (cycle kill ring) |
| `Ctrl+Z` | Undo |
| `Up/Down` | History navigation (at line start/end) |
| `Ctrl+]` | Enter jump mode |

## Focus & IME

```typescript
// Focusable interface for IME support
interface Focusable {
  focused: boolean;
}

// Emit cursor marker in render()
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

render(width: number): string[] {
  const marker = this.focused ? CURSOR_MARKER : "";
  return [`> text${marker}cursor`];
}

// Set focus
tui.setFocus(editor);
```

## Overlays

```typescript
// Show overlay
const handle = tui.showOverlay(component, {
  width: 60,                    // or "80%"
  maxHeight: 20,                // or "50%"
  anchor: 'center',             // default
  margin: 2,                    // or { top: 1, right: 2, ... }
  visible: (w, h) => w >= 100,  // conditional display
  nonCapturing: true            // don't auto-focus
});

// Control overlay
handle.hide();                  // Remove permanently
handle.setHidden(true/false);   // Temporarily hide
handle.focus();                 // Focus and bring to front
handle.isFocused();             // Check focus state

// Hide topmost
tui.hideOverlay();
tui.hasOverlay();
```

## Text Utilities

```typescript
import {
  visibleWidth,
  truncateToWidth,
  wrapTextWithAnsi,
  sliceByColumn
} from "@earendil-works/pi-tui";

const w = visibleWidth(chalk.red("Hello"));  // 5
const t = truncateToWidth("Long", 10, "...", true);
const lines = wrapTextWithAnsi("Text", 20);
const s = sliceByColumn("Hello World", 6, 5);
```

## Image Utilities

```typescript
import {
  allocateImageId,
  encodeKitty,
  encodeITerm2,
  getImageDimensions,
  detectCapabilities,
  renderImage,
  hyperlink,
  deleteKittyImage,
  deleteAllKittyImages
} from "@earendil-works/pi-tui";

// Detect capabilities
const caps = detectCapabilities();
// { images: 'kitty' | 'iterm2' | null, trueColor: boolean, ... }

// Get image dimensions
const dims = getImageDimensions(base64Data, "image/png");

// Allocate and render
const imageId = allocateImageId();
const seq = encodeKitty(base64Data, { imageId, columns: 80 });

// Hyperlink
const link = hyperlink("Click", "https://example.com");

// Cleanup
deleteKittyImage(imageId);
deleteAllKittyImages();
```

## Input Listener

```typescript
const remove = tui.addInputListener((data) => {
  if (matchesKey(data, Key.ctrl("c"))) {
    return { consume: true };  // Consume input
  }
  return undefined;            // Pass through
});

remove();  // Unregister listener
```

## Render Control

```typescript
tui.requestRender();           // Request re-render
tui.invalidate();              // Force full re-render
tui.start();                   // Start terminal loop
tui.stop();                    // Stop terminal loop
```

## SelectList Theme

```typescript
interface SelectListTheme {
  selectedPrefix: (text: string) => string;
  selectedText: (text: string) => string;
  description: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
}
```

## Markdown Theme

```typescript
interface MarkdownTheme {
  heading: (text: string) => string;
  link: (text: string) => string;
  linkUrl: (text: string) => string;
  code: (text: string) => string;
  codeBlock: (text: string) => string;
  codeBlockBorder: (text: string) => string;
  quote: (text: string) => string;
  quoteBorder: (text: string) => string;
  hr: (text: string) => string;
  listBullet: (text: string) => string;
  bold: (text: string) => string;
  italic: (text: string) => string;
  strikethrough: (text: string) => string;
  underline: (text: string) => string;
  highlightCode?: (code: string, lang?: string) => string[];
  codeBlockIndent?: string;
}
```

## Autocomplete

```typescript
import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";

const provider = new CombinedAutocompleteProvider(
  [
    { name: "help", description: "Show help" },
    { name: "clear", description: "Clear" }
  ],
  process.cwd()
);

editor.setAutocompleteProvider(provider);
```

## Container Management

```typescript
const box = new Box(paddingX, paddingY, bgFn);
box.addChild(component);
box.removeChild(component);
box.clear();
box.children;          // Access children array
box.setBgFn(bgFn);     // Update background
```

## Common Patterns

### Multi-component UI

```typescript
const container = new Container();
container.addChild(new Text("Header"));
container.addChild(editor);
container.addChild(new Spacer(1));
container.addChild(new Text("Footer"));
tui.addChild(container);
```

### Modal Dialog

```typescript
const dialog = new Box(2, 1, (s) => chalk.bgBlue(s));
dialog.addChild(new Text("Are you sure?"));

const handle = tui.showOverlay(dialog, {
  width: 40,
  anchor: 'center',
  margin: 2
});

// Later:
handle.hide();
```

### Input with Validation

```typescript
const input = new Input();
input.onSubmit = (value) => {
  if (validate(value)) {
    processInput(value);
  } else {
    tui.addChild(new Text(chalk.red("Invalid input")));
  }
};
```

### Autocomplete Editor

```typescript
const provider = new CombinedAutocompleteProvider(commands, cwd);
const editor = new Editor(tui, theme);
editor.setAutocompleteProvider(provider);
editor.onSubmit = (text) => {
  executeCommand(text);
  editor.setText("");
};
```

## Terminal Properties

```typescript
tui.terminal.columns   // Terminal width
tui.terminal.rows      // Terminal height
```

## Global Debug Key

```typescript
tui.onDebug = () => {
  console.log("Debug triggered!");
};
// Shift+Ctrl+D triggers this
```

## Render State

```typescript
// Get hardware cursor visibility
tui.getShowHardwareCursor();

// Set hardware cursor visibility
tui.setShowHardwareCursor(true);

// Get clear on shrink behavior
tui.getClearOnShrink();

// Set clear on shrink behavior
tui.setClearOnShrink(true);

// Get full redraws count (for performance monitoring)
tui.fullRedraws;
```

## Custom Component Template

```typescript
class MyComponent implements Component {
  render(width: number): string[] {
    // Each line must be <= width columns
    // Return array of lines
    return ["Line 1", "Line 2"];
  }

  handleInput(data: string): void {
    // Process keyboard input
  }

  invalidate(): void {
    // Clear caches
  }
}
```

## Performance Tips

1. **Cache render results** - Store computed renders and invalidate when data changes
2. **Use differential updates** - Only re-render changed components
3. **Debounce frequent updates** - Limit re-renders per time period
4. **Minimize overlays** - Each overlay adds rendering overhead
5. **Profile with `fullRedraws`** - Monitor performance with `tui.fullRedraws`

## Common Issues

| Issue | Solution |
|-------|----------|
| Line too wide | Use `truncateToWidth()`, `wrapTextWithAnsi()`, or `sliceByColumn()` |
| Styles not appearing | Use chalk or ANSI codes in theme functions |
| IME not working | Implement `Focusable`, emit `CURSOR_MARKER` in render |
| Flicker | Use `synchronized` output (CSI 2026) - pi-tui does this automatically |
| Images not showing | Check terminal capabilities with `detectCapabilities()` |

## Resources

- **GitHub**: github.com/earendil-works/pi-mono/tree/main/packages/tui
- **README**: Full documentation in node_modules/@earendil-works/pi-tui/README.md
- **Types**: Full type definitions in dist/*.d.ts
