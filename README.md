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
- 媒体缓存：`~/.wechat-tui/cache/<会话ID>/`
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

本地冒烟测试可以使用 mock 协议，不需要微信登录：

```bash
wechat-tui --mock
```

## 快捷键

最近会话列表：

```text
↑/↓         选择会话
Enter       打开选中的会话
/           打开命令面板
q           退出
Ctrl+C      退出
```

聊天页面：

```text
输入文字    编辑消息
Enter       发送消息
↑/↓         滚动消息列表（输入 / 命令时为选择补全项）
Esc         返回最近会话列表
```

联系人搜索：

```text
输入文字    搜索联系人和群聊
↑/↓         选择结果
Enter       打开选中的联系人或群聊
Esc         返回上一页
```

## 命令

### 全局命令面板（首页按 `/`）

| 命令 | 说明 |
|------|------|
| `/contacts` | 搜索联系人和群聊 |
| `/clear` | 清理本地消息和日志（保留登录态） |
| `/logout` | 登出并退出 |
| `/quit` | 退出 |

### 聊天输入框命令

| 命令 | 说明 |
|------|------|
| `/send <路径>` | 发送文件（图片、视频、文档） |
| `/view <hash>` | 打开媒体文件（支持 `/view a1c1` 或 `/view #a1c1`） |

## 媒体文件

收到的图片、表情包、视频、语音、文件会自动下载并缓存到本地，按会话分目录保存：

```text
~/.wechat-tui/cache/
  <会话ID>/
    photo.jpg
    sticker_12345.gif
    document.pdf
```

下载成功后，消息会显示一个 4 位 hash 标识：

```text
[image #a1c1]
[sticker #f3b2]
[file #7c89] report.pdf
```

使用 `/view <hash>` 可以打开文件：
- 图片、视频、音频 → 调用系统默认应用打开
- 其他文件 → 在 Finder / 资源管理器中定位

未下载成功的媒体消息不会显示 hash。

## 消息行为

收到的新消息会先写入本地数据库，再刷新当前界面。当前聊天里的新消息会直接显示在聊天页面；其他会话的新消息会更新未读状态和底部状态栏。

公众号会话会在最近会话列表中折叠为一项「公众号」。公众号消息保存到本地数据库但不会触发未读提醒，也不会自动下载媒体。

## 本地开发

```bash
npm install
npm run build
npm run dev    # 使用 tsx 直接运行
npm test       # 运行测试
```

## 注意事项

本项目使用 `wechat4u` 和 Web 微信协议。Web 微信访问不是官方开放能力，部分账号可能无法登录或在运行中断开连接。
