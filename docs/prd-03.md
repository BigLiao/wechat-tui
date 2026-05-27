微信 CLI pi-tui 改造实现方案

1. 改造目标

将当前微信 CLI 从“消息流式输出 + 手写终端控制”升级为基于 pi-tui 的轻量 TUI 客户端。

目标体验：

启动登录
  ↓
进入会话列表
  ↓
输入文字搜索本地会话
  ↓
方向键选择会话
  ↓
Enter 进入聊天
  ↓
Chat > 输入消息
  ↓
Esc 返回会话列表

核心原则：

消息不直接输出到终端
所有 UI 由 pi-tui 组件渲染
所有状态变化触发 repaint

⸻

2. 技术约束

运行环境：

Node >= 22.19

TUI 底座：

pi-tui

不再使用：

readline
console.log 消息输出
手写 ANSI 清屏
手写 raw mode 输入

业务模块不得直接写 stdout。

⸻

3. 总体架构

保持现有业务分层，替换 UI 层。

Wechat Protocol
  ↓
Adapter
  ↓
Store
  ↓
App State
  ↓
pi-tui Components

各层职责：

Protocol Layer
  负责微信协议登录、收消息、发消息
Adapter Layer
  统一联系人、会话、消息模型
Store Layer
  持久化联系人、会话、消息
State Layer
  维护当前视图、输入状态、未读状态
TUI Layer
  使用 pi-tui 渲染界面和处理键盘输入

⸻

4. 视图设计

保留 4 个核心视图：

Login View
Conversation View
Chat View
Contact Search View

Login View

负责：

展示二维码
展示扫码状态
登录成功后进入 Conversation View

⸻

Conversation View

默认首页。

职责：

展示最近本地会话
支持输入文字搜索本地会话
支持方向键选择会话
支持 Enter 进入会话
支持 /contacts 进入联系人搜索

排序规则：

最近时间倒序

展示数量：

根据终端高度自动计算
最少 5 个
最多 10 个

搜索范围：

只搜索本地已有会话

⸻

Chat View

职责：

展示当前会话消息
使用 Editor 作为聊天输入
输入普通文字发送消息
Esc 返回 Conversation View
方向键用于输入历史
当前会话新消息进入消息列表
其他会话新消息只更新状态

Input Line 使用：

Chat >

不显示：

老板 >
项目A群 >

⸻

Contact Search View

职责：

搜索联系人和群聊
方向键选择结果
Enter 打开会话
Esc 返回 previousView

入口：

/contacts

Input Line 使用：

Search >

⸻

5. 核心组件拆分

建议新增 TUI 组件层：

tui/
  WechatApp
  LoginScreen
  ConversationScreen
  ChatScreen
  ContactSearchScreen
  Header
  StatusBar
  ConversationPicker
  MessageList
  ChatEditor
  ContactPicker

WechatApp

根组件。

负责：

根据 currentView 渲染对应 Screen
接收 AppState
触发 repaint

⸻

ConversationPicker

自定义组件。

不直接套普通 Input + SelectList。

职责：

维护 query
根据 query 过滤本地会话
维护 selectedIndex
处理 ↑ / ↓ / Enter / Esc / /
渲染最近会话或搜索结果

核心交互：

普通字符 -> 修改 query
Backspace -> 删除 query
↑ / ↓ -> 修改 selectedIndex
Enter -> 打开选中会话
Esc -> query 非空时清空，query 为空时退出
/ -> 进入命令模式

⸻

ChatEditor

基于 pi-tui Editor。

职责：

聊天输入
slash command autocomplete
粘贴处理
中文输入
输入历史

命令提示使用 pi-tui 内置方式，不强制自定义。

⸻

MessageList

负责渲染当前会话消息。

只显示当前 activeConversation 的消息。

非文本消息第一版占位显示：

[image]
[voice]
[video]
[file] filename
[mini-program]
[sticker]
[unsupported message]

⸻

6. AppState 设计

核心状态：

currentView
previousView
connectionState
currentUser
conversationPicker:
  query
  selectedIndex
  items
chat:
  activeConversationId
  inputText
  inputHistory
contactSearch:
  query
  selectedIndex
  results
commandState:
  active
  query
  selectedCommand
unread:
  total
  byConversation

状态是 UI 的唯一数据源。

所有界面由 AppState 渲染，不允许组件自己从协议层直接取数据。

⸻

7. 消息处理流程

收到微信消息后：

1. Protocol 接收原始消息
2. Adapter 转成统一 Message
3. Store 保存消息
4. 更新 Conversation 状态
5. 更新 unread / lastMessage / lastMessageAt
6. 更新 AppState
7. 通知 pi-tui repaint

不同视图表现：

Conversation View:
  刷新会话列表
Chat View:
  当前会话消息 -> 展示到消息列表
  其他会话消息 -> 不展示正文，只更新状态
Contact Search View:
  不打断搜索，只更新未读状态

⸻

8. 命令设计

废弃：

/search

保留或新增：

/contacts   搜索联系人和群聊
/chats      返回会话列表
/status     查看连接状态
/refresh    刷新会话
/load       加载更多本地历史消息
/messages   搜索本地消息，后续功能
/quit       退出程序

命令提示优先使用 pi-tui Editor 内置 autocomplete。

⸻

9. 输入规则

Conversation View

普通字符     搜索本地会话
Backspace    删除搜索内容
↑ / ↓        选择会话
Enter        打开会话
Esc          query 非空清空；query 为空退出
/            命令模式

Chat View

普通字符     聊天输入
Enter        发送消息
Esc          返回会话列表
↑ / ↓        输入历史
/            命令模式

Contact Search View

普通字符     搜索联系人
Backspace    删除搜索内容
↑ / ↓        选择联系人
Enter        打开会话
Esc          返回上一页

⸻

10. 改造步骤

阶段一：接入 pi-tui 骨架

完成：

Node 版本升级
引入 pi-tui
建立 WechatApp 根组件
实现 currentView 切换
屏蔽原 console.log 输出

目标：

程序能进入受控 TUI 界面

⸻

阶段二：实现 Conversation View

完成：

最近会话展示
根据终端高度计算列表数量
方向键选择
Enter 打开会话
输入文字搜索本地会话
Esc 清空或退出

目标：

启动登录后默认进入可操作会话列表

⸻

阶段三：实现 Chat View

完成：

展示当前会话消息
接入 Editor
Chat > 输入发送消息
Esc 返回会话列表
方向键输入历史
非当前会话消息不污染当前窗口

目标：

完成核心聊天闭环

⸻

阶段四：实现命令与联系人搜索

完成：

Editor slash command autocomplete
/contacts 进入联系人搜索
联系人搜索结果选择
Enter 打开联系人会话

目标：

可以打开非最近会话中的联系人

⸻

阶段五：消息刷新与细节完善

完成：

新消息触发 repaint
未读状态更新
附件占位展示
连接状态展示
异常和登出处理

目标：

达到日常可用的轻量微信 TUI 工作台体验

⸻

11. 验收标准

完成后应满足：

1. 扫码登录后进入最近会话列表
2. 会话列表按最近时间倒序展示
3. 会话列表可直接输入搜索本地会话
4. ↑ / ↓ 可选择会话
5. Enter 可进入选中会话
6. Chat View 只显示当前会话消息
7. Chat > 可直接发送消息
8. Esc 可返回会话列表
9. 其他会话新消息不插入当前聊天窗口
10. /contacts 可搜索联系人并进入会话
11. 非文本消息有占位展示
12. UI 输出完全由 pi-tui 控制

⸻

12. 一句话总结

本次改造的重点不是增加功能，而是把微信 CLI 的 UI 从“日志流”升级为 基于 pi-tui 的状态驱动轻量 TUI：

会话列表是 Picker
聊天页是当前会话工作区
输入区由 Editor 承担
命令提示走 pi-tui 内置能力
所有消息先入状态，再由 UI 差分渲染
