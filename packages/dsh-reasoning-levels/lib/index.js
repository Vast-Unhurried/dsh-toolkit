/**
 * dsh-reasoning-levels host plugin entry: registers the reasoning-levels
 * diagnostic API over the webServer HTTP route and, at boot, auto-declares
 * the five reasoning tiers (low / medium / high / xhigh / max) for every
 * user-declared pi-ai model that has no `reasoningEfforts` of its own, so the
 * OFFICIAL model selector shows the five-tier reasoning pane for third-party
 * models. Models opted out with `reasoningEfforts: false` (e.g. grok) and
 * models with an existing declaration are left untouched; the official
 * DeepSeek route is never touched.
 * @module dsh-reasoning-levels
 */
import { apiHandler, ensureAllDeclared } from './api.js';

export const name = 'reasoning-levels';

/** Services this plugin needs before it can serve reasoning queries. */
export const inject = [
  'webServer',
  'apiProxy',
  'settings',
  'llm',
];

/** Plugin body. */
export function apply(ctx) {
  const web = ctx.get('webServer');
  if (web !== undefined) {
    const route = '/plugins/reasoning-levels/api';
    ctx.effect(() => web.register({
      kind: 'exact',
      path: route,
      handler: apiHandler(ctx),
    }), 'dsh-reasoning-levels: api route');
  }

  // Boot-time sweep: declare the five tiers for every undeclared pi-ai model.
  // Idempotent — once everything is declared, later boots write nothing.
  ctx.effect(() => {
    const timer = setTimeout(() => {
      ensureAllDeclared(ctx)
        .then((result) => {
          if (result.ok) {
            if (result.patched > 0) ctx.logger.info(`dsh-reasoning-levels: auto-declared five reasoning tiers for ${result.patched} model(s)`);
          } else {
            ctx.logger.warn(`dsh-reasoning-levels: ${result.message}`);
          }
        })
        .catch((error) => {
          ctx.logger.warn(`dsh-reasoning-levels: boot sweep failed: ${String(error)}`);
        });
    }, 1000);
    return () => { clearTimeout(timer); };
  }, 'dsh-reasoning-levels: boot sweep');
}
