import type { Vec2 } from "../terrain/voronoi/index.ts";
import { drawWrappedLine, fillWrappedPolygon } from "../terrain/voronoi/index.ts";
import type { GameState } from "../game/types.ts";
import { nationDisplayColor } from "../game/access.ts";
import { stateBoundary } from "./geometry.ts";
import {
    CONSTRUCTION_BLOCKED_COLOR,
    CONSTRUCTION_PENDING_TINT,
} from "./constructionOverlay.ts";
import type { ConstructionOverlay } from "./constructionOverlay.ts";
import type { MapMode, NationHighlight } from "./types.ts";

/**
 * Breathing fill + marching outline shared by the claim overlay and the
 * briefing nation preview, so a selected realm reads exactly like a live
 * claim. `phase` offsets the pulse between neighbouring regions.
 */
export function drawPulseRegion(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    now: number,
    sites: readonly number[],
    segments: readonly [Vec2, Vec2][],
    color: string,
    phase: number,
    reduceMotion: boolean,
): void {
    const { graph, terrain } = state;
    const { width, height } = graph.domain;
    const wave = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260 + phase);
    ctx.save();
    ctx.globalAlpha = 0.06 + 0.14 * wave;
    ctx.fillStyle = color;
    for (const site of sites) {
        const cell = graph.cells[site];
        if (terrain.passable[site] && cell?.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
    }
    ctx.globalAlpha = 0.5 + 0.4 * wave;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = reduceMotion ? 0 : -((now / 55) % 12);
    ctx.beginPath();
    for (const [a, b] of segments) drawWrappedLine(ctx, a, b, width, height, true, true, false);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

/** Static national tint for the player's active claims. */
export function drawClaimLand(ctx: CanvasRenderingContext2D, state: GameState): void {
    const { graph, terrain, states, claims } = state;
    const { width, height } = graph.domain;
    const color = nationDisplayColor(state, 0);
    for (const claim of claims) {
        if (claim.nation !== 0) continue;
        const region = states[claim.stateId];
        if (!region) continue;
        ctx.save();
        ctx.globalAlpha = 0.24;
        ctx.fillStyle = color;
        for (const site of region.provinces) {
            const cell = graph.cells[site];
            if (terrain.passable[site] && cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
        }
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [a, b] of stateBoundary(claim.stateId, state)) drawWrappedLine(ctx, a, b, width, height, true, true, false);
        ctx.stroke();
        ctx.restore();
    }
}

/** Dashed highlight on the state currently selected in claims management. */
export function drawClaimFocus(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    focus: number | null,
    mapMode: MapMode,
): void {
    if (focus === null || mapMode !== "state") return;
    const region = state.states[focus];
    if (!region) return;
    const { graph } = state;
    const { width, height } = graph.domain;
    ctx.save();
    ctx.strokeStyle = "rgba(240, 246, 252, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (const [a, b] of stateBoundary(focus, state)) drawWrappedLine(ctx, a, b, width, height, true, true, false);
    ctx.stroke();
    ctx.restore();
}

/** Gold breathing fill + marching outline for states the player may claim right now. */
export function drawClaimablePulse(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    now: number,
    cache: readonly number[],
    reduceMotion: boolean,
): void {
    for (const stateId of cache) {
        const region = state.states[stateId];
        if (!region) continue;
        drawPulseRegion(ctx, state, now, region.provinces, stateBoundary(stateId, state), "#f0b429", stateId * 1.7, reduceMotion);
    }
}

/** Briefing preview: the selected nation flashes and its border marches like a claim. */
export function drawNationHighlight(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    now: number,
    highlight: NationHighlight,
    reduceMotion: boolean,
): void {
    drawPulseRegion(ctx, state, now, highlight.sites, highlight.segments, highlight.color, 0, reduceMotion);
}

/** Construction land shading; `overlay` is null when no build tool is active. */
export function drawConstructionLand(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    overlay: ConstructionOverlay | null,
): void {
    if (!overlay) return;
    const { graph } = state;
    const { width, height } = graph.domain;
    // Grey out everything the player cannot build in, so eligible plots read as the only choices.
    ctx.fillStyle = CONSTRUCTION_BLOCKED_COLOR;
    for (const site of overlay.blocked) {
        const cell = graph.cells[site];
        if (cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
    }
    for (const area of overlay.areas) {
        ctx.fillStyle = area.color;
        for (const site of area.sites) {
            const cell = graph.cells[site];
            if (cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
        }
        // A live order tints the whole plot: the cell is shaded, not just its counter.
        if (area.pending > 0) {
            ctx.fillStyle = CONSTRUCTION_PENDING_TINT;
            for (const site of area.sites) {
                const cell = graph.cells[site];
                if (cell.bounded) fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
            }
        }
    }
}
