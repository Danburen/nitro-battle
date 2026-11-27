import { t } from "../i18n/index.ts";
import type { GameCore } from "./core.ts";
import type { AIAction } from "./ai/index.ts";
import { garrisonRecoveryRate } from "./battle.ts";
import { recruitRegiment, resolveProvinceClashes } from "./provinceArmy.ts";
import { advanceDiplomacy, runAIDiplomacy, tickDiplomaticUpkeep } from "./diplomacy.ts";
import { runAIAlliances, tickAlliances } from "./alliance.ts";
import { expireDiplomaticRequests } from "./vassal.ts";
import { runAITrade, tickTradeAgreements } from "./trade.ts";
import { resolveWarOutcomes } from "./settlement.ts";
import { resolvePlayerProposals } from "./proposals.ts";
import { clampResources, occupationGrowth, resourceChain } from "./economy.ts";
import type { ResourceChain } from "./economy.ts";
import { advancePolicySwitches, tickPolicyUpkeep } from "./policy.ts";
import { enqueueBuild, enqueueProvinceBuild, processConstruction, processDeployments, reinforceArmy, setFactoryProduction } from "./production.ts";
import { computeSupply, supplyLevel, supplyOrgFactor } from "./supply.ts";
import { DAYS_PER_SEASON, NEUTRAL, SEASONS } from "./types/world.ts";
import { ORG_MAX, ORG_REGEN, REINFORCE_MIN_SUPPLY, UNPAID_UPKEEP_ORG_PENALTY } from "./types/organization.ts";
import { POPULATION_MAX, POPULATION_MIN, STABILITY_DRIFT, STRATEGIC_SHORTAGE_ORG_PENALTY } from "./types/economy.ts";
import { shiftStability } from "./stability.ts";

export function endTurn(core: GameCore): void {
    if (core.state.winner !== null) return;

    for (const controller of core.controllers) {
        const nation = core.state.nations[controller.nationId];
        if (!nation.alive) continue;
        runAIAlliances(core, controller.nationId);
        runAITrade(core, controller.nationId);
        runAIDiplomacy(core, controller.nationId);
        if (core.state.winner !== null) return;
        for (const action of controller.takeTurn(core.state)) {
            applyAIAction(core, action, controller.nationId);
        }
    }

    // All combat happens between province garrisons; there are no independent armies.
    resolveProvinceClashes(core);
    resolveWarOutcomes(core);
    if (core.state.winner === null) advanceDay(core);
    resolveWarOutcomes(core);
    core.emit({ type: "state" });
}

function applyAIAction(core: GameCore, action: AIAction, nationId: number): void {
    switch (action.kind) {
        case "train": {
            const fallback = core.state.nations[nationId].capital;
            const site = action.province ?? fallback;
            recruitRegiment(core, nationId, action.unitKind, site);
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
    resolvePlayerProposals(core);
    advanceDiplomacy(core);
    advancePolicySwitches(core);
    const seasonIndex = Math.floor((state.day - 1) / DAYS_PER_SEASON) % SEASONS.length;
    const seasonChanged = seasonIndex !== state.seasonIndex;
    state.seasonIndex = seasonIndex;
    state.terrain.updateWeather(SEASONS[seasonIndex].value);
    state.supplyDirty = true;
    if (seasonChanged) {
        core.log(t("game.turn.seasonChange", { season: SEASONS[seasonIndex].name }), "system", NEUTRAL, false, {
            kind: "season",
            season: SEASONS[seasonIndex].name,
        });
    }
    core.emit({ type: "day", day: state.day, seasonIndex });

    // Occupation integrates a little every day.
    for (const province of state.provinces) {
        if (province.coreNation === province.owner) continue;
        if (province.occupation >= 100) continue;
        province.occupation = Math.min(100, province.occupation + occupationGrowth(state, province, province.owner));
    }

    // Phase 1: snapshot every nation's plan from the start-of-day state before
    // any stock, population or organisation value is mutated.
    const plans = new Map<number, ResourceChain>();
    for (const nation of state.nations) {
        if (nation.alive) plans.set(nation.id, resourceChain(state, nation.id));
    }

    // Phase 2: apply income, upkeep, resource flows and population once per nation.
    const unpaid = new Set<number>();
    for (const nation of state.nations) {
        if (!nation.alive) continue;
        const chain = plans.get(nation.id)!;
        const rates = chain.rates;
        nation.funds += rates.fundsGross;
        if (nation.funds >= rates.upkeep) {
            nation.funds -= rates.upkeep;
        } else {
            nation.funds = 0;
            unpaid.add(nation.id);
            for (const army of state.armies.values()) {
                if (army.nation === nation.id) army.org = Math.max(0, army.org - UNPAID_UPKEEP_ORG_PENALTY);
            }
            core.log(t("game.turn.unpaid", { nation: core.nationChip(nation.id) }), "econ", nation.id);
        }
        nation.manpower += rates.manpower;
        nation.industry += rates.industryNet;
        nation.politicalPower += rates.politicalPower;
        nation.raw += rates.raw;
        nation.food += rates.food;
        nation.strategic += rates.strategic;
        clampResources(nation, rates);

        if (nation.stability !== undefined) {
            const target = chain.stability.target;
            const delta = Math.max(-STABILITY_DRIFT, Math.min(STABILITY_DRIFT, target - nation.stability));
            shiftStability(nation, delta);
        }

        for (const [site, growth] of chain.populationGrowth) {
            const province = state.provinces[site];
            province.population = Math.min(POPULATION_MAX, Math.max(POPULATION_MIN, province.population + growth));
        }
        if (chain.strategic.shortage) {
            for (const army of state.armies.values()) {
                if (army.nation === nation.id) army.org = Math.max(0, army.org - STRATEGIC_SHORTAGE_ORG_PENALTY);
            }
            core.log(t("game.turn.strategicShortage", { nation: core.nationChip(nation.id) }), "econ", nation.id);
        } else if (chain.food.shortage) {
            core.log(t("game.turn.foodShortage", { nation: core.nationChip(nation.id) }), "econ", nation.id);
        } else if (chain.raw.shortage) {
            core.log(t("game.turn.rawShortage", { nation: core.nationChip(nation.id) }), "econ", nation.id);
        }
    }
    tickTradeAgreements(core);
    tickAlliances(core);
    expireDiplomaticRequests(core);
    tickDiplomaticUpkeep(core);
    tickPolicyUpkeep(core);

    processConstruction(core);
    state.supply = computeSupply(state);
    state.supplyDirty = false;

    // Garrisons recover everywhere: province clashes are resolved instantly.
    for (const province of state.provinces) {
        if (province.garrisonMax <= 0 || province.garrison >= province.garrisonMax) continue;
        province.garrison = Math.min(
            province.garrisonMax,
            province.garrison + Math.ceil(province.garrisonMax * garrisonRecoveryRate(province)),
        );
    }

    // Org regen and paid reinforcement for every province army.
    for (const army of state.armies.values()) {
        army.org = Math.min(ORG_MAX, army.org + ORG_REGEN * supplyOrgFactor(state, army.province));
        if (!unpaid.has(army.nation) && supplyLevel(state, army.province) >= REINFORCE_MIN_SUPPLY) {
            reinforceArmy(core, army);
        }
    }

    processDeployments(core);
}