import type { LCGRandom } from "../utils/LCGRandom.ts";
import { provinceDefense } from "./economy.ts";
import { armyAt, orgFactor } from "./rules.ts";
import { supplyAttackFactor } from "./supply.ts";
import { MAX_HP, ORG_BREAK, UNIT_PROFILES, UnitKind } from "./types.ts";
import type { Army, Battle, CombatOutcome, GameState, Province, Regiment } from "./types.ts";

/** Share of a province's maximum garrison restored each day. */
export const GARRISON_RECOVERY_RATE = 0.1;
export const FORT_GARRISON_RECOVERY_RATE = 0.15;
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
/** Assault power varies by ±15% each round. */
export const ROUND_VARIANCE = 0.15;
/** Artillery gains up to +60% attack against a fully manned garrison. */
export const ARTILLERY_GARRISON_BONUS = 0.6;

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

export function regimentAttack(regiment: Regiment, garrisonRatio: number): number {
    const base = UNIT_PROFILES[regiment.kind].atk * (Math.max(0, regiment.hp) / MAX_HP);
    if (regiment.kind !== UnitKind.ARTILLERY) return base;
    return base * (1 + ARTILLERY_GARRISON_BONUS * Math.max(0, Math.min(1, garrisonRatio)));
}

export function armyAttackPower(state: GameState, army: Army, target: number): number {
    const province = state.provinces[target];
    const garrisonRatio = province.garrisonMax > 0 ? province.garrison / province.garrisonMax : 0;
    let power = 0;
    for (const regiment of army.regiments) {
        if (regiment.hp > 0) power += regimentAttack(regiment, garrisonRatio);
    }
    const weather = state.terrain.getWeatherDebuff(target);
    return power * orgFactor(army.org) * weather.combatPenalty * supplyAttackFactor(state, army.province);
}

export function armyDefensePower(army: Army): number {
    let power = 0;
    for (const regiment of army.regiments) {
        if (regiment.hp > 0) power += UNIT_PROFILES[regiment.kind].def * (regiment.hp / MAX_HP);
    }
    return power * orgFactor(army.org);
}

export interface BattleForecast {
    attackPower: number;
    defensePower: number;
    garrisonPower: number;
    garrisonIncomingMultiplier: number;
    defenderArmyPower: number;
    garrisonRatio: number;
    defenderOrg: number | null;
}

export function battleForecast(state: GameState, attacker: Army, target: number): BattleForecast {
    const province = state.provinces[target];
    const attackPower = armyAttackPower(state, attacker, target);
    const garrisonPower = province.garrison * GARRISON_DEFENSE_FACTOR *
        (province.buildings.includes("fort") ? FORT_GARRISON_DAMAGE_MULTIPLIER : 1);
    const defender = armyAt(state, target);
    const defenderArmyPower = defender && defender.nation !== attacker.nation
        ? armyDefensePower(defender)
        : 0;
    const defensePower = (garrisonPower + defenderArmyPower) * provinceDefense(state, province);
    return {
        attackPower,
        defensePower,
        garrisonPower,
        garrisonIncomingMultiplier: garrisonIncomingMultiplier(province),
        defenderArmyPower,
        garrisonRatio: province.garrisonMax > 0 ? province.garrison / province.garrisonMax : 0,
        defenderOrg: defender && defender.nation !== attacker.nation ? defender.org : null,
    };
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

export interface RoundResult {
    outcome: CombatOutcome;
    attackerLoss: number;
    defenderLoss: number;
    garrisonBefore: number;
    garrisonAfter: number;
    attackerOrg: number;
    defenderOrg: number | null;
    /** Defending army broke this round and must retreat or be destroyed. */
    defenderBroken: boolean;
    attackerBroken: boolean;
}

/**
 * One daily round of a persistent battle. Damage flows both ways every round;
 * org decides who breaks first. The garrison fights alongside the defending
 * army and must be destroyed before the province can be captured.
 */
export function resolveBattleRound(state: GameState, battle: Battle, rand: LCGRandom): RoundResult {
    const province = state.provinces[battle.province];
    const attacker = state.armies.get(battle.attackerId) as Army;
    const defender = battle.defenderId !== null ? state.armies.get(battle.defenderId) ?? null : null;
    const garrisonBefore = province.garrison;

    const forecast = battleForecast(state, attacker, battle.province);
    const variance = 1 + (rand.nextFloat() * 2 - 1) * ROUND_VARIANCE;
    const attackPower = forecast.attackPower * variance;
    const defensePower = forecast.defensePower;
    const totalPower = Math.max(1, attackPower + defensePower);

    // Defender losses split between garrison and field army by their share of
    // the defense power (before the province multiplier).
    const defenderPool = attackPower * 0.5;
    const rawDefense = forecast.garrisonPower + forecast.defenderArmyPower;
    const garrisonShare = rawDefense > 0 ? forecast.garrisonPower / rawDefense : 1;
    const garrisonDamage = Math.round(defenderPool * garrisonShare * forecast.garrisonIncomingMultiplier);
    province.garrison = Math.max(0, province.garrison - garrisonDamage);

    let defenderRegimentLoss = 0;
    if (defender && defender.regiments.length > 0) {
        defenderRegimentLoss = applyDamage(defender.regiments, defenderPool * (1 - garrisonShare));
        defender.regiments = defender.regiments.filter((regiment) => regiment.hp > 0);
    }

    const attackerPool = defensePower * 0.35;
    const attackerLoss = applyDamage(attacker.regiments, attackerPool);
    attacker.regiments = attacker.regiments.filter((regiment) => regiment.hp > 0);

    attacker.org = Math.max(0, attacker.org - (6 + 16 * (defensePower / totalPower)));
    if (defender) {
        defender.org = Math.max(0, defender.org - (8 + 18 * (attackPower / totalPower)));
    }

    battle.rounds++;

    const attackerBroken = attacker.regiments.length === 0 || attacker.org <= ORG_BREAK;
    const defenderBroken = defender !== null && (defender.regiments.length === 0 || defender.org <= ORG_BREAK);
    const defenseCollapsed = province.garrison <= 0 && (defender === null || defenderBroken);

    let outcome: CombatOutcome = "ongoing";
    if (attackerBroken && !defenseCollapsed) outcome = "repelled";
    else if (defenseCollapsed && !attackerBroken) outcome = "captured";
    else if (attackerBroken && defenseCollapsed) outcome = "captured";

    return {
        outcome,
        attackerLoss,
        defenderLoss: defenderRegimentLoss + (garrisonBefore - province.garrison),
        garrisonBefore,
        garrisonAfter: province.garrison,
        attackerOrg: attacker.org,
        defenderOrg: defender ? defender.org : null,
        defenderBroken,
        attackerBroken,
    };
}