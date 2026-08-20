/**
 * dsh-session-nav host plugin entry.
 *
 * 纯浏览器端插件：Node half 只是 bundle 挂载载体（空 apply），全部行为在
 * lib/client.js——由 dsh.client.inject 在 web 客户端启动时注入。零宿主
 * 服务依赖、零数据通道、零核心改动。
 * @module dsh-session-nav
 */
export const name = 'dsh-session-nav';

/** Plugin body — intentionally empty. */
export function apply(_ctx) {}
