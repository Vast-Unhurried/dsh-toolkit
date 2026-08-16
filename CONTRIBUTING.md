# Contributing

欢迎贡献！dsh-toolkit 是 pnpm monorepo，三个插件包相互独立（可单独安装、单独版本、单独发布）。

## 仓库结构

```
dsh-toolkit/
├── packages/
│   ├── dsh-note/            # 便签插件（客户端 + 宿主 API）
│   ├── dsh-api-balance/     # 余额与费用插件
│   └── dsh-session-delete/  # 删除会话插件
├── pnpm-workspace.yaml
└── README.md / README.en.md
```

每个插件包的结构（以 dsh-note 为例）：

```
packages/dsh-note/
├── lib/
│   ├── index.js   # 宿主插件入口（注册 API 路由等服务）
│   ├── api.js     # 宿主 API 实现（仅宿主侧逻辑）
│   └── client.js  # 客户端 bundle（插槽注入 + UI）
├── cordis.patch.yml   # bundle 补丁声明
└── package.json       # dsh.bundle / dsh.client manifest
```

## 开发与测试

```bash
# 安装依赖（peer 依赖由 dsh 运行时提供，本地无需安装）
pnpm install

# 本地安装到 dsh 进行测试（改动 lib/ 后重新执行即可热生效）
dsh plugin --profile web add file:./packages/dsh-note
# 宿主侧改动需重启 dsh 服务；客户端改动浏览器 Ctrl+Shift+R 硬刷新
```

### 设计原则

- **纯增量**：只通过官方插槽（slot）与独立 API 路由注入，不改动 Harness 核心；卸载即完全还原。
- **主题一致**：UI 使用 DSH 主题设计变量（`--dsw-*`），随明/暗主题自动变色。
- **数据安全**：写磁盘使用原子写（临时文件 + 重命名），并发写串行化。
- **请求体上限**：宿主 API 请求体上限 64 KiB（中文 3 字节/字，文本类上限按此折算，如便签 16,000 字符）。

## 提交约定

- 提交信息用 Conventional Commits 风格：`feat:` / `fix:` / `docs:` / `chore:` 等，可加作用域，如 `fix(dsh-note): ...`。
- 每个插件包的改动独立提交；涉及多个包时分开提交。
- 版本变更同步更新对应包的 `CHANGELOG.md`。

## 发布

三个包均可独立发布到 npm（`npm publish`，需先 `npm login`）。发布后推荐：

- 在 `~/.dsh/profiles/<profile>/pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 中加入新版本号（否则 pnpm 的 minimumReleaseAge 策略会静默跳过新版本）。
- 保持仓库 `dsh-plugin` topic，便于被 awesome 列表收录。

## License

MIT — 贡献即表示同意以 MIT 协议授权你的改动。
