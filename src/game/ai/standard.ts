import { LCGRandom } from "../../utils/LCGRandom.ts";
import { battleForecast } from "../battle.ts";
import { canBuild, canBuildProvince, canTrain, economicValue, factoryTotals } from "../economy.ts";
import { supplyLevel } from "../supply.ts";
import { armyAt, armyCap, attackTargets, isHostileProvince, nationArmyCount, reachable } from "../rules.ts";
import { BUILDING_PROFILES, REGIMENT_CAP, UNIT_PROFILES, UnitKind } from "../types.ts";
import type { Army, GameState, ProvinceBuildingKind, StateBuildingKind, UnitKind as UnitKindType } from "../types.ts";
import { tendencyProfileOf, tendencyTuning } from "./tendencies.ts";
import type { AIAction, AIController, AITendencyProfile, AITuning } from "./types.ts";

const FUNDS_RESERVE = 150;
const MAX_TRAINS_PER_TURN = 2;
const MAX_BUILDS_PER_TURN = 1;

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
        const inBattle = new Set<number>();
        for (const battle of state.battles) {
            inBattle.add(battle.attackerId);
            if (battle.defenderId !== null) inBattle.add(battle.defenderId);
        }
        const armies = [...state.armies.values()].filter(
            (army) => army.nation === this.nationId && !army.acted && !inBattle.has(army.id),
        );
        const committed = new Set<number>();

        actions.push(...this.pickAttacks(state, armies, committed, tuning));

        const reserved = new Set<number>();
        for (const army of armies) {
            if (committed.has(army.id)) continue;
            const destination = this.pickAdvance(state, army, frontDistance, reserved, profile);
            if (destination === null) continue;
            reserved.add(destination);
            committed.add(army.id);
            actions.push({ kind: "move", armyId: army.id, to: destination });
        }

        const builds = this.pickBuilds(state, frontDistance, profile);
        actions.push(...builds);
        const { total } = factoryTotals(state, this.nationId);
        const queued = state.construction.filter((order) => order.nation === this.nationId).length + builds.length;
        const idle = Math.min(total, Math.max(1, Math.ceil(total / 3), Math.min(Math.max(1, total - 1), queued * 2)));
        actions.push({ kind: "factoryProduction", prod: total - idle });
        actions.push(...this.pickTrains(state, frontDistance, profile));
        return actions;
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
                const score = ratio * (1 + economicValue(state, state.provinces[target]));
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
        reserved: Set<number>,
        profile: AITendencyProfile,
    ): number | null {
        const reach = reachable(state, army);
        const current = army.province;
        const currentDistance = frontDistance[current];
        const currentScore = currentDistance < 0 ? Infinity : currentDistance * 10;
        // Defensive nations pull back onto threatened cities harder; aggressive ones advance sooner.
        const holdBonus = 8 + Math.max(0, profile.defense - 3) * 4 - Math.max(0, profile.aggression - 3) * 2;
        let best: number | null = null;
        let bestScore = currentScore;

        for (const [site, cost] of reach.cost) {
            const distance = frontDistance[site];
            if (distance < 0) continue;
            if (reserved.has(site)) continue;
            const occupant = armyAt(state, site);
            if (occupant && occupant.regiments.length + army.regiments.length > REGIMENT_CAP) continue;

            let score = distance * 10 + cost * 0.2 + (occupant ? 3 : 0);
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
        const maxBuilds = Math.min(maxPending - pending, nation.funds > 800 ? 2 : MAX_BUILDS_PER_TURN);
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
            const priorities: StateBuildingKind[] = region.infrastructure < 2
                ? (defensive ? ["infrastructure", "factory", "farm", "admin"] : ["factory", "infrastructure", "admin", "farm"])
                : defensive ? ["infrastructure", "farm", "factory", "admin"]
                : economyFirst ? ["farm", "factory", "infrastructure", "admin"]
                : ["factory", "admin", "farm", "infrastructure"];
            for (const kind of priorities) {
                if (!canBuild(state, this.nationId, region.id, kind) || !spend(kind)) continue;
                actions.push({ kind: "build", stateId: region.id, buildingKind: kind });
                break;
            }
        }
        for (const province of state.provinces) {
            if (actions.length >= maxBuilds) break;
            if (province.owner !== this.nationId) continue;
            const frontierFort = defensive && frontDistance[province.site] >= 0 && frontDistance[province.site] <= 2;
            const kind: ProvinceBuildingKind | null = this.threatened(state, province.site) || frontierFort ? "fort"
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

        const cities = state.provinces
            .filter((province) => province.owner === this.nationId && province.isCity)
            .map((province) => ({
                site: province.site,
                distance: frontDistance[province.site] < 0 ? Infinity : frontDistance[province.site],
            }))
            .sort((a, b) => a.distance - b.distance);

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
