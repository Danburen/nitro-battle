import { buildVoronoiGraph } from "../../terrain/voronoi/index.ts";
import type { Point, VoronoiGraph } from "../../terrain/voronoi/index.ts";
import { TerrainGenerator } from "../../terrain/biome.ts";
import type { BiomeMap } from "../../terrain/biome.ts";
import { LCGRandom } from "../../utils/LCGRandom.ts";
import { MAP_SIZES, SEASONS } from "../types.ts";
import type { GameSettings } from "../types.ts";

function createRandomPoints(count: number, width: number, height: number, seed: number): Point[] {
    const rand = new LCGRandom(seed);
    return Array.from({ length: count }, (_, id) => ({
        x: rand.nextFloat() * width,
        y: rand.nextFloat() * height,
        id,
    }));
}

function landComponents(graph: VoronoiGraph, terrain: BiomeMap): number[][] {
    const visited = new Uint8Array(graph.sites.length);
    const components: number[][] = [];

    for (let start = 0; start < graph.sites.length; start++) {
        if (!terrain.passable[start] || visited[start]) continue;
        const sites: number[] = [];
        const queue = [start];
        visited[start] = 1;

        while (queue.length > 0) {
            const site = queue.pop() as number;
            sites.push(site);
            for (const edge of graph.adjacency[site]) {
                if (terrain.passable[edge.site] && !visited[edge.site]) {
                    visited[edge.site] = 1;
                    queue.push(edge.site);
                }
            }
        }
        components.push(sites.sort((a, b) => a - b));
    }

    return components;
}

export function generateMap(settings: GameSettings): {
    graph: VoronoiGraph;
    terrain: BiomeMap;
    components: number[][];
} {
    const size = MAP_SIZES[settings.mapSize];
    const graph = buildVoronoiGraph(
        createRandomPoints(size.cells, size.width, size.height, settings.seed),
        size.width,
        size.height,
        { lloydIterations: 2 },
    );
    const terrain = new TerrainGenerator(settings.seed, graph.domain).build(graph);
    terrain.updateWeather(SEASONS[0].value);
    terrain.applyToGraph(graph);

    return { graph, terrain, components: landComponents(graph, terrain) };
}
