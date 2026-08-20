/**
 * dsh-session-nav v19 browser half (hand-written bundle, no build step).
 *  v19: BUG 审计修复——预载停滞计数跨会话重置（避免切换后预载哑火）、
 *  行缓存指纹补首子节点、预览卡文本去重；
 *
 * 对话节点导航条 —— 只针对「同一个会话窗口」：会话里每一条 user 提问
 * （轮次）就是一颗节点。整个功能靠官方 DOM 锚点契约 + sessions 服务
 * 驱动，零跨包 import、不动任何核心文件：
 *
 *   - 流容器：`[data-chat-flow=""]`（748px 文字列，即 --dsh-chat-content-width）
 *   - 滚动容器：`[data-conversation-scroll]`（向下兼容：从流容器向上找
 *     第一个 overflow-y auto/scroll 的祖先）
 *   - user 行：流项 `[data-chat-flow-key^="13:input-message"]` 且含
 *     `[class*="bubble"]`（上下文注入/steering 无 bubble 自动排除；
 *     旧契约 [data-time-hover-root]+bubble 作回退）——对话流是窗口化渲染
 *     （约百项 + 「加载更早」分页，窗口固定锚定最新内容尾部）；
 *   - 轮次总数：sessions.list 快照 `byId[sid].projectionValues.sessionStats.turns`
 *     （服务端统计，含被压缩的历史轮次）+ 会话 running 时 +1（用户计数
 *     习惯把「这次对话」算进去），与底部状态栏「N 轮」同源且补齐在途轮；
 *   - 缓慢预载：切换会话/启动后未压缩内容**立即显示**（短横条数量来自
 *     服务端轮次统计）；压缩历史由后台定时器**缓慢逐页预载**
 *     （SLOW_LOAD_MS 间隔一页，app 正在翻页/用户正在操作插件时让路，
 *     绝不排队堆积）；用户点选未加载轮次时再按需快速补页（上限
 *     OLDER_CLICK_CAP 次）；
 *   - 节点稳定身份：`data-chat-flow-key`（消息级 UUID，持久化用，缺省
 *     回退文本前缀匹配）
 *   - 主题：深色模式 = body[data-ds-dark-theme]（节点白），浅色 = 黑
 *
 * 交互（v5 定制，圆胖极简 + 磨砂玻璃）：
 *
 *   - 右缘节点串常驻（≥1 轮即显示，切换会话自动跟随当前会话轮次数），
 *     位于「会话文字与滚动条之间」、离滚动条约 8px、垂直居中于滚动容器；
 *     每 user 轮次一颗短横条（9×3px 全圆角胶囊），**最多同时显示 6 条**
 *     （超出部分节点串内部滚动，光标悬停节点串时滚轮滑动查看）；
 *   - 悬停短横条：平滑加长（13px）+ 弹出预览卡（**显示该轮全部内容**，
 *     内部滚动）；激活条（DeepSeek 蓝）跟随阅读位置并自动滚入可视区；
 *   - 单击（260ms 防抖区分双击）：跳转到该轮 + **置顶框内容切换为该轮
 *     全部内容**；双击：钉住/取消钉住 —— 仅高亮（全不透明 + 略加粗，
 *     无蓝点），持久化到 localStorage；
 *   - 单击插件区域以外的任何地方：置顶框内容回到**最新一条**（无「最新」
 *     字样，只显示轮次序号 #N）；
 *   - 顶部置顶框：磨砂透明玻璃背景（blur(24px)+saturate，随主题），
 *     注入滚动容器自身（sticky 相对真正的 scrollport），宽度 = 对话框
 *     文字列宽 + 左右各加长 2.5cm（共 5cm，居中对齐），高度随内容
 *     自由伸展（上限 70vh/640px 内部滚动），**显示所选轮次的全部内容**，
 *     点击置顶框跳转到该轮；
 *   - 光标悬停节点串时滚轮 = 滑动节点串（查看超出 6 条的轮次）；
 *     整条节点串空白处点击 = 跳到最近节点并选中。
 *
 * 会话切换/流重建由 MutationObserver + sessions.list 订阅驱动；启动后
 * 前 2 分钟每 2s 兜底重渲染一次，杜绝任何漏检导致节点串不出现。
 *
 * 自检：`data-dsnav-version` 属性、console 日志与 window.__DSNAV_DEBUG__
 * （含最近一次渲染错误）便于确认运行时状态。
 * @module dsh-session-nav/client
 */
window.__ModuleLoader__.load({
	id: "dsh-session-nav",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		//#region constants
		const VERSION = 19;
		const STYLE_ID = "dsh-session-nav";
		const STORAGE_PREFIX = "dsh-session-nav:";
		/** Single- vs double-click discrimination window (ms). */
		const CLICK_DEBOUNCE_MS = 260;
		/** Max bars visible at once; beyond that the rail scrolls (wheel). */
		const MAX_VISIBLE_BARS = 6;
		/** Rail wheel deltaY accumulated per frame (rAF-batched, see wheel). */
		/** Fallback scrollbar width when the browser reports an overlay bar. */
		const SCROLLBAR_FALLBACK = 10;
		/** Rail right edge distance to the scrollbar (需求：稍微小一点). */
		const GAP_TO_SCROLLBAR = 8;
		/** Rail left edge minimum distance to the text column. */
		const MIN_GAP_TO_TEXT = 12;
		/** Rail width when it is hidden (offsetWidth reads 0 then). */
		const BAR_WIDTH = 29;
		/** Persisted text prefix length used for identity verification. */
		const MIN_TEXT_MATCH = 16;
		/** Text length stored per round (identity; not display). */
		const STORE_TEXT_LEN = 24;
		/** Auto page-load cap: click 「加载更早」 at most this many times
		 *  (on-demand only — 压缩历史等需要时再加载). */
		const OLDER_CLICK_CAP = 6;
		/** Pace between page-load clicks (ms). */
		const OLDER_PACE_MS = 450;
		/** Slow background preload of compacted history: one older page per
		 *  tick, after a session switch (未使用的压缩内容缓慢加载). */
		const SLOW_LOAD_MS = 2800;
		/** Poll insurance duration / cadence (missed-mutation guard). */
		const POLL_MS = 2000;
		const POLL_MAX = 60;
		//#endregion

		//#region copy
		function zhLocale() {
			try {
				const lang = String(document.documentElement.lang || navigator.language || "");
				return lang.toLowerCase().startsWith("zh");
			} catch {
				return true;
			}
		}
		const ZH = zhLocale();
		const COPY = {
			navLabel: ZH ? "对话节点导航" : "Conversation node navigation",
			loading: ZH ? "第 {n} 轮 · 加载中…" : "Round #{n} · loading…",
			compacted: ZH ? "已压缩" : "Compacted",
			dotLabel: (n, total) => ZH ? `第 ${n} 轮提问（共 ${total} 轮，单击跳转并置顶，双击钉住）` : `User round #${n} of ${total} (click to jump & show, double-click to pin)`,
			selectedLabel: (n) => ZH ? `第 ${n} 轮（单击跳转）` : `Round #${n} (click to jump)`,
		};
		//#endregion

		//#region styles
		// 颜色按需求：浅色模式 = 黑色节点，深色模式 = 白色节点
		//（body[data-ds-dark-theme] 是官方主题投影属性）；激活 = DeepSeek 蓝。
		// 形态 = 扁短横条（9×3 全圆角胶囊），高亮 13px；置顶框磨砂玻璃。
		const STYLES = `
[data-dsnav-bar]{position:fixed;top:50%;right:26px;transform:translateY(-50%);z-index:900;display:flex;flex-direction:column;align-items:center;gap:20px;box-sizing:border-box;padding:10px;border-radius:14px;max-height:138px;overflow-y:auto;scrollbar-width:none;font-family:var(--dsw-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);pointer-events:auto;user-select:none;-webkit-user-select:none}
[data-dsnav-bar]::-webkit-scrollbar{display:none}
[data-dsnav-bar]:empty{display:none}
[data-dsnav-node]{position:relative;flex:none;width:9px;height:3px;border-radius:999px;padding:0;border:none;background:rgba(15,15,18,.45);cursor:pointer;outline:none;transition:width .18s cubic-bezier(.2,.8,.2,1),height .18s cubic-bezier(.2,.8,.2,1),background .18s ease,box-shadow .18s ease,transform .1s ease}
body[data-ds-dark-theme] [data-dsnav-node]{background:rgba(255,255,255,.48)}
[data-dsnav-node]::after{content:"";position:absolute;inset:-5px -3px;border-radius:999px}
[data-dsnav-node]:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent)}
[data-dsnav-node]:active{transform:scale(.7)}
[data-dsnav-node].hover{width:13px;background:rgba(15,15,18,.9)}
body[data-ds-dark-theme] [data-dsnav-node].hover{background:rgba(255,255,255,.9)}
[data-dsnav-node].active{width:13px;background:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 8px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 55%,transparent)}
[data-dsnav-node].active.hover{background:var(--dsw-alias-state-business-primary,#4176e6)}
[data-dsnav-node].pinned{width:11px;height:4px;background:rgba(15,15,18,.95)}
body[data-ds-dark-theme] [data-dsnav-node].pinned{background:rgba(255,255,255,.95)}
[data-dsnav-node].pinned.hover{width:13px}
[data-dsnav-node].active.pinned{width:13px;height:4px;background:var(--dsw-alias-state-business-primary,#4176e6)}
@keyframes dsnav-pop{0%{transform:scale(1)}35%{transform:scale(1.3)}100%{transform:scale(1)}}
[data-dsnav-node].pop{animation:dsnav-pop .24s ease}
@keyframes dsnav-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 60%,transparent)}100%{box-shadow:0 0 0 7px transparent}}
[data-dsnav-node].pulse{animation:dsnav-pulse .5s ease}
[data-dsnav-preview]{position:fixed;z-index:910;width:280px;box-sizing:border-box;padding:14px 16px;border-radius:16px;font-size:12.5px;line-height:1.6;color:#e9e9ed;background:#2c2c2e;box-shadow:var(--dsw-shadow-lv3);white-space:pre-wrap;word-break:break-word;max-height:45vh;overflow-y:auto;scrollbar-width:thin;pointer-events:none;opacity:0;transform:translateX(4px);transition:opacity .14s ease,transform .14s ease}
[data-dsnav-preview][data-show]{opacity:1;transform:none}
[data-dsnav-top]{position:sticky;top:8px;z-index:20;flex:none;box-sizing:border-box;width:min(100% - 32px,calc(var(--dsh-chat-content-width,748px) + 5cm));margin:8px auto;display:flex;flex-direction:column;align-items:stretch;gap:6px;max-height:min(70vh,640px);overflow-y:auto;scrollbar-width:thin;padding:12px 14px;border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#ffffff) 40%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 60%,transparent);box-shadow:var(--dsw-shadow-lv2,none);backdrop-filter:blur(24px) saturate(1.5);-webkit-backdrop-filter:blur(24px) saturate(1.5);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-sans,system-ui,-apple-system,"Segoe UI",sans-serif)}
[data-dsnav-selected]{display:block;width:100%;box-sizing:border-box;text-align:left;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.65;cursor:pointer;min-width:0;transition:transform .1s ease}
[data-dsnav-selected]:active{transform:scale(.995)}
.dsnav-num{display:inline;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-business-primary,#4176e6);font-size:13px;opacity:.9}
.dsnav-text{display:inline;white-space:pre-wrap;word-break:break-word;font-weight:600}
@media (prefers-reduced-motion:reduce){
[data-dsnav-bar],[data-dsnav-node],[data-dsnav-node].active,[data-dsnav-top],[data-dsnav-selected],[data-dsnav-preview]{transition:none;animation:none}
}`;
		//#endregion

		//#region dom anchors
		/** Cached lookups: querySelector on every render/scroll is the main
		 *  hot path — cache the elements and re-query only when they detach
		 *  (session switch rebuilds the flow) or vanish. isConnected is a
		 *  cheap non-layout property read. */
		let flowCache = null;
		const flowOf = () => {
			if (flowCache !== null && flowCache.isConnected) return flowCache;
			flowCache = document.querySelector('[data-chat-flow=""]');
			return flowCache;
		};
		const scrollportOf = () => document.querySelector('[data-conversation-scroll]');
		let scrollerCache = null;
		const scrollerOf = () => {
			if (scrollerCache !== null && scrollerCache.isConnected) return scrollerCache;
			const port = scrollportOf();
			if (port !== null) { scrollerCache = port; return port; }
			const flow = flowOf();
			if (flow === null) { scrollerCache = null; return null; }
			let node = flow.parentElement;
			while (node !== null) {
				const style = getComputedStyle(node);
				if (style.overflowY === 'auto' || style.overflowY === 'scroll') { scrollerCache = node; return node; }
				node = node.parentElement;
			}
			scrollerCache = null;
			return null;
		};
		/** User question rows. Primary: flow items keyed `13:input-message*`
		 *  with a bubble (steering/context-injection rows have no bubble and
		 *  are excluded; the flow is windowed, so only loaded rounds appear).
		 *  Fallback: the older `[data-time-hover-root]` + bubble contract.
		 *  Cached by flow fingerprint (element + child count + last child):
		 *  text streaming never invalidates it, only structural changes do. */
		let rowsCache = null;
		let rowsCacheFlow = null;
		let rowsCacheCount = -1;
		let rowsCacheFirst = null;
		let rowsCacheLast = null;
		const userRows = () => {
			const flow = flowOf();
			if (flow === null) { rowsCache = null; rowsCacheFlow = null; return []; }
			if (rowsCache !== null && flow === rowsCacheFlow &&
				flow.childElementCount === rowsCacheCount &&
				flow.firstElementChild === rowsCacheFirst && flow.lastElementChild === rowsCacheLast) {
				return rowsCache;
			}
			rowsCacheFlow = flow;
			rowsCacheCount = flow.childElementCount;
			rowsCacheFirst = flow.firstElementChild;
			rowsCacheLast = flow.lastElementChild;
			rowsCache = [...flow.querySelectorAll('[data-chat-flow-key^="13:input-message"]')]
				.filter((el) =>
					!el.hasAttribute('data-turn-tail') &&
					!el.hasAttribute('data-pending-steering') &&
					el.querySelector('[class*="bubble"]') !== null);
			if (rowsCache.length === 0) {
				rowsCache = [...flow.querySelectorAll('[data-time-hover-root]')]
					.filter((row) =>
						!row.hasAttribute('data-turn-tail') &&
						!row.hasAttribute('data-pending-steering') &&
						row.querySelector('[class*="bubble"]') !== null);
			}
			return rowsCache;
		};
		/** Stable round identity from the flow item key (message uuid). */
		const rowKey = (row) => {
			const key = row.getAttribute('data-chat-flow-key');
			if (key !== null && key !== '') return key;
			const wrapper = row.closest('[data-chat-flow-key]');
			return wrapper !== null ? (wrapper.getAttribute('data-chat-flow-key') ?? null) : null;
		};
		/** Round text = the user bubble's text (full content). */
		const rowText = (row) => ((row.querySelector('[class*="bubble"]') ?? row).textContent ?? '').trim();
		const truncate = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text);
		//#endregion

		//#region element roots
		const bar = document.createElement('nav');
		bar.setAttribute('data-dsnav-bar', '');
		bar.setAttribute('data-dsnav-version', String(VERSION));
		bar.setAttribute('aria-label', COPY.navLabel);
		document.body.appendChild(bar);

		const preview = document.createElement('div');
		preview.setAttribute('data-dsnav-preview', '');
		preview.style.display = 'none';
		document.body.appendChild(preview);

		/** Top pinned box — injected into the SCROLLPORT itself (direct child,
		 *  sticky against the real scroll container, immune to intermediate
		 *  overflow:hidden layers). Width matches the dialog text column. */
		const topBox = document.createElement('div');
		topBox.setAttribute('data-dsnav-top', '');
		topBox.setAttribute('data-dsnav-version', String(VERSION));
		topBox.style.display = 'none';

		/** Styles injected at module load so the roots are never unstyled. */
		try {
			if (document.getElementById(STYLE_ID) === null) {
				const style = document.createElement('style');
				style.id = STYLE_ID;
				style.textContent = STYLES;
				document.head.appendChild(style);
			}
		} catch (e) {
			console.error('[dsh-session-nav] style injection failed', e);
		}
		//#endregion

		//#region sessions service
		let sessions = null;
		const sessionEntry = (sid) => {
			if (sessions === null || sid === null) return null;
			try {
				const snapshot = sessions.list.getSnapshot();
				return (snapshot !== null && snapshot.byId ? snapshot.byId[sid] : null) ?? null;
			} catch {
				return null;
			}
		};
		function currentSessionId() {
			if (sessions === null) return null;
			try {
				const snapshot = sessions.list.getSnapshot();
				return snapshot !== null && snapshot.current ? snapshot.current : null;
			} catch {
				return null;
			}
		}
		/** Total rounds for the current session: server turns (includes
		 *  compacted history) + 1 while the session is running (the user
		 *  counts the current message as a round), never below visible rows. */
		const roundCount = (sid, visibleRows) => {
			const entry = sessionEntry(sid);
			const turns = entry !== null && entry.projectionValues !== null &&
				typeof entry.projectionValues.sessionStats?.turns === 'number'
				? entry.projectionValues.sessionStats.turns : null;
			const inflight = entry !== null && !!entry.running;
			const computed = turns !== null ? turns + (inflight ? 1 : 0) : visibleRows.length;
			return Math.max(computed, visibleRows.length);
		};
		/** Visible rows → bar offset: bars 0..(offset-1) are compacted or
		 *  not-yet-loaded rounds. The flow window is tail-anchored, so the
		 *  rendered user rows are the newest k rounds. */
		const visibleOffsetFor = (sid, rows) => Math.max(0, roundCount(sid, rows) - rows.length);
		//#endregion

		//#region older-page loader (「加载更早」, 按需)
		let olderLoading = false;
		/** The live per-session face (authoritative loadingOlder/hasMore). */
		const sessionFace = (sid) => {
			if (sessions === null || sid === null) return null;
			try {
				const binding = typeof sessions.binding === 'function' ? sessions.binding(sid) : null;
				return binding !== null && binding.session ? binding.session : null;
			} catch {
				return null;
			}
		};
		/** True while the app itself is still pulling an older page — never
		 *  click 「加载更早」 again until it settles (the app queues loads
		 *  otherwise and the UI janks). */
		const olderBusy = (sid) => {
			const face = sessionFace(sid);
			if (face === null || typeof face.getSnapshot !== 'function') return false;
			try { return !!face.getSnapshot().loadingOlder; } catch { return false; }
		};
		const olderHasMore = (sid) => {
			const face = sessionFace(sid);
			if (face === null || typeof face.getSnapshot !== 'function') return true;
			try { return face.getSnapshot().hasMore !== false; } catch { return true; }
		};
		const olderButton = () => {
			const flow = flowOf();
			if (flow === null) return null;
			const btn = flow.querySelector('.Md3f7G_older button');
			return btn instanceof HTMLElement ? btn : null;
		};
		/** Click the app's own 「加载更早」 to pull one older page into the
		 *  window. 仅按需调用（用户点击未加载轮次时）；切换会话后不自动
		 *  加载压缩历史，未压缩内容直接显示。Returns true when clicked. */
		const clickOlder = () => {
			if (olderLoading) return false;
			const sid = currentSessionId();
			if (sid === null || olderBusy(sid)) return false;
			if (!olderHasMore(sid)) return false;
			const btn = olderButton();
			if (btn === null) return false;
			olderLoading = true;
			try { btn.click(); } catch { olderLoading = false; return false; }
			setTimeout(() => { olderLoading = false; schedule(); }, OLDER_PACE_MS);
			return true;
		};
		//#endregion

		//#region slow background preload (压缩历史缓慢预载)
		/** Last real user interaction with the plugin (performance.now()).
		 *  The slow preloader yields for a while after any of them. */
		let lastUserAt = 0;
		let backgroundLoads = 0;
		let lastBackgroundLoadAt = 0;
		/** Stall guard: if N consecutive successful clicks bring no extra
		 *  rows, the loader is spinning against a dead button — stop it for
		 *  this page session instead of hammering 加载更早 forever. */
		let slowNoGain = 0;
		let slowLastClickRows = -1;
		let slowSid = null;
		/** 切换会话/启动后：未压缩内容立即显示；压缩历史按 SLOW_LOAD_MS
		 *  间隔**逐页缓慢预载**。app 正在翻页、没有更早的页、或用户正在
		 *  操作插件时一律让路，绝不排队堆积。 */
		const slowTick = () => {
			const sid = currentSessionId();
			const flow = flowOf();
			if (sid === null || flow === null) return;
			if (slowSid !== sid) {
				// 会话切换 → 重置停滞计数（旧会话的行数不能用于判定新会话）
				slowSid = sid;
				slowNoGain = 0;
				slowLastClickRows = -1;
			}
			const rows = userRows();
			const total = roundCount(sid, rows);
			if (total <= rows.length) { slowNoGain = 0; slowLastClickRows = -1; return; } // 全部已渲染
			// 上次点击是否带来了行数增长？连续 6 次无进展 → 停滞，停止预载。
			if (slowLastClickRows !== -1) {
				if (rows.length > slowLastClickRows) slowNoGain = 0;
				else slowNoGain += 1;
				if (slowNoGain >= 6) return;
			}
			if (olderBusy(sid)) return; // app 正在翻页 —— 让路
			if (!olderHasMore(sid)) return; // 没有更早的页了
			if (performance.now() - lastUserAt < 2000) return; // 用户正在用 —— 让路
			if (clickOlder()) {
				slowLastClickRows = rows.length;
				backgroundLoads += 1;
				lastBackgroundLoadAt = Date.now();
				publishDebug();
			}
		};
		//#endregion

		//#region persistence (per session, localStorage)
		const store = {
			key(kind, sid) { return `${STORAGE_PREFIX}${kind}:${sid}`; },
			load(kind, sid) {
				try {
					const value = JSON.parse(localStorage.getItem(this.key(kind, sid)) ?? '[]');
					return Array.isArray(value) ? value : [];
				} catch {
					return [];
				}
			},
			save(kind, sid, list) {
				try { localStorage.setItem(this.key(kind, sid), JSON.stringify(list)); } catch { /* quota — ignore */ }
			},
			/** Resolve stored {k,t} entries to live row indexes (drop stale). */
			resolve(entries, rows) {
				const byKey = new Map();
				for (let i = 0; i < rows.length; i++) {
					const key = rowKey(rows[i]);
					if (key !== null && !byKey.has(key)) byKey.set(key, i);
				}
				const out = [];
				for (const entry of entries) {
					if (entry === null || typeof entry !== 'object') continue;
					let index = -1;
					if (typeof entry.k === 'string' && entry.k !== '' && byKey.has(entry.k)) {
						index = byKey.get(entry.k);
					} else if (typeof entry.t === 'string' && entry.t !== '') {
						const prefix = entry.t.slice(0, MIN_TEXT_MATCH);
						for (let i = 0; i < rows.length; i++) {
							if (rowText(rows[i]).slice(0, MIN_TEXT_MATCH) === prefix) { index = i; break; }
						}
					}
					if (index >= 0 && !out.includes(index)) out.push(index);
				}
				return out;
			},
			togglePinned(sid, entry) {
				const list = this.load('pinned', sid);
				const index = list.findIndex((e) => e && e.k === entry.k && e.t === entry.t);
				if (index >= 0) list.splice(index, 1);
				else list.push(entry);
				this.save('pinned', sid, list);
				pinnedVersion += 1; // 使钉住解析缓存失效（键含版本）
				return index < 0;
			},
		};
		const entryOf = (row) => ({ k: rowKey(row), t: truncate(rowText(row), STORE_TEXT_LEN) });
		/** 钉住数据变更版本 —— 双击切换后自增，强制缓存重解析（v13 缓存
		 *  回归修复：仅 sid/rows/offset 不足以使缓存失效）。 */
		let pinnedVersion = 0;
		/** Pinned-index resolution cached per (sid, rows, offset, version) —
		 *  the localStorage parse + row scan only runs when the structure or
		 *  the pinned set actually changed (render runs on every scroll tick). */
		let pinnedCacheSid = null;
		let pinnedCacheRows = null;
		let pinnedCacheOffset = -1;
		let pinnedCacheVersion = -1;
		let pinnedCacheSet = null;
		const resolvePinned = (sid, rows, offset) => {
			if (pinnedCacheSid === sid && pinnedCacheRows === rows &&
				pinnedCacheOffset === offset && pinnedCacheVersion === pinnedVersion &&
				pinnedCacheSet !== null) {
				return pinnedCacheSet;
			}
			pinnedCacheSid = sid;
			pinnedCacheRows = rows;
			pinnedCacheOffset = offset;
			pinnedCacheVersion = pinnedVersion;
			pinnedCacheSet = new Set(
				store.resolve(store.load('pinned', sid), rows).map((index) => index + offset));
			return pinnedCacheSet;
		};
		//#endregion

		//#region position
		let posScheduled = false;
		/** Rail: between the text column and the scrollbar, 8px off the bar. */
		const position = () => {
			const flow = flowOf();
			if (flow === null) return;
			const fr = flow.getBoundingClientRect();
			const scroller = scrollerOf();
			let left;
			if (scroller !== null) {
				const sr = scroller.getBoundingClientRect();
				const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
				const gap = (scrollbarWidth > 0 ? scrollbarWidth : SCROLLBAR_FALLBACK) + GAP_TO_SCROLLBAR;
				const width = bar.offsetWidth > 0 ? bar.offsetWidth : BAR_WIDTH;
				left = Math.max(sr.right - gap - width, fr.right + MIN_GAP_TO_TEXT);
				bar.style.top = `${sr.top + sr.height / 2}px`;
			} else {
				// No scroller found — hug the text column (reference behavior).
				left = fr.right + MIN_GAP_TO_TEXT;
				bar.style.top = '50%';
			}
			bar.style.left = `${left}px`;
			bar.style.right = 'auto';
			bar.style.transform = 'translateY(-50%)';
		};
		const requestPosition = () => {
			if (posScheduled) return;
			posScheduled = true;
			requestAnimationFrame(() => { posScheduled = false; position(); });
		};
		//#endregion

		//#region preview (full content)
		const positionPreview = (anchor) => {
			const rect = anchor.getBoundingClientRect();
			preview.style.right = `${window.innerWidth - rect.left + 14}px`;
			preview.style.top = `${Math.min(window.innerHeight - 140, rect.top - 12)}px`;
		};
		const showPreview = (row, anchor) => {
			const text = rowText(row);
			if (text === '') return;
			// 文本未变时只更新位置，避免滚动/悬停中每帧重设长文本触发重排
			if (preview.textContent !== text) preview.textContent = text;
			preview.style.display = '';
			preview.setAttribute('data-show', '');
			positionPreview(anchor);
		};
		const hidePreview = () => {
			preview.removeAttribute('data-show');
			preview.style.display = 'none';
		};
		//#endregion

		//#region active + selection state
		let activeGlobal = -1;
		let totalRounds = 0;
		let visibleOffset = 0;
		let builtRows = [];
		let selectedGlobal = -1;
		let lastRenderSid = null;
		let lastRevealedActive = -1;
		let railWheeledAt = 0;
		/** Active = topmost visible user row at/inside the viewport → global
		 *  bar. When no user row is rendered yet (streaming tail fills the
		 *  window), fall back to the latest round. */
		const computeActiveGlobal = (rows) => {
			if (rows.length === 0) return totalRounds - 1;
			let best = 0;
			let found = false;
			let bestTop = Number.POSITIVE_INFINITY;
			for (let i = 0; i < rows.length; i++) {
				const top = rows[i].getBoundingClientRect().top;
				if (top >= 0 && top < bestTop) { bestTop = top; best = i; found = true; }
			}
			const local = found ? best : rows.length - 1;
			return visibleOffset + local;
		};
		/** Keep the active bar visible inside the rail's 6-bar window
		 *  (unless the user is wheeling the rail themselves). */
		const revealActive = () => {
			if (activeGlobal < 0) return;
			if (performance.now() - railWheeledAt < 1500) return;
			if (activeGlobal === lastRevealedActive) return;
			lastRevealedActive = activeGlobal;
			const dots = [...bar.querySelectorAll('[data-dsnav-node]')];
			const dot = dots[activeGlobal];
			if (dot === undefined) return;
			const target = dot.offsetTop - (bar.clientHeight - dot.offsetHeight) / 2;
			const max = bar.scrollHeight - bar.clientHeight;
			bar.scrollTop = Math.max(0, Math.min(max, target));
		};
		//#endregion

		//#region jump
		/** Scroll the scroller so a target element is at its top (with the
		 *  wheel-probe so the core's reader-input ledger accepts the jump). */
		const scrollToEl = (el) => {
			const scroller = scrollerOf();
			if (scroller === null || el === null) return;
			scroller.dispatchEvent(new WheelEvent('wheel', {
				deltaY: -1, bubbles: true, cancelable: true,
			}));
			scroller.scrollTop = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		};
		const jumpToRow = (row, pulseGlobal) => {
			scrollToEl(row);
			if (pulseGlobal !== undefined) pulseBar(pulseGlobal);
		};
		/** Rounds that are entirely compacted have no DOM row — jump to the
		 *  compaction summary row instead. */
		const jumpToCompaction = (pulseGlobal) => {
			const flow = flowOf();
			let targetEl = null;
			if (flow !== null) {
				for (const item of flow.children) {
					if (item.querySelector('[data-compaction-disclosure]') !== null ||
						(item.textContent ?? '').includes(COPY.compacted)) {
						targetEl = item;
						break;
					}
				}
			}
			scrollToEl(targetEl);
			if (pulseGlobal !== undefined) pulseBar(pulseGlobal);
		};
		/** Physical feedback: pulse the bar at a global round index. */
		const pulseBar = (globalIndex) => {
			const dots = [...bar.querySelectorAll('[data-dsnav-node]')];
			const dot = dots[globalIndex];
			if (dot !== undefined) {
				dot.classList.remove('pulse');
				void dot.offsetWidth;
				dot.classList.add('pulse');
			}
		};
		/** Map a global bar index to a live visible row (null = not loaded). */
		const barToRow = (barIndex) => {
			const rows = userRows();
			const offset = visibleOffsetFor(currentSessionId(), rows);
			const index = barIndex - offset;
			return index >= 0 && index < rows.length ? rows[index] : null;
		};
		/** Load older pages until the round at barIndex renders (bounded),
		 *  then call back with its live row (null = gave up). App-busy ticks
		 *  are retried instead of bailing. Used by jump (click) and pin
		 *  (double-click) on not-yet-loaded rounds. */
		const loadUntilRow = (barIndex, tries, done) => {
			const sid = currentSessionId();
			const rows = userRows();
			const offset = visibleOffsetFor(sid, rows);
			const row = barIndex - offset >= 0 && barIndex - offset < rows.length ? rows[barIndex - offset] : null;
			if (row !== null) { done(row); return; }
			if (tries >= OLDER_CLICK_CAP) { done(null); return; }
			if (olderBusy(currentSessionId()) && olderHasMore(currentSessionId())) {
				setTimeout(() => loadUntilRow(barIndex, tries + 1, done), OLDER_PACE_MS + 150);
				return;
			}
			if (!clickOlder()) { done(null); return; }
			setTimeout(() => loadUntilRow(barIndex, tries + 1, done), OLDER_PACE_MS + 150);
		};
		/** Jump to a bar; when its round is not loaded yet, page-load older
		 *  history until it renders (bounded), then jump. */
		const jumpToBar = (barIndex, tries) => loadUntilRow(barIndex, tries, (row) => {
			if (row !== null) { jumpToRow(row, barIndex); return; }
			// Give up loading — land near the oldest loaded content.
			pulseBar(barIndex);
			const flow = flowOf();
			const first = flow !== null ? flow.firstElementChild : null;
			scrollToEl(first);
		});
		//#endregion

		//#region click / double-click / outside click
		let clickTimer = null;
		const onSingleClick = (barIndex) => {
			const sid = currentSessionId();
			const rows = userRows();
			const offset = visibleOffsetFor(sid, rows);
			const rowIndex = barIndex - offset;
			const row = rowIndex >= 0 && rowIndex < rows.length ? rows[rowIndex] : null;
			selectedGlobal = barIndex; // 置顶框内容随单击切换
			if (row !== null) jumpToRow(row, barIndex);
			else jumpToBar(barIndex, 0);
			render();
		};
		const onDoubleClick = (barIndex) => {
			const sid = currentSessionId();
			if (sid === null) return;
			const row = barToRow(barIndex);
			if (row !== null && row !== undefined) {
				store.togglePinned(sid, entryOf(row));
				render();
				return;
			}
			// 该轮尚未渲染（压缩/未加载）——按需补页，加载完成后自动钉住。
			loadUntilRow(barIndex, 0, (loaded) => {
				if (loaded === null) { pulseBar(barIndex); return; }
				store.togglePinned(sid, entryOf(loaded));
				render();
			});
		};
		/** 单击插件区域以外 → 置顶框回到最新一条.
		 *  只响应真实用户点击（isTrusted）：程序化点击（自动补页的
		 *  「加载更早」、脚本注入等）一律忽略，避免误复位。 */
		const onOutsideClick = (event) => {
			if (!event.isTrusted) return;
			lastUserAt = performance.now();
			const target = event.target;
			if (target instanceof Element &&
				(bar.contains(target) || topBox.contains(target) || preview.contains(target))) {
				return;
			}
			if (selectedGlobal !== totalRounds - 1 && totalRounds > 0) {
				selectedGlobal = totalRounds - 1;
				render();
			}
		};
		document.addEventListener('click', onOutsideClick, true);
		//#endregion

		//#region top pinned box (single selected round, full content)
		let panelEl = null;
		let lastPanelKey = null;
		const ensureTopBox = () => {
			const host = scrollerOf();
			if (host === null) return;
			if (topBox.parentElement === host) return;
			if (topBox.parentElement !== null) topBox.remove();
			host.insertBefore(topBox, host.firstChild);
		};
		/** Incremental render: reuse the panel element and skip entirely when
		 *  the selected round + content are unchanged (cheap during streaming
		 *  and session-list ticks). */
		const renderTopBox = (rows, sid) => {
			if (selectedGlobal < 0 || selectedGlobal >= totalRounds) {
				selectedGlobal = Math.max(0, totalRounds - 1);
			}
			const rowIndex = selectedGlobal - visibleOffset;
			const row = rowIndex >= 0 && rowIndex < rows.length ? rows[rowIndex] : null;
			const text = row !== null ? rowText(row) : COPY.loading.replace('{n}', String(selectedGlobal + 1));
			const key = `${sid}:${selectedGlobal}:${text.length}:${text.slice(0, 80)}`;
			if (panelEl !== null && panelEl.parentElement === topBox && lastPanelKey === key) {
				topBox.style.display = 'flex';
				return; // unchanged — keep the DOM stable
			}
			if (panelEl === null || panelEl.parentElement !== topBox) {
				panelEl = document.createElement('button');
				panelEl.type = 'button';
				panelEl.setAttribute('data-dsnav-selected', '');
				panelEl.addEventListener('click', () => {
					lastUserAt = performance.now();
					const target = barToRow(selectedGlobal);
					if (target !== null) jumpToRow(target, selectedGlobal);
					else jumpToBar(selectedGlobal, 0);
				});
				topBox.textContent = '';
				topBox.appendChild(panelEl);
			}
			panelEl.setAttribute('aria-label', COPY.selectedLabel(selectedGlobal + 1));
			let num = panelEl.querySelector('.dsnav-num');
			if (num === null) {
				num = document.createElement('span');
				num.className = 'dsnav-num';
				panelEl.insertBefore(num, panelEl.firstChild);
			}
			let textEl = panelEl.querySelector('.dsnav-text');
			if (textEl === null) {
				textEl = document.createElement('span');
				textEl.className = 'dsnav-text';
				panelEl.appendChild(textEl);
			}
			num.textContent = `#${selectedGlobal + 1} `; // 序号与内容同行，中间空一格
			textEl.textContent = text;
			lastPanelKey = key;
			topBox.style.display = 'flex';
		};
		//#endregion

		//#region rail rendering
		const updateActiveClass = (active) => {
			const dots = [...bar.querySelectorAll('[data-dsnav-node]')];
			dots.forEach((dot, i) => {
				if (i === active) dot.classList.add('active');
				else dot.classList.remove('active');
			});
		};
		const updatePinnedClass = (pinnedIndexes) => {
			const dots = [...bar.querySelectorAll('[data-dsnav-node]')];
			dots.forEach((dot, i) => {
				if (pinnedIndexes.has(i)) dot.classList.add('pinned');
				else dot.classList.remove('pinned');
			});
		};
		const buildDots = (total, active, pinnedIndexes) => {
			bar.textContent = '';
			for (let i = 0; i < total; i++) {
				const dot = document.createElement('button');
				dot.type = 'button';
				dot.setAttribute('data-dsnav-node', '');
				dot.setAttribute('data-round', String(i + 1));
				dot.setAttribute('aria-label', COPY.dotLabel(i + 1, total));
				if (i === active) dot.classList.add('active');
				if (pinnedIndexes.has(i)) dot.classList.add('pinned');
				dot.addEventListener('focus', () => {
					const row = barToRow(i);
					if (row !== null) showPreview(row, dot);
				});
				dot.addEventListener('blur', hidePreview);
				dot.addEventListener('click', () => {
					lastUserAt = performance.now();
					if (clickTimer !== null) {
						clearTimeout(clickTimer);
						clickTimer = null;
						onDoubleClick(i);
						return;
					}
					clickTimer = setTimeout(() => {
						clickTimer = null;
						onSingleClick(i);
					}, CLICK_DEBOUNCE_MS);
				});
				bar.appendChild(dot);
			}
			if (lastHoverY !== null) applyHover(lastHoverY);
		};
		const renderInner = () => {
			requestPosition();
			const flow = flowOf();
			const rows = userRows();
			const sid = currentSessionId();
			if (flow === null || rows.length === 0) {
				bar.style.display = 'none';
				preview.style.display = 'none';
				topBox.style.display = 'none';
				builtRows = [];
				activeGlobal = -1;
				totalRounds = 0;
				visibleOffset = 0;
				selectedGlobal = -1;
				publishDebug();
				return;
			}
			ensureTopBox();
			totalRounds = roundCount(sid, rows);
			visibleOffset = Math.max(0, totalRounds - rows.length);
			if (lastRenderSid !== sid) {
				lastRenderSid = sid;
				selectedGlobal = totalRounds - 1; // 会话切换 → 默认最新
				lastRevealedActive = -1;
			}
			if (selectedGlobal < 0 || selectedGlobal >= totalRounds) {
				selectedGlobal = totalRounds - 1;
			}
			renderTopBox(rows, sid);
			if (totalRounds < 1) {
				bar.style.display = 'none';
				builtRows = [];
				activeGlobal = -1;
				publishDebug();
				return;
			}
			bar.style.display = 'flex';
			const active = computeActiveGlobal(rows);
			activeGlobal = active;
			const pinnedIndexes = resolvePinned(sid, rows, visibleOffset);
			const sameRows = rows.length === builtRows.length && rows.every((row, i) => row === builtRows[i]);
			if (sameRows && bar.childElementCount === totalRounds) {
				updateActiveClass(active);
				updatePinnedClass(pinnedIndexes);
			} else {
				buildDots(totalRounds, active, pinnedIndexes);
				builtRows = rows;
				bindIO(); // 行结构变化 → 重挂观察
			}
			revealActive();
			publishDebug();
		};
		const render = () => {
			try {
				renderInner();
			} catch (e) {
				console.error('[dsh-session-nav] render error', e);
				if (window.__DSNAV_DEBUG__ !== undefined) {
					window.__DSNAV_DEBUG__.lastError = String(e);
					window.__DSNAV_DEBUG__.lastErrorAt = Date.now();
				}
			}
		};
		//#endregion

		//#region hover
		const nearestDot = (y) => {
			const dots = [...bar.querySelectorAll('[data-dsnav-node]')];
			if (dots.length === 0) return null;
			let best = null;
			let bestDistance = Number.POSITIVE_INFINITY;
			for (const dot of dots) {
				const rect = dot.getBoundingClientRect();
				const distance = Math.abs(rect.top + rect.height / 2 - y);
				if (distance < bestDistance) { bestDistance = distance; best = dot; }
			}
			if (best === null) return null;
			const row = barToRow(dots.indexOf(best));
			if (row === null) return null;
			return { dot: best, row };
		};
		const hoverableDot = (y) => {
			const dots = [...bar.querySelectorAll('[data-dsnav-node]')];
			if (dots.length === 0) return null;
			const first = dots[0].getBoundingClientRect();
			const last = dots[dots.length - 1].getBoundingClientRect();
			if (y < first.top - 1 || y > last.bottom + 1) return null;
			return nearestDot(y);
		};
		let hoverScheduled = false;
		let lastHoverY = null;
		let hoverDotEl = null;
		const setHoverDot = (dot) => {
			if (hoverDotEl === dot) return;
			if (hoverDotEl !== null) hoverDotEl.classList.remove('hover');
			hoverDotEl = dot;
			if (dot !== null) dot.classList.add('hover');
		};
		const applyHover = (y) => {
			const hit = hoverableDot(y);
			setHoverDot(hit !== null ? hit.dot : null);
			if (hit === null) {
				hidePreview();
				return;
			}
			showPreview(hit.row, hit.dot);
		};
		const onBarMove = (event) => {
			lastHoverY = event.clientY;
			if (hoverScheduled) return;
			hoverScheduled = true;
			requestAnimationFrame(() => {
				hoverScheduled = false;
				if (lastHoverY !== null) applyHover(lastHoverY);
			});
		};
		bar.addEventListener('mousemove', onBarMove);
		bar.addEventListener('mouseleave', () => {
			lastHoverY = null;
			setHoverDot(null);
			hidePreview();
		});
		/** Whole rail is clickable: gap clicks jump to the nearest node. */
		bar.addEventListener('click', (event) => {
			const target = event.target;
			if (target instanceof Element && target.closest('[data-dsnav-node]') !== null) return;
			const hit = nearestDot(event.clientY);
			if (hit !== null) {
				const index = [...bar.querySelectorAll('[data-dsnav-node]')].indexOf(hit.dot);
				selectedGlobal = index;
				jumpToRow(hit.row, index);
				render();
			}
		});
		/** Wheel over the rail scrolls the rail itself (bars beyond the
		 *  6-bar window, like a bicycle chain), never the page.
		 *  流畅度：高精度滚轮事件高频到达——累积 deltaY，每帧（rAF）
		 *  批量应用一次 scrollTop（旧的 90ms 硬节流每秒只跳 11 次，
		 *  滚动一顿一顿像卡顿）。 */
		let wheelAccum = 0;
		let wheelRaf = null;
		const flushWheel = () => {
			wheelRaf = null;
			if (wheelAccum === 0) return;
			if (!bar.isConnected) { wheelAccum = 0; return; }
			bar.scrollTop += wheelAccum;
			wheelAccum = 0;
			if (lastHoverY !== null) applyHover(lastHoverY); // 滚动后 hover 跟随新位置
		};
		bar.addEventListener('wheel', (event) => {
			event.preventDefault();
			lastUserAt = performance.now();
			railWheeledAt = performance.now();
			wheelAccum += event.deltaY;
			if (wheelRaf === null) wheelRaf = requestAnimationFrame(flushWheel);
		}, { passive: false });
		//#endregion

		//#region observers
		let scrollScheduled = false;
		const runUpdate = () => {
			scrollScheduled = false;
			const next = computeActiveGlobal(userRows());
			if (next === activeGlobal) return;
			activeGlobal = next;
			render();
		};
		const scheduleActive = () => {
			if (scrollScheduled) return;
			scrollScheduled = true;
			requestAnimationFrame(runUpdate);
		};
		let io = null;
		let ioRows = [];
		let scrollListenerAttached = null;
		const onScrollerScroll = () => { scheduleActive(); };
		const bindIO = () => {
			if (io !== null) io.disconnect();
			if (scrollListenerAttached !== null) {
				scrollListenerAttached.removeEventListener('scroll', onScrollerScroll);
				scrollListenerAttached = null;
			}
			const root = scrollerOf();
			if (root === null) { io = null; ioRows = []; return; }
			io = new IntersectionObserver(() => { scheduleActive(); }, {
				root,
				rootMargin: '0px 0px -15% 0px',
				threshold: [0, 0.25, 0.5, 0.75, 1],
			});
			root.addEventListener('scroll', onScrollerScroll, { passive: true });
			scrollListenerAttached = root;
			ioRows = userRows();
			ioRows.forEach((row) => { io.observe(row); });
		};
		let flowEl = null;
		let sizeObserver = null;
		const bindFlow = (next) => {
			if (next === flowEl) return false;
			flowEl = next;
			if (sizeObserver !== null) sizeObserver.disconnect();
			sizeObserver = null;
			if (next !== null) {
				sizeObserver = new ResizeObserver(() => { requestPosition(); });
				let el = next;
				while (el !== null && el !== document.body) {
					sizeObserver.observe(el);
					el = el.parentElement;
				}
			}
			return true;
		};
		let scheduled = false;
		const schedule = () => {
			if (scheduled) return;
			scheduled = true;
			requestAnimationFrame(() => { scheduled = false; render(); });
		};
		const observer = new MutationObserver((mutations) => {
			const flow = flowOf();
			if (bindFlow(flow)) {
				bindIO();
				schedule();
				return;
			}
			// 轻量路径：只判断变更是否落在对话流内（不在此处做全量行扫描，
			// 行结构变化由 renderInner 在重建时重挂 IO）。
			for (const mutation of mutations) {
				if (mutation.target === bar || bar.contains(mutation.target)) continue;
				if (mutation.target === preview || preview.contains(mutation.target)) continue;
				if (mutation.target === topBox || topBox.contains(mutation.target)) continue;
				if (flow !== null && (mutation.target === flow || flow.contains(mutation.target))) {
					schedule();
					return;
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		window.addEventListener('resize', requestPosition);
		//#endregion

		//#region debug
		window.__DSNAV_DEBUG__ = {
			version: VERSION,
			lastError: null,
			lastErrorAt: null,
			update(info) {
				Object.assign(this, info);
			},
		};
		const publishDebug = () => {
			try {
				const flow = flowOf();
				const fr = flow !== null ? flow.getBoundingClientRect() : null;
				const scroller = scrollerOf();
				const sr = scroller !== null ? scroller.getBoundingClientRect() : null;
				const br = bar.getBoundingClientRect();
				window.__DSNAV_DEBUG__.update({
					renderedAt: Date.now(),
					totalRounds,
					visibleRows: builtRows.length,
					visibleOffset,
					activeGlobal,
					selectedGlobal,
					railScrollTop: Math.round(bar.scrollTop),
					olderLoading,
					backgroundLoads,
					lastBackgroundLoadAt,
					barRect: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height), display: getComputedStyle(bar).display },
					flowRect: fr !== null ? { x: Math.round(fr.x), w: Math.round(fr.width) } : null,
					scrollerRect: sr !== null ? { right: Math.round(sr.right), top: Math.round(sr.top), h: Math.round(sr.height) } : null,
				});
			} catch { /* debug only */ }
		};
		//#endregion

		//#region entry
		module.exports.inject = ['sessions'];

		module.exports.apply = function apply(ctx) {
			// Idempotency: a re-apply (hot re-mount) must not leave the roots
			// detached — re-attach them before rendering.
			if (!bar.isConnected) document.body.appendChild(bar);
			if (!preview.isConnected) document.body.appendChild(preview);
			try {
				sessions = ctx.get('sessions');
			} catch {
				sessions = null;
			}
			if (sessions === undefined) sessions = null;

			let unsubSessions = null;
			if (sessions !== null) {
				try {
					unsubSessions = sessions.list.subscribe(schedule);
				} catch {
					unsubSessions = null;
				}
			}
			// v4 时代的置顶框是"累积芯片"模型，v5 改为"单条选中"，清掉旧键。
			try {
				const sid = currentSessionId();
				if (sid !== null) localStorage.removeItem(`${STORAGE_PREFIX}top:${sid}`);
			} catch { /* ignore */ }

			bindFlow(flowOf());
			bindIO();
			render();
			console.log(`[dsh-session-nav] v${VERSION} loaded`, {
				rows: builtRows.length,
				totalRounds,
				theme: document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
			});

			// Insurance: any missed mutation would otherwise leave the rail
			// hidden forever — re-render periodically for the first minutes.
			let pollCount = 0;
			const pollTimer = setInterval(() => {
				pollCount += 1;
				if (pollCount > POLL_MAX) { clearInterval(pollTimer); return; }
				schedule();
			}, POLL_MS);

			// 压缩历史缓慢预载：切换会话后未压缩内容立即显示，压缩内容
			// 在后台按 SLOW_LOAD_MS 间隔逐页补齐（空闲才点，绝不堆积）。
			const slowTimer = setInterval(slowTick, SLOW_LOAD_MS);

			return () => {
				clearInterval(pollTimer);
				clearInterval(slowTimer);
				if (wheelRaf !== null) { cancelAnimationFrame(wheelRaf); wheelRaf = null; }
				observer.disconnect();
				if (sizeObserver !== null) sizeObserver.disconnect();
				if (io !== null) io.disconnect();
				if (scrollListenerAttached !== null) {
					scrollListenerAttached.removeEventListener('scroll', onScrollerScroll);
				}
				if (unsubSessions !== null) unsubSessions();
				document.removeEventListener('click', onOutsideClick, true);
				window.removeEventListener('resize', requestPosition);
				bar.remove();
				preview.remove();
				topBox.remove();
				const style = document.getElementById(STYLE_ID);
				if (style !== null) style.remove();
				delete window.__DSNAV_DEBUG__;
			};
		};
		//#endregion

		return module.exports;
	}
});
