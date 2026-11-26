import { escapeHtml, gameText, setGameHtml } from "./text.ts";
import { rawTooltipAttrs, tooltipAttrs } from "./tooltip.ts";

/** Shared panel chrome: every panel head carries title, optional [i] help and a right-aligned status. */

export interface HelpSpec {
    /** Tooltip title, e.g. 作战手册 section name. */
    readonly title: string;
    /** Tooltip body; game-text tokens are supported. */
    readonly body: string;
    /** Accessible name; defaults to the title. */
    readonly label?: string;
}

export interface PanelHeadSpec {
    readonly title: string;
    readonly help?: HelpSpec;
    /** Extra attributes for the [i] button (focus keys, panel-specific hooks). */
    readonly helpAttrs?: string;
    /** Rendered right after the title, before the [i] button (inside `.panel-head-main`). */
    readonly titleExtras?: string;
    /** Rendered HTML between the help button and the status slot. */
    readonly extras?: string;
    /** Right-aligned status HTML; wrapped in `.objective`. */
    readonly status?: string;
}

/** Unfinished business marker is left to callers; the button itself is shared. */
export function helpButton(help: HelpSpec, attrs = ""): string {
    const label = help.label ?? help.title;
    return `<button type="button" 
                    class="intel-help intel-info" 
                    aria-label="${escapeHtml(gameText(label, "plain"))}" ${attrs} ${tooltipAttrs(help.title, help.body)}>i
            </button>`;
}

/** Same chrome as `helpButton`, but the body is trusted, already-rendered HTML. */
export function richHelpButton(title: string, bodyHtml: string, label = title, attrs = ""): string {
    const markup = `<div class="tip-reason">${bodyHtml}</div>`;
    return `<button type="button" class="intel-help intel-info" aria-label="${escapeHtml(gameText(label, "plain"))}" ${attrs} ${tooltipAttrs(title, "")} ${rawTooltipAttrs(markup)}>i</button>`;
}

export function panelHead(spec: PanelHeadSpec): string {
    return `<div class="panel-head"><div class="panel-head-main"><h2>${escapeHtml(spec.title)}</h2>${spec.titleExtras ?? ""}${
        spec.help ? helpButton(spec.help, spec.helpAttrs ?? "") : ""
    }</div>${spec.extras ?? ""}${spec.status ? `<span class="objective">${spec.status}</span>` : ""}</div>`;
}

export interface PanelView {
    readonly head: string;
    readonly body: string;
    readonly bodyClass?: string;
    /** Element attribute used to restore keyboard focus after a re-render. */
    readonly focusAttr?: string;
}

/** Re-render a dock panel while keeping its scroll offset and focused control. */
export function renderPanel(el: HTMLElement, view: PanelView): void {
    const previous = el.querySelector<HTMLElement>(".panel-body");
    const scrollTop = previous?.scrollTop ?? 0;
    const focusAttr = view.focusAttr ?? "data-focus-key";
    const active = document.activeElement instanceof HTMLElement && el.contains(document.activeElement)
        ? document.activeElement : null;
    const focusValue = active?.getAttribute(focusAttr);
    setGameHtml(el, `${view.head}<div class="panel-body${view.bodyClass ? ` ${view.bodyClass}` : ""}">${view.body}</div>`);
    const body = el.querySelector<HTMLElement>(".panel-body");
    if (body) body.scrollTop = scrollTop;
    if (focusValue) {
        [...el.querySelectorAll<HTMLElement>(`[${focusAttr}]`)]
            .find((element) => element.getAttribute(focusAttr) === focusValue && !element.matches(":disabled"))
            ?.focus({ preventScroll: true });
    }
}

/**
 * One dock panel as a reusable container: visibility, shared head/body chrome
 * and scroll-preserving re-render. Panels own their content; the shell owns the
 * frame so every panel looks and behaves the same.
 */
export class PanelShell {
    readonly el: HTMLElement;

    constructor(el: HTMLElement) {
        this.el = el;
    }

    get visible(): boolean {
        return !this.el.classList.contains("hidden");
    }

    show(): void {
        this.el.classList.remove("hidden");
    }

    hide(): void {
        this.el.classList.add("hidden");
    }

    clear(): void {
        setGameHtml(this.el, "");
    }

    render(view: PanelView): void {
        renderPanel(this.el, view);
    }
}