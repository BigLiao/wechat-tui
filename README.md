# wechat-tui

A lightweight pi-tui WeChat TUI workspace based on the Web WeChat protocol.

## Install

Requires Node.js `>=22.19.0`.

```bash
npm install
npm run build
npm link
```

## Run

```bash
wechat-tui
```

Startup shows a QR login view. After login, the default screen is the recent conversation list rendered by `pi-tui`.

By default, local data is stored in `~/.wechat-tui/wechat-tui.sqlite`. You can override it:

```bash
wechat-tui --data-dir ./.wechat-tui
wechat-tui --db /tmp/wechat-tui.sqlite
```

Enable detailed local debugging logs:

```bash
wechat-tui --debug
```

Debug logs are written to `~/.wechat-tui/logs/wechat-tui-<timestamp>-<pid>.log`. They include protocol state changes, message normalization summaries, command routing, store reads/writes, and error details. Login session data and protocol cookie fields are redacted.

For local smoke testing without WeChat login:

```bash
wechat-tui --mock
```

## Keyboard Controls

Conversation list:

```text
text       filter local recent conversations
Backspace  delete filter text
Up/Down    select conversation
Enter      open selected conversation
/contacts  open contact search
Esc/q      quit when the filter is empty
```

Chat view:

```text
Chat >     compose message in the pi-tui Editor
Enter      send message
Esc        return to conversation list
Up/Down    navigate input history
/contacts  open contact search
```

Contact search:

```text
Search >   update search keyword
Backspace  delete search text
Up/Down    select result
Enter      open selected contact or group
Esc        return to previous view
```

Slash commands available from the chat editor and conversation command line:

```text
/contacts  search contacts and groups
/chats     return to recent chats
/status    show connection status
/refresh   refresh local contacts
/load      load local history
/messages  search local messages
/quit      quit
```

Messages never print directly to the terminal. Protocol events are saved to the local store first, runtime state is rebuilt, and `pi-tui` repaints the active view. New messages in the active chat appear in that chat; new messages from other chats only update unread state and the bottom status bar. Non-text messages render as placeholders such as `[image]`, `[voice]`, `[video]`, `[file] filename`, `[mini-program]`, `[sticker]`, or `[unsupported message]`.

## Notes

This project uses `wechat4u` and the Web WeChat protocol. Web WeChat access is unofficial, may fail for some accounts, and should be treated as a personal tool or technical prototype rather than a commercial stability guarantee.
