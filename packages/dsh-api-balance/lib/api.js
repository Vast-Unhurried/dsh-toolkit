/**
 * dsh-api-balance — host-side balance & pricing domain.
 *
 * The DeepSeek official account-balance endpoint
 * (`GET https://api.deepseek.com/user/balance`) returns the remaining
 * topped-up/granted balance in CNY. This module resolves the API key from the
 * harness credentials service (the same `DEEPSEEK_API_KEY` the Models page
 * writes), calls the endpoint with a short in-memory cache, and never leaks
 * the key back to the browser — the response carries balances only.
 *
 * Pricing for per-turn cost estimates lives in the browser half as a
 * constant (DeepSeek official per-million-token prices, yuan), because the
 * client snapshot already carries exact token usage; the host needs no
 * session-file access. See README for how to update prices.
 * @module dsh-api-balance/api
 */

/** DeepSeek official balance endpoint. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance';

/** How long a successful balance answer is reused (milliseconds). */
const CACHE_TTL_MS = 60_000;

/** In-memory balance cache: { at, payload }. */
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

/** Write a JSON response. */
export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * Fetch the DeepSeek account balance in CNY.
 * Never throws: every failure is a `{ ok: false, error }` business result.
 * @param ctx - the host cordis context (credentials service).
 * @returns balance summary or a business error.
 */
export async function fetchBalance(ctx) {
  if (balanceCache !== null && Date.now() - balanceCache.at < CACHE_TTL_MS) {
    return balanceCache.payload;
  }

  const credentials = ctx.get('credentials');
  if (credentials === undefined) {
    return { ok: false, error: 'credentials-unavailable', message: '凭据服务不可用' };
  }

  let key = undefined;
  try {
    const hit = await credentials.resolve('DEEPSEEK_API_KEY');
    key = hit?.value;
  } catch {
    /* resolve failure falls through to the missing-key error */
  }
  if (typeof key !== 'string' || key.length === 0) {
    return {
      ok: false,
      error: 'no-api-key',
      message: '未配置 DEEPSEEK_API_KEY（模型设置页或 ~/.dsh/.credentials.yaml）',
    };
  }

  let response;
  try {
    response = await fetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${key}` },
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
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      error: `http-${String(response.status)}`,
      message: text.length > 0 ? `余额查询失败（HTTP ${String(response.status)}）：${text.slice(0, 200)}` : `余额查询失败（HTTP ${String(response.status)}）`,
    };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'bad-response', message: '余额接口返回了无效数据' };
  }

  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  const cny = infos.find((entry) => typeof entry?.currency === 'string' && entry.currency === 'CNY');
  const currencies = infos.map((entry) => ({
    currency: entry?.currency ?? '?',
    total: entry?.total_balance ?? '0',
    granted: entry?.granted_balance ?? '0',
    toppedUp: entry?.topped_up_balance ?? '0',
  }));

  const payload = {
    ok: true,
    isAvailable: data?.is_available !== false,
    currencies,
    // Convenience summary for the common CNY single-currency case.
    cny: cny === undefined ? null : {
      currency: 'CNY',
      total: cny.total_balance ?? '0',
      granted: cny.granted_balance ?? '0',
      toppedUp: cny.topped_up_balance ?? '0',
    },
    at: Date.now(),
  };
  balanceCache = { at: Date.now(), payload };
  return payload;
}

/** Dispatch one `{ method }` body to the balance domain. */
async function handleApi(ctx, body) {
  const method = typeof body?.method === 'string' ? body.method : '';
  switch (method) {
    case 'getBalance':
      return fetchBalance(ctx);
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
