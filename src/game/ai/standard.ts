import { LCGRandom } from "../../utils/LCGRandom.ts";
import { claimedDefenseSites } from "../defense.ts";
import { canBuild, canBuildProvince, canTrain, factoryTotals, resourceRates } from "../economy.ts";
import { supplyLevel } from "../supply.ts";
import { armyAt, isHostileProvince } from "../rules.ts";
import { armyUnitCap, nationUnitCount } from "../provinceArmy.ts";
import { BUILDING_PROFILES } from "../types/building.ts";
import { UNIT_PROFILES, UnitKind } from "../types/unit.ts";
import type { GameState } from "../types/state.ts";
import type { ProvinceBuildingKind, StateBuildingKind } from "../types/building.ts";
import type { UnitKind as UnitKindType } from "../types/unit.ts";
import { tendencyProfileOf } from "./tendencies.ts";
import type { AIAction, AIController, AITendencyProfile } from "./types.ts";

const FUNDS_RESERVE = 150;
const MAX_TRAINS_PER_TURN = 2;
const MAX_BUILDS_PER_TURN = 1;

/**
 * Economic opponent: spend surplus on buildings, factory output and fresh
 * province regiments. Combat is resolved by the shared province clash pass,
 * so the AI never issues independent army orders.
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
        const frontDistance = this.frontDistance(state);

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
        const hasRoom = nationUnitCount(state, this.nationId) < armyUnitCap(state, this.nationId);
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
