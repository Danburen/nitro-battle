import { INFRASTRUCTURE_MAX } from "../types.ts";
import type { GameState, StateRegion } from "../types.ts";

/**
 * Optional starting compensation (`GameSettings.balanceNations`).
 *
 * Territory assignment deliberately produces great powers and city-states, so a
 * small nation starts with fewer states, fewer factories and the same single
 * farm per state. When enabled, every nation below the average size — weighted
 * by industrial density — receives extra farms and infrastructure levels. The
 * smaller and less industrialised a nation is, the larger the compensation; the
 * biggest, most industrialised nations receive nothing.
 *
 * The function is deterministic: it only reads the generated world, so the same
 * seed always produces the same compensation.
 */

export interface NationCompensation {
    readonly nationId: number;
    /** Owned provinces, used for the size gap. */
    readonly provinces: number;
    /** Factories in controlled states, used for the industry gap. */
    readonly factories: number;
    readonly bonusFarms: number;
    readonly bonusInfrastructure: number;
}

const MAX_BONUS_FARMS = 3;
const MAX_BONUS_INFRASTRUCTURE = 3;
/**
 * The size gap is the envelope and the industry gap only decides how much of
 * that envelope is used, so a great power never gets compensated for having
 * "too few factories per province" (its states are simply larger).
 */
const SIZE_WEIGHT = 0.7;
const INDUSTRY_WEIGHT = 0.3;

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/** Spread farms and infrastructure levels over the largest states first, cycling when needed. */
function applyCompensation(regions: readonly StateRegion[], farms: number, infrastructure: number): void {
    const targets = [...regions].sort((a, b) => b.provinces.length - a.provinces.length || a.id - b.id);
    if (targets.length === 0) return;
    for (let i = 0; i < farms; i++) targets[i % targets.length].buildings.push("farm");
    for (let i = 0; i < infrastructure; i++) {
        const region = targets[i % targets.length];
        region.infrastructure = Math.min(INFRASTRUCTURE_MAX, region.infrastructure + 1);
    }
}

export function compensateStartingNations(state: GameState): NationCompensation[] {
    const { nations, provinces, states } = state;
    if (nations.length < 2) return [];

    const regions = nations.map((nation) => states.filter(
        (region) => provinces[region.center].owner === nation.id,
    ));
    const owned = nations.map((nation) =>
        provinces.reduce((sum, province) => sum + (province.owner === nation.id ? 1 : 0), 0));
    const factories = regions.map((list) => list.reduce((sum, region) => sum + region.factories, 0));

    const average = owned.reduce((sum, value) => sum + value, 0) / nations.length;
    const densities = factories.map((count, index) => count / Math.max(1, owned[index]));
    const maxDensity = Math.max(0, ...densities);

    return nations.map((nation, index) => {
        const sizeGap = average > 0 ? clamp01(1 - owned[index] / average) : 0;
        const industryGap = maxDensity > 0 ? clamp01(1 - densities[index] / maxDensity) : 0;
        const need = clamp01(sizeGap * (SIZE_WEIGHT + INDUSTRY_WEIGHT * industryGap));
        const bonusFarms = Math.min(MAX_BONUS_FARMS, Math.round(need * MAX_BONUS_FARMS));
        const bonusInfrastructure = Math.min(MAX_BONUS_INFRASTRUCTURE, Math.round(need * MAX_BONUS_INFRASTRUCTURE));
        if (bonusFarms > 0 || bonusInfrastructure > 0) {
            applyCompensation(regions[index], bonusFarms, bonusInfrastructure);
        }
        return {
            nationId: nation.id,
            provinces: owned[index],
            factories: factories[index],
            bonusFarms,
            bonusInfrastructure,
        };
    });
}
