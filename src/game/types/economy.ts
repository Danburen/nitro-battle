/** Resource caps, production, occupation and supply constants/data. */
import { Biome } from "../terrain/biome.ts";

export const START_FUNDS = 300;
export const START_MANPOWER = 500;
export const START_INDUSTRY = 30;
export const START_PP = 20;
export const START_STABILITY = 65;
export const INDUSTRY_BASE_CAP = 100;
export const INDUSTRY_CAP_PER_CITY = 5;
export const PP_CAP = 100;

/** One population point on the map stands for this many people in hover/detail text. */
export const POPULATION_PER_POINT = 10000;
/** One manpower unit (training cost, stock, intake) stands for this many people. */
export const MANPOWER_PER_POINT = 100;
/** Field-troop units each population point supports under full mobilization. */
export const ARMY_UNITS_PER_POP = 8;
/** Eligible manpower units per population point at a 100% recruitment share. */
export const ELIGIBLE_PER_POP = 100;
/** Occupied population counts this fraction of its share (scaled by occupation). */
export const OCCUPIED_POP_FACTOR = 0.1;
/** Daily intake as a share of the eligible ceiling, before the stability modifier. */
export const MANPOWER_INTAKE_RATE = 0.06;

/** Stability: 0–100, drifts toward a target derived from war, occupation and food. */
export const STABILITY_DRIFT = 1.2;
export const STABILITY_WAR_SHIFT = 4;
export const STABILITY_PEACE_SHIFT = 5;
export const STABILITY_DECLARATION_SHIFT = 4;
export const STABILITY_BASE = 55;
export const STABILITY_ADMIN_BONUS = 1.5;
export const STABILITY_ADMIN_CAP = 15;
export const STABILITY_WAR_PENALTY = 5;
export const STABILITY_OCCUPIED_PENALTY = 0.3;
export const STABILITY_OCCUPIED_CAP = 10;
export const STABILITY_FOOD_SURPLUS = 5;
export const STABILITY_FOOD_SHORTAGE = 10;
/** Production multiplier at 0 stability, rising by the range toward 100. */
export const STABILITY_PRODUCTION_BASE = 0.8;
export const STABILITY_PRODUCTION_RANGE = 0.2;
export const STABILITY_POLITICS_BASE = 0.5;
export const STABILITY_POLITICS_RANGE = 0.5;

/** Management-chain resources. `raw`/`strategic` are produced by province mines. */
export type ResourceKind = "raw" | "food" | "strategic";

export const START_RESOURCES: Readonly<Record<ResourceKind, number>> = {
    raw: 20,
    food: 60,
    strategic: 10,
};

export const RESOURCE_CAPS: Readonly<Record<ResourceKind, number>> = {
    raw: 200,
    food: 300,
    strategic: 100,
};

/** A deposit level contributes this much base output per day before modifiers. */
export const DEPOSIT_YIELD_PER_LEVEL = 1.5;
export const RESOURCE_DEPOSIT_MAX_LEVEL = 3;
/** Separate curve from factory output: 60% at level 0, +10% per infrastructure level. */
export const RESOURCE_INFRASTRUCTURE_BASE = 0.6;
export const RESOURCE_INFRASTRUCTURE_PER_LEVEL = 0.1;

export interface DepositRoll {
    /** Chance for one province of this biome to hold the deposit. */
    readonly chance: number;
    /** Relative weights for deposit levels 1 / 2 / 3. */
    readonly levelWeights: readonly [number, number, number];
}

export interface DepositBiomeRule {
    readonly raw: DepositRoll;
    readonly strategic: DepositRoll;
}

const NO_DEPOSIT: DepositRoll = { chance: 0, levelWeights: [0, 0, 0] };

/** Terrain-weighted deposit chances and richness; water never yields minerals. */
export const DEPOSIT_BIOME_RULES: Readonly<Record<Biome, DepositBiomeRule>> = {
    [Biome.OCEAN]: { raw: NO_DEPOSIT, strategic: NO_DEPOSIT },
    [Biome.LAKE]: { raw: NO_DEPOSIT, strategic: NO_DEPOSIT },
    [Biome.BEACH]: {
        raw: { chance: 0.08, levelWeights: [8, 2, 0] },
        strategic: { chance: 0.05, levelWeights: [9, 1, 0] },
    },
    [Biome.BARE]: {
        raw: { chance: 0.24, levelWeights: [5, 4, 1] },
        strategic: { chance: 0.18, levelWeights: [6, 3, 1] },
    },
    [Biome.ICE]: {
        raw: { chance: 0.06, levelWeights: [9, 1, 0] },
        strategic: { chance: 0.04, levelWeights: [10, 0, 0] },
    },
    [Biome.TUNDRA]: {
        raw: { chance: 0.14, levelWeights: [6, 3, 1] },
        strategic: { chance: 0.10, levelWeights: [7, 3, 0] },
    },
    [Biome.MOUNTAINS]: {
        raw: { chance: 0.46, levelWeights: [3, 5, 2] },
        strategic: { chance: 0.40, levelWeights: [3, 5, 2] },
    },
    [Biome.HILLS]: {
        raw: { chance: 0.40, levelWeights: [4, 4, 2] },
        strategic: { chance: 0.30, levelWeights: [4, 4, 2] },
    },
    [Biome.FOREST]: {
        raw: { chance: 0.12, levelWeights: [7, 3, 0] },
        strategic: { chance: 0.10, levelWeights: [8, 2, 0] },
    },
    [Biome.DESERT]: {
        raw: { chance: 0.22, levelWeights: [5, 4, 1] },
        strategic: { chance: 0.16, levelWeights: [6, 3, 1] },
    },
    [Biome.PLAINS]: {
        raw: { chance: 0.10, levelWeights: [8, 2, 0] },
        strategic: { chance: 0.06, levelWeights: [9, 1, 0] },
    },
    [Biome.MARSH]: {
        raw: { chance: 0.08, levelWeights: [8, 2, 0] },
        strategic: { chance: 0.14, levelWeights: [7, 3, 0] },
    },
};

/** Management-chain consumption and growth tuning (step 2). */
/** Raw units consumed per day by each production factory. */
export const RAW_PER_PROD_FACTORY = 0.4;
/** Strategic units consumed per day by each production factory. */
export const STRATEGIC_PER_PROD_FACTORY = 0.05;
/** Food produced per day per owned province and per farm (before infrastructure / occupation). */
export const FOOD_PER_PROVINCE = 0.5;
/** One farm feeds about as many people as a whole province of farmland. */
export const FOOD_PER_FARM = 0.5;
/** Food consumed per day per owned population point; regiments eat their unit profile upkeep. */
export const FOOD_PER_POPULATION = 0.15;
/** Production keeps at least 1% output when an input runs short (-99% cap). */
export const SHORTAGE_FACTOR_MIN = 0.01;
/** A daily food surplus above this share of gross production grants the growth bonus. */
export const FOOD_SURPLUS_RATIO = 0.25;
export const FOOD_SURPLUS_GROWTH_BONUS = 0.2;
/** Daily population gain for a well-fed core province, and the hard ceiling. */
export const POPULATION_GROWTH_BASE = 0.0015;
/** Full growth needs a food surplus worth this share of daily production. */
export const POPULATION_GROWTH_FOOD_RATIO = 0.1;
export const POPULATION_MAX = 10;
/** Daily population loss under total famine, scaled by how short the food is. */
export const POPULATION_DECLINE_BASE = 0.001;
/** Famine can shrink a province no further than its minimum starting population. */
export const POPULATION_MIN = 1;
/** Army organisation lost per day when strategic resources cannot cover upkeep. */
export const STRATEGIC_SHORTAGE_ORG_PENALTY = 1;

/** Per-turn output of one production factory, before infrastructure. */
export const FACTORY_PROD_FUNDS = 2;
export const FACTORY_PROD_INDUSTRY = 2;

export const OCCUPATION_BASE_GROWTH = 4;
export const OCCUPATION_FACTOR_MIN = 0.25;

export const SUPPLY_RANGE_CAPITAL = 14;
export const SUPPLY_RANGE_CITY = 10;
export const SUPPLY_RANGE_CENTER = 8;
export const SUPPLY_ORG_MIN_FACTOR = 0.5;
export const SUPPLY_ATTACK_MIN_FACTOR = 0.8;

export interface SupplyMap {
    /** Effective supply per province; infrastructure/centers may exceed 1. */
    level: Float32Array;
    /** 0 at a source, 1 at range edge, 2 when unreachable. */
    distance: Float32Array;
    sources: number[];
}
