/**
 * dsh-api-balance — host-side balance & pricing domain.
 *
 * The DeepSeek official account-balance endpoint
 * (`GET https://api.deepseek.com/user/balance`) returns the remaining
 * topped-up/granted balance in CNY. This module resolves API keys from the
 * harness credentials service (the same `DEEPSEEK_API_KEY` the Models page
 * writes) and can query **any** third-party provider balance endpoint the
 * browser half configures (URL + credential name travel in the request body;
 * the key itself never leaves the host). Responses are normalized from both
 * the DeepSeek `balance_infos` shape and the generic `{ balance, currency }`
 * shape. A short in-memory cache is keyed per endpoint and bypassed when the
 * browser half asks for an explicit refresh. Keys never leak to the browser —
 * the response carries balances only.
 *
 * For providers without a balance endpoint the browser half can use **local
 * accounting**: the host subscribes to the global `session/event` stream and
 * records every settled assistant turn across ALL sessions (parallel
 * conversations included) that matches a local-accounting provider, pricing
 * it with that provider's rates. The remaining balance is therefore always
 * `total − (turn 1 + turn 2 + …)` computed at the moment the browser asks —
 * single-click refresh returns the freshest ledger. Provider price tables
 * (no secrets) and the ledger persist under
 * `$DSH_HOME/plugins/dsh-api-balance/state.json`.
 * @module dsh-api-balance/api
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

/** DeepSeek official balance endpoint. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance';

/** How long a successful balance answer is reused (milliseconds). */
const CACHE_TTL_MS = 60_000;

/** Default credential name when a provider config carries none. */
const DEFAULT_CREDENTIAL = 'DEEPSEEK_API_KEY';

/** In-memory balance cache: { key, at, payload }. */
let balanceCache = null;

/** Read a JSON request body (bounded, same contract as the harness helpers). */
export async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Reject cross-site browser requests. These routes can proxy credentials to a
 * configured balance URL and mutate the local ledger, so an arbitrary web
 * page must not be able to trigger them. Non-browser/internal requests may
 * omit Origin and remain supported.
 */
function sameOriginRequest(req) {
  const headers = req?.headers ?? {};
  const origin = headers.origin ?? headers.Origin;
  const fetchSite = headers['sec-fetch-site'] ?? headers['Sec-Fetch-Site'];
  if (typeof fetchSite === 'string' && fetchSite.toLowerCase() === 'cross-site') return false;
  if (origin === undefined || origin === '') return true;
  if (origin === 'null' || typeof origin !== 'string') return false;
  try {
    const parsed = new URL(origin);
    const host = headers.host ?? headers.Host;
    // DNS-rebinding hardening: the Host header's own hostname must be a
    // loopback name — otherwise a rebinding page could make its Origin match
    // Host while the connection actually lands on the harness. The only
    // accepted request is one whose Origin host:port EXACTLY equals the Host
    // header (any other loopback page, e.g. localhost:8000, is rejected).
    if (typeof host !== 'string' || host.length === 0) return false;
    let hostname = host;
    try { hostname = new URL(`http://${host}`).hostname; } catch { return false; }
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)) return false;
    return typeof host === 'string' && parsed.host === host
      && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

/** Write a JSON response. */
export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** A safe balance-provider spec: { url?, credential? } with sane shapes. */
function sanitizeProviderSpec(value) {
  if (value === null || typeof value !== 'object') return { url: '', credential: null };
  let url = typeof value.url === 'string' && value.url.trim().length > 0 ? value.url.trim() : '';
  if (url.length > 0 && !/^https?:\/\//i.test(url)) url = '';
  const credential = typeof value.credential === 'string' && value.credential.trim().length > 0
    ? value.credential.trim()
    : null;
  return { url, credential };
}

/**
 * Normalize a third-party balance response into the shared shape. Supports
 * the DeepSeek `balance_infos` list and the generic single-amount forms
 * (`{ balance }`, `{ data: { balance } }`, `total_balance`, etc.).
 * @param data - the parsed JSON body.
 * @returns the normalized summary, or null when nothing looks like a balance.
 */
function normalizeBalance(data) {
  if (data === null || typeof data !== 'object') return null;

  const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
  if (infos.length > 0) {
    const cny = infos.find((entry) => typeof entry?.currency === 'string' && entry.currency === 'CNY');
    const currencies = infos.map((entry) => ({
      currency: entry?.currency ?? '?',
      total: entry?.total_balance ?? '0',
      granted: entry?.granted_balance ?? '0',
      toppedUp: entry?.topped_up_balance ?? '0',
    }));
    return {
      isAvailable: data.is_available !== false,
      currencies,
      cny: cny === undefined ? null : {
        currency: 'CNY',
        total: cny.total_balance ?? '0',
        granted: cny.granted_balance ?? '0',
        toppedUp: cny.topped_up_balance ?? '0',
      },
    };
  }

  const inner = typeof data.data === 'object' && data.data !== null ? data.data : data;
  const amount = Number(inner?.balance ?? inner?.total_balance ?? inner?.available_balance ?? inner?.availableBalance);
  if (!Number.isFinite(amount)) return null;
  const currency = typeof inner?.currency === 'string' && inner.currency.length > 0 ? inner.currency : 'CNY';
  const entry = { currency, total: String(amount), granted: '0', toppedUp: '0' };
  return {
    isAvailable: true,
    currencies: [entry],
    cny: currency === 'CNY' ? entry : null,
  };
}

/**
 * Fetch an account balance in its native currency, from the DeepSeek official
 * endpoint by default or from a configured third-party endpoint.
 * Never throws: every failure is a `{ ok: false, error }` business result.
 * @param ctx - the host cordis context (credentials service).
 * @param options - `{ force?, provider? }`; `force` bypasses the cache,
 * `provider` carries `{ url, credential }` for a third-party endpoint.
 * @returns balance summary or a business error.
 */
export async function fetchBalance(ctx, options = {}) {
  const provider = sanitizeProviderSpec(options.provider);
  const credentialName = provider.credential ?? DEFAULT_CREDENTIAL;
  // Different credentials against the same provider URL must never share a
  // cached balance (otherwise one account can briefly display another's).
  const cacheKey = `${provider.url.length > 0 ? provider.url : BALANCE_URL}\u0000${credentialName}`;

  if (options.force !== true && balanceCache !== null && balanceCache.key === cacheKey && Date.now() - balanceCache.at < CACHE_TTL_MS) {
    return balanceCache.payload;
  }

  const credentials = ctx.get('credentials');
  if (credentials === undefined) {
    return { ok: false, error: 'credentials-unavailable', message: '凭据服务不可用' };
  }

  let key = undefined;
  try {
    const hit = await credentials.resolve(credentialName);
    key = hit?.value;
  } catch {
    /* resolve failure falls through to the missing-key error */
  }
  if (typeof key !== 'string' || key.length === 0) {
    return {
      ok: false,
      error: 'no-api-key',
      message: `未配置凭据 ${credentialName}（模型设置页或 ~/.dsh/.credentials.yaml）`,
    };
  }

  const url = provider.url.length > 0 ? provider.url : BALANCE_URL;
  let response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${key}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      ok: false,
      error: 'network',
      message: `余额查询失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    // Do not echo an upstream response body: providers sometimes include
    // sensitive request diagnostics or credential fragments in error JSON.
    return {
      ok: false,
      error: `http-${String(response.status)}`,
      message: `余额查询失败（HTTP ${String(response.status)}）`,
    };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'bad-response', message: '余额接口返回了无效数据' };
  }

  const normalized = normalizeBalance(data);
  if (normalized === null) {
    return { ok: false, error: 'bad-response', message: '余额接口返回的数据无法识别（需要 balance 或 balance_infos 字段）' };
  }

  const payload = { ok: true, ...normalized, at: Date.now() };
  balanceCache = { key: cacheKey, at: Date.now(), payload };
  return payload;
}

/**
 * Read the harness's current model selection (the same default the Models
 * settings page manages). The browser half uses it to pick which provider's
 * balance and pricing apply.
 * @param ctx - the host cordis context.
 * @returns `{ ok: true, provider, model }` or a business error.
 */
function getActiveModel(ctx) {
  const service = ctx.get('agentDefaultModel');
  const selection = typeof service?.currentSelection === 'function' ? service.currentSelection() : undefined;
  if (selection !== undefined && selection !== null
    && typeof selection.provider === 'string' && selection.provider.length > 0
    && typeof selection.model === 'string' && selection.model.length > 0) {
    return { ok: true, provider: selection.provider, model: selection.model };
  }
  return { ok: false, error: 'no-active-model', message: '无法读取当前模型选择（agentDefaultModel 服务不可用）' };
}

/**
 * Read the model of ONE session. Priority:
 *   1. the LIVE selection through the api-proxy (`session.models` →
 *      `current`) — the same source the composer selector shows, so a
 *      just-made switch to another provider/model is reflected IMMEDIATELY,
 *      before the next request updates the request header;
 *   2. the session's last logged `request/header` config — the model it
 *      actually ran (this is what switching sessions must reflect);
 *   3. the live agent's creation `options.provider/model`;
 *   4. the persisted session log's latest request header;
 *   5. the global default selection.
 * @param ctx - the host cordis context.
 * @param sessionId - the session (agent id) to look up.
 * @returns `{ ok: true, provider, model, source }` or a business error.
 */
async function getSessionModel(ctx, sessionId) {
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    try {
      const apiProxy = ctx.get('apiProxy');
      if (apiProxy !== undefined && typeof apiProxy.sessions?.models === 'function') {
        const response = await apiProxy.sessions.models({ rpcId: 'api-balance', payload: { sessionId } });
        const current = response?.result?.ok === true ? response.result.value?.current : undefined;
        if (current !== null && current !== undefined
          && typeof current.provider === 'string' && current.provider.length > 0
          && typeof current.model === 'string' && current.model.length > 0) {
          return { ok: true, provider: current.provider, model: current.model, source: 'live' };
        }
      }
    } catch {
      /* fall through to the header/log tiers */
    }
    try {
      const agents = ctx.get('agents');
      const agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined;
      const header = typeof agent?.session?.requestHeader === 'function' ? agent.session.requestHeader() : undefined;
      const config = header?.config;
      if (config !== undefined && config !== null
        && typeof config.provider === 'string' && config.provider.length > 0
        && typeof config.model === 'string' && config.model.length > 0) {
        return { ok: true, provider: config.provider, model: config.model, source: 'session' };
      }
      if (agent !== undefined && agent !== null
        && agent.options !== null && typeof agent.options === 'object'
        && typeof agent.options.provider === 'string' && agent.options.provider.length > 0
        && typeof agent.options.model === 'string' && agent.options.model.length > 0) {
        return { ok: true, provider: agent.options.provider, model: agent.options.model, source: 'session-options' };
      }
      const persistence = ctx.get('sessionPersistence');
      // `readFrom` (not `load`) keeps this query side-effect-free and fast:
      // no snapshot flush, no torn-tail repair, no open-turn rejection — the
      // badge must answer within a frame when the user switches sessions.
      if (typeof persistence?.readFrom === 'function') {
        const inspection = await persistence.readFrom(sessionId, 0);
        const events = Array.isArray(inspection?.events) ? inspection.events : [];
        for (let index = events.length - 1; index >= 0; index -= 1) {
          const event = events[index];
          const logged = event?.type === 'request/header'
            ? event.data?.header?.config
            : event?.type === 'assistant/message' ? event.data?.message?.source : undefined;
          if (logged !== null && typeof logged === 'object'
            && typeof logged.provider === 'string' && logged.provider.length > 0
            && typeof logged.model === 'string' && logged.model.length > 0) {
            return { ok: true, provider: logged.provider, model: logged.model, source: 'persisted-session' };
          }
        }
      }
    } catch {
      /* fall through to the default selection */
    }
  }
  return { ...getActiveModel(ctx), source: 'default' };
}

//#region local accounting (host-side, all sessions)
/** Persistent state file: local-accounting price tables + the cost ledger. */
const STATE_DIR = join(process.env.DSH_HOME ?? join(os.homedir(), '.dsh'), 'plugins', 'dsh-api-balance');
const STATE_FILE = join(STATE_DIR, 'state.json');

/**
 * In-memory state:
 *   { vendors: [{ id }],            // local-accounting vendors (shared totals)
 *     models: [{ id, vendorId, match, rates }],
 *     ledger: { key: { vendorId, cost } },
 *     dailyTokens: { "YYYY-MM-DD": { provider: { input, output, cacheRead, cacheWrite } } },
 *     tokenKeys: { "sessionId:messageId": true } }
 * `dailyTokens` records EVERY settled model turn (official and third-party),
 * keyed by the Beijing-time date and split per provider route, so each
 * vendor's 今日消耗 is accounted separately; `tokenKeys` deduplicates so a
 * re-settled event never double-counts.
 */
let localState = loadLocalState();

/**
 * Normalize the persisted daily-token ledger to the per-provider shape.
 * The pre-split flat shape (`date → { input, output, … }`) cannot be
 * attributed to any provider, so those counts are dropped — today's totals
 * are rebuilt by the boot backfill from the persisted session logs. When a
 * legacy shape is found, `droppedLegacy` is set so the caller can also drop
 * the dedup keys (otherwise the backfill would skip those turns).
 */
function normalizeDailyTokens(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { tokens: {}, droppedLegacy: false };
  const tokens = {};
  let droppedLegacy = false;
  for (const [date, value] of Object.entries(raw)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const keys = Object.keys(value);
    const legacy = keys.some((key) => key === 'input' || key === 'output' || key === 'cacheRead' || key === 'cacheWrite');
    if (legacy) {
      droppedLegacy = true;
      continue;
    }
    tokens[date] = value;
  }
  return { tokens, droppedLegacy };
}

/** A well-formed local-accounting vendor spec (id only). */
function saneVendorSpec(entry) {
  return entry !== null && typeof entry === 'object'
    && typeof entry.id === 'string' && entry.id.length > 0;
}

/** A well-formed model spec (id/vendorId/match/rates). */
function saneModelSpec(entry) {
  return entry !== null && typeof entry === 'object'
    && typeof entry.id === 'string' && entry.id.length > 0
    && typeof entry.vendorId === 'string' && entry.vendorId.length > 0
    && typeof entry.match === 'string' && entry.match.length > 0
    && entry.rates !== null && typeof entry.rates === 'object'
    && Number.isFinite(entry.rates.input) && Number.isFinite(entry.rates.output)
    && Number.isFinite(entry.rates.cacheRead) && Number.isFinite(entry.rates.cacheWrite);
}

/** Load the persisted state, migrating the pre-1.4.1 flat-provider format. */
function loadLocalState() {
  try {
    if (existsSync(STATE_FILE)) {
      const value = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
      if (value !== null && typeof value === 'object') {
        const ledgerRaw = value.ledger !== null && typeof value.ledger === 'object' && !Array.isArray(value.ledger)
          ? value.ledger
          : {};
        const { tokens: dailyTokens, droppedLegacy } = normalizeDailyTokens(
          value.dailyTokens !== null && typeof value.dailyTokens === 'object' && !Array.isArray(value.dailyTokens)
            ? value.dailyTokens
            : {}
        );
        // When legacy flat daily counts were dropped (un-attributable), drop
        // the dedup keys too — otherwise the boot backfill would skip those
        // turns and today's per-provider totals would start at zero.
        const tokenKeys = !droppedLegacy && value.tokenKeys !== null && typeof value.tokenKeys === 'object' && !Array.isArray(value.tokenKeys)
          ? value.tokenKeys
          : {};
        // Legacy flat format: { providers: [{id, match, rates}], ledger: {k: {providerId, cost}} }.
        if (Array.isArray(value.providers)) {
          const vendors = value.providers.filter(saneProviderSpecLegacy).map((entry) => ({ id: entry.id }));
          const models = value.providers.filter(saneProviderSpecLegacy).map((entry) => ({
            id: `${entry.id}:m`,
            vendorId: entry.id,
            match: entry.match,
            rates: entry.rates,
          }));
          const ledger = {};
          for (const key of Object.keys(ledgerRaw)) {
            const entry = ledgerRaw[key];
            if (entry !== null && typeof entry === 'object'
              && typeof entry.providerId === 'string' && Number.isFinite(entry.cost)) {
              ledger[key] = { vendorId: entry.providerId, cost: entry.cost };
            }
          }
          return { vendors, models, ledger, dailyTokens, tokenKeys };
        }
        return {
          vendors: Array.isArray(value.vendors) ? value.vendors.filter(saneVendorSpec) : [],
          models: Array.isArray(value.models) ? value.models.filter(saneModelSpec) : [],
          ledger: ledgerRaw,
          dailyTokens,
          tokenKeys,
        };
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return { vendors: [], models: [], ledger: {}, dailyTokens: {}, tokenKeys: {} };
}

/** Old flat-provider spec check used only by the migration path. */
function saneProviderSpecLegacy(entry) {
  return entry !== null && typeof entry === 'object'
    && typeof entry.id === 'string' && entry.id.length > 0
    && typeof entry.match === 'string' && entry.match.length > 0
    && entry.rates !== null && typeof entry.rates === 'object'
    && Number.isFinite(entry.rates.input) && Number.isFinite(entry.rates.output)
    && Number.isFinite(entry.rates.cacheRead) && Number.isFinite(entry.rates.cacheWrite);
}

/** Persist the state file atomically (best effort). */
function persistLocalState() {
  const tmp = join(STATE_DIR, `.state.${process.pid}.${randomUUID()}.tmp`);
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(tmp, JSON.stringify(localState), 'utf8');
    renameSync(tmp, STATE_FILE);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* cleanup is best effort */ }
    /* keep the in-memory state for this process */
  }
}

/**
 * Match a `{ provider, model }` source against the local-accounting model
 * table. Same priority as the browser half: `provider/model` > `model` >
 * `provider` > `*`; on ties the first configured model wins. DeepSeek
 * official never matches (it uses the official endpoint).
 * @returns the matched model entry (carries `vendorId`), or undefined.
 */
function matchLocalModel(provider, model) {
  if (typeof provider !== 'string' || typeof model !== 'string') return undefined;
  if (provider === 'deepseek-official') return undefined;
  const { models } = localState;
  if (models.length === 0) return undefined;
  const full = `${provider}/${model}`;
  return models.find((entry) => entry.match === full)
    ?? models.find((entry) => entry.match === model)
    ?? models.find((entry) => entry.match === provider)
    ?? models.find((entry) => entry.match === '*');
}

/**
 * Price one usage snapshot with model rates (yuan per 1M tokens).
 * Same math as the browser half's `costOf`: `reasoningTokens` is a subset
 * of `outputTokens` in the harness contract (DeepSeek's completion_tokens
 * already contains reasoning_tokens; pi-ai folds reasoning into output),
 * so billing uses `output` alone — adding reasoning would double-charge.
 * @returns cost in yuan, or null when there is nothing to price.
 */
function costOfUsage(usage, rates) {
  if (usage === null || typeof usage !== 'object') return null;
  const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
  const cacheRead = Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0;
  const cacheWrite = Number.isFinite(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0;
  const reasoning = Number.isFinite(usage.reasoningTokens) ? usage.reasoningTokens : 0;
  if (input + output + cacheRead + cacheWrite + reasoning <= 0) return null;
  return (
    (input / 1e6) * rates.input +
    (cacheRead / 1e6) * rates.cacheRead +
    (cacheWrite / 1e6) * rates.cacheWrite +
    (output / 1e6) * rates.output
  );
}

/**
 * Record one settled assistant turn (from any session, parallel
 * conversations included) into the ledger when its model belongs to a
 * local-accounting vendor. The turn's cost is deducted from the VENDOR's
 * shared total, so all models under one vendor draw from the same pool.
 * Every settled turn — official DeepSeek included — also adds its token
 * counts to the Beijing-time daily total (for the badge's 今日消耗 tooltip),
 * deduplicated per `sessionId:messageId` so re-settled events never
 * double-count. Idempotent per `sessionId:messageId` — the first settlement
 * wins, so re-pricing after a model switch never rewrites an already-deducted
 * turn. Exposed for the plugin entry to subscribe the global `session/event`
 * stream.
 * @returns true when the event was recorded.
 */
export function recordSessionEvent(session, event) {
  if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') return false;
  const data = event.data;
  if (data === null || typeof data !== 'object') return false;
  const usage = data.usage;
  const source = data.message?.source;
  if (usage === null || typeof usage !== 'object') return false;
  if (source === null || typeof source !== 'object' || source.kind !== 'model') return false;
  const messageId = data.message?.id;
  if (typeof messageId !== 'string' || messageId.length === 0) return false;
  const sessionId = typeof session?.id === 'string' ? session.id : '';
  const key = `${sessionId}:${messageId}`;

  // Daily token accounting for EVERY model (official and third-party),
  // split per provider route so each vendor's 今日消耗 is independent.
  // reasoningTokens is a subset of outputTokens in the harness contract, so
  // totals are input + output + cacheRead + cacheWrite.
  if (localState.tokenKeys[key] === undefined) {
    localState.tokenKeys[key] = true;
    const date = beijingDate(Date.now());
    if (localState.dailyTokens[date] === undefined) {
      localState.dailyTokens[date] = {};
    }
    const provider = typeof source.provider === 'string' && source.provider.length > 0 ? source.provider : '*';
    const day = localState.dailyTokens[date][provider] ?? (localState.dailyTokens[date][provider] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    day.input += Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
    day.output += Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
    day.cacheRead += Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0;
    day.cacheWrite += Number.isFinite(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0;
    persistLocalState();
  }

  const entry = matchLocalModel(source.provider, source.model);
  if (entry === undefined) return false;
  if (localState.ledger[key] !== undefined) return false;
  const cost = costOfUsage(usage, entry.rates);
  if (cost === null || cost <= 0) return false;
  localState.ledger[key] = { vendorId: entry.vendorId, cost };
  persistLocalState();
  return true;
}

/** Total recorded cost for one vendor id (all of its models combined). */
function spentForVendor(vendorId) {
  let total = 0;
  for (const key of Object.keys(localState.ledger)) {
    const entry = localState.ledger[key];
    if (entry?.vendorId === vendorId && Number.isFinite(entry.cost)) total += entry.cost;
  }
  return total;
}

/**
 * Today's date in Beijing time (YYYY-MM-DD) — the same clock the peak /
 * off-peak pricing windows use, so "today" always matches the official
 * DeepSeek billing day.
 */
function beijingDate(timeMs) {
  try {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(timeMs));
    if (typeof date === 'string' && date.length >= 10) return date.slice(0, 10);
  } catch {
    /* fall through to the UTC+8 fallback */
  }
  return new Date(timeMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Map a provider route name to its vendor group. The official DeepSeek
 * routes — `deepseek-official` itself and any route derived from it (e.g.
 * `vision-toolkit-deepseek-official`, which also calls the same official
 * account) — share ONE vendor group so their 今日消耗 adds up to exactly
 * what the DeepSeek usage page shows. Every other route is its own vendor.
 * @param provider - the route-level provider name from a session event.
 * @returns the vendor group key.
 */
function vendorOf(provider) {
  if (typeof provider === 'string' && (provider === 'deepseek-official' || provider.endsWith('-deepseek-official'))) {
    return 'deepseek-official';
  }
  return provider;
}

/**
 * Today's recorded token totals, split per provider route (every model, all
 * sessions) and merged per vendor group (`byVendor`). The badge shows the
 * CURRENT vendor's merged total — official DeepSeek plus its derived routes
 * like vision-toolkit — which matches the DeepSeek usage page figure, while
 * third-party vendors keep their own totals. `vendorOfProvider` lets the
 * browser resolve the current provider route to its vendor group.
 */
function todayUsage() {
  const date = beijingDate(Date.now());
  const providers = localState.dailyTokens[date] ?? {};
  const byProvider = {};
  const byVendor = {};
  const vendorOfProvider = {};
  for (const [provider, day] of Object.entries(providers)) {
    if (day === null || typeof day !== 'object' || Array.isArray(day)) continue;
    byProvider[provider] = day;
    const vendor = vendorOf(provider);
    vendorOfProvider[provider] = vendor;
    const merged = byVendor[vendor] ?? (byVendor[vendor] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    merged.input += Number.isFinite(day.input) ? day.input : 0;
    merged.output += Number.isFinite(day.output) ? day.output : 0;
    merged.cacheRead += Number.isFinite(day.cacheRead) ? day.cacheRead : 0;
    merged.cacheWrite += Number.isFinite(day.cacheWrite) ? day.cacheWrite : 0;
  }
  return { ok: true, date, byProvider, byVendor, vendorOfProvider };
}

/**
 * Install the host-side ledger: subscribe to the global session event stream
 * so every settled turn across all sessions is accounted. Call once from the
 * plugin body; the returned disposer removes the listener.
 */
export function attachLocalLedger(ctx) {
  const disposer = ctx.on('session/event', (session, event) => {
    try {
      recordSessionEvent(session, event);
    } catch {
      /* never let accounting break the session stream */
    }
  }, { global: true });
  return () => { disposer?.(); };
}

/**
 * Backfill today's token usage from persisted session logs. The live ledger
 * only records turns settled after this host process started, so without a
 * backfill 今日消耗 would start at boot instead of the Beijing-time day
 * boundary and drift from the DeepSeek usage page. Reads go through the
 * side-effect-free `readFrom` (no repair writes, no open-turn rejection);
 * deduplication reuses `tokenKeys`, so already-recorded turns are skipped.
 * Never throws into the boot path.
 * @returns how many turns were added.
 */
export async function backfillTodayUsage(ctx) {
  const persistence = ctx.get('sessionPersistence');
  if (persistence === undefined
    || typeof persistence.list !== 'function'
    || typeof persistence.readFrom !== 'function') return 0;
  const today = beijingDate(Date.now());
  let headers;
  try {
    headers = await persistence.list();
  } catch {
    return 0;
  }
  if (!Array.isArray(headers)) return 0;
  let added = 0;
  for (const header of headers) {
    const sessionId = typeof header?.id === 'string' ? header.id : '';
    if (sessionId.length === 0) continue;
    let events;
    try {
      const inspection = await persistence.readFrom(sessionId, 0);
      events = Array.isArray(inspection?.events) ? inspection.events : [];
    } catch {
      /* unreadable log — skip this session */
      continue;
    }
    for (const event of events) {
      if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue;
      // Only today's events (Beijing time, same clock as the usage page).
      if (typeof event.time !== 'number' || beijingDate(event.time) !== today) continue;
      const data = event.data;
      if (data === null || typeof data !== 'object') continue;
      const usage = data.usage;
      const source = data.message?.source;
      if (usage === null || typeof usage !== 'object') continue;
      if (source === null || typeof source !== 'object' || source.kind !== 'model') continue;
      const messageId = data.message?.id;
      if (typeof messageId !== 'string' || messageId.length === 0) continue;
      const key = `${sessionId}:${messageId}`;
      if (localState.tokenKeys[key] !== undefined) continue;
      localState.tokenKeys[key] = true;
      if (localState.dailyTokens[today] === undefined) {
        localState.dailyTokens[today] = {};
      }
      const provider = typeof source.provider === 'string' && source.provider.length > 0 ? source.provider : '*';
      const day = localState.dailyTokens[today][provider] ?? (localState.dailyTokens[today][provider] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      day.input += Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
      day.output += Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
      day.cacheRead += Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0;
      day.cacheWrite += Number.isFinite(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0;
      added += 1;
    }
  }
  if (added > 0) persistLocalState();
  return added;
}
//#endregion

/** Dispatch one `{ method }` body to the balance domain. */
async function handleApi(ctx, body) {
  const method = typeof body?.method === 'string' ? body.method : '';
  switch (method) {
    case 'getBalance':
      return fetchBalance(ctx, {
        force: body.force === true,
        provider: body.provider,
      });
    case 'getActiveModel':
      return getActiveModel(ctx);
    case 'getSessionModel':
      return getSessionModel(ctx, typeof body.sessionId === 'string' ? body.sessionId : '');
    case 'syncProviders': {
      const vendors = (Array.isArray(body.vendors) ? body.vendors : []).filter(saneVendorSpec);
      const models = (Array.isArray(body.models) ? body.models : []).filter(saneModelSpec);
      // Adopt legacy client-side totals (one pseudo-entry per vendor id).
      const legacy = body.legacySpent;
      if (legacy !== null && typeof legacy === 'object' && !Array.isArray(legacy)) {
        for (const vendorId of Object.keys(legacy)) {
          const cost = Number(legacy[vendorId]);
          const key = `legacy:${vendorId}`;
          if (Number.isFinite(cost) && cost > 0 && localState.ledger[key] === undefined) {
            localState.ledger[key] = { vendorId, cost };
          }
        }
      }
      localState.vendors = vendors;
      localState.models = models;
      persistLocalState();
      return { ok: true, vendors: localState.vendors.length, models: localState.models.length };
    }
    case 'getLocalBalance': {
      const vendorId = typeof body.vendorId === 'string' ? body.vendorId : '';
      if (vendorId.length === 0) return { ok: false, error: 'bad-vendor', message: '缺少 vendorId' };
      return { ok: true, spent: spentForVendor(vendorId) };
    }
    case 'getTodayUsage':
      return todayUsage();
    case 'resetLocalBalance': {
      const vendorId = typeof body.vendorId === 'string' ? body.vendorId : '';
      if (vendorId.length === 0) return { ok: false, error: 'bad-vendor', message: '缺少 vendorId' };
      for (const key of Object.keys(localState.ledger)) {
        if (localState.ledger[key]?.vendorId === vendorId) delete localState.ledger[key];
      }
      persistLocalState();
      return { ok: true };
    }
    case 'ping':
      return { ok: true, plugin: 'dsh-api-balance' };
    default:
      return { ok: false, error: `unknown method: ${method}` };
  }
}

/**
 * Build the POST handler for the balance API route. Business errors travel as
 * HTTP 200 + `{ ok: false, error }` (the harness carrier contract); only
 * handler crashes are 500.
 * @param ctx - the host cordis context.
 * @returns an async request handler.
 */
export function apiHandler(ctx) {
  return async (req, res) => {
    try {
      if (!sameOriginRequest(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden-origin' });
        return;
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      let result;
      try {
        result = await handleApi(ctx, body);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}
