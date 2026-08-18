# 🧰 dsh-toolkit — DeepSeek Harness Utility Toolkit

[简体中文](README.md) | English

A collection of **purely incremental** native plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): **sticky notes**, **API balance & per-turn cost**, **reasoning levels**, and **session deletion**.

All four plugins follow the same principle: **no modification of Harness core** — everything is injected through official slots and dedicated API routes, and uninstalling fully restores the original state.

## Plugin overview

| Plugin | What it does | Where it lives |
| --- | --- | --- |
| :memo: **dsh-note** | Native sticky notes: create / history / draggable window / double-click history entries to edit with autosave | Input toolbar (right of the Full access selector) |
| :moneybag: **dsh-api-balance** | API balance + per-turn cost + today's usage (¥ / tokens, peak-off-peak pricing, per-vendor stats) | Session header actions + each assistant reply |
| :brain: **dsh-reasoning-levels** | Five-tier reasoning effort (low / medium / high / xhigh / max) for third-party models | Official model selector |
| :wastebasket: **dsh-session-delete** | "Delete session" action that cleans up session data thoroughly | Session list ⋮ menu |

### :memo: dsh-note — Native sticky notes

- A small round button in the input toolbar, styled like the surrounding icons (28×28, follows the theme)
- Opens as a **new note**; clicking **Save** archives it into history (max 30 entries); unsaved content is kept as an auto-saved **draft** when the popup closes
- The **history window** is an independent popup: freely draggable and resizable, and it **remembers the last position and size**; expanding an entry reveals a **Copy** button; entries can be deleted individually
- **Double-click an expanded entry to edit it inline**: autosaves ~0.6 s after you stop typing (shows "已自动保存"); the entry keeps its position and no keystrokes are lost; press ESC to finish editing
- Text limit 16,000 chars; data persists to `$DSH_HOME/storages/dsh-note.json` (atomic writes, serialized)

### :moneybag: dsh-api-balance — API balance & cost

- **Balance badge** in the session header: shows the balance of the current model's vendor — the official DeepSeek balance endpoint (labeled **高峰 / 闲时** peak/off-peak by Beijing time, aligned with the official 9:00–12:00 / 14:00–18:00 windows), a third-party balance endpoint, or local accounting (total − spent)
- **Vendor manager** (double-click the badge): add / edit / delete vendors, each holding multiple models sharing one balance pool; per-model rates for input / output / cache-read / cache-write (CNY per million tokens)
- **Per-turn cost**: each finished assistant reply shows `本轮 ¥x.xxxx`, priced with official peak/off-peak rates or custom rates; hover shows **cache hit rate** and consumed tokens (K/M tok)
- **Today's usage**: hovering the badge shows today's (Beijing time) consumption of the **current vendor** — official DeepSeek routes and their derived channels (e.g. vision-toolkit) are merged into one vendor, matching the DeepSeek usage page; third-party vendors are tracked separately and switch along with the badge
- **Switch-aware**: switching sessions or switching to another vendor's model updates the badge immediately; switching models within the same vendor keeps it unchanged
- The API key is reused from Harness' credential service (`DEEPSEEK_API_KEY` in `~/.dsh/.credentials.yaml`); the **key never reaches the browser**

### :brain: dsh-reasoning-levels — Third-party reasoning levels

- Offers five tiers — **low / medium / high / xhigh / max** — for third-party (pi-ai) models in the **official model selector**; models with tier support default to **Max** (highlighted on selection; requests go out as Max unless changed)
- On boot, automatically declares the five tiers for undeclared third-party models (idempotent); supported and unsupported models can **mix inside one vendor** — `reasoningEfforts: false` models show no tier UI, send no effort parameter, and keep the vendor default
- Official models keep their official three tiers (low / high / max) and are never touched
- Ships host-side helpers: `getSessionModel` / `setReasoning` / `setModel` / `levels` (model selection, tier diagnostics and switching)

### :wastebasket: dsh-session-delete — Delete sessions

- Adds **Delete session** to the session list ⋮ menu, removing the session **thoroughly**: JSONL session log, workspace registration and archive collection
- **Only cold sessions are deleted**: running sessions are refused (stop/close first) to avoid races with the persistence write path
- Strict session-ID validation; on-disk paths use the exact same encoding as the core backend, deletion targets are verified inside the storage root (including symlink protection); a missing storage root refuses deletion instead of silently succeeding
- Duplicate titles refuse to guess (no wrong-session deletion); a confirm dialog shows the session ID

## Repository layout

```
dsh-toolkit/
├── packages/
│   ├── dsh-note/                # sticky notes
│   ├── dsh-api-balance/         # balance & cost
│   ├── dsh-reasoning-levels/    # third-party reasoning levels
│   └── dsh-session-delete/      # session deletion
├── pnpm-workspace.yaml          # pnpm monorepo
└── README.md
```

The four packages are independent: install / update / remove each one separately.

## Install

Requires DeepSeek Harness v0.1.0-rc.7+ (Web UI; tested on Windows).

```bash
# 1. Clone the repo
git clone https://github.com/Vast-Unhurried/dsh-toolkit.git
cd dsh-toolkit

# 2. Install plugins (only the ones you need)
dsh plugin --profile web add file:./packages/dsh-note
dsh plugin --profile web add file:./packages/dsh-api-balance
dsh plugin --profile web add file:./packages/dsh-reasoning-levels
dsh plugin --profile web add file:./packages/dsh-session-delete
```

> Adjust `--profile web` to your actual profile; `file:` supports relative paths — run from the repo root.

Restart the dsh service after installing, then hard-refresh the browser (Ctrl+Shift+R).

## Uninstall

```bash
dsh plugin --profile web remove dsh-note
dsh plugin --profile web remove dsh-api-balance
dsh plugin --profile web remove dsh-reasoning-levels
dsh plugin --profile web remove dsh-session-delete
```

Uninstalling fully restores the original state. Note data (`$DSH_HOME/storages/dsh-note.json`) is kept by default — delete the file manually if you want it gone; after removing `dsh-reasoning-levels`, you may clean the `reasoningEfforts` / `reasoning` / `compat.supportsReasoningEffort` fields the plugin wrote under `llm-pi-ai` in `settings.yaml`.

## Compatibility & security

- Client only consumes official slots: `conversation.input.left`, `conversation.session.header.actions`, `conversation.chat.assistant-actions`, etc.
- Host only adds dedicated API routes (`/plugins/dsh-note/api`, `/plugins/api-balance/api`, `/plugins/reasoning-levels/api`, `/plugins/session-delete/api`); no core state is modified or subscribed.
- All API routes enforce same-origin checks (loopback Host + exact Origin/Host match), rejecting cross-site and DNS-rebinding requests.
- No telemetry; no sensitive data beyond credentials is read; nothing is sent to third parties.

## License

[MIT](./LICENSE)
