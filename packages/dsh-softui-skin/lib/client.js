// dsh-softui-skin — browser half (client plugin bundle). GENERATED FILE:
// run `node scripts/build.mjs` to regenerate lib/client.js from
// src/client.tpl.js + themes/*.json.
//
// Loaded by dsh-client-modules at /plugins/dsh-softui-skin/client.js and
// executed through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with
// require() resolved against the shell's module table — the same shape the
// shipped ui-* packages' tsdown bundles emit.
//
// Behavior (native toggle):
//   • One system-native switch row in 设置 → 通用设置 → 外观, right below the
//     built-in Appearance row.
//   • ON  — the Neumorphism skin is applied as a token override layer on the
//     built-in ThemeRuntime (`overrideTokens`), plus a soft-UI shadow/grain
//     stylesheet. The light/dark variant is chosen per the harness's ACTIVE
//     native scheme (explicit light/dark, or system resolved via
//     prefers-color-scheme), so the skin always mirrors the native
//     appearance and follows OS flips when the native preference is
//     "system". The native preference and the settings document are never
//     written — toggling OFF restores the document exactly as shipped.
//   • OFF — everything is removed: no style tag, no body attribute, no token
//     layer.
//   • The toggle state is persisted in localStorage (`dsh-softui:enabled`) and
//     restored on every boot, so refresh / close / restart never revert the
//     skin to the native look while the toggle is ON.
window.__ModuleLoader__.load({
	id: "dsh-softui-skin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _runtime_client = require("@deepseek-ai/dsh-client-runtime/client");

		//#region dsh-softui-skin: definitions
		/** The settings row's locale namespace. */
		const SETTINGS_NS = "settings.softui";
		/** localStorage key holding the toggle state ("1" = on). The legacy
		 *  pre-rename key (`dsh-neu:enabled`) is migrated on first read. */
		const STORAGE_KEY = "dsh-softui:enabled";
		/** Layer identity for the ThemeRuntime token override. */
		const LAYER_SOURCE = "dsh-softui-skin";

		/**
		 * The Neumorphism skin as a per-mode token table for the built-in
		 * ThemeRuntime's `overrideTokens`: token name → { light, dark }. The
		 * presenter picks the value for the active color scheme, so the light
		 * variant applies under the native light scheme and the dark variant
		 * under the native dark scheme — the skin follows the native
		 * appearance with zero writes to the harness's own preference.
		 * Values are concrete CSS colors (no var() indirection) so every
		 * alias resolves on its own.
		 */
		const OVERRIDES = {
  "--dsw-static-deepseek-500": {
    "light": "#7180d5",
    "dark": "#8b99e8"
  },
  "--dsw-static-deepseek-200": {
    "light": "#c3cbef",
    "dark": "#5f6fae"
  },
  "--dsw-static-deepseek-100": {
    "light": "#e3e7f8",
    "dark": "#3a4162"
  },
  "--dsw-static-deepseek-50": {
    "light": "#f0f2fb",
    "dark": "#2c3147"
  },
  "--dsw-alias-bg-base": {
    "light": "#eae8e3",
    "dark": "#21242b"
  },
  "--dsw-alias-bg-layer-1": {
    "light": "#eae8e3",
    "dark": "#21242b"
  },
  "--dsw-alias-bg-layer-2": {
    "light": "#e3e0d9",
    "dark": "#2a2e38"
  },
  "--dsw-alias-bg-layer-3": {
    "light": "#dad6cd",
    "dark": "#333846"
  },
  "--dsw-alias-bg-overlay": {
    "light": "#f1efe9",
    "dark": "#272b35"
  },
  "--dsw-alias-bg-mask-1": {
    "light": "rgba(64, 62, 56, 0.28)",
    "dark": "rgba(0, 0, 0, 0.5)"
  },
  "--dsw-alias-bg-mask-2": {
    "light": "rgba(64, 62, 56, 0.12)",
    "dark": "rgba(0, 0, 0, 0.24)"
  },
  "--dsw-alias-bg-mask-3": {
    "light": "rgba(64, 62, 56, 0.5)",
    "dark": "rgba(0, 0, 0, 0.56)"
  },
  "--dsw-alias-bg-mask-photo": {
    "light": "rgba(0, 0, 0, 0.88)",
    "dark": "rgba(0, 0, 0, 0.88)"
  },
  "--dsw-alias-bg-mask-drop": {
    "light": "rgba(255, 255, 255, 0.7)",
    "dark": "rgba(33, 36, 43, 0.7)"
  },
  "--dsw-alias-bg-module-platform": {
    "light": "#e4e2da",
    "dark": "#2a2e38"
  },
  "--dsw-alias-bg-multi-select": {
    "light": "#e4e2da",
    "dark": "#2a2e38"
  },
  "--dsw-alias-bg-skeleton": {
    "light": "rgba(96, 94, 86, 0.1)",
    "dark": "rgba(255, 255, 255, 0.05)"
  },
  "--dsw-alias-border-inverted2": {
    "light": "rgba(255, 255, 255, 0)",
    "dark": "rgba(255, 255, 255, 0.08)"
  },
  "--dsw-alias-border-inverted": {
    "light": "rgba(255, 255, 255, 0)",
    "dark": "rgba(255, 255, 255, 0.06)"
  },
  "--dsw-alias-border-l1": {
    "light": "rgba(92, 89, 80, 0.1)",
    "dark": "rgba(255, 255, 255, 0.07)"
  },
  "--dsw-alias-border-l2-darkmode-thin": {
    "light": "rgba(92, 89, 80, 0.16)",
    "dark": "rgba(255, 255, 255, 0.12)"
  },
  "--dsw-alias-border-l2": {
    "light": "rgba(92, 89, 80, 0.16)",
    "dark": "rgba(255, 255, 255, 0.12)"
  },
  "--dsw-alias-border-l3": {
    "light": "rgba(92, 89, 80, 0.24)",
    "dark": "rgba(255, 255, 255, 0.18)"
  },
  "--dsw-alias-border-l4": {
    "light": "rgba(92, 89, 80, 0.34)",
    "dark": "rgba(255, 255, 255, 0.26)"
  },
  "--dsw-alias-brand-primary-invert": {
    "light": "#3b3a36",
    "dark": "#e7e9ef"
  },
  "--dsw-alias-brand-primary": {
    "light": "#7180d5",
    "dark": "#8b99e8"
  },
  "--dsw-alias-brand-text": {
    "light": "#ffffff",
    "dark": "#1e2129"
  },
  "--dsw-alias-button-contrast-fill": {
    "light": "#5f5d55",
    "dark": "#e7e9ef"
  },
  "--dsw-alias-button-elevated-fill": {
    "light": "#f1efe9",
    "dark": "#272b35"
  },
  "--dsw-alias-button-floating-fill": {
    "light": "#f1efe9",
    "dark": "#2a2e38"
  },
  "--dsw-alias-button-floating-hover": {
    "light": "#e7e5de",
    "dark": "#333846"
  },
  "--dsw-alias-button-ghost-active-border": {
    "light": "#c8c5ba",
    "dark": "#4a5061"
  },
  "--dsw-alias-button-ghost-active-fill": {
    "light": "#e4e1d9",
    "dark": "#2a2e38"
  },
  "--dsw-alias-button-ghost-active-hover": {
    "light": "#dbd8cf",
    "dark": "#333846"
  },
  "--dsw-alias-button-info-fill": {
    "light": "#7180d5",
    "dark": "#8b99e8"
  },
  "--dsw-alias-button-info-hover": {
    "light": "#8391db",
    "dark": "#9ca8ee"
  },
  "--dsw-alias-button-primary-dimmed": {
    "light": "#e0e3f4",
    "dark": "#343a4c"
  },
  "--dsw-alias-button-primary-fill": {
    "light": "#7180d5",
    "dark": "#8b99e8"
  },
  "--dsw-alias-button-primary-hover": {
    "light": "#8391db",
    "dark": "#9ca8ee"
  },
  "--dsw-alias-button-tool-bar-fill-invisible": {
    "light": "rgba(84, 82, 74, 0.28)",
    "dark": "rgba(255, 255, 255, 0.14)"
  },
  "--dsw-alias-button-tool-bar-fill": {
    "light": "rgba(84, 82, 74, 0.42)",
    "dark": "rgba(255, 255, 255, 0.2)"
  },
  "--dsw-alias-button-tool-bar-hover": {
    "light": "rgba(84, 82, 74, 0.55)",
    "dark": "rgba(255, 255, 255, 0.28)"
  },
  "--dsw-alias-interactive-bg-active": {
    "light": "rgba(92, 89, 80, 0.12)",
    "dark": "rgba(255, 255, 255, 0.1)"
  },
  "--dsw-alias-interactive-bg-hover-accent": {
    "light": "rgba(113, 128, 213, 0.12)",
    "dark": "rgba(139, 153, 232, 0.16)"
  },
  "--dsw-alias-interactive-bg-hover-danger": {
    "light": "rgba(207, 111, 103, 0.1)",
    "dark": "rgba(221, 134, 125, 0.14)"
  },
  "--dsw-alias-interactive-bg-hover-solid": {
    "light": "#e4e1d9",
    "dark": "#333846"
  },
  "--dsw-alias-interactive-bg-hover": {
    "light": "rgba(92, 89, 80, 0.07)",
    "dark": "rgba(255, 255, 255, 0.05)"
  },
  "--dsw-alias-label-caption": {
    "light": "#928f86",
    "dark": "#7e8494"
  },
  "--dsw-alias-label-dimmed": {
    "light": "#a9a69c",
    "dark": "#5e6473"
  },
  "--dsw-alias-label-primary-bluish": {
    "light": "#5c5f7a",
    "dark": "#c2c7e8"
  },
  "--dsw-alias-label-primary-dimmed": {
    "light": "#3b3a36",
    "dark": "#e7e9ef"
  },
  "--dsw-alias-label-primary-foreground": {
    "light": "#ffffff",
    "dark": "#1e2129"
  },
  "--dsw-alias-label-primary-inverted": {
    "light": "#ffffff",
    "dark": "#1e2129"
  },
  "--dsw-alias-label-primary": {
    "light": "#3b3a36",
    "dark": "#e7e9ef"
  },
  "--dsw-alias-label-secondary": {
    "light": "#6f6d66",
    "dark": "#a3a8b5"
  },
  "--dsw-alias-label-tertiary": {
    "light": "#928f86",
    "dark": "#7e8494"
  },
  "--dsw-alias-markdown-citation": {
    "light": "#e4e1d9",
    "dark": "#2a2e38"
  },
  "--dsw-alias-markdown-code-block-banner": {
    "light": "#e3e0d8",
    "dark": "#272b35"
  },
  "--dsw-alias-markdown-code-block": {
    "light": "#e3e0d8",
    "dark": "#272b35"
  },
  "--dsw-alias-markdown-code-segment-selected": {
    "light": "#ecebe6",
    "dark": "#2f3440"
  },
  "--dsw-alias-markdown-code-segment-unselected": {
    "light": "#e0ddd5",
    "dark": "#242832"
  },
  "--dsw-alias-markdown-inline-code": {
    "light": "#e4e1d9",
    "dark": "#2a2e38"
  },
  "--dsw-alias-markdown-placeholder": {
    "light": "#c4c1b7",
    "dark": "#565c6b"
  },
  "--dsw-alias-markdown-tag": {
    "light": "#e4e1d9",
    "dark": "#2a2e38"
  },
  "--dsw-alias-scrollbar-bg-l1": {
    "light": "#d6d3ca",
    "dark": "#333846"
  },
  "--dsw-alias-scrollbar-bg-l2": {
    "light": "#d0cdc4",
    "dark": "#3a4050"
  },
  "--dsw-alias-scrollbar-hover-l1": {
    "light": "#bcb9af",
    "dark": "#4a5061"
  },
  "--dsw-alias-scrollbar-hover-l2": {
    "light": "#bcb9af",
    "dark": "#4a5061"
  },
  "--dsw-alias-state-business-primary": {
    "light": "#7180d5",
    "dark": "#8b99e8"
  },
  "--dsw-alias-state-business-tertiary": {
    "light": "#e3e7f8",
    "dark": "#343a4c"
  },
  "--dsw-alias-state-error-primary": {
    "light": "#cf6f67",
    "dark": "#dd867d"
  },
  "--dsw-alias-state-error-secondary": {
    "light": "#e09790",
    "dark": "#c96f66"
  },
  "--dsw-alias-state-success-primary": {
    "light": "#6f9e7c",
    "dark": "#84b48f"
  },
  "--dsw-alias-state-success-secondary": {
    "light": "#93b99d",
    "dark": "#6ca07a"
  },
  "--dsw-alias-state-success-tertiary": {
    "light": "#e2ede4",
    "dark": "#2d3f34"
  },
  "--dsw-alias-state-warn-label": {
    "light": "#b98542",
    "dark": "#e0b377"
  },
  "--dsw-alias-state-warn-primary": {
    "light": "#cf9857",
    "dark": "#d9a76a"
  },
  "--dsw-alias-state-warn-secondary": {
    "light": "#ddad72",
    "dark": "#c08f4f"
  },
  "--dsw-alias-state-warn-tertiary": {
    "light": "#f6ecdb",
    "dark": "#4a3c28"
  },
  "--dsw-alias-toast-bg": {
    "light": "#5f5d55",
    "dark": "#333846"
  },
  "--dsw-alias-tooltip-bg": {
    "light": "#4e4c45",
    "dark": "#3a4050"
  },
  "--dsw-specific-bubble-highlight": {
    "light": "#dfe4f6",
    "dark": "#454f85"
  },
  "--dsw-specific-bubble": {
    "light": "#f1efe9",
    "dark": "#272b35"
  },
  "--dsw-specific-input-major": {
    "light": "#eae8e3",
    "dark": "#1d2027"
  },
  "--dsw-specific-login-input": {
    "light": "#e4e1d9",
    "dark": "#272b35"
  },
  "--dsw-specific-menu": {
    "light": "#f1efe9",
    "dark": "#2a2e38"
  },
  "--dsw-specific-selector": {
    "light": "#e4e1d9",
    "dark": "#333846"
  },
  "--dsw-specific-sidebar-fill": {
    "light": "#e5e3dc",
    "dark": "#262a33"
  },
  "--dsw-specific-sidebar-nav-item-active-accent": {
    "light": "rgba(113, 128, 213, 0.16)",
    "dark": "rgba(139, 153, 232, 0.2)"
  },
  "--dsw-specific-sidebar-nav-item-active": {
    "light": "#e3e0d9",
    "dark": "#2a2e38"
  },
  "--dsw-specific-sidebar-nav-item-hover": {
    "light": "#e4e2da",
    "dark": "#262a33"
  },
  "--dsw-specific-tip": {
    "light": "#e4e1d9",
    "dark": "#2a2e38"
  },
  "--shiki-foreground": {
    "light": "#3b3a36",
    "dark": "#e7e9ef"
  },
  "--shiki-background": {
    "light": "#e3e0d8",
    "dark": "#272b35"
  },
  "--shiki-token-constant": {
    "light": "#b0712f",
    "dark": "#e0ad68"
  },
  "--shiki-token-string": {
    "light": "#5d8f6b",
    "dark": "#9cc9a4"
  },
  "--shiki-token-comment": {
    "light": "#9b988f",
    "dark": "#6b7180"
  },
  "--shiki-token-keyword": {
    "light": "#7a68b8",
    "dark": "#b3a5e8"
  },
  "--shiki-token-parameter": {
    "light": "#c06a60",
    "dark": "#e39b90"
  },
  "--shiki-token-function": {
    "light": "#5a6fb5",
    "dark": "#8fa8e8"
  },
  "--shiki-token-string-expression": {
    "light": "#5d8f6b",
    "dark": "#9cc9a4"
  },
  "--shiki-token-punctuation": {
    "light": "#8a877f",
    "dark": "#8b90a0"
  },
  "--shiki-token-link": {
    "light": "#4f8a94",
    "dark": "#7fc3cf"
  }
};

		/**
		 * Soft-UI enhancement stylesheet, injected while the skin is ON.
		 * Neumorphism is as much about shadow as color, and the product token
		 * system only owns colors — so the plugin adds a small shadow + micro
		 * motion layer keyed off stable document hooks. Every rule is scoped
		 * under body[data-dsh-softui] (set by apply, removed by the disposer).
		 *
		 * Selector discipline (learned the hard way): every hook is verified
		 * in the official UI sources —
		 *   • AppFrame renders the sidebar grid column as css.sidebarCol
		 *     (hash-suffixed module class, stable substring "sidebarCol");
		 *   • InputBar renders the composer capsule with data-composer-card;
		 *   • ChatNodeSeat renders data-chat-flow-kind={node.kind} and
		 *     MessageItem's user/steering bubble carries the hashed .bubble
		 *     class.
		 * These three surfaces get the neumorphic treatment; everything else
		 * stays untouched. Micro-interactions are CSS-only transitions under
		 * @media (prefers-reduced-motion: no-preference) — hover lifts the
		 * bubble, hover/focus-within deepens the composer recess (keyboard
		 * reachable), and the sidebar keeps its static raise.
		 */
		const NEU_CSS = [
			"body[data-dsh-softui] {",
						"  --dsh-softui-raise: inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(122, 118, 108, 0.18), 6px 6px 14px rgba(122, 118, 108, 0.22), -6px -6px 14px rgba(255, 255, 255, 0.85);",
						"  --dsh-softui-raise-sm: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 2px rgba(122, 118, 108, 0.14), 3px 3px 8px rgba(122, 118, 108, 0.18), -3px -3px 8px rgba(255, 255, 255, 0.75);",
			"  --dsh-softui-inset: inset 3px 3px 8px rgba(122, 118, 108, 0.16), inset -3px -3px 8px rgba(255, 255, 255, 0.3);",
			"  --dsh-softui-inset-focus: inset 4px 4px 10px rgba(122, 118, 108, 0.22), inset -4px -4px 10px rgba(255, 255, 255, 0.4);",
			"  /* Ambient light: a soft top glow plus a faint bottom-right fill,",
			"     then a fine grain texture over the whole canvas. background-image",
			"     layers on top of the shell background (higher specificity), so the",
			"     token background-color stays intact. */",
			"  background-image:",
			"    radial-gradient(1400px 900px at 50% -8%, rgba(255, 255, 255, 0.72), transparent 62%),",
			"    radial-gradient(900px 600px at 85% 110%, rgba(255, 255, 255, 0.3), transparent 60%),",
			    "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.08%27/%3E%3C/svg%3E\");",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] {",
						"  --dsh-softui-raise: inset 0 1px 0 rgba(255, 255, 255, 0.13), 0 1px 2px rgba(0, 0, 0, 0.4), 6px 6px 14px rgba(0, 0, 0, 0.45), -6px -6px 14px rgba(255, 255, 255, 0.05);",
						"  --dsh-softui-raise-sm: inset 0 1px 0 rgba(255, 255, 255, 0.11), 0 1px 2px rgba(0, 0, 0, 0.32), 3px 3px 8px rgba(0, 0, 0, 0.4), -3px -3px 8px rgba(255, 255, 255, 0.04);",
			"  --dsh-softui-inset: inset 3px 3px 8px rgba(0, 0, 0, 0.5), inset -3px -3px 8px rgba(255, 255, 255, 0.06);",
			"  --dsh-softui-inset-focus: inset 4px 4px 10px rgba(0, 0, 0, 0.6), inset -4px -4px 10px rgba(255, 255, 255, 0.08);",
			"  background-image:",
			"    radial-gradient(1400px 900px at 50% -8%, rgba(255, 255, 255, 0.06), transparent 62%),",
			"    radial-gradient(900px 600px at 85% 110%, rgba(0, 0, 0, 0.4), transparent 60%),",
			    "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.1%27/%3E%3C/svg%3E\");",
			"}",
			"/* Sidebar column: a soft raised card over the canvas (AppFrame's",
			"   css.sidebarCol — verified in ui-layout sources). */",
			"body[data-dsh-softui] [class*='sidebarCol'] {",
			"  background-image:",
						"    linear-gradient(145deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0) 32%),",
			"    url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.08%27/%3E%3C/svg%3E\");",
			"  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9),",
			"              0 2px 6px rgba(122, 118, 108, 0.22),",
			"              10px 10px 24px rgba(122, 118, 108, 0.26),",
			"              -8px -8px 20px rgba(255, 255, 255, 0.9);",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] [class*='sidebarCol'] {",
			"  background-image:",
						"    linear-gradient(145deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0) 32%),",
			"    url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.1%27/%3E%3C/svg%3E\");",
			"  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14),",
			"              0 2px 6px rgba(0, 0, 0, 0.45),",
			"              10px 10px 24px rgba(0, 0, 0, 0.5),",
			"              -8px -8px 20px rgba(255, 255, 255, 0.06);",
			"}",
			"/* Glassmorphism: the composer and its popovers share one DOM subtree.",
			"   Keep the card's frost on a sibling pseudo-layer so the card does not",
			"   become the popovers' backdrop root. Menus and the context dialog can",
			"   then each apply their own real backdrop blur. */",
			"body[data-dsh-softui] [role='menu'],",
			"body[data-dsh-softui] [data-composer-card] [role='dialog'] {",
			"  background-color: color-mix(in srgb, var(--dsw-alias-bg-overlay) 55%, transparent);",
			"  backdrop-filter: blur(16px) saturate(1.3);",
			"  -webkit-backdrop-filter: blur(16px) saturate(1.3);",
			"  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] [role='menu'],",
			"body[data-dsh-softui][data-ds-dark-theme] [data-composer-card] [role='dialog'] {",
			"  background-color: color-mix(in srgb, var(--dsw-alias-bg-overlay) 62%, transparent);",
			"  backdrop-filter: blur(16px) saturate(1.3);",
			"  -webkit-backdrop-filter: blur(16px) saturate(1.3);",
			"  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);",
			"}",
			"/* Composer capsule: put the frost on a non-ancestor pseudo-layer. This",
			"   preserves the card's glass appearance without preventing nested",
			"   permission/model/context surfaces from sampling the page behind them. */",
			"body[data-dsh-softui] [data-composer-card] {",
			"  position: relative;",
			"  z-index: 0;",
			"  background-color: transparent;",
			"  backdrop-filter: none;",
			"  -webkit-backdrop-filter: none;",
			"  box-shadow: var(--dsh-softui-inset);",
			"}",
			"body[data-dsh-softui] [data-composer-card]::before {",
			"  content: '';",
			"  position: absolute;",
			"  inset: 0;",
			"  z-index: -1;",
			"  border-radius: inherit;",
			"  background-color: color-mix(in srgb, var(--dsw-specific-input-major) 40%, transparent);",
			"  backdrop-filter: blur(8px) saturate(1.15);",
			"  -webkit-backdrop-filter: blur(8px) saturate(1.15);",
			"  pointer-events: none;",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] [data-composer-card] {",
			"  background-color: transparent;",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] [data-composer-card]::before {",
			"  background-color: color-mix(in srgb, var(--dsw-specific-input-major) 45%, transparent);",
			"}",

			"body[data-dsh-softui] div[data-phase] {",
			"  background-image:",
			"    radial-gradient(1100px 700px at 50% -6%, rgba(255, 255, 255, 0.55), transparent 62%),",
			"    url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.08%27/%3E%3C/svg%3E\");",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] div[data-phase] {",
			"  background-image:",
			"    radial-gradient(1100px 700px at 50% -6%, rgba(255, 255, 255, 0.055), transparent 62%),",
			"    url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.1%27/%3E%3C/svg%3E\");",
			"}",
			"/* Details panel keeps the same grain. */",
			"body[data-dsh-softui] [class*='detailsCol'] {",
			"  background-image: url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.08%27/%3E%3C/svg%3E\");",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] [class*='detailsCol'] {",
			"  background-image: url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.1%27/%3E%3C/svg%3E\");",
			"}",
			"/* User and consumed-steering bubbles: barely-raised chips with a",
			"   gloss gradient across the surface (ChatNodeSeat's",
			"   data-chat-flow-kind + MessageItem's .bubble). */",
			"body[data-dsh-softui] [data-chat-flow-kind='user'] [class*='bubble'],",
			"body[data-dsh-softui] [data-chat-flow-kind='steering'] [class*='bubble'] {",
			"  box-shadow: var(--dsh-softui-raise-sm);",
			"  background-image: linear-gradient(145deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0) 42%);",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] [data-chat-flow-kind='user'] [class*='bubble'],",
			"body[data-dsh-softui][data-ds-dark-theme] [data-chat-flow-kind='steering'] [class*='bubble'] {",
			"  background-image: linear-gradient(145deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0) 42%);",
			"}",
			"/* Code blocks: a recessed well with a softer radius and a material",
			"   surface — dark top inner wall (backlit), grain texture (CodeBlock's",
			"   stable md-code-block class — verified in ui-primitives sources). */",
			"body[data-dsh-softui] .md-code-block {",
			"  border-radius: 16px;",
			"  background-image:",
			"    linear-gradient(180deg, rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0) 28%),",
			    "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.08%27/%3E%3C/svg%3E\");",
			"  box-shadow: var(--dsh-softui-inset);",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] .md-code-block {",
			"  background-image:",
			"    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0) 28%),",
			    "url(\"data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27160%27 height=%27160%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.8%27 numOctaves=%272%27 stitchTiles=%27stitch%27/%3E%3CfeColorMatrix type=%27saturate%27 values=%270%27/%3E%3C/filter%3E%3Crect width=%27160%27 height=%27160%27 filter=%27url(%23n)%27 opacity=%270.1%27/%3E%3C/svg%3E\");",
			"}",
			"/* Tool rows and their nested sub-calls (e.g. the indented bash row",
			"   under run_code): one unified raised card — same-family surface,",
			"   rounded corners, gloss gradient, so outer call and inner sub-call",
			"   read as one material (ToolRow's data-tool + ToolCallTree's",
			"   data-subcalls — ui-tool sources). */",
			"body[data-dsh-softui] [data-tool] {",
			"  background-color: var(--dsw-alias-bg-layer-1);",
			"  background-image: linear-gradient(145deg, rgba(255, 255, 255, 0.68), rgba(255, 255, 255, 0) 42%);",
			"  border-radius: 12px;",
			"  box-shadow: var(--dsh-softui-raise-sm);",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] [data-tool] {",
			"  background-image: linear-gradient(145deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0) 42%);",
			"}",
			"/* Reasoning rows: same card language as tool rows (ReasoningRow's",
			"   data-variant='think' — ui-conversation sources). */",
			"body[data-dsh-softui] [data-variant='think'] {",
			"  background-color: var(--dsw-alias-bg-layer-1);",
			"  background-image: linear-gradient(145deg, rgba(255, 255, 255, 0.68), rgba(255, 255, 255, 0) 42%);",
			"  border-radius: 12px;",
			"  box-shadow: var(--dsh-softui-raise-sm);",
			"}",
			"body[data-dsh-softui][data-ds-dark-theme] [data-variant='think'] {",
			"  background-image: linear-gradient(145deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0) 42%);",
			"}",
			"/* Micro-interactions: CSS-only, gated on reduced-motion (matching",
			"   the official ReasoningRow shimmer gate). */",
			"@media (prefers-reduced-motion: no-preference) {",
			"  /* Conversation nodes fade in softly as they mount (ChatNodeSeat's",
			"     data-chat-flow-key; streaming updates do not remount, so the",
			"     animation plays once per node). */",
			"  @keyframes dsh-softui-enter {",
			"    from { opacity: 0; transform: translateY(4px); }",
			"    to { opacity: 1; transform: none; }",
			"  }",
			"  body[data-dsh-softui] [data-chat-flow-key] {",
			"    animation: dsh-softui-enter 220ms ease-out both;",
			"  }",
			"  /* User/steering bubbles: lift on hover. */",
			"  body[data-dsh-softui] [data-chat-flow-kind='user'] [class*='bubble'],",
			"  body[data-dsh-softui] [data-chat-flow-kind='steering'] [class*='bubble'] {",
			"    transition: box-shadow 160ms ease, transform 160ms ease;",
			"  }",
			"  body[data-dsh-softui] [data-chat-flow-kind='user'] [class*='bubble']:hover,",
			"  body[data-dsh-softui] [data-chat-flow-kind='steering'] [class*='bubble']:hover {",
			"    transform: translateY(-1px);",
			"    box-shadow: var(--dsh-softui-raise);",
			"  }",
			"  /* Composer: recess deepens on hover and keyboard focus. */",
			"  body[data-dsh-softui] [data-composer-card] {",
			"    transition: box-shadow 160ms ease;",
			"  }",
			"  body[data-dsh-softui] [data-composer-card]:hover,",
			"  body[data-dsh-softui] [data-composer-card]:focus-within {",
			"    box-shadow: var(--dsh-softui-inset-focus);",
			"  }",
			"  /* Tool rows (outer call and nested sub-calls alike): lift on",
			"     hover (shadow only — no transform, so internal sticky/absolute",
			"     geometry stays anchored). */",
			"  body[data-dsh-softui] [data-tool] {",
			"    transition: box-shadow 160ms ease;",
			"  }",
			"  body[data-dsh-softui] [data-tool]:hover {",
			"    box-shadow: var(--dsh-softui-raise);",
			"  }",
			"  /* Reasoning rows: hover reveals a slightly stronger raise. */",
			"  body[data-dsh-softui] [data-variant='think'] {",
			"    transition: box-shadow 160ms ease;",
			"  }",
			"  body[data-dsh-softui] [data-variant='think']:hover {",
			"    box-shadow: var(--dsh-softui-raise);",
			"  }",
			"  /* Code blocks: recess deepens on hover (copy button reachable",
			"     by keyboard — hover is decorative only). */",
			"  body[data-dsh-softui] .md-code-block {",
			"    transition: box-shadow 160ms ease;",
			"  }",
			"  body[data-dsh-softui] .md-code-block:hover {",
			"    box-shadow: var(--dsh-softui-inset-focus);",
			"  }",
			"  /* Workspace/session tree rows: smooth background on hover state",
			"     changes (aria role — stable). */",
			"  body[data-dsh-softui] [role='treeitem'] {",
			"    transition: background-color 160ms ease;",
			"  }",
			"}",
		].join("\n");

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"skin.title": "轻拟物皮肤",
			"skin.caption": "Neumorphism · 柔和浮起与凹陷 · 浅色/深色跟随系统原生外观",
			"skin.switchLabel": "启用轻拟物皮肤"
		};

		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"skin.title": "Neumorphism skin",
			"skin.caption": "Soft-UI · gentle depth · light/dark follows the native appearance",
			"skin.switchLabel": "Enable the Neumorphism skin"
		};
		//#endregion

		//#region dsh-softui-skin: persistence
		/** Read a localStorage string value (null on absence or error). */
		function readStorage(key) {
			try {
				const value = window.localStorage.getItem(key);
				return typeof value === "string" ? value : null;
			} catch {
				return null;
			}
		}

		/** Write (or remove with null) a localStorage value. */
		function writeStorage(key, value) {
			try {
				if (value === null) window.localStorage.removeItem(key);
				else window.localStorage.setItem(key, value);
			} catch {
				// storage unavailable / quota — the preference stays process-local
			}
		}

		/** Whether the saved toggle state is on ("1"); migrates the legacy
		 *  pre-rename key (`dsh-neu:enabled`) on first read and removes it. */
		function readSavedEnabled() {
			const value = readStorage(STORAGE_KEY);
			if (value !== null) return value === "1";
			const legacy = readStorage("dsh-neu:enabled");
			if (legacy !== null) {
				writeStorage(STORAGE_KEY, legacy);
				writeStorage("dsh-neu:enabled", null);
				return legacy === "1";
			}
			return false;
		}

		/** Persist the toggle state. */
		function writeSavedEnabled(enabled) {
			writeStorage(STORAGE_KEY, enabled ? "1" : "0");
		}
		//#endregion

		//#region dsh-softui-skin: settings row store
		/**
		 * Toggle row slot store: holds the plugin-owned enabled state. The
		 * row component reads via props.useStore; the injected face writes
		 * through the store action and the skin lifecycle in lockstep.
		 */
		function createSkinStore() {
			return (0, _runtime_client.defineStore)({
				init: () => ({
					enabled: readSavedEnabled()
				}),
				actions: {
					setEnabled: (d, enabled) => {
						d.enabled = enabled;
					}
				}
			});
		}
		//#endregion

		//#region dsh-softui-skin: settings row
		/**
		 * Native-looking switch row registered into the Settings → General
		 * item slot, right after the built-in Appearance row. The switch is
		 * styled with the harness's own design tokens so it reads as a
		 * system-native control in both schemes.
		 */
		const styles = {
			group: {
				borderBottom: "1px solid var(--dsw-alias-border-l2)",
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				padding: "16px 0"
			},
			line: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "16px"
			},
			text: {
				display: "flex",
				flexDirection: "column",
				gap: "2px",
				minWidth: "0"
			},
			title: {
				color: "var(--dsw-alias-label-primary)",
				fontSize: "14px",
				fontWeight: 400,
				lineHeight: "22px"
			},
			caption: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: "12px",
				lineHeight: "18px"
			},
			switch: {
				flex: "none",
				boxSizing: "border-box",
				width: "38px",
				height: "22px",
				padding: "0",
				border: "1px solid var(--dsw-alias-border-l3)",
				borderRadius: "999px",
				background: "var(--dsw-alias-interactive-bg-active)",
				cursor: "pointer",
				display: "flex",
				alignItems: "center",
				position: "relative",
				transition: "background-color 150ms ease, border-color 150ms ease"
			},
			switchOn: {
				background: "var(--dsw-alias-brand-primary)",
				borderColor: "var(--dsw-alias-brand-primary)"
			},
			thumb: {
				position: "absolute",
				left: "2px",
				top: "50%",
				transform: "translateY(-50%)",
				width: "16px",
				height: "16px",
				borderRadius: "999px",
				background: "var(--dsw-static-neutral-00)",
				boxShadow: "0 1px 2px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.04)",
				transition: "transform 150ms ease"
			},
			thumbOn: {
				transform: "translateY(-50%) translateX(16px)"
			}
		};

		/** Row-level stylesheet (always mounted — the row is always present):
		 *  keyboard focus ring and hover affordance for the native switch. */
		const ROW_CSS = [
			".dsh-softui-switch:focus-visible {",
			"  outline: 2px solid var(--dsw-alias-border-l3);",
			"  outline-offset: 2px;",
			"}",
			".dsh-softui-switch:disabled {",
			"  opacity: 0.5;",
			"  cursor: default;",
			"}"
		].join("\n");

		/** The toggle row: title + caption on the left, native switch right. */
		function SkinToggleRow({ t, setEnabled, useStore }) {
			const enabled = useStore((s) => s.enabled);
			return react.createElement("div", { style: styles.group },
				react.createElement("div", { style: styles.line },
					react.createElement("div", { style: styles.text },
						react.createElement("div", { style: styles.title }, t("skin.title")),
						react.createElement("div", { style: styles.caption }, t("skin.caption"))
					),
					react.createElement("button", {
						type: "button",
						role: "switch",
						"aria-checked": enabled,
						"aria-label": t("skin.switchLabel"),
						title: t("skin.switchLabel"),
						className: "dsh-softui-switch",
						onClick: () => {
							setEnabled(!enabled);
						},
						style: {
							...styles.switch,
							...(enabled ? styles.switchOn : {})
						}
					},
						react.createElement("span", {
							style: {
								...styles.thumb,
								...(enabled ? styles.thumbOn : {})
							}
						})
					)
				)
			);
		}
		//#endregion

		//#region dsh-softui-skin: client plugin body
		/**
		 * Required services: theme runtime (token override layer), slots and
		 * locale (the settings row). Persistence is localStorage, so no
		 * settings transport is needed and the harness's own preference is
		 * never touched.
		 */
		const inject = [
			"slots",
			"locale",
			"theme"
		];

		/**
		 * Client plugin body: keep the soft-UI layer in lockstep with the
		 * persisted toggle, restore the saved state at boot, and register the
		 * native switch row into Settings → General.
		 * @param ctx - client cordis context.
		 */
		function apply(ctx) {
			//#region skin lifecycle
			let active = null; // { disposeOverride, styleNode }
			const enableSkin = () => {
				if (active !== null) return;
				const disposeOverride = ctx.theme.overrideTokens(LAYER_SOURCE, OVERRIDES);
				const styleNode = document.createElement("style");
				styleNode.dataset.plugin = "dsh-softui-skin";
				styleNode.dataset.pluginCss = "dsh-softui-skin/soft-ui";
				styleNode.textContent = NEU_CSS;
				document.head.append(styleNode);
				document.body.dataset.dshSoftui = "";
				active = { disposeOverride, styleNode };
			};
			const disableSkin = () => {
				if (active === null) return;
				active.disposeOverride();
				active.styleNode.remove();
				delete document.body.dataset.dshSoftui;
				active = null;
			};
			// Restore the saved state once, before any user interaction —
			// the document lands directly in the persisted look (no flash of
			// the native appearance when the toggle is on).
			if (readSavedEnabled()) enableSkin();
			// Fiber teardown (page unload, HMR swap) restores the document
			// exactly as the harness shipped it.
			ctx.effect(() => () => {
				disableSkin();
			}, "dsh-softui-skin: soft-ui skin layer");
			//#endregion

			// Row stylesheet (always present, follows the fiber lifetime).
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-softui-skin";
				tag.dataset.pluginCss = "dsh-softui-skin/row";
				tag.textContent = ROW_CSS;
				document.head.append(tag);
				return () => {
					tag.remove();
				};
			}, "dsh-softui-skin: settings row stylesheet");

			ctx.effect(() => ctx.locale.register(SETTINGS_NS, {
				zh,
				en
			}), "dsh-softui-skin: settings row dictionaries");

			const skinStore = createSkinStore();
			let bound;
			const injected = (actions) => {
				bound = actions;
				return {
					setEnabled: (enabled) => {
						bound.setEnabled(enabled);
						if (enabled) enableSkin();
						else disableSkin();
						writeSavedEnabled(enabled);
					}
				};
			};
			// Cross-tab consistency: another tab toggling the skin applies or
			// removes it here too (localStorage is shared per origin).
			const onStorage = (event) => {
				if (event.key !== STORAGE_KEY) return;
				const enabled = event.newValue === "1";
				bound?.setEnabled(enabled);
				if (enabled) enableSkin();
				else disableSkin();
			};
			window.addEventListener("storage", onStorage);
			ctx.effect(() => () => {
				window.removeEventListener("storage", onStorage);
			}, "dsh-softui-skin: cross-tab sync");
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "softui-skin",
				order: 19,
				store: skinStore,
				locale: SETTINGS_NS,
				inject: injected
			}, SkinToggleRow));
		}
		//#endregion

		exports.OVERRIDES = OVERRIDES;
		exports.STORAGE_KEY = STORAGE_KEY;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
