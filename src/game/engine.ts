import { GameCore } from "./core.ts";
import {
    beginRedeploy,
    cancelMarch,
    cancelRedeploy,
    disbandArmy,
    moveArmy,
    orderMarch,
    orderMerge,
    redeploy,
    redeployTargetsFor,
    splitArmy,
    waitArmy,
} from "./armies.ts";
import { attack, cancelAttack } from "./combat.ts";
import { cancelDiplomaticAction, claimState, cancelClaim, prepareDiplomaticAction, proposePeace, respondPeace, startWar } from "./diplomacy.ts";
import { enforceWarGoal } from "./settlement.ts";
import { setPolicy } from "./policy.ts";
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
import type {
    Army,
    StateBuildingKind,
    ProvinceBuildingKind,
    ConscriptionPolicy,
    DiplomaticActionKind,
    EconomyPolicy,
    GameState,
    OccupationPolicy,
    UnitKind,
} from "./types.ts";
import { generateWorld } from "./generator/index.ts";

/** Public facade: every command delegates to its domain module. */
export class GameEngine extends GameCore {
    static create(seed: number, mapSize: GameState["settings"]["mapSize"], nationCount: number): GameEngine {
        return new GameEngine(generateWorld({ seed, mapSize, nationCount }));
    }

    // ---- movement & army management (game/armies.ts) ----

    moveArmy(armyId: number, to: number): boolean {
        return moveArmy(this, armyId, to);
    }

    orderMarch(armyId: number, target: number, attack: boolean): boolean {
        return orderMarch(this, armyId, target, attack);
    }

    cancelMarch(armyId: number): boolean {
        return cancelMarch(this, armyId);
    }

    waitArmy(armyId: number): boolean {
        return waitArmy(this, armyId);
    }

    beginRedeploy(armyId: number): boolean {
        return beginRedeploy(this, armyId);
    }

    cancelRedeploy(): void {
        cancelRedeploy(this);
    }

    redeployTargetsFor(army: Army): Set<number> {
        return redeployTargetsFor(this, army);
    }

    redeploy(armyId: number, to: number): boolean {
        return redeploy(this, armyId, to);
    }

    disbandArmy(armyId: number): boolean {
        return disbandArmy(this, armyId);
    }

    splitArmy(armyId: number, regimentIds: readonly number[]): number | null {
        return splitArmy(this, armyId, regimentIds);
    }

    orderMerge(armyIds: readonly number[]): boolean {
        return orderMerge(this, armyIds);
    }

    // ---- battles (game/combat.ts) ----

    attack(armyId: number, target: number): boolean {
        return attack(this, armyId, target);
    }

    cancelAttack(armyId: number): boolean {
        return cancelAttack(this, armyId);
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

    setPolicy(category: "economy", value: EconomyPolicy): boolean;
    setPolicy(category: "conscription", value: ConscriptionPolicy): boolean;
    setPolicy(category: "occupation", value: OccupationPolicy): boolean;
    setPolicy(category: "economy" | "conscription" | "occupation", value: string): boolean {
        return setPolicy(this, category, value);
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

    enforceWarGoal(targetId: number): boolean {
        return enforceWarGoal(this, 0, targetId);
    }

    proposePeace(targetId: number): boolean {
        return proposePeace(this, targetId);
    }

    respondPeace(fromId: number, accept: boolean): boolean {
        return respondPeace(this, fromId, accept);
    }

    // ---- turn resolution (game/turn.ts) ----

    endTurn(): void {
        endTurn(this);
    }
}