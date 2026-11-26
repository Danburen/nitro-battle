import { periodicDistance } from "./voronoi/geometry.ts";
import type { Vec2, VoronoiGraph } from "./voronoi/types.ts";

export interface PathOptions {
    /**
     * Per-site movement multiplier. Defaults to `graph.cellCost`.
     * Keep values >= 1 so the straight-line heuristic stays admissible.
     *
     * `ArrayLike` so `Float32Array` terrain costs can be passed directly.
     */
    cellCost?: ArrayLike<number>;
    /**
     * Per-site walkability. When omitted every site is walkable. Blocked sites
     * are never expanded; the start site may itself be blocked (a unit standing
     * on a blocked cell can still leave it).
     */
    passable?: ArrayLike<boolean | number>;
}

/** A portal crossed when moving from one cell to the next. */
export interface PathPortal {
    from: number;
    to: number;
    /** Voronoi edge id; -1 for an unbounded hull edge. */
    edge: number;
    /** Portal endpoints in the local frame of the `from` cell. */
    a: Vec2;
    b: Vec2;
}

class MinHeap {
    private readonly ids: number[] = [];
    private readonly priorities: number[] = [];

    get size(): number {
        return this.ids.length;
    }

    push(id: number, priority: number): void {
        this.ids.push(id);
        this.priorities.push(priority);

        let i = this.ids.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.priorities[parent] <= this.priorities[i]) break;
            this.swap(parent, i);
            i = parent;
        }
    }

    pop(): number {
        const top = this.ids[0];
        const lastId = this.ids.pop() as number;
        const lastPriority = this.priorities.pop() as number;

        if (this.ids.length > 0) {
            this.ids[0] = lastId;
            this.priorities[0] = lastPriority;

            let i = 0;
            for (;;) {
                const left = i * 2 + 1;
                const right = left + 1;
                let smallest = i;

                if (left < this.ids.length && this.priorities[left] < this.priorities[smallest]) {
                    smallest = left;
                }
                if (right < this.ids.length && this.priorities[right] < this.priorities[smallest]) {
                    smallest = right;
                }
                if (smallest === i) break;

                this.swap(i, smallest);
                i = smallest;
            }
        }

        return top;
    }

    private swap(a: number, b: number): void {
        const id = this.ids[a];
        this.ids[a] = this.ids[b];
        this.ids[b] = id;

        const priority = this.priorities[a];
        this.priorities[a] = this.priorities[b];
        this.priorities[b] = priority;
    }
}

/**
 * A* over the Voronoi cell graph. Returns the site/cell sequence, or an empty
 * array when the goal is unreachable.
 */
export function findCellPath(
    graph: VoronoiGraph,
    start: number,
    goal: number,
    options: PathOptions = {},
): number[] {
    const siteCount = graph.sites.length;
    if (start < 0 || goal < 0 || start >= siteCount || goal >= siteCount) return [];
    if (start === goal) return [start];

    const cellCost = options.cellCost ?? graph.cellCost;
    const passable = options.passable;
    const gScore = new Float64Array(siteCount).fill(Infinity);
    const cameFrom = new Int32Array(siteCount).fill(-1);
    const closed = new Uint8Array(siteCount);

    const heuristic = (site: number): number =>
        periodicDistance(graph.sites[site], graph.sites[goal], graph.domain);

    const heap = new MinHeap();
    gScore[start] = 0;
    heap.push(start, heuristic(start));

    while (heap.size > 0) {
        const current = heap.pop();
        if (closed[current]) continue;
        if (current === goal) return reconstructPath(cameFrom, current);

        closed[current] = 1;

        for (const edge of graph.adjacency[current]) {
            const neighbor = edge.site;
            if (passable && !passable[neighbor]) continue;

            const weight = edge.cost * (cellCost[current] + cellCost[neighbor]) * 0.5;
            const tentative = gScore[current] + weight;

            if (tentative >= gScore[neighbor]) continue;

            gScore[neighbor] = tentative;
            cameFrom[neighbor] = current;
            heap.push(neighbor, tentative + heuristic(neighbor));
        }
    }

    return [];
}

function reconstructPath(cameFrom: Int32Array, goal: number): number[] {
    const path: number[] = [];
    let current = goal;

    while (current >= 0) {
        path.push(current);
        current = cameFrom[current];
    }

    path.reverse();
    return path;
}

/**
 * Convert a cell path into the portals crossed by the path.
 *
 * Portal endpoints live in the local frame of the cell being left. Adjacent
 * cells may use different tile frames, so a smoothing pass should align them
 * before running funnel/string-pulling.
 */
export function cellPathToPortals(
    graph: VoronoiGraph,
    path: readonly number[],
): PathPortal[] {
    const portals: PathPortal[] = [];

    for (let i = 0; i + 1 < path.length; i++) {
        const from = path[i];
        const to = path[i + 1];
        const cell = graph.cells[from];
        const index = cell.neighbors.indexOf(to);

        if (index >= 0 && index < cell.edges.length) {
            const next = index + 1 < cell.polygon.length ? index + 1 : 0;
            portals.push({
                from,
                to,
                edge: cell.edges[index],
                a: cell.polygon[index],
                b: cell.polygon[next],
            });
            continue;
        }

        // Unbounded hull crossing: there is no finite portal.
        const nav = graph.adjacency[from].find((edge) => edge.site === to);
        portals.push({
            from,
            to,
            edge: nav ? nav.portal : -1,
            a: cell.centroid,
            b: cell.centroid,
        });
    }

    return portals;
}
