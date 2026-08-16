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
import { join } from 'node:path';

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
  if (typeof cwd !== 'string' || cwd.length === 0) return undefined;
  return join(join(root, projectKey(cwd)), encodeSegment(id));
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

  // Deletion is unconditional: subagent lineage (this session being a child,
  // or having live children) and running state do NOT block deletion. A
  // running agent keeps its in-memory loop until it naturally finishes, but
  // its persistence write path is retired below, so it cannot resurrect the
  // deleted log.

  // 1) Dispose the live half, if any — flush first so no buffered event is
  // lost, then release the persistence write path, then remove the in-memory
  // entries, then emit the disposal the core itself would emit.
  //
  // The JSONL backend exposes its write orchestration through the public
  // `coordinator` field (`flush`/`retire` live there, not on the service
  // itself); fall back to service-level methods when present.
  const coordinator = persistence.coordinator;
  const flushLive = typeof coordinator?.flush === 'function' ? coordinator.flush.bind(coordinator) : typeof persistence.flush === 'function' ? persistence.flush.bind(persistence) : undefined;
  const retireLive = typeof coordinator?.retire === 'function' ? coordinator.retire.bind(coordinator) : typeof persistence.retire === 'function' ? persistence.retire.bind(persistence) : undefined;
  if (live !== undefined) {
    if (flushLive !== undefined) {
      try {
        await flushLive(live);
      } catch (error) {
        throw new Error(`会话数据刷新失败，已取消删除：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (retireLive !== undefined) {
      try {
        retireLive(live);
      } catch {
        /* retire is best-effort; the store removal below still proceeds. */
      }
    }
    try {
      sessions.store.delete(sessionId);
    } catch {
      /* store shape is internal; the emit below is the observable part. */
    }
    if (agents !== undefined) {
      try {
        agents.store.delete(sessionId);
      } catch {
        /* ignored — same reason as above. */
      }
    }
    try {
      ctx.emit('session/disposed', live);
    } catch {
      /* disposal listeners are contained by design. */
    }
  }

  // 2) Delete the on-disk artifact directory. The JSONL backend exposes the
  // configured session root as a public `root` field on the service.
  const root = typeof persistence.root === 'string' ? persistence.root : persistence.backend?.root;
  if (typeof root === 'string' && root.length > 0) {
    const cwd = header !== undefined ? header.cwd : live?.header.cwd;
    const dir = sessionDir(root, cwd, sessionId);
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
      // Best-effort: drop the now-empty project directory so no residue stays.
      const encoded = encodeSegment(sessionId);
      const project = dir.slice(0, dir.lastIndexOf(encoded));
      if (project.length > root.length) {
        try {
          await rmdir(project);
        } catch {
          /* ENOTEMPTY/ENOENT — other sessions live there or it is already gone. */
        }
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
