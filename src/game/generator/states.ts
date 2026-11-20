import { periodicDistance } from "../../terrain/voronoi/index.ts";
import type { VoronoiGraph } from "../../terrain/voronoi/index.ts";
import type { BiomeMap } from "../../terrain/biome.ts";
import { periodicNoise2D } from "../../terrain/noise.ts";
import type { LCGRandom } from "../../utils/LCGRandom.ts";
import type { GameSettings, Province, StateRegion } from "../types.ts";
import { makeCity } from "./cities.ts";
import { terrainClassOf } from "./names.ts";
import type { NameGenerator } from "./names.ts";

function cultureAt(graph: VoronoiGraph, site: number, seed: number): number {
    const scale = 260;
    const periodX = Math.max(1, Math.round(graph.domain.width / scale));
    const periodY = Math.max(1, Math.round(graph.domain.height / scale));
    const point = graph.sites[site];
    const a = periodicNoise2D(point.x / scale, point.y / scale, periodX, periodY, seed);
    const b = periodicNoise2D(point.x / scale + 37.2, point.y / scale + 11.7, periodX, periodY, seed ^ 0x5bd1);
    return (a > 0 ? 0 : 1) + (b > 0 ? 0 : 2);
}

function pickStateCenters(
    graph: VoronoiGraph,
    sites: readonly number[],
    value: readonly number[],
    count: number,
    rand: LCGRandom,
): number[] {
    let best = sites[0];
    for (const site of sites) if (value[site] > value[best]) best = site;
    const centers = [best];

    while (centers.length < count) {
        let pick = -1;
        let pickScore = -1;
        for (const site of sites) {
            if (centers.includes(site)) continue;
            let minDist = Infinity;
            for (const center of centers) {
                const distance = periodicDistance(graph.sites[site], graph.sites[center], graph.domain);
                if (distance < minDist) minDist = distance;
            }
            const score = minDist * (1 + value[site] * 0.12) * (0.9 + rand.nextFloat() * 0.2);
            if (score > pickScore) {
                pickScore = score;
                pick = site;
            }
        }
        if (pick < 0) break;
        centers.push(pick);
    }
    return centers;
}

function growStates(
    graph: VoronoiGraph,
    terrain: BiomeMap,
    centers: readonly number[],
    rand: LCGRandom,
): Int32Array {
    const owner = new Int32Array(graph.sites.length).fill(-1);
    interface Frontier { site: number; cost: number }
    const frontiers: Frontier[][] = centers.map(() => []);

    centers.forEach((center, region) => {
        owner[center] = region;
        for (const edge of graph.adjacency[center]) {
            if (terrain.passable[edge.site]) {
                frontiers[region].push({
                    site: edge.site,
                    cost: terrain.terrainCost[edge.site] * (0.8 + rand.nextFloat() * 0.4),
                });
            }
        }
    });

    let progress = true;
    while (progress) {
        progress = false;
        for (let region = 0; region < centers.length; region++) {
            const frontier = frontiers[region];
            while (frontier.length > 0) {
                let bestIndex = 0;
                for (let i = 1; i < frontier.length; i++) {
                    if (frontier[i].cost < frontier[bestIndex].cost) bestIndex = i;
                }
                const entry = frontier.splice(bestIndex, 1)[0];
                if (owner[entry.site] !== -1) continue;
                owner[entry.site] = region;
                progress = true;
                for (const edge of graph.adjacency[entry.site]) {
                    if (terrain.passable[edge.site] && owner[edge.site] === -1) {
                        frontier.push({
                            site: edge.site,
                            cost: entry.cost + terrain.terrainCost[edge.site] * (0.8 + rand.nextFloat() * 0.4),
                        });
                    }
                }
                break;
            }
        }
    }
    return owner;
}

export function generateStates(
    graph: VoronoiGraph,
    terrain: BiomeMap,
    provinces: Province[],
    components: readonly number[][],
    rand: LCGRandom,
    names: NameGenerator,
    settings: GameSettings,
): StateRegion[] {
    const { seed, nationCount } = settings;
    const value = graph.sites.map((_, site) => rand.nextInt(1, 7) + (provinces[site].isCity ? 4 : 0));
    let mainComponent = 0;
    for (let i = 1; i < components.length; i++) {
        if (components[i].length > components[mainComponent].length) mainComponent = i;
    }

    const states: StateRegion[] = [];
    for (const [component, sites] of components.entries()) {
        if (sites.length === 0) continue;
        const count = Math.min(sites.length, Math.max(
            1,
            Math.round(sites.length / 10),
            component === mainComponent ? nationCount : 0,
        ));
        const centers = pickStateCenters(graph, sites, value, count, rand);
        for (const center of centers) makeCity(provinces[center], false);
        const local = growStates(graph, terrain, centers, rand);
        for (let region = 0; region < centers.length; region++) {
            const center = centers[region];
            const members = sites.filter((site) => local[site] === region);
            const culture = cultureAt(graph, center, seed);
            const id = states.length;
            states.push({
                id,
                name: names.regionName(culture, terrainClassOf(terrain.biomeAt(center))),
                center,
                provinces: members,
                culture,
                buildings: [],
                factories: 0,
                prodFactories: 0,
                infrastructure: 1,
            });
            for (const site of members) provinces[site].stateId = id;
        }
    }

    for (let site = 0; site < provinces.length; site++) {
        const province = provinces[site];
        const culture = province.stateId >= 0
            ? states[province.stateId].culture
            : cultureAt(graph, site, seed);
        province.name = names.provinceName(culture, terrainClassOf(terrain.biomeAt(site)));
    }

    return states;
}
