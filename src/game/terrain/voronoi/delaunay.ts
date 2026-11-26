import type { DelaunayMesh, DelaunayResult, Point } from "./types.ts";
import { circumcenter, cross } from "./geometry.ts";

interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface Triangle {
    a: number;
    b: number;
    c: number;
    removed: boolean;
    bbox: BBox;
}

/**
 * Uniform grid over triangle circumcircle bounds.
 *
 * Each triangle is registered in every cell its circumcircle bbox touches, so
 * querying the 3x3 neighborhood of a point cannot miss a triangle whose
 * circumcircle contains it.
 */
class TriangleGrid {
    private readonly cellSize: number;
    private readonly cols: number;
    private readonly rows: number;
    private readonly minX: number;
    private readonly minY: number;
    private readonly cells: Array<Triangle[] | undefined>;

    constructor(minX: number, minY: number, maxX: number, maxY: number, cellSize: number) {
        this.minX = minX;
        this.minY = minY;
        this.cellSize = cellSize;
        this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize) + 1);
        this.rows = Math.max(1, Math.ceil((maxY - minY) / cellSize) + 1);
        this.cells = new Array<Triangle[] | undefined>(this.cols * this.rows);
    }

    private cellKey(cx: number, cy: number): number {
        return cy * this.cols + cx;
    }

    private toCellX(x: number): number {
        return Math.floor((x - this.minX) / this.cellSize);
    }

    private toCellY(y: number): number {
        return Math.floor((y - this.minY) / this.cellSize);
    }

    insert(t: Triangle): void {
        const { minX, minY, maxX, maxY } = t.bbox;

        let y0 = this.toCellY(minY);
        let x1 = this.toCellX(maxX);
        let y1 = this.toCellY(maxY);
        let x0 = this.toCellX(minX);
        // skip if out of grid
        if (x1 < 0 || y1 < 0 || x0 >= this.cols || y0 >= this.rows) return;
        // clamp to available range
        if (x0 < 0) x0 = 0;
        if (y0 < 0) y0 = 0;
        if (x1 >= this.cols) x1 = this.cols - 1;
        if (y1 >= this.rows) y1 = this.rows - 1;

        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                const key = this.cellKey(cx, cy);
                const list = this.cells[key];
                if (list) list.push(t);
                else this.cells[key] = [t];
            }
        }
    }

    /**
     * Query candidate triangles near point `p`.
     * The result may contain duplicates; callers should deduplicate if needed.
     *
     * @param p query point
     * @param out optional reusable output array
     */
    query(p: Point, out: Triangle[] = []): Triangle[] {
        out.length = 0;

        const cx = this.toCellX(p.x);
        const cy = this.toCellY(p.y);

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;

                const list = this.cells[this.cellKey(nx, ny)];
                if (list) {
                    for (let i = 0; i < list.length; i++) out.push(list[i]);
                }
            }
        }

        return out;
    }

    clear(): void {
        this.cells.fill(undefined);
    }
}

/** Toggle an edge: seen twice means it is interior, seen once means boundary. */
function toggle(set: Set<number>, key: number): void {
    if (set.has(key)) set.delete(key);
    else set.add(key);
}

/** Undirected edge key over a vertex-id range. */
function edgeKey(u: number, v: number, vertexCount: number): number {
    return u < v ? u * vertexCount + v : v * vertexCount + u;
}

function makePoint(x: number, y: number, id: number): Point {
    return { x, y, id };
}

/** Circumcircle bounding box, used as the spatial-grid key for a triangle. */
function circumcircleBBox(a: Point, b: Point, c: Point): BBox {
    const center = circumcenter(a, b, c);

    if (!center) {
        return {
            minX: Math.min(a.x, b.x, c.x),
            minY: Math.min(a.y, b.y, c.y),
            maxX: Math.max(a.x, b.x, c.x),
            maxY: Math.max(a.y, b.y, c.y),
        };
    }

    const r = Math.hypot(a.x - center.x, a.y - center.y);

    return {
        minX: center.x - r,
        minY: center.y - r,
        maxX: center.x + r,
        maxY: center.y + r,
    };
}

/** Build a CCW triangle and cache its circumcircle bbox. */
function createTriangle(a: number, b: number, c: number, points: readonly Point[]): Triangle {
    const pa = points[a];
    const pb = points[b];
    const pc = points[c];

    const area2 = cross(pb.x - pa.x, pb.y - pa.y, pc.x - pa.x, pc.y - pa.y);

    if (area2 < 0) {
        [a, b] = [b, a];
    }

    return {
        a,
        b,
        c,
        removed: false,
        bbox: circumcircleBBox(points[a], points[b], points[c]),
    };
}

function inCircumcircle(p: Point, t: Triangle, points: readonly Point[]): boolean {
    const A = points[t.a];
    const B = points[t.b];
    const C = points[t.c];

    const ax = A.x - p.x, ay = A.y - p.y;
    const bx = B.x - p.x, by = B.y - p.y;
    const cx = C.x - p.x, cy = C.y - p.y;

    const det =
        (ax * ax + ay * ay) * (bx * cy - cx * by) -
        (bx * bx + by * by) * (ax * cy - cx * ay) +
        (cx * cx + cy * cy) * (ax * by - bx * ay);

    return det > 0;
}

function makeSuperTriangle(points: readonly Point[]): Point[] {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

    const dx = maxX - minX;
    const dy = maxY - minY;
    const dmax = Math.max(dx, dy) || 1;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const factor = 20;

    return [
        makePoint(midX - factor * dmax, midY - dmax, -1),
        makePoint(midX, midY + factor * dmax, -2),
        makePoint(midX + factor * dmax, midY - dmax, -3),
    ];
}

/**
 * Link every triangle corner to the opposite corner of the adjacent triangle.
 *
 * Halfedge `3t + k` runs from `triangles[3t + k]` to `triangles[3t + (k + 1) % 3]`;
 * `halfedges[3t + k]` is the halfedge running the other way, or -1 on the hull.
 * Keys use raw vertex ids, so no tile arithmetic is needed: the triangulation
 * is a single connected mesh in the lift plane.
 *
 * sample u,v (no order) like: `
 * 0, 1; (1)0 , 2; (2)3, 0; key: 0 * n + 1, 0 * n + 2, 0 * n + 0
 * 3, 4; (4)3, 5; (5)3, 3;  key: 1* n + 3, 2 * n + 3, 0 * n + 3`
 *
 *
 * we use `halfedges` to link a edge to its twin edge with opposite direction
 */
function linkHalfedges(
    triangles: Int32Array,
    vertexCount: number,
): Int32Array {
    const halfedges = new Int32Array(triangles.length).fill(-1);
    const owner = new Map<number, number>();

    for (let e = 0; e < triangles.length; e++) {
        const base = e - (e % 3);
        const u = triangles[e];
        const v = triangles[base + ((e + 1) % 3)];
        const key = edgeKey(u, v, vertexCount);
        const twin = owner.get(key);

        if (twin === undefined) {
            owner.set(key, e);
        } else {
            halfedges[e] = twin;
            halfedges[twin] = e;
        }
    }

    return halfedges;
}

/**
 * Bowyer-Watson algorithm: build a Delaunay triangulation from a point set.
 *
 * Returns the triangles together with their halfedge twins. The output is a
 * plain planar mesh over `inputPoints`; super-triangle vertices are removed.
 */
export function bowyerWatson(inputPoints: readonly Point[]): DelaunayResult {
    if (inputPoints.length === 0) {
        return { points: [], triangles: new Int32Array(0), halfedges: new Int32Array(0) };
    }
    // Input points are never mutated, so share the objects instead of cloning.
    const points: Point[] = inputPoints.slice();
    const superTri = makeSuperTriangle(points);
    const superStart = points.length;
    points.push(...superTri);

    const N = points.length;

    const superTriangle = createTriangle(
        superStart,
        superStart + 1,
        superStart + 2,
        points,
    );

    const triangles: Triangle[] = [superTriangle];

    let gMinX = Infinity, gMinY = Infinity;
    let gMaxX = -Infinity, gMaxY = -Infinity;
    // using inputPoints instead of points to avoid super triangle influence otherwise
    // the ceil size will be too big so that it will contain whole dot cloud
    for (const p of inputPoints) {
        if (p.x < gMinX) gMinX = p.x;
        if (p.y < gMinY) gMinY = p.y;
        if (p.x > gMaxX) gMaxX = p.x;
        if (p.y > gMaxY) gMaxY = p.y;
    }

    const diag = Math.hypot(gMaxX - gMinX, gMaxY - gMinY) || 1;
    const cellSize = diag / Math.max(1, Math.sqrt(inputPoints.length));
    const grid = new TriangleGrid(gMinX, gMinY, gMaxX, gMaxY, cellSize);

    grid.insert(superTriangle);

    const boundaryEdges = new Set<number>();
    const candidates: Triangle[] = [];
    const badTriangles: Triangle[] = [];
    const seen = new Set<Triangle>();
    let removedCount = 0;

    for (let pi = 0; pi < inputPoints.length; pi++) {
        const p = points[pi];

        grid.query(p, candidates);
        seen.clear();
        // circum circle include the point which is 'bad triangle'
        badTriangles.length = 0;
        for (const t of candidates) {
            if (t.removed || seen.has(t)) continue;
            seen.add(t);
            if (inCircumcircle(p, t, points)) {
                badTriangles.push(t);
            }
        }
        // An edge shared by two bad triangles is interior; the rest is boundary.
        boundaryEdges.clear();
        for (const t of badTriangles) {
            toggle(boundaryEdges, edgeKey(t.a, t.b, N));
            toggle(boundaryEdges, edgeKey(t.b, t.c, N));
            toggle(boundaryEdges, edgeKey(t.c, t.a, N));
        }
        // remove bad triangles
        for (const t of badTriangles) {
            t.removed = true;
        }
        removedCount += badTriangles.length;
        // linked boundary edges and p to create new triangles
        for (const key of boundaryEdges) {
            const tri = createTriangle(Math.floor(key / N), key % N, pi, points);
            triangles.push(tri);
            grid.insert(tri);
        }
        // clear removed triangles with trigger threshold
        if (removedCount > inputPoints.length) {
            let write = 0;
            for (let read = 0; read < triangles.length; read++) {
                const t = triangles[read];
                if (!t.removed) triangles[write++] = t;
            }
            triangles.length = write;
            grid.clear();
            for (const t of triangles) {
                grid.insert(t);
            }
            removedCount = 0;
        }
    }
    // remove triangles which connect to the super triangles
    const kept: Triangle[] = [];
    for (const t of triangles) {
        if (t.removed) continue;
        if (t.a >= superStart || t.b >= superStart || t.c >= superStart) continue;
        kept.push(t);
    }

    const vertexCount = inputPoints.length;
    const outTriangles = new Int32Array(kept.length * 3);
    for (let i = 0; i < kept.length; i++) {
        const t = kept[i];
        outTriangles[i * 3] = t.a;
        outTriangles[i * 3 + 1] = t.b;
        outTriangles[i * 3 + 2] = t.c;
    }

    return {
        points: points.slice(0, vertexCount),
        triangles: outTriangles,
        halfedges: linkHalfedges(outTriangles, vertexCount),
    };
}

/**
 * Periodic Delaunay mesh for Voronoi / navigation.
 *
 * The point set is copied into a 3x3 tiling and triangulated in the lift plane,
 * so every wrapped neighbourhood exists. Triangle vertex ids stay in the lift
 * plane; `points` keeps only the N canonical sites. The centre tile is copy 4,
 * which is where `buildVoronoiGraph` walks its cells.
 */
export function buildTorusMesh(
    inputPoints: readonly Point[],
    w: number,
    h: number,
): DelaunayMesh {
    const points9: Point[] = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            for (const p of inputPoints) {
                points9.push({
                    x: p.x + dx * w,
                    y: p.y + dy * h,
                    id: p.id,
                });
            }
        }
    }

    const { triangles, halfedges } = bowyerWatson(points9);

    return {
        domain: { width: w, height: h, periodicX: true, periodicY: true },
        points: inputPoints.slice(),
        triangles,
        halfedges,
    };
}
