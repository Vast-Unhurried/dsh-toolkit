/**
 * dsh-api-balance host plugin entry: registers the balance API over the
 * webServer HTTP route and installs the host-side local-accounting ledger
 * (subscribes the global session event stream so every settled turn across
 * all sessions is priced). All balance logic lives in `api.js`; the browser
 * half renders the balance badge and per-turn cost labels.
 * @module dsh-api-balance
 */
import { apiHandler, attachLocalLedger, backfillTodayUsage } from './api.js';

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

  // Local accounting: record every settled assistant turn (any session,
  // parallel conversations included) that matches a local-accounting
  // provider. Idempotent per session:message; never throws into the stream.
  ctx.effect(() => attachLocalLedger(ctx), 'dsh-api-balance: local ledger');

  // Backfill today's usage from persisted session logs (short delay, off the
  // boot path) so 今日消耗 starts at the Beijing-time day boundary instead of
  // this process's boot time — matching the DeepSeek usage page's day.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      backfillTodayUsage(ctx)
        .then((added) => {
          if (added > 0) ctx.logger.info(`dsh-api-balance: backfilled ${added} turn(s) into today's usage`);
        })
        .catch(() => { /* best effort */ });
    }, 500);
    return () => { clearTimeout(timer); };
  }, 'dsh-api-balance: today usage backfill');
}
