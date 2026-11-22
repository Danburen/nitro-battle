import type { GameCore } from "./core.ts";
import { checkVictory, transferControl } from "./conquest.ts";
import { advanceDiplomacy, dropOffers, isAtWar, setWar } from "./diplomacy.ts";
import { hasMilitaryAccess, overlordOf, vassalsOf } from "./access.ts";
import { tendencyProfileOf } from "./ai/tendencies.ts";
import { setVassal, VASSAL_PROFILES } from "./vassal.ts";
import { refreshGarrisonCapacity } from "./battle.ts";
import { isHostileProvince } from "./rules.ts";
import { clampResources, resourceRates } from "./economy.ts";
import { periodicDistance } from "../terrain/voronoi/index.ts";
import { MAX_HP, REGIMENT_CAP, UNIT_PROFILES } from "./types.ts";
import type { GameState, VassalType, War } from "./types.ts";

function capitulated(state: GameState, nation: number, opponent: number): boolean {
    const territory = state.provinces.filter((province) => province.legalOwner === nation);
    if (territory.length === 0) return false;
    const held = territory.filter((province) => province.owner === opponent).length;
    const uncontested = territory.every((province) => province.owner === nation || province.owner === opponent);
    return uncontested && (held === territory.length ||
        (state.provinces[state.nations[nation].capital].owner === opponent && held / territory.length >= 0.6));
}

export function warGoalProgress(state: GameState, war: War): { held: number; total: number; canEnforce: boolean } {
    const sites = war.goal === "annex"
        ? state.provinces.filter((province) => province.legalOwner === war.defender).map((province) => province.site)
        : war.targetSites;
    const held = sites.filter((site) => state.provinces[site].legalOwner === war.defender &&
        state.provinces[site].owner === war.aggressor).length;
    return {
        held,
        total: sites.length,
        canEnforce: sites.length > 0 && (war.goal === "annex"
            ? capitulated(state, war.defender, war.aggressor)
            : held === sites.length),
    };
}

function endPairWar(core: GameCore, a: number, b: number): void {
    const state = core.state;
    for (let i = state.battles.length - 1; i >= 0; i--) {
        const battle = state.battles[i];
        const attacker = state.armies.get(battle.attackerId)?.nation;
        const defender = battle.defenderId === null ? state.provinces[battle.province].owner
            : state.armies.get(battle.defenderId)?.nation;
        if ((attacker === a && defender === b) || (attacker === b && defender === a)) state.battles.splice(i, 1);
    }
    setWar(state, a, b, false);
    for (let i = state.wars.length - 1; i >= 0; i--) {
        const war = state.wars[i];
        if ((war.aggressor === a && war.defender === b) || (war.aggressor === b && war.defender === a)) state.wars.splice(i, 1);
    }
    dropOffers(state, a, b);
}

function restorePairTerritory(core: GameCore, a: number, b: number): void {
    for (const province of core.state.provinces) {
        if ((province.legalOwner === a && province.owner === b) ||
            (province.legalOwner === b && province.owner === a)) transferControl(core, province.site, province.legalOwner);
    }
}

function retireLandlessNations(core: GameCore): void {
    const state = core.state;
    for (const nation of state.nations) {
        if (!nation.alive || state.provinces.some((province) => province.legalOwner === nation.id)) continue;
        nation.alive = false;
        core.emit({ type: "relations" });
        for (const other of state.nations) {
            if (isAtWar(state, nation.id, other.id)) endPairWar(core, nation.id, other.id);
        }
        dropOffers(state, nation.id, nation.id);
        for (const province of state.provinces) {
            if (province.owner === nation.id) transferControl(core, province.site, province.legalOwner);
        }
        for (const army of [...state.armies.values()]) {
            if (army.nation === nation.id) core.removeArmy(army, false);
        }
        for (let i = state.deployments.length - 1; i >= 0; i--) {
            if (state.deployments[i].nation === nation.id) state.deployments.splice(i, 1);
        }
        for (let i = state.construction.length - 1; i >= 0; i--) {
            if (state.construction[i].nation === nation.id) state.construction.splice(i, 1);
        }
        core.log(`${core.nationChip(nation.id)} 失去全部正式领土，被吞并`, "system", nation.id, true, {
            kind: "annex",
            nation: nation.id,
        });
    }
}

function relocateCapitals(state: GameState): void {
    for (const province of state.provinces) province.isCapital = false;
    for (const nation of state.nations) {
        if (!nation.alive) continue;
        if (state.provinces[nation.capital].legalOwner !== nation.id) {
            const territory = state.provinces.filter((province) => province.legalOwner === nation.id);
            territory.sort((a, b) => Number(b.owner === nation.id) - Number(a.owner === nation.id) ||
                Number(b.isCity) - Number(a.isCity) || a.site - b.site);
            nation.capital = territory[0].site;
        }
        state.provinces[nation.capital].isCapital = true;
    }
}

function repatriateArmies(core: GameCore): void {
    const state = core.state;
    const displaced = [...state.armies.values()].filter((army) => {
        const controller = state.provinces[army.province].owner;
        return controller !== army.nation && !isAtWar(state, army.nation, controller) &&
            !hasMilitaryAccess(state, army.nation, controller);
    });
    // Release all departing counters before choosing destinations, including mutual exchanges.
    for (const army of displaced) if (state.armyAt[army.province] === army.id) state.armyAt[army.province] = null;
    for (const army of displaced) {
        const destinations = state.provinces.filter((province) => province.owner === army.nation &&
            state.terrain.passable[province.site] && !core.battleAt(province.site));
        destinations.sort((a, b) => periodicDistance(state.graph.sites[a.site], state.graph.sites[army.province], state.graph.domain) -
            periodicDistance(state.graph.sites[b.site], state.graph.sites[army.province], state.graph.domain) || a.site - b.site);
        const empty = destinations.find((province) => state.armyAt[province.site] === null);
        army.march = null;
        army.moved = true;
        army.acted = true;
        if (empty) {
            core.placeArmy(army, empty.site);
            if (state.selectedArmyId === army.id) state.selected = empty.site;
            core.log(`${core.nationChip(army.nation)} ${army.name} 撤回 ${empty.name}`, "diplo", army.nation);
            continue;
        }
        for (const province of destinations) {
            const targetId = state.armyAt[province.site];
            const target = targetId === null ? undefined : state.armies.get(targetId);
            if (!target || target.id === army.id || target.nation !== army.nation) continue;
            const regiments = army.regiments.splice(0, Math.max(0, REGIMENT_CAP - target.regiments.length));
            if (!regiments.length) continue;
            target.org = Math.round((target.org * target.regiments.length + army.org * regiments.length) /
                (target.regiments.length + regiments.length));
            target.regiments.push(...regiments);
            target.march = null;
            target.moved = true;
            target.acted = true;
        }
        const manpower = army.regiments.reduce((sum, regiment) =>
            sum + UNIT_PROFILES[regiment.kind].manpowerCost * regiment.hp / MAX_HP, 0);
        state.nations[army.nation].manpower += manpower;
        core.log(`${core.nationChip(army.nation)} ${army.name} 撤军整编，余部复员`, "diplo", army.nation);
        core.removeArmy(army, false);
    }
    for (const army of state.armies.values()) {
        if (!army.march) continue;
        const target = state.provinces[army.march.target];
        if (army.march.attack ? !isHostileProvince(state, army.nation, target.site) : target.owner !== army.nation) army.march = null;
    }
    for (const nation of state.nations) if (nation.alive) clampResources(nation, resourceRates(state, nation.id));
}

function finishTreaty(core: GameCore, originalOwners: number[], originalCapitals: boolean[], a: number, b: number): void {
    const state = core.state;
    retireLandlessNations(core);
    relocateCapitals(state);
    for (let i = state.battles.length - 1; i >= 0; i--) {
        const battle = state.battles[i];
        const attacker = state.armies.get(battle.attackerId);
        const controller = state.provinces[battle.province].owner;
        if (!attacker || !isAtWar(state, attacker.nation, controller)) state.battles.splice(i, 1);
    }
    repatriateArmies(core);
    for (const province of state.provinces) {
        refreshGarrisonCapacity(state, province);
        if (province.owner !== originalOwners[province.site] || province.isCapital !== originalCapitals[province.site]) {
            core.emit({ type: "capture", province: province.site, nationId: province.owner, eliminated: null });
        }
    }
    state.supplyDirty = true;
    state.redeployArmyId = null;
    core.invalidateReach();
    advanceDiplomacy(core);
    core.emit({ type: "peace", a, b });
    checkVictory(core);
    core.emit({ type: "state" });
}

export function settlePeace(core: GameCore, a: number, b: number): void {
    const state = core.state;
    if (!isAtWar(state, a, b)) return;
    const owners = state.provinces.map((province) => province.owner);
    const capitals = state.provinces.map((province) => province.isCapital);
    endPairWar(core, a, b);
    restorePairTerritory(core, a, b);
    core.log(`${core.nationChip(a)} 白和平 ${core.nationChip(b)}`, "diplo", a, true, {
        kind: "peace",
        nation: a,
    });
    finishTreaty(core, owners, capitals, a, b);
}

export function enforceWarGoal(
    core: GameCore, nation: number, target: number, vassalType?: VassalType,
): boolean {
    const state = core.state;
    if (state.winner !== null || !isAtWar(state, nation, target)) return false;
    const war = state.wars.find((entry) => entry.aggressor === nation && entry.defender === target);
    if (!war || !warGoalProgress(state, war).canEnforce) return false;
    // Oppressive vassalage is a peace term of a war of annexation: no land changes hands.
    if (vassalType !== undefined && (war.goal !== "annex" || overlordOf(state, target) >= 0 ||
        overlordOf(state, nation) >= 0 || vassalsOf(state, target).length > 0)) return false;
    const owners = state.provinces.map((province) => province.owner);
    const capitals = state.provinces.map((province) => province.isCapital);
    const sites = war.goal === "annex"
        ? state.provinces.filter((province) => province.legalOwner === target).map((province) => province.site)
        : war.targetSites;
    endPairWar(core, nation, target);
    if (vassalType !== undefined) {
        restorePairTerritory(core, nation, target);
        if (!setVassal(core, target, nation, vassalType)) return false;
        core.log(`${core.nationChip(nation)} 强迫 ${core.nationChip(target)} 成为${VASSAL_PROFILES[vassalType].name}附庸`, "diplo", nation, true, {
            kind: "peace",
            nation,
        });
        finishTreaty(core, owners, capitals, nation, target);
        return true;
    }
    for (const site of sites) {
        const province = state.provinces[site];
        if (province.legalOwner !== target) continue;
        province.legalOwner = nation;
        transferControl(core, site, nation);
    }
    restorePairTerritory(core, nation, target);
    core.log(war.goal === "annex" ? `${core.nationChip(nation)} 吞并 ${core.nationChip(target)}`
        : `${core.nationChip(nation)} 夺取 ${state.states[war.stateId!].name}`, "diplo", nation, true, {
        kind: "annex",
        nation,
    });
    finishTreaty(core, owners, capitals, nation, target);
    return true;
}

export function resolveWarOutcomes(core: GameCore): void {
    for (const war of [...core.state.wars]) {
        if (!isAtWar(core.state, war.aggressor, war.defender)) continue;
        if (warGoalProgress(core.state, war).canEnforce) {
            enforceWarGoal(core, war.aggressor, war.defender, prefersOppressiveVassalage(core.state, war) ? "oppressive" : undefined);
        } else if (capitulated(core.state, war.aggressor, war.defender)) {
            core.log(`${core.nationChip(war.aggressor)} 进攻失败 ${core.nationChip(war.defender)}`, "diplo", war.defender, true, {
                kind: "peace",
                nation: war.defender,
            });
            settlePeace(core, war.aggressor, war.defender);
        }
    }
}

/**
 * Expansionist AI victors often prefer a tribute state to a new province,
 * except against the final rival where annexation is the only winning move.
 */
function prefersOppressiveVassalage(state: GameState, war: War): boolean {
    if (war.goal !== "annex") return false;
    const aggressor = state.nations[war.aggressor];
    const target = state.nations[war.defender];
    if (!aggressor?.alive || aggressor.isPlayer || !target?.alive) return false;
    if (overlordOf(state, target.id) >= 0 || overlordOf(state, aggressor.id) >= 0) return false;
    if (vassalsOf(state, target.id).length > 0) return false;
    if (tendencyProfileOf(aggressor.tendency).expansion < 4) return false;
    return state.nations.filter((nation) => nation.alive && nation.id !== war.aggressor).length > 1;
}
