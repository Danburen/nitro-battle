import { periodicDistance } from "../../terrain/voronoi/index.ts";
import type { VoronoiGraph } from "../../terrain/voronoi/index.ts";
import type { LCGRandom } from "../../utils/LCGRandom.ts";
import { DEFAULT_POLICIES, NATION_PRESETS, NEUTRAL, START_FUNDS, START_INDUSTRY, START_MANPOWER, START_PP } from "../types.ts";
import type { Nation, Province, StateRegion } from "../types.ts";
import { makeCity } from "./cities.ts";

export function stateAdjacency(graph: VoronoiGraph, provinces: readonly Province[], states: readonly StateRegion[]): number[][] {
    return states.map((region) => {
        const neighbors = new Set<number>();
        for (const site of region.provinces) {
            for (const edge of graph.adjacency[site]) {
                const neighbor = provinces[edge.site].stateId;
                if (neighbor >= 0 && neighbor !== region.id) neighbors.add(neighbor);
            }
        }
        return [...neighbors].sort((a, b) => a - b);
    });
}

function pickCapitalStates(graph: VoronoiGraph, states: readonly StateRegion[], candidates: readonly number[], count: number, rand: LCGRandom): number[] {
    const capitals = [candidates[rand.nextInt(0, candidates.length)]];
    while (capitals.length < count) {
        let best = -1;
        let bestDistance = -1;
        for (const id of candidates) {
            if (capitals.includes(id)) continue;
            const distance = Math.min(...capitals.map((capital) =>
                periodicDistance(graph.sites[states[id].center], graph.sites[states[capital].center], graph.domain)));
            if (distance > bestDistance) {
                best = id;
                bestDistance = distance;
            }
        }
        capitals.push(best);
    }
    return capitals;
}

export function assignStateTerritories(states: readonly StateRegion[], adjacency: readonly number[][], capitals: readonly number[]): Int32Array {
    const owner = new Int32Array(states.length).fill(NEUTRAL);
    const mainland = new Set<number>([capitals[0]]);
    const pending = [capitals[0]];
    while (pending.length > 0) {
        for (const neighbor of adjacency[pending.pop()!]) {
            if (mainland.has(neighbor)) continue;
            mainland.add(neighbor);
            pending.push(neighbor);
        }
    }
    const growthTarget = [...mainland].reduce((sum, id) => sum + states[id].provinces.length, 0) / capitals.length;
    const target = states.reduce((sum, region) => sum + region.provinces.length, 0) / capitals.length;
    const counts = capitals.map((id, nation) => {
        owner[id] = nation;
        return states[id].provinces.length;
    });
    const distances = capitals.map((capital) => {
        const distance = new Float64Array(states.length).fill(Infinity);
        distance[capital] = 0;
        const open = [capital];
        while (open.length > 0) {
            open.sort((a, b) => distance[b] - distance[a]);
            const current = open.pop()!;
            for (const neighbor of adjacency[current]) {
                const cost = distance[current] + states[neighbor].provinces.length;
                if (cost >= distance[neighbor]) continue;
                distance[neighbor] = cost;
                if (!open.includes(neighbor)) open.push(neighbor);
            }
        }
        return distance;
    });

    for (;;) {
        let claimed = false;
        const nations = capitals.map((_, nation) => nation).sort((a, b) => counts[a] - counts[b] || a - b);
        for (const nation of nations) {
            let best = -1;
            for (const id of mainland) {
                if (owner[id] !== NEUTRAL || !adjacency[id].some((neighbor) => owner[neighbor] === nation)) continue;
                if (Math.abs(counts[nation] + states[id].provinces.length - growthTarget) >= Math.abs(counts[nation] - growthTarget)) continue;
                if (best < 0 || distances[nation][id] < distances[nation][best]) best = id;
            }
            if (best < 0) continue;
            owner[best] = nation;
            counts[nation] += states[best].provinces.length;
            claimed = true;
            break;
        }
        if (!claimed) break;
    }

    // Mode A owns every state: absorb balanced-growth leftovers into the smallest touching nation.
    for (;;) {
        let claimed = false;
        const nations = capitals.map((_, nation) => nation).sort((a, b) => counts[a] - counts[b] || a - b);
        for (const nation of nations) {
            let best = -1;
            for (const id of mainland) {
                if (owner[id] !== NEUTRAL || !adjacency[id].some((neighbor) => owner[neighbor] === nation)) continue;
                if (best < 0 || distances[nation][id] < distances[nation][best]) best = id;
            }
            if (best < 0) continue;
            owner[best] = nation;
            counts[nation] += states[best].provinces.length;
            claimed = true;
            break;
        }
        if (!claimed) break;
    }

    // Overseas components go whole to the nearest coast, balance breaking ties.
    const hops = capitals.map((_, nation) => {
        const distance = new Int32Array(states.length).fill(-1);
        const open: number[] = [];
        for (const id of mainland) if (owner[id] === nation) { distance[id] = 0; open.push(id); }
        for (let head = 0; head < open.length; head++) {
            for (const neighbor of adjacency[open[head]]) {
                if (distance[neighbor] >= 0) continue;
                distance[neighbor] = distance[open[head]] + 1;
                open.push(neighbor);
            }
        }
        return distance;
    });
    const seen = new Set<number>(mainland);
    for (const start of states.keys()) {
        if (seen.has(start)) continue;
        const component = [start];
        seen.add(start);
        for (let head = 0; head < component.length; head++) {
            for (const neighbor of adjacency[component[head]]) {
                if (seen.has(neighbor)) continue;
                seen.add(neighbor);
                component.push(neighbor);
            }
        }
        const size = component.reduce((sum, id) => sum + states[id].provinces.length, 0);
        let bestNation = 0;
        let bestScore = Infinity;
        for (const nation of capitals.keys()) {
            const coast = Math.min(...component.map((id) => hops[nation][id]));
            // Balance first; nearer coast breaks ties between equally good recipients.
            const score = Math.abs(counts[nation] + size - target) * 10 + (Number.isFinite(coast) ? coast : 1000);
            if (score < bestScore) { bestScore = score; bestNation = nation; }
        }
        for (const id of component) {
            owner[id] = bestNation;
            counts[bestNation] += states[id].provinces.length;
        }
    }

    const canRelease = (id: number): boolean => {
        const nation = owner[id];
        if (nation === NEUTRAL) return true;
        const visited = new Set<number>([capitals[nation]]);
        const open = [capitals[nation]];
        let remaining = 0;
        while (open.length > 0) {
            const current = open.pop()!;
            remaining += states[current].provinces.length;
            for (const neighbor of adjacency[current]) {
                if (neighbor === id || owner[neighbor] !== nation || visited.has(neighbor)) continue;
                visited.add(neighbor);
                open.push(neighbor);
            }
        }
        return remaining === counts[nation] - states[id].provinces.length;
    };
    const errorChange = (nation: number, change: number): number => nation === NEUTRAL ? 0
        : (counts[nation] - target) ** 2 - (counts[nation] + change - target) ** 2;

    // Border transfers may improve balance only if the donor remains connected to its capital.
    for (;;) {
        let best: { id: number; nation: number; gain: number } | null = null;
        for (const id of mainland) {
            if (capitals.includes(id)) continue;
            const from = owner[id];
            const size = states[id].provinces.length;
            const recipients = new Set(adjacency[id].map((neighbor) => owner[neighbor]));
            recipients.delete(from);
            for (const nation of recipients) {
                const gain = errorChange(from, -size) + errorChange(nation, size);
                if (gain <= (best?.gain ?? 1e-8) || !canRelease(id)) continue;
                best = { id, nation, gain };
            }
        }
        if (!best) break;
        const from = owner[best.id];
        const size = states[best.id].provinces.length;
        if (from !== NEUTRAL) counts[from] -= size;
        if (best.nation !== NEUTRAL) counts[best.nation] += size;
        owner[best.id] = best.nation;
    }
    return owner;
}

export function generateNations(graph: VoronoiGraph, provinces: Province[], states: readonly StateRegion[], mainland: readonly number[], nationCount: number, rand: LCGRandom): Nation[] {
    const candidates = [...new Set(mainland.map((site) => provinces[site].stateId))];
    const capitals = pickCapitalStates(graph, states, candidates, Math.min(nationCount, candidates.length, NATION_PRESETS.length), rand);
    const owners = assignStateTerritories(states, stateAdjacency(graph, provinces, states), capitals);
    for (const region of states) {
        for (const site of region.provinces) provinces[site].owner = owners[region.id];
    }
    return capitals.map((id, nation) => {
        const capital = states[id].center;
        makeCity(provinces[capital], true);
        return {
            id: nation,
            name: NATION_PRESETS[nation].name,
            color: NATION_PRESETS[nation].color,
            isPlayer: nation === 0,
            capital,
            funds: START_FUNDS,
            manpower: START_MANPOWER,
            industry: START_INDUSTRY,
            politicalPower: START_PP,
            policies: { ...DEFAULT_POLICIES },
            alive: true,
        };
    });
}
