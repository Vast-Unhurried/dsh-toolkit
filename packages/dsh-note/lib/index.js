/**
 * dsh-note host plugin entry: registers the sticky-note API over the
 * webServer HTTP route. All storage logic lives in `api.ts`; the browser half
 * mounts the note button into the composer tool row (right of the access
 * selector) and calls this API to load and persist the note.
 * @module dsh-note
 */
import { apiHandler } from './api.js';

export const name = 'dsh-note';

/** Services this plugin needs before it can serve the note. */
export const inject = ['webServer'];

/** Plugin body. */
export function apply(ctx) {
  const web = ctx.get('webServer');
  if (web === undefined) return;

  const route = '/plugins/dsh-note/api';
  ctx.effect(() => web.register({
    kind: 'exact',
    path: route,
    handler: apiHandler(ctx),
  }), 'dsh-note: api route');
}
