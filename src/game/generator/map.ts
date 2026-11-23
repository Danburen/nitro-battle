import { buildVoronoiGraph } from "../../terrain/voronoi/index.ts";
import type { Point, VoronoiGraph } from "../../terrain/voronoi/index.ts";
import { TerrainGenerator } from "../../terrain/biome.ts";
import type { BiomeMap } from "../../terrain/biome.ts";
import { LCGRandom } from "../../utils/LCGRandom.ts";
import { SEASONS } from "../types/world.ts";
import { MAP_SIZES } from "../../types/settings.ts";
import type { GameSettings } from "../../types/settings.ts";

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
    const profile = MAP_SIZES[settings.mapSize];
    const cells = Math.max(200, Math.round(settings.mapCells ?? profile.cells));
    // Keep the profile's density and aspect ratio when the dialog asks for a custom cell count.
    const scale = Math.sqrt(cells / profile.cells);
    const width = Math.max(320, Math.round(profile.width * scale));
    const height = Math.max(240, Math.round(profile.height * scale));
    const graph = buildVoronoiGraph(
        createRandomPoints(cells, width, height, settings.seed),
        width,
        height,
        { lloydIterations: 2 },
    );
    const terrain = new TerrainGenerator(settings.seed, graph.domain, settings.terrain ?? {}).build(graph);
    terrain.updateWeather(SEASONS[0].value);
    terrain.applyToGraph(graph);

    return { graph, terrain, components: landComponents(graph, terrain) };
}
