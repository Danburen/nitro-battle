import {
    canonicalPoint,
    circumcenter,
    periodicDistanceSq,
    polygonAreaCentroid,
} from "./geometry.ts";
import type {
    DelaunayMesh,
    Domain,
    GraphOptions,
    NavEdge,
    Point,
    Vec2,
    VoronoiCell,
    VoronoiEdge,
    VoronoiGraph,
    VoronoiStats,
    VoronoiVertex,
} from "./types.ts";
import { pMod } from "../../../utils/math.ts";
import { buildTorusMesh } from "./delaunay.ts";

const TILE_SPAN = 3;
/** Copy index of the centre tile in the 3x3 lift: dy = 0, dx = 0. */
const CENTER_COPY = 4;

/** `edgeOfHalfedge` cache states. */
const EDGE_UNRESOLVED = -1;
const EDGE_NONE = -2;

/** Next halfedge in the same triangle: `3t -> 3t+1 -> 3t+2 -> 3t`. */
function nextHalfedge(e: number): number {
    return e % 3 === 2 ? e - 2 : e + 1;
}

/** Previous halfedge in the same triangle. */
function prevHalfedge(e: number): number {
    return e % 3 === 0 ? e + 2 : e - 1;
}

/** Lifted coordinates of a triangulation vertex id. */
function liftedPoint(mesh: DelaunayMesh, id: number): Vec2 {
    const siteCount = mesh.points.length;
    const site = id % siteCount;
    const copy = Math.floor(id / siteCount);
    const { width, height } = mesh.domain;

    return {
        x: mesh.points[site].x + ((copy % TILE_SPAN) - 1) * width,
        y: mesh.points[site].y + (Math.floor(copy / TILE_SPAN) - 1) * height,
    };
}

function emptyCell(site: number, point: Point): VoronoiCell {
    return {
        site,
        edges: [],
        neighbors: [],
        polygon: [],
        area: 0,
        centroid: { x: point.x, y: point.y },
        bounded: false,
    };
}

/**
 * Build the Voronoi dual graph from a periodic half-edge Delaunay mesh.
 *
 * Every Voronoi vertex is the circumcenter of a Delaunay triangle. Walking the
 * halfedges around a site's central copy (`e = twin(prev(e))`) yields the cell
 * polygon, its neighbours and the crossed Voronoi edges in one pass — no edge
 * keys, no angular sort, no fan-gap heuristics.
 *
 * The builder keeps the per-build scratch state in fields so each step below
 * stays small and readable. The algorithm and data layout are unchanged.
 */
class VoronoiBuilder {
    private readonly mesh: DelaunayMesh;
    private readonly domain: Domain;
    private readonly points: Point[];
    private readonly siteCount: number;
    private readonly triangles: Int32Array;
    private readonly halfedges: Int32Array;
    private readonly triangleCount: number;
    private readonly centerBase: number;

    private readonly mergeEpsilonSq: number;
    private readonly bucketSize: number;
    private readonly bucketCols: number;
    private readonly bucketRows: number;

    private readonly vertices: VoronoiVertex[] = [];
    private readonly vertexBuckets = new Map<string, number[]>();

    private readonly ccX: Float64Array;
    private readonly ccY: Float64Array;
    /** 0 = not computed, 1 = ready, 2 = degenerate. */
    private readonly ccState: Uint8Array;

    /** One outgoing halfedge per lifted vertex: the seed of the umbrella walk. */
    private readonly vertexHalfedge: Int32Array;

    private readonly edges: VoronoiEdge[] = [];
    private readonly edgeOfHalfedge: Int32Array;
    private readonly edgeByVertices = new Map<number, number>();
    private readonly edgeKeyBase: number;

    private readonly adjacency: NavEdge[][];
    private readonly cells: VoronoiCell[] = [];

    constructor(mesh: DelaunayMesh, options: GraphOptions) {
        this.mesh = mesh;
        this.domain = mesh.domain;
        this.points = mesh.points;
        this.siteCount = mesh.points.length;
        this.triangles = mesh.triangles;
        this.halfedges = mesh.halfedges;
        this.triangleCount = Math.floor(mesh.triangles.length / 3);
        this.centerBase = CENTER_COPY * this.siteCount;

        const scale = Math.max(this.domain.width, this.domain.height, 1);
        const mergeEpsilon = Math.max(options.mergeEpsilon ?? scale * 1e-7, 1e-9);
        this.mergeEpsilonSq = mergeEpsilon * mergeEpsilon;
        this.bucketSize = mergeEpsilon * 2;
        this.bucketCols = Math.max(1, Math.ceil(this.domain.width / this.bucketSize));
        this.bucketRows = Math.max(1, Math.ceil(this.domain.height / this.bucketSize));

        this.ccX = new Float64Array(this.triangleCount);
        this.ccY = new Float64Array(this.triangleCount);
        this.ccState = new Uint8Array(this.triangleCount);

        this.vertexHalfedge = new Int32Array(
            this.siteCount * TILE_SPAN * TILE_SPAN,
        ).fill(-1);
        for (let e = 0; e < this.triangles.length; e++) {
            const vertex = this.triangles[e];
            if (this.vertexHalfedge[vertex] === -1) this.vertexHalfedge[vertex] = e;
        }

        this.edgeOfHalfedge = new Int32Array(this.triangles.length).fill(EDGE_UNRESOLVED);
        this.edgeKeyBase = this.triangleCount + 1;
        this.adjacency = Array.from(
            { length: this.siteCount },
            (): NavEdge[] => [],
        );
    }

    build(): VoronoiGraph {
        for (let site = 0; site < this.siteCount; site++) {
            const outgoing = this.walkUmbrella(site);
            if (!outgoing) {
                this.cells.push(emptyCell(site, this.points[site]));
                continue;
            }

            const polygon = this.buildPolygon(outgoing);
            if (!polygon) {
                this.cells.push(emptyCell(site, this.points[site]));
                continue;
            }

            this.cells.push(this.buildCell(site, outgoing, polygon));
        }

        return {
            domain: this.domain,
            mesh: this.mesh,
            sites: this.points,
            cells: this.cells,
            vertices: this.vertices,
            edges: this.edges,
            adjacency: this.adjacency,
            cellCost: new Array<number>(this.siteCount).fill(1),
        };
    }

    /** Circulate CCW around the central copy of `site`. */
    private walkUmbrella(site: number): number[] | null {
        const start = this.vertexHalfedge[this.centerBase + site];
        if (start === -1) return null;

        const outgoing: number[] = [];
        let e = start;
        let guard = 0;

        do {
            outgoing.push(e);
            const step = this.halfedges[prevHalfedge(e)];

            if (step === -1 || ++guard > this.triangles.length) return null;

            e = step;
        } while (e !== start);

        return outgoing;
    }

    /** The circumcenters of the umbrella triangles, in cell order. */
    private buildPolygon(outgoing: number[]): Vec2[] | null {
        const polygon: Vec2[] = [];

        for (const halfedge of outgoing) {
            const triangle = Math.floor(halfedge / 3);
            if (!this.computeCenter(triangle)) return null;
            polygon.push({ x: this.ccX[triangle], y: this.ccY[triangle] });
        }

        return polygon.length >= 3 ? polygon : null;
    }

    /**
     * Build one cell.
     *
     * `polygon[k]` is the circumcenter of triangle k, and the cell edge from
     * `polygon[k]` to `polygon[k+1]` crosses Delaunay halfedge
     * `outgoing[k+1]` — that shared edge is the one the two triangles have in
     * common, which is why the index is offset by one.
     */
    private buildCell(site: number, outgoing: number[], polygon: Vec2[]): VoronoiCell {
        const cellEdges: number[] = [];
        const cellNeighbors: number[] = [];
        const adjacency = this.adjacency[site];
        const origin = this.points[site];
        const count = outgoing.length;

        for (let k = 0; k < count; k++) {
            // next triangle edge (not the same edge, umbrella walk has made sure that the outgoing is
            // from the original point to each outside point ,only one out direction )
            // because the CCW principle, we can directionally locate the next triangle
            const halfedge = outgoing[(k + 1) % count];
            const portal = this.dualEdge(halfedge);
            const headKeyId = this.triangles[nextHalfedge(halfedge)];
            const neighborSite = headKeyId % this.siteCount;
            // Keep the lifted position of the neighbour: on a torus the
            // Delaunay edge may connect to a copy one tile away, and the
            // shortest canonical wrap would be a different geodesic.
            const head = liftedPoint(this.mesh, headKeyId);
            const dx = head.x - origin.x;
            const dy = head.y - origin.y;

            cellEdges.push(portal);
            cellNeighbors.push(neighborSite);
            adjacency.push({
                site: neighborSite,
                cost: Math.hypot(dx, dy),
                portal,
                dx,
                dy,
            });
        }

        const measured = polygonAreaCentroid(polygon);

        return {
            site,
            edges: cellEdges,
            neighbors: cellNeighbors,
            polygon,
            area: Math.abs(measured.area),
            centroid: measured.centroid,
            bounded: true,
        };
    }

    /** Circumcenter of triangle `t`, cached in `ccX` / `ccY`. */
    private computeCenter(t: number): boolean {
        const state = this.ccState[t];
        if (state !== 0) return state === 1;

        const base = t * 3;
        const center = circumcenter(
            liftedPoint(this.mesh, this.triangles[base]),
            liftedPoint(this.mesh, this.triangles[base + 1]),
            liftedPoint(this.mesh, this.triangles[base + 2]),
        );

        if (!center) {
            this.ccState[t] = 2;
            return false;
        }

        this.ccX[t] = center.x;
        this.ccY[t] = center.y;
        this.ccState[t] = 1;
        return true;
    }

    /** Merge `position` into an existing Voronoi vertex, or add a new one. */
    private findOrCreateVertex(position: Vec2): number {
        const existing = this.findVertexNear(position);
        if (existing >= 0) return existing;

        const id = this.vertices.length;
        this.vertices.push({ x: position.x, y: position.y });

        const gx = Math.floor(position.x / this.bucketSize);
        const gy = Math.floor(position.y / this.bucketSize);
        const key = `${gx},${gy}`;
        const bucket = this.vertexBuckets.get(key);

        if (bucket) bucket.push(id);
        else this.vertexBuckets.set(key, [id]);

        return id;
    }

    /** Search the 3x3 bucket neighbourhood, wrapping on periodic axes. */
    private findVertexNear(position: Vec2): number {
        const gx = Math.floor(position.x / this.bucketSize);
        const gy = Math.floor(position.y / this.bucketSize);

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let bx = gx + dx;
                let by = gy + dy;

                if (this.domain.periodicX) bx = pMod(bx, this.bucketCols);
                if (this.domain.periodicY) by = pMod(by, this.bucketRows);

                const bucket = this.vertexBuckets.get(`${bx},${by}`);
                if (!bucket) continue;

                const found = this.findInBucket(bucket, position);
                if (found >= 0) return found;
            }
        }

        return -1;
    }

    private findInBucket(bucket: number[], position: Vec2): number {
        for (const id of bucket) {
            if (
                periodicDistanceSq(position, this.vertices[id], this.domain) <=
                this.mergeEpsilonSq
            ) {
                return id;
            }
        }

        return -1;
    }

    /**
     * Voronoi edge dual to Delaunay halfedge `e`, or -1 when it has none.
     *
     * The two adjacent circumcenters are canonicalised and merged first, so
     * periodic copies of the same edge collapse onto one `edges` entry.
     */
    private dualEdge(e: number): number {
        const cached = this.edgeOfHalfedge[e];
        if (cached !== EDGE_UNRESOLVED) return cached >= 0 ? cached : -1;

        const twin = this.halfedges[e];
        if (twin === -1) {
            this.markNoDual(e);
            return -1;
        }

        const left = Math.floor(e / 3);
        const right = Math.floor(twin / 3);
        // twin triangle must both have circum center
        if (!this.computeCenter(left) || !this.computeCenter(right)) {
            this.markNoDual(e, twin);
            return -1;
        }

        const a = this.findOrCreateVertex(
            canonicalPoint({ x: this.ccX[left], y: this.ccY[left] }, this.domain),
        );
        const b = this.findOrCreateVertex(
            canonicalPoint({ x: this.ccX[right], y: this.ccY[right] }, this.domain),
        );
        // two circum center coincide
        if (a === b) {
            this.markNoDual(e, twin);
            return -1;
        }
        // no order key
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = lo * this.edgeKeyBase + hi;
        const existing = this.edgeByVertices.get(key);

        if (existing !== undefined) {
            this.edgeOfHalfedge[e] = existing;
            this.edgeOfHalfedge[twin] = existing;
            return existing;
        }
        // Orient the stored edge by site id so both halfedges agree on a/b.
        const u = this.triangles[e] % this.siteCount;
        const v = this.triangles[nextHalfedge(e)] % this.siteCount;
        const id = this.edges.length;
        let edge: VoronoiEdge;

        if (u < v) edge = { a, b };
        else edge = { a: b, b: a };

        this.edges.push(edge);
        this.edgeByVertices.set(key, id);
        this.edgeOfHalfedge[e] = id;
        this.edgeOfHalfedge[twin] = id;

        return id;
    }

    private markNoDual(e: number, twin = -1): void {
        this.edgeOfHalfedge[e] = EDGE_NONE;
        if (twin >= 0) this.edgeOfHalfedge[twin] = EDGE_NONE;
    }
}

/**
 * Build the periodic (torus) Voronoi graph for `points`.
 *
 * Delaunay is part of the build: each pass lifts the sites into a 3x3 tiling
 * and dualises the resulting half-edge mesh. With `options.lloydIterations`
 * set, every Lloyd step re-triangulates the moved sites, so the returned graph
 * always matches the reported `mesh`.
 */
export function buildVoronoiGraph(
    points: readonly Point[],
    width: number,
    height: number,
    options: GraphOptions = {},
): VoronoiGraph {
    const iterations = Math.max(0, Math.floor(options.lloydIterations ?? 0));
    let graph = dualise(points, width, height, options);

    for (let i = 0; i < iterations && points.length > 0; i++) {
        graph = dualise(
            relaxSites(graph),
            width, height, options
        );
    }

    return graph;
}

/** One Delaunay pass over `points`, followed by its Voronoi dual. */
function dualise(
    points: readonly Point[],
    width: number,
    height: number,
    options: GraphOptions,
): VoronoiGraph {
    return new VoronoiBuilder(
        buildTorusMesh(points, width, height), options
    ).build();
}

/**
 * One Lloyd step: move every site onto the centroid of its own cell.
 *
 * A cell that failed to close keeps its site, and centroids are wrapped back
 * into the fundamental domain, so `points` stays canonical across the seam.
 */
function relaxSites(graph: VoronoiGraph): Point[] {
    const relaxed: Point[] = [];

    for (let site = 0; site < graph.sites.length; site++) {
        const cell = graph.cells[site];
        if (!cell.bounded) {
            relaxed.push(graph.sites[site]);
            continue;
        }

        const centre = canonicalPoint(cell.centroid, graph.domain);
        relaxed.push({ x: centre.x, y: centre.y, id: graph.sites[site].id });
    }

    return relaxed;
}

export function summarizeVoronoi(graph: VoronoiGraph): VoronoiStats {
    let totalArea = 0;

    for (const cell of graph.cells) {
        totalArea += cell.area;
    }

    return {
        siteCount: graph.sites.length,
        vertexCount: graph.vertices.length,
        edgeCount: graph.edges.length,
        cellCount: graph.cells.length,
        totalArea,
    };
}
