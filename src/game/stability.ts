/** National stability: drift toward a war/occupation/food target, and its economic effects. */
import { conscriptionProfile } from "./policy.ts";
import {
    ARMY_UNITS_PER_POP, OCCUPIED_POP_FACTOR, POPULATION_PER_POINT,
    STABILITY_ADMIN_BONUS, STABILITY_ADMIN_CAP, STABILITY_BASE, STABILITY_FOOD_SHORTAGE,
    STABILITY_FOOD_SURPLUS, STABILITY_OCCUPIED_CAP, STABILITY_OCCUPIED_PENALTY,
    STABILITY_POLITICS_BASE, STABILITY_POLITICS_RANGE, STABILITY_PRODUCTION_BASE,
    STABILITY_PRODUCTION_RANGE, STABILITY_WAR_PENALTY, START_STABILITY,
} from "./types/economy.ts";
import type { GameState } from "./types/state.ts";
import type { Nation, Province } from "./types/entities.ts";

export type FoodStance = -1 | 0 | 1;

export interface StabilityInputs {
    /** Active admin centres (core or occupation ≥ 50%). */
    readonly admin: number;
    readonly wars: number;
    /** Stability target penalty carried by the conscription policy. */
    readonly conscription: number;
    readonly occupiedProvinces: number;
    readonly food: FoodStance;
}

export interface StabilitySnapshot extends StabilityInputs {
    readonly value: number;
    readonly target: number;
}

/** Fixtures without a stability field read the default but keep neutral effects. */
export function stabilityOf(nation: Nation | undefined): number {
    return nation?.stability ?? START_STABILITY;
}

export function shiftStability(nation: Nation, delta: number): void {
    if (nation.stability === undefined || !Number.isFinite(delta)) return;
    nation.stability = Math.max(0, Math.min(100, nation.stability + delta));
}

export function warCount(state: GameState, nationId: number): number {
    const row = state.war[nationId];
    if (!row) return 0;
    let count = 0;
    for (const target of state.nations) {
        if (target.id === nationId || !target.alive) continue;
        if (row[target.id] === true) count++;
    }
    return count;
}

export function targetStability(inputs: StabilityInputs): number {
    const admin = Math.min(STABILITY_ADMIN_CAP, STABILITY_ADMIN_BONUS * inputs.admin);
    const occupied = Math.min(STABILITY_OCCUPIED_CAP, STABILITY_OCCUPIED_PENALTY * inputs.occupiedProvinces);
    const food = inputs.food < 0 ? -STABILITY_FOOD_SHORTAGE : inputs.food > 0 ? STABILITY_FOOD_SURPLUS : 0;
    return Math.max(0, Math.min(100,
        STABILITY_BASE + admin - STABILITY_WAR_PENALTY * inputs.wars + inputs.conscription - occupied + food));
}

/** Production multiplier for funds/industry/raw/strategic/food. */
export function stabilityProduction(nation: Nation | undefined): number {
    if (nation?.stability === undefined) return 1;
    return STABILITY_PRODUCTION_BASE + STABILITY_PRODUCTION_RANGE * nation.stability / 100;
}

/** Political-point income multiplier. */
export function stabilityPolitics(nation: Nation | undefined): number {
    if (nation?.stability === undefined) return 1;
    return STABILITY_POLITICS_BASE + STABILITY_POLITICS_RANGE * nation.stability / 100;
}

/** Manpower intake multiplier (the eligible ceiling itself is stability-independent). */
export function stabilityManpower(nation: Nation | undefined): number {
    return nation?.stability === undefined ? 1 : nation.stability / 100;
}

/** Identity-weighted population points that can ever be recruited. */
export function populationIdentity(province: Province, nationId: number): number {
    if (province.coreNation === nationId) return 1;
    return OCCUPIED_POP_FACTOR * province.occupation / 100;
}

/** Province hover/detail: raw people plus the army units its population supports. */
export function provincePopulationView(state: GameState, province: Province): { people: number; units: number } {
    const nation = state.nations[province.owner];
    const share = nation ? conscriptionProfile(nation, state.day).share : 0;
    const identity = populationIdentity(province, province.owner);
    return {
        people: province.population * POPULATION_PER_POINT,
        units: Math.max(0, Math.floor(province.population * identity * share * ARMY_UNITS_PER_POP)),
    };
}