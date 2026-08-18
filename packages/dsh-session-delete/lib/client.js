/**
 * dsh-session-delete browser half (hand-written bundle, no build step).
 *
 * Adds 「删除会话」 to the native session ⋮ menu:
 *   - a capture-phase click listener records which session row opened the
 *     menu (the menu itself is a portal with no session id in the DOM);
 *   - a MutationObserver injects the delete item into the native menu when it
 *     appears (menus render as `div[role="menu"]` with `button[role="menuitem"]`
 *     rows; the session menu is identified by its 归档/Archive row);
 *   - clicking it opens a confirm overlay (registered into `shell.overlay`),
 *     then calls the host API `/plugins/session-delete/api`, then reloads.
 *
 * The session id is resolved by matching the row title against the client
 * sessions store's `displayTitle` (with the blank-session "新会话" label),
 * disambiguating duplicate titles by DOM row position.
 * @module dsh-session-delete/client
 */
window.__ModuleLoader__.load({
	id: "dsh-session-delete",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let React = require("react");

		//#region strings
		const ZH = {
			"menu.delete": "删除会话",
			"modal.title": "删除会话",
			"modal.body": "确定要删除会话「{title}」吗？此操作不可恢复：对话记录及其文件将被彻底删除。",
			"modal.cancel": "取消",
			"modal.confirm": "删除",
			"modal.deleting": "删除中…",
			"modal.error.unresolved": "无法确定要删除的会话，请重试",
			"modal.error.failed": "删除失败：{error}",
			"modal.sessionId": "会话 ID：{id}",
		};
		const EN = {
			"menu.delete": "Delete session",
			"modal.title": "Delete session",
			"modal.body": "Delete session “{title}”? This cannot be undone: the conversation and its files will be permanently removed.",
			"modal.cancel": "Cancel",
			"modal.confirm": "Delete",
			"modal.deleting": "Deleting…",
			"modal.error.unresolved": "Could not resolve the session, please retry",
			"modal.error.failed": "Delete failed: {error}",
			"modal.sessionId": "Session ID: {id}",
		};
		const pick = (zh, key, vars) => {
			let s = (zh ? ZH : EN)[key] ?? key;
			if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, String(vars[k]));
			return s;
		};
		//#endregion

		//#region store
		/** Browser-local store sharing the pending-delete state with the overlay. */
		var DeleteStore = class {
			state = null; // { sessionId, title, zh, busy, error } | null
			listeners = new Set();
			get() {
				return this.state;
			}
			set(next) {
				this.state = next;
				for (const fn of this.listeners) fn();
			}
			subscribe(fn) {
				this.listeners.add(fn);
				return () => {
					this.listeners.delete(fn);
				};
			}
		};
		//#endregion

		//#region overlay
		/** React hook: re-render on every store change. */
		function useStore(store) {
			const [, setTick] = React.useState(0);
			React.useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);
		}

		/** Confirm modal rendered through the shell.overlay slot. */
		function DeleteConfirmModal(props) {
			const { store } = props;
			useStore(store);
			const s = store.get();
			if (s === null || s === undefined) return null;
			const zh = s.zh !== false;
			const busy = s.busy === true;
			const backdrop = {
				position: "fixed",
				inset: 0,
				zIndex: 2147483000,
				background: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.45))",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				pointerEvents: "auto",
				fontFamily: "var(--dsw-font-sans, system-ui, -apple-system, sans-serif)",
			};
			const card = {
				width: 400,
				maxWidth: "92vw",
				background: "var(--dsw-alias-bg-overlay, #26262c)",
				border: "1px solid var(--dsw-alias-border-l1, #3a3a42)",
				borderRadius: 12,
				padding: "20px 22px 16px",
				boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
				color: "var(--dsw-alias-label-primary, #ececf1)",
			};
			const title = {
				fontSize: 15,
				fontWeight: 600,
				lineHeight: "22px",
				margin: "0 0 10px",
				display: "flex",
				alignItems: "center",
				gap: 8,
				color: "var(--dsw-alias-state-error-primary, #f05555)",
			};
			const body = {
				fontSize: 13,
				lineHeight: "20px",
				color: "var(--dsw-alias-label-secondary, #b8b8c0)",
				margin: "0 0 12px",
				wordBreak: "break-all",
			};
			const idLine = {
				fontSize: 11,
				lineHeight: "16px",
				color: "var(--dsw-alias-label-tertiary, #8a8a94)",
				margin: "0 0 16px",
				fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
			};
			const errorLine = {
				fontSize: 12,
				lineHeight: "18px",
				color: "var(--dsw-alias-state-error-primary, #f05555)",
				margin: "0 0 12px",
				wordBreak: "break-all",
			};
			const actions = {
				display: "flex",
				justifyContent: "flex-end",
				gap: 10,
			};
			const cancelBtn = {
				border: "1px solid var(--dsw-alias-border-l1, #3a3a42)",
				background: "transparent",
				color: "var(--dsw-alias-label-primary, #ececf1)",
				borderRadius: 8,
				padding: "7px 14px",
				fontSize: 13,
				cursor: "pointer",
			};
			const confirmBtn = {
				border: "none",
				background: "var(--dsw-alias-state-error-primary, #e5484d)",
				color: "#fff",
				borderRadius: 8,
				padding: "7px 14px",
				fontSize: 13,
				fontWeight: 600,
				cursor: busy ? "default" : "pointer",
				opacity: busy ? 0.6 : 1,
			};
			const trashIcon = React.createElement("svg", {
				width: 16,
				height: 16,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
				style: { flex: "none" },
			}, React.createElement("path", { d: "M2.5 4.5h11" }), React.createElement("path", { d: "M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5" }), React.createElement("path", { d: "M4 4.5l.6 8a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4l.6-8" }), React.createElement("path", { d: "M6.5 7.5v3.5" }), React.createElement("path", { d: "M9.5 7.5v3.5" }));
			const onConfirm = () => {
				if (busy || !s.sessionId) return;
				store.set({ ...s, busy: true, error: null });
				fetch("/plugins/session-delete/api", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ method: "delete", sessionId: s.sessionId }),
				}).then((res) => res.json()).then((data) => {
					if (data !== null && typeof data === "object" && data.ok === true) {
						window.location.reload();
						return;
					}
					const message = data !== null && typeof data === "object" && typeof data.error === "string" ? data.error : "unknown error";
					store.set({ ...store.get(), busy: false, error: pick(zh, "modal.error.failed", { error: message }) });
				}).catch((err) => {
					store.set({ ...store.get(), busy: false, error: pick(zh, "modal.error.failed", { error: String((err && err.message) || err) }) });
				});
			};
			return React.createElement("div", { style: backdrop, onMouseDown: (e) => {
					if (e.target === e.currentTarget && !busy) store.set(null);
				} },
				React.createElement("div", { style: card, role: "dialog", "aria-modal": "true" },
					React.createElement("div", { style: title }, trashIcon, pick(zh, "modal.title")),
					React.createElement("p", { style: body }, pick(zh, "modal.body", { title: s.title || "(?)" })),
					React.createElement("p", { style: idLine }, pick(zh, "modal.sessionId", { id: s.sessionId || "-" })),
					s.error !== null && s.error !== undefined && React.createElement("p", { style: errorLine }, s.error),
					React.createElement("div", { style: actions },
						React.createElement("button", { type: "button", style: cancelBtn, disabled: busy, onClick: () => store.set(null) }, pick(zh, "modal.cancel")),
						React.createElement("button", { type: "button", style: confirmBtn, disabled: busy, onClick: onConfirm }, busy ? pick(zh, "modal.deleting") : pick(zh, "modal.confirm")))));
		}
		//#endregion

		//#region menu injection
		/** Native session action button aria-labels (locale-aware). */
		const ACTIONS_ZH = /^会话“(.+)”的操作$/;
		const ACTIONS_EN = /^Session actions for (.+)$/;

		/** The injected delete item is only added to menus that hold the archive row. */
		const ARCHIVE_HINTS = ["归档", "Archive session"];

		/** The last session row whose ⋮ button was clicked (menu anchor). */
		let pendingRow = null; // { title, zh, btn }

		/** Session id resolution: exact displayTitle, blanks via the localized label. */
		function resolveSessionId(row, sessions) {
			const snap = sessions.list.getSnapshot();
			const blankLabel = row.zh ? "新会话" : "New Session";
			const candidates = [];
			for (const id of snap.ids) {
				const s = snap.byId[id];
				if (s === undefined) continue;
				const rowTitle = s.blank === true ? blankLabel : s.displayTitle;
				if (rowTitle === row.title) candidates.push(id);
			}
			if (candidates.length === 1) return candidates[0];
			// Never guess when titles collide. DOM order and the session-store
			// order can diverge (archived/subagent rows are also interleaved), so
			// guessing could permanently delete the wrong session.
			return null;
		}

		/** Official ic_ds_trash_outline_16 path (from dsh-client-ui-primitives). */
		const TRASH_PATH = "M14.4782 4.84067L14.2138 10.1152C14.1102 12.1872 14.067 13.0115 13.3866 13.9607C13.1044 14.3546 12.7498 14.6912 12.3424 14.9535C11.8239 15.2872 11.2415 15.4316 10.5585 15.4998C9.88727 15.5668 9.04946 15.5656 7.99998 15.5656C6.95051 15.5656 6.1127 15.5668 5.44142 15.4998C4.75851 15.4316 4.17602 15.2872 3.65753 14.9535C3.25012 14.6912 2.89559 14.3546 2.61332 13.9607C1.93296 13.0115 1.88979 12.1872 1.78619 10.1152L1.52179 4.84067L2.89006 4.77277L3.15343 10.0463C3.26221 12.2218 3.32452 12.6015 3.72646 13.1624C3.90825 13.4161 4.13686 13.6334 4.39927 13.8023C4.66204 13.9714 5.00263 14.0792 5.57825 14.1367C6.16562 14.1953 6.92298 14.1963 7.99998 14.1963C9.07699 14.1963 9.83434 14.1953 10.4217 14.1367C10.9973 14.0792 11.3379 13.9714 11.6007 13.8023C11.8631 13.6334 12.0917 13.4161 12.2735 13.1624C12.6755 12.6015 12.7378 12.2218 12.8465 10.0463L13.1099 4.77277L14.4782 4.84067ZM5.43011 6.22849H6.7994V11.3909H5.43011V6.22849ZM9.20056 6.22849H10.5699V11.3909H9.20056V6.22849ZM8.53597 0.434431C9.17976 0.434431 9.6522 0.426926 10.0966 0.571258C10.2357 0.616451 10.3717 0.672554 10.502 0.738948C10.9182 0.951107 11.2464 1.29099 11.7015 1.74612L12.4978 2.54136H15.3742V3.91169H0.625732V2.54136H3.50218L4.29845 1.74612C4.75358 1.29099 5.08174 0.951107 5.49801 0.738948C5.62831 0.672554 5.76425 0.616451 5.90334 0.571258C6.34776 0.426926 6.82021 0.434431 7.46399 0.434431H8.53597ZM7.46399 1.80476C6.73208 1.80476 6.51641 1.81187 6.32617 1.87369C6.25545 1.89667 6.18668 1.92533 6.12041 1.95907C5.96398 2.03878 5.82348 2.16253 5.44142 2.54136H10.5585C10.1765 2.16253 10.036 2.03878 9.87955 1.95907C9.81329 1.92533 9.74452 1.89667 9.6738 1.87369C9.48356 1.81187 9.26789 1.80476 8.53597 1.80476H7.46399Z";

		/** Resolve the official hashed `.danger` class from the injected stylesheets. */
		function resolveDangerClass() {
			try {
				for (const sheet of Array.from(document.styleSheets)) {
					let rules;
					try { rules = sheet.cssRules; } catch (e) { continue; }
					for (const rule of rules) {
						if (typeof rule.cssText === "string" && rule.cssText.includes("interactive-bg-hover-danger")) {
							const m = /\.([A-Za-z0-9_-]+_danger)\b/.exec(rule.selectorText || "");
							if (m !== null) return m[1];
						}
					}
				}
			} catch (e) { /* fall through */ }
			return null;
		}

		/** Inject the delete item into one native session-action menu. */
		function injectDeleteItem(menu, store, sessions) {
			const zh = pendingRow === null ? true : pendingRow.zh;
			// Clone the native item structure — itemWrap > button.item > itemIcon +
			// itemLabel — so size, alignment and hover styling match the official
			// items exactly (their styles live in hashed CSS classes, so cloning
			// the classes is the only way to inherit them verbatim).
			const official = menu.querySelector('button[role="menuitem"]');
			if (official === null || official.parentElement === null) return;
			const container = official.parentElement.parentElement !== null ? official.parentElement.parentElement : official.parentElement;
			const wrap = official.parentElement.cloneNode(false);
			const btn = official.cloneNode(false);
			btn.type = "button";
			// Official danger styling (red text + red icon + red hover fill) via
			// the hashed .danger class; inline color as fallback if unresolvable.
			const dangerClass = resolveDangerClass();
			if (dangerClass !== null) {
				btn.classList.add(dangerClass);
			} else {
				btn.style.color = "var(--dsw-alias-state-error-primary,#f05555)";
			}
			const icon = document.createElement("span");
			const iconSpan = official.querySelector("span");
			icon.className = iconSpan !== null ? iconSpan.className : "";
			// The official .itemIcon class sets its own color; force danger red
			// inline so the svg (fill: currentColor) renders red too.
			icon.style.cssText = "display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-state-error-primary,#f05555);";
			icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path fill="currentColor" d="' + TRASH_PATH + '"/></svg>';
			const lab = document.createElement("span");
			const labSpan = iconSpan !== null && iconSpan.nextElementSibling !== null && iconSpan.nextElementSibling.tagName === "SPAN" ? iconSpan.nextElementSibling : null;
			lab.className = labSpan !== null ? labSpan.className : "";
			lab.textContent = pick(zh, "menu.delete");
			btn.append(icon, lab);
			wrap.appendChild(btn);
			container.appendChild(wrap);

			btn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				// Close the native menu (its document-level Escape listener).
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
				let row = pendingRow;
				if (row === null) {
					// Keyboard-opened menu: fall back to the focused trigger button.
					const active = document.activeElement instanceof Element ? document.activeElement.closest('button[aria-label]') : null;
					if (active !== null) {
						const label = active.getAttribute("aria-label") || "";
						const m = ACTIONS_ZH.exec(label) || ACTIONS_EN.exec(label);
						if (m !== null) row = { title: m[1], zh: label.startsWith("会话“"), btn: active };
					}
				}
				if (row === null) {
					store.set({ sessionId: null, title: "", zh, busy: false, error: pick(zh, "modal.error.unresolved") });
					return;
				}
				const sessionId = resolveSessionId(row, sessions);
				if (sessionId === null) {
					store.set({ sessionId: null, title: row.title, zh: row.zh, busy: false, error: pick(row.zh, "modal.error.unresolved") });
					return;
				}
				store.set({ sessionId, title: row.title, zh: row.zh, busy: false, error: null });
			});
		}

		/** Install the click capture + menu observer. Returns the disposer. */
		function installMenuInjection(store, sessions) {
			if (typeof document === "undefined") return () => {};
			const onClickCapture = (e) => {
				if (!(e.target instanceof Element)) return;
				const btn = e.target.closest('button[aria-label]');
				if (btn === null) return;
				const label = btn.getAttribute("aria-label") || "";
				let m = ACTIONS_ZH.exec(label);
				if (m !== null) {
					pendingRow = { title: m[1], zh: true, btn };
					return;
				}
				m = ACTIONS_EN.exec(label);
				if (m !== null) {
					pendingRow = { title: m[1], zh: false, btn };
				}
			};
			document.addEventListener("click", onClickCapture, true);

			const injected = new WeakSet();
			let scheduled = false;
			const scan = () => {
				scheduled = false;
				document.querySelectorAll('div[role="menu"]').forEach((menu) => {
					if (injected.has(menu)) return;
					let hasArchive = false;
					menu.querySelectorAll('button[role="menuitem"]').forEach((item) => {
						const text = (item.textContent || "").trim();
						if (ARCHIVE_HINTS.some((h) => text.includes(h))) hasArchive = true;
					});
					if (!hasArchive) return;
					injectDeleteItem(menu, store, sessions);
					injected.add(menu);
				});
			};
			const observer = new MutationObserver(() => {
				if (scheduled) return;
				scheduled = true;
				queueMicrotask(scan);
			});
			observer.observe(document.body, { childList: true, subtree: true });
			// Uninstall path: drop the capture listener and stop observing so
			// nothing survives plugin removal.
			return () => {
				document.removeEventListener("click", onClickCapture, true);
				observer.disconnect();
			};
		}
		//#endregion

		//#region entry
		module.exports.inject = ['slots', 'sessions'];

		/** Client plugin body: confirm overlay + native-menu injection. */
		module.exports.apply = function apply(ctx) {
			const store = new DeleteStore();
			const sessions = ctx.get('sessions');
			ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
				name: 'shell.overlay',
				id: 'session-delete-confirm',
				order: 90,
				label: 'Session delete',
			}, (props) => React.createElement(DeleteConfirmModal, { store }))), 'dsh-session-delete: overlay');
			if (sessions !== undefined) {
				ctx.effect(() => installMenuInjection(store, sessions), 'dsh-session-delete: menu injection');
			}
		};
		//#endregion

		return module.exports;
	}
});
