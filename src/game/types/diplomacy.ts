/** War goals, diplomatic actions, vassal contracts, alliances, requests and AI willingness decisions. */

import type { TradeKind, TradeTransfer } from "./trade.ts";

export type WarGoalKind = "conquest" | "annex";
export type DiplomaticActionKind = WarGoalKind;

export interface StateClaim {
    nation: number;
    stateId: number;
}

export interface DiplomaticAction {
    id: number;
    nation: number;
    target: number;
    kind: DiplomaticActionKind;
    stateId: number | null;
    startedDay: number;
    readyDay: number;
    expiresDay: number;
    upkeepSpent?: number;
}

export interface War {
    aggressor: number;
    defender: number;
    goal: WarGoalKind;
    stateId: number | null;
    targetSites: number[];
    startedDay: number;
}

/** Three vassal contracts; their full player-facing rules live in `vassal.ts`. */
export type VassalType = "cooperative" | "autonomous" | "oppressive";

/** A one-leader defensive/offensive camp. Membership is unique per nation. */
export interface Alliance {
    readonly id: number;
    leader: number;
    readonly members: number[];
    readonly createdDay: number;
}

export type DiplomaticRequestKind = "vassalize" | "alliance" | "aid" | "upgrade" | "call" | "trade";

/** A pending offer addressed to the player; AI-to-AI offers resolve immediately. */
export interface DiplomaticRequest {
    readonly id: number;
    readonly kind: DiplomaticRequestKind;
    readonly from: number;
    readonly to: number;
    readonly vassalType?: VassalType;
    readonly allianceId?: number;
    /** Enemy of the overlord for a call-to-arms request. */
    readonly enemy?: number;
    /** A coercive vassal demand: `from` is the overlord, `to` the would-be vassal. */
    readonly demand?: boolean;
    /** Trade proposal attached to a `trade` request, oriented from proposer (`from`) to receiver (`to`). */
    readonly tradeKind?: TradeKind;
    readonly tradeGive?: readonly TradeTransfer[];
    readonly tradeReceive?: readonly TradeTransfer[];
    readonly tradeDays?: number;
    /** Set on player proposals: the target answers on this day, never on confirm. */
    readonly resolveDay?: number;
    readonly createdDay: number;
    readonly expiresDay: number;
}
