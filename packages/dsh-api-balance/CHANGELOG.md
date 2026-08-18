# Changelog

## [1.5.3] - 2026-08-18

- 修复：官方模型费用重复计费（`reasoning_tokens` 已含在 `completion_tokens` 内，不再重复计价）。
- 新增：余额徽章按供应商显示（官方显示高峰/闲时，与官网峰谷窗口 9:00–12:00、14:00–18:00 北京时间对齐）；悬停显示该供应商**今日消耗**（K/M tok）；新增供应商/模型计费管理（双击徽章），支持第三方费率与本地记账。
- 新增：切换会话 / 切换供应商模型时余额面板立即联动；同供应商内切换模型保持不变。
- 安全加固：API 同源检查要求 Host 回环 + Origin 精确匹配；移除诊断后门；请求体限制。

## [1.0.0] - 2026-08-16

首发。

- 会话头部操作行新增余额徽章（`¥xx.xx`）：取自 DeepSeek 官方余额接口，服务器 60 秒缓存，点击可刷新。
- 每条带 token 用量的 assistant 回复显示本轮费用（`¥x.xxxx`）：用量取自会话快照，浏览器本地按官方价计价（`PRICING` 常量可配置）。
- API Key 复用 Harness 凭据服务（`DEEPSEEK_API_KEY`），不进入浏览器；未配置 Key 或网络失败时显示 `¥ —`。
- 宿主仅新增 `POST /plugins/api-balance/api` 路由；UI 通过 `conversation.session.header.actions`、`conversation.chat.assistant-actions` 插槽注入。
