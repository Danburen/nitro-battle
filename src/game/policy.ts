import type { GameCore } from "./core.ts";
import { POLICY_SWITCH_COST } from "./types.ts";
import type { ConscriptionPolicy, EconomyPolicy, OccupationPolicy } from "./types.ts";

export function setPolicy(core: GameCore, category: "economy" | "conscription" | "occupation", value: string): boolean {
    const state = core.state;
    const nation = state.nations[0];
    if (state.winner !== null || !nation.alive) return false;
    if (nation.policies[category] === value) return false;
    if (nation.politicalPower < POLICY_SWITCH_COST) return false;
    nation.politicalPower -= POLICY_SWITCH_COST;
    if (category === "economy") nation.policies.economy = value as EconomyPolicy;
    else if (category === "conscription") nation.policies.conscription = value as ConscriptionPolicy;
    else nation.policies.occupation = value as OccupationPolicy;
    core.log(`${core.nationChip(0)} 切换${category === "economy" ? "经济" : category === "conscription" ? "兵役" : "占领"}政策`, "diplo", 0);
    core.emit({ type: "state" });
    return true;
}