import type { Vec2 } from "../terrain/voronoi/index.ts";
import type { BuildingKind } from "../game/types/building.ts";
import type { GameState } from "../game/types/state.ts";
import { BUILDING_PROFILES } from "../game/types/building.ts";
import { NEUTRAL_COLOR } from "../game/types/world.ts";
import { nationDisplayColor } from "../game/access.ts";
import { PROVINCE_CAPACITY_MIN_ZOOM } from "./constructionOverlay.ts";
import type { ConstructionOverlay } from "./constructionOverlay.ts";
import type { MapMode } from "./types.ts";

/** Read-only rendering inputs shared by the map's label/marker helpers. */
export interface MarkerOptions {
    readonly mapMode: MapMode;
    readonly constructionActive: boolean;
    readonly constructionKind: BuildingKind | null;
    readonly constructionOverlay: ConstructionOverlay | null;
    readonly zoom: number;
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
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const region of states) {
        if (!terrain.passable[region.center]) continue;
        const capacity = construction ? overlayAreas.get(region.id) : undefined;
        if (construction && !capacity) continue;
        let buildingLabel: string;
        const pendingText = capacity && capacity.pending > 0 ? `+${capacity.pending}` : "";
        if (capacity) {
            // built+pending keeps the queued part visible: `1+2/8`, pending drawn in green.
            const count = pendingText
                ? `${capacity.built}${pendingText}/${capacity.limit}`
                : `${capacity.built}/${capacity.limit}`;
            buildingLabel = `${BUILDING_PROFILES[options.constructionKind!].glyph} ${count}`;
            if (capacity.used >= capacity.limit) buildingLabel += " 已满";
        } else {
            const farms = region.buildings.filter((kind) => kind === "farm").length;
            const markers = [
                `${BUILDING_PROFILES.factory.glyph}${region.factories}`,
                `${BUILDING_PROFILES.farm.glyph}${farms}`,
                `${BUILDING_PROFILES.infrastructure.glyph}L${region.infrastructure}`,
            ];
            if (region.buildings.includes("admin")) markers.push(BUILDING_PROFILES.admin.glyph);
            buildingLabel = markers.join(" · ");
        }
        const province = provinces[region.center];
        const point = graph.sites[region.center];
        const buildingFont = capacity
            ? '700 17px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
            : '11px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        const nameFont = capacity ? "600 11px system-ui, sans-serif" : "600 12px system-ui, sans-serif";
        ctx.font = buildingFont;
        const buildingWidth = ctx.measureText(buildingLabel).width + 16;
        ctx.font = nameFont;
        const labelWidth = Math.max(ctx.measureText(region.name).width + 28, buildingWidth);
        const labelHeight = capacity ? 42 : 34;
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
                ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
                ctx.strokeStyle = capacity && capacity.pending > 0
                    ? "rgba(63, 185, 80, 0.9)" : "rgba(230, 237, 243, 0.55)";
                ctx.lineWidth = capacity && capacity.pending > 0 ? 1.5 : 1;
                ctx.beginPath();
                ctx.roundRect(-labelWidth / 2, top, labelWidth, labelHeight, 4);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = capacity?.color ?? nationDisplayColor(state, province.owner) ?? NEUTRAL_COLOR;
                ctx.fillRect(-labelWidth / 2 + 4, top + 5, 3, 12);
                ctx.font = nameFont;
                ctx.fillStyle = "#f0f6fc";
                ctx.fillText(region.name, 3, top + 11);
                ctx.font = buildingFont;
                const buildingY = bottom - (capacity ? 13 : 8);
                ctx.fillStyle = "#f0f6fc";
                ctx.fillText(buildingLabel, 0, buildingY);
                if (capacity && pendingText) {
                    // Overdraw only the pending count so the green part stays compact.
                    const prefix = `${BUILDING_PROFILES[options.constructionKind!].glyph} ${capacity.built}`;
                    const start = -ctx.measureText(buildingLabel).width / 2;
                    ctx.save();
                    ctx.textAlign = "left";
                    ctx.fillStyle = "#3fb950";
                    ctx.fillText(pendingText, start + ctx.measureText(prefix).width, buildingY);
                    ctx.restore();
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
