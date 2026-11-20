import { escapeGameText, escapeHtml, setGameText } from "./text.ts";

export function tooltipAttrs(title: string, body: string): string {
    return `data-tooltip-title="${escapeHtml(title)}" data-tooltip-body="${escapeHtml(body)}"`;
}

// Map payloads are semantic text, never HTML; dismissals reset the renderer's hover clock.
export const MAP_TOOLTIP_EVENT = "nitro:map-tooltip";
export const MAP_TOOLTIP_DISMISS_EVENT = "nitro:map-tooltip-dismiss";
export type MapTooltipRequest = { action: "hide"; anchor: HTMLCanvasElement } | {
    action: "show";
    anchor: HTMLCanvasElement;
    x: number;
    y: number;
    source: { kind: "province" | "state"; site: number; title: string; body: string };
};

export class GlobalTooltip {
    private readonly el = document.querySelector<HTMLElement>("#global-tooltip")!;
    private readonly titleEl = this.el.querySelector<HTMLElement>("strong")!;
    private readonly bodyEl = this.el.querySelector<HTMLElement>("p")!;
    private width = 0;
    private height = 0;
    private viewportWidth = 0;
    private viewportHeight = 0;
    private anchor: HTMLElement | null = null;
    private x = 0;
    private y = 0;
    private keyboard = false;
    private mapRequest: Extract<MapTooltipRequest, { action: "show" }> | null = null;

    constructor() {
        document.addEventListener(MAP_TOOLTIP_EVENT, this.onMapRequest);
        document.addEventListener("pointerover", this.onPointer);
        document.addEventListener("pointermove", this.onPointer);
        document.addEventListener("pointerout", this.onPointerOut);
        document.addEventListener("focusin", this.onFocus);
        document.addEventListener("focusout", this.onFocusOut);
        document.addEventListener("keydown", this.onKey);
        document.addEventListener("scroll", this.onHide, true);
        document.addEventListener("dragstart", this.onHide);
        document.addEventListener("pointerdown", this.onHide);
        window.addEventListener("blur", this.onHide);
    }

    destroy(): void {
        this.hide();
        document.removeEventListener(MAP_TOOLTIP_EVENT, this.onMapRequest);
        document.removeEventListener("pointerover", this.onPointer);
        document.removeEventListener("pointermove", this.onPointer);
        document.removeEventListener("pointerout", this.onPointerOut);
        document.removeEventListener("focusin", this.onFocus);
        document.removeEventListener("focusout", this.onFocusOut);
        document.removeEventListener("keydown", this.onKey);
        document.removeEventListener("scroll", this.onHide, true);
        document.removeEventListener("dragstart", this.onHide);
        document.removeEventListener("pointerdown", this.onHide);
        window.removeEventListener("blur", this.onHide);
    }

    refresh(): void {
        if (!this.anchor) return;
        const target = this.keyboard ? document.activeElement : document.elementFromPoint(this.x, this.y);
        if (this.mapRequest) {
            // HUD refreshes must preserve the renderer-owned canvas anchor.
            if (target !== this.anchor || !this.anchor.isConnected) this.hide();
            return;
        }
        this.show(this.findAnchor(target), true);
    }

    hide(): void {
        const mapAnchor = this.mapRequest?.anchor;
        this.mapRequest = null;
        if (this.anchor) {
            const ids = (this.anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id && id !== this.el.id);
            if (ids.length) this.anchor.setAttribute("aria-describedby", ids.join(" "));
            else this.anchor.removeAttribute("aria-describedby");
        }
        this.anchor = null;
        this.el.hidden = true;
        if (mapAnchor) this.dismissMap(mapAnchor);
    }

    private dismissMap(anchor: HTMLCanvasElement): void {
        document.dispatchEvent(new CustomEvent(MAP_TOOLTIP_DISMISS_EVENT, { detail: { anchor } }));
    }

    private readonly onMapRequest = (event: Event): void => {
        const request = (event as CustomEvent<MapTooltipRequest>).detail;
        if (!request || !(request.anchor instanceof HTMLCanvasElement)) return;
        if (request.action === "hide") {
            if (this.mapRequest?.anchor === request.anchor) this.hide();
            return;
        }
        if (request.action !== "show" || (request.source?.kind !== "province" && request.source?.kind !== "state")
            || !Number.isInteger(request.source.site) || request.source.site < 0
            || typeof request.source.title !== "string" || typeof request.source.body !== "string"
            || !Number.isFinite(request.x) || !Number.isFinite(request.y)) return;
        if (!request.anchor.isConnected || this.keyboard || (this.anchor && !this.mapRequest)
            || document.elementFromPoint(request.x, request.y) !== request.anchor) {
            if (this.mapRequest?.anchor === request.anchor) this.hide();
            else this.dismissMap(request.anchor);
            return;
        }
        this.x = request.x;
        this.y = request.y;
        this.show(request.anchor, false, request.source);
        if (this.anchor === request.anchor) this.mapRequest = request;
        else this.dismissMap(request.anchor);
    };

    private findAnchor(target: EventTarget | null): HTMLElement | null {
        return target instanceof Element ? target.closest<HTMLElement>("[data-tooltip-title], [data-tooltip-body], [title]") : null;
    }

    private show(anchor: HTMLElement | null, refresh = false, source?: { title: string; body: string }): void {
        if (!anchor || ((anchor !== this.anchor || refresh) && anchor.getClientRects().length === 0)) {
            this.hide();
            return;
        }
        if (!source && anchor.hasAttribute("title")) {
            anchor.dataset.tooltipBody = escapeGameText(anchor.getAttribute("title") ?? "");
            anchor.removeAttribute("title");
        }
        const title = source?.title ?? anchor.dataset.tooltipTitle ?? "";
        const body = source?.body ?? anchor.dataset.tooltipBody ?? "";
        if (!title && !body) {
            this.hide();
            return;
        }
        const moved = this.anchor !== anchor;
        if (moved) {
            this.hide();
            this.anchor = anchor;
            const ids = new Set((anchor.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
            ids.add(this.el.id);
            anchor.setAttribute("aria-describedby", [...ids].join(" "));
        }
        const titleChanged = setGameText(this.titleEl, title);
        const bodyChanged = setGameText(this.bodyEl, body);
        this.el.hidden = false;
        if (moved || refresh || titleChanged || bodyChanged || this.viewportWidth !== window.innerWidth || this.viewportHeight !== window.innerHeight) {
            this.width = this.el.offsetWidth;
            this.height = this.el.offsetHeight;
            this.viewportWidth = window.innerWidth;
            this.viewportHeight = window.innerHeight;
        }
        const rect = this.keyboard ? anchor.getBoundingClientRect() : null;
        const x = rect?.right ?? this.x;
        const y = rect?.top ?? this.y;
        this.el.style.left = `${Math.max(12, Math.min(x + 16, window.innerWidth - this.width - 12))}px`;
        this.el.style.top = `${Math.max(12, Math.min(y + 18, window.innerHeight - this.height - 12))}px`;
    }

    private readonly onPointer = (event: PointerEvent): void => {
        if (event.buttons) { this.hide(); return; }
        this.keyboard = false;
        this.x = event.clientX;
        this.y = event.clientY;
        if (this.mapRequest && event.target === this.mapRequest.anchor) return;
        this.show(this.findAnchor(event.target));
    };
    private readonly onPointerOut = (event: PointerEvent): void => {
        if (!this.anchor?.contains(event.relatedTarget as Node | null)) this.hide();
    };
    private readonly onFocus = (event: FocusEvent): void => {
        if (this.keyboard) this.show(this.findAnchor(event.target));
    };
    private readonly onFocusOut = (): void => { if (this.keyboard) this.hide(); };
    private readonly onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") this.hide();
        else if (["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) this.keyboard = true;
    };
    private readonly onHide = (): void => this.hide();
}
