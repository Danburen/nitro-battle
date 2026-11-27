import { GameCore } from "./core.ts";
import { clearProvinceTroops as clearProvinceTroopsOf, disbandRegiment, recruitRegiment, setProvinceStance as setProvinceStanceOf } from "./provinceArmy.ts";
import { cancelDiplomaticAction, claimState, cancelClaim, prepareDiplomaticAction, proposePeace, respondPeace, startWar } from "./diplomacy.ts";
import { annexVassal as annexVassalOf, enforceWarGoal } from "./settlement.ts";
import {
    adjustTributeRate as adjustTributeRateOf,
    changeVassalType as changeVassalTypeOf,
    demandVassalization as demandVassalizationOf,
    releaseVassal as releaseVassalOf,
    requestForeignAid as requestForeignAidOf,
    requestVassalization as requestVassalizationOf,
    requestVassalUpgrade as requestVassalUpgradeOf,
    respondDiplomaticRequest as respondDiplomaticRequestOf,
} from "./vassal.ts";
import {
    createAlliance as createAllianceOf,
    inviteToAlliance as inviteToAllianceOf,
    leaveAlliance as leaveAllianceOf,
    requestJoinAlliance as requestJoinAllianceOf,
} from "./alliance.ts";
import { cancelPolicySwitch, startPolicySwitch } from "./policy.ts";
import { proposeTrade as proposeTradeOf } from "./trade.ts";
import {
    cancelBuild,
    cancelTrain,
    enqueueBuild,
    enqueueProvinceBuild,
    enqueueTrain,
    reorderConstruction,
    setFactoryProduction,
    setTrainDestination,
} from "./production.ts";
import { endTurn } from "./turn.ts";
import type { ProvinceStance } from "./types/entities.ts";
import type { StateBuildingKind, ProvinceBuildingKind } from "./types/building.ts";
import type { DiplomaticActionKind, VassalType } from "./types/diplomacy.ts";
import type { GameState } from "./types/state.ts";
import type { PolicyCategory } from "./types/policy.ts";
import type { TradeKind, TradeTransfer } from "./types/trade.ts";
import type { UnitKind } from "./types/unit.ts";
import { generateWorld } from "./generator/index.ts";

/** Public facade: every command delegates to its domain module. */
export class GameEngine extends GameCore {
    static create(seed: number, mapSize: GameState["settings"]["mapSize"], nationCount: number): GameEngine {
        return new GameEngine(generateWorld({ seed, mapSize, nationCount }));
    }

    // ---- province-level troops (game/provinceArmy.ts) ----

    recruitUnit(kind: UnitKind, site: number): boolean {
        return recruitRegiment(this, 0, kind, site);
    }

    setProvinceStance(site: number, stance: ProvinceStance): boolean {
        return setProvinceStanceOf(this, site, stance);
    }

    clearProvinceTroops(site: number): boolean {
        return clearProvinceTroopsOf(this, site);
    }

    disbandRegiment(site: number, kind: UnitKind): boolean {
        return disbandRegiment(this, site, kind);
    }

    // ---- production (game/production.ts) ----

    queueTrain(kind: UnitKind, destination: number | null): boolean {
        return enqueueTrain(this, 0, kind, destination);
    }

    cancelTrain(orderId: number): boolean {
        return cancelTrain(this, orderId);
    }

    setTrainDestination(orderId: number, site: number | null): boolean {
        return setTrainDestination(this, orderId, site);
    }

    queueBuild(stateId: number, kind: StateBuildingKind): boolean {
        return enqueueBuild(this, 0, stateId, kind);
    }

    queueProvinceBuild(site: number, kind: ProvinceBuildingKind): boolean {
        return enqueueProvinceBuild(this, 0, site, kind);
    }

    setFactoryProduction(prod: number): boolean {
        return setFactoryProduction(this, 0, prod);
    }

    reorderConstruction(orderId: number, beforeId: number | null): boolean {
        return reorderConstruction(this, orderId, beforeId);
    }

    cancelBuild(orderId: number): boolean {
        return cancelBuild(this, orderId);
    }

    // ---- governance & diplomacy (game/policy.ts, game/diplomacy.ts) ----

    startPolicySwitch(category: PolicyCategory, value: string): boolean {
        return startPolicySwitch(this, category, value);
    }

    cancelPolicySwitch(category: PolicyCategory): boolean {
        return cancelPolicySwitch(this, category);
    }

    claimState(stateId: number): boolean {
        return claimState(this, 0, stateId);
    }

    cancelClaim(stateId: number): boolean {
        return cancelClaim(this, 0, stateId);
    }

    prepareDiplomaticAction(kind: DiplomaticActionKind, target: number, stateId: number | null): boolean {
        return prepareDiplomaticAction(this, 0, kind, target, stateId);
    }

    cancelDiplomaticAction(id: number): boolean {
        return cancelDiplomaticAction(this, 0, id);
    }

    declareWar(targetId: number, actionId?: number): boolean {
        if (this.state.winner !== null) return false;
        return startWar(this, 0, targetId, actionId);
    }

    enforceWarGoal(targetId: number, vassalType?: VassalType): boolean {
        return enforceWarGoal(this, 0, targetId, vassalType);
    }

    proposePeace(targetId: number): boolean {
        return proposePeace(this, targetId);
    }

    respondPeace(fromId: number, accept: boolean): boolean {
        return respondPeace(this, fromId, accept);
    }

    // ---- vassals & alliances (game/vassal.ts, game/alliance.ts) ----

    /** Player asks to become a vassal of the target (cooperative or autonomous only). */
    requestVassalization(targetId: number, type: string): boolean {
        return requestVassalizationOf(this, 0, targetId, type);
    }

    requestVassalUpgrade(): boolean {
        return requestVassalUpgradeOf(this, 0);
    }

    /** Coercive demand: the target becomes an oppressive vassal, or refuses. */
    demandVassalization(targetId: number): boolean {
        return demandVassalizationOf(this, 0, targetId);
    }

    adjustTributeRate(delta: number): boolean {
        return adjustTributeRateOf(this, 0, delta);
    }

    releaseVassal(vassalId: number): boolean {
        return releaseVassalOf(this, vassalId, true);
    }

    changeVassalType(vassalId: number, type: VassalType): boolean {
        return changeVassalTypeOf(this, vassalId, type);
    }

    annexVassal(vassalId: number): boolean {
        return annexVassalOf(this, 0, vassalId);
    }

    requestForeignAid(helperId?: number): boolean {
        return requestForeignAidOf(this, 0, helperId);
    }

    respondDiplomaticRequest(requestId: number, accept: boolean): boolean {
        return respondDiplomaticRequestOf(this, requestId, accept);
    }

    createAlliance(): boolean {
        return createAllianceOf(this, 0) !== null;
    }

    inviteToAlliance(targetId: number): boolean {
        return inviteToAllianceOf(this, 0, targetId);
    }

    requestJoinAlliance(leaderId: number): boolean {
        return requestJoinAllianceOf(this, 0, leaderId);
    }

    leaveAlliance(): boolean {
        return leaveAllianceOf(this, 0);
    }

    // ---- trade (game/trade.ts) ----

    /** Player offer: the target's willingness is resolved immediately and logged on refusal. */
    proposeTrade(
        targetId: number, kind: TradeKind, give: readonly TradeTransfer[], receive: readonly TradeTransfer[],
        days?: number,
    ): boolean {
        return proposeTradeOf(this, 0, targetId, { kind, give, receive }, days);
    }

    // ---- turn resolution (game/turn.ts) ----

    endTurn(): void {
        endTurn(this);
    }
}