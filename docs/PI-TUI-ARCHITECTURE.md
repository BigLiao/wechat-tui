# Pi-TUI Architecture & Component Patterns

## Component Hierarchy

```
TUI (Root Container)
├── Container
│   ├── Text
│   ├── Editor
│   ├── SelectList
│   └── ...other components...
├── Overlays (shown on top)
│   ├── Box (custom dialog)
│   ├── SelectList (menu)
│   └── Input (modal input)
└── Input Listeners (global key handlers)
```

## Core Abstractions

### 1. Component Interface (Minimal)
All UI elements implement this simple interface:
- `render(width)` → `string[]` - Render to terminal lines
- `handleInput(data)?` - Process keyboard input
- `invalidate()?` - Clear render cache

### 2. TUI (Render Engine)
- Manages component tree and overlays
- Handles differential rendering (only changed regions)
- Synchronizes output with CSI 2026 (atomic updates, no flicker)
- Manages keyboard focus and input routing
- Positions hardware cursor for IME support

### 3. Terminal Abstraction
- `ProcessTerminal` - Uses stdin/stdout
- Detects Kitty keyboard protocol
- Handles raw mode and capabilities

## Rendering Pipeline

```
User Input
    ↓
InputListener(s) → Component.handleInput() → state changes
    ↓
requestRender() queued (debounced)
    ↓
render() called on root component
    ↓
Differential Comparison (only render changes)
    ↓
Apply Overlays (composited on top)
    ↓
Extract Cursor Position (CURSOR_MARKER)
    ↓
Position Hardware Cursor (for IME)
    ↓
Output to Terminal (CSI 2026 synchronized)
```

## Focus Management

```
TUI.setFocus(component)
    ↓
Update Focusable.focused = true/false
    ↓
Component renders CURSOR_MARKER
    ↓
TUI extracts cursor position
    ↓
Hardware cursor positioned for IME
```

## Overlay System

```
Normal Rendering (children → component tree)
    ↓
Overlay Rendering (components → positioned on top)
    ↓
Overlay Stacking (topmost overlay has focus)
    ↓
Overlay Compositing (single-pass line merging)
    ↓
Output (normal content + overlays)
```

## Common Component Patterns

### Pattern 1: Simple Display Component
```typescript
class StatusBar implements Component {
  constructor(private status: string) {}
  
  render(width: number): string[] {
    return [fit(this.status, width)];
  }
  
  invalidate(): void {}
}
```

### Pattern 2: Input Component with Focus
```typescript
class SearchInput implements Component, Focusable {
  focused = false;
  private value = "";
  private cursor = 0;
  
  onSubmit?: (value: string) => void;
  
  render(width: number): string[] {
    const before = this.value.slice(0, this.cursor);
    const at = this.value[this.cursor] || " ";
    const after = this.value.slice(this.cursor + 1);
    
    const marker = this.focused ? CURSOR_MARKER : "";
    return [`> ${before}${marker}${chalk.inverse(at)}${after}`];
  }
  
  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      this.onSubmit?.(this.value);
    } else if (matchesKey(data, Key.backspace)) {
      this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
      this.cursor--;
    }
  }
  
  invalidate(): void {}
}
```

### Pattern 3: Container with Dynamic Children
```typescript
class MessageList implements Component {
  private messages: Message[] = [];
  
  addMessage(msg: Message): void {
    this.messages.push(msg);
  }
  
  render(width: number): string[] {
    const lines: string[] = [];
    for (const msg of this.messages) {
      lines.push(...renderMessage(msg, width));
    }
    return lines;
  }
  
  invalidate(): void {}
}
```

### Pattern 4: Cached Rendering
```typescript
class SlowComponent implements Component {
  private cachedLines: string[] | null = null;
  private cachedWidth: number | null = null;
  
  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) {
      return this.cachedLines;
    }
    
    // Expensive computation
    const lines = computeExpensiveRender(width);
    
    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }
  
  invalidate(): void {
    this.cachedLines = null;
    this.cachedWidth = null;
  }
}
```

### Pattern 5: Responding to Theme Changes
```typescript
class ThemedBox implements Component {
  constructor(
    private theme: Theme,
    private onThemeChange: (theme: Theme) => void
  ) {}
  
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.invalidate();
  }
  
  render(width: number): string[] {
    const lines = [...];
    return lines.map(line => this.theme.applyStyles(line, width));
  }
  
  invalidate(): void {
    // Clear any cached styling
  }
}
```

## WeChat TUI Architecture

The WeChat TUI uses pi-tui with this structure:

```
WorkbenchTerminalRenderer (Terminal abstraction)
    ↓
TUI (Render engine)
    ↓
WechatApp (Root component)
    ├── LoginScreen (Screen component)
    │   ├── Header (Display)
    │   ├── StatusBar (Display)
    │   └── QRCode (Display)
    ├── ConversationScreen
    │   ├── Header
    │   ├── ConversationPicker (SelectList-like)
    │   └── StatusBar
    ├── ChatScreen
    │   ├── Header
    │   ├── MessageList (Custom container)
    │   ├── StatusBar
    │   └── ChatEditor (Editor with input)
    └── ContactSearchScreen
```

## Data Flow

```
Runtime (state machine)
    ↓
setState(RenderState)
    ↓
WechatApp.setState()
    ├── Update display state
    ├── Update focus target
    └── Call tui.requestRender()
    ↓
TUI.requestRender()
    ├── Debounce render
    └── Call WechatApp.render(width)
    ↓
render() method generates lines
    ├── Screen-specific rendering
    ├── Component composition
    └── Apply styling/formatting
    ↓
Output to terminal
    └── Update changed lines only
```

## Performance Optimization Strategies

### 1. Differential Rendering
Pi-TUI compares render output frame-to-frame:
- Only changed lines are sent to terminal
- Reduces bandwidth and flicker
- Automatic - no configuration needed

### 2. Component Caching
Cache expensive renders and invalidate on state changes:
```typescript
class ExpensiveDisplay implements Component {
  private cached: string[] | null = null;
  
  render(width: number): string[] {
    if (!this.cached) {
      this.cached = expensiveComputation(width);
    }
    return this.cached;
  }
  
  invalidate(): void {
    this.cached = null;
  }
}
```

### 3. Debounced Rendering
Pi-TUI automatically debounces render requests:
- Multiple `requestRender()` calls batched
- Minimum render interval (configurable)
- Prevents excessive terminal updates

### 4. Overlay Optimization
- Only composite overlays that changed
- Limit overlay count (each adds overhead)
- Use `visible` option to hide offscreen overlays

### 5. Input Routing
- Return `{ consume: true }` to stop propagation
- Prevents unnecessary component updates
- Global listeners can short-circuit processing

## Text Handling Considerations

### ANSI Code Awareness
- ANSI codes don't count toward width
- Use utilities to calculate visible width:
  ```typescript
  const width = visibleWidth(styledText);  // Ignores ANSI
  ```

### Line Width Compliance
- Every line from `render()` must be ≤ width
- Use these utilities:
  - `truncateToWidth()` - Truncate with ellipsis
  - `wrapTextWithAnsi()` - Word wrap preserving styles
  - `sliceByColumn()` - Extract column range

### Style Resets
- Styles reset at end of each line
- Reapply styles on each new line
- Use theme functions for consistent styling

## Keyboard Input Handling

### Input Pipeline
```
Raw stdin → Key parsing → InputListeners → Focused component
                ↓
         Kitty protocol?
         (if supported)
```

### InputListener Pattern
```typescript
tui.addInputListener((data) => {
  // Global handler - fires before component
  if (isGlobalKey(data)) {
    handleGlobally(data);
    return { consume: true };  // Stop propagation
  }
  return undefined;  // Pass to component
});
```

### Focused Component Handling
```typescript
if (focusedComponent) {
  focusedComponent.handleInput(data);
}
```

## Image Rendering

### Terminal Capability Detection
```typescript
const caps = detectCapabilities();
// Determines: Kitty protocol, iTerm2, True color support
```

### Image Protocol Selection
1. **Kitty Graphics**: Best support (animations, reuse IDs)
2. **iTerm2 Inline**: Fallback for older terminals
3. **Text Placeholder**: When no image support

## State Management Pattern

Recommended state machine for TUI apps:

```typescript
interface AppState {
  view: "login" | "chats" | "chat" | "search";
  qr?: QRInfo;
  conversations: Conversation[];
  activeConversation?: Conversation;
  messages: Message[];
  chatInput: string;
}

// Single state updates
app.setState(newState);

// Components respond to state
component.render() reads current state
component.handleInput() triggers events
events → runtime updates state → setState() → re-render
```

## Testing Patterns

### Snapshot Terminal (for testing)
```typescript
class SnapshotTerminal implements Terminal {
  columns: number;
  rows: number;
  
  constructor(width: number, height: number) {
    this.columns = width;
    this.rows = height;
  }
}

// Use for snapshot testing without actual terminal
const terminal = new SnapshotTerminal(80, 24);
const tui = new TUI(terminal);
// Render and capture output
```

## Best Practices

### 1. Component Design
- ✅ Keep components focused and simple
- ✅ Implement caching for expensive renders
- ✅ Use the Component interface consistently
- ❌ Avoid holding mutable state in render()

### 2. Focus & Input
- ✅ Use Focusable for text input components
- ✅ Emit CURSOR_MARKER when focused
- ✅ Handle keyboard input in handleInput()
- ❌ Don't assume focus state persists

### 3. Styling
- ✅ Use chalk for consistent colors
- ✅ Create reusable theme objects
- ✅ Apply styles in theme functions
- ❌ Don't embed ANSI codes in component logic

### 4. Performance
- ✅ Cache expensive computations
- ✅ Use invalidate() to clear caches
- ✅ Return early from render() if content unchanged
- ❌ Don't re-compute full render on every call

### 5. Layout
- ✅ Use utility functions for text handling
- ✅ Respect width parameter in render()
- ✅ Handle terminal resizes gracefully
- ❌ Don't assume fixed terminal size

## Debugging

### Debug Key
- **Shift+Ctrl+D** triggers `tui.onDebug`
- Use for breakpoints and inspection

### Performance Monitoring
```typescript
console.log(`Full redraws: ${tui.fullRedraws}`);
```

### Input Inspection
```typescript
tui.addInputListener((data) => {
  console.log("Raw input:", JSON.stringify(data));
  return undefined;
});
```

### Render Inspection
```typescript
tui.onDebug = () => {
  console.log(`Terminal: ${tui.terminal.columns}x${tui.terminal.rows}`);
  console.log(`Focus: ${tui.setFocus}`);
  console.log(`Full redraws: ${tui.fullRedraws}`);
};
```

## Summary

Pi-TUI provides a minimal but complete framework for building terminal UIs:

1. **Simple Component Interface** - Easy to understand and extend
2. **Efficient Rendering** - Differential updates prevent flicker
3. **Flexible Layout** - Compose components freely
4. **Rich Input Handling** - Full keyboard support including IME
5. **Extensible Design** - Create custom components easily

Perfect for building sophisticated CLI applications like WeChat TUI!
