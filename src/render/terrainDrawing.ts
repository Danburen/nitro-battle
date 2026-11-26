/**
 * Canvas-only terrain drawing helpers.
 *
 * Kept outside `src/game/**` so game logic stays platform-independent and can
 * run directly in Node.
 */

import {
    BIOME_PROFILES,
    BIOME_VALUES,
    Biome,
    classifyBiome,
    computeSnowCover,
    computeTemperature,
    TerrainField,
} from "../game/terrain/biome.ts";
import type { BiomeMap, TerrainFieldOptions } from "../game/terrain/biome.ts";
import type { Domain, Vec2, VoronoiGraph } from "../game/terrain/voronoi/index.ts";

const BIOME_RGB = BIOME_VALUES.map((biome) => hexToRgb(BIOME_PROFILES[biome].color));

/** Per-season color grade: tint rgb, blend amount, desaturation. Index = season. */
const SEASON_GRADES: ReadonlyArray<{ tint: readonly [number, number, number]; amount: number; desat: number }> = [
    { tint: [140, 220, 150], amount: 0.05, desat: 0 },
    { tint: [255, 196, 90], amount: 0.09, desat: 0 },
    { tint: [224, 130, 44], amount: 0.16, desat: 0.18 },
    { tint: [148, 178, 224], amount: 0.24, desat: 0.5 },
];

/** Biome color of one cell, shaded by elevation and graded by season. */
export function cellFillColor(map: BiomeMap, site: number, season = -1): string {
    const grade = season >= 0 && season < SEASON_GRADES.length ? SEASON_GRADES[season] : null;
    let rgb = shade(BIOME_RGB[map.biomeAt(site)], map.elevation[site]);
    if (grade) {
        if (grade.desat > 0) {
            const luma = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
            rgb = [
                rgb[0] + (luma - rgb[0]) * grade.desat,
                rgb[1] + (luma - rgb[1]) * grade.desat,
                rgb[2] + (luma - rgb[2]) * grade.desat,
            ];
        }
        rgb = [
            rgb[0] + (grade.tint[0] - rgb[0]) * grade.amount,
            rgb[1] + (grade.tint[1] - rgb[1]) * grade.amount,
            rgb[2] + (grade.tint[2] - rgb[2]) * grade.amount,
        ];
    }
    return `rgb(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0})`;
}

/** Fill Voronoi cells with their biome color, shaded by elevation. The range allows frame-sliced rebuilds. */
export function drawBiomes(
    ctx: CanvasRenderingContext2D,
    graph: VoronoiGraph,
    map: BiomeMap,
    width: number,
    height: number,
    season = -1,
    from = 0,
    to = graph.cells.length,
): void {
    for (let index = from; index < to; index++) {
        const cell = graph.cells[index];
        if (!cell.bounded) continue;

        ctx.fillStyle = cellFillColor(map, cell.site, season);
        fillWrappedPolygon(ctx, cell.polygon, graph, width, height);

        const snow = map.snowCover[cell.site];
        if (snow === 0) continue;

        ctx.fillStyle = snow >= 2
            ? "rgba(255, 255, 255, 0.9)"
            : "rgba(255, 255, 255, 0.5)";
        fillWrappedPolygon(ctx, cell.polygon, graph, width, height);
    }
}

/** Render the final biome map one pixel at a time. */
export function drawPixelTerrain(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    seed: number,
    options: TerrainFieldOptions = {},
    season = 0,
): void {
    if (width <= 0 || height <= 0) return;

    const domain: Domain = { width, height, periodicX: true, periodicY: true };
    const field = new TerrainField(domain, seed, options);
    const image = ctx.createImageData(width, height);
    const data = image.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sample = field.sample({ x: x + 0.5, y: y + 0.5 });
            const biome = classifyBiome(sample.elevation, sample.moisture);
            const temperature = computeTemperature(sample.elevation, season);
            const snow = biome === Biome.OCEAN
                ? 0
                : computeSnowCover(temperature, sample.moisture);
            const rgb = applySnow(
                shade(BIOME_RGB[biome], sample.elevation),
                snow,
            );
            const index = (y * width + x) * 4;

            data[index] = rgb[0];
            data[index + 1] = rgb[1];
            data[index + 2] = rgb[2];
            data[index + 3] = 255;
        }
    }

    ctx.putImageData(image, 0, 0);
}

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

function hexToRgb(hex: string): readonly [number, number, number] {
    const value = Number.parseInt(hex.slice(1), 16);

    return [
        (value >> 16) & 0xff,
        (value >> 8) & 0xff,
        value & 0xff,
    ];
}

/** Slightly darken low ground and brighten high ground. */
function shade(
    rgb: readonly [number, number, number],
    elevation: number,
): readonly [number, number, number] {
    const factor = 0.7 + 0.6 * elevation;

    return [
        Math.min(255, Math.round(rgb[0] * factor)),
        Math.min(255, Math.round(rgb[1] * factor)),
        Math.min(255, Math.round(rgb[2] * factor)),
    ];
}

function applySnow(
    rgb: readonly [number, number, number],
    snowCover: number,
): readonly [number, number, number] {
    if (snowCover === 0) return rgb;

    const alpha = snowCover >= 2 ? 0.9 : 0.5;

    return [
        Math.round(rgb[0] * (1 - alpha) + 255 * alpha),
        Math.round(rgb[1] * (1 - alpha) + 255 * alpha),
        Math.round(rgb[2] * (1 - alpha) + 255 * alpha),
    ];
}
