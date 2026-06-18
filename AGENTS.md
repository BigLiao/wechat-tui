# AGENTS.md

## 项目概述

`wechat-tui` 是一个基于 Node.js 的微信终端客户端，用于在 TUI 中登录、查看会话、搜索联系人、收发文本和文件消息。

- **语言**: TypeScript (ES Modules)
- **构建输出**: `dist/` 目录
- **包名**: `wechat-tui`
- **CLI 命令**: `wechat-tui`
- **运行要求**: Node.js `>=22.19.0`，最低版本跟随 `@earendil-works/pi-tui` 的运行要求

## 常用命令

```bash
npm run dev -- --mock   # 开发模式，使用 mock 协议启动
npm run build           # 编译 TypeScript -> dist/
npm run package:binary  # 打包当前平台单文件二进制到 artifacts/
npm run start           # 运行 dist/index.js
npm run typecheck       # TypeScript 类型检查
npm test                # 运行测试
```

提交行为变更前，通常需要执行：

```bash
npm run typecheck
npm test
npm run build
```

## 项目结构

```text
.
├── src/
│   ├── index.ts                  # CLI 入口，解析配置并启动应用
│   ├── runtime.ts                # 应用协调层
│   ├── types.ts                  # 共享类型契约
│   ├── protocol/
│   │   ├── wechat4u-adapter.ts   # Web WeChat 协议适配器
│   │   └── mock-protocol.ts      # mock/dev 协议实现
│   ├── store/
│   │   └── sqlite-store.ts       # SQLite 持久化层
│   ├── ui/
│   │   └── workbench-renderer.ts # 终端输入输出桥接
│   ├── tui/                      # TUI 页面和组件渲染
│   └── util/                     # 通用工具函数
├── scripts/
│   └── package-binary.mjs        # 单文件二进制打包脚本
├── test/                         # 单元测试和渲染测试
├── pkg.config.mjs                # @yao-pkg/pkg 打包资源配置
└── .github/
    └── workflows/
        ├── ci.yml                # PR 类型检查、测试、构建和 Linux 二进制烟测
        └── publish.yml           # npm 发布、二进制矩阵打包和 GitHub Release
```

## 数据和日志

- 默认数据目录: `~/.wechat-tui`
- 默认数据库: `~/.wechat-tui/wechat-tui.sqlite`
- 媒体缓存: `~/.wechat-tui/cache/<conversationId>/`
- 调试日志: `~/.wechat-tui/logs/`
- 启用日志: 启动时传入 `--debug`，或设置 `WECHAT_TUI_DEBUG=1`

## 开发约定

- 协议层和业务层保持分离：协议适配、原始数据解析和归一化放在 `src/protocol/*`，不要把协议细节泄漏到 UI 层。
- UI 层和状态/持久化保持分离：终端渲染、组件布局和交互展示放在 `src/tui/*`、`src/ui/*`，不要让 store 依赖 UI。
- 二进制打包依赖 `sqlite3` 原生模块，必须在目标平台和架构一致的环境中运行 `npm run package:binary`，不要跨平台复用本机 `node_modules`。
- 新增或修改行为时补充对应测试；影响共享流程时优先增加集成层或渲染层测试。
- 修改 CLI 参数、用户可见文案、项目结构、数据路径或发布流程后，检查 `README.md` 和 `AGENTS.md` 是否需要同步更新。

### Git 规范

- 一个提交只包含一个清晰主题，避免把无关重构、格式化和功能修复混在一起。
- 提交前先查看 `git status --short` 和 `git diff`，确认没有误提交调试代码、临时文件或无关改动。
- 不要回滚或覆盖他人的未提交改动；如果工作区已有无关变更，只提交本次任务相关文件。
- 提交信息使用 Conventional Commits 格式，例如 `feat: add version check`、`fix: render recalled messages`、`docs: update agents guide`。

### 代码规范

- 优先沿用项目已有模式，避免为小改动引入新的抽象、依赖或跨层调用。
- 代码职责要放在正确层级，重点保持协议分离和 UI 分离。
- 新增逻辑应有明确测试覆盖；窄改动写聚焦测试，影响共享行为时补充更高层测试。
- 日志要能定位问题，但不能泄漏敏感数据；新增日志前确认是否需要脱敏或摘要。
- 代码完成后主动检查并移除“补丁味”：临时分支、重复判断、一次性命名、硬编码调试值、无用注释、过度兼容和与现有风格不一致的实现。

### 提交前检查

```bash
npm run typecheck
npm test
npm run build
```

- 检查 `git diff`，确认变更范围、命名、注释和测试都符合项目结构。
- 如果修改了目录结构、模块职责、重要入口、数据路径、发布流程或开发命令，需要同步更新 `AGENTS.md`。
- 如果修改了用户使用方式、CLI 参数、安装方式或功能说明，需要同步检查 `README.md`。

## 发布流程

### 前置准备（仅需一次）

1. 在 [npmjs.com](https://www.npmjs.com/) 生成 Access Token，类型选择 **Automation**
2. 在 GitHub 仓库 **Settings -> Secrets and variables -> Actions** 中添加 secret：
   - Name: `NPM_TOKEN`
   - Value: 上一步生成的 token

### 发布新版本

发布前必须自动更新 `CHANGELOG.md`。Agent 需要检查即将发布版本和上一个版本 tag 之间的提交差异，并结合代码变更整理变更记录。

```bash
# 1. 确认上一个版本 tag
PREV_TAG=$(git describe --tags --abbrev=0)

# 2. 只更新 package.json 版本号，暂不创建 commit/tag
npm version patch --no-git-tag-version   # 修复版本 0.2.5 -> 0.2.6
npm version minor --no-git-tag-version   # 功能版本 0.2.5 -> 0.3.0
npm version major --no-git-tag-version   # 大版本   0.2.5 -> 1.0.0

# 3. 生成本次版本信息
VERSION=$(node -p "require('./package.json').version")
NEW_TAG="v${VERSION}"

# 4. 检查上个版本到当前待发布版本的提交和代码差异
git log --oneline "${PREV_TAG}..HEAD"
git diff --stat "${PREV_TAG}..HEAD"
git diff "${PREV_TAG}..HEAD"

# 5. 根据 git 信息和代码变更更新 CHANGELOG.md
#    将 Unreleased 内容整理到 ## [${VERSION}] - YYYY-MM-DD

# 6. 验证
npm run typecheck
npm test
npm run build
npm run package:binary

# 7. 创建发布提交和 tag
git add package.json CHANGELOG.md
git commit -m "chore: release ${NEW_TAG}"
git tag "${NEW_TAG}"

# 8. 推送代码和 tag
git push && git push --tags
```

推送 `v*` tag 后，GitHub Actions 会自动构建和发布到 npm 仓库。
发布 workflow 还会在 Linux x64/arm64、macOS x64/arm64 和 Windows x64 runner 上分别生成单文件二进制，并把归档文件上传到 GitHub Release。

### CHANGELOG.md 格式

```markdown
# CHANGELOG.md

## [Unreleased]

## [x.y.z] - YYYY-MM-DD

### Added

- 新增能力。

### Changed

- 行为或体验变化。

### Fixed

- 修复问题。

### Docs

- 文档变化。

### Internal

- 内部重构、测试、构建或发布流程变化。
```

- `Unreleased` 必须位于文件顶部。
- 发布时只保留非空分类。
- 版本标题使用 `## [x.y.z] - YYYY-MM-DD`。
- 内容必须来自 `git log <上个tag>..HEAD`、`git diff <上个tag>..HEAD` 和实际代码变更，不要只复制提交标题。

### CI 说明

- `publish.yml` 在推送 `v*` tag 时自动发布，也支持 `workflow_dispatch` 手动触发
