/**
 * dsh-session-delete — host-side session deletion.
 *
 * The DeepSeek Harness core ships no session-delete API (sessions can only be
 * archived). This module implements the deletion directly against the core
 * services, in an order that never corrupts the harness:
 *
 *   1. Guards: id shape only. Running agents, subagent lineage (both
 *      directions) are deliberately NOT guarded — deletion is unconditional.
 *   2. If the session is live (resident agent): flush its pending writes,
 *      retire its persistence write-path, remove it from the in-memory
 *      session/agent stores, then emit `session/disposed` so core listeners
 *      (host stream -> browser, projection cache, title, telemetry) clean up
 *      exactly as if the harness had disposed it itself.
 *   3. Delete the session's JSONL artifact directory under the configured
 *      session root. The SQLite session-search index reconciles the missing
 *      artifact on its own (persistentDeletes path), so nothing else is
 *      needed for search.
 *   4. Workspace registry: detach the session id from every workspace record
 *      and remove it from the archived-session set, durably.
 *
 * The session root is read from the persistence backend (`backend.root`), and
 * the on-disk project/session directory names are computed with the same
 * encoding the JSONL backend uses (encodeSegment / projectKey).
 * @module dsh-session-delete/delete
 */
import { rm, rmdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

/** Session ids minted by the harness look like `session-<uuid>`. */
const SESSION_ID_RE = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encode an arbitrary string as a single safe path segment (same algorithm as
 * `dsh-session-persistence-jsonl`'s encodeSegment: safe code units stay
 * literal, everything else becomes `~XXXX` uppercase hex).
 */
function encodeSegment(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/**
 * Build the human-readable project directory key for a cwd (same algorithm as
 * the backend's projectKey: separators/colon become `-`, unsafe units use the
 * `~XXXX` escape, wrapped in `--...--`).
 */
function projectKey(cwd) {
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

/** The session-owned directory beneath the project directory. */
function sessionDir(root, cwd, id) {
  // The JSONL backend uses `_no-cwd` for sessions without workspace cwd; do
  // not report success while leaving that session's artifact behind.
  const project = typeof cwd === 'string' && cwd.length > 0 ? projectKey(cwd) : '_no-cwd';
  return join(join(root, project), encodeSegment(id));
}

/**
 * Delete one session completely. Throws with a user-facing message on any
 * guard failure; returns `{ ok: true }` on success.
 * @param ctx - the host cordis context.
 * @param sessionId - the session to delete.
 */
export async function deleteSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_RE.test(sessionId)) {
    throw new Error('无效的会话 ID');
  }

  const sessions = ctx.get('sessions');
  const agents = ctx.get('agents');
  const persistence = ctx.get('sessionPersistence');
  const registry = ctx.get('workspaceRegistry');
  if (persistence === undefined) throw new Error('会话持久化服务不可用，无法删除');

  const live = sessions?.get(sessionId);
  const agent = agents?.get(sessionId);

  // Resolve the stored header (cold sessions) — live blank sessions may not
  // have materialized an artifact yet; their header comes from memory.
  let header;
  try {
    const stored = await persistence.list();
    header = stored.find((h) => h.id === sessionId);
  } catch {
    /* persistence listing faults propagate as "unknown" only when the session
       is not live either; see the check below. */
  }
  if (header === undefined && live === undefined) {
    throw new Error('会话不存在（可能已被删除）');
  }
  // Safety invariant: never delete a live/active session. The persistence
  // service can receive another event after this function returns and recreate
  // the JSONL directory; attempting to retire/emit it here also races the
  // core's own scoped disposal path. Ask the user to stop/close it first.
  if (live !== undefined || agent !== undefined) {
    throw new Error('运行中的会话不能直接删除，请先停止或关闭会话后重试');
  }

  // Delete only a cold, persisted session. No live store mutation or manual
  // session/disposed emission is needed; the core has no active agent to
  // resurrect the artifact.

  // Delete the on-disk artifact directory. The JSONL backend exposes the
  // configured session root as a public `root` field on the service. A
  // missing/unresolvable root must fail loudly — silently reporting success
  // while the logs remain on disk would be worse than refusing.
  const root = typeof persistence.root === 'string' ? persistence.root : persistence.backend?.root;
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('无法定位会话存储目录，拒绝删除');
  }
  {
    // Resolve the session root itself (a symlinked sessions dir is legal)
    // and make sure the deletion target stays inside it: a symlinked
    // project directory must not smuggle the rm outside the root.
    const realRoot = realpathSync(root);
    const cwd = header !== undefined ? header.cwd : undefined;
    const dir = sessionDir(realRoot, cwd, sessionId);
    if (!dir.startsWith(realRoot + sep)) {
      throw new Error('会话目录超出存储根目录，拒绝删除');
    }
    await rm(dir, { recursive: true, force: true });
    // Best-effort: drop the now-empty project directory so no residue stays.
    const encoded = encodeSegment(sessionId);
    const project = dir.slice(0, dir.lastIndexOf(encoded));
    if (project.length > realRoot.length) {
      try {
        await rmdir(project);
      } catch {
        /* ENOTEMPTY/ENOENT — other sessions live there or it is already gone. */
      }
    }
  }

  // 3) Workspace registry cleanup: drop the id from every workspace record
  // and from the archived-session set (idempotent, durable).
  if (registry !== undefined) {
    try {
      for (const workspace of registry.list()) {
        await workspace.detachSession(sessionId);
      }
    } catch (error) {
      ctx.logger.warn(`dsh-session-delete: workspace detach failed for ${sessionId}: ${String(error)}`);
    }
    try {
      await registry.enqueueOperation(async () => {
        const state = registry.requireState();
        if (state.archivedSessionIds.includes(sessionId)) {
          await registry.setState({
            ...state,
            archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId),
          });
        }
      });
    } catch (error) {
      ctx.logger.warn(`dsh-session-delete: archived-set cleanup failed for ${sessionId}: ${String(error)}`);
    }
  }

  return { ok: true };
}
