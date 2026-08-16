# Changelog

## [1.0.0] - 2026-08-16

首发。

- 会话头部操作行新增余额徽章（`¥xx.xx`）：取自 DeepSeek 官方余额接口，服务器 60 秒缓存，点击可刷新。
- 每条带 token 用量的 assistant 回复显示本轮费用（`¥x.xxxx`）：用量取自会话快照，浏览器本地按官方价计价（`PRICING` 常量可配置）。
- API Key 复用 Harness 凭据服务（`DEEPSEEK_API_KEY`），不进入浏览器；未配置 Key 或网络失败时显示 `¥ —`。
- 宿主仅新增 `POST /plugins/api-balance/api` 路由；UI 通过 `conversation.session.header.actions`、`conversation.chat.assistant-actions` 插槽注入。
