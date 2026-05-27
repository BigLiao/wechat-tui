# wechat-tui

一个在终端里使用的微信消息工具，基于 Web 微信协议实现。

## 安装

需要 Node.js `>=22.19.0`。

```bash
npm install -g wechat-tui
```

## 使用

```bash
wechat-tui
```

启动后会显示二维码登录界面。登录成功后进入最近会话列表。

本地数据默认存放在 `~/.wechat-tui`：

- 数据库：`~/.wechat-tui/wechat-tui.sqlite`
- 调试日志：`~/.wechat-tui/logs/`

联系人、会话、消息和未读计数会按当前登录账号隔离，避免同一台机器上的多个账号互相混用数据。

可以通过参数修改数据目录或数据库路径：

```bash
wechat-tui --data-dir ./.wechat-tui
wechat-tui --db /tmp/wechat-tui.sqlite
```

开启本地调试日志：

```bash
wechat-tui --debug
```

日志文件路径形如：

```text
~/.wechat-tui/logs/wechat-tui-<timestamp>-<pid>.log
```

日志会记录协议状态变化、消息解析摘要、界面路由、数据库读写和错误信息。登录会话和 cookie 等敏感字段会被脱敏。

本地冒烟测试可以使用 mock 协议，不需要微信登录：

```bash
wechat-tui --mock
```

## 本地开发

```bash
npm install
npm run build
npm link
```

## 快捷键

最近会话列表：

```text
输入文字    过滤最近会话
Backspace   删除过滤文本
↑/↓         选择会话
Enter       打开选中的会话
Esc/q       退出
```

聊天页面：

```text
输入文字    编辑消息
Enter       发送消息
↑/↓         滚动消息列表
Esc         返回最近会话列表
```

联系人搜索：

```text
输入文字    搜索联系人和群聊
Backspace   删除搜索文本
↑/↓         选择结果
Enter       打开选中的联系人或群聊
Esc         返回上一页
```

聊天输入框支持的命令：

```text
/contacts  搜索联系人和群聊
/chats     返回最近会话列表
/status    显示连接状态
/refresh   刷新联系人
/load      显示本地历史状态
/quit      退出
```

## 消息行为

收到的新消息会先写入本地数据库，再刷新当前界面。当前聊天里的新消息会直接显示在聊天页面；其他会话的新消息会更新未读状态和底部状态栏。

公众号会话会在最近会话列表中折叠为一项 `公众号`。公众号消息会保存到本地数据库，但不会进入未读列表，也不会触发未读提醒。

图片、语音、视频、文件、小程序、表情等非文本消息会显示为占位符，例如 `[image]`、`[voice]`、`[video]`、`[file] filename`、`[mini-program]`、`[sticker]` 或 `[unsupported]`。

## 注意事项

本项目使用 `wechat4u` 和 Web 微信协议。Web 微信访问不是官方开放能力，部分账号可能无法登录或在运行中断开连接。
