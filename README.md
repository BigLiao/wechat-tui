# wechat-tui

[![npm version](https://img.shields.io/npm/v/wechat-tui.svg)](https://www.npmjs.com/package/wechat-tui)
[![npm downloads](https://img.shields.io/npm/dm/wechat-tui.svg)](https://www.npmjs.com/package/wechat-tui)

`wechat-tui` 是一个在终端里使用微信的 TUI 客户端，基于 Web 微信协议实现。

## 功能

- 扫码登录微信，查看最近会话
- 搜索联系人和群聊
- 收发文本消息
- 发送图片、视频和文档等文件
- 自动缓存收到的图片、表情包、视频、语音和文件
- 使用 `/view <hash>` 打开已缓存媒体文件
- 按账号隔离联系人、会话、消息和未读状态
- 公众号消息折叠展示，且不进入未读提醒
- 支持本地调试日志

## 快速开始

### npm 安装

npm 安装需要 Node.js `>=22.19.0`。该最低版本跟随 TUI 依赖 `@earendil-works/pi-tui` 的运行要求。

```bash
npm install -g wechat-tui
wechat-tui
```

### 二进制安装

也可以在 [GitHub Release](https://github.com/BigLiao/wechat-tui/releases) 下载对应平台的单文件二进制包。二进制内置 Node.js 运行时和运行依赖，不需要本机安装 Node.js。

```text
wechat-tui-v<version>-linux-x64.tar.gz
wechat-tui-v<version>-linux-arm64.tar.gz
wechat-tui-v<version>-macos-x64.tar.gz
wechat-tui-v<version>-macos-arm64.tar.gz
wechat-tui-v<version>-windows-x64.zip
```

Linux / macOS：

```bash
tar -xzf wechat-tui-v<version>-linux-x64.tar.gz
chmod +x wechat-tui-v<version>-linux-x64
./wechat-tui-v<version>-linux-x64
```

macOS arm64 请把文件名替换为 `wechat-tui-v<version>-macos-arm64`。如果系统提示下载的程序无法打开，可以先移除下载隔离标记：

```bash
xattr -dr com.apple.quarantine ./wechat-tui-v<version>-macos-arm64
```

Windows：

```powershell
Expand-Archive .\wechat-tui-v<version>-windows-x64.zip
.\wechat-tui-v<version>-windows-x64\wechat-tui-v<version>-windows-x64.exe
```

启动后会显示二维码登录界面。扫码并确认登录后，会进入最近会话列表。

## 常用操作

### 最近会话列表

```text
↑/↓         选择会话
Enter       打开选中的会话
/           打开命令面板
q           退出
Ctrl+C      退出
```

### 聊天页面

```text
输入文字    编辑消息
Enter       发送消息
↑/↓         滚动消息列表（输入 / 命令时为选择补全项）
Esc         返回最近会话列表
```

### 联系人搜索

```text
输入文字    搜索联系人和群聊
↑/↓         选择结果
Enter       打开选中的联系人或群聊
Esc         返回上一页
```

## 命令

### 首页命令面板

在最近会话列表按 `/` 打开命令面板。

| 命令 | 说明 |
|------|------|
| `/contacts` | 搜索联系人和群聊 |
| `/readall` | 全部已读，清空所有会话未读状态 |
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

- 图片、视频、音频会调用系统默认应用打开
- 其他文件会在 Finder / 资源管理器中定位

未下载成功的媒体消息不会显示 hash。

## 数据和日志

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

## 消息行为

收到的新消息会先写入本地数据库，再刷新当前界面。当前聊天里的新消息会直接显示在聊天页面；其他会话的新消息会更新未读状态和底部状态栏。

公众号会话会在最近会话列表中折叠为一项「公众号」。公众号消息保存到本地数据库，但不会触发未读提醒，也不会自动下载媒体。

## 注意事项

本项目使用 [wechat4u](https://github.com/nodeWechat/wechat4u) 和 Web 微信协议。Web 微信访问不是官方开放能力，部分账号可能无法登录或在运行中断开连接。

## 开发说明

安装依赖：

```bash
npm install
```

常用开发命令：

```bash
npm run dev -- --mock   # 使用 mock 协议启动，不需要微信登录
npm run typecheck       # 类型检查
npm test                # 运行测试
npm run build           # 编译到 dist/
npm run package:binary  # 打包当前平台单文件二进制到 artifacts/
```

由于 SQLite 驱动包含原生模块，二进制需要在目标平台和架构一致的环境中打包；发布 CI 会在对应 runner 上分别生成各平台产物。

## License

MIT
