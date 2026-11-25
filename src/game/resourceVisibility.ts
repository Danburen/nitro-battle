/** Shared intel rules for how much of another nation's economy the player can see. */

import { inSameAlliance, overlordOf } from "./access.ts";
import { isAtWar } from "./diplomacy.ts";
import type { ResourceRates } from "./economy.ts";
import type { GameState } from "./types/state.ts";
import type { TradeResource } from "./types/trade.ts";

/** Exact numbers, or the qualitative hints left when the numbers are hidden. */
export type ResourceVisibilityMode = "exact" | "surplus" | "shortage" | "unknown";

export interface ResourceVisibility {
    readonly mode: ResourceVisibilityMode;
    /** Short player-facing hint used in cells and chips. */
    readonly label: string;
    /** Tooltip explanation for why this level of detail is available. */
    readonly reason: string;
}

const SURPLUS_THRESHOLD = 0.05;

const RESOURCE_LABEL: Readonly<Record<TradeResource | "politics", string>> = {
    funds: "财政",
    manpower: "人力",
    industry: "工业",
    raw: "原料",
    food: "粮食",
    strategic: "战略资源",
    politics: "政治点",
};

/** Net daily rate for a tradable resource, matching the trade panel's old local helper. */
export function tradeResourceRate(rates: ResourceRates, resource: TradeResource): number {
    switch (resource) {
        case "funds": return rates.fundsNet;
        case "manpower": return rates.manpower;
        case "industry": return rates.industryNet;
        case "raw": return rates.raw;
        case "food": return rates.food;
        case "strategic": return rates.strategic;
    }
}

function exact(reason: string): ResourceVisibility {
    return { mode: "exact", label: "具体数据", reason };
}

function hidden(mode: "surplus" | "shortage" | "unknown", reason: string): ResourceVisibility {
    const label = mode === "surplus" ? "有盈余" : mode === "shortage" ? "短缺" : "未知";
    return { mode, label, reason };
}

function hasTradeAgreement(state: GameState, a: number, b: number): boolean {
    return state.tradeAgreements.some((agreement) =>
        agreement.expiresDay >= state.day
        && ((agreement.from === a && agreement.to === b) || (agreement.from === b && agreement.to === a)));
}

/**
 * Visibility is a relation, not a difficulty slider: own data, allies, the
 * overlord/vassal pair, active trade partners and trade-minded nations show
 * exact figures. Enemies reveal nothing; everyone else only sees a trend.
 */
export function resourceVisibility(
    state: GameState, observerId: number, targetId: number, resource: TradeResource | "politics", net?: number,
): ResourceVisibility {
    if (observerId === targetId) return exact("己方资源完全可见");

    const target = state.nations[targetId];
    if (!target?.alive) return hidden("unknown", "目标国家已灭亡，资源情报失效");
    if (isAtWar(state, observerId, targetId)) return hidden("unknown", `交战国家隐藏${RESOURCE_LABEL[resource]}数据`);

    if (inSameAlliance(state, observerId, targetId)) return exact("盟友之间共享资源数据");
    if (overlordOf(state, observerId) === targetId || overlordOf(state, targetId) === observerId) {
        return exact("宗主国与附庸之间共享资源数据");
    }
    if (hasTradeAgreement(state, observerId, targetId)) return exact("有效贸易条约的伙伴共享资源数据");
    if (target.tendency === "trader") return exact("该国以贸易立国，公开资源数据");

    const reason = `${RESOURCE_LABEL[resource]}方面，对方不是贸易型国家，也不与你结盟、附庸或有贸易往来，只能判断趋势`;
    if (net === undefined) return hidden("unknown", `${reason}；缺少净变化数据`);
    if (net > SURPLUS_THRESHOLD) return hidden("surplus", reason);
    if (net < -SURPLUS_THRESHOLD) return hidden("shortage", reason);
    return hidden("unknown", `${reason}；净变化接近平衡`);
}
