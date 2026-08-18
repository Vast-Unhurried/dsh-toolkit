/**
 * dsh-note — host-side sticky-note storage domain.
 *
 * The note is one text blob persisted as a JSON file at
 * `$DSH_HOME/storages/dsh-note.json` (the harness's native JSON data root;
 * the user's old `~/.dsh/sticky-notes/` scratch directory was removed by
 * request). Writes are serialized through a module-level promise chain and
 * published atomically (same-directory temp file + rename), so concurrent
 * saves from the browser never interleave or tear the file. The note never
 * leaves the host — the browser only ever sends and receives the note text.
 *
 * History: opening the popover starts a fresh note; the user types and
 * clicks 保存 (`commitNote`) to archive the finished text into a bounded
 * `history` list (newest first, deduplicated, capped) and clear the draft —
 * saving is explicit, never automatic. The draft slot (`text`) exists only
 * as a crash guard: it is written when the popover closes with unsaved
 * content (`setNote`) and recovered on the next open. History entries can
 * be viewed and deleted individually.
 *
 * Contract with the browser half:
 *   `POST { method: 'getNote' }`       → `{ ok, value: { text, updatedAt, history } }`
 *                                       (text = recoverable draft)
 *   `POST { method: 'setNote', text }` → crash-guard draft write only.
 *   `POST { method: 'commitNote', text }` → explicit save: archives into
 *                                       history, clears the draft.
 *   `POST { method: 'deleteHistory', id }` → removes one history entry
 *                                       (idempotent), returns `{ id, deleted }`.
 * Business errors travel as HTTP 200 + `{ ok: false, error, message }`; only
 * handler crashes are 500.
 * @module dsh-note/api
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** File name inside the harness storages directory. */
const NOTE_FILE_NAME = 'dsh-note.json';

/**
 * Upper bound on note length (chars). Deliberately below the 64 KiB request
 * body cap: CJK text is 3 bytes/char in UTF-8, so 16 000 chars ≈ 48 KiB
 * plus JSON overhead stays safely inside the cap (32 000 chars would blow
 * through it and fail every long Chinese save with `body too large`).
 */
export const MAX_TEXT_CHARS = 16_000;

/** Upper bound on archived history entries (oldest are dropped). */
export const MAX_HISTORY = 30;

/** Serialized write chain — one atomic publish at a time. */
let writeChain = Promise.resolve();

/**
 * Atomically publish one note value. The caller holds the write chain; the
 * temp file gets a random name (no same-millisecond collisions) and is
 * removed on failure so no `.tmp` residue can accumulate.
 * @param value - the full note object to persist.
 * @returns the persisted value.
 */
async function publishNote(value) {
  const path = noteFile();
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.dsh-note.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(value), 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  return value;
}

/** Resolve the note file path under the harness home. */
export function noteFile() {
  const fromEnv = process.env.DSH_HOME;
  const home = typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv.trim() : join(homedir(), '.dsh');
  return join(home, 'storages', NOTE_FILE_NAME);
}

/** The canonical empty note. */
function emptyNote() {
  return { text: '', updatedAt: null, history: [] };
}

/** Sanitize a raw history array into the canonical entry shape (capped). */
function parseHistory(raw) {
  const history = [];
  if (!Array.isArray(raw)) return history;
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || typeof entry.text !== 'string') continue;
    history.push({
      id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : randomUUID(),
      text: entry.text,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    });
    if (history.length >= MAX_HISTORY) break;
  }
  return history;
}

/**
 * Load the persisted note. Never throws: a missing file is an empty note; a
 * corrupt file (unparsable or wrong shape) degrades to an empty note as well,
 * so the UI can always open.
 * @returns `{ ok: true, value }` with the note, or a business error.
 */
export async function loadNote() {
  let text;
  try {
    text = await readFile(noteFile(), 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return { ok: true, value: emptyNote() };
    }
    return {
      ok: false,
      error: 'read-failed',
      message: `便签读取失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  try {
    const data = JSON.parse(text);
    if (data !== null && typeof data === 'object' && typeof data.text === 'string') {
      return {
        ok: true,
        value: {
          text: data.text,
          updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
          history: parseHistory(data.history),
        },
      };
    }
    return { ok: true, value: emptyNote() };
  } catch {
    return { ok: true, value: emptyNote() };
  }
}

/**
 * Save the current draft (serialized + atomic). Crash-guard path: it only
 * updates the draft slot (`text`/`updatedAt`) and leaves history untouched —
 * intermediate edits never become history. The draft is written when the
 * popover closes with unsaved content and recovered on the next open;
 * explicit saving goes through {@link commitNote}.
 * @param text - the draft body to store.
 * @returns `{ ok: true, value }` with the stored draft, or a business error.
 */
export function saveNote(text) {
  if (typeof text !== 'string') {
    return Promise.resolve({ ok: false, error: 'bad-text', message: '便签内容必须是文本' });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return Promise.resolve({
      ok: false,
      error: 'too-long',
      message: `便签内容超过 ${MAX_TEXT_CHARS} 字符上限`,
    });
  }
  const run = writeChain.then(async () => {
    const current = await loadNote();
    if (!current.ok) throw new Error(current.message ?? 'read failed');
    const history = Array.isArray(current.value.history) ? current.value.history : [];
    const value = { text, updatedAt: new Date().toISOString(), history };
    await publishNote(value);
    return value;
  });
  writeChain = run.catch(() => {});
  return run.then(
    (saved) => ({ ok: true, value: saved }),
    (error) => ({
      ok: false,
      error: 'write-failed',
      message: `便签保存失败：${error instanceof Error ? error.message : String(error)}`,
    }),
  );
}

/**
 * Commit one note explicitly (serialized + atomic) — the「保存」button path.
 * The given text becomes a new history entry (newest first, deduplicated
 * against the newest entry, capped) and the draft slot is cleared, so the
 * popover can immediately continue with the next fresh note. Saving happens
 * only when the user clicks save; the draft slot is never touched here.
 * @param text - the finished note body to commit.
 * @returns `{ ok: true, value: { archived, history } }` or a business error.
 */
export function commitNote(text) {
  if (typeof text !== 'string') {
    return Promise.resolve({ ok: false, error: 'bad-text', message: '便签内容必须是文本' });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return Promise.resolve({
      ok: false,
      error: 'too-long',
      message: `便签内容超过 ${MAX_TEXT_CHARS} 字符上限`,
    });
  }
  const run = writeChain.then(async () => {
    const current = await loadNote();
    if (!current.ok) throw new Error(current.message ?? 'read failed');
    const history = [...(Array.isArray(current.value.history) ? current.value.history : [])];
    const archived = text !== '' && (history.length === 0 || history[0].text !== text);
    if (archived) {
      history.unshift({
        id: randomUUID(),
        text,
        updatedAt: new Date().toISOString(),
      });
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    }
    const value = { text: '', updatedAt: null, history };
    await publishNote(value);
    return { archived, history: value.history };
  });
  writeChain = run.catch(() => {});
  return run.then(
    (value) => ({ ok: true, value }),
    (error) => ({
      ok: false,
      error: 'write-failed',
      message: `便签保存失败：${error instanceof Error ? error.message : String(error)}`,
    }),
  );
}

/**
 * Delete one history entry by id (serialized + atomic, idempotent).
 * @param id - the history entry id to remove.
 * @returns `{ ok: true, value: { id, deleted } }` or a business error.
 */
export function deleteHistory(id) {
  if (typeof id !== 'string' || id.length === 0) {
    return Promise.resolve({ ok: false, error: 'bad-id', message: '缺少历史条目 id' });
  }
  const run = writeChain.then(async () => {
    const current = await loadNote();
    if (!current.ok) throw new Error(current.message ?? 'read failed');
    const before = Array.isArray(current.value.history) ? current.value.history : [];
    const history = before.filter((entry) => entry?.id !== id);
    const value = { text: current.value.text, updatedAt: current.value.updatedAt, history };
    await publishNote(value);
    return { id, deleted: history.length !== before.length };
  });
  writeChain = run.catch(() => {});
  return run.then(
    (value) => ({ ok: true, value }),
    (error) => ({
      ok: false,
      error: 'write-failed',
      message: `历史删除失败：${error instanceof Error ? error.message : String(error)}`,
    }),
  );
}

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

/** Reject cross-site browser requests; internal clients may omit Origin. */
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

/** Dispatch one `{ method }` body to the note domain. */
async function handleApi(ctx, body) {
  const method = typeof body?.method === 'string' ? body.method : '';
  switch (method) {
    case 'getNote':
      return loadNote();
    case 'setNote':
      return saveNote(body?.text);
    case 'commitNote':
      return commitNote(body?.text);
    case 'deleteHistory':
      return deleteHistory(body?.id);
    case 'ping':
      return { ok: true, plugin: 'dsh-note' };
    default:
      return { ok: false, error: `unknown method: ${method}` };
  }
}

/**
 * Build the POST handler for the note API route. Business errors travel as
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
