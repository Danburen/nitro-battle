import type { Vec2, VoronoiGraph } from "./types.ts";

export interface VoronoiRenderOptions {
    fill?: boolean;
    edges?: boolean;
    points?: boolean;
    fillAlpha?: number;
    hueOffset?: number;
}

export function fillWrappedPolygon(
    ctx: CanvasRenderingContext2D,
    polygon: readonly Vec2[],
    graph: VoronoiGraph,
    width: number,
    height: number,
): void {
    if (polygon.length < 3) return;

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const p of polygon) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

    const minShiftX = graph.domain.periodicX ? -1 : 0;
    const maxShiftX = graph.domain.periodicX ? 1 : 0;
    const minShiftY = graph.domain.periodicY ? -1 : 0;
    const maxShiftY = graph.domain.periodicY ? 1 : 0;

    for (let ox = minShiftX; ox <= maxShiftX; ox++) {
        if (maxX + ox * width < 0 || minX + ox * width > width) continue;

        for (let oy = minShiftY; oy <= maxShiftY; oy++) {
            if (maxY + oy * height < 0 || minY + oy * height > height) continue;

            const dx = ox * width;
            const dy = oy * height;

            ctx.beginPath();
            ctx.moveTo(polygon[0].x + dx, polygon[0].y + dy);
            for (let i = 1; i < polygon.length; i++) {
                ctx.lineTo(polygon[i].x + dx, polygon[i].y + dy);
            }
            ctx.closePath();
            ctx.fill();
        }
    }
}

/**
 * Stroke a segment, drawing the wrapped copies needed on a periodic canvas.
 * The caller owns `beginPath()` / `stroke()`.
 *
 * With `adjustToShortest` the endpoint is folded to the nearest periodic copy
 * of `b`. Pass `false` when `b` already is the exact lifted endpoint (e.g. a
 * Delaunay edge that legitimately leaves the fundamental domain): folding that
 * edge would replace it with a different torus geodesic that crosses other
 * edges.
 */
export function drawWrappedLine(
    ctx: CanvasRenderingContext2D,
    a: Vec2,
    b: Vec2,
    width: number,
    height: number,
    periodicX = true,
    periodicY = true,
    adjustToShortest = true,
): void {
    let dx = b.x - a.x;
    let dy = b.y - a.y;

    if (adjustToShortest && periodicX) {
        if (dx > width / 2) dx -= width;
        else if (dx < -width / 2) dx += width;
    }
    if (adjustToShortest && periodicY) {
        if (dy > height / 2) dy -= height;
        else if (dy < -height / 2) dy += height;
    }

    const bx = a.x + dx;
    const by = a.y + dy;

    const minX = Math.min(a.x, bx), maxX = Math.max(a.x, bx);
    const minY = Math.min(a.y, by), maxY = Math.max(a.y, by);

    const minShiftX = periodicX ? -1 : 0;
    const maxShiftX = periodicX ? 1 : 0;
    const minShiftY = periodicY ? -1 : 0;
    const maxShiftY = periodicY ? 1 : 0;

    for (let ox = minShiftX; ox <= maxShiftX; ox++) {
        if (maxX + ox * width < 0 || minX + ox * width > width) continue;

        for (let oy = minShiftY; oy <= maxShiftY; oy++) {
            if (maxY + oy * height < 0 || minY + oy * height > height) continue;

            ctx.moveTo(a.x + ox * width, a.y + oy * height);
            ctx.lineTo(bx + ox * width, by + oy * height);
        }
    }
}

/** Draw a dot per site. The 0.01 offset keeps round line caps visible. */
export function drawSites(
    ctx: CanvasRenderingContext2D,
    sites: readonly Vec2[],
): void {
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();

    for (const p of sites) {
        ctx.moveTo(p.x + 0.01, p.y);
        ctx.lineTo(p.x, p.y);
    }

    ctx.stroke();
}

/** Draw each Delaunay edge once, as the background mesh. */
export function drawDelaunayEdges(
    ctx: CanvasRenderingContext2D,
    graph: VoronoiGraph,
    color: string,
    width: number,
    height: number,
): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineCap = "butt";
    ctx.beginPath();

    const { periodicX, periodicY } = graph.domain;

    for (let site = 0; site < graph.sites.length; site++) {
        const a = graph.sites[site];

        for (const edge of graph.adjacency[site]) {
            // The adjacency list is symmetric; draw each pair once.
            if (edge.site <= site) continue;
            drawWrappedLine(
                ctx,
                a,
                { x: a.x + edge.dx, y: a.y + edge.dy },
                width,
                height,
                periodicX,
                periodicY,
                false,
            );
        }
    }

    ctx.stroke();
}

export function drawVoronoi(
    ctx: CanvasRenderingContext2D,
    graph: VoronoiGraph,
    width: number,
    height: number,
    options: VoronoiRenderOptions = {},
): void {
    const fill = options.fill ?? true;
    const edges = options.edges ?? true;
    const fillAlpha = options.fillAlpha ?? 0.15;
    const hueOffset = options.hueOffset ?? 0;

    if (fill) {
        for (const cell of graph.cells) {
            if (!cell.bounded) continue;
            const hue = (cell.site * 47 + hueOffset) % 360;
            ctx.fillStyle = `hsla(${hue}, 70%, 60%, ${fillAlpha})`;
            fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
        }
    }

    if (edges) {
        ctx.strokeStyle = "rgba(51, 65, 85, 0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();

        const { periodicX } = graph.domain;

        for (const edge of graph.edges) {
            drawWrappedLine(
                ctx,
                graph.vertices[edge.a],
                graph.vertices[edge.b],
                width,
                height,
                periodicX,
            );
        }

        ctx.stroke();
    }

    if (options.points) {
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();

        for (const p of graph.sites) {
            ctx.moveTo(p.x + 0.01, p.y);
            ctx.lineTo(p.x, p.y);
        }

        ctx.stroke();
    }
}
