export interface Vec2 {
    x: number;
    y: number;
}

export interface Domain {
    width: number;
    height: number;
    periodicX: boolean;
    periodicY: boolean;
}

export interface Point {
    x: number;
    y: number;
    id: number;
}

/**
 * Half-edge triangulation of a point set, with the tile lift folded into the
 * vertex ids.
 *
 * A triangle is three consecutive entries of `triangles`, in CCW order.
 * Halfedge `e` runs from `triangles[e]` to `triangles[next(e)]`, where
 * `next(e) = 3 * floor(e / 3) + (e + 1) % 3`. `halfedges[e]` is its twin, or
 * -1 when the twin lies outside the triangulation. Because triangles are CCW,
 * the triangle interior is to the left of every halfedge.
 *
 * For a periodic mesh, `triangles` refers to *lifted* vertices: id `k` means
 *
 *     site = k % points.length
 *     copy = floor(k / points.length)          // 0..8 over the 3x3 tiling
 *     x    = points[site].x + (copy % 3 - 1) * domain.width
 *     y    = points[site].y + (floor(copy / 3) - 1) * domain.height
 *
 * so `points` still holds one canonical site per domain and the lift never has
 * to be tracked separately.
 *
 * @param triangles     Int32Array of vertex ids, length 3 * triangleCount.
 */
export interface DelaunayResult {
    points: Point[];
    triangles: Int32Array;
    halfedges: Int32Array;
}

export interface DelaunayMesh extends DelaunayResult {
    domain: Domain;
}

/** A Voronoi vertex: the circumcenter of one or more cocircular triangles. */
export type VoronoiVertex = Vec2;

/** A Voronoi edge, dual to one Delaunay edge. */
export interface VoronoiEdge {
    /**
     * Vertex ids. `a` is the circumcenter of the triangle on the left of the
     * directed Delaunay edge, `b` the one on its right.
     */
    a: number;
    b: number;
}

export interface VoronoiCell {
    site: number;

    /**
     * `edges[i]` connects `polygon[i]` -> `polygon[(i + 1) % n]`. An unbounded
     * cell is empty in the current periodic-only build.
     */
    edges: number[];
    /** Neighbor site across `edges[i]`. */
    neighbors: number[];

    /**
     * Polygon in this cell's local frame, anchored at the canonical site.
     * Periodic cells may extend outside [0, width) x [0, height); draw all
     * wrapped copies instead of clipping the polygon itself.
     */
    polygon: Vec2[];

    /** Polygon area. Zero for an empty (degenerate) cell. */
    area: number;
    /** Polygon centroid in the local frame. */
    centroid: Vec2;
    /** False only when the cell could not be closed. */
    bounded: boolean;
}

export interface NavEdge {
    site: number;
    /** Base travel cost between the two sites. */
    cost: number;
    /** Voronoi edge crossed by this move; -1 when it has no dual edge. */
    portal: number;

    /**
     * Displacement from this site to the *copy* of `site` this edge connects,
     * including the periodic tile offset.
     *
     * A torus Delaunay edge is not always the shortest wrap between the two
     * canonical sites: when the shared Voronoi boundary lies on a seam, the
     * edge leaves the fundamental domain and comes back on the other side.
     * Reconstructing the segment from the canonical sites (shortest wrap)
     * would draw a different geodesic that crosses unrelated edges, so the
     * lift delta has to travel with the edge.
     */
    dx: number;
    dy: number;
}

export interface VoronoiGraph {
    domain: Domain;
    /**
     * Triangulation the graph was dualised from, with the 3x3 torus lift folded
     * into its vertex ids. `sites` is the same array as `mesh.points`.
     */
    mesh: DelaunayMesh;
    sites: Point[];
    cells: VoronoiCell[];
    vertices: VoronoiVertex[];
    edges: VoronoiEdge[];
    /** Delaunay adjacency with movement costs. Symmetric. */
    adjacency: NavEdge[][];
    /** Per-cell movement multiplier used by A* (terrain cost). Values must be >= 1. */
    cellCost: number[];
}

export interface VoronoiStats {
    siteCount: number;
    vertexCount: number;
    edgeCount: number;
    cellCount: number;
    totalArea: number;
}

export interface GraphOptions {
    /** Merge circumcenters closer than this distance. Default: 1e-7 * max(w, h). */
    mergeEpsilon?: number;
    /**
     * Lloyd relaxation steps to improve cell regularity. Default: 0 (no Lloyd).
     * Each step moves every site onto its cell centroid and re-triangulates, so
     * the build runs `lloydIterations + 1` Delaunay passes.
     */
    lloydIterations?: number;
}
