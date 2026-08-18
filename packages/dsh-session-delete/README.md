# dsh-session-delete — 删除会话插件

给 DeepSeek Harness Web 的会话列表（⋮ 菜单：重命名 / 分叉会话 / 归档会话）增加一个「删除会话」项，彻底删除会话：JSONL 会话日志、工作区登记、归档集合全部清理。**不修改 Harness 核心**，卸载插件即完全还原。

## 行为与安全边界

- **只删除冷会话**：运行中的会话（仍在 agent store 中登记）会被**拒绝**并提示先停止/关闭，避免核心持久化写路径把已删除的日志重新写回或与删除操作竞态。
- **严格 ID 校验**：会话 ID 必须是 `session-<uuid>` 格式，否则拒绝。
- **精确删除范围**：磁盘目录按 `dsh-session-persistence-jsonl` 相同的路径编码（`projectKey` / `encodeSegment`，逐字符一致）定位；删除前先 `realpath` 解析存储根并校验目标在根内（防符号链接逃逸）；存储根缺失时**拒绝删除**（绝不静默假成功）。
- **重名保护**：客户端按标题解析会话 ID，标题重复时**拒绝猜测**并提示重试；删除前弹窗确认并展示会话 ID。
- 删除成功后页面自动刷新。

## 原理

- Host 半部：`POST /plugins/session-delete/api`，`{ method: 'delete', sessionId }`。先确认会话存在（持久化列表 / 内存），拒绝运行中会话，再删除 JSONL 目录（空项目目录一并清理），最后更新工作区登记与归档集合。
- 客户端半部：监听 ⋮ 按钮点击与原生菜单（`div[role="menu"]`）出现，注入删除项；按会话标题（`displayTitle`，空白会话用「新会话」）解析 sessionId；确认弹窗走 `shell.overlay` 槽位。

## 安装 / 卸载

```bash
# 在 dsh-toolkit 仓库根目录执行
dsh plugin --profile web add file:./packages/dsh-session-delete
# 卸载
dsh plugin --profile web remove dsh-session-delete
```

安装后需重启 dsh 服务生效（宿主路由 + 客户端 bundle）。

## 安全

- 仅 POST + 同源校验（Host 回环 + Origin 精确匹配），拒绝跨站 / DNS rebinding / 任意本地端口页面
- 请求体 64 KiB 上限；错误信息不回显完整磁盘路径细节

## 变更记录

- 1.0.0 首发。
- 1.0.2：拒绝删除运行中会话，避免持久化竞态；重名会话不再按 DOM 顺序猜测。
