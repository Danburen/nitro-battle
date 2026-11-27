/** Province-level armies: troops stay in their province and fight as a pool. */

import { t } from "../i18n/index.ts";
import type { GameCore } from "./core.ts";
import { applyDamage, garrisonIncomingMultiplier } from "./battle.ts";
import { claimProvince } from "./conquest.ts";
import { ARMY_UNITS_PER_POP } from "./types/economy.ts";
import { conscriptionProfile } from "./policy.ts";
import { populationIdentity } from "./stability.ts";
import { armyAt, isHostileProvince, orgFactor } from "./rules.ts";
import { spawnArmy, nextArmyName } from "./armies.ts";
import { DEPLOY_ORG } from "./types/organization.ts";
import { MAX_HP, REGIMENT_CAP, UNIT_PROFILES } from "./types/unit.ts";
import type { ProvinceStance } from "./types/entities.ts";
import type { GameState } from "./types/state.ts";
import type { UnitKind } from "./types/unit.ts";
import type { BattleReport } from "./types/log.ts";

export const PROVINCE_STANCES: readonly ProvinceStance[] = ["auto", "defend", "attack"];

/** Troop ceiling: national population × conscription share × coefficient. */
export function armyUnitCap(state: GameState, nationId: number): number {
    const nation = state.nations[nationId];
    if (!nation) return 0;
    let population = 0;
    for (const province of state.provinces) {
        if (province.owner === nationId && state.terrain.passable[province.site]) {
            population += province.population * populationIdentity(province, nationId);
        }
    }
    const share = conscriptionProfile(nation, state.day).share;
    return Math.max(4, Math.floor(population * share * ARMY_UNITS_PER_POP));
}

export function nationUnitCount(state: GameState, nationId: number): number {
    let count = 0;
    for (const army of state.armies.values()) {
        if (army.nation === nationId) count += army.regiments.length;
    }
    return count;
}

export function provinceComposition(state: GameState, site: number): { kind: UnitKind; count: number }[] {
    const army = armyAt(state, site);
    if (!army) return [];
    const counts = new Map<UnitKind, number>();
    for (const regiment of army.regiments) {
        if (regiment.hp <= 0) continue;
        counts.set(regiment.kind, (counts.get(regiment.kind) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .map(([kind, count]) => ({ kind, count }));
}

export function majorityKind(state: GameState, site: number): UnitKind | null {
    return provinceComposition(state, site)[0]?.kind ?? null;
}

export function setProvinceStance(core: GameCore, site: number, stance: ProvinceStance): boolean {
    const state = core.state;
    const province = state.provinces[site];
    if (!province || province.owner !== 0 || state.winner !== null) return false;
    if (!PROVINCE_STANCES.includes(stance)) return false;
    province.stance = stance;
    core.emit({ type: "state" });
    return true;
}

/** Immediately raise one regiment in an owned province; costs cap, funds and industry. */
export function recruitRegiment(core: GameCore, nationId: number, kind: UnitKind, site: number): boolean {
    const state = core.state;
    const province = state.provinces[site];
    const nation = state.nations[nationId];
    if (!province || !nation?.alive || state.winner !== null) return false;
    if (province.owner !== nationId || !state.terrain.passable[site]) return false;
    if (nationUnitCount(state, nationId) >= armyUnitCap(state, nationId)) return false;
    const occupant = armyAt(state, site);
    if (occupant && occupant.nation === nationId && occupant.regiments.length >= REGIMENT_CAP) return false;
    const profile = UNIT_PROFILES[kind];
    if (nation.funds < profile.cost || nation.industry < profile.industryCost) return false;

    nation.funds -= profile.cost;
    nation.industry -= profile.industryCost;
    let armyId: number;
    if (occupant && occupant.nation === nationId) {
        occupant.regiments.push({ id: state.nextRegimentId++, kind, hp: MAX_HP });
        armyId = occupant.id;
    } else {
        armyId = spawnArmy(state, nationId, site, [kind], DEPLOY_ORG).id;
    }
    state.stats.recruited++;
    core.log(t("game.provinceArmy.recruit", {
        nation: core.nationChip(nationId), unit: profile.name, province: province.name,
    }), "econ", nationId, false, {
        kind: "production", nation: nationId, province: province.name, site,
        items: [{ label: profile.name, count: 1 }],
    });
    core.emit({ type: "deploy", province: site, armyId, nationId, kind });
    core.emit({ type: "state" });
    return true;
}

/** Disband one regiment of a kind in a province, for fine-grained composition. */
export function disbandRegiment(core: GameCore, site: number, kind: UnitKind): boolean {
    const state = core.state;
    const province = state.provinces[site];
    const army = armyAt(state, site);
    if (!province || !army || army.nation !== 0 || province.owner !== 0 || state.winner !== null) return false;
    const index = army.regiments.findLastIndex((regiment) => regiment.kind === kind);
    if (index < 0) return false;
    army.regiments.splice(index, 1);
    if (army.regiments.length === 0) core.removeArmy(army, false);
    core.log(t("game.provinceArmy.disband", {
        nation: core.nationChip(0), province: province.name, unit: UNIT_PROFILES[kind].name,
    }), "econ", 0);
    core.emit({ type: "state" });
    return true;
}

/** Remove every field regiment from a province; the garrison stays. */
export function clearProvinceTroops(core: GameCore, site: number): boolean {
    const state = core.state;
    const province = state.provinces[site];
    const army = armyAt(state, site);
    if (!province || !army || army.nation !== 0 || province.owner !== 0 || state.winner !== null) return false;
    const count = army.regiments.length;
    if (count === 0) return false;
    core.removeArmy(army, false);
    core.log(t("game.provinceArmy.clear", {
        nation: core.nationChip(0), province: province.name, count,
    }), "econ", 0);
    core.emit({ type: "state" });
    return true;
}

function armyPower(army: import("./types/organization.ts").Army, attack: boolean): number {
    let power = 0;
    for (const regiment of army.regiments) {
        if (regiment.hp <= 0) continue;
        const profile = UNIT_PROFILES[regiment.kind];
        power += (attack ? profile.atk : profile.def) * (Math.max(0, regiment.hp) / MAX_HP);
    }
    return power * orgFactor(army.org);
}

function provinceDefenseScore(state: GameState, site: number): number {
    const province = state.provinces[site];
    const defender = armyAt(state, site);
    const field = defender && defender.nation === province.owner ? armyPower(defender, false) : 0;
    const fort = province.buildings.includes("fort") ? 1.25 : 1;
    return Math.max(1, (province.garrison * 0.5 + field) * province.defense * fort);
}

/** Adjacent ground that actually advances one of the nation's war goals. */
function warObjectives(state: GameState, nationId: number): Set<number> {
    const sites = new Set<number>();
    for (const war of state.wars) {
        if (war.aggressor !== nationId) continue;
        if (war.goal === "annex") {
            for (const province of state.provinces) {
                if (province.legalOwner === war.defender) sites.add(province.site);
            }
        } else {
            for (const site of war.targetSites) sites.add(site);
        }
    }
    return sites;
}

interface ClashResult {
    attackPower: number;
    defensePower: number;
    attackerLoss: number;
    defenderLoss: number;
    garrisonBefore: number;
    garrisonAfter: number;
    captured: boolean;
}

/** One daily clash: both sides consume troops; capture needs the garrison gone. */
function resolveClash(core: GameCore, target: number, attackerSites: readonly number[], nationId: number): ClashResult | null {
    const state = core.state;
    const province = state.provinces[target];
    if (province.owner === nationId || !isHostileProvince(state, nationId, target)) return null;
    const attackers = attackerSites
        .map((site) => armyAt(state, site))
        .filter((army): army is NonNullable<typeof army> =>
            !!army && army.nation === nationId && state.provinces[army.province].owner === nationId && army.regiments.length > 0);
    if (attackers.length === 0) return null;

    const defender = armyAt(state, target);
    const defenderArmy = defender && defender.nation === province.owner ? defender : null;
    const garrisonBefore = province.garrison;
    const attackPower = attackers.reduce((sum, army) => sum + armyPower(army, true), 0);
    const defensePower = provinceDefenseScore(state, target);
    if (attackPower <= 0) return null;

    const ratio = attackPower / defensePower;
    // The side that brings more force loses proportionally less.
    const attackerLossPool = defensePower * Math.max(0.15, Math.min(0.9, 0.55 / Math.max(0.5, ratio)));
    // Garrison damage must outpace its daily recovery, or a siege can never end.
    const defenderLossPool = attackPower * 0.5 * garrisonIncomingMultiplier(province);

    const fort = province.buildings.includes("fort") ? 1.25 : 1;
    const garrisonPower = province.garrison * 0.5 * fort;
    const fieldPower = defenderArmy ? armyPower(defenderArmy, false) : 0;
    const totalDefense = Math.max(1, garrisonPower + fieldPower);
    const garrisonShare = garrisonPower / totalDefense;

    province.garrison = Math.max(0, province.garrison - Math.round(defenderLossPool * garrisonShare));
    let defenderLoss = garrisonBefore - province.garrison;
    if (defenderArmy) {
        const before = defenderArmy.regiments.length;
        defenderLoss += applyDamage(defenderArmy.regiments, defenderLossPool * (1 - garrisonShare));
        defenderArmy.regiments = defenderArmy.regiments.filter((regiment) => regiment.hp > 0);
        defenderLoss += before - defenderArmy.regiments.length;
        defenderArmy.org = Math.max(0, defenderArmy.org - 8);
    }

    let attackerLoss = 0;
    for (const army of attackers) {
        const share = attackPower > 0 ? armyPower(army, true) / attackPower : 1 / attackers.length;
        const before = army.regiments.length;
        attackerLoss += applyDamage(army.regiments, attackerLossPool * share);
        army.regiments = army.regiments.filter((regiment) => regiment.hp > 0);
        attackerLoss += before - army.regiments.length;
        army.org = Math.max(0, army.org - 6);
    }

    const defendersLeft = !!defenderArmy && defenderArmy.regiments.length > 0;
    const captured = province.garrison <= 0 && !defendersLeft;

    if (defenderArmy && defenderArmy.regiments.length === 0) core.removeArmy(defenderArmy, true);
    for (const army of attackers) {
        if (army.regiments.length === 0) core.removeArmy(army, true);
    }

    if (captured) {
        const previousOwner = province.owner;
        const lead = attackers
            .filter((army) => state.armies.has(army.id) && army.regiments.length > 0)
            .sort((a, b) => armyPower(b, true) - armyPower(a, true))[0];
        core.log(t("game.provinceArmy.attack", {
            nation: core.nationChip(nationId),
            province: state.provinces[attackers[0].province].name,
            target: province.name,
        }), "combat", nationId);
        if (lead) {
            // The leading force occupies the province outright; leaving half behind
            // made every capture instantly reversible by the previous owner.
            const moving = lead.regiments;
            lead.regiments = [];
            const occupying = spawnArmy(state, nationId, target, [], lead.org);
            occupying.regiments = moving;
            core.removeArmy(lead, false);
        }
        const report: BattleReport = {
            attacker: nationId,
            defender: previousOwner,
            rounds: 1,
            attackLoss: attackerLoss,
            defenseLoss: defenderLoss,
            totalAttackLoss: attackerLoss,
            totalDefenseLoss: defenderLoss,
            breach: true,
            outcome: "captured",
        };
        claimProvince(core, target, nationId, previousOwner, report);
        province.stance = "auto";
        core.emit({
            type: "combat",
            province: target,
            attackerNation: nationId,
            defenderNation: previousOwner,
            outcome: "captured",
            attackerLoss,
            defenderLoss,
            garrisonBefore,
            garrisonAfter: 0,
            attackerOrg: 0,
            defenderOrg: 0,
        });
        return {
            attackPower, defensePower, attackerLoss, defenderLoss,
            garrisonBefore, garrisonAfter: 0, captured: true,
        };
    }

    province.garrison = Math.min(province.garrisonMax, province.garrison);
    core.emit({
        type: "combat",
        province: target,
        attackerNation: nationId,
        defenderNation: province.owner,
        outcome: "ongoing",
        attackerLoss,
        defenderLoss,
        garrisonBefore,
        garrisonAfter: province.garrison,
        attackerOrg: 0,
        defenderOrg: defenderArmy?.org ?? 0,
    });
    return {
        attackPower, defensePower, attackerLoss, defenderLoss,
        garrisonBefore, garrisonAfter: province.garrison, captured: false,
    };
}

/**
 * Every province with field troops picks a hostile neighbour, weakest first.
 * Provinces already targeting the same neighbour are resolved as one clash, so
 * nearby provinces coordinate without moving their troops.
 */
export function resolveProvinceClashes(core: GameCore): void {
    const state = core.state;
    if (state.winner !== null) return;

    const attacks = new Map<string, { nation: number; target: number; sites: number[] }>();
    for (const nation of state.nations) {
        if (!nation.alive) continue;
        const objectives = warObjectives(state, nation.id);
        for (const province of state.provinces) {
            if (province.owner !== nation.id || !state.terrain.passable[province.site]) continue;
            if (province.stance === "defend") continue;
            const army = armyAt(state, province.site);
            if (!army || army.nation !== nation.id || army.regiments.length === 0) continue;
            if (core.inBattle(army.id)) continue;

            let best: number | null = null;
            let bestScore = Infinity;
            let bestDefense = Infinity;
            for (const edge of state.graph.adjacency[province.site]) {
                const site = edge.site;
                if (!state.terrain.passable[site]) continue;
                if (!isHostileProvince(state, nation.id, site)) continue;
                const defense = provinceDefenseScore(state, site);
                // Nudge armies toward the war's actual target before weaker side fronts.
                const score = defense * (objectives.has(site) ? 0.6 : 1);
                if (score < bestScore) {
                    bestScore = score;
                    bestDefense = defense;
                    best = site;
                }
            }
            if (best === null) continue;
            if (province.stance === "auto" && armyPower(army, true) < bestDefense * 1.15) continue;

            const key = `${nation.id}:${best}`;
            const group = attacks.get(key);
            if (group) group.sites.push(province.site);
            else attacks.set(key, { nation: nation.id, target: best, sites: [province.site] });
        }
    }

    const ordered = [...attacks.values()].sort((a, b) =>
        a.target - b.target || a.nation - b.nation);
    for (const group of ordered) resolveClash(core, group.target, group.sites, group.nation);
    core.invalidateReach();
}

/** Kept for UI names: a province pool uses the same roster naming as old corps. */
export function provinceArmyName(core: GameCore, nationId: number): string {
    return nextArmyName(core.state, nationId);
}