# 🧰 dsh-toolkit — DeepSeek Harness Utility Toolkit

A collection of **purely incremental** native plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): **sticky notes**, **API balance & per-turn cost**, and **session deletion**.

All three plugins follow the same principle: **no modification of Harness core** — everything is injected through official slots and dedicated API routes, and uninstalling fully restores the original state.

## Plugin overview

| Plugin | What it does | Where it lives |
| --- | --- | --- |
| 📝 **dsh-note** | Native sticky notes: create / history / draggable window / auto-saved drafts | Input toolbar (right of the Full access selector) |
| 💰 **dsh-api-balance** | API balance + per-turn conversation cost (¥) | Session header actions + each assistant reply |
| 🗑️ **dsh-session-delete** | "Delete session" action that cleans up session data thoroughly | Session list ⋮ menu |

### 📝 dsh-note — Native sticky notes

- A small round button in the input toolbar, styled like the surrounding icons (28×28, follows the theme)
- Opens as a **new note**; clicking **Save** archives it into history (max 30 entries); unsaved content is kept as an auto-saved **draft** when the popup closes
- The **history window** is an independent popup: freely draggable and resizable, and it **remembers the last position and size**; expanding an entry reveals a **Copy** button; entries can be deleted individually
- Text limit 16,000 chars; data persists to `$DSH_HOME/storages/dsh-note.json` (atomic writes)

### 💰 dsh-api-balance — API balance & cost

- Balance badge `¥xx.xx`: fetched from the official DeepSeek balance endpoint (60 s server-side cache, click to refresh)
- Each completed assistant reply (with token usage) shows its per-turn cost `¥x.xxxx`, priced locally in the browser
- The API key is reused from Harness' credential service (`DEEPSEEK_API_KEY` in `~/.dsh/.credentials.yaml`); the **key never reaches the browser**

### 🗑️ dsh-session-delete — Delete sessions

- Adds **Delete session** to the session list ⋮ menu, removing the session **thoroughly**: JSONL session log, workspace registration and archive collection
- Flushes pending data and retires the write path first, then removes in-memory registration and emits `session/disposed`, and only then deletes disk files — no corrupted state is left behind
- Running sessions can be deleted too (idempotent; safely skipped when the session does not exist)

## Repository layout

```
dsh-toolkit/
├── packages/
│   ├── dsh-note/            # sticky note plugin
│   ├── dsh-api-balance/     # balance & cost plugin
│   └── dsh-session-delete/  # session deletion plugin
├── pnpm-workspace.yaml      # pnpm monorepo aggregation
└── README.md
```

The three packages are independent: they can be **installed, updated and removed individually** with no interdependencies.

## Install

Requires: DeepSeek Harness v0.1.0-rc.6+ (Web UI; tested on Windows).

```bash
# 1. Clone the repository
git clone https://github.com/Vast-Unhurried/dsh-toolkit.git
cd dsh-toolkit

# 2. Install the plugins (install only the ones you need)
dsh plugin --profile web add file:./packages/dsh-note
dsh plugin --profile web add file:./packages/dsh-api-balance
dsh plugin --profile web add file:./packages/dsh-session-delete
```

> Adjust `--profile web` to your actual profile name; `file:` accepts relative paths, so run it from the repository root.

After installing, **restart the dsh service** (both host routes and client bundles need to be reloaded), then hard-refresh the browser (**Ctrl+Shift+R**).

## Uninstall

```bash
dsh plugin --profile web remove dsh-note
dsh plugin --profile web remove dsh-api-balance
dsh plugin --profile web remove dsh-session-delete
```

Uninstalling fully restores the original state. The note data file (`$DSH_HOME/storages/dsh-note.json`) is kept by default; delete it manually if you want it gone too.

## Compatibility & security

- Client side only consumes official slots: `conversation.input.left`, `conversation.session.header.actions`, `conversation.chat.assistant-actions`, etc.
- Host side only adds dedicated API routes (`/plugins/dsh-note/api`, `/plugins/api-balance/api`, `/plugins/session-delete/api`); no core state is modified or subscribed to
- No telemetry; no sensitive data is read beyond credentials; nothing is sent to third parties

## License

[MIT](./LICENSE)
