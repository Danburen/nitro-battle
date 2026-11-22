import {
    BUILDING_PROFILES, FACTORY_PROD_FUNDS, FACTORY_PROD_INDUSTRY, INDUSTRY_BASE_CAP, INDUSTRY_CAP_PER_CITY,
    INFRASTRUCTURE_MAX, MANPOWER_BASE_CAP, MANPOWER_CAP_PER_POP, NEUTRAL,
    OCCUPATION_BASE_GROWTH, OCCUPATION_FACTOR_MIN, PP_CAP,
    STATE_BUILDING_KINDS, PROVINCE_BUILDING_KINDS,
    SUPPLY_RANGE_CAPITAL, SUPPLY_RANGE_CITY, SUPPLY_RANGE_CENTER, UNIT_PROFILES, UnitKind,
} from "./types.ts";
import type {
    BuildingKind, ConstructionOrder, GameState, Nation, PolicyModifiers, Province,
    ProvinceBuildingKind, StateBuildingKind, StateRegion,
} from "./types.ts";
import { policyModifiers } from "./policy.ts";

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
    politicalPower: number;
    manpowerCap: number;
    industryCap: number;
}

/** Per-source totals before policy multipliers, shared by rates and hover breakdowns. */
interface EconomyTotals {
    mods: PolicyModifiers;
    provinceIncome: number;
    farmFunds: number;
    factoryFunds: number;
    infrastructureFunds: number;
    manpowerPopulation: number;
    manpowerFarm: number;
    industryCities: number;
    industryFactory: number;
    industryInfrastructure: number;
    upkeep: number;
    adminActive: number;
    effectivePopulation: number;
    effectiveCities: number;
}

function economyTotals(state: GameState, nationId: number): EconomyTotals {
    const nation = state.nations[nationId];
    const mods = policyModifiers(nation, state.day);
    let provinceIncome = 0;
    let farmFunds = 0;
    let factoryFunds = 0;
    let infrastructureFunds = 0;
    let manpowerPopulation = 0;
    let manpowerFarm = 0;
    let industryCities = 0;
    let industryFactory = 0;
    let industryInfrastructure = 0;
    let effectivePopulation = 0;
    let effectiveCities = 0;
    let adminActive = 0;

    for (const province of state.provinces) {
        if (province.owner !== nationId) continue;
        const factor = occupationFactor(province, nationId);
        const occupiedMult = province.coreNation === nationId ? 1 : mods.occupiedIncomeMult;
        provinceIncome += province.income * factor * occupiedMult;
        manpowerPopulation += province.population * 0.5 * factor;
        industryCities += ((province.isCity ? 3 : 0) + (province.isCapital ? 2 : 0)) * factor;
        effectivePopulation += province.population * factor;
        effectiveCities += (province.isCity ? 1 : 0) * factor;
    }

    for (const region of state.states) {
        const center = state.provinces[region.center];
        if (center.owner !== nationId || center.owner === NEUTRAL) continue;
        const factor = occupationFactor(center, nationId);
        const occupiedMult = center.coreNation === nationId ? 1 : mods.occupiedIncomeMult;
        const farms = buildingCount(region, "farm");
        const output = infrastructureOutputMultiplier(infrastructureLevel(state, region.center));
        const production = region.prodFactories * output;
        const baseline = region.prodFactories;
        farmFunds += farms * 2 * factor * occupiedMult;
        factoryFunds += baseline * FACTORY_PROD_FUNDS * factor * occupiedMult;
        infrastructureFunds += (production - baseline) * FACTORY_PROD_FUNDS * factor * occupiedMult;
        manpowerFarm += farms * 0.5 * factor;
        industryFactory += baseline * FACTORY_PROD_INDUSTRY * factor;
        industryInfrastructure += (production - baseline) * FACTORY_PROD_INDUSTRY * factor;
        if (region.buildings.includes("admin") && (center.coreNation === nationId || center.occupation >= 50)) adminActive++;
    }

    let upkeep = 0;
    for (const army of state.armies.values()) {
        if (army.nation !== nationId) continue;
        for (const regiment of army.regiments) upkeep += UNIT_PROFILES[regiment.kind].upkeep;
    }

    return {
        mods, provinceIncome, farmFunds, factoryFunds, infrastructureFunds,
        manpowerPopulation, manpowerFarm, industryCities, industryFactory, industryInfrastructure,
        upkeep, adminActive, effectivePopulation, effectiveCities,
    };
}

export function resourceRates(state: GameState, nationId: number): ResourceRates {
    const totals = economyTotals(state, nationId);
    const fundsGross = (totals.provinceIncome + totals.farmFunds + totals.factoryFunds
        + totals.infrastructureFunds) * totals.mods.fundsMult;
    const manpower = (totals.manpowerPopulation + totals.manpowerFarm) * totals.mods.manpowerMult;
    const industry = (totals.industryCities + totals.industryFactory
        + totals.industryInfrastructure) * totals.mods.industryMult;
    return {
        fundsGross, upkeep: totals.upkeep, fundsNet: fundsGross - totals.upkeep, manpower, industry,
        politicalPower: 2 + totals.adminActive + totals.mods.ppModifier,
        manpowerCap: MANPOWER_BASE_CAP + MANPOWER_CAP_PER_POP * totals.effectivePopulation,
        industryCap: INDUSTRY_BASE_CAP + INDUSTRY_CAP_PER_CITY * totals.effectiveCities,
    };
}

/** Hover-detail breakdown: each source before policy multipliers, then the multiplier and net values. */
export interface ResourceBreakdown {
    funds: {
        provinces: number; farms: number; factories: number; infrastructure: number;
        policyMult: number; upkeep: number; net: number;
    };
    manpower: { population: number; farms: number; policyMult: number; total: number; cap: number };
    industry: { cities: number; factories: number; infrastructure: number; policyMult: number; total: number; cap: number };
    political: { base: number; admin: number; policy: number; total: number };
}

export function resourceBreakdown(state: GameState, nationId: number): ResourceBreakdown {
    const totals = economyTotals(state, nationId);
    return {
        funds: {
            provinces: totals.provinceIncome,
            farms: totals.farmFunds,
            factories: totals.factoryFunds,
            infrastructure: totals.infrastructureFunds,
            policyMult: totals.mods.fundsMult,
            upkeep: totals.upkeep,
            net: (totals.provinceIncome + totals.farmFunds + totals.factoryFunds
                + totals.infrastructureFunds) * totals.mods.fundsMult - totals.upkeep,
        },
        manpower: {
            population: totals.manpowerPopulation,
            farms: totals.manpowerFarm,
            policyMult: totals.mods.manpowerMult,
            total: (totals.manpowerPopulation + totals.manpowerFarm) * totals.mods.manpowerMult,
            cap: MANPOWER_BASE_CAP + MANPOWER_CAP_PER_POP * totals.effectivePopulation,
        },
        industry: {
            cities: totals.industryCities,
            factories: totals.industryFactory,
            infrastructure: totals.industryInfrastructure,
            policyMult: totals.mods.industryMult,
            total: (totals.industryCities + totals.industryFactory + totals.industryInfrastructure)
                * totals.mods.industryMult,
            cap: INDUSTRY_BASE_CAP + INDUSTRY_CAP_PER_CITY * totals.effectiveCities,
        },
        political: {
            base: 2,
            admin: totals.adminActive,
            policy: totals.mods.ppModifier,
            total: 2 + totals.adminActive + totals.mods.ppModifier,
        },
    };
}

export function occupationGrowth(state: GameState, province: Province, nationId: number): number {
    if (province.coreNation === nationId) return 0;
    return OCCUPATION_BASE_GROWTH * policyModifiers(state.nations[nationId], state.day).growthMult;
}

export function clampResources(nation: Nation, rates: ResourceRates): void {
    nation.manpower = Math.min(nation.manpower, rates.manpowerCap);
    nation.industry = Math.min(nation.industry, rates.industryCap);
    nation.politicalPower = Math.min(nation.politicalPower, PP_CAP);
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
