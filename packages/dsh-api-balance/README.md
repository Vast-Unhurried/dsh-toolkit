# dsh-api-balance — API 余额与每轮费用显示插件

DeepSeek Harness 原生风格的 **API 余额** 与 **每轮费用** 显示插件（人民币），并在会话头部提供**模型计费管理**。

- **余额徽章**：会话头部操作行。显示**当前模型所属供应商**的余额，格式 `余额（供应商）¥xx.xx`；DeepSeek 官方路由显示 `余额（高峰）` / `余额（闲时）`（按北京时间，与官网峰谷窗口 9:00–12:00、14:00–18:00 对齐）
  - 余额来源三种：**DeepSeek 官方接口**（`GET https://api.deepseek.com/user/balance`）、**第三方余额接口**（URL + 凭据名）、**本地记账**（初始总金额 − 已扣费用）
  - **单击刷新**（官方接口绕过 60 秒缓存；本地记账实时重算）；**双击**打开「模型计费管理」
- **模型计费管理**：双击徽章打开。可添加 / 编辑 / 删除**供应商**（一个供应商挂多个模型，共用同一余额池），为第三方模型设置独立的输入 / 输出 / 缓存读 / 缓存写费率（元/百万 tokens）
- **本轮费用**：每条 assistant 回复完成（带 token 用量）后，在其操作图标旁显示 `本轮 ¥x.xxxx`；按官方峰谷价或自定义费率精确计价（缓存命中分开计价）；**悬停**显示 `缓存命中率 X% 消耗 X K/M tok`
- **今日消耗**：悬停徽章显示**当日（北京时间）账户全部消耗**（K tok / M tok）——所有供应商 / 模型 / 会话的 token 之和（含缓存命中），与 DeepSeek 官网用量页数字一致
- **切换联动**：切换会话或切换供应商模型时，徽章立即切换为该供应商的余额；同供应商内切换模型保持不变

## 计价

- **DeepSeek 官方（deepseek-v4-flash）**：峰谷价（2026-08-17 生效）：

| 时段 | 输入（缓存未命中） | 输入（缓存命中） | 输出（含 reasoning） |
| --- | --- | --- | --- |
| 高峰（9:00–12:00、14:00–18:00 北京时间） | 3.0 | 0.10 | 9.0 |
| 闲时（其余时段） | 1.5 | 0.05 | 4.5 |

  单位：元 / 百万 tokens。
- **第三方供应商**：按「模型计费管理」中配置的费率计价（未配置的模型不参与本地记账）。

## 数据与 API

- 路由：`POST /plugins/api-balance/api`，方法 `getBalance` / `getActiveModel` / `getSessionModel` / `getLocalBalance` / `getTodayUsage` / `syncProviders` / `resetLocalBalance` / `ping`
- 供应商配置与费率保存在浏览器 localStorage，并同步到宿主 `$DSH_HOME/plugins/dsh-api-balance/state.json`（本地记账账本 + 按供应商的每日 token 统计）
- API Key 复用 Harness 凭据服务（`~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`），**Key 永不进入浏览器**
- 宿主订阅全局会话事件流为第三方本地记账扣费；官方模型的用量也计入「今日消耗」统计

## 安装 / 卸载

```bash
dsh plugin --profile web add file:./packages/dsh-api-balance
# 卸载
dsh plugin --profile web remove dsh-api-balance
```

重启 dsh 服务后浏览器硬刷新。卸载后本地记账数据保留在 `$DSH_HOME/plugins/dsh-api-balance/state.json`，如需彻底清除手动删除。

## 安全

- 仅 POST + 同源校验（Host 回环 + Origin 精确匹配），拒绝跨站 / DNS rebinding
- 凭据只在宿主侧解析；请求体 64 KiB 上限；响应 no-store
- 客户端纯 React 渲染，无 innerHTML / eval；不改动 Harness 核心
