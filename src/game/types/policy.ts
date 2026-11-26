/** Policy categories, their values, transitions and stat tables. */

import { t } from "../../i18n/index.ts";

export type EconomyPolicy = "balanced" | "market" | "planned";
export type ConscriptionPolicy = "volunteer" | "service" | "total";
export type OccupationPolicy = "lenient" | "balanced" | "harsh";
export type PolicyCategory = "economy" | "conscription" | "occupation";

export interface Policies {
    economy: EconomyPolicy;
    conscription: ConscriptionPolicy;
    occupation: OccupationPolicy;
}

/** A policy switch in progress: gain modifiers ramp from `from` toward `to` over `readyDay - startedDay`. */
export interface PolicyTransition {
    readonly category: PolicyCategory;
    readonly from: string;
    readonly to: string;
    readonly startedDay: number;
    readonly readyDay: number;
    upkeepSpent: number;
}

export interface PolicyModifiers {
    fundsMult: number;
    industryMult: number;
    manpowerMult: number;
    growthMult: number;
    occupiedIncomeMult: number;
    ppModifier: number;
}

export const ECONOMY_POLICIES: Readonly<Record<EconomyPolicy, { name: string; desc: string } & PolicyModifiers>> = {
    balanced: {
        get name() { return t("game.types.policy.economy.balanced.name"); },
        get desc() { return t("game.types.policy.economy.balanced.desc"); },
        fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0,
    },
    market: {
        get name() { return t("game.types.policy.economy.market.name"); },
        get desc() { return t("game.types.policy.economy.market.desc"); },
        fundsMult: 1.2, industryMult: 0.9, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0,
    },
    planned: {
        get name() { return t("game.types.policy.economy.planned.name"); },
        get desc() { return t("game.types.policy.economy.planned.desc"); },
        fundsMult: 0.9, industryMult: 1.2, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0,
    },
};

export const CONSCRIPTION_POLICIES: Readonly<Record<ConscriptionPolicy, {
    name: string; desc: string; recruitableShare: number; stabilityTarget: number;
} & PolicyModifiers>> = {
    volunteer: {
        get name() { return t("game.types.policy.conscription.volunteer.name"); },
        get desc() { return t("game.types.policy.conscription.volunteer.desc"); },
        recruitableShare: 0.01, stabilityTarget: 0,
        fundsMult: 1.1, industryMult: 1, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0,
    },
    service: {
        get name() { return t("game.types.policy.conscription.service.name"); },
        get desc() { return t("game.types.policy.conscription.service.desc"); },
        recruitableShare: 0.03, stabilityTarget: -5,
        fundsMult: 0.95, industryMult: 1, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0,
    },
    total: {
        get name() { return t("game.types.policy.conscription.total.name"); },
        get desc() { return t("game.types.policy.conscription.total.desc"); },
        recruitableShare: 0.05, stabilityTarget: -10,
        fundsMult: 0.85, industryMult: 1, manpowerMult: 1, growthMult: 0.8, occupiedIncomeMult: 1, ppModifier: 0,
    },
};

export const OCCUPATION_POLICIES: Readonly<Record<OccupationPolicy, { name: string; desc: string } & PolicyModifiers>> = {
    lenient: {
        get name() { return t("game.types.policy.occupation.lenient.name"); },
        get desc() { return t("game.types.policy.occupation.lenient.desc"); },
        fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1.5, occupiedIncomeMult: 0.8, ppModifier: 0,
    },
    balanced: {
        get name() { return t("game.types.policy.occupation.balanced.name"); },
        get desc() { return t("game.types.policy.occupation.balanced.desc"); },
        fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0,
    },
    harsh: {
        get name() { return t("game.types.policy.occupation.harsh.name"); },
        get desc() { return t("game.types.policy.occupation.harsh.desc"); },
        fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 0.5, occupiedIncomeMult: 1.3, ppModifier: -1,
    },
};

export const DEFAULT_POLICIES: Policies = { economy: "balanced", conscription: "service", occupation: "balanced" };

/** Upfront political points paid when a policy switch begins. */
export const POLICY_SWITCH_COST = 8;
/** Turns a policy switch takes before the new policy is committed. */
export const POLICY_SWITCH_DAYS = 3;
/** Daily political upkeep while a policy switch is in progress. */
export const POLICY_SWITCH_UPKEEP = 3;
