import { escapeHtml, iconMaskStyle, setGameHtml } from "./text.ts";

export interface LegendIcon {
    /** External SVG name in `public/assets/icons/`. */
    readonly name: string;
    /** Glyph ink; matches the colour the map paints for this resource. */
    readonly color: string;
}

export interface LegendItem {
    readonly label: string;
    /** Swatch fill; omit for pattern-only items. */
    readonly color?: string;
    /** Resource icons replace the colour swatch, carrying the map colour as their ink. */
    readonly icons?: readonly LegendIcon[];
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

function markerHtml(item: LegendItem): string {
    if (item.icons?.length) {
        const glyphs = item.icons
            .map((icon) => `<span class="resource-icon" ${iconMaskStyle(icon.name, escapeHtml(icon.color))}></span>`)
            .join("");
        return `<span class="map-legend-icons" aria-hidden="true">${glyphs}</span>`;
    }
    const style = item.overlay
        ? ` style="--legend-fill:${escapeHtml(item.overlay)}"`
        : item.color && !item.ring ? ` style="background:${escapeHtml(item.color)}"` : "";
    return `<i class="${item.pulse ? "pulse" : ""}${item.ring ? "ring" : ""}${item.overlay ? " overlay" : ""}"${style}></i>`;
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
            setGameHtml(this.el, "");
            return;
        }
        const items = spec.items
            .map((item) => `<span class="map-legend-item">${markerHtml(item)}${escapeHtml(item.label)}</span>`)
            .join("");
        setGameHtml(this.el, `<div class="map-legend-head">${escapeHtml(spec.title)}</div>
            <div class="map-legend-items">${items}</div>
            ${spec.note ? `<p class="map-legend-note">${spec.note}</p>` : ""}`);
        this.el.classList.remove("hidden");
    }
}