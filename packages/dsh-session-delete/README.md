# dsh-session-delete

给 DeepSeek Harness Web 的会话列表（⋮ 菜单：重命名 / 分叉会话 / 归档会话）增加一个「删除会话」项，彻底删除会话：JSONL 会话日志、工作区登记、归档集合全部清理。**不修改 Harness 核心**，卸载插件即完全还原。

## 行为与安全边界

- 删除是**无条件**的：运行中的会话、子代理（子会话）、仍有子会话在跑的父会话都可以删除。唯一拒绝的情况是会话不存在（幂等）。
- 删除前先 flush 未落盘数据并让持久化写入路径退役，再移除内存中的会话/代理登记并发出 `session/disposed`，最后删除磁盘文件与工作区登记 —— 顺序保证不会把会话日志写成损坏状态。
- 删除运行中的会话后，其 agent 循环仍会在内存中继续直至自然结束，但写入路径已退役，不会重建已被删除的日志。
- 删除成功后页面自动刷新。

## 原理

- Host 半部：`POST /plugins/session-delete/api`，`{ method: 'delete', sessionId }`。会话目录按 `dsh-session-persistence-jsonl` 相同的路径编码（`projectKey` / `encodeSegment`）定位，根目录取自持久化后端 `backend.root`（默认 `~/.dsh/sessions`）。
- 客户端半部：监听 ⋮ 按钮点击与原生菜单（`div[role="menu"]`）出现，注入删除项；按会话标题（`displayTitle`，空白会话用「新会话」）解析 sessionId，重名时按 DOM 行位置消歧；确认弹窗走 `shell.overlay` 槽位。

## 安装 / 卸载

```bash
# 在 dsh-toolkit 仓库根目录执行
dsh plugin --profile web add file:./packages/dsh-session-delete
# 卸载
dsh plugin --profile web remove dsh-session-delete
```

安装后需重启 dsh 服务生效（宿主路由 + 客户端 bundle）。

## 变更记录

- 1.0.0 首发。
