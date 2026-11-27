import { periodicDistance } from "./terrain/voronoi/index.ts";
import { isAtWar } from "./diplomacy.ts";
import { infrastructureLevel, infrastructureMoveMultiplier } from "./economy.ts";
import { NEUTRAL } from "./types/world.ts";
import { REGIMENT_CAP } from "./types/unit.ts";
import type { Army, Regiment } from "./types/organization.ts";
import type { GameState } from "./types/state.ts";
import type { UnitKind } from "./types/unit.ts";

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