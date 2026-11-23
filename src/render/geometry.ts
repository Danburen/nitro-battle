import type { Vec2 } from "../terrain/voronoi/index.ts";
import { drawWrappedLine } from "../terrain/voronoi/index.ts";
import type { GameState } from "../game/types/state.ts";
import { NEUTRAL, NEUTRAL_COLOR } from "../game/types/world.ts";
import { nationDisplayColor } from "../game/access.ts";
import type { MapMode } from "./types.ts";

/** Add every periodic copy of a cell polygon that can touch the viewport. */
export function addWrappedPolygonPath(
    ctx: CanvasRenderingContext2D,
    polygon: readonly Vec2[],
    width: number,
    height: number,
): void {
    if (polygon.length < 3) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polygon) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    for (let ox = -1; ox <= 1; ox++) {
        if (maxX + ox * width < 0 || minX + ox * width > width) continue;
        for (let oy = -1; oy <= 1; oy++) {
            if (maxY + oy * height < 0 || minY + oy * height > height) continue;
            const dx = ox * width;
            const dy = oy * height;
            ctx.moveTo(polygon[0].x + dx, polygon[0].y + dy);
            for (let i = 1; i < polygon.length; i++) {
                ctx.lineTo(polygon[i].x + dx, polygon[i].y + dy);
            }
            ctx.closePath();
        }
    }
}

/** Offset a border edge toward one side's interior so the rim stays inside that nation. */
export function pushRim(
    rims: Map<string, [Vec2, Vec2][]>,
    owner: number,
    cell: { bounded: boolean; centroid: Vec2 },
    a: Vec2,
    b: Vec2,
    state: GameState,
): void {
    if (owner === NEUTRAL || !cell.bounded) return;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if ((cell.centroid.x - mx) * nx + (cell.centroid.y - my) * ny < 0) {
        nx = -nx;
        ny = -ny;
    }
    const inset = 3.2;
    const color = nationDisplayColor(state, owner);
    const list = rims.get(color) ?? [];
    list.push([
        { x: a.x + nx * inset, y: a.y + ny * inset },
        { x: b.x + nx * inset, y: b.y + ny * inset },
    ]);
    rims.set(color, list);
}

/** Outer boundary edges of a state: province edges whose neighbor lies outside the state. */
export function stateBoundary(stateId: number, state: GameState): [Vec2, Vec2][] {
    const { graph, terrain, states } = state;
    const region = states[stateId];
    if (!region) return [];
    const members = new Set(region.provinces);
    const segments: [Vec2, Vec2][] = [];
    for (const site of region.provinces) {
        const cell = graph.cells[site];
        if (!cell.bounded || !terrain.passable[site]) continue;
        for (let k = 0; k < cell.neighbors.length; k++) {
            if (members.has(cell.neighbors[k])) continue;
            segments.push([cell.polygon[k], cell.polygon[(k + 1) % cell.polygon.length]]);
        }
    }
    return segments;
}

/** Batch-stroke hairlines, coasts and national borders for a set of cells. */
export function drawEdges(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    sites: Iterable<number>,
    mapMode: MapMode,
    rimOn: boolean,
): void {
    const { graph, terrain, provinces } = state;
    const { width, height } = graph.domain;
    const count = provinces.length;
    const seen = new Set<number>();
    const hairlines: [Vec2, Vec2][] = [];
    const coasts: [Vec2, Vec2][] = [];
    const stateLines: [Vec2, Vec2][] = [];
    const borders = new Map<string, [Vec2, Vec2][]>();
    const rims = new Map<string, [Vec2, Vec2][]>();

    for (const site of sites) {
        const cell = graph.cells[site];
        if (!cell.bounded) continue;
        const province = provinces[site];
        for (let k = 0; k < cell.neighbors.length; k++) {
            const neighbor = cell.neighbors[k];
            const key = Math.min(site, neighbor) * count + Math.max(site, neighbor);
            if (seen.has(key)) continue;
            seen.add(key);

            const other = provinces[neighbor];
            const a = cell.polygon[k];
            const b = cell.polygon[(k + 1) % cell.polygon.length];
            const landA = terrain.passable[site] === 1;
            const landB = terrain.passable[neighbor] === 1;

            if (landA !== landB) {
                coasts.push([a, b]);
            } else if (landA && province.owner !== other.owner) {
                const owner = province.owner !== NEUTRAL ? province.owner : other.owner;
                const color = owner === NEUTRAL ? NEUTRAL_COLOR : nationDisplayColor(state, owner);
                const list = borders.get(color) ?? [];
                list.push([a, b]);
                borders.set(color, list);
                if (rimOn) {
                    pushRim(rims, province.owner, cell, a, b, state);
                    pushRim(rims, other.owner, graph.cells[neighbor], a, b, state);
                }
            } else if (landA && province.stateId !== other.stateId) {
                stateLines.push([a, b]);
            } else if (mapMode === "province") {
                hairlines.push([a, b]);
            }
        }
    }

    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(13, 17, 23, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of hairlines) drawWrappedLine(ctx, a, b, width, height, true, true, false);
    ctx.stroke();

    const stateMode = mapMode === "state";
    ctx.strokeStyle = "rgba(13, 17, 23, 0.55)";
    ctx.lineWidth = stateMode ? 2.4 : 1.6;
    ctx.beginPath();
    for (const [a, b] of coasts) drawWrappedLine(ctx, a, b, width, height, true, true, false);
    ctx.stroke();

    ctx.strokeStyle = stateMode ? "rgba(13, 17, 23, 0.5)" : "rgba(13, 17, 23, 0.38)";
    ctx.lineWidth = stateMode ? 2 : 1.3;
    ctx.beginPath();
    for (const [a, b] of stateLines) drawWrappedLine(ctx, a, b, width, height, true, true, false);
    ctx.stroke();

    // Gradient zoomed-in: nation-color rim inset inside each national border.
    if (rimOn) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 4.5;
        for (const [color, segments] of rims) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            for (const [a, b] of segments) drawWrappedLine(ctx, a, b, width, height, true, true, false);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Nation borders: one unified dark line, deeper than province/state lines.
    ctx.strokeStyle = "rgba(13, 17, 23, 0.92)";
    ctx.lineWidth = stateMode ? 3.2 : 2.2;
    ctx.beginPath();
    for (const segments of borders.values()) {
        for (const [a, b] of segments) drawWrappedLine(ctx, a, b, width, height, true, true, false);
    }
    ctx.stroke();
}
