/**
 * dsh-reasoning-levels — host-side reasoning-levels domain.
 *
 * The harness core only offers a reasoning-effort UI for models whose adapter
 * declares `reasoning.efforts`. The official DeepSeek route declares three
 * levels (off / high / max); hand-declared third-party pi-ai models declare
 * none, so they show no effort control and `session.selectModel` refuses any
 * effort with UNSUPPORTED_REASONING_EFFORT.
 *
 * This module closes that gap for third-party models, with NO custom UI — the
 * official model selector presents everything:
 *
 *   1. `ensureAllDeclared` (run at boot, idempotent) writes the five-tier
 *      declaration (`low…max`, identity wire mapping) into `llm-pi-ai` for
 *      every user-declared pi-ai model that has no `reasoningEfforts` of its
 *      own, and ensures `compat.supportsReasoningEffort` on `openai-completions`
 *      routes. `reasoningEfforts: false` models (user opt-out, e.g. grok) and
 *      models with an existing declaration are left untouched; routes where
 *      every model is opted out are skipped entirely. The write goes through
 *      the settings service, so llm-pi-ai re-registers its routes and the
 *      official selector immediately shows the five tiers (defaulting to the
 *      route's `reasoning` value, typically `max`).
 *   2. The diagnostic HTTP API (`getSessionModel` / `setReasoning` /
 *      `setModel` / `levels` / `ping`) reads the session's LIVE selection
 *      through the api-proxy (`session.models` → `current`, carrying the
 *      picked `reasoningEffort`), falling back to the session's last logged
 *      request header and then the global default selection, and applies
 *      tiers/models through the core's own validated path
 *      (`apiProxy.sessions.selectModel`).
 *
 * The official route (`deepseek-official`) is never touched: the official UI
 * keeps its three official tiers.
 * @module dsh-reasoning-levels/api
 */

/** The five tiers this plugin offers, in display order (off is not offered). */
export const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Default wire mapping for the five tiers (identity). Per-model
 * `reasoningEfforts` in settings override these values.
 */
const WIRE_MAP = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };

/** The harness's official DeepSeek provider route (never touched). */
export const OFFICIAL_PROVIDER = 'deepseek-official';

/** Settings namespace of the pi-ai adapter plugin. */
const PI_AI_NS = 'llm-pi-ai';

/** RPC id used when calling the api-proxy from the host side. */
const RPC_ID = 'reasoning-levels';

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

/** Reject cross-site browser requests; this route mutates model/settings state. */
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

/** The harness's global default model selection, or null. */
function defaultSelection(ctx) {
  try {
    const service = ctx.get('agentDefaultModel');
    const selection = typeof service?.currentSelection === 'function' ? service.currentSelection() : undefined;
    if (selection !== null && selection !== undefined
      && typeof selection.provider === 'string' && selection.provider.length > 0
      && typeof selection.model === 'string' && selection.model.length > 0) {
      return {
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: typeof selection.reasoningEffort === 'string' ? selection.reasoningEffort : undefined,
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Read the LIVE selection of ONE session. Priority:
 *   1. the api-proxy `session.models` current — the in-memory picked
 *      selection, which carries the `reasoningEffort` the user last chose
 *      (this tier also captures the model catalog `groups` for the selector);
 *   2. the session's last logged request header config;
 *   3. the global default selection.
 * @returns `{ provider, model, reasoningEffort, groups }` or null.
 */
async function sessionSelection(ctx, sessionId) {
  const apiProxy = ctx.get('apiProxy');
  if (apiProxy !== undefined && typeof sessionId === 'string' && sessionId.length > 0) {
    try {
      const response = await apiProxy.sessions.models({ rpcId: RPC_ID, payload: { sessionId } });
      const value = response?.result?.ok === true ? response.result.value : undefined;
      const current = value?.current;
      if (current !== null && current !== undefined
        && typeof current.provider === 'string' && current.provider.length > 0
        && typeof current.model === 'string' && current.model.length > 0) {
        return {
          provider: current.provider,
          model: current.model,
          reasoningEffort: typeof current.reasoningEffort === 'string' ? current.reasoningEffort : undefined,
          groups: Array.isArray(value?.groups) ? value.groups : [],
        };
      }
    } catch {
      /* fall through to the log/default tiers */
    }
  }
  try {
    const agents = ctx.get('agents');
    const agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined;
    const header = typeof agent?.session?.requestHeader === 'function' ? agent.session.requestHeader() : undefined;
    const config = header?.config;
    if (config !== undefined && config !== null
      && typeof config.provider === 'string' && config.provider.length > 0
      && typeof config.model === 'string' && config.model.length > 0) {
      return {
        provider: config.provider,
        model: config.model,
        reasoningEffort: typeof config.reasoningEffort === 'string' ? config.reasoningEffort : undefined,
        groups: [],
      };
    }
  } catch {
    /* fall through to the default */
  }
  const fallback = defaultSelection(ctx);
  return fallback === null ? null : { ...fallback, groups: [] };
}

/**
 * Whether the provider is a user-declared `llm-pi-ai` route — the plugin's
 * scope. Internal routes (the official DeepSeek route, vision-toolkit's own
 * model routes, …) are never offered the five-tier control.
 */
function isPiAiProvider(ctx, provider) {
  try {
    const settings = ctx.get('settings');
    const section = settings !== undefined && typeof settings.section === 'function' ? settings.section(PI_AI_NS) : undefined;
    const route = section?.providers?.[provider];
    return route !== null && typeof route === 'object';
  } catch {
    return false;
  }
}

/** The reasoning metadata the llm service reports for one exact route/model. */
async function modelReasoning(ctx, provider, model) {
  try {
    const llm = ctx.get('llm');
    const info = llm !== undefined && typeof llm.resolveModelInfo === 'function'
      ? await llm.resolveModelInfo(provider, model)
      : undefined;
    const reasoning = info?.reasoning;
    return {
      name: typeof info?.name === 'string' && info.name.length > 0 ? info.name : undefined,
      supported: reasoning !== undefined && reasoning !== null && Array.isArray(reasoning.efforts)
        ? reasoning.efforts.map((effort) => effort.id)
        : [],
      defaultEffort: reasoning !== undefined && reasoning !== null && typeof reasoning.defaultEffort === 'string'
        ? reasoning.defaultEffort
        : undefined,
    };
  } catch {
    /* unknown route/model — treat as no metadata */
  }
  return { name: undefined, supported: [], defaultEffort: undefined };
}

/**
 * Write the five-tier declaration into the `llm-pi-ai` settings section for
 * one provider/model, so the core accepts the tiers on that model.
 *
 * Only touches a route the user already declared under
 * `llm-pi-ai.providers`. The user's existing `reasoningEfforts` wire
 * mappings are preserved (missing tiers are added with the default mapping,
 * and a stale `off` entry is dropped — the plugin does not offer it), every
 * other provider/route/model field is left untouched, and for
 * `openai-completions` routes `compat.supportsReasoningEffort` is set so
 * pi-ai actually sends `reasoning_effort` on the wire.
 * @returns `{ ok: true }` or `{ ok: false, message }`.
 */
async function ensureModelDeclared(ctx, provider, model) {
  const settings = ctx.get('settings');
  if (settings === undefined || typeof settings.update !== 'function' || typeof settings.section !== 'function') {
    return { ok: false, message: '设置服务不可用，无法自动声明推理档位' };
  }
  let section;
  try {
    section = settings.section(PI_AI_NS);
  } catch {
    return { ok: false, message: `设置分区 ${PI_AI_NS} 不可读，无法自动声明推理档位` };
  }
  const route = section?.providers?.[provider];
  if (route === null || typeof route !== 'object') {
    return { ok: false, message: `供应商 ${provider} 不在 llm-pi-ai 设置中，无法自动声明；请在其模型配置中手动添加 reasoningEfforts` };
  }

  const routeApi = typeof route.api === 'string' ? route.api : undefined;
  const patch = { providers: { [provider]: {} } };
  const providerPatch = patch.providers[provider];

  // `reasoning_effort` is only sent on openai-completions when the compat
  // switch is on; adding it to any other protocol would invalidate the route.
  if (routeApi === 'openai-completions' && route.compat?.supportsReasoningEffort !== true) {
    providerPatch.compat = {
      ...(typeof route.compat?.thinkingFormat === 'string' ? { thinkingFormat: route.compat.thinkingFormat } : {}),
      supportsReasoningEffort: true,
    };
  }

  const models = Array.isArray(route.models) ? route.models : [];
  const overrides = route.modelOverrides !== null && typeof route.modelOverrides === 'object' ? route.modelOverrides : {};
  const modelEntries = models.length > 0 ? models : Object.values(overrides);
  const allModelsSupportReasoning = modelEntries.length > 0
    && modelEntries.every((entry) => entry !== null && typeof entry === 'object' && entry.reasoningEfforts !== false);
  if (allModelsSupportReasoning && route.reasoning === undefined) providerPatch.reasoning = 'max';
  // The model entry the declaration would target (models list or overrides).
  const targetEntry = (() => {
    if (models.length > 0) {
      return models.find((entry) => entry !== null && typeof entry === 'object' && entry.id === model) ?? null;
    }
    return Object.prototype.hasOwnProperty.call(overrides, model) ? overrides[model] : null;
  })();
  if (targetEntry === null) {
    return { ok: false, message: `模型 ${model} 未在供应商 ${provider} 的 models/modelOverrides 中声明，拒绝写入无效模型` };
  }
  // `reasoningEfforts: false` is the user's explicit opt-out (e.g. grok);
  // never overwrite it.
  if (targetEntry !== null && typeof targetEntry === 'object' && targetEntry.reasoningEfforts === false) {
    return { ok: false, message: `模型 ${model} 已通过 reasoningEfforts: false 退出推理档位，不会自动声明` };
  }
  const effortsOf = (entry) => {
    const existing = entry !== null && typeof entry === 'object'
      && entry.reasoningEfforts !== null && typeof entry.reasoningEfforts === 'object'
      ? entry.reasoningEfforts
      : {};
    // The plugin offers five tiers only; a stale `off` entry is dropped so
    // the declared capability matches the selector exactly.
    const { off: _droppedOff, ...kept } = existing;
    return { ...WIRE_MAP, ...kept };
  };

  if (models.length > 0) {
    const index = models.findIndex((entry) => entry !== null && typeof entry === 'object' && entry.id === model);
    if (index < 0) {
      return { ok: false, message: `模型 ${model} 不在供应商 ${provider} 的 models 列表中，无法自动声明` };
    }
    providerPatch.models = models.map((entry, i) => (i === index ? { ...entry, reasoningEfforts: effortsOf(entry) } : entry));
  } else {
    // Catalog route: declare through modelOverrides (only valid for catalog ids;
    // the settings schema refuses anything else, which surfaces as a write error).
    providerPatch.modelOverrides = {
      ...overrides,
      [model]: { ...(overrides[model] ?? {}), reasoningEfforts: effortsOf(overrides[model]) },
    };
  }

  try {
    await settings.update(PI_AI_NS, patch);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: `写入 ${PI_AI_NS} 设置失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Boot-time sweep: make sure every user-declared pi-ai model without an
 * explicit `reasoningEfforts` field gets the five-tier declaration, and
 * every `openai-completions` route missing the compat switch gets it. Models
 * opted out with `reasoningEfforts: false` and models with an existing
 * declaration (the user's own mapping) are left untouched. Idempotent: once
 * everything is declared, later boots write nothing.
 * @returns `{ ok: true, patched }` or `{ ok: false, message }`.
 */
export async function ensureAllDeclared(ctx) {
  const settings = ctx.get('settings');
  if (settings === undefined || typeof settings.update !== 'function' || typeof settings.section !== 'function') {
    return { ok: false, message: '设置服务不可用，无法自动声明推理档位' };
  }
  let section;
  try {
    section = settings.section(PI_AI_NS);
  } catch {
    return { ok: false, message: `设置分区 ${PI_AI_NS} 不可读，无法自动声明推理档位` };
  }
  const providers = section?.providers;
  if (providers === null || typeof providers !== 'object') {
    return { ok: true, patched: 0 };
  }

  const patch = { providers: {} };
  let patched = 0;
  for (const [provider, route] of Object.entries(providers)) {
    if (route === null || typeof route !== 'object') continue;
    const models = Array.isArray(route.models) ? route.models : [];
    const overrides = route.modelOverrides !== null && typeof route.modelOverrides === 'object' ? route.modelOverrides : {};
    // A route where every model is opted out (`reasoningEfforts: false`) —
    // e.g. a grok-only route — is skipped entirely: no declarations, no compat.
    const modelEntries = models.length > 0 ? models : Object.values(overrides);
    const usable = modelEntries.some((entry) => entry !== null && typeof entry === 'object' && entry.reasoningEfforts !== false);
    if (!usable) continue;
    const routeApi = typeof route.api === 'string' ? route.api : undefined;
    const providerPatch = {};
    // A route-wide default is safe only when every model on the route supports
    // reasoning; mixed routes (for example a grok opt-out) must not inherit it.
    const allModelsSupportReasoning = modelEntries.length > 0
      && modelEntries.every((entry) => entry !== null && typeof entry === 'object' && entry.reasoningEfforts !== false);
    if (allModelsSupportReasoning && route.reasoning === undefined) providerPatch.reasoning = 'max';
    // openai-completions routes need the compat switch before reasoning_effort
    // is ever sent on the wire.
    if (routeApi === 'openai-completions' && route.compat?.supportsReasoningEffort !== true) {
      providerPatch.compat = {
        ...(typeof route.compat?.thinkingFormat === 'string' ? { thinkingFormat: route.compat.thinkingFormat } : {}),
        supportsReasoningEffort: true,
      };
    }
    if (models.length > 0) {
      let changed = false;
      const next = models.map((entry) => {
        if (entry === null || typeof entry !== 'object') return entry;
        // `false` = user opted this model out; an object = user's own mapping.
        if (entry.reasoningEfforts !== undefined) return entry;
        changed = true;
        patched += 1;
        return { ...entry, reasoningEfforts: { ...WIRE_MAP } };
      });
      if (changed) providerPatch.models = next;
    } else {
      let changed = false;
      const next = {};
      for (const [modelId, override] of Object.entries(overrides)) {
        if (override !== null && typeof override === 'object' && override.reasoningEfforts !== undefined) {
          next[modelId] = override;
          continue;
        }
        changed = true;
        patched += 1;
        next[modelId] = { ...(override ?? {}), reasoningEfforts: { ...WIRE_MAP } };
      }
      if (changed) providerPatch.modelOverrides = { ...overrides, ...next };
    }
    if (Object.keys(providerPatch).length > 0) {
      patch.providers[provider] = providerPatch;
    }
  }

  if (Object.keys(patch.providers).length === 0) {
    return { ok: true, patched: 0 };
  }
  try {
    await settings.update(PI_AI_NS, patch);
    return { ok: true, patched };
  } catch (error) {
    return { ok: false, message: `写入 ${PI_AI_NS} 设置失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Handle `getSessionModel`: the session's live model + reasoning facts. */
async function handleGetSessionModel(ctx, body) {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (sessionId.length === 0) return { ok: false, error: 'bad-session', message: '缺少 sessionId，不能修改会话模型或推理档位' };
  const selection = await sessionSelection(ctx, sessionId);
  if (selection === null) {
    return { ok: false, error: 'no-model', message: '无法读取当前模型（服务不可用或没有默认模型）' };
  }
  const reasoning = await modelReasoning(ctx, selection.provider, selection.model);
  return {
    ok: true,
    provider: selection.provider,
    model: selection.model,
    modelName: reasoning.name ?? selection.model,
    reasoningEffort: selection.reasoningEffort ?? reasoning.defaultEffort,
    official: selection.provider === OFFICIAL_PROVIDER,
    // The five-tier control only applies to user-declared pi-ai routes.
    applicable: selection.provider !== OFFICIAL_PROVIDER && isPiAiProvider(ctx, selection.provider),
    supported: reasoning.supported,
    defaultEffort: reasoning.defaultEffort,
    groups: selection.groups,
  };
}

/** Handle `setReasoning`: apply one of the five tiers to the session's model. */
async function handleSetReasoning(ctx, body) {
  const effort = typeof body.effort === 'string' ? body.effort : '';
  if (!LEVELS.includes(effort)) {
    return { ok: false, error: 'bad-effort', message: `不支持的推理档位「${effort}」（可选：${LEVELS.join(' / ')}）` };
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (sessionId.length === 0) return { ok: false, error: 'bad-session', message: '缺少 sessionId，不能修改会话模型或推理档位' };
  const selection = await sessionSelection(ctx, sessionId);
  if (selection === null) {
    return { ok: false, error: 'no-model', message: '无法读取当前模型（服务不可用或没有默认模型）' };
  }
  // Caller may name an explicit route; otherwise the live selection decides.
  const provider = typeof body.provider === 'string' && body.provider.length > 0 ? body.provider : selection.provider;
  const model = typeof body.model === 'string' && body.model.length > 0 ? body.model : selection.model;
  if (provider === OFFICIAL_PROVIDER) {
    return { ok: false, error: 'official-only', message: '官方模型请使用官方推理等级（Off / High / Max），第三方五档只作用于第三方模型' };
  }
  if (!isPiAiProvider(ctx, provider)) {
    return { ok: false, error: 'not-applicable', message: `供应商 ${provider} 不是 llm-pi-ai 中声明的第三方路由，五档推理等级不适用于它` };
  }

  // 1) make sure the model can take the tier (auto-declare when missing).
  let reasoning = await modelReasoning(ctx, provider, model);
  let patched = false;
  if (!reasoning.supported.includes(effort)) {
    const result = await ensureModelDeclared(ctx, provider, model);
    if (!result.ok) {
      return {
        ok: false,
        error: 'unsupported',
        message: `模型 ${provider}/${model} 无法应用推理档位「${effort}」：${result.message}`,
        supported: reasoning.supported,
      };
    }
    patched = true;
    reasoning = await modelReasoning(ctx, provider, model);
    if (!reasoning.supported.includes(effort)) {
      return {
        ok: false,
        error: 'unsupported',
        message: `模型 ${provider}/${model} 仍无法应用推理档位「${effort}」（可用：${reasoning.supported.length > 0 ? reasoning.supported.join(' / ') : '无'}），请检查供应商实际支持的档位`,
        patched,
        supported: reasoning.supported,
      };
    }
  }

  // 2) apply through the core's own validated path.
  const apiProxy = ctx.get('apiProxy');
  if (apiProxy === undefined || typeof apiProxy.sessions?.selectModel !== 'function') {
    return { ok: false, error: 'no-api', message: '会话 API 不可用，无法应用推理档位', patched };
  }
  try {
    const response = await apiProxy.sessions.selectModel({
      rpcId: RPC_ID,
      payload: { sessionId, provider, model, reasoningEffort: effort },
    });
    if (response?.result?.ok === true) {
      return {
        ok: true,
        selected: response.result.value?.selected ?? { provider, model, reasoningEffort: effort },
        patched,
        ...(patched ? { message: '已为模型自动启用五档推理声明（写入 llm-pi-ai 设置）' } : {}),
      };
    }
    const error = response?.result?.error;
    return {
      ok: false,
      error: error?.code ?? 'select-failed',
      message: error?.message ?? '应用推理档位失败',
      patched,
      supported: reasoning.supported,
    };
  } catch (error) {
    return {
      ok: false,
      error: 'select-failed',
      message: error instanceof Error ? error.message : String(error),
      patched,
    };
  }
}

/** Handle `setModel`: switch the session to another model, keeping the effort when supported. */
async function handleSetModel(ctx, body) {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const provider = typeof body.provider === 'string' && body.provider.length > 0 ? body.provider : '';
  const model = typeof body.model === 'string' && body.model.length > 0 ? body.model : '';
  if (provider.length === 0 || model.length === 0) {
    return { ok: false, error: 'bad-route', message: '缺少 provider 或 model' };
  }
  const selection = await sessionSelection(ctx, sessionId);
  const currentEffort = selection?.reasoningEffort;
  const target = await modelReasoning(ctx, provider, model);
  // Carry the current effort over when the target supports it; otherwise fall
  // back to the target's own default effort (like the official selector).
  const effort = currentEffort !== undefined && currentEffort !== null && target.supported.includes(currentEffort)
    ? currentEffort
    : target.defaultEffort;

  const apiProxy = ctx.get('apiProxy');
  if (apiProxy === undefined || typeof apiProxy.sessions?.selectModel !== 'function') {
    return { ok: false, error: 'no-api', message: '会话 API 不可用，无法切换模型' };
  }
  try {
    const response = await apiProxy.sessions.selectModel({
      rpcId: RPC_ID,
      payload: {
        sessionId,
        provider,
        model,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      },
    });
    if (response?.result?.ok === true) {
      return { ok: true, selected: response.result.value?.selected ?? { provider, model } };
    }
    const error = response?.result?.error;
    return {
      ok: false,
      error: error?.code ?? 'select-failed',
      message: error?.message ?? '切换模型失败',
    };
  } catch (error) {
    return {
      ok: false,
      error: 'select-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Dispatch one `{ method }` body to the reasoning-levels domain. */
async function handleApi(ctx, body) {
  const method = typeof body?.method === 'string' ? body.method : '';
  switch (method) {
    case 'getSessionModel':
      return handleGetSessionModel(ctx, body);
    case 'setReasoning':
      return handleSetReasoning(ctx, body);
    case 'setModel':
      return handleSetModel(ctx, body);
    case 'levels':
      return { ok: true, levels: LEVELS, official: OFFICIAL_PROVIDER };
    case 'ping':
      return { ok: true, plugin: 'dsh-reasoning-levels' };
    default:
      return { ok: false, error: `unknown method: ${method}` };
  }
}

/**
 * Build the POST handler for the reasoning-levels API route. Business errors
 * travel as HTTP 200 + `{ ok: false, error }` (the harness carrier contract);
 * only handler crashes are 500.
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
