import type { Regiment } from "./types/organization.ts";
import type { GameState } from "./types/state.ts";
import type { Province } from "./types/entities.ts";

/** Share of a province's maximum garrison restored each day. */
export const GARRISON_RECOVERY_RATE = 0.05;
export const FORT_GARRISON_RECOVERY_RATE = 0.08;
export const FORT_GARRISON_CAPACITY_MULTIPLIER = 1.5;
export const FORT_GARRISON_DAMAGE_MULTIPLIER = 1.25;
export const FORT_GARRISON_INCOMING_MULTIPLIER = 0.8;
export const GARRISON_DEFENSE_FACTOR = 0.5;

export function garrisonRecoveryRate(province: Province): number {
    return province.buildings.includes("fort") ? FORT_GARRISON_RECOVERY_RATE : GARRISON_RECOVERY_RATE;
}

export function garrisonIncomingMultiplier(province: Province): number {
    return province.buildings.includes("fort") ? FORT_GARRISON_INCOMING_MULTIPLIER : 1;
}

export function garrisonCapacity(
    province: Pick<Province, "income" | "defense" | "isCity" | "isCapital" | "buildings">,
): number {
    const rank = province.isCapital ? 1.5 : province.isCity ? 1.2 : 1;
    const base = Math.round((8 + province.income * 3) * rank * (0.8 + province.defense * 0.2));
    return Math.round(base * (province.buildings.includes("fort") ? FORT_GARRISON_CAPACITY_MULTIPLIER : 1));
}

export function refreshGarrisonCapacity(state: GameState, province: Province): void {
    province.garrisonMax = state.terrain.passable[province.site]
        ? garrisonCapacity(province)
        : 0;
    province.garrison = Math.min(province.garrison, province.garrisonMax);
}

/** Distribute a damage pool over regiments proportional to remaining HP. */
export function applyDamage(regiments: Regiment[], pool: number): number {
    let remaining = Math.max(0, Math.round(pool));
    const totalHp = regiments.reduce((sum, regiment) => sum + Math.max(0, regiment.hp), 0);
    if (remaining <= 0 || totalHp <= 0) return 0;

    let applied = 0;
    for (const regiment of regiments) {
        if (remaining <= 0) break;
        if (regiment.hp <= 0) continue;
        const share = Math.ceil((remaining * regiment.hp) / totalHp);
        const damage = Math.min(regiment.hp, share, remaining);
        regiment.hp -= damage;
        remaining -= damage;
        applied += damage;
    }
    if (remaining > 0) {
        for (const regiment of regiments) {
            if (remaining <= 0) break;
            const damage = Math.min(regiment.hp, remaining);
            regiment.hp -= damage;
            remaining -= damage;
            applied += damage;
        }
    }
    return applied;
}