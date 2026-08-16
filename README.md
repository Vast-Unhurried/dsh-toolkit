# 🧰 dsh-toolkit — DeepSeek Harness 实用工具箱

[English](README.en.md) | 简体中文

一组**纯增量**的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 原生插件合集：**便签**、**API 余额与费用**、**删除会话**。

三个插件遵循同一原则：**不改动 Harness 核心**——全部通过官方插槽（slot）与独立 API 路由注入，卸载即完全还原。

## 插件一览

| 插件 | 功能 | 界面位置 |
| --- | --- | --- |
| :memo: **dsh-note** | 原生便签：新建 / 历史 / 拖拽窗口 / 自动草稿 | 输入框工具行（Full access 选择器右侧） |
| :moneybag: **dsh-api-balance** | API 余额 + 每轮对话费用（¥） | 会话头部操作行 + 每条回复操作行 |
| :wastebasket: **dsh-session-delete** | 「删除会话」，彻底清理会话数据 | 会话列表 ⋮ 菜单 |

## 界面预览

![便签与余额](docs/screenshots/screenshot-note-and-balance.png)

*输入框工具行的便签按钮与浮层（新建 / 历史 / 保存）、会话头部余额徽章与每条回复的本轮费用。*

![删除会话菜单](docs/screenshots/screenshot-session-delete.jpg)

*会话列表 ⋮ 菜单中的「删除会话」。*

### :memo: dsh-note — 原生便签

- 输入框工具行一个与周边图标同款的小圆钮（28×28，随主题自动变色）
- 打开即**新建便签**，点击「保存」归档进历史（上限 30 条）；关闭时未保存内容自动存**草稿**防丢
- 「历史便签」弹出**独立窗口**：可自由拖拽、缩放，并**记住最近一次的位置和大小**；条目点击展开显示**复制**按钮，可单独删除
- 文本上限 16,000 字符；数据落盘 `$DSH_HOME/storages/dsh-note.json`（原子写入）

### :moneybag: dsh-api-balance — API 余额与费用

- 余额徽章 `¥xx.xx`：取自 DeepSeek 官方余额接口（60 秒缓存，点击可刷新）
- 每条 assistant 回复完成（带 token 用量）后显示本轮费用 `¥x.xxxx`，浏览器本地计价
- API Key 复用 Harness 凭据服务（`~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`），**Key 不进入浏览器**

### :wastebasket: dsh-session-delete — 删除会话

- 会话列表 ⋮ 菜单新增「删除会话」，**彻底删除**：JSONL 会话日志、工作区登记、归档集合全部清理
- 先 flush 未落盘数据、让写入路径退役，再移除内存登记并发出 `session/disposed`，最后删磁盘文件——不会留下损坏状态
- 运行中的会话也可删除（幂等，会话不存在时安全跳过）

## 仓库结构

```
dsh-toolkit/
├── packages/
│   ├── dsh-note/            # 便签插件
│   ├── dsh-api-balance/     # 余额与费用插件
│   └── dsh-session-delete/  # 删除会话插件
├── pnpm-workspace.yaml      # pnpm monorepo 聚合
└── README.md
```

三个包相互独立：可**单独安装、单独更新、单独卸载**，互不依赖。

## 安装

要求：DeepSeek Harness v0.1.0-rc.6+（Web 界面，Windows 实测）。

```bash
# 1. 克隆仓库
git clone https://github.com/Vast-Unhurried/dsh-toolkit.git
cd dsh-toolkit

# 2. 安装插件（可只装需要的）
dsh plugin --profile web add file:./packages/dsh-note
dsh plugin --profile web add file:./packages/dsh-api-balance
dsh plugin --profile web add file:./packages/dsh-session-delete
```

> `--profile web` 按你的实际 profile 名调整；`file:` 支持相对路径，从仓库根目录执行即可。

安装后需**重启 dsh 服务**（宿主路由 + 客户端 bundle 都需要重新加载），浏览器 **Ctrl+Shift+R** 硬刷新。

## 卸载

```bash
dsh plugin --profile web remove dsh-note
dsh plugin --profile web remove dsh-api-balance
dsh plugin --profile web remove dsh-session-delete
```

卸载即完全还原。便签数据文件（`$DSH_HOME/storages/dsh-note.json`）默认保留，如需彻底清除手动删除该文件。

## 兼容性与安全边界

- 客户端只读官方插槽：`conversation.input.left`、`conversation.session.header.actions`、`conversation.chat.assistant-actions` 等
- 宿主侧仅新增独立 API 路由（`/plugins/dsh-note/api`、`/plugins/api-balance/api`、`/plugins/session-delete/api`），不修改、不订阅任何核心状态
- 不收集任何遥测；不读取凭据以外的敏感信息；不向第三方发送数据

## License

[MIT](./LICENSE)
