# CHANGELOG.md

本文件记录 `wechat-tui` 的用户可见变更和重要内部变更。

格式约定：

- 顶部保留 `## [Unreleased]`，记录尚未发布的变更。
- 发布时将 `Unreleased` 内容移动到 `## [x.y.z] - YYYY-MM-DD`。
- 每个版本按需使用 `Added`、`Changed`、`Fixed`、`Docs`、`Internal` 分类。
- 每条变更使用简短中文描述，必要时补充对应提交或模块名。
- 空分类不保留。

## [Unreleased]

### Added

- 聊天页状态栏增加 `/ Commands` 提示。
- 新增中文 `AGENTS.md`，记录项目结构、开发规范和发布流程。

### Changed

- 首页命令和确认面板增加标题、间距和缩进，降低与会话列表的混淆。
- `AGENTS.md` 改为中文，并补充 Conventional Commits、提交前检查和 CHANGELOG 维护规范。

### Fixed

- 修复撤回消息渲染为原始 `wxid` 和消息 id 的问题。
- 修复群聊稀疏成员昵称回填问题。

## [0.2.5] - 2026-05-28

### Changed

- 优化文档和错误提示。

### Fixed

- 修复重复私聊会话折叠问题。
- 修复稀疏群成员昵称回填问题。
