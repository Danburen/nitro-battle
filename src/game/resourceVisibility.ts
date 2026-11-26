/** Shared intel rules for how much of another nation's economy the player can see. */

import { t } from "../i18n/index.ts";
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
    get funds() { return t("game.resourceVisibility.funds"); },
    get manpower() { return t("game.resourceVisibility.manpower"); },
    get industry() { return t("game.resourceVisibility.industry"); },
    get raw() { return t("game.resourceVisibility.raw"); },
    get food() { return t("game.resourceVisibility.food"); },
    get strategic() { return t("game.resourceVisibility.strategic"); },
    get politics() { return t("game.resourceVisibility.politics"); },
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
    return { mode: "exact", label: t("game.resourceVisibility.exact"), reason };
}

function hidden(mode: "surplus" | "shortage" | "unknown", reason: string): ResourceVisibility {
    const label = mode === "surplus" ? t("game.resourceVisibility.surplus")
        : mode === "shortage" ? t("game.resourceVisibility.shortage") : t("game.resourceVisibility.unknown");
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
    if (observerId === targetId) return exact(t("game.resourceVisibility.reason.own"));

    const target = state.nations[targetId];
    if (!target?.alive) return hidden("unknown", t("game.resourceVisibility.reason.dead"));
    if (isAtWar(state, observerId, targetId)) {
        return hidden("unknown", t("game.resourceVisibility.reason.war", { resource: RESOURCE_LABEL[resource] }));
    }

    if (inSameAlliance(state, observerId, targetId)) return exact(t("game.resourceVisibility.reason.alliance"));
    if (overlordOf(state, observerId) === targetId || overlordOf(state, targetId) === observerId) {
        return exact(t("game.resourceVisibility.reason.vassal"));
    }
    if (hasTradeAgreement(state, observerId, targetId)) return exact(t("game.resourceVisibility.reason.trade"));
    if (target.tendency === "trader") return exact(t("game.resourceVisibility.reason.trader"));

    const reason = t("game.resourceVisibility.reason.trend", { resource: RESOURCE_LABEL[resource] });
    if (net === undefined) return hidden("unknown", t("game.resourceVisibility.reason.noNet", { reason }));
    if (net > SURPLUS_THRESHOLD) return hidden("surplus", reason);
    if (net < -SURPLUS_THRESHOLD) return hidden("shortage", reason);
    return hidden("unknown", t("game.resourceVisibility.reason.balanced", { reason }));
}
