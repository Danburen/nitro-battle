import type { Vec2 } from "../game/terrain/voronoi/index.ts";
import type { BuildingKind } from "../game/types/building.ts";
import type { GameState } from "../game/types/state.ts";
import { BUILDING_PROFILES } from "../game/types/building.ts";
import { NEUTRAL_COLOR } from "../game/types/world.ts";
import { nationDisplayColor } from "../game/access.ts";
import { t } from "../i18n/index.ts";
import { PROVINCE_CAPACITY_MIN_ZOOM } from "./constructionOverlay.ts";
import type { ConstructionOverlay } from "./constructionOverlay.ts";
import { provinceResourceOutput } from "../game/economy.ts";
import { RESOURCE_MAP_COLORS, resourceTint } from "./resources.ts";
import { drawIcon } from "./icons.ts";
import type { MapMode } from "./types.ts";

export const RESOURCE_MARKER_MIN_ZOOM = 0.95;

/** Dense state building counters are dropped once the viewport grows this wide. */
export const REGION_COUNTER_MIN_ZOOM = 1;

const COUNTER_ICON_SIZE = 11;
const COUNTER_ROW_HEIGHT = 14;
const COUNTER_NAME_HEIGHT = 13;

/** Read-only rendering inputs shared by the map's label/marker helpers. */
export interface MarkerOptions {
    readonly mapMode: MapMode;
    readonly constructionActive: boolean;
    readonly constructionKind: BuildingKind | null;
    readonly constructionOverlay: ConstructionOverlay | null;
    readonly zoom: number;
    readonly resourceMode: boolean;
}

export function drawProvinceMarkers(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    site: number,
    options: MarkerOptions,
): void {
    if (options.constructionActive) return;
    const { graph, terrain, provinces } = state;
    const province = provinces[site];
    if (!terrain.passable[site]) return;
    const cell = graph.cells[site];
    const center = cell.bounded ? cell.centroid : graph.sites[site];
    const { width, height } = graph.domain;

    if (province.isCity && options.mapMode === "province") {
        drawCityMarker(ctx, center, province.isCapital, width, height);
    }
    if (province.buildings.length === 0) return;
    const label = province.buildings.map((kind) => BUILDING_PROFILES[kind].glyph).join(" ");
    ctx.save();
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const markerWidth = ctx.measureText(label).width + 8;
    for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
            const x = center.x + ox * width;
            const y = center.y + oy * height - 23;
            if (x < -markerWidth || x > width + markerWidth || y < -20 || y > height + 20) continue;
            ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
            ctx.strokeStyle = "rgba(230, 237, 243, 0.55)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(x - markerWidth / 2, y - 8, markerWidth, 16, 3);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#e6edf3";
            ctx.fillText(label, x, y);
        }
    }
    ctx.restore();
}

/** Icon-and-count rows for the resource colour mode, stacked in one panel above the marker row. */
export function drawResourceMarkers(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    site: number,
    options: MarkerOptions,
): void {
    if (!options.resourceMode || options.mapMode !== "province" || options.constructionActive
        || options.zoom < RESOURCE_MARKER_MIN_ZOOM) return;
    const { graph, terrain, provinces } = state;
    if (!terrain.passable[site]) return;
    const province = provinces[site];
    const { raw, strategic } = province.deposits;
    const { farmFood } = provinceResourceOutput(state, province);
    if (raw === 0 && strategic === 0 && farmFood <= 0) return;
    const rows: { icon: string; color: string; text: string }[] = [];
    if (raw > 0) rows.push({ icon: "raw", color: RESOURCE_MAP_COLORS.raw, text: `×${raw}` });
    if (strategic > 0) rows.push({ icon: "strategic", color: RESOURCE_MAP_COLORS.strategic, text: `×${strategic}` });
    if (farmFood > 0) {
        rows.push({ icon: "food", color: RESOURCE_MAP_COLORS.food, text: `×${Math.round(farmFood * 10) / 10}` });
    }
    const cell = graph.cells[site];
    const center = cell.bounded ? cell.centroid : graph.sites[site];
    const { width, height } = graph.domain;
    ctx.save();
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let textWidth = 0;
    for (const row of rows) textWidth = Math.max(textWidth, ctx.measureText(row.text).width);
    const iconSize = 11;
    const rowHeight = 14;
    const gap = 3;
    const pad = 4;
    const panelWidth = pad * 2 + iconSize + gap + textWidth;
    const panelHeight = pad * 2 + rows.length * rowHeight;
    const tintColor = resourceTint(state, province).color;
    for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
            const x = center.x + ox * width;
            // Grow upward from the building-marker row so stacked rows never cover it.
            const bottom = center.y + oy * height - 34;
            const top = bottom - panelHeight;
            if (x < -panelWidth || x > width + panelWidth || bottom < -20 || top > height + 20) continue;
            const left = x - panelWidth / 2;
            ctx.fillStyle = "rgba(13, 17, 23, 0.82)";
            ctx.strokeStyle = tintColor;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(left, top, panelWidth, panelHeight, 3);
            ctx.fill();
            ctx.stroke();
            for (let i = 0; i < rows.length; i++) {
                const rowCenter = top + pad + i * rowHeight + rowHeight / 2;
                drawIcon(ctx, rows[i].icon, rows[i].color, left + pad, rowCenter - iconSize / 2, iconSize);
                ctx.fillStyle = rows[i].color;
                ctx.fillText(rows[i].text, left + pad + iconSize + gap, rowCenter);
            }
        }
    }
    ctx.restore();
}

/** Screen-readable labels, one per visible periodic copy of a state center. */
export function drawRegionMarkers(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    options: MarkerOptions,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
): void {
    if (options.mapMode === "province") return;
    const { graph, terrain, provinces, states } = state;
    const { width, height } = graph.domain;
    const construction = options.constructionActive;
    const overlayAreas = new Map(options.constructionOverlay?.areas.map((area) => [area.id, area]));
    // Counter scaling stays in world space; state names stay readable when zoomed out.
    const scale = Math.max(0.9, Math.min(1.15, options.zoom)) / options.zoom;
    // A wide viewport shows many states at once; skip the stacked counters then.
    const showCounters = construction || options.zoom >= REGION_COUNTER_MIN_ZOOM;
    const nameFont = "600 11px system-ui, sans-serif";
    const counterFont = "600 11px system-ui, sans-serif";
    const stripe = 3;
    const padX = 5;
    const padY = 4;
    const rowGap = 3;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const region of states) {
        if (!terrain.passable[region.center]) continue;
        const capacity = construction ? overlayAreas.get(region.id) : undefined;
        if (construction && !capacity) continue;
        const rows: { icon: string; color: string; text: string }[] = [];
        let pendingText = "";
        if (capacity) {
            // built+pending keeps the queued part visible: `1+2/8`, pending drawn in green.
            pendingText = capacity.pending > 0 ? `+${capacity.pending}` : "";
            const count = pendingText
                ? `${capacity.built}${pendingText}/${capacity.limit}`
                : `${capacity.built}/${capacity.limit}`;
            rows.push({
                icon: BUILDING_PROFILES[options.constructionKind!].icon,
                color: "#e6edf3",
                text: capacity.used >= capacity.limit ? t("misc.markers.full", { count }) : count,
            });
        } else if (showCounters) {
            const farms = region.buildings.filter((kind) => kind === "farm").length;
            const counts: readonly [BuildingKind, string][] = [
                ["factory", `${region.factories}`],
                ["farm", `${farms}`],
                ["infrastructure", `L${region.infrastructure}`],
            ];
            for (const [kind, text] of counts) {
                rows.push({ icon: BUILDING_PROFILES[kind].icon, color: "#e6edf3", text });
            }
            if (region.buildings.includes("admin")) {
                rows.push({ icon: BUILDING_PROFILES.admin.icon, color: "#e6edf3", text: "1" });
            }
        }
        const province = provinces[region.center];
        const point = graph.sites[region.center];
        ctx.font = nameFont;
        const nameWidth = ctx.measureText(region.name).width;
        ctx.font = counterFont;
        let textWidth = 0;
        for (const row of rows) textWidth = Math.max(textWidth, ctx.measureText(row.text).width);
        const labelWidth = Math.max(nameWidth, COUNTER_ICON_SIZE + rowGap + textWidth) + padX * 2 + stripe + 2;
        const labelHeight = padY * 2 + COUNTER_NAME_HEIGHT + rows.length * COUNTER_ROW_HEIGHT;
        const bottom = -Math.max(26, 34 / scale);
        const top = bottom - labelHeight;
        const marginX = (labelWidth / 2 + 4) * scale;
        const marginY = (Math.max(Math.abs(top), Math.abs(bottom)) + 8) * scale;
        // Labels crossing a periodic seam must survive offscreen-center culling.
        const firstX = Math.ceil((minX - point.x - marginX) / width);
        const lastX = Math.floor((maxX - point.x + marginX) / width);
        const firstY = Math.ceil((minY - point.y - marginY) / height);
        const lastY = Math.floor((maxY - point.y + marginY) / height);
        for (let ox = firstX; ox <= lastX; ox++) {
            for (let oy = firstY; oy <= lastY; oy++) {
                ctx.save();
                ctx.translate(point.x + ox * width, point.y + oy * height);
                ctx.scale(scale, scale);
                ctx.strokeStyle = "rgba(230, 237, 243, 0.65)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, bottom);
                ctx.lineTo(0, -6);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(0, -5);
                ctx.lineTo(5, 0);
                ctx.lineTo(0, 5);
                ctx.lineTo(-5, 0);
                ctx.closePath();
                ctx.fillStyle = "#e6edf3";
                ctx.strokeStyle = "#0d1117";
                ctx.lineWidth = 1.5;
                ctx.fill();
                ctx.stroke();
                const left = -labelWidth / 2;
                ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
                ctx.strokeStyle = capacity && capacity.pending > 0
                    ? "rgba(63, 185, 80, 0.9)" : "rgba(230, 237, 243, 0.55)";
                ctx.lineWidth = capacity && capacity.pending > 0 ? 1.5 : 1;
                ctx.beginPath();
                ctx.roundRect(left, top, labelWidth, labelHeight, 4);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = capacity?.color ?? nationDisplayColor(state, province.owner) ?? NEUTRAL_COLOR;
                ctx.fillRect(left + 3, top + 5, stripe, 12);
                ctx.font = nameFont;
                ctx.fillStyle = "#f0f6fc";
                ctx.fillText(region.name, left + padX + stripe, top + padY + COUNTER_NAME_HEIGHT / 2);
                ctx.font = counterFont;
                const textX = left + padX + stripe + COUNTER_ICON_SIZE + rowGap;
                for (let i = 0; i < rows.length; i++) {
                    const rowY = top + padY + COUNTER_NAME_HEIGHT
                        + i * COUNTER_ROW_HEIGHT + COUNTER_ROW_HEIGHT / 2;
                    drawIcon(ctx, rows[i].icon, rows[i].color, textX - COUNTER_ICON_SIZE - rowGap, rowY - COUNTER_ICON_SIZE / 2, COUNTER_ICON_SIZE);
                    ctx.fillStyle = "#f0f6fc";
                    ctx.fillText(rows[i].text, textX, rowY);
                }
                if (capacity && pendingText) {
                    // Overdraw only the pending count so the green part stays compact.
                    const rowY = top + padY + COUNTER_NAME_HEIGHT + COUNTER_ROW_HEIGHT / 2;
                    ctx.fillStyle = "#3fb950";
                    ctx.fillText(pendingText, textX + ctx.measureText(`${capacity.built}`).width, rowY);
                }
                ctx.restore();
            }
        }
    }
    ctx.restore();
}

/** Compact capacity badges keep a fixed screen size, including periodic copies. */
export function drawProvinceCapacityMarkers(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    options: MarkerOptions,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
): void {
    if (!options.constructionActive || options.mapMode !== "province"
        || options.zoom < PROVINCE_CAPACITY_MIN_ZOOM || !options.constructionOverlay) return;
    const { graph } = state;
    const { width, height, periodicX, periodicY } = graph.domain;
    const scale = 1 / options.zoom;
    ctx.save();
    ctx.font = '600 13px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const area of options.constructionOverlay.areas) {
        const cell = graph.cells[area.center];
        const point = cell.bounded ? cell.centroid : graph.sites[area.center];
        const pending = area.pending > 0 ? `+${area.pending}` : "";
        const count = pending ? `${area.built}${pending}/${area.limit}` : `${area.built}/${area.limit}`;
        const label = `${BUILDING_PROFILES[options.constructionKind!].glyph} ${count}`;
        const labelWidth = ctx.measureText(label).width + 18;
        const labelHeight = 22;
        const marginX = (labelWidth / 2 + 1) * scale;
        const marginY = (labelHeight / 2 + 1) * scale;
        const firstX = periodicX ? Math.ceil((minX - point.x - marginX) / width) : 0;
        const lastX = periodicX ? Math.floor((maxX - point.x + marginX) / width) : 0;
        const firstY = periodicY ? Math.ceil((minY - point.y - marginY) / height) : 0;
        const lastY = periodicY ? Math.floor((maxY - point.y + marginY) / height) : 0;
        for (let ox = firstX; ox <= lastX; ox++) {
            for (let oy = firstY; oy <= lastY; oy++) {
                const x = point.x + ox * width;
                const y = point.y + oy * height;
                if (x + marginX < minX || x - marginX > maxX
                    || y + marginY < minY || y - marginY > maxY) continue;
                ctx.save();
                ctx.translate(x, y);
                ctx.scale(scale, scale);
                ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
                ctx.strokeStyle = pending ? "rgba(63, 185, 80, 0.9)" : "rgba(230, 237, 243, 0.55)";
                ctx.lineWidth = pending ? 1.5 : 1;
                ctx.beginPath();
                ctx.roundRect(-labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight, 4);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = area.color;
                ctx.fillRect(-labelWidth / 2 + 4, -6, 3, 12);
                ctx.fillStyle = "#f0f6fc";
                ctx.fillText(label, 3, 0);
                if (pending) {
                    const prefix = `${BUILDING_PROFILES[options.constructionKind!].glyph} ${area.built}`;
                    const start = 3 - ctx.measureText(label).width / 2;
                    ctx.save();
                    ctx.textAlign = "left";
                    ctx.fillStyle = "#3fb950";
                    ctx.fillText(pending, start + ctx.measureText(prefix).width, 0);
                    ctx.restore();
                }
                ctx.restore();
            }
        }
    }
    ctx.restore();
}

export function drawCityMarker(
    ctx: CanvasRenderingContext2D,
    center: Vec2,
    capital: boolean,
    width: number,
    height: number,
): void {
    for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
            const x = center.x + ox * width;
            const y = center.y + oy * height;
            if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;
            ctx.save();
            ctx.translate(x, y);
            if (capital) {
                ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    const r = i % 2 === 0 ? 9 : 4;
                    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
                    const px = Math.cos(angle) * r;
                    const py = Math.sin(angle) * r;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fillStyle = "#f0f6fc";
                ctx.strokeStyle = "rgba(13,17,23,0.9)";
                ctx.lineWidth = 2;
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.fillStyle = "rgba(13,17,23,0.85)";
                ctx.strokeStyle = "rgba(240,246,252,0.85)";
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(-6, 6);
                ctx.lineTo(-6, -1);
                ctx.lineTo(0, -7);
                ctx.lineTo(6, -1);
                ctx.lineTo(6, 6);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        }
    }
}
