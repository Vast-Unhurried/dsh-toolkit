/**
 * dsh-api-balance host plugin entry: registers the balance API over the
 * webServer HTTP route. All balance logic lives in `api.js`; the browser half
 * renders the balance badge and per-turn cost labels.
 * @module dsh-api-balance
 */
import { apiHandler } from './api.js';

export const name = 'api-balance';

/** Services this plugin needs before it can serve balance queries. */
export const inject = [
  'webServer',
];

/** Plugin body. */
export function apply(ctx) {
  const web = ctx.get('webServer');
  if (web === undefined) return;

  const route = '/plugins/api-balance/api';
  ctx.effect(() => web.register({
    kind: 'exact',
    path: route,
    handler: apiHandler(ctx),
  }), 'dsh-api-balance: api route');
}
