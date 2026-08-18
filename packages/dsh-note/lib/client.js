/**
 * dsh-note browser half (hand-written bundle, no build step).
 *
 * One purely additive slot contribution:
 *
 *   `conversation.input.left` — a sticky-note button in the composer tool
 *   row, immediately right of the access (Full access) selector, styled
 *   exactly like the neighboring + button (28×28 round, same selector
 *   background and icon color tokens). Clicking it opens a floating editor
 *   (portal'd to <body>, so it survives any ancestor transform/overflow):
 *
 *     • the textarea is the 「新建便签」 editor. Below it one row holds
 *       「新建便签」 label, the 「历史便签」 entry button, the transient
 *       status (未保存 / 保存中… / 已保存 / errors; nothing when idle —
 *       the old 「空白便签」 placeholder is gone), and the 「保存」 button.
 *       Saving is explicit: clicking 保存 (`commitNote`) archives the
 *       finished text into history and clears the editor, ready for the
 *       next note. Nothing is saved automatically while typing; if the
 *       popover closes with unsaved content, that draft is written as a
 *       crash guard (`setNote`) and recovered on the next open.
 *     • clicking 「历史便签」 opens a separate floating window (portal'd
 *       to <body>, z-index above the editor) listing one entry per saved
 *       note (newest first, timestamp + preview). The window is freely
 *       movable (drag its title bar) and resizable (drag its bottom-right
 *       handle); its last position/size is remembered in localStorage and
 *       restored on the next open. Clicking an entry expands its full text
 *       (with a copy button); each entry can be deleted individually via
 *       `deleteHistory`. ESC closes the history window first, then the
 *       editor; clicking outside the editor closes both.
 *
 * All failures render as status lines inside the popover — the native UI is
 * never touched.
 * @module dsh-note/client
 */
window.__ModuleLoader__.load({
  id: "dsh-note",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let React = require("react");
    let ReactDOM = require("react-dom");

    //#region constants
    const STYLE_ID = "dsh-note";
    const API_PATH = "/plugins/dsh-note/api";

    /** Popover width (px); used to clamp it inside the viewport. */
    const POP_WIDTH = 400;

    const STYLES = `
.dan-note-btn{background:var(--dsw-specific-selector);width:28px;height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:999px;flex:none;place-items:center;display:grid;padding:0;transition:background-color .1s}
.dan-note-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dan-note-btn:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.dan-note-btn[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.dan-note-pop{position:fixed;box-sizing:border-box;width:400px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-shadow-lv2);padding:12px;z-index:1200;transform:translateY(-100%);overflow:hidden}
.dan-note-main{flex-direction:column;display:flex}
.dan-note-edit{gap:8px;align-items:stretch;display:flex}
.dan-note-pop textarea{box-sizing:border-box;width:100%;min-height:150px;max-height:300px;resize:vertical;background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;outline:none;flex:1}
.dan-note-pop textarea:focus{border-color:var(--dsw-alias-border-l3);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-border-l3) 30%,transparent)}
.dan-note-pop textarea::placeholder{color:var(--dsw-alias-label-dimmed)}
.dan-note-row{flex:none;align-items:center;gap:8px;margin-top:6px;display:flex}
.dan-note-mode{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dan-note-histbtn{flex:none;align-items:center;gap:4px;height:26px;padding:0 8px;border:none;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px;line-height:18px;white-space:nowrap;display:inline-flex}
.dan-note-histbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dan-note-histbtn:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.dan-note-status{flex:1;min-width:0;text-align:right;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dan-note-err{color:var(--dsw-alias-state-error-primary)}
.dan-note-save{flex:none;box-sizing:border-box;height:28px;padding:0 16px;border:none;border-radius:14px;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px;font-weight:500;line-height:28px;white-space:nowrap}
.dan-note-save:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dan-note-save:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.dan-note-save:disabled{opacity:.5;cursor:default}
.dan-note-histwin{position:fixed;box-sizing:border-box;min-width:280px;min-height:220px;background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-shadow-lv2);padding:12px;z-index:1300;flex-direction:column;display:flex;overflow:hidden}
.dan-note-histwin-title{flex:none;align-items:center;gap:8px;justify-content:space-between;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary);margin-bottom:6px;display:flex;cursor:move;user-select:none;touch-action:none}
.dan-note-histwin-resize{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;touch-action:none}
.dan-note-histwin-resize:after{content:"";position:absolute;right:4px;bottom:4px;width:8px;height:8px;border-right:2px solid var(--dsw-alias-border-l3);border-bottom:2px solid var(--dsw-alias-border-l3);border-bottom-right-radius:2px}
.dan-note-histwin-close{flex:none;width:24px;height:24px;place-items:center;color:var(--dsw-alias-label-tertiary);background:none;border:none;border-radius:6px;cursor:pointer;padding:0;display:grid;font-size:14px;line-height:1}
.dan-note-histwin-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dan-note-histwin-list{flex:1;min-height:0;overflow-y:auto;flex-direction:column;gap:2px;padding-right:2px;display:flex}
.dan-note-hist-item{flex:none;align-items:center;gap:6px;border-radius:8px;padding:3px 4px 3px 8px;cursor:pointer;display:flex;position:relative}
.dan-note-hist-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dan-note-hist-item[data-open="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.dan-note-hist-item[draggable="true"]{cursor:grab;transition:transform .12s ease,box-shadow .12s ease,opacity .12s ease,background .12s ease}
.dan-note-hist-item[draggable="true"]:active{cursor:grabbing}
.dan-note-hist-item[data-dragging="1"]{opacity:.55;transform:scale(1.04) rotate(-1.2deg);box-shadow:0 8px 20px rgba(0,0,0,.28);z-index:2;background:var(--dsw-alias-bg-layer-2)}
.dan-note-hist-item[data-drag-over="1"]{background:var(--dsw-alias-interactive-bg-hover)}
.dan-note-hist-item[data-drag-side="before"]::before{content:"";position:absolute;left:4px;right:4px;top:-3px;height:2px;border-radius:1px;background:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));box-shadow:0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)) 55%,transparent)}
.dan-note-hist-item[data-drag-side="after"]::after{content:"";position:absolute;left:4px;right:4px;bottom:-3px;height:2px;border-radius:1px;background:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));box-shadow:0 0 6px color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary)) 55%,transparent)}
.dan-note-histwin-list[data-just-sorted="1"] .dan-note-hist-item{animation:dsh-note-settle .2s cubic-bezier(.22,1,.36,1)}
@keyframes dsh-note-settle{0%{transform:translateY(-5px) scale(.985);opacity:.55}60%{transform:translateY(1.5px) scale(1.005)}100%{transform:translateY(0) scale(1);opacity:1}}
.dan-note-hist-time{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.dan-note-hist-preview{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dan-note-hist-del{flex:none;width:22px;height:22px;place-items:center;color:var(--dsw-alias-label-tertiary);background:none;border:none;border-radius:6px;cursor:pointer;padding:0;display:grid}
.dan-note-hist-del:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.dan-note-hist-del:disabled{opacity:.5;cursor:default}
.dan-note-hist-copy{flex:none;width:22px;height:22px;place-items:center;color:var(--dsw-alias-label-tertiary);background:none;border:none;border-radius:6px;cursor:pointer;padding:0;display:grid}
.dan-note-hist-copy:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dan-note-hist-copy[data-copied="true"]{color:var(--dsw-alias-state-business-primary)}
.dan-note-hist-body{flex:none;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);margin:0 4px 4px 8px;padding:6px 8px;font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;max-height:140px;overflow-y:auto}
.dan-note-hist-empty{font-size:12px;line-height:18px;color:var(--dsw-alias-label-dimmed)}
`;
    //#endregion

    //#region icon
    /** The theme's list+pen glyph at 14px (matches the neighboring icons). */
    const NOTE_ICON = React.createElement(
      "svg",
      { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true },
      React.createElement("path", { d: "M10.8239 3.54733V4.78443H4.63437V3.54733H10.8239Z", fill: "currentColor" }),
      React.createElement("path", { d: "M10.8239 6.12629V7.36338H4.63437V6.12629H10.8239Z", fill: "currentColor" }),
      React.createElement("path", { d: "M9.073 8.70524V9.94234H4.63437V8.70524H9.073Z", fill: "currentColor" }),
      React.createElement("path", {
        d: "M9.13321 0.573526C10.0076 0.573525 10.7179 0.572522 11.285 0.63397C11.8645 0.696791 12.3743 0.831648 12.8193 1.1548C13.0776 1.34246 13.3056 1.57047 13.4933 1.82875C13.8164 2.2737 13.9513 2.7836 14.0141 3.36303C14.0755 3.93015 14.0745 4.64049 14.0745 5.51485V6.1757L12.7327 7.5629V5.51485C12.7327 4.61092 12.732 3.9862 12.6803 3.5081C12.6298 3.0427 12.5379 2.79497 12.4083 2.61654C12.3033 2.47211 12.176 2.34472 12.0315 2.23977C11.8531 2.11016 11.6054 2.01823 11.14 1.96777C10.6618 1.91601 10.0372 1.91539 9.13321 1.91539H6.32658C5.42262 1.91539 4.79796 1.91604 4.31983 1.96777C3.85451 2.01819 3.60672 2.11029 3.42827 2.23977C3.28392 2.34465 3.15643 2.47223 3.0515 2.61654C2.9219 2.79496 2.82997 3.04274 2.7795 3.5081C2.72774 3.9862 2.72712 4.61092 2.72712 5.51485V10.023C2.72712 10.9273 2.72773 11.5525 2.7795 12.0307C2.82992 12.4959 2.92205 12.7429 3.0515 12.9213C3.15645 13.0657 3.28384 13.1931 3.42827 13.2981C3.60676 13.4277 3.85408 13.5206 4.31983 13.5711C4.79797 13.6228 5.42259 13.6234 6.32658 13.6234H6.87057L5.57707 14.9593C5.03527 14.9556 4.57031 14.9467 4.17476 14.9039C3.59508 14.841 3.08558 14.7063 2.64048 14.383C2.38215 14.1953 2.15422 13.9684 1.96653 13.7101C1.64319 13.2649 1.50851 12.7546 1.4457 12.1748C1.38432 11.6076 1.38525 10.8974 1.38525 10.023V5.51485C1.38525 4.64049 1.38426 3.93015 1.4457 3.36303C1.50853 2.78363 1.64341 2.27368 1.96653 1.82875C2.15417 1.57059 2.38228 1.34239 2.64048 1.1548C3.08544 0.831805 3.59533 0.696762 4.17476 0.63397C4.74193 0.572552 5.45218 0.573525 6.32658 0.573526H9.13321Z", fill: "currentColor" }),
      React.createElement("path", { d: "M14.2193 14.9553H10.0124L11.3744 13.6134H14.2193V14.9553Z", fill: "currentColor" }),
      React.createElement("path", { d: "M8.24493 13.3711L7.49015 14.8806C7.40148 15.058 7.58961 15.2461 7.76695 15.1574L9.27651 14.4027L14.6147 9.09934L13.5832 8.06775L8.24493 13.3711Z", fill: "currentColor" })
    );

    /** The theme's trash glyph at 14px for deleting history entries. */
    const TRASH_ICON = React.createElement(
      "svg",
      { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true },
      React.createElement("path", {
        d: "M14.4782 4.84067L14.2138 10.1152C14.1102 12.1872 14.067 13.0115 13.3866 13.9607C13.1044 14.3546 12.7498 14.6912 12.3424 14.9535C11.8239 15.2872 11.2415 15.4316 10.5585 15.4998C9.88727 15.5668 9.04946 15.5656 7.99998 15.5656C6.95051 15.5656 6.1127 15.5668 5.44142 15.4998C4.75851 15.4316 4.17602 15.2872 3.65753 14.9535C3.25012 14.6912 2.89559 14.3546 2.61332 13.9607C1.93296 13.0115 1.88979 12.1872 1.78619 10.1152L1.52179 4.84067L2.89006 4.77277L3.15343 10.0463C3.26221 12.2218 3.32452 12.6015 3.72646 13.1624C3.90825 13.4161 4.13686 13.6334 4.39927 13.8023C4.66204 13.9714 5.00263 14.0792 5.57825 14.1367C6.16562 14.1953 6.92298 14.1963 7.99998 14.1963C9.07699 14.1963 9.83434 14.1953 10.4217 14.1367C10.9973 14.0792 11.3379 13.9714 11.6007 13.8023C11.8631 13.6334 12.0917 13.4161 12.2735 13.1624C12.6755 12.6015 12.7378 12.2218 12.8465 10.0463L13.1099 4.77277L14.4782 4.84067ZM5.43011 6.22849H6.7994V11.3909H5.43011V6.22849ZM9.20056 6.22849H10.5699V11.3909H9.20056V6.22849ZM8.53597 0.434431C9.17976 0.434431 9.6522 0.426926 10.0966 0.571258C10.2357 0.616451 10.3717 0.672554 10.502 0.738948C10.9182 0.951107 11.2464 1.29099 11.7015 1.74612L12.4978 2.54136H15.3742V3.91169H0.625732V2.54136H3.50218L4.29845 1.74612C4.75358 1.29099 5.08174 0.951107 5.49801 0.738948C5.62831 0.672554 5.76425 0.616451 5.90334 0.571258C6.34776 0.426926 6.82021 0.434431 7.46399 0.434431H8.53597ZM7.46399 1.80476C6.73208 1.80476 6.51641 1.81187 6.32617 1.87369C6.25545 1.89667 6.18668 1.92533 6.12041 1.95907C5.96398 2.03878 5.82348 2.16253 5.44142 2.54136H10.5585C10.1765 2.16253 10.036 2.03878 9.87955 1.95907C9.81329 1.92533 9.74452 1.89667 9.6738 1.87369C9.48356 1.81187 9.26789 1.80476 8.53597 1.80476H7.46399Z",
        fill: "currentColor"
      })
    );

    /** The theme's copy glyph at 14px for copying an expanded history entry. */
    const COPY_ICON = React.createElement(
      "svg",
      { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true },
      React.createElement("path", {
        d: "M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z",
        fill: "currentColor"
      })
    );

    /** The theme's check glyph at 14px shown after a successful copy. */
    const CHECK_ICON = React.createElement(
      "svg",
      { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true },
      React.createElement("path", {
        d: "M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z",
        fill: "currentColor"
      })
    );

    /**
     * Format an ISO timestamp as `MM-DD HH:MM` (year added when it differs
     * from the current year) for the history list.
     */
    function formatTime(iso) {
      if (typeof iso !== "string") return "";
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      const now = new Date();
      const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      return date.getFullYear() === now.getFullYear() ? `${monthDay} ${clock}` : `${String(date.getFullYear())}-${monthDay} ${clock}`;
    }

    //#region history window geometry
    /** localStorage key remembering the last history-window position/size. */
    const HISTWIN_STORAGE_KEY = "dsh-note.histwin";
    const HISTWIN_MIN_W = 280;
    const HISTWIN_MIN_H = 220;
    const HISTWIN_DEF_W = 420;
    const HISTWIN_DEF_H = 420;

    function clamp(n, lo, hi) {
      return Math.min(Math.max(n, lo), hi);
    }

    /**
     * Load the last history-window geometry, clamped to the current viewport;
     * falls back to a centered default on first run.
     * @returns `{ pos: { left, top }, size: { width, height } }`.
     */
    function loadHistWinPrefs() {
      let saved = null;
      try {
        const raw = window.localStorage.getItem(HISTWIN_STORAGE_KEY);
        if (raw !== null) saved = JSON.parse(raw);
      } catch { /* storage unavailable -> defaults */ }
      const viewW = typeof window !== "undefined" && Number.isFinite(window.innerWidth) ? window.innerWidth : 800;
      const viewH = typeof window !== "undefined" && Number.isFinite(window.innerHeight) ? window.innerHeight : 600;
      const width = saved !== null && Number.isFinite(saved.width)
        ? clamp(saved.width, HISTWIN_MIN_W, Math.max(HISTWIN_MIN_W, viewW - 8))
        : Math.min(HISTWIN_DEF_W, Math.max(HISTWIN_MIN_W, viewW - 24));
      const height = saved !== null && Number.isFinite(saved.height)
        ? clamp(saved.height, HISTWIN_MIN_H, Math.max(HISTWIN_MIN_H, viewH - 8))
        : Math.min(HISTWIN_DEF_H, Math.max(HISTWIN_MIN_H, viewH - 24));
      const left = saved !== null && Number.isFinite(saved.left)
        ? clamp(saved.left, 8 - width + 80, Math.max(8, viewW - 80))
        : Math.max(8, Math.round((viewW - width) / 2));
      const top = saved !== null && Number.isFinite(saved.top)
        ? clamp(saved.top, 0, Math.max(0, viewH - 40))
        : Math.max(8, Math.round((viewH - height) / 2));
      return { pos: { left, top }, size: { width, height } };
    }

    /** Persist the history-window geometry (best effort). */
    function saveHistWinPrefs(pos, size) {
      try {
        window.localStorage.setItem(HISTWIN_STORAGE_KEY, JSON.stringify({
          left: pos.left,
          top: pos.top,
          width: size.width,
          height: size.height,
        }));
      } catch { /* storage unavailable -> not remembered */ }
    }
    //#endregion

    //#region history order (drag-to-sort)
    /** localStorage key remembering the user's manual history order. */
    const HISTORDER_STORAGE_KEY = "dsh-note.history-order";

    /** Load the saved history order (entry ids, first = top). */
    function loadHistOrder() {
      try {
        const raw = window.localStorage.getItem(HISTORDER_STORAGE_KEY);
        if (raw === null) return [];
        const value = JSON.parse(raw);
        return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
      } catch {
        return [];
      }
    }

    /** Persist the history order (best effort). */
    function saveHistOrder(order) {
      try {
        window.localStorage.setItem(HISTORDER_STORAGE_KEY, JSON.stringify(order));
      } catch { /* storage unavailable -> order not remembered */ }
    }

    /**
     * Apply the saved order to the history rows; entries never seen before
     * (newly saved notes) keep their natural position at the end.
     * @param rows - the history rows in natural (host) order.
     * @param order - saved entry-id order, newest position first.
     * @returns rows reordered by `order`.
     */
    function applyHistOrder(rows, order) {
      if (rows.length === 0 || order.length === 0) return rows;
      const position = new Map();
      order.forEach((id, index) => position.set(id, index));
      return [...rows].sort((a, b) => {
        const pa = position.get(a.id);
        const pb = position.get(b.id);
        if (pa !== undefined && pb !== undefined) return pa - pb;
        if (pa !== undefined) return -1;
        if (pb !== undefined) return 1;
        return 0;
      });
    }
    //#endregion

    //#region component
    /**
     * Sticky-note button + two-column editor. The popover is portal'd to
     * <body> and positioned above the button (fixed coordinates), so it is
     * never clipped by composer stacking contexts. Saving is explicit: the
     * 保存 button commits the finished text into history and clears the
     * editor. No autosave while typing; closing with unsaved content keeps
     * it as a recoverable draft. All failures render inside the popover.
     */
    function NoteButton() {
      const [open, setOpen] = React.useState(false);
      const [text, setText] = React.useState("");
      const [status, setStatus] = React.useState("idle");
      const [error, setError] = React.useState(null);
      const [pos, setPos] = React.useState(null);
      const [history, setHistory] = React.useState([]);
      const [histBusy, setHistBusy] = React.useState(null);
      const [histError, setHistError] = React.useState(null);
      const [expandedId, setExpandedId] = React.useState(null);
      const [histOpen, setHistOpen] = React.useState(false);
      const [copiedId, setCopiedId] = React.useState(null);
      const copyTimerRef = React.useRef(null);
      const [histOrder, setHistOrder] = React.useState(loadHistOrder);
      const [dragId, setDragId] = React.useState(null);
      const [dragOverId, setDragOverId] = React.useState(null);
      const [dragSide, setDragSide] = React.useState(null);
      const [justSorted, setJustSorted] = React.useState(false);
      const dragIdRef = React.useRef(null);
      const justSortedTimerRef = React.useRef(null);

      const histPrefs = React.useMemo(loadHistWinPrefs, []);
      const [histPos, setHistPos] = React.useState(histPrefs.pos);
      const [histSize, setHistSize] = React.useState(histPrefs.size);
      const histPosRef = React.useRef(histPrefs.pos);
      const histSizeRef = React.useRef(histPrefs.size);
      const dragRef = React.useRef(null);

      const rootRef = React.useRef(null);
      const popRef = React.useRef(null);
      const histRef = React.useRef(null);
      const btnRef = React.useRef(null);
      const textRef = React.useRef("");
      const loadedRef = React.useRef(false);
      const dirtyRef = React.useRef(false);
      const alive = React.useRef(true);
      const requestId = React.useRef(0);

      React.useEffect(() => () => { alive.current = false; clearTimeout(copyTimerRef.current); clearTimeout(justSortedTimerRef.current); }, []);

      /** Crash-guard: persist the draft (used only when closing with unsaved
       *  content, so a mid-edit refresh never loses it). */
      const save = React.useCallback(() => {
        const target = textRef.current;
        const id = requestId.current + 1;
        requestId.current = id;
        fetch(API_PATH, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ method: "setNote", text: target }),
          cache: "no-store",
        })
          .then((response) => response.json())
          .then((value) => {
            if (!alive.current || requestId.current !== id) return;
            // Only a real `{ ok: true }` clears the dirty flag; a business
            // failure must not silently drop the draft.
            if (value !== null && typeof value === "object" && value.ok === true) {
              dirtyRef.current = false;
            }
          })
          .catch(() => {});
      }, []);

      /** Explicit save (保存 button): commit the finished text into history
       *  and clear the editor for the next note. */
      const commit = React.useCallback(() => {
        const target = textRef.current;
        if (target === "" || status === "saving" || status === "loading") return;
        const id = requestId.current + 1;
        requestId.current = id;
        setStatus("saving");
        setError(null);
        fetch(API_PATH, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ method: "commitNote", text: target }),
          cache: "no-store",
        })
          .then((response) => response.json())
          .then((value) => {
            if (!alive.current || requestId.current !== id) return;
            if (value !== null && typeof value === "object" && value.ok === true) {
              dirtyRef.current = false;
              textRef.current = "";
              setText("");
              setExpandedId(null);
              if (value.value !== null && typeof value.value === "object" && Array.isArray(value.value.history)) {
                setHistory(value.value.history);
              }
              setStatus("saved");
            } else {
              setStatus("error");
              setError(value !== null && typeof value === "object" && typeof value.message === "string" ? value.message : "保存失败");
            }
          })
          .catch(() => {
            if (!alive.current || requestId.current !== id) return;
            setStatus("error");
            setError("网络错误，保存失败");
          });
      }, [status]);

      /** Load the persisted draft + history once when the popover opens. */
      const load = React.useCallback(() => {
        const id = requestId.current + 1;
        requestId.current = id;
        setStatus("loading");
        setError(null);
        fetch(API_PATH, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ method: "getNote" }),
          cache: "no-store",
        })
          .then((response) => response.json())
          .then((value) => {
            if (!alive.current || requestId.current !== id) return;
            if (value !== null && typeof value === "object" && value.ok === true) {
              const note = value.value !== null && typeof value.value === "object" ? value.value : null;
              const stored = note !== null && typeof note.text === "string" ? note.text : "";
              loadedRef.current = true;
              textRef.current = stored;
              dirtyRef.current = false;
              setText(stored);
              setHistory(note !== null && Array.isArray(note.history) ? note.history : []);
              setStatus(stored === "" ? "idle" : "dirty");
            } else {
              setStatus("error");
              setError(value !== null && typeof value === "object" && typeof value.message === "string" ? value.message : "便签加载失败");
            }
          })
          .catch(() => {
            if (!alive.current || requestId.current !== id) return;
            setStatus("error");
            setError("网络错误，便签加载失败");
          });
      }, []);

      /** Delete one history entry; removes it from the list on success. */
      const removeHistory = React.useCallback((id) => {
        if (histBusy !== null) return;
        const reqId = requestId.current + 1;
        requestId.current = reqId;
        setHistBusy(id);
        setHistError(null);
        fetch(API_PATH, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ method: "deleteHistory", id }),
          cache: "no-store",
        })
          .then((response) => response.json())
          .then((value) => {
            if (!alive.current) return;
            // Always release the delete lock, even if another note request
            // advanced requestId while deletion was in flight. The previous
            // stale guard could leave the delete button disabled forever.
            setHistBusy((current) => current === id ? null : current);
            if (requestId.current !== reqId) return;
            if (value !== null && typeof value === "object" && value.ok === true) {
              setHistory((current) => current.filter((entry) => entry !== null && typeof entry === "object" && entry.id !== id));
              setExpandedId((current) => current === id ? null : current);
            } else {
              setHistError(value !== null && typeof value === "object" && typeof value.message === "string" ? value.message : "删除失败");
            }
          })
          .catch(() => {
            if (!alive.current) return;
            setHistBusy((current) => current === id ? null : current);
            if (requestId.current !== reqId) return;
            setHistError("网络错误，删除失败");
          });
      }, [histBusy]);

      /** Copy an expanded history entry's full text to the clipboard. */
      const copyEntry = React.useCallback((id, entryText) => {
        const done = () => {
          setCopiedId(id);
          clearTimeout(copyTimerRef.current);
          copyTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
        };
        if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(entryText).then(done, () => {
            // Fallback for contexts where the async clipboard API is blocked.
            const area = document.createElement("textarea");
            area.value = entryText;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            let ok = false;
            try { ok = document.execCommand("copy"); } catch { /* noop */ }
            area.remove();
            if (ok) done();
            else setHistError("复制失败");
          });
          return;
        }
        setHistError("复制失败");
      }, []);

      //#region history window drag & resize
      /** Begin moving the history window from its title bar. */
      const onTitleDown = (event) => {
        if (event.button !== 0) return;
        dragRef.current = {
          mode: "move",
          startX: event.clientX,
          startY: event.clientY,
          startLeft: histPosRef.current.left,
          startTop: histPosRef.current.top,
        };
        event.preventDefault();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
      };
      const onTitleMove = (event) => {
        const drag = dragRef.current;
        if (drag === null || drag.mode !== "move") return;
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const width = histSizeRef.current.width;
        const next = {
          left: clamp(drag.startLeft + (event.clientX - drag.startX), 8 - width + 80, Math.max(8, viewW - 80)),
          top: clamp(drag.startTop + (event.clientY - drag.startY), 0, Math.max(0, viewH - 40)),
        };
        histPosRef.current = next;
        setHistPos(next);
      };
      const onTitleUp = (event) => {
        if (dragRef.current === null || dragRef.current.mode !== "move") return;
        dragRef.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        saveHistWinPrefs(histPosRef.current, histSizeRef.current);
      };

      /** Begin resizing the history window from its bottom-right handle. */
      const onResizeDown = (event) => {
        if (event.button !== 0) return;
        dragRef.current = {
          mode: "resize",
          startX: event.clientX,
          startY: event.clientY,
          startW: histSizeRef.current.width,
          startH: histSizeRef.current.height,
        };
        event.preventDefault();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
      };
      const onResizeMove = (event) => {
        const drag = dragRef.current;
        if (drag === null || drag.mode !== "resize") return;
        const viewW = window.innerWidth;
        const viewH = window.innerHeight;
        const next = {
          width: clamp(drag.startW + (event.clientX - drag.startX), HISTWIN_MIN_W, Math.max(HISTWIN_MIN_W, viewW - 8)),
          height: clamp(drag.startH + (event.clientY - drag.startY), HISTWIN_MIN_H, Math.max(HISTWIN_MIN_H, viewH - 8)),
        };
        histSizeRef.current = next;
        setHistSize(next);
      };
      const onResizeUp = (event) => {
        if (dragRef.current === null || dragRef.current.mode !== "resize") return;
        dragRef.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        saveHistWinPrefs(histPosRef.current, histSizeRef.current);
      };
      /** Finish a move/resize interrupted by pointer cancellation or capture loss. */
      const onPointerCancel = (event) => {
        if (dragRef.current === null) return;
        dragRef.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
        saveHistWinPrefs(histPosRef.current, histSizeRef.current);
      };
      //#endregion

      /** Close the popover (and any open history window); unsaved content
       *  becomes a recoverable draft. */
      const close = React.useCallback(() => {
        setOpen(false);
        setHistOpen(false);
        setExpandedId(null);
        if (dirtyRef.current) save();
      }, [save]);

      const toggle = React.useCallback(() => {
        if (open) {
          close();
          return;
        }
        const el = btnRef.current;
        if (el !== null) {
          const r = el.getBoundingClientRect();
          const left = Math.min(Math.max(r.left, 8), Math.max(8, window.innerWidth - POP_WIDTH - 8));
          setPos({ left, top: r.top - 8 });
        }
        setOpen(true);
        // Re-open always reloads: the draft/history may have changed
        // elsewhere, and a previous close may have left status stuck on
        // "saving"/"error" (an in-flight commit whose response was dropped).
        // `load()` resets status to "loading" and re-fetches everything.
        setStatus("idle");
        load();
      }, [open, close, load]);

      // Click-outside (button + popover are the protected surface) and ESC.
      // ESC closes the history window first, then the popover; a click
      // outside the popover closes both.
      React.useEffect(() => {
        if (!open) return;
        const onDown = (event) => {
          const target = event.target;
          const inside = rootRef.current !== null && rootRef.current.contains(target) ||
            popRef.current !== null && popRef.current.contains(target) ||
            histRef.current !== null && histRef.current.contains(target);
          if (!inside) {
            close();
            setHistOpen(false);
          }
        };
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          if (histOpen) {
            setHistOpen(false);
            return;
          }
          close();
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("pointerdown", onDown);
          document.removeEventListener("keydown", onKey);
        };
      }, [open, close, histOpen]);

      const onChange = (event) => {
        const value = event.target.value;
        textRef.current = value;
        setText(value);
        if (!loadedRef.current) return;
        dirtyRef.current = true;
        setStatus("dirty");
        setError(null);
      };

      const statusText = status === "loading" ? "加载中…"
        : status === "saving" ? "保存中…"
        : status === "saved" ? "已保存"
        : status === "error" ? (error ?? "出错了")
        : status === "dirty" ? "未保存"
        : "";

      const preview = text.replace(/\s+/g, " ").slice(0, 60);
      const title = preview.length > 0
        ? `便签：${preview}${text.length > 60 ? "…" : ""}（点击编辑）`
        : "便签（点击新建）";

      const histRows = [];
      for (const entry of history) {
        if (entry === null || typeof entry !== "object") continue;
        if (typeof entry.id !== "string" || entry.id === "") continue;
        histRows.push({
          id: entry.id,
          text: typeof entry.text === "string" ? entry.text : "",
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
        });
      }
      const orderedRows = applyHistOrder(histRows, histOrder);
      const commitOrder = (nextOrder) => {
        setHistOrder(nextOrder);
        saveHistOrder(nextOrder);
      };
      /** Begin dragging one history row. */
      const onDragStart = (event, id) => {
        dragIdRef.current = id;
        setDragId(id);
        try {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", id);
        } catch { /* dataTransfer unavailable -> drag still works locally */ }
      };
      const onDragEnd = () => {
        dragIdRef.current = null;
        setDragId(null);
        setDragOverId(null);
        setDragSide(null);
      };
      /** Keep the drag target highlighted while hovering a row, and show the
       *  insertion side (before/after) based on the pointer position. */
      const onDragOver = (event, id) => {
        event.preventDefault();
        try { event.dataTransfer.dropEffect = "move"; } catch { /* noop */ }
        if (dragOverId !== id) setDragOverId(id);
        const rect = event.currentTarget.getBoundingClientRect();
        const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        if (dragSide !== side) setDragSide(side);
      };
      const onDragLeave = (event, id) => {
        if (dragOverId !== id) return;
        const related = event.relatedTarget;
        if (related !== null && related !== undefined && event.currentTarget.contains(related)) return;
        setDragOverId(null);
        setDragSide(null);
      };
      /** Drop: move the dragged row before/after the target row, then play a
       *  short settle animation on the list for physical feedback. */
      const onDrop = (event, id) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOverId(null);
        setDragSide(null);
        const fromId = dragIdRef.current;
        dragIdRef.current = null;
        setDragId(null);
        if (fromId === null || fromId === id) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        const ids = orderedRows.map((row) => row.id);
        const fromIndex = ids.indexOf(fromId);
        if (fromIndex < 0) return;
        ids.splice(fromIndex, 1);
        const targetIndex = ids.indexOf(id);
        if (targetIndex < 0) return;
        ids.splice(after ? targetIndex + 1 : targetIndex, 0, fromId);
        commitOrder(ids);
        setJustSorted(true);
        clearTimeout(justSortedTimerRef.current);
        justSortedTimerRef.current = setTimeout(() => setJustSorted(false), 220);
      };
      const histItems = orderedRows.map((entry) => {
        const isOpen = expandedId === entry.id;
        const copied = copiedId === entry.id;
        const row = React.createElement(
          "div",
          {
            key: entry.id,
            className: "dan-note-hist-item",
            "data-open": isOpen || undefined,
            "data-dragging": dragId === entry.id || undefined,
            "data-drag-over": dragOverId === entry.id || undefined,
            "data-drag-side": dragOverId === entry.id && dragSide !== null ? dragSide : undefined,
            draggable: true,
            title: isOpen ? "收起" : "点击查看 · 拖动排序",
            onClick: () => setExpandedId(isOpen ? null : entry.id),
            onDragStart: (event) => onDragStart(event, entry.id),
            onDragEnd,
            onDragOver: (event) => onDragOver(event, entry.id),
            onDragLeave: (event) => onDragLeave(event, entry.id),
            onDrop: (event) => onDrop(event, entry.id),
          },
          React.createElement("span", { className: "dan-note-hist-time", title: entry.updatedAt }, formatTime(entry.updatedAt)),
          React.createElement("span", { className: "dan-note-hist-preview", title: entry.text }, entry.text),
          React.createElement("button", {
            type: "button",
            className: "dan-note-hist-copy",
            "data-copied": copied || undefined,
            "aria-label": copied ? "已复制" : "复制内容",
            title: copied ? "已复制" : "复制内容",
            onClick: (event) => { event.stopPropagation(); copyEntry(entry.id, entry.text); },
          }, copied ? CHECK_ICON : COPY_ICON),
          React.createElement("button", {
            type: "button",
            className: "dan-note-hist-del",
            "aria-label": "删除这条历史便签",
            title: "删除",
            disabled: histBusy !== null,
            onClick: (event) => { event.stopPropagation(); removeHistory(entry.id); },
          }, TRASH_ICON)
        );
        return isOpen
          ? React.createElement(React.Fragment, { key: entry.id }, row, React.createElement("div", { className: "dan-note-hist-body" }, entry.text))
          : row;
      });

      const pop = open ? ReactDOM.createPortal(
        React.createElement("div", { className: "dan-note-pop", ref: popRef, style: pos === null ? undefined : { left: pos.left, top: pos.top }, role: "dialog", "aria-label": "便签" },
          React.createElement("div", { className: "dan-note-main" },
            React.createElement("textarea", {
              value: text,
              onChange,
              disabled: status === "loading",
              placeholder: "写点什么…",
              maxLength: 16000,
              "aria-label": "新建便签内容",
              spellCheck: false,
            }),
            React.createElement("div", { className: "dan-note-row" },
              React.createElement("span", { className: "dan-note-mode" }, "新建便签"),
              React.createElement("button", {
                type: "button",
                className: "dan-note-histbtn",
                "aria-label": "历史便签",
                "aria-expanded": histOpen,
                title: `历史便签${history.length > 0 ? `（${history.length}）` : ""}`,
                onClick: () => setHistOpen((current) => !current),
              }, "历史便签"),
              React.createElement("span", { className: status === "error" ? "dan-note-status dan-note-err" : "dan-note-status" }, statusText),
              React.createElement("button", {
                type: "button",
                className: "dan-note-save",
                "aria-label": "保存便签",
                disabled: text === "" || status === "saving" || status === "loading",
                onClick: commit,
              }, "保存")
            )
          )
        ),
        document.body
      ) : null;

      const histWin = open && histOpen ? ReactDOM.createPortal(
        React.createElement("div", {
          className: "dan-note-histwin",
          ref: histRef,
          style: { left: histPos.left, top: histPos.top, width: histSize.width, height: histSize.height },
          role: "dialog",
          "aria-label": "历史便签",
        },
          React.createElement("div", {
            className: "dan-note-histwin-title",
            onPointerDown: onTitleDown,
            onPointerMove: onTitleMove,
            onPointerUp: onTitleUp,
            onPointerCancel,
            onLostPointerCapture: onPointerCancel,
          },
            React.createElement("span", null, `历史便签${history.length > 0 ? `（${history.length}）` : ""}`),
            histError !== null ? React.createElement("span", { className: "dan-note-err" }, histError) : null,
            React.createElement("button", {
              type: "button",
              className: "dan-note-histwin-close",
              "aria-label": "关闭历史便签",
              title: "关闭",
              onPointerDown: (event) => event.stopPropagation(),
              onClick: () => setHistOpen(false),
            }, "×")
          ),
          history.length === 0
            ? React.createElement("div", { className: "dan-note-hist-empty" }, "暂无历史")
            : React.createElement("div", { className: "dan-note-histwin-list", "data-just-sorted": justSorted || undefined }, histItems),
          React.createElement("div", {
            className: "dan-note-histwin-resize",
            onPointerDown: onResizeDown,
            onPointerMove: onResizeMove,
            onPointerUp: onResizeUp,
            onPointerCancel,
            onLostPointerCapture: onPointerCancel,
          })
        ),
        document.body
      ) : null;

      return React.createElement("div", { className: "dan-note", ref: rootRef },
        React.createElement("button", {
          type: "button",
          ref: btnRef,
          className: "dan-note-btn",
          "aria-label": "便签",
          "aria-expanded": open,
          title,
          onClick: toggle,
        }, NOTE_ICON),
        pop,
        histWin
      );
    }
    //#endregion

    //#region apply
    const inject = ["slots"];

    function apply(ctx) {
      ctx.effect(() => {
        if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {};
        const tag = document.createElement("style");
        tag.dataset.plugin = STYLE_ID;
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = STYLES;
        document.head.appendChild(tag);
        return () => { tag.remove(); };
      }, "dsh-note: styles");

      // Sticky-note button right of the access selector in the composer tool row.
      ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
        name: "conversation.input.left",
        id: "dsh-note",
        order: 0,
      }, NoteButton));
    }
    //#endregion

    exports.inject = inject;
    exports.apply = apply;

    return module.exports;
  }
});
