import type { DiplomaticRequest, DiplomaticRequestKind, VassalType } from "./types/diplomacy.ts";
import type { GameState } from "./types/state.ts";

/** Pending offers expire after ten days; a rejection also starts a longer cooldown. */
export const DIPLOMATIC_REQUEST_DAYS = 10;

function living(state: GameState, nation: number): boolean {
    return Number.isInteger(nation) && nation >= 0 && state.nations[nation]?.alive === true;
}

/** One pending offer per (kind, from, to); AI-to-AI offers usually resolve without one. */
export function createDiplomaticRequest(
    state: GameState, kind: DiplomaticRequestKind, from: number, to: number,
    extra: { vassalType?: VassalType; allianceId?: number; demand?: boolean; enemy?: number } = {},
): DiplomaticRequest | null {
    if (!living(state, from) || !living(state, to) || from === to || state.winner !== null) return null;
    if (state.diplomaticRequests.some((request) =>
        request.kind === kind && request.from === from && request.to === to)) return null;
    const request: DiplomaticRequest = {
        id: state.nextRequestId++, kind, from, to,
        vassalType: extra.vassalType, allianceId: extra.allianceId, demand: extra.demand, enemy: extra.enemy,
        createdDay: state.day, expiresDay: state.day + DIPLOMATIC_REQUEST_DAYS,
    };
    state.diplomaticRequests.push(request);
    return request;
}
