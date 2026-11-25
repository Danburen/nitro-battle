import { BUILDING_PROFILES, INFRASTRUCTURE_MAX, STATE_BUILDING_KINDS, PROVINCE_BUILDING_KINDS } from "./types/building.ts";
import {
    DEPOSIT_YIELD_PER_LEVEL, ELIGIBLE_PER_POP, FACTORY_PROD_FUNDS, FACTORY_PROD_INDUSTRY, FOOD_PER_FARM,
    FOOD_PER_POPULATION, FOOD_PER_PROVINCE,
    FOOD_SURPLUS_GROWTH_BONUS, FOOD_SURPLUS_RATIO, INDUSTRY_BASE_CAP,
    INDUSTRY_CAP_PER_CITY, MANPOWER_INTAKE_RATE, OCCUPATION_BASE_GROWTH, OCCUPATION_FACTOR_MIN,
    POPULATION_DECLINE_BASE, POPULATION_GROWTH_BASE, POPULATION_GROWTH_FOOD_RATIO, POPULATION_MAX, POPULATION_MIN, PP_CAP,
    RAW_PER_PROD_FACTORY, RESOURCE_CAPS,
    RESOURCE_INFRASTRUCTURE_BASE, RESOURCE_INFRASTRUCTURE_PER_LEVEL, SHORTAGE_FACTOR_MIN,
    STRATEGIC_PER_PROD_FACTORY, SUPPLY_RANGE_CAPITAL, SUPPLY_RANGE_CITY, SUPPLY_RANGE_CENTER,
} from "./types/economy.ts";
import { NEUTRAL } from "./types/world.ts";
import { UNIT_PROFILES, UnitKind } from "./types/unit.ts";
import type { BuildingKind, ConstructionOrder, ProvinceBuildingKind, StateBuildingKind } from "./types/building.ts";
import type { GameState } from "./types/state.ts";
import type { Nation, Province, StateRegion } from "./types/entities.ts";
import type { PolicyModifiers } from "./types/policy.ts";
import { conscriptionProfile, policyModifiers } from "./policy.ts";
import {
    populationIdentity, stabilityManpower, stabilityPolitics, stabilityOf, stabilityProduction,
    targetStability, warCount,
} from "./stability.ts";
import type { StabilityInputs, StabilitySnapshot } from "./stability.ts";

export function occupationFactor(province: Province, nationId: number): number {
    if (province.owner !== nationId) return 0;
    if (province.coreNation === nationId) return 1;
    return OCCUPATION_FACTOR_MIN + (1 - OCCUPATION_FACTOR_MIN) * (province.occupation / 100);
}

function clampInfrastructure(level: number): number {
    return Number.isFinite(level) ? Math.max(0, Math.min(INFRASTRUCTURE_MAX, Math.floor(level))) : 0;
}

/** Occupied outlying provinces cannot borrow the center owner's roads. */
export function infrastructureLevel(state: GameState, site: number): number {
    const province = state.provinces[site];
    const region = province && state.states[province.stateId];
    if (!region || province.owner === NEUTRAL || state.provinces[region.center].owner !== province.owner) return 0;
    return clampInfrastructure(region.infrastructure);
}

export function infrastructureOutputMultiplier(level: number): number {
    return 0.8 + 0.05 * clampInfrastructure(level);
}

/** Resource-chain curve: 60% baseline, +10% per infrastructure level. */
export function resourceYieldMultiplier(level: number): number {
    return RESOURCE_INFRASTRUCTURE_BASE + RESOURCE_INFRASTRUCTURE_PER_LEVEL * clampInfrastructure(level);
}

/** One province's daily resource contribution, before any global policy multiplier. */
export interface ProvinceResourceOutput {
    /** Mine output from this province's raw deposit. */
    raw: number;
    /** Mine output from this province's strategic deposit. */
    strategic: number;
    /** Baseline food from owning this province. */
    food: number;
    /** Farm food when this province is an occupied/owned state center with farms. */
    farmFood: number;
    /** Effective state infrastructure used by the mines. */
    infrastructure: number;
    /** Occupation multiplier used for every source above. */
    occupation: number;
}

/**
 * Pure per-province view of the resource chain. Defaults to the current owner so
 * map/tooltip previews also work for neutral land; pass an explicit nation id to
 * mirror another nation's actual settlement output.
 */
export function provinceResourceOutput(state: GameState, province: Province, nationId = province.owner): ProvinceResourceOutput {
    const infrastructure = infrastructureLevel(state, province.site);
    const occupation = occupationFactor(province, nationId);
    const yieldMult = resourceYieldMultiplier(infrastructure);
    const raw = province.deposits.raw * DEPOSIT_YIELD_PER_LEVEL * yieldMult * occupation;
    const strategic = province.deposits.strategic * DEPOSIT_YIELD_PER_LEVEL * yieldMult * occupation;
    const food = FOOD_PER_PROVINCE * occupation;
    let farmFood = 0;
    const region = state.states[province.stateId];
    if (province.owner !== NEUTRAL && region && region.center === province.site) {
        const farms = buildingCount(region, "farm");
        if (farms > 0) {
            const nation = state.nations[nationId];
            const occupiedMult = province.coreNation === nationId || !nation
                ? 1 : policyModifiers(nation, state.day).occupiedIncomeMult;
            farmFood = farms * FOOD_PER_FARM * yieldMult * occupation * occupiedMult;
        }
    }
    return { raw, strategic, food, farmFood, infrastructure, occupation };
}

/** Rural land pays a fifth of an equivalent city province's taxes. */
const RURAL_INCOME_FACTOR = 0.2;

/** Daily funds a province contributes, before occupation and policy multipliers. */
export function provinceFundsIncome(province: Province): number {
    return province.income * (province.isCity ? 1 : RURAL_INCOME_FACTOR);
}

export function infrastructureBuildMultiplier(level: number): number {
    return 0.8 + 0.05 * clampInfrastructure(level);
}

export function infrastructureMoveMultiplier(level: number): number {
    return 1 - 0.05 * clampInfrastructure(level);
}

export function infrastructureSupplyMultiplier(level: number): number {
    return 1 + 0.05 * clampInfrastructure(level);
}

export function buildingCount(region: StateRegion, kind: StateBuildingKind): number {
    if (kind === "factory") return region.factories;
    if (kind === "infrastructure") return region.infrastructure;
    return region.buildings.filter((entry) => entry === kind).length;
}

export function stateBuildingCapacity(state: GameState, region: StateRegion, kind: StateBuildingKind) {
    const built = buildingCount(region, kind);
    const pending = state.construction.filter((order) => order.site === region.center && order.kind === kind).length;
    const limit = kind === "infrastructure" ? INFRASTRUCTURE_MAX : kind === "admin" ? 1 : region.provinces.length;
    return { built, pending, used: built + pending, limit };
}

export function provinceBuildingCapacity(state: GameState, province: Province, kind: ProvinceBuildingKind) {
    const built = province.buildings.includes(kind) ? 1 : 0;
    const pending = state.construction.filter((order) => order.site === province.site && order.kind === kind).length;
    return { built, pending, used: built + pending, limit: 1 };
}

export function hasBuilding(state: GameState, province: Province, kind: BuildingKind): boolean {
    if (kind === "supply" || kind === "fort") return province.buildings.includes(kind);
    const region = state.states[province.stateId];
    return !!region && province.owner !== NEUTRAL &&
        state.provinces[region.center].owner === province.owner && buildingCount(region, kind) > 0;
}

/** Forts affect only the local garrison, never field-army terrain defense. */
export function provinceDefense(_state: GameState, province: Province): number {
    return province.defense;
}

export interface FactoryTotals {
    total: number;
    prod: number;
    idle: number;
}

export function factoryTotals(state: GameState, nationId: number): FactoryTotals {
    let total = 0;
    let prod = 0;
    for (const region of state.states) {
        if (state.provinces[region.center].owner !== nationId) continue;
        total += region.factories;
        prod += region.prodFactories;
    }
    return { total, prod, idle: total - prod };
}

export interface ConstructionAssignment {
    orderId: number;
    factories: number;
    pointsPerTurn: number;
}

export interface ConstructionPlanEntry extends ConstructionAssignment {
    eta: number | null;
}

export const CONSTRUCTION_FACTORIES_PER_ORDER = 5;
export const CONSTRUCTION_POINTS_PER_FACTORY = 0.5;
const POINT_EPSILON = 1e-9;

function constructionSnapshot(state: GameState, nationId: number) {
    // Prefix sums preserve source-state order and efficiency without per-worker objects.
    const output = [0];
    if (state.nations[nationId]?.alive) {
        const regions = state.states.filter((region) => state.provinces[region.center].owner === nationId)
            .sort((a, b) => a.id - b.id);
        for (const region of regions) {
            const points = CONSTRUCTION_POINTS_PER_FACTORY * infrastructureOutputMultiplier(infrastructureLevel(state, region.center));
            for (let i = region.prodFactories; i < region.factories; i++) {
                output.push(output[output.length - 1] + points);
            }
        }
    }
    const orders = state.construction.filter((order) => order.nation === nationId);
    const targets = orders.map((order) =>
        state.provinces[order.site]?.owner === nationId && state.terrain.passable[order.site]
            ? infrastructureBuildMultiplier(infrastructureLevel(state, order.site)) : 0);
    return { output, orders, targets };
}

function allocateConstruction(
    orders: readonly ConstructionOrder[], targets: readonly number[], output: readonly number[], active: readonly boolean[],
): ConstructionAssignment[] {
    let used = 0;
    return orders.map((order, i) => {
        const factories = active[i] && targets[i] > 0
            ? Math.min(CONSTRUCTION_FACTORIES_PER_ORDER, output.length - 1 - used) : 0;
        const pointsPerTurn = (output[used + factories] - output[used]) * targets[i];
        used += factories;
        return { orderId: order.id, factories, pointsPerTurn };
    });
}

/** Current-turn assignments only, shared by prediction and turn resolution. */
export function constructionAssignments(state: GameState, nationId: number): ConstructionAssignment[] {
    const { orders, targets, output } = constructionSnapshot(state, nationId);
    return allocateConstruction(orders, targets, output, orders.map(() => true));
}

// Jump between completions at fixed capacity; reallocate released workers on the next turn.
export function constructionPlan(state: GameState, nationId: number): ConstructionPlanEntry[] {
    const { orders, targets, output } = constructionSnapshot(state, nationId);
    const active = orders.map(() => true);
    let allocation = allocateConstruction(orders, targets, output, active);
    const plan: ConstructionPlanEntry[] = allocation.map((entry) => ({ ...entry, eta: null }));
    const remaining = orders.map((order) => order.remainingPoints);
    let elapsed = 0;
    for (let event = 0; event < orders.length; event++) {
        let turns = Infinity;
        for (let i = 0; i < orders.length; i++) {
            const rate = allocation[i].pointsPerTurn;
            if (active[i] && rate > 0 && Number.isFinite(remaining[i])) {
                turns = Math.min(turns, Math.max(1, Math.ceil((remaining[i] - POINT_EPSILON) / rate)));
            }
        }
        if (!Number.isFinite(turns)) break;
        elapsed += turns;
        for (let i = 0; i < orders.length; i++) {
            if (!active[i] || allocation[i].pointsPerTurn <= 0) continue;
            remaining[i] -= allocation[i].pointsPerTurn * turns;
            if (remaining[i] <= POINT_EPSILON) {
                active[i] = false;
                plan[i].eta = elapsed;
            }
        }
        allocation = allocateConstruction(orders, targets, output, active);
    }
    return plan;
}

export interface ResourceRates {
    fundsGross: number;
    upkeep: number;
    fundsNet: number;
    manpower: number;
    industry: number;
    /** Daily industry gain after the raw-shortage modifier (phase-2 value). */
    industryNet: number;
    industryFactor: number;
    /** Daily net changes of the management-chain resources. */
    raw: number;
    food: number;
    strategic: number;
    politicalPower: number;
    manpowerCap: number;
    industryCap: number;
}

/** Per-source totals before policy multipliers, shared by rates and hover breakdowns. */
export interface EconomyTotals {
    mods: PolicyModifiers;
    provinceIncome: number;
    farmFunds: number;
    factoryFunds: number;
    infrastructureFunds: number;
    industryCities: number;
    industryFactory: number;
    industryInfrastructure: number;
    upkeep: number;
    adminActive: number;
    /** Identity-weighted population points: cores count fully, occupied land a tenth. */
    eligiblePopulation: number;
    /** Owned provinces that are not historical cores. */
    occupiedProvinces: number;
    effectiveCities: number;
    /** Step-2 resource chain: gross production, consumption and army upkeep. */
    rawGross: number;
    strategicGross: number;
    foodGross: number;
    foodProvinces: number;
    foodFarms: number;
    totalPopulation: number;
    rawFactoryUse: number;
    strategicFactoryUse: number;
    strategicArmyUse: number;
    foodArmyUse: number;
    industryArmyUse: number;
}

function economyTotals(state: GameState, nationId: number): EconomyTotals {
    const nation = state.nations[nationId];
    const mods = policyModifiers(nation, state.day);
    let provinceIncome = 0;
    let farmFunds = 0;
    let factoryFunds = 0;
    let infrastructureFunds = 0;
    let industryCities = 0;
    let industryFactory = 0;
    let industryInfrastructure = 0;
    let effectiveCities = 0;
    let adminActive = 0;
    let eligiblePopulation = 0;
    let occupiedProvinces = 0;
    let rawGross = 0;
    let strategicGross = 0;
    let foodProvinces = 0;
    let foodFarms = 0;
    let totalPopulation = 0;
    let rawFactoryUse = 0;
    let strategicFactoryUse = 0;

    for (const province of state.provinces) {
        if (province.owner !== nationId) continue;
        const factor = occupationFactor(province, nationId);
        const occupiedMult = province.coreNation === nationId ? 1 : mods.occupiedIncomeMult;
        provinceIncome += provinceFundsIncome(province) * factor * occupiedMult;
        industryCities += ((province.isCity ? 3 : 0) + (province.isCapital ? 2 : 0)) * factor;
        effectiveCities += (province.isCity ? 1 : 0) * factor;
        totalPopulation += province.population;
        eligiblePopulation += province.population * populationIdentity(province, nationId);
        if (province.coreNation !== nationId) occupiedProvinces++;
        const resource = provinceResourceOutput(state, province, nationId);
        foodProvinces += resource.food;
        rawGross += resource.raw;
        strategicGross += resource.strategic;
    }

    for (const region of state.states) {
        const center = state.provinces[region.center];
        if (center.owner !== nationId || center.owner === NEUTRAL) continue;
        const factor = occupationFactor(center, nationId);
        const occupiedMult = center.coreNation === nationId ? 1 : mods.occupiedIncomeMult;
        const farms = buildingCount(region, "farm");
        const infra = infrastructureLevel(state, region.center);
        const output = infrastructureOutputMultiplier(infra);
        const production = region.prodFactories * output;
        const baseline = region.prodFactories;
        farmFunds += farms * 2 * factor * occupiedMult;
        factoryFunds += baseline * FACTORY_PROD_FUNDS * factor * occupiedMult;
        infrastructureFunds += (production - baseline) * FACTORY_PROD_FUNDS * factor * occupiedMult;
        industryFactory += baseline * FACTORY_PROD_INDUSTRY * factor;
        industryInfrastructure += (production - baseline) * FACTORY_PROD_INDUSTRY * factor;
        foodFarms += provinceResourceOutput(state, center, nationId).farmFood;
        rawFactoryUse += baseline * RAW_PER_PROD_FACTORY * factor;
        strategicFactoryUse += baseline * STRATEGIC_PER_PROD_FACTORY * factor;
        if (region.buildings.includes("admin") && (center.coreNation === nationId || center.occupation >= 50)) adminActive++;
    }

    let upkeep = 0;
    let strategicArmyUse = 0;
    let foodArmyUse = 0;
    let industryArmyUse = 0;
    for (const army of state.armies.values()) {
        if (army.nation !== nationId) continue;
        for (const regiment of army.regiments) {
            const profile = UNIT_PROFILES[regiment.kind];
            upkeep += profile.upkeep;
            strategicArmyUse += profile.strategicUpkeep;
            foodArmyUse += profile.foodUpkeep;
            industryArmyUse += profile.industryUpkeep;
        }
    }

    return {
        mods, provinceIncome, farmFunds, factoryFunds, infrastructureFunds,
        industryCities, industryFactory, industryInfrastructure,
        upkeep, adminActive, eligiblePopulation, occupiedProvinces, effectiveCities,
        rawGross, strategicGross, foodGross: foodProvinces + foodFarms,
        foodProvinces, foodFarms, totalPopulation,
        rawFactoryUse, strategicFactoryUse, strategicArmyUse, foodArmyUse, industryArmyUse,
    };
}

/** One resource's daily flow; `factor` is the production modifier applied when an input is short. */
export interface ResourceFlow {
    gross: number;
    consumption: number;
    net: number;
    cap: number;
    shortage: boolean;
    factor: number;
}

export interface FoodFlow extends ResourceFlow {
    surplus: boolean;
    surplusBonus: number;
}

/**
 * Phase-1 output of the daily two-phase settlement. Everything here is derived
 * from the state at the start of the day; callers apply the numbers in phase 2.
 */
export interface ResourceChain {
    totals: EconomyTotals;
    rates: ResourceRates;
    raw: ResourceFlow;
    strategic: ResourceFlow;
    food: FoodFlow;
    /** Stability snapshot the rates were derived from (drift happens in phase 2). */
    stability: StabilitySnapshot;
    /** Raw shortage multiplier applied to the daily industry gain. */
    industryFactor: number;
    /** Site -> daily population change (negative during famine) for core provinces of this nation. */
    populationGrowth: Map<number, number>;
}

function shortageFactor(available: number, demand: number): { shortage: boolean; factor: number } {
    if (demand <= 0 || available >= demand) return { shortage: false, factor: 1 };
    return { shortage: true, factor: Math.max(SHORTAGE_FACTOR_MIN, available / demand) };
}

export function resourceChain(state: GameState, nationId: number): ResourceChain {
    const totals = economyTotals(state, nationId);
    const nation = state.nations[nationId];

    const rawConsumption = totals.rawFactoryUse;
    const strategicConsumption = totals.strategicFactoryUse + totals.strategicArmyUse;
    const foodConsumption = FOOD_PER_POPULATION * totals.totalPopulation + totals.foodArmyUse;

    // Subsistence fallback: an economy with no access to a chain resource at all
    // uses local substitutes instead of collapsing. Hand-built fixtures and
    // resource-less starts rely on this; real nations begin with stocks/mines.
    const rawAvailable = nation.raw + totals.rawGross;
    const strategicAvailable = nation.strategic + totals.strategicGross;
    const rawShort = rawAvailable > 0 ? shortageFactor(rawAvailable, rawConsumption) : { shortage: false, factor: 1 };
    const strategicShort = strategicAvailable > 0
        ? shortageFactor(strategicAvailable, strategicConsumption) : { shortage: false, factor: 1 };
    const foodShort = shortageFactor(nation.food + totals.foodGross, foodConsumption);

    // Starvation depresses raw extraction and strategic mining (but not food itself).
    const foodPenalty = foodShort.factor;
    const conscription = conscriptionProfile(nation, state.day);
    // Stability scales the whole productive economy, not the army's upkeep.
    const economyFactor = stabilityProduction(nation);
    const ppFactor = stabilityPolitics(nation);
    const recruitFactor = stabilityManpower(nation);
    const rawGross = totals.rawGross * foodPenalty * economyFactor;
    const strategicGross = totals.strategicGross * foodPenalty * economyFactor;
    const foodGross = totals.foodGross * economyFactor;
    const rawNet = rawGross - rawConsumption;
    const strategicNet = strategicGross - strategicConsumption;
    const foodNet = foodGross - foodConsumption;
    const surplus = !foodShort.shortage && foodNet > totals.foodGross * FOOD_SURPLUS_RATIO;
    const surplusBonus = surplus ? FOOD_SURPLUS_GROWTH_BONUS : 0;

    const stabilityInputs: StabilityInputs = {
        admin: totals.adminActive,
        wars: warCount(state, nationId),
        conscription: conscription.stabilityTarget,
        occupiedProvinces: totals.occupiedProvinces,
        food: foodShort.shortage ? -1 : surplus ? 1 : 0,
    };
    const stability: StabilitySnapshot = {
        ...stabilityInputs, value: stabilityOf(nation), target: targetStability(stabilityInputs),
    };

    const raw: ResourceFlow = {
        gross: rawGross, consumption: rawConsumption, net: rawNet,
        cap: RESOURCE_CAPS.raw, ...rawShort,
    };
    const strategic: ResourceFlow = {
        gross: strategicGross, consumption: strategicConsumption, net: strategicNet,
        cap: RESOURCE_CAPS.strategic, ...strategicShort,
    };
    const food: FoodFlow = {
        gross: foodGross, consumption: foodConsumption, net: foodNet,
        cap: RESOURCE_CAPS.food, ...foodShort, surplus, surplusBonus,
    };

    const industryFactor = rawShort.shortage ? rawShort.factor : 1;
    const populationGrowth = new Map<number, number>();
    if (foodShort.shortage) {
        // Famine shrinks the population slowly and proportionally to the deficit,
        // so demand falls back toward what the land can feed. It never grows here.
        const decline = -POPULATION_DECLINE_BASE * (1 - foodShort.factor);
        for (const province of state.provinces) {
            if (province.owner === nationId && province.coreNation === nationId && province.population > POPULATION_MIN) {
                populationGrowth.set(province.site, decline);
            }
        }
    } else {
        // Growth tracks the food margin: a nation living hand to mouth stops
        // growing long before it starves, and a food-rich one grows steadily.
        const foodRatio = totals.foodGross > 0 ? foodNet / totals.foodGross : 0;
        const foodFactor = Math.max(0, Math.min(1, foodRatio / POPULATION_GROWTH_FOOD_RATIO));
        const growth = POPULATION_GROWTH_BASE * (1 + surplusBonus) * totals.mods.growthMult * foodFactor;
        for (const province of state.provinces) {
            if (province.owner === nationId && province.coreNation === nationId && province.population < POPULATION_MAX) {
                populationGrowth.set(province.site, growth);
            }
        }
    }

    const fundsGross = (totals.provinceIncome + totals.farmFunds + totals.factoryFunds
        + totals.infrastructureFunds) * totals.mods.fundsMult * economyFactor;
    const manpowerCap = totals.eligiblePopulation * conscription.share * ELIGIBLE_PER_POP;
    // Fixtures omit stability and keep their hand-set manpower untouched.
    const manpower = nation.stability === undefined
        ? 0 : manpowerCap * MANPOWER_INTAKE_RATE * recruitFactor * totals.mods.manpowerMult;
    const industry = (totals.industryCities + totals.industryFactory
        + totals.industryInfrastructure) * totals.mods.industryMult * economyFactor;
    const rates: ResourceRates = {
        fundsGross, upkeep: totals.upkeep, fundsNet: fundsGross - totals.upkeep, manpower, industry,
        industryFactor, industryNet: industry * industryFactor - totals.industryArmyUse,
        raw: rawNet, food: foodNet, strategic: strategicNet,
        politicalPower: (2 + totals.adminActive + totals.mods.ppModifier) * ppFactor,
        manpowerCap,
        industryCap: INDUSTRY_BASE_CAP + INDUSTRY_CAP_PER_CITY * totals.effectiveCities,
    };

    return { totals, rates, raw, strategic, food, stability, industryFactor, populationGrowth };
}

export function resourceRates(state: GameState, nationId: number): ResourceRates {
    return resourceChain(state, nationId).rates;
}

/** Hover-detail breakdown: each source before policy multipliers, then the multiplier and net values. */
export interface ResourceBreakdown {
    funds: {
        provinces: number; farms: number; factories: number; infrastructure: number;
        policyMult: number; upkeep: number; net: number;
    };
    manpower: {
        /** Recruitable share set by the conscription policy. */
        share: number;
        /** Identity-weighted population points behind the ceiling. */
        population: number;
        eligible: number;
        total: number;
        cap: number;
        stability: number;
    };
    industry: { cities: number; factories: number; infrastructure: number; policyMult: number; total: number; cap: number; net: number };
    political: { base: number; admin: number; policy: number; stability: number; total: number };
    stability: StabilitySnapshot;
    chain: {
        raw: ResourceFlow & { mines: number; factoryUse: number };
        strategic: ResourceFlow & { mines: number; factoryUse: number; armyUse: number };
        food: FoodFlow & { provinces: number; farms: number; armyUse: number };
        industryFactor: number;
        industryArmyUse: number;
    };
}

export function resourceBreakdown(state: GameState, nationId: number): ResourceBreakdown {
    const chain = resourceChain(state, nationId);
    const totals = chain.totals;
    return {
        funds: {
            provinces: totals.provinceIncome,
            farms: totals.farmFunds,
            factories: totals.factoryFunds,
            infrastructure: totals.infrastructureFunds,
            policyMult: totals.mods.fundsMult,
            upkeep: totals.upkeep,
            net: chain.rates.fundsNet,
        },
        manpower: {
            share: totals.eligiblePopulation > 0 ? chain.rates.manpowerCap / (totals.eligiblePopulation * ELIGIBLE_PER_POP) : 0,
            population: totals.eligiblePopulation,
            eligible: chain.rates.manpowerCap,
            total: chain.rates.manpower,
            cap: chain.rates.manpowerCap,
            stability: chain.stability.value,
        },
        industry: {
            cities: totals.industryCities,
            factories: totals.industryFactory,
            infrastructure: totals.industryInfrastructure,
            policyMult: totals.mods.industryMult,
            total: chain.rates.industry,
            cap: chain.rates.industryCap,
            net: chain.rates.industryNet,
        },
        political: {
            base: 2,
            admin: totals.adminActive,
            policy: totals.mods.ppModifier,
            stability: stabilityPolitics(state.nations[nationId]),
            total: chain.rates.politicalPower,
        },
        stability: chain.stability,
        chain: {
            raw: { ...chain.raw, mines: chain.raw.gross, factoryUse: totals.rawFactoryUse },
            strategic: {
                ...chain.strategic, mines: chain.strategic.gross,
                factoryUse: totals.strategicFactoryUse, armyUse: totals.strategicArmyUse,
            },
            food: {
                ...chain.food, provinces: totals.foodProvinces,
                farms: totals.foodFarms, armyUse: totals.foodArmyUse,
            },
            industryFactor: chain.industryFactor,
            industryArmyUse: totals.industryArmyUse,
        },
    };
}

export function occupationGrowth(state: GameState, province: Province, nationId: number): number {
    if (province.coreNation === nationId) return 0;
    return OCCUPATION_BASE_GROWTH * policyModifiers(state.nations[nationId], state.day).growthMult;
}

export function clampResources(nation: Nation, rates: ResourceRates): void {
    // A fixture without stability has no recruit pool; do not clamp its hand-set manpower.
    if (nation.stability !== undefined) nation.manpower = Math.min(nation.manpower, rates.manpowerCap);
    nation.industry = Math.min(nation.industry, rates.industryCap);
    nation.politicalPower = Math.min(nation.politicalPower, PP_CAP);
    nation.raw = Math.max(0, Math.min(nation.raw, RESOURCE_CAPS.raw));
    nation.food = Math.max(0, Math.min(nation.food, RESOURCE_CAPS.food));
    nation.strategic = Math.max(0, Math.min(nation.strategic, RESOURCE_CAPS.strategic));
}

export function economicValue(state: GameState, province: Province): number {
    const region = state.states[province.stateId];
    const buildingValue = region?.center === province.site
        ? buildingCount(region, "farm") * 0.1 + region.factories * 0.2 + buildingCount(region, "admin") * 0.2 : 0;
    const value = province.income / 20 + province.population / 8 + (province.isCity ? 0.4 : 0) +
        (province.isCapital ? 0.8 : 0) + buildingValue + province.buildings.length * 0.1;
    return Math.max(0, Math.min(3, value));
}

export function canBuild(state: GameState, nationId: number, stateId: number, kind: StateBuildingKind): boolean {
    const region = state.states[stateId];
    const nation = state.nations[nationId];
    if (state.winner !== null || !region || !nation?.alive || !STATE_BUILDING_KINDS.includes(kind)) return false;
    if (state.provinces[region.center].owner !== nationId || !state.terrain.passable[region.center]) return false;
    const { used, limit } = stateBuildingCapacity(state, region, kind);
    if (used >= limit) return false;
    const profile = BUILDING_PROFILES[kind];
    return nation.funds >= profile.costFunds && nation.industry >= profile.costIndustry;
}

export function canBuildProvince(state: GameState, nationId: number, site: number, kind: ProvinceBuildingKind): boolean {
    const province = state.provinces[site];
    const nation = state.nations[nationId];
    if (state.winner !== null || !province || !nation?.alive || !PROVINCE_BUILDING_KINDS.includes(kind)) return false;
    if (province.owner !== nationId || !state.terrain.passable[site]) return false;
    const { used, limit } = provinceBuildingCapacity(state, province, kind);
    if (used >= limit) return false;
    const profile = BUILDING_PROFILES[kind];
    return nation.funds >= profile.costFunds && nation.industry >= profile.costIndustry;
}

export function canTrain(state: GameState, nationId: number, kind: UnitKind): boolean {
    const nation = state.nations[nationId];
    if (!nation?.alive) return false;
    const profile = UNIT_PROFILES[kind];
    return nation.funds >= profile.cost && nation.manpower >= profile.manpowerCost && nation.industry >= profile.industryCost;
}

export const REINFORCE_COST: Readonly<Record<UnitKind, { funds: number; manpower: number; industry: number }>> = {
    [UnitKind.INFANTRY]: { funds: 10, manpower: 5, industry: 0 },
    [UnitKind.TANK]: { funds: 20, manpower: 5, industry: 5 },
    [UnitKind.ARTILLERY]: { funds: 15, manpower: 4, industry: 3 },
};

export function activeSupplyCenter(province: Province): boolean {
    return province.owner !== NEUTRAL && province.buildings.includes("supply") &&
        (province.coreNation === province.owner || province.occupation >= 50);
}

export function isSupplySource(state: GameState, province: Province): boolean {
    return supplySourceRange(state, province) > 0;
}

export function supplySourceRange(_state: GameState, province: Province): number {
    if (province.owner === NEUTRAL) return 0;
    const factor = occupationFactor(province, province.owner);
    return Math.max(
        province.isCapital ? SUPPLY_RANGE_CAPITAL * factor : 0,
        province.isCity ? SUPPLY_RANGE_CITY * factor : 0,
        activeSupplyCenter(province) ? SUPPLY_RANGE_CENTER : 0,
    );
}
