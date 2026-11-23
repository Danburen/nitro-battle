import type { GameCore } from "./core.ts";
import { CONSCRIPTION_POLICIES, ECONOMY_POLICIES, OCCUPATION_POLICIES, POLICY_SWITCH_COST, POLICY_SWITCH_DAYS, POLICY_SWITCH_UPKEEP } from "./types/policy.ts";
import type { ConscriptionPolicy, EconomyPolicy, OccupationPolicy, PolicyCategory, PolicyModifiers, PolicyTransition } from "./types/policy.ts";
import type { Nation } from "./types/entities.ts";

type PolicyOption = PolicyModifiers & { readonly name: string; readonly desc: string };

export const POLICY_LABELS: Readonly<Record<PolicyCategory, string>> = {
    economy: "经济",
    conscription: "兵役",
    occupation: "占领",
};

const NO_MODIFIERS: PolicyModifiers = {
    fundsMult: 1,
    industryMult: 1,
    manpowerMult: 1,
    growthMult: 1,
    occupiedIncomeMult: 1,
    ppModifier: 0,
};

function optionTable(category: PolicyCategory): Readonly<Record<string, PolicyOption>> {
    if (category === "economy") return ECONOMY_POLICIES as Readonly<Record<string, PolicyOption>>;
    if (category === "conscription") return CONSCRIPTION_POLICIES as Readonly<Record<string, PolicyOption>>;
    return OCCUPATION_POLICIES as Readonly<Record<string, PolicyOption>>;
}

export function policyOption(category: PolicyCategory, value: string): PolicyOption | undefined {
    return optionTable(category)[value];
}

export function policyTransitionProgress(transition: PolicyTransition, day: number): number {
    const span = Math.max(1, transition.readyDay - transition.startedDay);
    return Math.max(0, Math.min(1, (day - transition.startedDay) / span));
}

function blend(from: PolicyModifiers, to: PolicyModifiers, t: number): PolicyModifiers {
    const mix = (a: number, b: number): number => a + (b - a) * t;
    return {
        fundsMult: mix(from.fundsMult, to.fundsMult),
        industryMult: mix(from.industryMult, to.industryMult),
        manpowerMult: mix(from.manpowerMult, to.manpowerMult),
        growthMult: mix(from.growthMult, to.growthMult),
        occupiedIncomeMult: mix(from.occupiedIncomeMult, to.occupiedIncomeMult),
        ppModifier: mix(from.ppModifier, to.ppModifier),
    };
}

/** One category's live modifiers: the committed policy blended toward a pending target. */
export function categoryModifiers(nation: Nation, category: PolicyCategory, day: number): PolicyModifiers {
    const current = optionTable(category)[nation.policies[category]] ?? NO_MODIFIERS;
    const transition = nation.policyTransitions?.[category];
    if (!transition) return current;
    const target = optionTable(category)[transition.to];
    if (!target) return current;
    return blend(current, target, policyTransitionProgress(transition, day));
}

export function policyModifiers(nation: Nation, day: number): PolicyModifiers {
    const economy = categoryModifiers(nation, "economy", day);
    const conscription = categoryModifiers(nation, "conscription", day);
    const occupation = categoryModifiers(nation, "occupation", day);
    return {
        fundsMult: economy.fundsMult * conscription.fundsMult,
        industryMult: economy.industryMult,
        manpowerMult: conscription.manpowerMult,
        growthMult: occupation.growthMult * conscription.growthMult,
        occupiedIncomeMult: occupation.occupiedIncomeMult,
        ppModifier: occupation.ppModifier,
    };
}

export function startPolicySwitch(core: GameCore, category: PolicyCategory, value: string): boolean {
    const state = core.state;
    const nation = state.nations[0];
    if (state.winner !== null || !nation.alive) return false;
    if (nation.policies[category] === value) return false;
    if (!policyOption(category, value)) return false;
    if (nation.policyTransitions?.[category]) return false;
    if (nation.politicalPower < POLICY_SWITCH_COST) return false;
    nation.politicalPower -= POLICY_SWITCH_COST;
    nation.policyTransitions = {
        ...nation.policyTransitions,
        [category]: {
            category,
            from: nation.policies[category],
            to: value,
            startedDay: state.day,
            readyDay: state.day + POLICY_SWITCH_DAYS,
            upkeepSpent: 0,
        },
    };
    core.log(`${core.nationChip(0)} 开始切换${POLICY_LABELS[category]}政策`, "system", 0);
    core.emit({ type: "state" });
    return true;
}

/** Cancelling returns to the old policy; upfront cost and daily upkeep already spent are kept. */
export function cancelPolicySwitch(core: GameCore, category: PolicyCategory): boolean {
    const state = core.state;
    const nation = state.nations[0];
    const transition = nation?.policyTransitions?.[category];
    if (state.winner !== null || !transition) return false;
    const next = { ...nation.policyTransitions };
    delete next[category];
    nation.policyTransitions = next;
    core.log(`${core.nationChip(0)} 取消切换${POLICY_LABELS[category]}政策（政治点不返还）`, "system", 0);
    core.emit({ type: "state" });
    return true;
}

/** Commit switches whose ramp has run its course; called at the start of a new day. */
export function advancePolicySwitches(core: GameCore): void {
    const state = core.state;
    const nation = state.nations[0];
    const transitions = nation?.policyTransitions;
    if (!transitions) return;
    let changed = false;
    for (const category of Object.keys(transitions) as PolicyCategory[]) {
        const transition = transitions[category];
        if (!transition || state.day < transition.readyDay) continue;
        const next = { ...nation.policyTransitions };
        delete next[category];
        nation.policyTransitions = next;
        if (category === "economy") nation.policies.economy = transition.to as EconomyPolicy;
        else if (category === "conscription") nation.policies.conscription = transition.to as ConscriptionPolicy;
        else nation.policies.occupation = transition.to as OccupationPolicy;
        const name = policyOption(category, transition.to)?.name ?? transition.to;
        core.log(`${core.nationChip(0)} ${POLICY_LABELS[category]}政策生效：${name}`, "system", 0);
        changed = true;
    }
    if (changed) core.emit({ type: "state" });
}

/** Daily political upkeep for switches still ramping; completion day is free. */
export function tickPolicyUpkeep(core: GameCore): void {
    const state = core.state;
    const nation = state.nations[0];
    if (!nation?.alive) return;
    for (const transition of Object.values(nation.policyTransitions ?? {})) {
        if (!transition || state.day >= transition.readyDay) continue;
        const paid = Math.min(nation.politicalPower, POLICY_SWITCH_UPKEEP);
        nation.politicalPower -= paid;
        transition.upkeepSpent += paid;
    }
}

/** Political upkeep currently owed by in-progress switches, for UI breakdowns. */
export function policySwitchUpkeep(nation: Nation): number {
    return Object.values(nation.policyTransitions ?? {}).filter((transition) => transition !== undefined).length
        * POLICY_SWITCH_UPKEEP;
}