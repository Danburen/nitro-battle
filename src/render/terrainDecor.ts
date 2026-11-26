import { Biome } from "../game/terrain/biome.ts";
import type { BiomeMap } from "../game/terrain/biome.ts";
import type { Vec2, VoronoiGraph } from "../game/terrain/voronoi/index.ts";

/** Stable per-site pseudo random in [0, 1); rebuilds stay identical. */
function hash01(n: number): number {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
}

function cellRadius(polygon: readonly Vec2[], center: Vec2): number {
    let radius = 0;
    for (const point of polygon) {
        const distance = Math.hypot(point.x - center.x, point.y - center.y);
        if (distance > radius) radius = distance;
    }
    return radius;
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, snowy: boolean): void {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.62, y + size * 0.45);
    ctx.lineTo(x - size * 0.62, y + size * 0.45);
    ctx.closePath();
    ctx.fillStyle = snowy ? "#8fb59a" : "#2f6d3a";
    ctx.fill();
    ctx.strokeStyle = snowy ? "rgba(53, 84, 64, 0.55)" : "rgba(16, 38, 22, 0.6)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
}

function drawPeak(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, snowy: boolean): void {
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.7);
    ctx.lineTo(x, y - size);
    ctx.lineTo(x + size, y + size * 0.7);
    ctx.closePath();
    ctx.fillStyle = "rgba(92, 96, 110, 0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(40, 43, 53, 0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();

    if (snowy) {
        ctx.beginPath();
        ctx.moveTo(x - size * 0.36, y - size * 0.34);
        ctx.lineTo(x, y - size);
        ctx.lineTo(x + size * 0.36, y - size * 0.34);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
        ctx.fill();
    }
}

function drawHillLines(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    ctx.strokeStyle = "rgba(92, 88, 68, 0.42)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - size, y + size * 0.3);
    ctx.quadraticCurveTo(x, y - size * 0.85, x + size, y + size * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - size * 0.5, y - size * 0.35);
    ctx.quadraticCurveTo(x, y - size * 1.05, x + size * 0.6, y - size * 0.2);
    ctx.stroke();
}

/** Forest, hill and mountain props for one cell. Caller sets globalAlpha. */
export function drawTerrainDecorCell(
    ctx: CanvasRenderingContext2D,
    graph: VoronoiGraph,
    map: BiomeMap,
    site: number,
): void {
    const cell = graph.cells[site];
    if (!cell.bounded) return;
    const biome = map.biomeAt(site);
    if (biome !== Biome.FOREST && biome !== Biome.HILLS && biome !== Biome.MOUNTAINS) return;

    const center = cell.centroid;
    const radius = cellRadius(cell.polygon, center);
    const snowy = map.snowCover[site] >= 1;

    if (biome === Biome.FOREST) {
        const clusters = 1 + Math.floor(hash01(site * 3.1) * 2.6);
        for (let c = 0; c < clusters; c++) {
            const angle = hash01(site * 7.7 + c * 13.1) * Math.PI * 2;
            const distance = (0.12 + hash01(site * 11.3 + c * 17.9) * 0.5) * radius;
            const cx = center.x + Math.cos(angle) * distance;
            const cy = center.y + Math.sin(angle) * distance;
            const trees = 3 + Math.floor(hash01(site * 19.7 + c * 5.3) * 3);

            for (let t = 0; t < trees; t++) {
                const treeAngle = hash01(site * 23.9 + c * 31.1 + t * 7.7) * Math.PI * 2;
                const treeDist = hash01(site * 29.3 + c * 3.7 + t * 11.3) * radius * 0.22;
                const size = 2.6 + hash01(site * 37.1 + c * 13.7 + t * 5.1) * 2.4;
                drawTree(
                    ctx,
                    cx + Math.cos(treeAngle) * treeDist,
                    cy + Math.sin(treeAngle) * treeDist,
                    size,
                    snowy,
                );
            }
        }
    } else if (biome === Biome.HILLS) {
        const peaks = 1 + Math.floor(hash01(site * 5.9) * 2.4);
        for (let h = 0; h < peaks; h++) {
            const angle = hash01(site * 9.1 + h * 17.7) * Math.PI * 2;
            const distance = (0.1 + hash01(site * 13.3 + h * 7.9) * 0.4) * radius;
            const size = 5 + hash01(site * 21.7 + h * 3.1) * 4;
            drawHillLines(
                ctx,
                center.x + Math.cos(angle) * distance,
                center.y + Math.sin(angle) * distance,
                size,
            );
        }
    } else {
        const peaks = 1 + Math.floor(hash01(site * 6.3) * 2.7);
        for (let p = 0; p < peaks; p++) {
            const angle = hash01(site * 8.7 + p * 19.3) * Math.PI * 2;
            const distance = (0.1 + hash01(site * 12.9 + p * 5.7) * 0.45) * radius;
            const size = 6 + hash01(site * 24.5 + p * 9.9) * 6;
            drawPeak(
                ctx,
                center.x + Math.cos(angle) * distance,
                center.y + Math.sin(angle) * distance,
                size,
                snowy,
            );
        }
    }
}

/** Small forest, hill and mountain props layered over the biome fill. */
export function drawTerrainDecor(
    ctx: CanvasRenderingContext2D,
    graph: VoronoiGraph,
    map: BiomeMap,
): void {
    ctx.save();
    ctx.globalAlpha = 0.8;
    for (const cell of graph.cells) {
        drawTerrainDecorCell(ctx, graph, map, cell.site);
    }
    ctx.restore();
}
