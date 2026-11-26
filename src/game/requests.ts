import { t } from "../i18n/index.ts";
import type { DiplomaticRequest, DiplomaticRequestKind, VassalType } from "./types/diplomacy.ts";
import type { TradeKind, TradeTransfer } from "./types/trade.ts";
import type { GameState } from "./types/state.ts";

/** Pending offers expire after five days; player proposals are answered on the next turn. */
export const DIPLOMATIC_REQUEST_DAYS = 5;
/** Rejecting a request type locks that same type against the nation for five turns. */
export const REQUEST_COOLDOWN_DAYS = 5;

export const REQUEST_LABEL: Readonly<Record<DiplomaticRequestKind, string>> = {
    get vassalize() { return t("game.requests.vassalize"); },
    get alliance() { return t("game.requests.alliance"); },
    get aid() { return t("game.requests.aid"); },
    get upgrade() { return t("game.requests.upgrade"); },
    get call() { return t("game.requests.call"); },
    get trade() { return t("game.requests.trade"); },
};

const REQUEST_KINDS = ["vassalize", "alliance", "aid", "upgrade", "call", "trade"] as const satisfies readonly DiplomaticRequestKind[];

/** Fresh -1 matrices for every request type; world generation and fixtures share this. */
export function createRequestCooldown(nationCount: number): Record<DiplomaticRequestKind, number[][]> {
    return Object.fromEntries(REQUEST_KINDS.map((kind) => [
        kind, Array.from({ length: nationCount }, () => Array.from({ length: nationCount }, () => -1)),
    ])) as Record<DiplomaticRequestKind, number[][]>;
}

function living(state: GameState, nation: number): boolean {
    return Number.isInteger(nation) && nation >= 0 && state.nations[nation]?.alive === true;
}

/** One pending offer per (kind, from, to); AI-to-AI offers usually resolve without one. */
export function createDiplomaticRequest(
    state: GameState, kind: DiplomaticRequestKind, from: number, to: number,
    extra: {
        vassalType?: VassalType; allianceId?: number; demand?: boolean; enemy?: number;
        tradeKind?: TradeKind; tradeGive?: readonly TradeTransfer[]; tradeReceive?: readonly TradeTransfer[];
        tradeDays?: number; resolveDay?: number;
    } = {},
): DiplomaticRequest | null {
    if (!living(state, from) || !living(state, to) || from === to || state.winner !== null) return null;
    if (state.diplomaticRequests.some((request) =>
        request.kind === kind && request.from === from && request.to === to)) return null;
    const request: DiplomaticRequest = {
        id: state.nextRequestId++, kind, from, to,
        vassalType: extra.vassalType, allianceId: extra.allianceId, demand: extra.demand, enemy: extra.enemy,
        tradeKind: extra.tradeKind, tradeGive: extra.tradeGive, tradeReceive: extra.tradeReceive,
        tradeDays: extra.tradeDays, resolveDay: extra.resolveDay,
        createdDay: state.day, expiresDay: state.day + DIPLOMATIC_REQUEST_DAYS,
    };
    state.diplomaticRequests.push(request);
    return request;
}

/** Queue a player proposal; the answer is resolved at the next turn boundary. */
export function queuePlayerProposal(
    state: GameState, kind: DiplomaticRequestKind, from: number, to: number,
    extra: Parameters<typeof createDiplomaticRequest>[4] = {},
): DiplomaticRequest | null {
    return createDiplomaticRequest(state, kind, from, to, { ...extra, resolveDay: state.day + 1 });
}

/** Remaining turns before this request type may be sent to the nation again. */
export function requestCooldownDays(state: GameState, kind: DiplomaticRequestKind, nationId: number): number {
    const until = state.requestCooldown[kind]?.[0]?.[nationId] ?? -1;
    return Math.max(0, until - state.day);
}

/** Symmetric cooldown: the player and the nation both remember the rejection. */
export function setRequestCooldown(
    state: GameState, kind: DiplomaticRequestKind, nationId: number, days = REQUEST_COOLDOWN_DAYS,
): void {
    const matrix = state.requestCooldown[kind];
    if (!matrix || matrix[0]?.[nationId] === undefined) return;
    matrix[0][nationId] = state.day + days;
    if (matrix[nationId]?.[0] !== undefined) matrix[nationId][0] = state.day + days;
}
