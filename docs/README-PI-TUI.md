# Pi-TUI Library Documentation

Complete understanding of the pi-tui library used by the WeChat TUI for terminal rendering.

## 📚 Documentation Files

This directory contains 4 comprehensive guides about the pi-tui library:

### 1. **PI-TUI-SUMMARY.txt** ⭐ Start Here
- **Length**: 550 lines
- **Purpose**: Executive summary and comprehensive overview
- **Best for**: Quick understanding of what pi-tui is and what it can do
- **Contents**:
  - Package information and dependencies
  - Core concepts and architecture
  - All 11 built-in components
  - Keyboard system and shortcuts
  - Styling and colors
  - Terminal support
  - Key findings and design philosophy

### 2. **PI-TUI-GUIDE.md** 📖 Complete Reference
- **Length**: 1007 lines, 26 KB
- **Purpose**: Comprehensive API reference with examples
- **Best for**: Learning how to use pi-tui with code examples
- **Contents**:
  - Component interface deep dive
  - TUI class management
  - Detailed component documentation (Text, Input, Editor, etc.)
  - Keyboard input handling
  - Focus & IME support
  - Overlays system
  - Autocomplete integration
  - Text utilities and helpers
  - Image rendering
  - Styling with ANSI codes
  - Real-world WeChat TUI example
  - Performance considerations
  - Terminal support details
  - Custom component creation
  - Advanced patterns

### 3. **PI-TUI-QUICK-REFERENCE.md** ⚡ Cheat Sheet
- **Length**: 420 lines, 9.8 KB
- **Purpose**: Quick lookup and reference
- **Best for**: Quick answers while coding
- **Contents**:
  - Core component table
  - Keyboard shortcuts table
  - Editor theme template
  - Common patterns
  - Text utilities quick lookup
  - Image utilities quick lookup
  - Terminal properties
  - Troubleshooting guide
  - Performance tips

### 4. **PI-TUI-ARCHITECTURE.md** 🏗️ Design Patterns
- **Length**: 476 lines, 11 KB
- **Purpose**: Architecture, patterns, and best practices
- **Best for**: Understanding design and building complex components
- **Contents**:
  - Component hierarchy
  - Core abstractions (Component, TUI, Terminal)
  - Rendering pipeline flow
  - Focus management
  - Overlay system flow
  - 5 common component patterns with code
  - WeChat TUI architecture
  - Data flow diagram
  - Performance optimization strategies
  - Text handling considerations
  - Keyboard input handling pipeline
  - State management pattern
  - Testing patterns
  - Best practices (do's and don'ts)
  - Debugging techniques

## 🎯 Quick Navigation

**I want to...**
- **Understand what pi-tui is** → Start with PI-TUI-SUMMARY.txt
- **Learn how to use it** → Read PI-TUI-GUIDE.md
- **Find a specific API quickly** → Use PI-TUI-QUICK-REFERENCE.md
- **Build a custom component** → See PI-TUI-ARCHITECTURE.md section "Common Component Patterns"
- **Understand the rendering system** → PI-TUI-ARCHITECTURE.md section "Rendering Pipeline"
- **Find keyboard shortcuts** → PI-TUI-QUICK-REFERENCE.md section "Editor Shortcuts"
- **Style my components** → PI-TUI-GUIDE.md section "Styling & ANSI Codes"
- **Handle keyboard input** → PI-TUI-GUIDE.md section "Keyboard Input"
- **Make IME work** → PI-TUI-GUIDE.md section "Focusable Interface"
- **Optimize performance** → PI-TUI-ARCHITECTURE.md section "Performance Optimization Strategies"

## 📊 Statistics

- **Total lines of documentation**: 2,453
- **Total size**: ~65 KB
- **Files**: 4
- **Code examples**: 50+
- **Components documented**: 15+
- **Utility functions documented**: 40+

## 🚀 Quick Start

The simplest pi-tui app:

```typescript
import { TUI, ProcessTerminal, Text, Editor, Key, matchesKey } from "@earendil-works/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

const editor = new Editor(tui, {
  borderColor: (s) => chalk.dim(s),
  selectList: { /* ... theme ... */ }
});

editor.onSubmit = (text) => console.log("Submitted:", text);

tui.addChild(editor);
tui.setFocus(editor);

tui.addInputListener((data) => {
  if (matchesKey(data, Key.ctrl("c"))) {
    tui.stop();
    process.exit(0);
  }
});

tui.start();
```

See PI-TUI-GUIDE.md for complete example.

## 🎨 Key Concepts at a Glance

| Concept | What It Is | Where to Learn |
|---------|-----------|---|
| Component | Interface for all UI elements | PI-TUI-SUMMARY.txt section 2.A or PI-TUI-GUIDE.md |
| TUI | Main render engine and component manager | PI-TUI-SUMMARY.txt section 2.B |
| Differential Rendering | Only updates changed screen regions | PI-TUI-ARCHITECTURE.md "Rendering Pipeline" |
| Focusable | Interface for text input components | PI-TUI-GUIDE.md "Focusable Interface" |
| Overlay | Component displayed on top of content | PI-TUI-GUIDE.md "Overlays" |
| Theme | Color/styling configuration object | PI-TUI-QUICK-REFERENCE.md or PI-TUI-GUIDE.md |
| Key | Keyboard input identifier | PI-TUI-GUIDE.md "Key Helper" |

## 🏗️ Component Map

**Display-only:**
- Text, TruncatedText, Box, Spacer, Markdown, Image, Loader

**Interactive (focus-capable):**
- Input, Editor, SelectList

**Containers:**
- Container, Box

See PI-TUI-QUICK-REFERENCE.md for component table with key methods.

## 💡 Design Philosophy

Pi-TUI follows these principles:
1. **Minimal Interface**: Simple Component API (render, handleInput, invalidate)
2. **Composability**: Components combine freely, no deep inheritance
3. **Efficiency**: Differential rendering prevents flicker
4. **Terminal-agnostic**: Works across terminals (Kitty, iTerm2, xterm, etc.)
5. **IME-capable**: Hardware cursor positioning for CJK input

## 🔧 How WeChat TUI Uses Pi-TUI

```
WorkbenchTerminalRenderer
    ↓
TUI (render engine)
    ↓
WechatApp (root component)
    ├── LoginScreen (displays QR, header, status)
    ├── ConversationScreen (conversation list)
    ├── ChatScreen (messages + editor)
    └── ContactSearchScreen (contact search)
```

See PI-TUI-ARCHITECTURE.md section "WeChat TUI Integration" for details.

## ✨ Strengths of Pi-TUI

✅ Simple, elegant design
✅ Efficient differential rendering
✅ Full keyboard protocol support (including Kitty)
✅ IME support for CJK input
✅ Rich built-in components
✅ Flexible overlay system
✅ Image rendering (Kitty, iTerm2)
✅ Markdown support
✅ Autocomplete and history
✅ Emacs-style keyboard shortcuts
✅ Theme customization

## ⚠️ Important Notes

1. **Width compliance**: Every line from `render()` must be ≤ width parameter
2. **ANSI codes**: Don't count toward width (use `visibleWidth()`)
3. **Style resets**: Applied at end of each line (reapply per line)
4. **Focus state**: Changes dynamically (don't assume persistence)
5. **Invalidation**: Call when data changes to clear render cache

## 📖 Reading Order

**For beginners:**
1. PI-TUI-SUMMARY.txt (full overview)
2. PI-TUI-QUICK-REFERENCE.md (cheat sheet)
3. PI-TUI-GUIDE.md sections "Basic Setup" and "Text Component"

**For building UIs:**
1. PI-TUI-ARCHITECTURE.md "Component Patterns"
2. PI-TUI-GUIDE.md specific component sections
3. PI-TUI-QUICK-REFERENCE.md for API lookup

**For advanced usage:**
1. PI-TUI-ARCHITECTURE.md "Advanced" sections
2. PI-TUI-GUIDE.md "Custom Components"
3. Source code: node_modules/@earendil-works/pi-tui/dist/

## 🔗 External Resources

- **GitHub**: https://github.com/earendil-works/pi-mono
- **NPM**: https://www.npmjs.com/package/@earendil-works/pi-tui
- **Package.json**: node_modules/@earendil-works/pi-tui/package.json
- **README**: node_modules/@earendil-works/pi-tui/README.md
- **Type Definitions**: node_modules/@earendil-works/pi-tui/dist/*.d.ts

## 📝 Documentation Notes

These guides were created by analyzing:
- Type definitions (dist/*.d.ts)
- Package metadata (package.json)
- README documentation
- Actual usage in WeChat TUI codebase
- Terminal rendering capabilities

All information is accurate as of pi-tui v0.75.5.

## ❓ FAQ

**Q: What's the minimum I need to render something?**
A: Component interface with render() method. See PI-TUI-QUICK-REFERENCE.md "Custom Component Template".

**Q: How do I make text input work?**
A: Use Input or Editor component with Focusable interface. See PI-TUI-GUIDE.md "Input Component".

**Q: How do I handle keyboard?**
A: Use matchesKey() helper with Key identifiers. See PI-TUI-GUIDE.md "Key Matching".

**Q: How do I add styling?**
A: Use chalk library or ANSI codes in theme functions. See PI-TUI-GUIDE.md "Styling & ANSI Codes".

**Q: How do I create overlays?**
A: Use tui.showOverlay() with OverlayOptions. See PI-TUI-GUIDE.md "Overlays".

**Q: How do I render images?**
A: Use Image component or renderImage() utility. See PI-TUI-GUIDE.md "Image Component".

**Q: How do I make autocomplete work?**
A: Use CombinedAutocompleteProvider with Editor. See PI-TUI-GUIDE.md "Autocomplete".

---

**Total Documentation**: 2,453 lines | **4 files** | **~65 KB**

Happy coding with pi-tui! 🎉
