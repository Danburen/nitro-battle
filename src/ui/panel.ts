import { escapeHtml, renderGameText } from "./text.ts";
import { tooltipAttrs } from "./tooltip.ts";

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
    /** Rendered HTML between the help button and the status slot. */
    readonly extras?: string;
    /** Right-aligned status HTML; wrapped in `.objective`. */
    readonly status?: string;
}

/** Unfinished business marker is left to callers; the button itself is shared. */
export function helpButton(help: HelpSpec, attrs = ""): string {
    const label = help.label ?? help.title;
    return `<button type="button" class="intel-help intel-info" aria-label="${escapeHtml(renderGameText(label, "plain"))}" ${attrs} ${tooltipAttrs(help.title, help.body)}>i</button>`;
}

export function panelHead(spec: PanelHeadSpec): string {
    return `<div class="panel-head"><h2>${escapeHtml(spec.title)}</h2>${
        spec.help ? helpButton(spec.help, spec.helpAttrs ?? "") : ""
    }${spec.extras ?? ""}${spec.status ? `<span class="objective">${spec.status}</span>` : ""}</div>`;
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
    el.innerHTML = `${view.head}<div class="panel-body${view.bodyClass ? ` ${view.bodyClass}` : ""}">${view.body}</div>`;
    const body = el.querySelector<HTMLElement>(".panel-body");
    if (body) body.scrollTop = scrollTop;
    if (focusValue) {
        [...el.querySelectorAll<HTMLElement>(`[${focusAttr}]`)]
            .find((element) => element.getAttribute(focusAttr) === focusValue && !element.matches(":disabled"))
            ?.focus({ preventScroll: true });
    }
}