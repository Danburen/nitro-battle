import { activeSupplyCenter, infrastructureLevel, infrastructureSupplyMultiplier, supplySourceRange } from "./economy.ts";
import { SUPPLY_ATTACK_MIN_FACTOR, SUPPLY_ORG_MIN_FACTOR, SUPPLY_RANGE_CENTER } from "./types.ts";
import type { GameState, SupplyMap } from "./types.ts";

// Separate caches prevent short-range sources from suppressing farther, longer-range sources.
export function computeSupply(state: GameState): SupplyMap {
    const count = state.provinces.length;
    const baseLevel = new Float64Array(count);
    const centerBoost = new Float64Array(count);
    const level = new Float32Array(count);
    const distance = new Float32Array(count).fill(2);
    const sources: number[] = [];

    for (const province of state.provinces) {
        if (province.owner < 0 || !state.terrain.passable[province.site]) continue;
        const range = supplySourceRange(state, province);
        if (range <= 0) continue;
        sources.push(province.site);
        const center = activeSupplyCenter(province);
        const costs = new Float64Array(count).fill(Infinity);
        costs[province.site] = 0;
        const open = [{ site: province.site, cost: 0 }];
        while (open.length > 0) {
            let best = 0;
            for (let i = 1; i < open.length; i++) if (open[i].cost < open[best].cost) best = i;
            const current = open.splice(best, 1)[0];
            if (current.cost > costs[current.site]) continue;
            const ratio = current.cost / range;
            baseLevel[current.site] = Math.max(baseLevel[current.site], 1 - ratio);
            distance[current.site] = Math.min(distance[current.site], ratio);
            if (center) {
                centerBoost[current.site] = Math.max(centerBoost[current.site], 1 - current.cost / SUPPLY_RANGE_CENTER);
            }
            for (const edge of state.graph.adjacency[current.site]) {
                const next = edge.site;
                if (!state.terrain.passable[next] || state.provinces[next].owner !== province.owner) continue;
                const cost = current.cost + state.terrain.terrainCost[next];
                if (cost > range || cost >= costs[next]) continue;
                costs[next] = cost;
                open.push({ site: next, cost });
            }
        }
    }
    for (let site = 0; site < count; site++) {
        // Strongest overlap only, including where a city supplies the base.
        const u = centerBoost[site];
        level[site] = (baseLevel[site] + 0.10 * u) * (1 + 0.20 * u) *
            infrastructureSupplyMultiplier(infrastructureLevel(state, site));
    }
    return { level, distance, sources };
}

function ensureSupply(state: GameState): SupplyMap {
    if (!state.supply || state.supplyDirty) {
        state.supply = computeSupply(state);
        state.supplyDirty = false;
    }
    return state.supply;
}

export function supplyLevel(state: GameState, site: number): number {
    return ensureSupply(state).level[site];
}

export function supplyDistance(state: GameState, site: number): number {
    return ensureSupply(state).distance[site];
}

export function supplyAttackFactor(state: GameState, site: number): number {
    const level = Math.max(0, Math.min(1, supplyLevel(state, site)));
    return SUPPLY_ATTACK_MIN_FACTOR + (1 - SUPPLY_ATTACK_MIN_FACTOR) * level;
}

export function supplyOrgFactor(state: GameState, site: number): number {
    const level = Math.max(0, Math.min(1, supplyLevel(state, site)));
    return SUPPLY_ORG_MIN_FACTOR + (1 - SUPPLY_ORG_MIN_FACTOR) * level;
}
