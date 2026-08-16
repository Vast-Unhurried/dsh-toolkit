/**
 * dsh-api-balance browser half (hand-written bundle, no build step).
 *
 * Two read-only slot contributions, both purely additive to the native UI:
 *
 *   1. `conversation.session.header.actions` — a balance badge in the
 *      session header action row (the same row as the jobs list / export
 *      icons). It asks the host `/plugins/api-balance/api` for the DeepSeek
 *      account balance and renders `余额 ¥xx.xx` in a frosted-amber chip;
 *      clicking re-fetches.
 *   2. `conversation.chat.assistant-actions` — a per-turn cost label at the
 *      far left of each assistant reply's icon-action row (left of the copy
 *      icon). It sums the exact token usage of every LLM step in the turn
 *      from the session snapshot and prices it with the DeepSeek official
 *      per-million token rates, so every finished turn shows
 *      `本轮 ¥x.xxxx` right where the turn ends.
 *
 * Colors reuse the same design tokens as the surrounding icons
 * (`--dsw-alias-label-tertiary` resting, `--dsw-alias-label-secondary` +
 * `--dsw-alias-interactive-bg-hover` on hover) for the cost label; the
 * balance chip uses the theme's warn amber (`--dsw-alias-state-warn-primary`,
 * `--dsw-static-amber-500`) over a translucent amber wash for a frosted look.
 * Both follow the active theme automatically. No core file is touched; every
 * fetch failure renders silently as `余额 —`.
 *
 * Pricing (yuan per 1M tokens, DeepSeek official 模型&价格 page, fetched
 * 2026-08-13; applies to deepseek-v4-flash, the model this profile uses):
 *
 *   输入（缓存命中）  ¥0.02 / M
 *   输入（缓存未命中）¥1.00 / M
 *   输出              ¥2.00 / M
 *
 * DeepSeek moves to peak/off-peak pricing on 2026-08-17 (flash off-peak
 * 0.05/1.5/4.5, peak 0.10/3.0/9.0; pro 0.15/4.5/13.5 off-peak,
 * 0.30/9.0/27.0 peak). Update PRICING below when that lands, or when you use
 * another model — see README.
 * @module dsh-api-balance/client
 */
window.__ModuleLoader__.load({
  id: "dsh-api-balance",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let React = require("react");

    //#region constants
    const STYLE_ID = "dsh-api-balance";
    const API_PATH = "/plugins/api-balance/api";

    /** Per-million-token prices in yuan (deepseek-v4-flash, official rates). */
    const PRICING = {
      inputCacheHitYuanPerM: 0.02,
      inputCacheMissYuanPerM: 1.0,
      outputYuanPerM: 2.0,
    };

    const STYLES = `
.dab-badge{display:inline-flex;align-items:center;height:28px;max-width:200px;padding:0 10px;border:0;border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:28px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.dab-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 24%,transparent);color:var(--dsw-alias-state-warn-label)}
.dab-badge:disabled{cursor:default;opacity:.7}
.dab-cost{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 8px;order:-1;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:28px;white-space:nowrap;font-variant-numeric:tabular-nums}
`;
    //#endregion

    //#region pricing
    /**
     * Price one assistant node's exact token usage.
     * @param usage - the node's TokenUsage projection (or undefined).
     * @returns cost in yuan, or null when there is nothing to price.
     */
    function costOf(usage) {
      if (usage === null || typeof usage !== "object") return null;
      const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
      const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
      const cacheHit = Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0;
      const reasoning = Number.isFinite(usage.reasoningTokens) ? usage.reasoningTokens : 0;
      if (input + output + cacheHit + reasoning <= 0) return null;
      return (
        (input / 1e6) * PRICING.inputCacheMissYuanPerM +
        (cacheHit / 1e6) * PRICING.inputCacheHitYuanPerM +
        ((output + reasoning) / 1e6) * PRICING.outputYuanPerM
      );
    }

    /**
     * Format a yuan amount: two decimals at/above one cent, four below
     * (single-turn DeepSeek costs are often fractions of a cent).
     */
    function formatYuan(yuan) {
      if (yuan === null || yuan === undefined || !Number.isFinite(yuan) || yuan < 0) return null;
      const digits = yuan >= 0.01 ? 2 : 4;
      return "¥" + yuan.toFixed(digits);
    }
    //#endregion

    //#region snapshot helpers
    /**
     * Sum the token usage of every assistant step in the turn that owns
     * `messageId`. A turn can run several LLM steps (thinking → tool call →
     * final reply); each step carries its own usage, and the cost label must
     * cover the whole turn, not just the closing step that the slot anchors.
     * @param nodes - session snapshot chat nodes.
     * @param messageId - the closing assistant message the label anchors to.
     * @returns summed usage across the turn, or undefined when nothing matches.
     */
    function usageSumByTurn(nodes, messageId) {
      if (nodes === null || nodes === undefined) return undefined;
      const values = typeof nodes.values === "function"
        ? nodes.values()
        : Array.isArray(nodes) ? nodes : [];
      const rows = [];
      for (const value of values) {
        const data = value !== null && typeof value === "object" && "data" in value ? value.data : value;
        if (data === null || typeof data !== "object") continue;
        rows.push(data);
      }
      let targetTurn;
      for (const data of rows) {
        const finalNode = data.finalNode;
        if (finalNode !== null && finalNode !== undefined && finalNode.messageId === messageId) {
          targetTurn = finalNode.turn ?? data.turn;
          break;
        }
      }
      if (targetTurn === undefined) return undefined;
      const sum = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
      let any = false;
      for (const data of rows) {
        const finalNode = data.finalNode;
        const turn = finalNode?.turn ?? data.turn;
        if (turn !== targetTurn) continue;
        const usage = finalNode?.usage ?? data.usage;
        if (usage === null || typeof usage !== "object") continue;
        for (const key of Object.keys(sum)) {
          if (Number.isFinite(usage[key])) {
            sum[key] += usage[key];
            any = true;
          }
        }
      }
      return any ? sum : undefined;
    }
    //#endregion

    //#region components
    /**
     * Per-turn cost label, rendered in the assistant reply's icon-action row.
     * Only shows once the reply carries billed token usage (i.e. the turn is
     * finished); invisible while streaming or when usage is unreported.
     */
    function TurnCostLabel({ messageId, useSession }) {
      const usage = useSession((snapshot) => {
        const nodes = snapshot?.chat?.nodes ?? snapshot?.nodes;
        return usageSumByTurn(nodes, messageId);
      });
      const label = formatYuan(costOf(usage));
      if (label === null) return null;
      return React.createElement(
        "span",
        { className: "dab-cost", title: "本轮费用（按 deepseek-v4-flash 官方价估算）" },
        `本轮 ${label}`
      );
    }

    /**
     * Account balance badge in the session header action row. Fetches the
     * host balance API once on mount and on click; failures render as `¥ —`
     * with the reason in the tooltip, so the row never breaks.
     */
    function BalanceBadge() {
      const [state, setState] = React.useState({ status: "loading" });
      const alive = React.useRef(true);
      const requestId = React.useRef(0);
      React.useEffect(() => () => { alive.current = false; }, []);
      const load = React.useCallback(() => {
        const id = requestId.current + 1;
        requestId.current = id;
        setState((current) => ({ status: "loading", previous: current.label }));
        fetch(API_PATH, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ method: "getBalance" }),
          cache: "no-store",
        })
          .then((response) => response.json())
          .then((value) => {
            if (!alive.current || requestId.current !== id) return;
            if (value !== null && typeof value === "object" && value.ok === true) {
              const entry = value.cny !== null && value.cny !== undefined ? value.cny
                : Array.isArray(value.currencies) && value.currencies.length > 0 ? value.currencies[0] : null;
              const total = entry === null ? null : typeof entry.total === "string" ? entry.total : String(entry.total);
              const isCny = entry === null || entry.currency === undefined || entry.currency === "CNY";
              const currency = isCny ? "¥" : entry.currency;
              const label = total === null ? "余额 —" : `余额 ${currency}${total}`;
              const detail = [
                value.cny === null || value.cny === undefined ? null : `余额 ¥${value.cny.total}`,
                value.cny === null || value.cny === undefined ? null : `充值 ¥${value.cny.toppedUp}`,
                value.cny === null || value.cny === undefined ? null : `赠送 ¥${value.cny.granted}`,
              ].filter((line) => line !== null).join(" · ");
              setState({ status: "ready", label, detail });
              return;
            }
            const message = value !== null && typeof value === "object" && typeof value.message === "string" ? value.message : "余额查询失败";
            setState({ status: "error", label: "余额 —", detail: message });
          })
          .catch(() => {
            if (!alive.current || requestId.current !== id) return;
            setState((current) => ({ status: "error", label: current.previous ?? "余额 —", detail: "网络请求失败，点击重试" }));
          });
      }, []);
      React.useEffect(() => { load(); }, [load]);

      const title = state.status === "loading" ? "正在查询 API 余额…"
        : state.status === "ready" ? `${state.detail}（点击刷新）`
        : `${state.detail}（点击重试）`;
      return React.createElement(
        "button",
        { type: "button", className: "dab-badge", "aria-label": title, title, onClick: load, disabled: state.status === "loading" },
        state.status === "loading" && state.label === undefined ? "…" : state.label
      );
    }
    //#endregion

    //#region apply
    const inject = ["slots", "sessions"];

    function apply(ctx) {
      ctx.effect(() => {
        if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {};
        const tag = document.createElement("style");
        tag.dataset.plugin = STYLE_ID;
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = STYLES;
        document.head.appendChild(tag);
        return () => { tag.remove(); };
      }, "api-balance: styles");

      // Per-turn cost inside each assistant reply's icon-action row.
      ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
        name: "conversation.chat.assistant-actions",
        id: "api-balance-cost",
        order: 5,
      }, TurnCostLabel));

      // Account balance badge in the session header action row.
      ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
        name: "conversation.session.header.actions",
        id: "api-balance-badge",
        order: 90,
      }, BalanceBadge));
    }
    //#endregion

    exports.inject = inject;
    exports.apply = apply;

    return module.exports;
  }
});
