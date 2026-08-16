/**
 * HTTP helpers and the API route handler for the session-delete domain.
 * @module dsh-session-delete/http
 */
import { deleteSession } from './delete.js';

/** Read a JSON request body (bounded). */
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

/** Dispatch one `{ method, ...args }` body to the delete domain. */
async function handleApi(ctx, method, body) {
  switch (method) {
    case 'delete': {
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
      return deleteSession(ctx, sessionId);
    }
    case 'ping':
      return { ok: true, plugin: 'dsh-session-delete' };
    default:
      return { ok: false, error: `unknown method: ${method}` };
  }
}

/**
 * Build the POST handler for the session-delete API route. Business errors
 * travel as HTTP 200 + `{ ok: false, error }` (the harness carrier contract);
 * only handler crashes are 500.
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
      const method = typeof body?.method === 'string' ? body.method : '';
      let result;
      try {
        result = await handleApi(ctx, method, body);
      } catch (error) {
        // Business errors (guards, unknown session, ...) are client-visible
        // messages, not carrier crashes.
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
}
