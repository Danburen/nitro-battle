/** Player proposals are answered at the next turn boundary, never on confirm. */

import type { GameCore } from "./core.ts";
import { decideAllianceInvite, decideJoinRequest } from "./alliance.ts";
import { decideTrade, TRADE_AGREEMENT_DAYS } from "./trade.ts";
import { acceptDiplomaticRequest, decideAid, decideUpgrade, decideVassalDemand, decideVassalOffer } from "./vassal.ts";
import { REQUEST_COOLDOWN_DAYS, REQUEST_LABEL, setRequestCooldown } from "./requests.ts";
import type { DiplomaticDecision } from "./types/decision.ts";
import type { DiplomaticRequest } from "./types/diplomacy.ts";

/** Re-run the same willingness rules the immediate AI path would have used. */
function decisionFor(request: DiplomaticRequest, core: GameCore): DiplomaticDecision | null {
    const state = core.state;
    switch (request.kind) {
        case "trade":
            if (!request.tradeKind || !request.tradeGive || !request.tradeReceive) return null;
            return decideTrade(state, request.to, request.from, {
                kind: request.tradeKind, give: request.tradeGive, receive: request.tradeReceive,
            }, request.tradeDays ?? TRADE_AGREEMENT_DAYS);
        case "alliance":
            return request.to === 0
                ? decideJoinRequest(state, request.from, 0)
                : decideAllianceInvite(state, 0, request.to);
        case "vassalize":
            return request.demand
                ? decideVassalDemand(state, request.from, request.to)
                : decideVassalOffer(state, request.to, request.from, request.vassalType ?? "cooperative");
        case "aid":
            return decideAid(state, request.from, request.to);
        case "upgrade":
            return decideUpgrade(state, request.to, request.from);
        default:
            return null;
    }
}

function targetOf(request: DiplomaticRequest): number {
    return request.from === 0 ? request.to : request.from;
}

function decline(core: GameCore, request: DiplomaticRequest): void {
    const state = core.state;
    const targetId = targetOf(request);
    setRequestCooldown(state, request.kind, targetId, REQUEST_COOLDOWN_DAYS);
    if (request.kind === "aid" && state.nations[0]) state.nations[0].lastAidDay = state.day;
    core.log(`${core.nationChip(targetId)} 拒绝 ${core.nationChip(0)} 的${REQUEST_LABEL[request.kind]}`, "diplo", targetId);
    core.emit({ type: "state" });
}

/** Resolve every proposal whose answer fell due on this day. */
export function resolvePlayerProposals(core: GameCore): void {
    const state = core.state;
    for (let i = state.diplomaticRequests.length - 1; i >= 0; i--) {
        const request = state.diplomaticRequests[i];
        if (request.resolveDay === undefined || state.day < request.resolveDay) continue;
        state.diplomaticRequests.splice(i, 1);
        const targetId = targetOf(request);
        if (!state.nations[0]?.alive || !state.nations[targetId]?.alive) continue;
        const decision = decisionFor(request, core);
        if (decision?.accepts && acceptDiplomaticRequest(core, request)) {
            core.log(`${core.nationChip(0)} 与 ${core.nationChip(targetId)} 达成${REQUEST_LABEL[request.kind]}`, "diplo", targetId);
            continue;
        }
        decline(core, request);
    }
}
