/** Policy categories, their values, transitions and stat tables. */

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
    balanced: { name: "平衡", desc: "无修正", fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    market: { name: "自由市场", desc: "[[funds:+20%]]，[[industry:-10%]]", fundsMult: 1.2, industryMult: 0.9, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    planned: { name: "国家计划", desc: "[[industry:+20%]]，[[funds:-10%]]", fundsMult: 0.9, industryMult: 1.2, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
};

export const CONSCRIPTION_POLICIES: Readonly<Record<ConscriptionPolicy, { name: string; desc: string } & PolicyModifiers>> = {
    volunteer: { name: "志愿兵", desc: "[[manpower:-20%]]，[[funds:+10%]]", fundsMult: 1.1, industryMult: 1, manpowerMult: 0.8, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    service: { name: "义务兵", desc: "[[manpower:+10%]]，[[funds:-5%]]", fundsMult: 0.95, industryMult: 1, manpowerMult: 1.1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    total: { name: "全面动员", desc: "[[manpower:+30%]]，[[funds:-15%]]，[[occupation]]增长 -20%", fundsMult: 0.85, industryMult: 1, manpowerMult: 1.3, growthMult: 0.8, occupiedIncomeMult: 1, ppModifier: 0 },
};

export const OCCUPATION_POLICIES: Readonly<Record<OccupationPolicy, { name: string; desc: string } & PolicyModifiers>> = {
    lenient: { name: "宽容", desc: "[[occupation]]增长 +50%，占领省税收 [[funds:-20%]]", fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1.5, occupiedIncomeMult: 0.8, ppModifier: 0 },
    balanced: { name: "均衡", desc: "无修正", fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 1, occupiedIncomeMult: 1, ppModifier: 0 },
    harsh: { name: "严苛", desc: "占领省税收 [[funds:+30%]]，[[occupation]]增长 -50%，[[politics:-1]]/[[turn]]", fundsMult: 1, industryMult: 1, manpowerMult: 1, growthMult: 0.5, occupiedIncomeMult: 1.3, ppModifier: -1 },
};

export const DEFAULT_POLICIES: Policies = { economy: "balanced", conscription: "volunteer", occupation: "balanced" };

/** Upfront political points paid when a policy switch begins. */
export const POLICY_SWITCH_COST = 8;
/** Turns a policy switch takes before the new policy is committed. */
export const POLICY_SWITCH_DAYS = 3;
/** Daily political upkeep while a policy switch is in progress. */
export const POLICY_SWITCH_UPKEEP = 3;
