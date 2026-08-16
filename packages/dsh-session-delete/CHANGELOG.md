# Changelog

## [1.0.0] - 2026-08-16

首发。

- 会话列表 ⋮ 菜单新增「删除会话」：彻底删除会话（JSONL 会话日志 + 工作区登记 + 归档集合）。
- 删除顺序保证数据安全：先 flush 未落盘数据、退役写入路径，再移除内存登记并发出 `session/disposed`，最后删除磁盘文件。
- 运行中的会话也可删除；会话不存在时幂等跳过；删除成功后页面自动刷新。
- 宿主路由 `POST /plugins/session-delete/api`；会话目录按持久化后端同款路径编码定位（`projectKey` / `encodeSegment`）。
