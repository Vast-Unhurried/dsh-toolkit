/**
 * dsh-api-balance browser half (hand-written bundle, no build step).
 *
 * Two read-only slot contributions, both purely additive to the native UI:
 *
 *   1. `conversation.session.header.actions` — a balance badge in the
 *      session header action row. It reads the harness's current model
 *      selection from the host (`getActiveModel`), resolves that model to a
 *      vendor entry (official DeepSeek or a user-configured third-party
 *      vendor, which may hold several models sharing one total), and shows
 *      that vendor's account balance — from its remote balance endpoint when
 *      configured, otherwise from host-side local accounting (a total amount
 *      minus every settled turn across ALL sessions) when the vendor has
 *      one, otherwise `余额 —`. Interactions:
 *        • single click — refresh the balance live (remote: host cache
 *          bypassed; local: the host ledger is queried fresh, so the shown
 *          balance is `total − turn(会话1) − turn(会话2) − …` at click time);
 *        • double click — open the vendor/model pricing manager (add / edit
 *          / delete vendors and the models under them), persisted in
 *          localStorage and synced to the host.
 *      The badge re-checks the active model every few seconds, so switching
 *      models in the composer updates the displayed balance automatically.
 *   2. `conversation.chat.assistant-actions` — a per-turn cost label at the
 *      far left of each assistant reply's icon-action row. It sums the exact
 *      token usage of every LLM step in the turn from the session snapshot
 *      and prices it with the active model's vendor rates, so every finished
 *      turn shows `本轮 ¥x.xxxx` right where the turn ends.
 *
 * Pricing for the official DeepSeek route follows the 峰谷 (peak/off-peak)
 * rule (effective 2026-08-17, Beijing time; official 模型&价格 page): peak
 * hours are 9:00–12:00 and 14:00–18:00, off-peak is everything else, and
 * off-peak prices are half the peak prices. Third-party vendors carry flat
 * custom rates per model (input / output / cache read / cache write, CNY per
 * million tokens). The vendor/model registry persists in localStorage
 * (`dsh-api-balance:providers:v2`); the pre-1.4.1 flat provider list and the
 * legacy client-side ledger are migrated automatically.
 *
 * Colors reuse the same design tokens as the surrounding icons
 * (`--dsw-alias-label-tertiary` resting, `--dsw-alias-label-secondary` +
 * `--dsw-alias-interactive-bg-hover` on hover) for the cost label; the
 * balance chip uses the theme's warn amber (`--dsw-alias-state-warn-primary`)
 * over a translucent amber wash for a frosted look. Both follow the active
 * theme automatically. No core file is touched; every fetch failure renders
 * silently as `余额 —`.
 * @module dsh-api-balance/client
 */
window.__ModuleLoader__.load({
  id: "dsh-api-balance",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let React = require("react");
    let ReactDOM = require("react-dom");

    //#region constants
    const STYLE_ID = "dsh-api-balance";
    const API_PATH = "/plugins/api-balance/api";

    /** localStorage keys: v2 registry, legacy flat list, legacy ledger. */
    const STORAGE_KEY_V2 = "dsh-api-balance:providers:v2";
    const STORAGE_KEY_V1 = "dsh-api-balance:providers:v1";
    const STORAGE_KEY_LEDGER = "dsh-api-balance:ledger:v1";

    /**
     * Official DeepSeek peak/off-peak price table, yuan per 1M tokens,
     * deepseek-v4-flash (official 模型&价格 page, effective 2026-08-17;
     * off-peak = half of peak). `input` prices cache-miss input tokens,
     * `cacheRead` prices cache-hit input tokens, `cacheWrite` is not billed
     * by DeepSeek (0), `output` also covers reasoning tokens.
     */
    const OFFICIAL_PRICING = {
      peak: { input: 3.0, cacheRead: 0.1, cacheWrite: 0, output: 9.0 },
      offPeak: { input: 1.5, cacheRead: 0.05, cacheWrite: 0, output: 4.5 },
    };

    /** Official peak windows, Beijing time (half-open intervals). */
    const PEAK_WINDOWS = [
      { start: 9, end: 12 },
      { start: 14, end: 18 },
    ];

    /** The four editable price slots of a third-party model. */
    const PRICE_FIELDS = [
      { key: "input", label: "输入价", hint: "未命中缓存的输入 tokens" },
      { key: "output", label: "输出价", hint: "含思维链（reasoning）tokens" },
      { key: "cacheRead", label: "缓存读取价", hint: "命中缓存的输入 tokens" },
      { key: "cacheWrite", label: "缓存写入价", hint: "写入缓存的 tokens" },
    ];

    /** Debounce between a single and a double click on the badge (ms). */
    const CLICK_DEBOUNCE_MS = 240;

    /** How often the badge re-checks the harness's active model (ms). */
    const ACTIVE_MODEL_POLL_MS = 2_000;

    /** How often the open manager panel re-checks model + balance (ms). */
    const PANEL_POLL_MS = 3_000;

    const STYLES = `
.dab-badge{display:inline-flex;align-items:center;height:28px;max-width:220px;padding:0 10px;border:0;border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:28px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.dab-badge:hover{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 24%,transparent);color:var(--dsw-alias-state-warn-label)}
.dab-badge:disabled{cursor:default;opacity:.7}
.dab-cost{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 8px;order:-1;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:28px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dab-overlay{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1)}
.dab-dialog{box-sizing:border-box;width:min(620px,calc(100vw - 24px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;gap:12px;padding:16px;background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-shadow-lv2);overflow:hidden}
.dab-dialog-title{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dab-dialog-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dab-list{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.dab-vendor{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px;display:flex;flex-direction:column;gap:8px}
.dab-vendor[data-current="1"]{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent)}
.dab-vendor-head{display:flex;align-items:center;gap:8px}
.dab-vendor-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dab-vendor-title{font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dab-current{flex:none;display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent);color:var(--dsw-alias-state-business-primary);font-size:11px;line-height:16px;margin-left:6px;vertical-align:1px}
.dab-vendor-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.dab-vendor-models{display:flex;flex-direction:column;gap:6px}
.dab-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
.dab-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dab-row-title{font-size:13px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dab-row-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.dab-row-actions{flex:none;display:flex;gap:6px}
.dab-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dab-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dab-field-full{grid-column:1 / -1}
.dab-field-label{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dab-field-hint{font-size:11px;line-height:14px;color:var(--dsw-alias-label-dimmed)}
.dab-field-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:32px;outline:none;font-variant-numeric:tabular-nums}
.dab-field-input:focus{border-color:var(--dsw-alias-border-l3);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-border-l3) 30%,transparent)}
.dab-error{font-size:12px;line-height:16px;color:var(--dsw-alias-state-error-primary)}
.dab-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end;flex:none}
.dab-btn{flex:none;height:28px;padding:0 14px;border:none;border-radius:14px;cursor:pointer;font-size:13px;line-height:28px;white-space:nowrap}
.dab-btn-ghost{background:none;color:var(--dsw-alias-label-secondary)}
.dab-btn-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dab-btn-primary{background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);font-weight:500}
.dab-btn-primary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dab-btn-danger{background:none;color:var(--dsw-alias-state-error-primary)}
.dab-btn-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
`;
    //#endregion

    //#region vendor/model store
    /**
     * Registry: `{ vendors: [{ id, label, balance, localBalance }],
     * models: [{ id, vendorId, match, rates }] }`. A vendor's models share
     * its balance source and, for local accounting, one total amount.
     */
    let store = loadStore();
    let storeSnapshot = { vendors: store.vendors, models: store.models };
    const storeListeners = new Set();

    /**
     * Legacy client-side ledger totals (pre-1.4.0, keyed by the old flat
     * provider id — which becomes the vendor id in migration), handed to the
     * host once so old deductions survive the upgrade.
     */
    let legacyLedgerTotals = loadLegacyLedgerTotals();

    /** Generate a small unique id. */
    function makeId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    /** Read the registry, migrating the legacy flat provider list. */
    function loadStore() {
      try {
        const rawV2 = window.localStorage.getItem(STORAGE_KEY_V2);
        if (rawV2 !== null) {
          const value = JSON.parse(rawV2);
          if (value !== null && typeof value === "object") {
            return {
              vendors: Array.isArray(value.vendors)
                ? value.vendors.filter((entry) => entry !== null && typeof entry === "object"
                    && typeof entry.id === "string" && entry.id.length > 0
                    && typeof entry.label === "string" && entry.label.length > 0)
                : [],
              models: Array.isArray(value.models)
                ? value.models.filter((entry) => entry !== null && typeof entry === "object"
                    && typeof entry.id === "string" && typeof entry.vendorId === "string"
                    && typeof entry.match === "string" && entry.match.length > 0
                    && entry.rates !== null && typeof entry.rates === "object"
                    && Number.isFinite(entry.rates.input) && Number.isFinite(entry.rates.output)
                    && Number.isFinite(entry.rates.cacheRead) && Number.isFinite(entry.rates.cacheWrite))
                : [],
            };
          }
        }
        const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1);
        if (rawV1 !== null) {
          const value = JSON.parse(rawV1);
          if (Array.isArray(value)) {
            const flat = value.filter((entry) => entry !== null && typeof entry === "object"
              && typeof entry.id === "string" && typeof entry.label === "string"
              && typeof entry.match === "string"
              && entry.rates !== null && typeof entry.rates === "object");
            const migrated = {
              vendors: flat.map((entry) => ({
                id: entry.id,
                label: entry.label,
                balance: entry.balance ?? null,
                localBalance: entry.localBalance ?? null,
              })),
              models: flat.map((entry) => ({
                id: `${entry.id}:m`,
                vendorId: entry.id,
                match: entry.match,
                rates: entry.rates,
              })),
            };
            window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated));
            window.localStorage.removeItem(STORAGE_KEY_V1);
            return migrated;
          }
        }
      } catch {
        /* fall through to defaults */
      }
      return { vendors: [], models: [] };
    }

    /** Read legacy client-side ledger totals, then drop the old key. */
    function loadLegacyLedgerTotals() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY_LEDGER);
        if (raw === null) return {};
        const value = JSON.parse(raw);
        const totals = {};
        if (value !== null && typeof value === "object") {
          for (const key of Object.keys(value)) {
            const entry = value[key];
            if (entry !== null && typeof entry === "object"
              && typeof entry.providerId === "string" && Number.isFinite(entry.cost) && entry.cost > 0) {
              totals[entry.providerId] = (totals[entry.providerId] ?? 0) + entry.cost;
            }
          }
        }
        window.localStorage.removeItem(STORAGE_KEY_LEDGER);
        return totals;
      } catch {
        return {};
      }
    }

    /** Persist the registry and notify subscribers. */
    function setStore(next) {
      store = next;
      storeSnapshot = { vendors: next.vendors, models: next.models };
      try {
        window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(next));
      } catch {
        /* storage unavailable — keep in-memory registry */
      }
      for (const callback of storeListeners) callback();
      syncToHost();
    }

    /** Upsert one vendor. */
    function upsertVendor(vendor) {
      const vendors = [...store.vendors];
      const index = vendors.findIndex((item) => item.id === vendor.id);
      if (index >= 0) vendors[index] = vendor;
      else vendors.push(vendor);
      setStore({ vendors, models: store.models });
    }

    /** Delete one vendor together with all of its models. */
    function deleteVendor(vendorId) {
      setStore({
        vendors: store.vendors.filter((item) => item.id !== vendorId),
        models: store.models.filter((item) => item.vendorId !== vendorId),
      });
      callApi({ method: "resetLocalBalance", vendorId }).catch(() => {});
    }

    /** Upsert one model (must reference an existing vendor). */
    function upsertModel(model) {
      const models = [...store.models];
      const index = models.findIndex((item) => item.id === model.id);
      if (index >= 0) models[index] = model;
      else models.push(model);
      setStore({ vendors: store.vendors, models });
    }

    /** Delete one model. */
    function deleteModel(modelId) {
      setStore({ vendors: store.vendors, models: store.models.filter((item) => item.id !== modelId) });
    }

    /** Subscribe to registry changes; returns the unsubscribe function. */
    function subscribeStore(callback) {
      storeListeners.add(callback);
      return () => { storeListeners.delete(callback); };
    }

    /** Stable snapshot of the registry (for useSyncExternalStore). */
    function getStoreSnapshot() {
      return storeSnapshot;
    }

    /**
     * Push the local-accounting vendors and their models to the host (the
     * host records every settled turn across ALL sessions against them),
     * together with any migrated legacy totals. Fire-and-forget.
     */
    function syncToHost() {
      const localVendors = store.vendors.filter((vendor) => vendor.localBalance !== null && vendor.localBalance !== undefined
        && (vendor.balance === null || vendor.balance.url === ""));
      const ids = new Set(localVendors.map((vendor) => vendor.id));
      const models = store.models
        .filter((model) => ids.has(model.vendorId))
        .map((model) => ({ id: model.id, vendorId: model.vendorId, match: model.match, rates: model.rates }));
      const legacySpent = legacyLedgerTotals;
      legacyLedgerTotals = {};
      callApi({
        method: "syncProviders",
        vendors: localVendors.map((vendor) => ({ id: vendor.id })),
        models,
        legacySpent,
      }).catch(() => {});
    }
    //#endregion

    //#region active model store
    /** The harness's current `{ provider, model }`, or null when unknown. */
    let activeSource = null;
    let activeSnapshot = { source: null };
    const activeListeners = new Set();

    /** Update the known active model and notify subscribers. */
    function setActiveSource(source) {
      activeSource = source;
      activeSnapshot = { source };
      for (const callback of activeListeners) callback();
    }

    /** Subscribe to active-model changes; returns the unsubscribe function. */
    function subscribeActive(callback) {
      activeListeners.add(callback);
      return () => { activeListeners.delete(callback); };
    }

    /** Stable snapshot of the active model (for useSyncExternalStore). */
    function getActiveSnapshot() {
      return activeSnapshot;
    }
    //#endregion

    //#region model-change notification
    /**
     * Module-level "the session's model/vendor may have changed" signal. The
     * plugin body subscribes it to the remote `settings/document-updated` /
     * `llm/adapters-updated` events (selectModel persists the new selection
     * through the settings seam, which raises them), and the badge listens so
     * a vendor switch in the same session refreshes the balance + per-vendor
     * 今日消耗 immediately instead of waiting for the polling interval.
     */
    const modelChangeListeners = new Set();

    /** Notify every listener (each is isolated — one throwing never stops the rest). */
    function notifyModelChanged() {
      for (const callback of [...modelChangeListeners]) {
        try { callback(); } catch { /* isolate listeners */ }
      }
    }

    /** Subscribe to model/vendor-change notifications; returns the unsubscribe. */
    function subscribeModelChanged(callback) {
      modelChangeListeners.add(callback);
      return () => { modelChangeListeners.delete(callback); };
    }
    //#endregion

    //#region pricing resolution
    /** Hour of the day in Beijing time (0–23), with a local-time fallback. */
    function beijingHour(timeMs) {
      try {
        const hour = Number(
          new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Shanghai" })
            .format(new Date(timeMs))
        );
        if (Number.isFinite(hour)) return hour;
      } catch {
        /* fall through to the local-time fallback */
      }
      return new Date(timeMs).getHours();
    }

    /** Whether `timeMs` falls inside an official peak window (Beijing time). */
    function isPeakWindow(timeMs) {
      const hour = beijingHour(timeMs);
      return PEAK_WINDOWS.some((window) => hour >= window.start && hour < window.end);
    }

    /**
     * Resolve a `{ provider, model }` source to a model entry. DeepSeek
     * official always stays official (null); third-party models match by
     * `provider/model`, then `model`, then `provider`, then `*` (first
     * configured model wins on ties).
     * @returns the matched model entry, or null.
     */
    function modelFor(source) {
      if (source === null || typeof source !== "object") return null;
      if (source.provider === "deepseek-official") return null;
      const { models } = store;
      if (models.length === 0) return null;
      const full = `${source.provider}/${source.model}`;
      return models.find((entry) => entry.match === full)
        ?? models.find((entry) => entry.match === source.model)
        ?? models.find((entry) => entry.match === source.provider)
        ?? models.find((entry) => entry.match === "*")
        ?? null;
    }

    /**
     * Resolve a source to `{ vendor, model }` (the vendor owning the matched
     * model), or null for the official DeepSeek route.
     */
    function vendorFor(source) {
      const model = modelFor(source);
      if (model === null) return null;
      const vendor = store.vendors.find((entry) => entry.id === model.vendorId);
      if (vendor === undefined) return null;
      return { vendor, model };
    }

    /**
     * Effective pricing for the active model at `timeMs`: the matched
     * vendor's model rates, or the official DeepSeek peak/off-peak table
     * selected by turn time.
     * @returns `{ kind, label, rates }` with rates `{ input, output, cacheRead, cacheWrite }`.
     */
    function pricingFor(source, timeMs) {
      const matched = vendorFor(source);
      if (matched !== null) return { kind: "custom", label: matched.vendor.label, rates: matched.model.rates };
      if (isPeakWindow(timeMs)) {
        return { kind: "official-peak", label: "DeepSeek 官方高峰价", rates: OFFICIAL_PRICING.peak };
      }
      return { kind: "official-offpeak", label: "DeepSeek 官方空闲价", rates: OFFICIAL_PRICING.offPeak };
    }

    /** Map a currency code to its usual symbol (fallback: the raw code). */
    function currencySymbol(currency) {
      if (typeof currency !== "string") return "";
      const symbols = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", JPY: "¥", HKD: "HK$", TWD: "NT$" };
      return symbols[currency.toUpperCase()] ?? currency;
    }
    //#endregion

    //#region pricing math
    /**
     * Price one assistant node's exact token usage with the given rates
     * (yuan per 1M tokens). Token counts are DISJOINT (per the harness
     * contract): `inputTokens` is uncached input only, cached input is
     * `cacheReadTokens`/`cacheWriteTokens`, so billed input = their sum and
     * each slice is priced at its own rate — this is exactly the
     * cache-hit-aware billing. The cache hit rate is derived as an explicit
     * variable (cacheRead / total input) so it can be surfaced in the UI and
     * cross-checked.
     *
     * NOTE on reasoning tokens: `reasoningTokens` is a SUBSET of
     * `outputTokens` in the harness contract (the DeepSeek adapter reports
     * `completion_tokens` already containing `reasoning_tokens`, and pi-ai
     * folds reasoning into output), so billing uses `output` alone — adding
     * `reasoning` again would charge the thinking tokens twice.
     * @param usage - the node's TokenUsage projection (or undefined).
     * @param rates - `{ input, output, cacheRead, cacheWrite }`.
     * @returns `{ cost, hitRate, totalInput, input, cacheRead, cacheWrite, output, reasoning }`
     * or null when there is nothing to price.
     */
    function computeCostInfo(usage, rates) {
      if (usage === null || typeof usage !== "object") return null;
      const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
      const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
      const cacheRead = Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0;
      const cacheWrite = Number.isFinite(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0;
      const reasoning = Number.isFinite(usage.reasoningTokens) ? usage.reasoningTokens : 0;
      if (input + output + cacheRead + cacheWrite + reasoning <= 0) return null;
      const totalInput = input + cacheRead + cacheWrite;
      const hitRate = totalInput > 0 ? cacheRead / totalInput : 0;
      const cost = (
        (input / 1e6) * rates.input +
        (cacheRead / 1e6) * rates.cacheRead +
        (cacheWrite / 1e6) * rates.cacheWrite +
        (output / 1e6) * rates.output
      );
      return { cost, hitRate, totalInput, input, cacheRead, cacheWrite, output, reasoning };
    }

    /**
     * Price one assistant node's exact token usage (yuan), or null when there
     * is nothing to price. See {@link computeCostInfo} for the cache-aware
     * breakdown.
     */
    function costOf(usage, rates) {
      const info = computeCostInfo(usage, rates);
      return info === null ? null : info.cost;
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

    /** Format a plain amount with exactly two decimals (ledger balances). */
    function formatAmount(amount) {
      return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
    }

    /**
     * Format a token count like the DeepSeek usage page: thousands with a K
     * suffix below one million, millions with an M suffix at/above it, both
     * followed by `tok`.
     */
    function formatTokens(total) {
      if (!Number.isFinite(total) || total < 0) return "0K tok";
      const thousands = total / 1000;
      if (thousands >= 1000) return `${(thousands / 1000).toFixed(1)}M tok`;
      return `${thousands.toFixed(1)}K tok`;
    }
    //#endregion

    //#region api transport
    /** POST one method body to the host plugin API; never throws. */
    function callApi(body) {
      return fetch(API_PATH, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      })
        .then((response) => response.json())
        .catch(() => ({ ok: false, error: "network", message: "网络请求失败" }));
    }
    //#endregion

    //#region snapshot helpers
    /**
     * Sum the token usage of every assistant step in the turn that owns
     * `messageId`, and capture the turn's wall-clock time (for peak/off-peak
     * selection). A turn can run several LLM steps (thinking → tool call →
     * final reply); each step carries its own usage, and the cost label must
     * cover the whole turn, not just the closing step that the slot anchors.
     * @param nodes - session snapshot chat nodes.
     * @param messageId - the closing assistant message the label anchors to.
     * @returns `{ sum, time }` across the turn, or undefined when nothing
     * matches (`time` falls back to `Date.now()` when the snapshot carries
     * no timestamp).
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
      let anchorTime = null;
      for (const data of rows) {
        const finalNode = data.finalNode;
        if (finalNode !== null && finalNode !== undefined && finalNode.messageId === messageId) {
          targetTurn = finalNode.turn ?? data.turn;
          anchorTime = finalNode.time ?? finalNode.timestamp ?? data.time ?? data.timestamp ?? null;
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
        if (anchorTime === null) {
          anchorTime = finalNode?.time ?? finalNode?.timestamp ?? data.time ?? data.timestamp ?? null;
        }
        const usage = finalNode?.usage ?? data.usage;
        if (usage === null || typeof usage !== "object") continue;
        for (const key of Object.keys(sum)) {
          if (Number.isFinite(usage[key])) {
            sum[key] += usage[key];
            any = true;
          }
        }
      }
      return any ? { sum, time: anchorTime ?? Date.now() } : undefined;
    }
    //#endregion

    //#region components
    /**
     * Per-turn cost label, rendered in the assistant reply's icon-action row.
     * Only shows once the reply carries billed token usage (i.e. the turn is
     * finished). Priced with the active model's vendor rates; re-renders
     * when the registry or the active model changes. The actual deduction
     * for local-accounting vendors happens host-side (it sees every session,
     * parallel conversations included); this label is purely the per-turn
     * display.
     */
    function TurnCostLabel({ messageId, useSession }) {
      const usage = useSession((snapshot) => {
        const nodes = snapshot?.chat?.nodes ?? snapshot?.nodes;
        return usageSumByTurn(nodes, messageId);
      });
      React.useSyncExternalStore(subscribeStore, getStoreSnapshot);
      React.useSyncExternalStore(subscribeActive, getActiveSnapshot);

      if (usage === undefined) return null;
      const source = getActiveSnapshot().source;
      const mode = pricingFor(source, usage.time);
      const info = computeCostInfo(usage.sum, mode.rates);
      const label = info === null ? null : formatYuan(info.cost);
      if (label === null) return null;
      // Tooltip: cache hit rate + total tokens consumed only, in K tok / M tok
      // (same units as the DeepSeek usage page), with no punctuation between
      // the two figures (reasoning tokens are inside outputTokens, so total =
      // totalInput + output).
      const totalTokens = info.totalInput + info.output;
      const hitRateText = `${(info.hitRate * 100).toFixed(1)}%`;
      const tokensText = formatTokens(totalTokens);
      return React.createElement(
        "span",
        { className: "dab-cost", title: `缓存命中率 ${hitRateText} 消耗 ${tokensText}` },
        `本轮 ${label}`
      );
    }

    /**
     * Add/edit form for one vendor: display name and a balance source —
     * remote endpoint (URL + credential name), local accounting (a total
     * amount shared by all of the vendor's models), or none.
     */
    function VendorForm({ initial, onSave, onCancel }) {
      const vendor = initial !== null && initial !== undefined ? initial : null;
      const [values, setValues] = React.useState(() => ({
        label: vendor?.label ?? "",
        balanceUrl: vendor?.balance?.url ?? "",
        credential: vendor?.balance?.credential ?? "",
        localBalance: vendor?.localBalance === null || vendor?.localBalance === undefined ? "" : String(vendor.localBalance),
      }));
      const [error, setError] = React.useState(null);
      const [spentInfo, setSpentInfo] = React.useState(null);
      React.useEffect(() => {
        if (vendor === null || vendor.localBalance === null || vendor.localBalance === undefined) {
          setSpentInfo(null);
          return;
        }
        let aliveForm = true;
        callApi({ method: "getLocalBalance", vendorId: vendor.id }).then((value) => {
          if (aliveForm && value !== null && typeof value === "object" && value.ok === true) {
            setSpentInfo(Number.isFinite(value.spent) ? value.spent : 0);
          }
        }).catch(() => { /* keep the previous display */ });
        return () => { aliveForm = false; };
      }, [vendor]);
      const setField = (key) => (event) => {
        setValues((value) => ({ ...value, [key]: event.target.value }));
        if (error !== null) setError(null);
      };
      const resetSpent = () => {
        callApi({ method: "resetLocalBalance", vendorId: vendor.id }).then((value) => {
          if (value !== null && typeof value === "object" && value.ok === true) setSpentInfo(0);
        }).catch(() => {});
      };

      const save = () => {
        const label = values.label.trim();
        if (label.length === 0) { setError("请填写「显示名」"); return; }
        const balanceUrl = values.balanceUrl.trim();
        if (balanceUrl.length > 0 && !/^https?:\/\//i.test(balanceUrl)) {
          setError("余额接口地址必须以 http:// 或 https:// 开头");
          return;
        }
        const localText = values.localBalance.trim();
        let localBalance = null;
        if (localText.length > 0) {
          const local = Number(localText);
          if (!Number.isFinite(local) || local < 0) {
            setError("本地记账总金额必须是 ≥ 0 的数字");
            return;
          }
          localBalance = local;
        }
        const credential = values.credential.trim();
        onSave({
          id: vendor?.id ?? makeId(),
          label,
          balance: balanceUrl.length > 0 ? { url: balanceUrl, credential: credential.length > 0 ? credential : "DEEPSEEK_API_KEY" } : null,
          localBalance,
        });
      };

      const spent = spentInfo === null ? 0 : spentInfo;
      const remaining = vendor !== null && vendor.localBalance !== null && vendor.localBalance !== undefined
        ? vendor.localBalance - spent
        : null;
      const numberFieldProps = { className: "dab-field-input", type: "number", min: "0", step: "0.01", inputMode: "decimal" };
      return React.createElement(
        "div",
        { className: "dab-dialog", role: "dialog", "aria-label": vendor === null ? "添加供应商" : "编辑供应商", onClick: (event) => { event.stopPropagation(); } },
        React.createElement("div", { className: "dab-dialog-title" }, vendor === null ? "添加供应商" : `编辑「${vendor.label}」`),
        React.createElement(
          "div",
          { className: "dab-dialog-sub" },
          "一个供应商可挂多个模型，它们共用这里的余额来源；本地记账时所有模型从同一个总金额扣减。"
        ),
        React.createElement(
          "div",
          { className: "dab-fields" },
          React.createElement("label", { key: "label", className: "dab-field dab-field-full" },
            React.createElement("span", { className: "dab-field-label" }, "显示名"),
            React.createElement("input", { className: "dab-field-input", type: "text", value: values.label, onChange: setField("label"), placeholder: "如：我的供应商" })),
          React.createElement("label", { key: "balanceUrl", className: "dab-field dab-field-full" },
            React.createElement("span", { className: "dab-field-label" }, "余额查询接口（可选）"),
            React.createElement("input", { className: "dab-field-input", type: "text", value: values.balanceUrl, onChange: setField("balanceUrl"), placeholder: "https://…（返回 balance 或 balance_infos 的 JSON）" }),
            React.createElement("span", { className: "dab-field-hint" }, "供应商有余额接口时填这里（优先于本地记账）。返回 {\"balance\": 12.34} 或 DeepSeek 风格 balance_infos。")),
          React.createElement("label", { key: "credential", className: "dab-field dab-field-full" },
            React.createElement("span", { className: "dab-field-label" }, "凭据名（可选）"),
            React.createElement("input", { className: "dab-field-input", type: "text", value: values.credential, onChange: setField("credential") }),
            React.createElement("span", { className: "dab-field-hint" }, "在 ~/.dsh/.credentials.yaml 中配置的 key 名称；默认 DEEPSEEK_API_KEY。Key 不会写入浏览器。")),
          React.createElement("label", { key: "localBalance", className: "dab-field dab-field-full" },
            React.createElement("span", { className: "dab-field-label" }, "本地记账总金额（可选，该供应商所有模型共用）"),
            React.createElement("input", { ...numberFieldProps, value: values.localBalance, onChange: setField("localBalance"), placeholder: "如：100" }),
            React.createElement("span", { className: "dab-field-hint" }, "供应商没有余额接口时填初始总金额；余额 = 总金额 − 所有会话中该供应商各模型的本轮费用，单击余额徽章刷新。"))
        ),
        vendor !== null && vendor.localBalance !== null && vendor.localBalance !== undefined
          ? React.createElement(
              "div",
              { className: "dab-actions" },
              React.createElement(
                "div",
                { className: "dab-dialog-sub", style: { flex: 1, textAlign: "left" } },
                `已扣 ¥${formatAmount(spent)} · 剩余 ¥${formatAmount(remaining)}`
              ),
              spent > 0
                ? React.createElement("button", { type: "button", className: "dab-btn dab-btn-danger", onClick: resetSpent }, "重置已扣费用")
                : null
            )
          : null,
        error === null ? null : React.createElement("div", { className: "dab-error" }, error),
        React.createElement(
          "div",
          { className: "dab-actions" },
          React.createElement("button", { type: "button", className: "dab-btn dab-btn-ghost", onClick: onCancel }, "取消"),
          React.createElement("button", { type: "button", className: "dab-btn dab-btn-primary", onClick: save }, vendor === null ? "添加" : "保存")
        )
      );
    }

    /**
     * Add/edit form for one model under a vendor: model match id plus the
     * four rates (CNY per 1M tokens).
     */
    function ModelForm({ initial, vendorId, vendorLabel, onSave, onCancel }) {
      const model = initial !== null && initial !== undefined ? initial : null;
      const [values, setValues] = React.useState(() => ({
        match: model?.match ?? "",
        input: model === null ? "" : String(model.rates.input),
        output: model === null ? "" : String(model.rates.output),
        cacheRead: model === null ? "" : String(model.rates.cacheRead),
        cacheWrite: model === null ? "" : String(model.rates.cacheWrite),
      }));
      const [error, setError] = React.useState(null);
      const setField = (key) => (event) => {
        setValues((value) => ({ ...value, [key]: event.target.value }));
        if (error !== null) setError(null);
      };

      const save = () => {
        const match = values.match.trim();
        if (match.length === 0) { setError("请填写「模型标识」"); return; }
        const rates = {};
        for (const field of PRICE_FIELDS) {
          const number = Number(values[field.key]);
          if (!Number.isFinite(number) || number < 0) {
            setError(`「${field.label}」必须是 ≥ 0 的数字（元 / 百万 tokens）`);
            return;
          }
          rates[field.key] = number;
        }
        onSave({
          id: model?.id ?? makeId(),
          vendorId: model?.vendorId ?? vendorId ?? "",
          match,
          rates,
        });
      };

      const numberFieldProps = { className: "dab-field-input", type: "number", min: "0", step: "0.01", inputMode: "decimal" };
      return React.createElement(
        "div",
        { className: "dab-dialog", role: "dialog", "aria-label": model === null ? "添加模型" : "编辑模型", onClick: (event) => { event.stopPropagation(); } },
        React.createElement("div", { className: "dab-dialog-title" }, model === null ? `添加模型（${vendorLabel}）` : `编辑模型（${vendorLabel}）`),
        React.createElement(
          "div",
          { className: "dab-dialog-sub" },
          "模型标识填写会话里显示的模型 id（如 provider/model 或 model；填 * 匹配该供应商下所有未单独配置的第三方模型）。"
        ),
        React.createElement(
          "div",
          { className: "dab-fields" },
          React.createElement("label", { key: "match", className: "dab-field dab-field-full" },
            React.createElement("span", { className: "dab-field-label" }, "模型标识"),
            React.createElement("input", { className: "dab-field-input", type: "text", value: values.match, onChange: setField("match"), placeholder: "provider/model 或 model，或 *" })),
          ...PRICE_FIELDS.map((field) =>
            React.createElement("label", { key: field.key, className: "dab-field" },
              React.createElement("span", { className: "dab-field-label" }, field.label),
              React.createElement("input", { ...numberFieldProps, value: values[field.key], onChange: setField(field.key) }),
              React.createElement("span", { className: "dab-field-hint" }, field.hint))
          )
        ),
        error === null ? null : React.createElement("div", { className: "dab-error" }, error),
        React.createElement(
          "div",
          { className: "dab-actions" },
          React.createElement("button", { type: "button", className: "dab-btn dab-btn-ghost", onClick: onCancel }, "取消"),
          React.createElement("button", { type: "button", className: "dab-btn dab-btn-primary", onClick: save }, model === null ? "添加" : "保存")
        )
      );
    }

    /**
     * One vendor's local-accounting summary line (总金额 · 已用 · 剩余),
     * fetched from the host ledger.
     */
    function VendorSpentLine({ vendor }) {
      const [spentInfo, setSpentInfo] = React.useState(null);
      React.useEffect(() => {
        let aliveLine = true;
        callApi({ method: "getLocalBalance", vendorId: vendor.id }).then((value) => {
          if (aliveLine && value !== null && typeof value === "object" && value.ok === true) {
            setSpentInfo(Number.isFinite(value.spent) ? value.spent : 0);
          }
        }).catch(() => {});
        return () => { aliveLine = false; };
      }, [vendor]);
      const spent = spentInfo === null ? 0 : spentInfo;
      return React.createElement(
        "div",
        { className: "dab-vendor-meta" },
        `总金额 ¥${formatAmount(vendor.localBalance)} · 已用 ¥${formatAmount(spent)} · 剩余 ¥${formatAmount(vendor.localBalance - spent)}`
      );
    }

    /**
     * The current session vendor's balance, same source and math as the
     * badge: official/remote endpoint via `getBalance`, local accounting via
     * the host ledger, or a 未配置 placeholder. `tick` forces a re-fetch so
     * an open panel stays in sync while the conversation keeps running.
     * @param matched - `{ vendor, model }` from `vendorFor(activeSource)`,
     * or null for the official route.
     */
    function CurrentBalanceLine({ matched, tick }) {
      const [text, setText] = React.useState("…");
      const vendor = matched === null ? null : matched.vendor;
      const depKey = matched === null ? "official" : matched.vendor.id;
      React.useEffect(() => {
        let aliveLine = true;
        const set = (value) => { if (aliveLine) setText(value); };
        const renderRemote = (value) => {
          if (value !== null && typeof value === "object" && value.ok === true) {
            const entry = value.cny !== null && value.cny !== undefined ? value.cny
              : Array.isArray(value.currencies) && value.currencies.length > 0 ? value.currencies[0] : null;
            const total = entry === null ? null : typeof entry.total === "string" ? entry.total : String(entry.total);
            const isCny = entry === null || entry.currency === undefined || entry.currency === "CNY";
            set(`${isCny ? "¥" : currencySymbol(entry.currency)}${total ?? "—"}`);
          } else {
            set("查询失败");
          }
        };
        if (matched === null || vendor === null) {
          callApi({ method: "getBalance", provider: null }).then(renderRemote).catch(() => set("—"));
          return () => { aliveLine = false; };
        }
        if (vendor.balance !== null && vendor.balance.url !== "") {
          callApi({ method: "getBalance", provider: vendor.balance }).then(renderRemote).catch(() => set("—"));
          return () => { aliveLine = false; };
        }
        if (vendor.localBalance !== null && vendor.localBalance !== undefined) {
          callApi({ method: "getLocalBalance", vendorId: vendor.id }).then((value) => {
            const spent = value !== null && typeof value === "object" && value.ok === true && Number.isFinite(value.spent)
              ? value.spent
              : 0;
            set(`¥${formatAmount(vendor.localBalance - spent)}`);
          }).catch(() => set("—"));
          return () => { aliveLine = false; };
        }
        set("未配置余额来源");
        return () => {};
      }, [depKey, tick]);
      return React.createElement("span", null, text);
    }

    /**
     * Vendor/model pricing manager: the built-in DeepSeek official route
     * plus user vendors (each with its models), add / edit / delete for
     * both levels. Opened by double-clicking the balance badge.
     */
    function ProviderManager({ onClose, sessionId, liveModel }) {
      const [view, setView] = React.useState({ kind: "list" });
      const [balanceTick, setBalanceTick] = React.useState(0);
      React.useSyncExternalStore(subscribeStore, getStoreSnapshot);
      React.useSyncExternalStore(subscribeActive, getActiveSnapshot);

      React.useEffect(() => {
        const onKey = (event) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => { window.removeEventListener("keydown", onKey); };
      }, [onClose]);

      // Keep the panel in sync with the current session while it is open:
      // poll the session's own model immediately on open and then on a short
      // interval (switching sessions/models updates the header line and the
      // 「当前」 markers within seconds instead of waiting for the badge's
      // longer poll), and bump the balance tick so the shown balance
      // re-fetches even when the model did not change. The LIVE selection
      // (same `session.models` RPC the composer selector shows) is used when
      // the badge handed it down, so a fresh switch is never overwritten by
      // the stale request-header fallback.
      React.useEffect(() => {
        const poll = () => {
          const queryLive = () => {
            if (typeof liveModel === "function") {
              return liveModel().then((response) => {
                const current = response !== null && typeof response === "object" && response.result?.ok === true
                  ? response.result.value?.current
                  : undefined;
                if (current !== null && current !== undefined
                  && typeof current.provider === "string" && current.provider.length > 0
                  && typeof current.model === "string" && current.model.length > 0) {
                  return { provider: current.provider, model: current.model };
                }
                return null;
              }).catch(() => null);
            }
            return callApi({ method: "getSessionModel", sessionId }).then((modelValue) => {
              if (modelValue !== null && typeof modelValue === "object" && modelValue.ok === true
                && typeof modelValue.provider === "string" && modelValue.provider.length > 0
                && typeof modelValue.model === "string" && modelValue.model.length > 0) {
                return { provider: modelValue.provider, model: modelValue.model };
              }
              return null;
            }).catch(() => null);
          };
          queryLive().then((source) => {
            const current = getActiveSnapshot().source;
            const changed = (source === null) !== (current === null)
              || (source !== null && current !== null && (source.provider !== current.provider || source.model !== current.model));
            if (changed) setActiveSource(source);
          }).catch(() => { /* keep the previous model on transient errors */ });
          setBalanceTick((tick) => tick + 1);
        };
        poll();
        const timer = setInterval(poll, PANEL_POLL_MS);
        return () => { clearInterval(timer); };
      }, [sessionId, liveModel]);

      const handleSaveVendor = (vendor) => {
        upsertVendor(vendor);
        setView({ kind: "list" });
      };
      const handleSaveModel = (model) => {
        upsertModel(model);
        setView({ kind: "list" });
      };
      const handleDeleteVendor = (vendor) => {
        if (!window.confirm(`删除供应商「${vendor.label}」及其所有模型？`)) return;
        deleteVendor(vendor.id);
      };
      const handleDeleteModel = (model) => {
        if (!window.confirm(`删除模型「${model.match}」？`)) return;
        deleteModel(model.id);
      };

      if (view.kind === "vendorForm") {
        return ReactDOM.createPortal(
          React.createElement(
            "div",
            { className: "dab-overlay", onClick: onClose },
            React.createElement(VendorForm, { initial: view.vendor, onSave: handleSaveVendor, onCancel: () => { setView({ kind: "list" }); } })
          ),
          document.body
        );
      }
      if (view.kind === "modelForm") {
        return ReactDOM.createPortal(
          React.createElement(
            "div",
            { className: "dab-overlay", onClick: onClose },
            React.createElement(ModelForm, { initial: view.model, vendorId: view.vendor.id, vendorLabel: view.vendor.label, onSave: handleSaveModel, onCancel: () => { setView({ kind: "list" }); } })
          ),
          document.body
        );
      }

      const { vendors, models } = getStoreSnapshot();
      // Current session's vendor (matches what the badge shows).
      const activeSource = getActiveSnapshot().source;
      const activeMatched = activeSource === null ? null : vendorFor(activeSource);
      const officialActive = activeSource !== null && activeMatched === null;
      const currentLabel = activeSource === null ? "未知" : (activeMatched === null ? "官方" : activeMatched.vendor.label);
      return ReactDOM.createPortal(
        React.createElement(
          "div",
          { className: "dab-overlay", onClick: onClose },
          React.createElement(
            "div",
            { className: "dab-dialog", role: "dialog", "aria-label": "模型计费管理", onClick: (event) => { event.stopPropagation(); } },
            React.createElement("div", { className: "dab-dialog-title" }, "模型计费管理"),
            React.createElement(
              "div",
              { className: "dab-dialog-sub" },
              "当前会话使用：",
              currentLabel,
              " · 余额 ",
              React.createElement(CurrentBalanceLine, { matched: activeMatched, tick: balanceTick }),
              "。一个供应商下可挂多个模型，共用同一份余额（本地记账时共用一个总金额）。DeepSeek 官方为内置默认，不可编辑。"
            ),
            React.createElement(
              "div",
              { className: "dab-list" },
              React.createElement(
                "div",
                { className: "dab-row", "data-current": officialActive ? "1" : "0" },
                React.createElement(
                  "div",
                  { className: "dab-row-main" },
                  React.createElement("div", { className: "dab-row-title" }, "DeepSeek 官方（内置）", officialActive ? React.createElement("span", { className: "dab-current" }, "当前") : null),
                  React.createElement("div", { className: "dab-row-meta" }, "峰谷定价（高峰 9:00–12:00、14:00–18:00 北京时间）· 官方余额接口 · 不可编辑")
                )
              ),
              ...vendors.map((vendor) => {
                const vendorModels = models.filter((model) => model.vendorId === vendor.id);
                const hasRemote = vendor.balance !== null && vendor.balance.url !== "";
                const hasLocal = vendor.localBalance !== null && vendor.localBalance !== undefined;
                const isCurrent = activeMatched !== null && activeMatched.vendor.id === vendor.id;
                const sourceText = hasRemote ? "余额接口"
                  : hasLocal ? "本地记账"
                  : "不显示余额";
                return React.createElement(
                  "div",
                  { key: vendor.id, className: "dab-vendor", "data-current": isCurrent ? "1" : "0" },
                  React.createElement(
                    "div",
                    { className: "dab-vendor-head" },
                    React.createElement(
                      "div",
                      { className: "dab-vendor-main" },
                      React.createElement("div", { className: "dab-vendor-title" }, vendor.label, isCurrent ? React.createElement("span", { className: "dab-current" }, "当前") : null),
                      hasLocal && !hasRemote
                        ? React.createElement(VendorSpentLine, { vendor })
                        : React.createElement("div", { className: "dab-vendor-meta" }, sourceText)
                    ),
                    React.createElement(
                      "div",
                      { className: "dab-row-actions" },
                      React.createElement("button", { type: "button", className: "dab-btn dab-btn-ghost", onClick: () => { setView({ kind: "vendorForm", vendor }); } }, "编辑"),
                      React.createElement("button", { type: "button", className: "dab-btn dab-btn-danger", onClick: () => { handleDeleteVendor(vendor); } }, "删除"),
                      React.createElement("button", { type: "button", className: "dab-btn dab-btn-primary", onClick: () => { setView({ kind: "modelForm", vendor, model: null }); } }, "添加模型")
                    )
                  ),
                  vendorModels.length === 0
                    ? React.createElement("div", { className: "dab-vendor-meta", style: { paddingLeft: 10 } }, "尚未添加模型。")
                    : React.createElement(
                        "div",
                        { className: "dab-vendor-models" },
                        ...vendorModels.map((model) =>
                          React.createElement(
                            "div",
                            { key: model.id, className: "dab-row" },
                            React.createElement(
                              "div",
                              { className: "dab-row-main" },
                              React.createElement("div", { className: "dab-row-title" }, model.match),
                              React.createElement(
                                "div",
                                { className: "dab-row-meta" },
                                `输入 ${model.rates.input} / 输出 ${model.rates.output} / 缓存读 ${model.rates.cacheRead} / 缓存写 ${model.rates.cacheWrite} 元每百万 tokens`
                              )
                            ),
                            React.createElement(
                              "div",
                              { className: "dab-row-actions" },
                              React.createElement("button", { type: "button", className: "dab-btn dab-btn-ghost", onClick: () => { setView({ kind: "modelForm", vendor, model }); } }, "编辑"),
                              React.createElement("button", { type: "button", className: "dab-btn dab-btn-danger", onClick: () => { handleDeleteModel(model); } }, "删除")
                            )
                          )
                        )
                      )
                );
              }),
              vendors.length === 0 ? React.createElement("div", { className: "dab-dialog-sub" }, "尚未配置第三方供应商。") : null
            ),
            React.createElement(
              "div",
              { className: "dab-actions" },
              React.createElement("button", { type: "button", className: "dab-btn dab-btn-primary", onClick: () => { setView({ kind: "vendorForm", vendor: null }); } }, "添加供应商"),
              React.createElement("button", { type: "button", className: "dab-btn dab-btn-ghost", onClick: onClose }, "关闭")
            )
          )
        ),
        document.body
      );
    }

    /**
     * Account balance badge in the session header action row. Reads the
     * harness's active model, resolves it to a vendor (official or
     * third-party), and shows that vendor's balance — remote endpoint when
     * configured, otherwise host local accounting (total minus every
     * recorded turn across all sessions) when the vendor has a total,
     * otherwise `余额 —`. Single click re-fetches live; double click opens
     * the vendor/model pricing manager; the active model is re-checked on an
     * interval so switching models in the composer syncs the badge
     * automatically.
     */
    function BalanceBadge({ sessionId, liveModel }) {
      const [state, setState] = React.useState({ status: "loading", source: null, sessionId });
      const [todayByProvider, setTodayByProvider] = React.useState(null);
      const [panelOpen, setPanelOpen] = React.useState(false);
      const alive = React.useRef(true);
      const requestId = React.useRef(0);
      const clickTimer = React.useRef(null);
      // The slot may re-create the `liveModel` closure each render; keep the
      // latest in a ref so `load`'s identity stays stable per session.
      const liveModelRef = React.useRef(liveModel);
      liveModelRef.current = liveModel;
      // Latest state for render-free reads inside async `load` (deciding
      // whether a model switch stayed on the same provider).
      const stateRef = React.useRef(state);
      stateRef.current = state;
      React.useEffect(() => () => {
        alive.current = false;
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
      }, []);
      React.useSyncExternalStore(subscribeStore, getStoreSnapshot);
      React.useSyncExternalStore(subscribeActive, getActiveSnapshot);

      // While a session switch is in flight (state still carries the previous
      // session's vendor), render as loading instead of flashing the OLD
      // vendor's balance / 今日消耗. No state writes happen during render.
      const staleSession = state.sessionId !== sessionId;

      // Make sure the host holds the current local-accounting tables
      // (covers a browser-side storage reset or a host restart).
      React.useEffect(() => { syncToHost(); }, []);

      // Resolve the session's model. The LIVE selection (core
      // `session.models`, injected through the slot) is authoritative and
      // reflects a just-made vendor switch immediately; the plugin API is
      // the fallback when the slot did not provide it.
      const queryLiveModel = React.useCallback(() => {
        if (typeof liveModelRef.current === "function") {
          return liveModelRef.current().then((response) => {
            const current = response !== null && typeof response === "object" && response.result?.ok === true
              ? response.result.value?.current
              : undefined;
            if (current !== null && current !== undefined
              && typeof current.provider === "string" && current.provider.length > 0
              && typeof current.model === "string" && current.model.length > 0) {
              return { provider: current.provider, model: current.model };
            }
            return null;
          }).catch(() => null);
        }
        return callApi({ method: "getSessionModel", sessionId }).then((modelValue) => {
          if (modelValue !== null && typeof modelValue === "object" && modelValue.ok === true
            && typeof modelValue.provider === "string" && modelValue.provider.length > 0
            && typeof modelValue.model === "string" && modelValue.model.length > 0) {
            return { provider: modelValue.provider, model: modelValue.model };
          }
          return null;
        }).catch(() => null);
      }, [sessionId]);

      const load = React.useCallback((force, quiet = false) => {
        const id = requestId.current + 1;
        requestId.current = id;
        if (!quiet) setState((current) => ({ status: "loading", previous: current.label, detail: current.detail, source: current.source, sessionId }));
        queryLiveModel().then((source) => {
          if (!alive.current || requestId.current !== id) return;
          setActiveSource(source);
          // Switching between MODELS OF THE SAME PROVIDER (e.g. two models
          // under soullens) must not change the panel at all: the balance
          // and the per-provider 今日消耗 already belong to that vendor.
          // Automatic refreshes (model-change event / polling, quiet=true)
          // therefore keep the panel as-is; an explicit refresh click
          // re-queries, and provider switches (or a fresh session) take the
          // full refresh path below.
          const previous = stateRef.current.source;
          const sameProvider = quiet && previous !== null && previous !== undefined && source !== null
            && previous.provider === source.provider;
          if (sameProvider) {
            setState((current) => ({ ...current, source, sessionId }));
            return;
          }
          // Today's token consumption per provider (host-side ledger, all
          // sessions/models), refreshed only when the vendor actually
          // changed, so the tooltip shows the CURRENT vendor's own 今日消耗.
          callApi({ method: "getTodayUsage" }).then((value) => {
            if (!alive.current || requestId.current !== id) return;
            if (value !== null && typeof value === "object" && value.ok === true
              && value.byProvider !== null && typeof value.byProvider === "object") {
              setTodayByProvider(value.byProvider);
            }
          }).catch(() => { /* keep the previous today totals */ });
          const matched = vendorFor(source);
          const vendor = matched === null ? null : matched.vendor;
          // Official route label follows the peak/off-peak window (Beijing
          // time, same clock as the DeepSeek official pricing page).
          const providerLabel = vendor === null ? (isPeakWindow(Date.now()) ? "高峰" : "闲时") : vendor.label;
          const noBalanceSource = vendor !== null
            && (vendor.balance === null || vendor.balance.url === "")
            && (vendor.localBalance === null || vendor.localBalance === undefined);
          if (noBalanceSource) {
            setState({ status: "ready", label: `余额（${providerLabel}）—`, detail: "未配置余额来源", providerLabel, source, sessionId });
            return;
          }
          const localMode = vendor !== null
            && (vendor.localBalance !== null && vendor.localBalance !== undefined)
            && (vendor.balance === null || vendor.balance.url === "");
          if (localMode) {
            // Host-side ledger: every settled turn across ALL sessions has
            // been recorded by the host, so this refresh returns the live
            // total − (turn 1 + turn 2 + …) at the moment of the click.
            return callApi({ method: "getLocalBalance", vendorId: vendor.id }).then((value) => {
              if (!alive.current || requestId.current !== id) return;
              const spent = value !== null && typeof value === "object" && value.ok === true && Number.isFinite(value.spent)
                ? value.spent
                : 0;
              const remaining = vendor.localBalance - spent;
              setState({
                status: "ready",
                label: `余额（${providerLabel}）¥${formatAmount(remaining)}`,
                detail: `总金额 ¥${formatAmount(vendor.localBalance)} 已用 ¥${formatAmount(spent)}`,
                providerLabel,
                source,
                sessionId,
              });
            });
          }
          const balanceSpec = vendor === null ? null : (vendor.balance ?? null);
          return callApi({ method: "getBalance", force: force === true, provider: balanceSpec }).then((value) => {
            if (!alive.current || requestId.current !== id) return;
            if (value !== null && typeof value === "object" && value.ok === true) {
              const entry = value.cny !== null && value.cny !== undefined ? value.cny
                : Array.isArray(value.currencies) && value.currencies.length > 0 ? value.currencies[0] : null;
              const total = entry === null ? null : typeof entry.total === "string" ? entry.total : String(entry.total);
              const isCny = entry === null || entry.currency === undefined || entry.currency === "CNY";
              const currency = isCny ? "¥" : currencySymbol(entry.currency);
              const label = total === null ? `余额（${providerLabel}）—` : `余额（${providerLabel}）${currency}${total}`;
              setState({ status: "ready", label, detail: "", providerLabel, source, sessionId });
              return;
            }
            const message = value !== null && typeof value === "object" && typeof value.message === "string" ? value.message : "余额查询失败";
            setState({ status: "error", label: `余额（${providerLabel}）—`, detail: message, providerLabel, source, sessionId });
          });
        }).catch(() => {
          if (!alive.current || requestId.current !== id) return;
          setState((current) => ({ status: "error", label: current.previous ?? "余额 —", detail: current.detail ?? "网络请求失败，单击重试", providerLabel: current.providerLabel, source: current.source ?? null, sessionId }));
        });
      }, [sessionId, queryLiveModel]);
      React.useEffect(() => { load(false); }, [load]);

      // Re-check the active model periodically so switching models in the
      // composer syncs the badge and the per-turn pricing without a refresh.
      React.useEffect(() => {
        const timer = setInterval(() => {
          if (!alive.current) return;
          queryLiveModel().then((source) => {
            if (!alive.current) return;
            const current = getActiveSnapshot().source;
            const changed = (source === null) !== (current === null)
              || (source !== null && current !== null && (source.provider !== current.provider || source.model !== current.model));
            if (changed) {
              setActiveSource(source);
              load(true, true);
            }
          }).catch(() => { /* keep the previous model on transient errors */ });
        }, ACTIVE_MODEL_POLL_MS);
        return () => { clearInterval(timer); };
      }, [load, queryLiveModel]);

      // React immediately to a model/vendor switch in this session: the host
      // raises settings/document-updated after selectModel persists the new
      // selection, so re-read the session model + per-provider today totals
      // instead of waiting for the polling interval. (Declared after `load` —
      // the dependency array evaluates during render.)
      React.useEffect(() => {
        return subscribeModelChanged(() => {
          if (alive.current) load(true, true);
        });
      }, [load]);

      const onSingleClick = () => {
        if (clickTimer.current !== null) clearTimeout(clickTimer.current);
        clickTimer.current = setTimeout(() => {
          clickTimer.current = null;
          load(true);
        }, CLICK_DEBOUNCE_MS);
      };
      const onDoubleClick = (event) => {
        if (clickTimer.current !== null) {
          clearTimeout(clickTimer.current);
          clickTimer.current = null;
        }
        event.preventDefault();
        setPanelOpen(true);
      };

      const hint = state.status === "error" ? "单击重试 双击管理模型计费" : "单击刷新 双击管理模型计费";
      const detailText = state.detail ?? "";
      // While the badge still carries the PREVIOUS session's vendor data,
      // render as loading: never flash the old vendor's balance / 今日消耗.
      const currentSource = staleSession ? null : (state.source ?? null);
      const currentProvider = currentSource === null ? null : currentSource.provider;
      // The current provider may have NO entry in today's per-provider map
      // (e.g. a vendor never used today) — `?? null` covers both null and
      // undefined so the count below never dereferences a missing bucket.
      const todayDay = todayByProvider === null || todayByProvider === undefined || currentProvider === null
        ? null
        : todayByProvider[currentProvider] ?? null;
      const todayTotal = todayDay === null ? null
        : (Number.isFinite(todayDay.input) ? todayDay.input : 0)
          + (Number.isFinite(todayDay.output) ? todayDay.output : 0)
          + (Number.isFinite(todayDay.cacheRead) ? todayDay.cacheRead : 0)
          + (Number.isFinite(todayDay.cacheWrite) ? todayDay.cacheWrite : 0);
      const todayText = todayTotal === null ? "" : `今日消耗 ${formatTokens(todayTotal)}`;
      const loadingUnlabelled = staleSession || (state.status === "loading" && state.label === undefined);
      const title = loadingUnlabelled
        ? (todayText.length === 0 ? "正在查询余额…" : `${todayText} 正在查询余额…`)
        : `${todayText}${todayText.length === 0 ? "" : " "}${detailText.length === 0 ? hint : `${detailText} ${hint}`}`;
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "button",
          {
            type: "button",
            className: "dab-badge",
            "aria-label": title,
            title,
            onClick: onSingleClick,
            onDoubleClick: onDoubleClick,
            disabled: loadingUnlabelled,
          },
          loadingUnlabelled ? "…" : state.label
        ),
        panelOpen ? React.createElement(ProviderManager, { onClose: () => { setPanelOpen(false); }, sessionId, liveModel }) : null
      );
    }

    /**
     * Error boundary around the badge slot: a render failure must never make
     * the balance panel disappear — it falls back to a retryable "余额 —"
     * chip and logs the real error to the console (where it can be read in
     * DevTools) instead of letting the slot entry be dropped.
     */
    class BadgeErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error, info) {
        console.error("[api-balance] balance badge render failed:", error, info);
      }
      render() {
        if (this.state.failed) {
          return React.createElement(
            "button",
            {
              type: "button",
              className: "dab-badge",
              title: "渲染出错，单击重试",
              onClick: () => { this.setState({ failed: false }); },
            },
            "余额 —"
          );
        }
        return this.props.children;
      }
    }

    /** Badge wrapped in its error boundary (the slot registers this). */
    function BalanceBadgeGuarded(props) {
      return React.createElement(BadgeErrorBoundary, null, React.createElement(BalanceBadge, props));
    }
    //#endregion

    //#region apply
    // `remote` must be declared here: the model-change signal subscribes
    // `ctx.remote.$on`, and cordis rejects undeclared context properties.
    // `connection` feeds the badge the LIVE session selection (the same
    // `session.models` RPC the composer selector renders), so a just-made
    // model/vendor switch is reflected without waiting for any host reload.
    const inject = ["slots", "sessions", "remote", "connection"];

    function apply(ctx) {
      const connection = ctx.connection ?? ctx.get("connection");
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

      // Account balance badge in the session header action row (wrapped in
      // an error boundary so a render failure can never drop the panel).
      // `liveModel` hands the badge the session's LIVE selection from the
      // core `session.models` RPC — the same source the composer selector
      // shows — so switching to another provider's model updates the balance
      // and per-vendor 今日消耗 immediately.
      ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
        name: "conversation.session.header.actions",
        id: "api-balance-badge",
        order: 90,
        inject: (sessionId) => ({
          liveModel: () => connection.api.sessions.models({ sessionId }),
        }),
      }, BalanceBadgeGuarded));

      // Forward host model/settings-change events to the badge so switching
      // vendors inside a session updates the balance panel (including the
      // per-vendor 今日消耗) immediately. `remote` is declared in `inject`
      // below — cordis forbids touching an undeclared context property.
      ctx.effect(() => {
        const remote = ctx.remote ?? ctx.get("remote");
        if (remote === undefined || typeof remote.$on !== "function") return () => {};
        const offSettings = remote.$on("settings/document-updated", notifyModelChanged);
        const offAdapters = remote.$on("llm/adapters-updated", notifyModelChanged);
        return () => {
          try { if (typeof offSettings === "function") offSettings(); } catch { /* best effort */ }
          try { if (typeof offAdapters === "function") offAdapters(); } catch { /* best effort */ }
        };
      }, "api-balance: model-change signal");
    }
    //#endregion

    exports.inject = inject;
    exports.apply = apply;

    return module.exports;
  }
});
