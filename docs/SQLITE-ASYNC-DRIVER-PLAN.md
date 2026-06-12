# SQLite 异步驱动改造方案

日期：2026-06-11

## 背景

当前 `wechat-tui` 使用 Node 内置 `node:sqlite` 的 `DatabaseSync` / `StatementSync`。这些 API 在执行 SQL 时会占用 Node 主线程，因此 UI 输入、协议事件处理和 TUI 重绘都会等待同步 SQLite 操作结束。

简单把现有方法包成 `async` 不能解决问题，因为阻塞发生在 Promise 创建之前。要真正降低 UI 卡顿，需要让数据库工作离开主线程，或换成真正异步的 SQLite 驱动。

本方案评估并尝试 `sqlite + sqlite3`：

- `sqlite3`: 异步 SQLite native binding，查询通过回调/Pooled worker 执行。
- `sqlite`: `sqlite3` 的 Promise 封装，便于在 TypeScript 中使用 `async/await`。

## 目标

- 将运行期 SQLite 查询和写入从主线程同步阻塞路径移出。
- 保持现有数据库文件、表结构、迁移和用户数据兼容。
- 保持协议层、运行时和 UI 分层不被数据库驱动细节污染。
- 在实验分支上完成可对比的原型，确认操作期间 UI 卡顿是否明显改善。

## 非目标

- 不在第一阶段调整数据模型或重写全部 SQL。
- 不引入远程数据库或云同步。
- 不把所有性能问题都归因于 SQLite；协议归一化、日志摘要、TUI render 仍需单独观测。
- 不直接在 `main` 上替换稳定实现。

## 兼容性评估

### Node 版本

项目要求 Node `>=22.19.0`。

当前 npm 元数据：

- `sqlite3@6.0.1`: `engines.node >=20.17.0`
- `sqlite@5.1.1`: Promise wrapper，无额外运行时 engine 限制

Node 版本兼容。

### 安装风险

`sqlite3` 是 native addon。它会优先使用 `prebuild-install` 下载预编译产物，失败时回退到 `node-gyp rebuild`。

风险：

- 部分平台或 Node ABI 没有可用 prebuild 时，用户需要本地编译工具链。
- npm 安装时间会变长。
- 发布包从“只依赖 Node 内置 sqlite”变成“依赖 native addon”，安装失败率会提高。

缓解：

- 保持实验分支验证，不立即发布。
- 在 README/发布说明中标注 native addon 安装要求。
- 如果安装兼容性不可接受，回退到 Worker Thread + `node:sqlite` 方案。

### 数据库文件兼容性

`sqlite3` 使用标准 SQLite 数据库文件。现有 `~/.wechat-tui/wechat-tui.sqlite`、WAL、表结构和索引可以继续使用。

需要重点验证：

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- 现有 `CREATE TABLE / CREATE INDEX / ALTER TABLE`
- 旧数据迁移逻辑
- 多账号数据隔离

### API 差异

当前 `node:sqlite` 用法：

```ts
const row = db.prepare(sql).get(...params);
const rows = db.prepare(sql).all(...params);
const result = db.prepare(sql).run(...params);
db.exec("BEGIN");
```

`sqlite + sqlite3` 目标用法：

```ts
const row = await db.get<Row>(sql, ...params);
const rows = await db.all<Row[]>(sql, ...params);
const result = await db.run(sql, ...params);
await db.exec("BEGIN");
```

注意点：

- `prepare()` 是异步的，若继续大量 prepare 会增加改造复杂度；优先用 `db.get/all/run`。
- `RunResult.changes` 是可选 number，需要统一做 `Number(result.changes ?? 0)`。
- async 事务必须保证串行执行，不能让两个写事务交错。

## 当前改造面

`MessageStore` 当前是同步接口，约 27 个公开方法：

- session/account: `getSessionData`, `setSessionData`, `setActiveAccount`
- contacts: `upsertContact`, `upsertContacts`, `searchContacts`
- conversations: `upsertConversation`, `listRecentConversations`, `listUnreadConversations`
- messages: `hasMessage`, `saveMessage`, `listMessages`, `searchMessages`
- unread/cleanup: `markRead`, `totalUnreadCount`, `clearData`

`src/store/sqlite-store.ts` 约 2000 行，数据库调用约 100+ 处。

运行时调用面集中在 `src/runtime.ts`：

- 启动读取 session
- contacts 事件批量写入
- message 事件写入消息、联系人、会话
- render 前读取会话、消息、搜索结果、未读数
- 发送消息/文件后写入本地消息

测试影响：

- `test/store.test.ts` 需要整体 async 化。
- `test/runtime.test.ts` 需要给 store 断言加 `await`。
- 部分 helper 需要支持 async cleanup。

## 推荐架构

### 1. Store 接口异步化

将 `MessageStore` 改成 Promise 接口：

```ts
export interface MessageStore {
  close(): Promise<void>;
  getSessionData(): Promise<unknown | undefined>;
  setSessionData(data: unknown): Promise<void>;
  upsertContact(contact: ContactInput): Promise<ContactRecord>;
  saveMessage(...): Promise<MessageRecord>;
  listMessages(...): Promise<MessageRecord[]>;
}
```

优点：

- 类型层强制调用方正确 `await`。
- 避免同步 store 和异步 store 双轨长期存在。

代价：

- `runtime.ts` 大量调用点需要调整。
- render 流程需要从同步变成异步调度。

### 2. 增加数据库操作串行队列

异步驱动不会阻塞 UI，但并发写入会带来顺序和事务问题。需要在 store 内部增加轻量队列：

```ts
private writeContext = new AsyncLocalStorage<boolean>();
private writeQueue = Promise.resolve();

private enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  if (this.writeContext.getStore()) {
    return operation();
  }
  const run = () => this.writeContext.run(true, operation);
  const next = this.writeQueue.then(run, run);
  this.writeQueue = next.then(() => undefined, () => undefined);
  return next;
}
```

用于：

- `setActiveAccount`
- `setSessionData` / `clearSessionData`
- `clearData`
- `upsertContacts`
- `upsertContact`
- `upsertGroupMember`
- `markAllContactsStale`
- `saveMessage`
- `upsertConversation`
- `mergeStaleConversationForContact`
- `updateMessageRaw`
- `markRead`

读操作可以先不排队，但涉及刚写完再读的复合流程应保持在同一个 write operation 内部。`AsyncLocalStorage` 用来标记当前调用已经处于写队列中，避免 `saveMessage -> upsertConversation`、`upsertContacts -> upsertContact` 这类内部复合调用再次入队造成死锁。

### 3. Runtime 渲染异步化并合并

当前 `render()` 同步构造完整状态。改造后建议变成：

```ts
private requestRender(): void {
  if (this.renderScheduled) return;
  this.renderScheduled = true;
  setImmediate(() => void this.flushRender());
}

private async flushRender(): Promise<void> {
  this.renderScheduled = false;
  const sequence = ++this.renderSequence;
  const state = await this.buildRenderState();
  if (sequence === this.renderSequence) {
    this.renderer.render(state);
  }
}
```

要求：

- 避免多个 render 并发完成后乱序覆盖。
- 启动页这种不依赖 DB 的状态可继续立即渲染。
- `chat-change` 不能每个字符都等待数据库查询；优先只更新输入状态并合并 render。

### 4. 协议事件串行化

消息和联系人事件应按顺序处理：

```ts
private protocolWork = Promise.resolve();

private enqueueProtocolWork(task: () => Promise<void>): void {
  this.protocolWork = this.protocolWork.then(task, task).catch(...);
}
```

用于：

- `contacts`
- `message`
- `login` 后的 session 持久化

这样可以避免：

- 后到的消息先写入导致会话预览倒退。
- 联系人 snapshot 与消息写入交错。
- stale merge 与新会话写入交错。

## 落地步骤

### Phase 0: 文档和依赖验证

- 新建实验分支。
- 添加 `sqlite`、`sqlite3` 依赖。
- 记录安装日志和 native addon 兼容性。
- 不改发布版本。

验收：

- `npm install` 可在本机成功。
- `npm audit` 无高危漏洞。
- 文档记录风险和回退方案。

### Phase 1: 新增异步 SQLite Store 骨架

- 新建或重命名为 `SqliteStore` 的 async 实现。
- 使用：

```ts
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";

const db = await open({
  filename: dbPath,
  driver: sqlite3.Database
});
```

- 构造函数不能 `await`，因此推荐：

```ts
const store = await SqliteStore.open(config.dbPath, { logger });
```

- 迁移逻辑改为 async。

验收：

- store 能创建数据库并通过最小 smoke 测试。
- 旧数据库可打开。

### Phase 2: Store 方法一对一异步迁移

- 将 `db.prepare(...).get/all/run` 改为 `db.get/all/run`。
- 将事务改为：

```ts
await db.exec("BEGIN");
try {
  ...
  await db.exec("COMMIT");
} catch (error) {
  await db.exec("ROLLBACK");
  throw error;
}
```

- 写事务包进 `enqueueWrite`。
- 保持现有 SQL 和行为不变。

验收：

- `test/store.test.ts` 全部 async 化并通过。
- 数据隔离、stale merge、群成员回填行为不变。

### Phase 3: Runtime 接入异步 Store

- `runtime.start()` await `getSessionData()`。
- 协议事件回调改为 enqueue async work。
- `handleKey` / `handleUiEvent` 补齐 await。
- `render()` 改成 async render scheduler。
- `buildRenderState()` await store 查询。

验收：

- `test/runtime.test.ts` 全部通过。
- mock 模式下能正常登录、收消息、搜索、切换会话、发送消息。

### Phase 4: 性能和手感验证

新增 debug 耗时日志：

- store query/write 超过 50ms 记录 SQL 类别和阶段。
- render snapshot 超过 50ms 记录 view、counts。
- protocol work queue backlog 超过阈值记录长度。

压测场景：

- 一次性注入 100 条消息。
- 大联系人 snapshot。
- 搜索联系人连续输入。
- 媒体消息下载完成。

验收：

- 输入期间不因 SQLite 查询出现明显整屏停顿。
- 消息洪峰时 UI 仍可响应退出/切换。
- 数据顺序和未读数正确。

## 当前分支落地状态

本实验分支已完成一版可运行原型：

- `package.json` 新增 `sqlite` 和 `sqlite3` 依赖。
- `SqliteStore` 改为 `await SqliteStore.open(...)` 异步创建，内部使用 `sqlite + sqlite3`。
- `MessageStore` 接口改成 Promise API。
- `runtime.start()`、协议事件处理、按键处理、发送消息/文件和 render snapshot 已接入异步 store。
- 协议 `login` / `contacts` / `message` 事件改为串行队列，避免异步写入乱序。
- render 改为异步构建并合并请求，消息 burst 使用短 debounce 降低重复重绘。
- 同步文件检查和媒体缓存文件操作已改为 async。
- store 内部已实现通用 `writeQueue`，所有公开写入方法按业务操作串行执行。
- 写队列使用 `AsyncLocalStorage` 识别内部嵌套写调用，保证复合事务边界不被其它外部写入插入，同时避免嵌套入队死锁。
- `test/store.test.ts` 和 `test/runtime.test.ts` 已完成 async 迁移，并增加并发事务写入覆盖。

## 风险和缓解

### Native addon 安装失败

风险：用户环境缺少 prebuild 或编译工具链。

缓解：

- 实验阶段不发布。
- 发布前在 macOS/Linux/Windows 和 Node 22/24 做安装验证。
- 必要时保留 `node:sqlite` store 作为 fallback 分支。

### 事务交错

风险：async 调用并发后，`BEGIN` / `COMMIT` 被其它写操作插入。

缓解：

- 所有写操作走 store 内部 queue。
- 复合写读流程放在同一个 queued operation 内。

### Render 乱序

风险：较早的 async render 比较晚完成，覆盖最新状态。

缓解：

- render sequence token。
- 合并 render 请求。
- 输入变化和 DB snapshot 分开处理。

### 代码改造范围大

风险：一次性改同步接口会造成大量测试失败。

缓解：

- 先 store tests，再 runtime tests。
- 每个 phase 都保持测试可运行。
- 不同时做无关重构。

### 性能收益不等于查询更快

异步驱动的核心收益是“不阻塞 UI 主线程”，不是让 SQL 本身更快。慢查询仍然慢，只是 UI 可以继续处理输入和重绘。

## 回退方案

如果 `sqlite + sqlite3` 的 native 安装风险或改造复杂度不可接受：

1. 回退依赖。
2. 保留现有 `node:sqlite` 同步 store。
3. 改用 Worker Thread 承载 `DatabaseSync`。

Worker 方案安装兼容性最好，但需要设计 RPC 和快照 API；异步驱动方案代码直观，但安装风险更高。

## 建议结论

可以在实验分支继续尝试 `sqlite + sqlite3`，但应按阶段推进。第一目标不是一次性优化所有 SQL，而是验证：

- 安装兼容性是否可接受。
- 异步 store 接入后 UI 卡顿是否明显下降。
- render 和协议事件串行化能否保持行为正确。

如果 Phase 1-3 后测试稳定且本地手感改善明显，再考虑进入正式 PR；否则应转向 Worker Thread 方案。
