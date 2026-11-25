import { LCGRandom } from "../../utils/LCGRandom.ts";
import { battleForecast } from "../battle.ts";
import { claimedDefenseSites } from "../defense.ts";
import { canBuild, canBuildProvince, canTrain, economicValue, factoryTotals, resourceRates } from "../economy.ts";
import { supplyLevel } from "../supply.ts";
import { armyAt, armyCap, attackTargets, isHostileProvince, nationArmyCount, reachable } from "../rules.ts";
import { BUILDING_PROFILES } from "../types/building.ts";
import { REGIMENT_CAP, UNIT_PROFILES, UnitKind } from "../types/unit.ts";
import type { Army } from "../types/organization.ts";
import type { GameState } from "../types/state.ts";
import type { ProvinceBuildingKind, StateBuildingKind } from "../types/building.ts";
import type { UnitKind as UnitKindType } from "../types/unit.ts";
import { tendencyProfileOf, tendencyTuning } from "./tendencies.ts";
import type { AIAction, AIController, AITendencyProfile, AITuning } from "./types.ts";

const FUNDS_RESERVE = 150;
const MAX_TRAINS_PER_TURN = 2;
const MAX_BUILDS_PER_TURN = 1;
/** Claimed hostile ground is a preferred assault target; claim guard/assault ground outranks equal-distance front. */
const CLAIM_ASSAULT_SCORE_BONUS = 1;
const CLAIM_OBJECTIVE_EDGE = 6;

/**
 * Army-level opponent: commit corps to favorable assaults, push the rest
 * toward the front, and spend surplus on buildings and replacements.
 *
 * The nation's fixed temperament adjusts the comparison thresholds and dice
 * weights; the action set and validation path stay identical to the player's.
 */
export class StandardAI implements AIController {
    readonly nationId: number;
    private readonly rand: LCGRandom;

    constructor(nationId: number, seed: number) {
        this.nationId = nationId;
        this.rand = new LCGRandom(seed ^ (nationId * 0x9e3779b1));
    }

    takeTurn(state: GameState): AIAction[] {
        const actions: AIAction[] = [];
        if (!state.nations[this.nationId].alive) return actions;

        const profile = tendencyProfileOf(state.nations[this.nationId]?.tendency);
        const tuning = tendencyTuning(profile);
        const frontDistance = this.frontDistance(state);
        actions.push(...this.planArmies(state, this.eligibleArmies(state), frontDistance, tuning, profile));

        const builds = this.pickBuilds(state, frontDistance, profile);
        actions.push(...builds);
        const { total } = factoryTotals(state, this.nationId);
        const queued = state.construction.filter((order) => order.nation === this.nationId).length + builds.length;
        const idle = Math.min(total, Math.max(1, Math.ceil(total / 3), Math.min(Math.max(1, total - 1), queued * 2)));
        actions.push({ kind: "factoryProduction", prod: total - idle });
        actions.push(...this.pickTrains(state, frontDistance, profile));
        return actions;
    }

    /**
     * Army-only planning, shared with the human player's 托管 mode. The same
     * assault/advance decisions run for managed corps; economy stays with the
     * player, so no build/train/production actions are produced here.
     */
    takeArmyTurn(state: GameState, only?: (army: Army) => boolean): AIAction[] {
        if (!state.nations[this.nationId]?.alive) return [];
        const profile = tendencyProfileOf(state.nations[this.nationId]?.tendency);
        const tuning = tendencyTuning(profile);
        const frontDistance = this.frontDistance(state);
        return this.planArmies(state, this.eligibleArmies(state, only), frontDistance, tuning, profile);
    }

    private eligibleArmies(state: GameState, only?: (army: Army) => boolean): Army[] {
        const inBattle = new Set<number>();
        for (const battle of state.battles) {
            inBattle.add(battle.attackerId);
            if (battle.defenderId !== null) inBattle.add(battle.defenderId);
        }
        return [...state.armies.values()].filter((army) =>
            army.nation === this.nationId && !army.acted && !inBattle.has(army.id) && (only?.(army) ?? true));
    }

    private planArmies(
        state: GameState,
        armies: Army[],
        frontDistance: Int32Array,
        tuning: AITuning,
        profile: AITendencyProfile,
    ): AIAction[] {
        const claim = this.claimFocus(state);
        const committed = new Set<number>();
        const actions: AIAction[] = [];
        actions.push(...this.pickAttacks(state, armies, committed, tuning, claim.assaultSites));

        const reserved = new Set<number>();
        for (const army of armies) {
            if (committed.has(army.id)) continue;
            const destination = this.pickAdvance(state, army, frontDistance, claim.distance, reserved, profile);
            if (destination === null) continue;
            reserved.add(destination);
            committed.add(army.id);
            actions.push({ kind: "move", armyId: army.id, to: destination });
        }
        return actions;
    }

    /**
     * Claim objectives shared by AI nations and the player's 托管 corps:
     *  - guard our own ground inside states a rival claimed (defensive destination)
     *  - assault hostile ground inside states we claimed (war still required to attack)
     * The distance field intentionally mirrors `frontDistance` but is kept separate
     * so build/train priorities, which also read `frontDistance`, stay unchanged.
     */
    private claimFocus(state: GameState): { distance: Int32Array; assaultSites: Set<number> } {
        const distance = new Int32Array(state.provinces.length).fill(-1);
        const assaultSites = new Set<number>();
        const queue: number[] = [];
        const seed = (site: number): void => {
            if (!state.terrain.passable[site] || distance[site] >= 0) return;
            distance[site] = 0;
            queue.push(site);
        };
        for (const claim of state.claims) {
            const region = state.states[claim.stateId];
            if (!region) continue;
            if (claim.nation !== this.nationId) {
                for (const site of region.provinces) {
                    if (state.provinces[site].owner === this.nationId) seed(site);
                }
            } else {
                for (const site of region.provinces) {
                    if (!isHostileProvince(state, this.nationId, site)) continue;
                    seed(site);
                    assaultSites.add(site);
                }
            }
        }
        // Flood across our own territory. A hostile seed hands off to an adjacent
        // friendly province, so armies stage next to a claimed enemy state.
        for (let head = 0; head < queue.length; head++) {
            for (const edge of state.graph.adjacency[queue[head]]) {
                const next = edge.site;
                if (!state.terrain.passable[next] || distance[next] >= 0) continue;
                if (state.provinces[next].owner !== this.nationId) continue;
                distance[next] = distance[queue[head]] + 1;
                queue.push(next);
            }
        }
        return { distance, assaultSites };
    }

    /** Lower is better; claim objectives slightly outrank equal-distance front ground. */
    private targetScore(frontDistance: Int32Array, claimDistance: Int32Array, site: number): number {
        const claim = claimDistance[site];
        if (claim >= 0) return claim * 10 - CLAIM_OBJECTIVE_EDGE;
        const front = frontDistance[site];
        return front < 0 ? Infinity : front * 10;
    }

    private frontDistance(state: GameState): Int32Array {
        const distance = new Int32Array(state.provinces.length).fill(-1);
        const queue: number[] = [];

        for (const province of state.provinces) {
            if (!state.terrain.passable[province.site]) continue;
            if (!isHostileProvince(state, this.nationId, province.site)) continue;
            distance[province.site] = 0;
            queue.push(province.site);
        }

        for (let head = 0; head < queue.length; head++) {
            const site = queue[head];
            for (const edge of state.graph.adjacency[site]) {
                if (!state.terrain.passable[edge.site] || distance[edge.site] >= 0 ||
                    state.provinces[edge.site].owner !== this.nationId) continue;
                distance[edge.site] = distance[site] + 1;
                queue.push(edge.site);
            }
        }

        return distance;
    }

    private pickAttacks(
        state: GameState,
        armies: Army[],
        committed: Set<number>,
        tuning: AITuning,
        assaultSites: Set<number>,
    ): AIAction[] {
        interface Candidate { army: Army; target: number; score: number }
        const candidates: Candidate[] = [];

        for (const army of armies) {
            if (army.org < tuning.attackMinOrg || army.regiments.length === 0) continue;
            let best: Candidate | null = null;
            for (const target of attackTargets(state, army)) {
                if (state.battles.some((battle) => battle.province === target)) continue;
                const forecast = battleForecast(state, army, target);
                const ratio = forecast.attackPower / Math.max(1, forecast.defensePower);
                if (forecast.defensePower > 0 && ratio < tuning.attackRatio) continue;
                const claimPriority = assaultSites.has(target) ? 1 + CLAIM_ASSAULT_SCORE_BONUS : 1;
                const score = ratio * (1 + economicValue(state, state.provinces[target])) * claimPriority;
                if (!best || score > best.score) best = { army, target, score };
            }
            if (best) candidates.push(best);
        }

        candidates.sort((a, b) => b.score - a.score);
        const actions: AIAction[] = [];
        const takenTargets = new Set<number>();
        for (const candidate of candidates) {
            if (committed.has(candidate.army.id) || takenTargets.has(candidate.target)) continue;
            committed.add(candidate.army.id);
            takenTargets.add(candidate.target);
            actions.push({ kind: "attack", armyId: candidate.army.id, target: candidate.target });
        }
        return actions;
    }

    private pickAdvance(
        state: GameState,
        army: Army,
        frontDistance: Int32Array,
        claimDistance: Int32Array,
        reserved: Set<number>,
        profile: AITendencyProfile,
    ): number | null {
        const reach = reachable(state, army);
        const current = army.province;
        const currentScore = this.targetScore(frontDistance, claimDistance, current);
        // Defensive nations pull back onto threatened cities harder; aggressive ones advance sooner.
        const holdBonus = 8 + Math.max(0, profile.defense - 3) * 4 - Math.max(0, profile.aggression - 3) * 2;
        let best: number | null = null;
        let bestScore = currentScore;

        for (const [site, cost] of reach.cost) {
            const objective = this.targetScore(frontDistance, claimDistance, site);
            if (!Number.isFinite(objective) || reserved.has(site)) continue;
            const occupant = armyAt(state, site);
            if (occupant && occupant.regiments.length + army.regiments.length > REGIMENT_CAP) continue;

            let score = objective + cost * 0.2 + (occupant ? 3 : 0);
            // Defend rich ground: fall back onto a threatened city or capital.
            const province = state.provinces[site];
            if ((province.isCity || province.isCapital) && this.threatened(state, site)) score -= holdBonus;
            if (score < bestScore - 0.5) {
                bestScore = score;
                best = site;
            }
        }

        return best;
    }

    private threatened(state: GameState, site: number): boolean {
        for (const edge of state.graph.adjacency[site]) {
            const occupant = armyAt(state, edge.site);
            if (occupant && occupant.nation !== this.nationId &&
                state.war[this.nationId]?.[occupant.nation]) return true;
        }
        return false;
    }

    private pickBuilds(state: GameState, frontDistance: Int32Array, profile: AITendencyProfile): AIAction[] {
        const nation = state.nations[this.nationId];
        const pending = state.construction.filter((order) => order.nation === this.nationId).length;
        // Avoid a huge backlog while retaining simultaneous construction.
        const maxPending = Math.max(2, Math.ceil(factoryTotals(state, this.nationId).total / 5) * 2);
        if (pending >= maxPending) return [];
        let funds = nation.funds - FUNDS_RESERVE;
        let industry = nation.industry;
        const actions: AIAction[] = [];
        const rates = resourceRates(state, this.nationId);
        const rawTight = rates.raw < 0;
        const foodTight = rates.food < 0;
        let maxBuilds = Math.min(maxPending - pending, nation.funds > 800 ? 2 : MAX_BUILDS_PER_TURN);
        if (rawTight || foodTight) maxBuilds = 1;
        const spend = (kind: StateBuildingKind | ProvinceBuildingKind): boolean => {
            const cost = BUILDING_PROFILES[kind];
            if (actions.length >= maxBuilds || funds < cost.costFunds || industry < cost.costIndustry) return false;
            funds -= cost.costFunds;
            industry -= cost.costIndustry;
            return true;
        };
        const defensive = profile.defense >= 4;
        const economyFirst = profile.id === "trader" || (profile.id === "pacifist");
        const regions = state.states.filter((region) => state.provinces[region.center].owner === this.nationId)
            .sort((a, b) => a.factories - b.factories || a.id - b.id);
        for (const region of regions) {
            let priorities: StateBuildingKind[] = region.infrastructure < 2
                ? (defensive ? ["infrastructure", "factory", "farm", "admin"] : ["factory", "infrastructure", "admin", "farm"])
                : defensive ? ["infrastructure", "farm", "factory", "admin"]
                : economyFirst ? ["farm", "factory", "infrastructure", "admin"]
                : ["factory", "admin", "farm", "infrastructure"];
            // Factories need raw inputs; a starving nation prioritises food first.
            if (rawTight) priorities = priorities.filter((kind) => kind !== "factory");
            if (foodTight) priorities = ["farm", ...priorities.filter((kind) => kind !== "farm")];
            for (const kind of priorities) {
                if (!canBuild(state, this.nationId, region.id, kind) || !spend(kind)) continue;
                actions.push({ kind: "build", stateId: region.id, buildingKind: kind });
                break;
            }
        }
        // A rival's claim is a standing threat: harden those provinces first.
        const claimedSites = claimedDefenseSites(state, this.nationId);
        const ownedProvinces = state.provinces
            .filter((province) => province.owner === this.nationId)
            .sort((a, b) => Number(claimedSites.has(b.site)) - Number(claimedSites.has(a.site)));
        for (const province of ownedProvinces) {
            if (actions.length >= maxBuilds) break;
            const claimedFort = claimedSites.has(province.site);
            const frontierFort = defensive && frontDistance[province.site] >= 0 && frontDistance[province.site] <= 2;
            const kind: ProvinceBuildingKind | null = this.threatened(state, province.site) || claimedFort || frontierFort ? "fort"
                : frontDistance[province.site] > 0 && supplyLevel(state, province.site) < 0.5 ? "supply" : null;
            if (kind && canBuildProvince(state, this.nationId, province.site, kind) && spend(kind)) {
                actions.push({ kind: "provinceBuild", site: province.site, buildingKind: kind });
            }
        }
        return actions;
    }

    private pickTrains(state: GameState, frontDistance: Int32Array, profile: AITendencyProfile): AIAction[] {
        const nation = state.nations[this.nationId];
        const hasRoom = nationArmyCount(state, this.nationId) < armyCap(state, this.nationId) ||
            [...state.armies.values()].some(
                (army) => army.nation === this.nationId && army.regiments.length < REGIMENT_CAP,
            );
        if (!hasRoom) return [];

        const rates = resourceRates(state, this.nationId);
        // Armies eat food every day; a food deficit means no new regiments.
        if (rates.food < 0) return [];
        const strategicTight = rates.strategic < 0;

        const claimedSites = claimedDefenseSites(state, this.nationId);
        const cities = state.provinces
            .filter((province) => province.owner === this.nationId && province.isCity)
            .map((province) => ({
                site: province.site,
                distance: frontDistance[province.site] < 0 ? Infinity : frontDistance[province.site],
                claimPriority: claimedSites.has(province.site),
            }))
            .sort((a, b) => Number(b.claimPriority) - Number(a.claimPriority) || a.distance - b.distance);

        // Aggressive nations lean on armour; defensive ones keep an infantry core.
        const artilleryBias = Math.max(0.08, 0.2 + (profile.defense - 3) * 0.02 + (profile.expansion - 3) * 0.01);
        const armourBias = Math.max(0.08, 0.25 + (profile.aggression - 3) * 0.07 - (profile.defense - 3) * 0.04);
        const actions: AIAction[] = [];
        let funds = nation.funds;
        const maxTrains = funds > 1200 ? 4 : MAX_TRAINS_PER_TURN;
        for (let i = 0; i < Math.min(maxTrains, Math.max(1, cities.length)); i++) {
            const roll = this.rand.nextFloat();
            let kind: UnitKindType = UnitKind.INFANTRY;
            if (roll < artilleryBias) kind = UnitKind.ARTILLERY;
            else if (roll < artilleryBias + armourBias) kind = UnitKind.TANK;
            // Armoured and artillery regiments burn strategic resources daily.
            if (strategicTight) kind = UnitKind.INFANTRY;
            if (!canTrain(state, this.nationId, kind)) kind = UnitKind.INFANTRY;
            if (!canTrain(state, this.nationId, kind)) continue;
            const unitProfile = UNIT_PROFILES[kind];
            if (funds < unitProfile.cost + FUNDS_RESERVE) continue;
            funds -= unitProfile.cost;
            actions.push({ kind: "train", province: cities[i]?.site ?? null, unitKind: kind });
        }
        return actions;
    }
}
