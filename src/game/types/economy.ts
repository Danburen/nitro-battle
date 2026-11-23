/** Resource caps, production, occupation and supply constants/data. */

export const START_FUNDS = 300;
export const START_MANPOWER = 500;
export const START_INDUSTRY = 30;
export const START_PP = 20;
export const MANPOWER_BASE_CAP = 500;
export const MANPOWER_CAP_PER_POP = 5;
export const INDUSTRY_BASE_CAP = 100;
export const INDUSTRY_CAP_PER_CITY = 5;
export const PP_CAP = 100;

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
