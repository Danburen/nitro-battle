import { periodicDistance } from "./terrain/voronoi/index.ts";
import { hasMilitaryAccess } from "./access.ts";
import { isAtWar } from "./diplomacy.ts";
import { infrastructureLevel, infrastructureMoveMultiplier } from "./economy.ts";
import { NEUTRAL } from "./types/world.ts";
import { REGIMENT_CAP, UNIT_PROFILES } from "./types/unit.ts";
import type { Army, Regiment } from "./types/organization.ts";
import type { GameState } from "./types/state.ts";
import type { UnitKind } from "./types/unit.ts";

export interface ReachResult {
    /** province -> accumulated movement cost */
    cost: Map<number, number>;
    /** province -> previous province on the cheapest route */
    parent: Map<number, number>;
}

export function armyAt(state: GameState, site: number): Army | null {
    const id = state.armyAt[site];
    return id === null ? null : state.armies.get(id) ?? null;
}

export function regimentHp(army: Army): number {
    let total = 0;
    for (const regiment of army.regiments) total += Math.max(0, regiment.hp);
    return total;
}

export function regimentCountByKind(army: Army): Map<UnitKind, number> {
    const counts = new Map<UnitKind, number>();
    for (const regiment of army.regiments) {
        counts.set(regiment.kind, (counts.get(regiment.kind) ?? 0) + 1);
    }
    return counts;
}

/** An army marches at the speed of its slowest regiment. */
export function armyMp(army: Army): number {
    let mp = Infinity;
    for (const regiment of army.regiments) {
        mp = Math.min(mp, UNIT_PROFILES[regiment.kind].mp);
    }
    return Number.isFinite(mp) ? mp : 0;
}

export function orgFactor(org: number): number {
    return 0.4 + 0.6 * Math.max(0, Math.min(1, org / 100));
}

/** Cost to enter a province: terrain difficulty scaled by snow slowdown. */
export function entryCost(state: GameState, site: number): number {
    const weather = state.terrain.getWeatherDebuff(site);
    return state.terrain.terrainCost[site] / weather.moveSpeed * infrastructureMoveMultiplier(infrastructureLevel(state, site));
}

export function isHostileProvince(state: GameState, nationId: number, site: number): boolean {
    const owner = state.provinces[site].owner;
    if (owner === nationId || owner === NEUTRAL) return false;
    return isAtWar(state, nationId, owner);
}

/**
 * One Dijkstra flood per army per day. Movement stays inside friendly
 * territory free of other armies; hostile provinces are entered by battle.
 */
export function reachable(state: GameState, army: Army): ReachResult {
    const result: ReachResult = { cost: new Map(), parent: new Map() };
    if (army.moved || army.acted || army.regiments.length === 0) return result;

    const budget = armyMp(army);
    const start = army.province;
    result.cost.set(start, 0);
    const open: { site: number; cost: number }[] = [{ site: start, cost: 0 }];

    while (open.length > 0) {
        let bestIndex = 0;
        for (let i = 1; i < open.length; i++) {
            if (open[i].cost < open[bestIndex].cost) bestIndex = i;
        }
        const current = open.splice(bestIndex, 1)[0];
        if (current.cost > (result.cost.get(current.site) ?? Infinity)) continue;

        for (const edge of state.graph.adjacency[current.site]) {
            const next = edge.site;
            if (!state.terrain.passable[next]) continue;
            const owner = state.provinces[next].owner;
            if (owner !== army.nation && !hasMilitaryAccess(state, army.nation, owner)) continue;
            const occupant = armyAt(state, next);
            if (occupant && occupant.id !== army.id) {
                // Own armies may merge when there is room; enemies block.
                if (occupant.nation !== army.nation) continue;
                if (occupant.regiments.length + army.regiments.length > REGIMENT_CAP) continue;
            }

            const nextCost = current.cost + entryCost(state, next);
            if (nextCost > budget + 1e-9) continue;
            if (nextCost >= (result.cost.get(next) ?? Infinity)) continue;

            result.cost.set(next, nextCost);
            result.parent.set(next, current.site);
            open.push({ site: next, cost: nextCost });
        }
    }

    result.cost.delete(start);
    return result;
}

export function pathTo(reach: ReachResult, target: number): number[] {
    const path: number[] = [target];
    let current = target;
    while (reach.parent.has(current)) {
        current = reach.parent.get(current) as number;
        path.push(current);
    }
    return path.reverse();
}

/**
 * Full-route Dijkstra over own passable provinces for multi-day marches.
 * Returns the path excluding the start, or null when unreachable.
 */
export function marchPath(state: GameState, army: Army, target: number): number[] | null {
    if (target === army.province) return null;
    const passableOwn = (site: number): boolean => {
        const owner = state.provinces[site].owner;
        return state.terrain.passable[site] === 1 &&
            (owner === army.nation || hasMilitaryAccess(state, army.nation, owner) || site === target);
    };

    const cost = new Map<number, number>([[army.province, 0]]);
    const parent = new Map<number, number>();
    const open: { site: number; cost: number }[] = [{ site: army.province, cost: 0 }];

    while (open.length > 0) {
        let bestIndex = 0;
        for (let i = 1; i < open.length; i++) {
            if (open[i].cost < open[bestIndex].cost) bestIndex = i;
        }
        const current = open.splice(bestIndex, 1)[0];
        if (current.site === target) {
            const path: number[] = [];
            let node = target;
            while (node !== army.province) {
                path.push(node);
                node = parent.get(node) as number;
            }
            return path.reverse();
        }
        if (current.cost > (cost.get(current.site) ?? Infinity)) continue;

        for (const edge of state.graph.adjacency[current.site]) {
            const next = edge.site;
            if (!passableOwn(next)) continue;
            if (next !== target) {
                const occupant = armyAt(state, next);
                if (occupant && occupant.nation !== army.nation) continue;
            }
            const nextCost = current.cost + entryCost(state, next);
            if (nextCost >= (cost.get(next) ?? Infinity)) continue;
            cost.set(next, nextCost);
            parent.set(next, current.site);
            open.push({ site: next, cost: nextCost });
        }
    }
    return null;
}

/** Adjacent hostile provinces this army may attack. */
export function attackTargets(state: GameState, army: Army): number[] {
    if (army.acted || army.regiments.length === 0) return [];
    const targets: number[] = [];
    for (const edge of state.graph.adjacency[army.province]) {
        if (!state.terrain.passable[edge.site]) continue;
        if (!isHostileProvince(state, army.nation, edge.site)) continue;
        targets.push(edge.site);
    }
    return targets;
}

/** Own provinces a strategic redeployment may target. */
export function redeployTargets(state: GameState, army: Army): Set<number> {
    const targets = new Set<number>();
    if (army.moved || army.acted) return targets;
    for (const province of state.provinces) {
        if (province.site === army.province) continue;
        if (province.owner !== army.nation) continue;
        if (!state.terrain.passable[province.site]) continue;
        if (armyAt(state, province.site)) continue;
        targets.add(province.site);
    }
    return targets;
}

/** Army count limit, bounded by the tax base. */
export function armyCap(state: GameState, nationId: number): number {
    return 3 + Math.floor(nationProvinceCount(state, nationId) / 6);
}

export function nationArmyCount(state: GameState, nationId: number): number {
    let count = 0;
    for (const army of state.armies.values()) {
        if (army.nation === nationId) count++;
    }
    return count;
}

export function nationDeploymentCount(state: GameState, nationId: number): number {
    let count = 0;
    for (const order of state.deployments) {
        if (order.nation === nationId) count++;
    }
    return count;
}

export function nationProvinceCount(state: GameState, nationId: number): number {
    let count = 0;
    for (const province of state.provinces) {
        if (province.owner === nationId) count++;
    }
    return count;
}

export function nationRegimentCount(state: GameState, nationId: number): number {
    let count = 0;
    for (const army of state.armies.values()) {
        if (army.nation === nationId) count += army.regiments.length;
    }
    return count;
}

/** A province a trained regiment may appear in: owned, passable, no enemy army. */
export function isValidDeploySite(state: GameState, nationId: number, site: number): boolean {
    const province = state.provinces[site];
    if (!province || province.owner !== nationId) return false;
    if (!state.terrain.passable[site]) return false;
    const occupant = armyAt(state, site);
    if (occupant && occupant.nation !== nationId) return false;
    return true;
}

/**
 * Preferred site -> capital -> nearest owned city -> any owned province.
 * A site with an own army is preferred when it still has regiment room.
 */
export function resolveDeploySite(
    state: GameState,
    nationId: number,
    preferred: number | null,
): number | null {
    const valid = (site: number): boolean => isValidDeploySite(state, nationId, site);
    const hasRoom = (site: number): boolean => {
        const occupant = armyAt(state, site);
        return !occupant || occupant.regiments.length < REGIMENT_CAP;
    };

    if (preferred !== null && valid(preferred) && hasRoom(preferred)) return preferred;

    const nation = state.nations[nationId];
    if (nation && valid(nation.capital) && hasRoom(nation.capital)) return nation.capital;

    let bestCity: number | null = null;
    let bestDistance = Infinity;
    for (const province of state.provinces) {
        if (!province.isCity || !valid(province.site) || !hasRoom(province.site)) continue;
        const distance = periodicDistance(
            state.graph.sites[province.site],
            state.graph.sites[nation.capital],
            state.graph.domain,
        );
        if (distance < bestDistance) {
            bestDistance = distance;
            bestCity = province.site;
        }
    }
    if (bestCity !== null) return bestCity;

    for (const province of state.provinces) {
        if (valid(province.site) && hasRoom(province.site)) return province.site;
    }
    return null;
}

export function makeRegiment(state: GameState, kind: UnitKind, hp: number): Regiment {
    return { id: state.nextRegimentId++, kind, hp };
}