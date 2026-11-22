import { escapeHtml, renderGameText } from "./text.ts";

export interface LegendItem {
    readonly label: string;
    /** Swatch fill; omit for pattern-only items. */
    readonly color?: string;
    /** Animated gold pulse, used for claimable states. */
    readonly pulse?: boolean;
    /** Dashed focus ring. */
    readonly ring?: boolean;
    /** Nation-color overlay swatch for claimed states. */
    readonly overlay?: string;
}

export interface LegendSpec {
    readonly title: string;
    readonly items: readonly LegendItem[];
    readonly note?: string;
}

/** Simple map legend on the left edge; showed only while a panel-driven map render mode is active. */
export class MapLegend {
    private readonly el: HTMLElement;
    private signature = "";

    constructor(el: HTMLElement) {
        this.el = el;
    }

    set(spec: LegendSpec | null): void {
        const signature = spec ? JSON.stringify(spec) : "";
        if (signature === this.signature) return;
        this.signature = signature;
        if (!spec) {
            this.el.classList.add("hidden");
            this.el.innerHTML = "";
            return;
        }
        const items = spec.items.map((item) => {
            const style = item.overlay
                ? ` style="--legend-fill:${escapeHtml(item.overlay)}"`
                : item.color && !item.ring ? ` style="background:${escapeHtml(item.color)}"` : "";
            return `<span class="map-legend-item"><i class="${item.pulse ? "pulse" : ""}${item.ring ? "ring" : ""}${item.overlay ? " overlay" : ""}"${style}></i>${escapeHtml(item.label)}</span>`;
        }).join("");
        this.el.innerHTML = `<div class="map-legend-head">${escapeHtml(spec.title)}</div>
            <div class="map-legend-items">${items}</div>
            ${spec.note ? `<p class="map-legend-note">${renderGameText(spec.note)}</p>` : ""}`;
        this.el.classList.remove("hidden");
    }
}