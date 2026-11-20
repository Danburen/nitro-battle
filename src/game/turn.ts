import type { GameCore } from "./core.ts";
import type { AIAction } from "./ai.ts";
import { advanceMarches, moveArmy, orderMarch } from "./armies.ts";
import { garrisonRecoveryRate } from "./battle.ts";
import { attack, resolveBattles } from "./combat.ts";
import { advanceDiplomacy, runAIDiplomacy, tickDiplomaticUpkeep } from "./diplomacy.ts";
import { resolveWarOutcomes } from "./settlement.ts";
import { clampResources, occupationGrowth, resourceRates } from "./economy.ts";
import { enqueueBuild, enqueueProvinceBuild, enqueueTrain, processConstruction, processDeployments, reinforceArmy, setFactoryProduction } from "./production.ts";
import { computeSupply, supplyLevel, supplyOrgFactor } from "./supply.ts";
import {
    DAYS_PER_SEASON,
    NEUTRAL,
    ORG_MAX,
    ORG_REGEN,
    REINFORCE_MIN_SUPPLY,
    SEASONS,
    UNPAID_UPKEEP_ORG_PENALTY,
} from "./types.ts";

export function endTurn(core: GameCore): void {
    if (core.state.winner !== null) return;

    for (const controller of core.controllers) {
        const nation = core.state.nations[controller.nationId];
        if (!nation.alive) continue;
        runAIDiplomacy(core, controller.nationId);
        if (core.state.winner !== null) return;
        for (const action of controller.takeTurn(core.state)) {
            applyAIAction(core, action, controller.nationId);
        }
    }

    resolveBattles(core);
    resolveWarOutcomes(core);
    if (core.state.winner === null) advanceDay(core);
    resolveWarOutcomes(core);
    core.invalidateReach();
    core.emit({ type: "state" });
}

function applyAIAction(core: GameCore, action: AIAction, nationId: number): void {
    switch (action.kind) {
        case "move": {
            const army = core.state.armies.get(action.armyId);
            if (army && army.nation === nationId) moveArmy(core, action.armyId, action.to);
            break;
        }
        case "attack": {
            const army = core.state.armies.get(action.armyId);
            if (army && army.nation === nationId) attack(core, action.armyId, action.target);
            break;
        }
        case "march": {
            const army = core.state.armies.get(action.armyId);
            if (army && army.nation === nationId) orderMarch(core, action.armyId, action.target, action.attack);
            break;
        }
        case "train": {
            enqueueTrain(core, nationId, action.unitKind, action.province);
            break;
        }
        case "build": {
            enqueueBuild(core, nationId, action.stateId, action.buildingKind);
            break;
        }
        case "provinceBuild": {
            enqueueProvinceBuild(core, nationId, action.site, action.buildingKind);
            break;
        }
        case "factoryProduction": {
            setFactoryProduction(core, nationId, action.prod);
            break;
        }
    }
}

function advanceDay(core: GameCore): void {
    const state = core.state;
    state.day++;
    advanceDiplomacy(core);
    const seasonIndex = Math.floor((state.day - 1) / DAYS_PER_SEASON) % SEASONS.length;
    const seasonChanged = seasonIndex !== state.seasonIndex;
    state.seasonIndex = seasonIndex;
    state.terrain.updateWeather(SEASONS[seasonIndex].value);
    state.supplyDirty = true;
    if (seasonChanged) {
        core.log(`季节更替 ${SEASONS[seasonIndex].name}`, "system", NEUTRAL);
    }
    core.emit({ type: "day", day: state.day, seasonIndex });

    // Occupation integrates a little every day.
    for (const province of state.provinces) {
        if (province.coreNation === province.owner) continue;
        if (province.occupation >= 100) continue;
        province.occupation = Math.min(100, province.occupation + occupationGrowth(state, province, province.owner));
    }

    // Income, upkeep and resource caps.
    const unpaid = new Set<number>();
    for (const nation of state.nations) {
        if (!nation.alive) continue;
        const rates = resourceRates(state, nation.id);
        nation.funds += rates.fundsGross;
        if (nation.funds >= rates.upkeep) {
            nation.funds -= rates.upkeep;
        } else {
            nation.funds = 0;
            unpaid.add(nation.id);
            for (const army of state.armies.values()) {
                if (army.nation === nation.id) army.org = Math.max(0, army.org - UNPAID_UPKEEP_ORG_PENALTY);
            }
            core.log(`${core.nationChip(nation.id)} 欠饷 全军组织度下降`, "econ", nation.id);
        }
        nation.manpower += rates.manpower;
        nation.industry += rates.industry;
        nation.politicalPower += rates.politicalPower;
        clampResources(nation, rates);
    }
    tickDiplomaticUpkeep(core);

    processConstruction(core);
    state.supply = computeSupply(state);
    state.supplyDirty = false;

    // Garrisons recover except where a battle rages.
    const battleSites = new Set(state.battles.map((battle) => battle.province));
    for (const province of state.provinces) {
        if (province.garrisonMax <= 0 || province.garrison >= province.garrisonMax) continue;
        if (battleSites.has(province.site)) continue;
        province.garrison = Math.min(
            province.garrisonMax,
            province.garrison + Math.ceil(province.garrisonMax * garrisonRecoveryRate(province)),
        );
    }

    // Org regen, paid reinforcement, and the daily action reset.
    for (const army of state.armies.values()) {
        const locked = core.inBattle(army.id);
        if (!locked) {
            army.org = Math.min(ORG_MAX, army.org + ORG_REGEN * supplyOrgFactor(state, army.province));
            if (!unpaid.has(army.nation) && supplyLevel(state, army.province) >= REINFORCE_MIN_SUPPLY) {
                reinforceArmy(core, army);
            }
            army.moved = false;
            army.acted = false;
        }
    }

    processDeployments(core);
    advanceMarches(core);

    state.redeployArmyId = null;
    if (state.selectedArmyId !== null && !state.armies.has(state.selectedArmyId)) {
        state.selectedArmyId = null;
    }
}