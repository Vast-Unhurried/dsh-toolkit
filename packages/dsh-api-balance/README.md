# dsh-api-balance

DeepSeek Harness 原生风格的 API 余额与每轮费用显示插件（人民币）。

- **余额**：显示在会话消息区右上角操作行（与任务列表、导出等图标同一行），格式 `¥xx.xx`，点击可刷新，60 秒内服务器缓存。
- **本轮费用**：每条 assistant 回复完成（带 token 用量）后，在其操作图标行内显示 `¥x.xxxx`。
- **位置与颜色**：均使用 DSH 主题设计变量（`--dsw-alias-label-tertiary` 等），与附近图标完全一致，自动跟随明/暗主题。
- **不影响核心**：只通过官方 slot（`conversation.session.header.actions`、`conversation.chat.assistant-actions`）注入只读 UI；宿主仅新增一个 `/plugins/api-balance/api` 路由，不修改、不订阅、不写入任何核心状态。

## 余额来源

- 调用 DeepSeek 官方余额接口 `GET https://api.deepseek.com/user/balance`（[官方文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)）。
- API Key 复用 Harness 的凭据服务（`~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`，即模型设置页写入的那个）。**Key 不会发送到浏览器**。
- 未配置 Key 或网络失败时，徽章显示 `¥ —`，悬停可见原因；不影响任何功能。

## 费用计算

- 每条回复的 token 用量直接取自 DSH 会话快照（精确到每条 `assistant/message` 的 `usage`），在浏览器本地计价。
- 计费口径与官方一致：输入按「缓存命中 / 未命中」分档，`reasoningTokens` 与输出同价。
- 默认定价 = **deepseek-v4-flash 现行官方价**（2026-08-13 抓取自[官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)）：

| 项目 | 价格（元/百万 tokens） |
| --- | --- |
| 输入（缓存命中） | 0.02 |
| 输入（缓存未命中） | 1.00 |
| 输出（含 reasoning） | 2.00 |

### 修改定价

编辑 `lib/client.js` 顶部的 `PRICING` 常量后重启服务器（Ctrl+C → `dsh web` → 浏览器 Ctrl+Shift+R）。

> ⚠️ DeepSeek 将于 **2026-08-17 00:00（北京时间）** 起执行峰谷定价：
> - flash：空闲 0.05 / 1.5 / 4.5，高峰（9:00-12:00、14:00-18:00）0.10 / 3.0 / 9.0
> - pro：空闲 0.15 / 4.5 / 13.5，高峰 0.30 / 9.0 / 27.0
>
> 届时请按所用模型更新 `PRICING`（如需区分峰谷可自行扩展）。

## 安装 / 卸载

```bash
# 在 dsh-toolkit 仓库根目录执行
dsh plugin --profile web add file:./packages/dsh-api-balance
# 卸载（会一并清理依赖与 bundles 登记）
dsh plugin --profile web remove dsh-api-balance
```

安装后需重启服务器生效（宿主路由 + 客户端 bundle 均需重启后加载）。

## 已知限制

- 费用为按官方价的估算值，未含峰谷差价；实际扣费以 DeepSeek 账单为准。
- 只有「已完成且带 usage」的回复显示费用；正在流式输出 / 无 usage 的回复不显示。
