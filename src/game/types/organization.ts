/** Province armies, regiments and deployment orders. */
import type { UnitKind } from "./unit.ts";

export const ORG_MAX = 100;
/** Org of a freshly deployed army / newly merged regiments. */
export const DEPLOY_ORG = 50;
export const START_ORG = 80;
/** Org recovered per day at full supply. */
export const ORG_REGEN = 9;
/** An army at or below this org breaks off and retreats. */
export const ORG_BREAK = 15;
export const REDEPLOY_ORG = 20;
export const UNPAID_UPKEEP_ORG_PENALTY = 5;
export const REINFORCE_MIN_SUPPLY = 0.5;

/** One small unit inside an army. Has no independent position. */
export interface Regiment {
    readonly id: number;
    readonly kind: UnitKind;
    hp: number;
}

/** Province troops: the only military entity, fixed to its province. */
export interface Army {
    readonly id: number;
    readonly nation: number;
    name: string;
    province: number;
    regiments: Regiment[];
    org: number;
}

export type DeploymentStatus = "training" | "ready" | "blocked";

export interface DeploymentOrder {
    readonly id: number;
    readonly nation: number;
    readonly kind: UnitKind;
    daysLeft: number;
    destination: number | null;
    readonly paidFunds: number;
    readonly paidManpower: number;
    readonly paidIndustry: number;
    status: DeploymentStatus;
    readonly createdDay: number;
}

