/**
 * dsh-session-delete host plugin entry: registers the session-delete API over
 * the webServer HTTP route. All deletion logic lives in `delete.ts`; HTTP
 * helpers and the route handler in `http.ts`. The browser half injects the
 * 「删除会话」 entry into the native session ⋮ menu and calls this API.
 * @module dsh-session-delete
 */
import { apiHandler } from './http.js';

export const name = 'session-delete';

/** Services this plugin needs before it can serve deletions. */
export const inject = [
  'webServer',
  'sessions',
  'agents',
  'workspaceRegistry',
  'sessionPersistence',
];

/** Plugin body. */
export function apply(ctx) {
  const web = ctx.get('webServer');
  if (web === undefined) return;

  const route = '/plugins/session-delete/api';
  ctx.effect(() => web.register({
    kind: 'exact',
    path: route,
    handler: apiHandler(ctx),
  }), 'dsh-session-delete: api route');
}
